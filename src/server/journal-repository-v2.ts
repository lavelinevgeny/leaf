import type Database from 'better-sqlite3';
import { createHash, randomUUID } from 'node:crypto';
import { z } from 'zod';
import { canonical } from '../shared/canonical.js';
import { uuidSchema } from '../shared/contracts.js';
import { DomainError } from '../domain/tree.js';
import { JournalRepository } from './journal-repository.js';
import { JournalMediaRepository } from './journal-media-repository.js';
import {
  journalContentSchema,
  projectJournalContent,
} from '../shared/journal-content.js';
import type {
  JournalEntry,
  JournalProjectQuery,
  JournalTaskQuery,
} from '../shared/journal-contracts.js';
import {
  journalCreateV2Schema,
  journalUpdateV2Schema,
  journalDeleteV2Schema,
  journalEntryV2Schema,
  journalMutationV2Schema,
  journalPageV2Schema,
  journalEntryReadV2Schema,
  type JournalCreateV2,
  type JournalUpdateV2,
  type JournalDeleteV2,
  type JournalEntryV2,
  type JournalMutationV2,
} from '../shared/journal-contracts-v2.js';
function internal<T>(schema: z.ZodType<T>, value: unknown): T {
  const parsed = schema.safeParse(value);
  if (!parsed.success) throw Error('Invalid internal journal2 data');
  return parsed.data;
}
function invalidCursor(): never {
  throw new DomainError('INVALID_REQUEST', 'Проверьте поля запроса.');
}
// The unchanged v1 read engine owns scope/filter/keyset validation. Only the
// public cursor discriminator changes; malformed/noncanonical encodings fail closed.
function cursorVersion(cursor: string, from: number, to: number): string {
  try {
    if (!/^[A-Za-z0-9_-]+$/.test(cursor) || cursor.length > 4096)
      invalidCursor();
    const bytes = Buffer.from(cursor, 'base64url');
    if (bytes.toString('base64url') !== cursor) invalidCursor();
    const value = JSON.parse(
      new TextDecoder('utf-8', { fatal: true }).decode(bytes),
    );
    if (value.version !== from) invalidCursor();
    value.version = to;
    return Buffer.from(canonical(value)).toString('base64url');
  } catch {
    invalidCursor();
  }
}
export class JournalRepositoryV2 {
  private readonly reads: JournalRepository;
  private readonly media: JournalMediaRepository;
  constructor(
    private readonly db: Database.Database,
    private readonly now: () => number = Date.now,
  ) {
    this.reads = new JournalRepository(db, now);
    this.media = new JournalMediaRepository(db, now);
  }
  private enrich(entry: JournalEntry): JournalEntryV2 {
    const row = this.db
      .prepare('SELECT contentJson FROM journal_entries WHERE id=?')
      .get(entry.id) as { contentJson: string | null } | undefined;
    if (!row) throw Error('Missing internal journal2 entry');
    const content =
      row.contentJson === null
        ? { format: 'plain-text', text: entry.body }
        : JSON.parse(row.contentJson);
    return internal(journalEntryV2Schema, {
      ...entry,
      content,
      media: this.media.metadataForEntry(entry.id),
    });
  }
  getEntry(projectId: string, entryId: string) {
    return this.db.transaction(() => {
      const read = this.reads.getEntry(projectId, entryId);
      return internal(journalEntryReadV2Schema, {
        ...read,
        journalContractVersion: 2,
        entry: this.enrich(read.entry),
      });
    })();
  }
  getProjectPage(projectId: string, query: JournalProjectQuery) {
    return this.page(projectId, null, query);
  }
  getTaskPage(projectId: string, taskId: string, query: JournalTaskQuery) {
    return this.page(projectId, taskId, query);
  }
  private page(
    projectId: string,
    taskId: string | null,
    query: JournalProjectQuery,
  ) {
    return this.db.transaction(() => {
      const translated = {
        ...query,
        ...(query.cursor ? { cursor: cursorVersion(query.cursor, 2, 1) } : {}),
      };
      const page =
        taskId === null
          ? this.reads.getProjectPage(projectId, translated)
          : this.reads.getTaskPage(projectId, taskId, translated);
      return internal(journalPageV2Schema, {
        ...page,
        journalContractVersion: 2,
        entries: page.entries.map((e) => this.enrich(e)),
        nextCursor: page.nextCursor
          ? cursorVersion(page.nextCursor, 1, 2)
          : null,
      });
    })();
  }
  create(projectId: string, input: JournalCreateV2, sessionId: string) {
    return this.mutate(
      'POST',
      projectId,
      null,
      journalCreateV2Schema.parse(input),
      sessionId,
    );
  }
  update(
    projectId: string,
    entryId: string,
    input: JournalUpdateV2,
    sessionId: string,
  ) {
    return this.mutate(
      'PATCH',
      projectId,
      entryId,
      journalUpdateV2Schema.parse(input),
      sessionId,
    );
  }
  delete(
    projectId: string,
    entryId: string,
    input: JournalDeleteV2,
    sessionId: string,
  ) {
    return this.mutate(
      'DELETE',
      projectId,
      entryId,
      journalDeleteV2Schema.parse(input),
      sessionId,
    );
  }
  private mutate(
    method: 'POST' | 'PATCH' | 'DELETE',
    projectId: string,
    entryId: string | null,
    input: JournalCreateV2 | JournalUpdateV2 | JournalDeleteV2,
    sessionId: string,
  ): JournalMutationV2 {
    uuidSchema.parse(projectId);
    if (entryId !== null) uuidSchema.parse(entryId);
    const payload = canonical({ method, projectId, entryId, input });
    return this.db
      .transaction(() => {
        const existing = this.db
          .prepare(
            'SELECT projectId,sessionId,payload,response,responseSha256,contractVersion FROM journal_operations WHERE operationId=?',
          )
          .get(input.operationId) as
          | {
              projectId: string;
              sessionId: string;
              payload: string;
              response: string;
              responseSha256: string;
              contractVersion: number;
            }
          | undefined;
        if (existing) {
          if (
            existing.projectId !== projectId ||
            existing.sessionId !== sessionId ||
            existing.payload !== payload
          )
            throw new DomainError(
              'OPERATION_REUSED',
              'Идентификатор операции уже использован.',
              409,
            );
          if (
            existing.contractVersion !== 2 ||
            !/^[a-f0-9]{64}$/.test(existing.responseSha256) ||
            createHash('sha256').update(existing.response).digest('hex') !==
              existing.responseSha256
          )
            throw Error('Invalid internal journal2 replay');
          const result = internal(
            journalMutationV2Schema,
            JSON.parse(existing.response),
          );
          if (
            result.projectId !== projectId ||
            result.journalRevision !== input.expectedJournalRevision + 1
          )
            throw Error('Invalid internal journal2 replay scope');
          if (method === 'DELETE') {
            if (result.kind !== 'deleted' || result.deletedEntryId !== entryId)
              throw Error('Invalid internal journal2 replay scope');
          } else if (
            result.kind !== 'saved' ||
            !('content' in input) ||
            result.entry.projectId !== projectId ||
            result.entry.workDate !== input.workDate ||
            canonical(result.entry.content) !== canonical(input.content) ||
            (method === 'PATCH' && result.entry.id !== entryId) ||
            (method === 'POST' &&
              result.entry.taskId !==
                ('taskId' in input ? input.taskId : undefined))
          )
            throw Error('Invalid internal journal2 replay scope');
          return result;
        }
        if (
          !this.db.prepare('SELECT id FROM projects WHERE id=?').get(projectId)
        )
          throw new DomainError('PROJECT_NOT_FOUND', 'Проект не найден.', 404);
        const state = this.db
          .prepare('SELECT revision FROM journal_state WHERE projectId=?')
          .get(projectId) as { revision: number } | undefined;
        if (
          !state ||
          !Number.isSafeInteger(state.revision) ||
          state.revision < 0
        )
          throw Error('Invalid internal journal2 state');
        let previous: JournalEntryV2 | undefined;
        if (method === 'POST') {
          if (!('taskId' in input)) throw Error('Invalid journal2 method');
          if (
            !this.db
              .prepare('SELECT id FROM tasks WHERE projectId=? AND id=?')
              .get(projectId, input.taskId)
          )
            throw new DomainError('TASK_NOT_FOUND', 'Задача не найдена.', 404);
        } else previous = this.getEntry(projectId, entryId!).entry;
        if (state.revision !== input.expectedJournalRevision)
          throw new DomainError(
            'JOURNAL_REVISION_CONFLICT',
            'Ревизия журнала изменилась. Обновите список.',
            409,
          );
        const journalRevision = state.revision + 1;
        if (!Number.isSafeInteger(journalRevision))
          throw Error('Invalid journal2 revision');
        let result: JournalMutationV2;
        if (method === 'DELETE') {
          this.db
            .prepare('DELETE FROM journal_entries WHERE projectId=? AND id=?')
            .run(projectId, entryId);
          result = {
            journalContractVersion: 2,
            kind: 'deleted',
            projectId,
            journalRevision,
            deletedEntryId: entryId!,
          };
        } else {
          if (!('content' in input)) throw Error('Invalid journal2 method');
          const timestamp = new Date(this.now()).toISOString();
          const scope = {
            id: previous?.id ?? randomUUID(),
            projectId,
            taskId: previous?.taskId ?? ('taskId' in input ? input.taskId : ''),
          };
          const content = journalContentSchema.parse(input.content);
          const media = this.media
            .metadataForContent(scope, content, sessionId)
            .sort((a, b) => a.id.localeCompare(b.id));
          const entry = internal(journalEntryV2Schema, {
            ...scope,
            workDate: input.workDate,
            body: projectJournalContent(content, media),
            createdAt: previous?.createdAt ?? timestamp,
            updatedAt: timestamp,
            content,
            media,
          });
          const row = {
            id: entry.id,
            projectId,
            taskId: entry.taskId,
            workDate: entry.workDate,
            body: entry.body,
            createdAt: entry.createdAt,
            updatedAt: entry.updatedAt,
            contentJson: JSON.stringify(content),
          };
          if (method === 'POST')
            this.db
              .prepare(
                'INSERT INTO journal_entries(id,projectId,taskId,workDate,body,createdAt,updatedAt,contentJson) VALUES (@id,@projectId,@taskId,@workDate,@body,@createdAt,@updatedAt,@contentJson)',
              )
              .run(row);
          else
            this.db
              .prepare(
                'UPDATE journal_entries SET workDate=@workDate,body=@body,updatedAt=@updatedAt,contentJson=@contentJson WHERE projectId=@projectId AND id=@id',
              )
              .run(row);
          this.media.attach(scope, content, sessionId);
          result = {
            journalContractVersion: 2,
            kind: 'saved',
            projectId,
            journalRevision,
            entry,
          };
        }
        this.db
          .prepare('UPDATE journal_state SET revision=? WHERE projectId=?')
          .run(journalRevision, projectId);
        result = internal(journalMutationV2Schema, result);
        const response = JSON.stringify(result);
        this.db
          .prepare(
            'INSERT INTO journal_operations(operationId,projectId,sessionId,payload,response,responseSha256,contractVersion) VALUES (?,?,?,?,?,?,2)',
          )
          .run(
            input.operationId,
            projectId,
            sessionId,
            payload,
            response,
            createHash('sha256').update(response).digest('hex'),
          );
        return result;
      })
      .immediate();
  }
}
