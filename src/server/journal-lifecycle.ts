import type Database from 'better-sqlite3';
import { createHash } from 'node:crypto';
import { canonical } from '../shared/canonical.js';
import {
  journalEntrySchema,
  type JournalEntry,
} from '../shared/journal-contracts.js';
import { DomainError } from '../domain/tree.js';
import {
  JournalMediaRepository,
  type JournalRetainedMedia,
} from './journal-media-repository.js';
import { journalEntryV2Schema } from '../shared/journal-contracts-v2.js';
export type JournalLifecycleEntry = JournalEntry & {
  contentJson: string | null;
  mediaRefs: JournalRetainedMedia[];
};
export interface JournalLifecycleContract {
  captureDeletion(
    undoSequence: number,
    projectId: string,
    removedTaskIds: readonly string[],
  ): number;
  validateUndo(
    undoSequence: number,
    projectId: string,
    lifecycleVersion: 0 | 1 | 2,
    targetTaskIds: readonly string[],
    removedTaskIds: readonly string[],
  ): JournalLifecycleEntry[];
  finishDeletion(projectId: string, removedEntryCount: number): void;
  restore(projectId: string, entries: readonly JournalLifecycleEntry[]): void;
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
function payloadDigest(
  undoSequence: number,
  projectId: string,
  entries: readonly JournalLifecycleEntry[],
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
  private entries(
    table: 'journal_entries' | 'undo_journal_entries',
    projectId: string,
    undoSequence?: number,
  ): JournalLifecycleEntry[] {
    const media = new JournalMediaRepository(this.db);
    const rows = this.db
      .prepare(
        `SELECT ${columns},contentJson FROM ${table} WHERE ${table === 'journal_entries' ? 'projectId=?' : 'undoSequence=?'} ORDER BY id`,
      )
      .all(undoSequence ?? projectId) as (JournalEntry & {
      contentJson: string | null;
    })[];
    return rows.map((row) => {
      const { contentJson, ...plain } = row;
      const entry = validatedEntry(plain);
      const ids = this.db
        .prepare(
          table === 'journal_entries'
            ? 'SELECT mediaId FROM journal_entry_media WHERE entryId=? ORDER BY mediaId'
            : 'SELECT mediaId FROM undo_journal_media WHERE undoSequence=? AND entryId=? ORDER BY mediaId',
        )
        .all(
          ...(table === 'journal_entries'
            ? [entry.id]
            : [undoSequence!, entry.id]),
        ) as { mediaId: string }[];
      const mediaRefs = ids.map(({ mediaId }) =>
        media.verifyRetainedMedia(entry, mediaId),
      );
      const content =
        contentJson === null
          ? { format: 'plain-text', text: entry.body }
          : JSON.parse(contentJson);
      if (
        !journalEntryV2Schema.safeParse({
          ...entry,
          content,
          media: mediaRefs.map((ref) => ref.media),
        }).success
      )
        throw Error('Invalid internal journal lifecycle content');
      return { ...entry, contentJson, mediaRefs };
    });
  }
  captureDeletion(
    undoSequence: number,
    projectId: string,
    removedTaskIds: readonly string[],
  ): number {
    this.requireTransaction();
    const removed = new Set(removedTaskIds);
    const entries = this.entries('journal_entries', projectId).filter((entry) =>
      removed.has(entry.taskId),
    );
    const insert = this.db.prepare(
      `INSERT INTO undo_journal_entries(undoSequence,${columns},contentJson) VALUES (@undoSequence,@id,@projectId,@taskId,@workDate,@body,@createdAt,@updatedAt,@contentJson)`,
    );
    const pin = this.db.prepare(
      'INSERT INTO undo_journal_media(undoSequence,entryId,mediaId) VALUES (?,?,?)',
    );
    for (const { mediaRefs, ...entry } of entries) {
      insert.run({ undoSequence, ...entry });
      for (const ref of mediaRefs)
        pin.run(undoSequence, entry.id, ref.media.id);
    }
    const plain = entries.map(
      ({ id, projectId, taskId, workDate, body, createdAt, updatedAt }) => ({
        id,
        projectId,
        taskId,
        workDate,
        body,
        createdAt,
        updatedAt,
      }),
    );
    this.db
      .prepare(
        'INSERT INTO undo_journal_manifest(undoSequence,entryCount,entriesSha256,mediaCount,payloadSha256) VALUES (?,?,?,?,?)',
      )
      .run(
        undoSequence,
        entries.length,
        digest(undoSequence, projectId, plain),
        entries.reduce((n, entry) => n + entry.mediaRefs.length, 0),
        payloadDigest(undoSequence, projectId, entries),
      );
    return entries.length;
  }
  validateUndo(
    undoSequence: number,
    projectId: string,
    lifecycleVersion: 0 | 1 | 2,
    targetTaskIds: readonly string[],
    removedTaskIds: readonly string[],
  ): JournalLifecycleEntry[] {
    this.requireTransaction();
    const entries = this.entries(
      'undo_journal_entries',
      projectId,
      undoSequence,
    );
    const manifest = this.db
      .prepare(
        'SELECT entryCount,entriesSha256,mediaCount,payloadSha256 FROM undo_journal_manifest WHERE undoSequence=?',
      )
      .get(undoSequence) as
      | {
          entryCount: number;
          entriesSha256: string;
          mediaCount: number | null;
          payloadSha256: string | null;
        }
      | undefined;
    const relationCount = this.db
      .prepare(
        'SELECT count(*) AS count FROM undo_journal_media WHERE undoSequence=?',
      )
      .get(undoSequence) as { count: number };
    if (
      relationCount.count !==
      entries.reduce((n, e) => n + e.mediaRefs.length, 0)
    )
      throw Error('Invalid internal journal media relations');
    const plain = entries.map(
      ({ id, projectId, taskId, workDate, body, createdAt, updatedAt }) => ({
        id,
        projectId,
        taskId,
        workDate,
        body,
        createdAt,
        updatedAt,
      }),
    );
    if (lifecycleVersion === 0) {
      if (manifest || entries.length)
        throw Error('Unexpected historical journal lifecycle');
    } else {
      if (
        !manifest ||
        !Number.isSafeInteger(manifest.entryCount) ||
        manifest.entryCount !== entries.length ||
        !/^[a-f0-9]{64}$/.test(manifest.entriesSha256) ||
        manifest.entriesSha256 !== digest(undoSequence, projectId, plain)
      )
        throw Error('Invalid internal journal manifest');
      if (lifecycleVersion === 1) {
        if (
          manifest.mediaCount !== null ||
          manifest.payloadSha256 !== null ||
          entries.some((e) => e.contentJson !== null || e.mediaRefs.length)
        )
          throw Error('Unexpected historical journal media');
      } else if (
        lifecycleVersion !== 2 ||
        !Number.isSafeInteger(manifest.mediaCount) ||
        manifest.mediaCount !==
          entries.reduce((n, e) => n + e.mediaRefs.length, 0) ||
        typeof manifest.payloadSha256 !== 'string' ||
        !/^[a-f0-9]{64}$/.test(manifest.payloadSha256) ||
        manifest.payloadSha256 !==
          payloadDigest(undoSequence, projectId, entries)
      )
        throw Error('Invalid internal journal media manifest');
    }
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
  restore(projectId: string, entries: readonly JournalLifecycleEntry[]): void {
    this.requireTransaction();
    const insert = this.db.prepare(
      `INSERT INTO journal_entries(${columns},contentJson) VALUES (@id,@projectId,@taskId,@workDate,@body,@createdAt,@updatedAt,@contentJson)`,
    );
    for (const row of entries) {
      const { contentJson, mediaRefs, ...plain } = row;
      const entry = validatedEntry(plain);
      if (entry.projectId !== projectId)
        throw new Error('Invalid internal journal restore scope');
      insert.run({ ...entry, contentJson });
      for (const ref of mediaRefs) {
        this.db
          .prepare(
            'INSERT INTO journal_entry_media(entryId,mediaId) VALUES (?,?)',
          )
          .run(entry.id, ref.media.id);
        this.db
          .prepare('UPDATE journal_media SET unreferencedAt=NULL WHERE id=?')
          .run(ref.media.id);
      }
    }
    if (entries.length) this.bump(projectId);
  }
}
