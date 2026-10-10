import type Database from 'better-sqlite3';
import { createHash } from 'node:crypto';
import { canonical } from '../shared/canonical.js';
import {
  journalEntrySchema,
  type JournalEntry,
} from '../shared/journal-contracts.js';
import { DomainError } from '../domain/tree.js';
export interface JournalLifecycleContract {
  captureDeletion(
    undoSequence: number,
    projectId: string,
    removedTaskIds: readonly string[],
  ): number;
  validateUndo(
    undoSequence: number,
    projectId: string,
    lifecycleVersion: 0 | 1,
    targetTaskIds: readonly string[],
    removedTaskIds: readonly string[],
  ): JournalEntry[];
  finishDeletion(projectId: string, removedEntryCount: number): void;
  restore(projectId: string, entries: readonly JournalEntry[]): void;
}
const columns = 'id,projectId,taskId,workDate,body,createdAt,updatedAt';
function digest(
  undoSequence: number,
  projectId: string,
  entries: readonly JournalEntry[],
): string {
  return createHash('sha256')
    .update(
      canonical({
        undoSequence,
        projectId,
        entries: [...entries].sort((a, b) => a.id.localeCompare(b.id)),
      }),
    )
    .digest('hex');
}
function validatedEntry(row: unknown): JournalEntry {
  const parsed = journalEntrySchema.safeParse(row);
  if (!parsed.success) throw new Error('Invalid internal journal lifecycle');
  return parsed.data;
}
export class JournalLifecycle implements JournalLifecycleContract {
  constructor(private readonly db: Database.Database) {}
  private requireTransaction() {
    if (!this.db.inTransaction)
      throw new Error('Journal lifecycle requires transaction');
  }
  private bump(projectId: string) {
    const state = this.db
      .prepare('SELECT revision FROM journal_state WHERE projectId=?')
      .get(projectId) as { revision: number } | undefined;
    if (
      !state ||
      !Number.isSafeInteger(state.revision) ||
      state.revision < 0 ||
      state.revision === Number.MAX_SAFE_INTEGER
    )
      throw new Error('Invalid internal journal state');
    this.db
      .prepare('UPDATE journal_state SET revision=? WHERE projectId=?')
      .run(state.revision + 1, projectId);
  }
  captureDeletion(
    undoSequence: number,
    projectId: string,
    removedTaskIds: readonly string[],
  ): number {
    this.requireTransaction();
    const removed = new Set(removedTaskIds);
    const entries = this.db
      .prepare(
        `SELECT ${columns} FROM journal_entries WHERE projectId=? ORDER BY id`,
      )
      .all(projectId)
      .map(validatedEntry)
      .filter((entry) => removed.has(entry.taskId));
    const insert = this.db.prepare(
      `INSERT INTO undo_journal_entries(undoSequence,${columns}) VALUES (@undoSequence,@id,@projectId,@taskId,@workDate,@body,@createdAt,@updatedAt)`,
    );
    for (const entry of entries) insert.run({ undoSequence, ...entry });
    this.db
      .prepare(
        'INSERT INTO undo_journal_manifest(undoSequence,entryCount,entriesSha256) VALUES (?,?,?)',
      )
      .run(
        undoSequence,
        entries.length,
        digest(undoSequence, projectId, entries),
      );
    return entries.length;
  }
  validateUndo(
    undoSequence: number,
    projectId: string,
    lifecycleVersion: 0 | 1,
    targetTaskIds: readonly string[],
    removedTaskIds: readonly string[],
  ): JournalEntry[] {
    this.requireTransaction();
    const entries = this.db
      .prepare(
        `SELECT ${columns} FROM undo_journal_entries WHERE undoSequence=? ORDER BY id`,
      )
      .all(undoSequence)
      .map(validatedEntry);
    const manifest = this.db
      .prepare(
        'SELECT entryCount,entriesSha256 FROM undo_journal_manifest WHERE undoSequence=?',
      )
      .get(undoSequence) as
      { entryCount: number; entriesSha256: string } | undefined;
    if (lifecycleVersion === 0) {
      if (manifest || entries.length)
        throw new Error('Unexpected historical journal lifecycle');
    } else if (
      lifecycleVersion !== 1 ||
      !manifest ||
      !Number.isSafeInteger(manifest.entryCount) ||
      manifest.entryCount !== entries.length ||
      !/^[a-f0-9]{64}$/.test(manifest.entriesSha256) ||
      manifest.entriesSha256 !== digest(undoSequence, projectId, entries)
    )
      throw new Error('Invalid internal journal manifest');
    const current = new Set(
      (this.db.prepare('SELECT id FROM tasks').all() as { id: string }[]).map(
        (row) => row.id,
      ),
    );
    const restored = new Set(targetTaskIds.filter((id) => !current.has(id)));
    for (const entry of entries) {
      if (
        entry.projectId !== projectId ||
        !restored.has(entry.taskId) ||
        this.db
          .prepare('SELECT id FROM journal_entries WHERE id=?')
          .get(entry.id)
      )
        throw new Error('Invalid internal journal sidecar scope');
    }
    const removed = new Set(removedTaskIds);
    const active = this.db
      .prepare(`SELECT ${columns} FROM journal_entries WHERE projectId=?`)
      .all(projectId)
      .map(validatedEntry);
    if (active.some((entry) => removed.has(entry.taskId)))
      throw new DomainError(
        'UNDO_JOURNAL_CONFLICT',
        'Удалите записи новой задачи перед отменой её создания.',
        409,
      );
    return entries;
  }
  finishDeletion(projectId: string, removedEntryCount: number): void {
    this.requireTransaction();
    if (removedEntryCount > 0) this.bump(projectId);
  }
  restore(projectId: string, entries: readonly JournalEntry[]): void {
    this.requireTransaction();
    const insert = this.db.prepare(
      `INSERT INTO journal_entries(${columns}) VALUES (@id,@projectId,@taskId,@workDate,@body,@createdAt,@updatedAt)`,
    );
    for (const row of entries) {
      const entry = validatedEntry(row);
      if (entry.projectId !== projectId)
        throw new Error('Invalid internal journal restore scope');
      insert.run(entry);
    }
    if (entries.length) this.bump(projectId);
  }
}
