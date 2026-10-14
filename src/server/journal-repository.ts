import type Database from 'better-sqlite3';
import { createHash, randomUUID } from 'node:crypto';
import { z } from 'zod';
import { canonical } from '../shared/canonical.js';
import { calendarDateSchema, uuidSchema } from '../shared/contracts.js';
import { DomainError } from '../domain/tree.js';
import {
  journalCreateSchema,
  journalUpdateSchema,
  journalDeleteSchema,
  journalEntrySchema,
  journalMutationSchema,
  journalPageSchema,
  journalEntryReadSchema,
  type JournalEntry,
  type JournalCreate,
  type JournalUpdate,
  type JournalDelete,
  type JournalMutation,
  type JournalPage,
  type JournalEntryRead,
  type JournalProjectQuery,
  type JournalTaskQuery,
} from '../shared/journal-contracts.js';
const wellFormed = (value: string) =>
  !/[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/.test(
    value,
  );
const normalizeJournalQuery = (value: string) =>
  value.trim().normalize('NFC').toLocaleLowerCase('ru');
export interface JournalRepositoryContract {
  getProjectPage(projectId: string, query: JournalProjectQuery): JournalPage;
  getTaskPage(
    projectId: string,
    taskId: string,
    query: JournalTaskQuery,
  ): JournalPage;
  getEntry(projectId: string, entryId: string): JournalEntryRead;
  create(
    projectId: string,
    input: JournalCreate,
    sessionId: string,
  ): JournalMutation;
  update(
    projectId: string,
    entryId: string,
    input: JournalUpdate,
    sessionId: string,
  ): JournalMutation;
  delete(
    projectId: string,
    entryId: string,
    input: JournalDelete,
    sessionId: string,
  ): JournalMutation;
}
const revisionSchema = z
  .number()
  .int()
  .nonnegative()
  .max(Number.MAX_SAFE_INTEGER);
const queryShape = {
  limit: z.number().int().min(1).max(100).optional(),
  cursor: z.string().min(1).max(4096).optional(),
};
const taskQuerySchema = z.strictObject(queryShape);
const projectQuerySchema = z
  .strictObject({
    ...queryShape,
    q: z
      .string()
      .refine(wellFormed, 'Invalid Unicode')
      .max(300)
      .refine((value) => value.length <= 300)
      .transform(normalizeJournalQuery)
      .refine((value) => value.length <= 300)
      .optional(),
    from: calendarDateSchema.optional(),
    to: calendarDateSchema.optional(),
  })
  .refine((v) => !v.from || !v.to || v.from <= v.to);
const cursorSchema = z.strictObject({
  version: z.literal(1),
  projectId: uuidSchema,
  taskId: uuidSchema.nullable(),
  q: z
    .string()
    .refine(wellFormed, 'Invalid Unicode')
    .max(300)
    .refine((value) => value.length <= 300),
  from: calendarDateSchema.nullable(),
  to: calendarDateSchema.nullable(),
  limit: z.number().int().min(1).max(100),
  journalRevision: revisionSchema,
  projectRevision: revisionSchema,
  last: z.strictObject({
    workDate: calendarDateSchema,
    createdAt: journalEntrySchema.shape.createdAt,
    id: uuidSchema,
  }),
});
export type JournalCursor = z.infer<typeof cursorSchema>;
const columns = 'id,projectId,taskId,workDate,body,createdAt,updatedAt';
function invalidCursor(): never {
  throw new DomainError('INVALID_REQUEST', 'Проверьте поля запроса.');
}
function validated<T>(schema: z.ZodType<T>, value: unknown): T {
  const parsed = schema.safeParse(value);
  if (!parsed.success) throw new Error('Invalid internal journal data');
  return parsed.data;
}
export class JournalRepository implements JournalRepositoryContract {
  constructor(
    private readonly db: Database.Database,
    private readonly now: () => number = Date.now,
  ) {
    db.function(
      'leaf_journal_contains',
      { deterministic: true },
      (value, query) =>
        String(value)
          .normalize('NFC')
          .toLocaleLowerCase('ru')
          .includes(String(query))
          ? 1
          : 0,
    );
  }
  private revisions(projectId: string) {
    const project = this.db
      .prepare('SELECT revision FROM projects WHERE id=?')
      .get(projectId) as { revision: number } | undefined;
    if (!project)
      throw new DomainError('PROJECT_NOT_FOUND', 'Проект не найден.', 404);
    const state = this.db
      .prepare('SELECT revision FROM journal_state WHERE projectId=?')
      .get(projectId) as { revision: number } | undefined;
    if (!state) throw new Error('Missing internal journal state');
    return {
      projectRevision: validated(revisionSchema, project.revision),
      journalRevision: validated(revisionSchema, state.revision),
    };
  }
  private task(projectId: string, taskId: string) {
    if (
      !this.db
        .prepare('SELECT id FROM tasks WHERE projectId=? AND id=?')
        .get(projectId, taskId)
    )
      throw new DomainError('TASK_NOT_FOUND', 'Задача не найдена.', 404);
  }
  private entry(projectId: string, entryId: string): JournalEntry {
    const row = this.db
      .prepare(
        `SELECT ${columns} FROM journal_entries WHERE projectId=? AND id=?`,
      )
      .get(projectId, entryId);
    if (!row)
      throw new DomainError(
        'JOURNAL_ENTRY_NOT_FOUND',
        'Запись не найдена.',
        404,
      );
    return validated(journalEntrySchema, row);
  }
  getEntry(projectId: string, entryId: string): JournalEntryRead {
    uuidSchema.parse(projectId);
    uuidSchema.parse(entryId);
    return this.db.transaction(() =>
      validated(journalEntryReadSchema, {
        journalContractVersion: 1,
        projectId,
        ...this.revisions(projectId),
        entry: this.entry(projectId, entryId),
      }),
    )();
  }
  getProjectPage(projectId: string, query: JournalProjectQuery): JournalPage {
    return this.page(projectId, null, projectQuerySchema.parse(query));
  }
  getTaskPage(
    projectId: string,
    taskId: string,
    query: JournalTaskQuery,
  ): JournalPage {
    uuidSchema.parse(taskId);
    return this.page(projectId, taskId, taskQuerySchema.parse(query));
  }
  private page(
    projectId: string,
    taskId: string | null,
    query: z.infer<typeof projectQuerySchema>,
  ): JournalPage {
    uuidSchema.parse(projectId);
    return this.db.transaction(() => {
      const revisions = this.revisions(projectId);
      if (taskId !== null) this.task(projectId, taskId);
      const scope = {
        projectId,
        taskId,
        q: query.q ?? '',
        from: query.from ?? null,
        to: query.to ?? null,
        limit: query.limit ?? 50,
      };
      let cursor: JournalCursor | undefined;
      if (query.cursor) {
        if (!/^[A-Za-z0-9_-]+$/.test(query.cursor)) invalidCursor();
        try {
          const decoded = Buffer.from(query.cursor, 'base64url');
          if (decoded.toString('base64url') !== query.cursor) invalidCursor();
          const parsed = cursorSchema.safeParse(
            JSON.parse(
              new TextDecoder('utf-8', { fatal: true }).decode(decoded),
            ),
          );
          if (!parsed.success) invalidCursor();
          cursor = parsed.data;
        } catch {
          invalidCursor();
        }
        for (const key of [
          'projectId',
          'taskId',
          'q',
          'from',
          'to',
          'limit',
        ] as const)
          if (cursor[key] !== scope[key]) invalidCursor();
        if (
          cursor.journalRevision !== revisions.journalRevision ||
          cursor.projectRevision !== revisions.projectRevision
        )
          throw new DomainError(
            'JOURNAL_CURSOR_STALE',
            'Журнал изменился. Обновите список.',
            409,
          );
      }
      const predicates = ['e.projectId=?'];
      const args: (string | number)[] = [projectId];
      if (taskId !== null) {
        predicates.push('e.taskId=?');
        args.push(taskId);
      }
      if (scope.q) {
        predicates.push(
          '(leaf_journal_contains(e.body,?) OR leaf_journal_contains(t.title,?))',
        );
        args.push(scope.q, scope.q);
      }
      if (scope.from) {
        predicates.push('e.workDate>=?');
        args.push(scope.from);
      }
      if (scope.to) {
        predicates.push('e.workDate<=?');
        args.push(scope.to);
      }
      if (cursor) {
        predicates.push('(e.workDate,e.createdAt,e.id)<(?,?,?)');
        args.push(cursor.last.workDate, cursor.last.createdAt, cursor.last.id);
      }
      args.push(scope.limit + 1);
      const rows = this.db
        .prepare(
          `SELECT ${columns
            .split(',')
            .map((c) => `e.${c}`)
            .join(
              ',',
            )} FROM journal_entries e JOIN tasks t ON t.projectId=e.projectId AND t.id=e.taskId WHERE ${predicates.join(' AND ')} ORDER BY e.workDate DESC,e.createdAt DESC,e.id DESC LIMIT ?`,
        )
        .all(...args)
        .map((row) => validated(journalEntrySchema, row));
      const entries = rows.slice(0, scope.limit);
      const last = entries.at(-1);
      let nextCursor: string | null = null;
      if (rows.length > scope.limit && last)
        nextCursor = Buffer.from(
          canonical(
            validated(cursorSchema, {
              version: 1,
              ...scope,
              ...revisions,
              last: {
                workDate: last.workDate,
                createdAt: last.createdAt,
                id: last.id,
              },
            }),
          ),
        ).toString('base64url');
      return validated(journalPageSchema, {
        journalContractVersion: 1,
        projectId,
        taskId,
        ...revisions,
        entries,
        nextCursor,
      });
    })();
  }
  create(
    projectId: string,
    input: JournalCreate,
    sessionId: string,
  ): JournalMutation {
    return this.mutate(
      'POST',
      projectId,
      null,
      journalCreateSchema.parse(input),
      sessionId,
    );
  }
  update(
    projectId: string,
    entryId: string,
    input: JournalUpdate,
    sessionId: string,
  ): JournalMutation {
    return this.mutate(
      'PATCH',
      projectId,
      entryId,
      journalUpdateSchema.parse(input),
      sessionId,
    );
  }
  delete(
    projectId: string,
    entryId: string,
    input: JournalDelete,
    sessionId: string,
  ): JournalMutation {
    return this.mutate(
      'DELETE',
      projectId,
      entryId,
      journalDeleteSchema.parse(input),
      sessionId,
    );
  }
  private mutate(
    method: 'POST' | 'PATCH' | 'DELETE',
    projectId: string,
    entryId: string | null,
    input: JournalCreate | JournalUpdate | JournalDelete,
    sessionId: string,
  ): JournalMutation {
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
            existing.contractVersion !== 1 ||
            !/^[a-f0-9]{64}$/.test(existing.responseSha256) ||
            createHash('sha256').update(existing.response).digest('hex') !==
              existing.responseSha256
          )
            throw new Error('Invalid internal journal replay');
          let result: JournalMutation;
          try {
            result = validated(
              journalMutationSchema,
              JSON.parse(existing.response),
            );
          } catch {
            throw new Error('Invalid internal journal replay');
          }
          if (
            result.projectId !== projectId ||
            result.journalRevision !== input.expectedJournalRevision + 1
          )
            throw new Error('Invalid internal journal replay scope');
          if (method === 'DELETE') {
            if (result.kind !== 'deleted' || result.deletedEntryId !== entryId)
              throw new Error('Invalid internal journal replay scope');
          } else {
            if (
              result.kind !== 'saved' ||
              result.entry.projectId !== projectId ||
              result.entry.workDate !==
                ('workDate' in input ? input.workDate : undefined) ||
              result.entry.body !==
                ('body' in input ? input.body : undefined) ||
              (method === 'PATCH' && result.entry.id !== entryId) ||
              (method === 'POST' &&
                result.entry.taskId !==
                  ('taskId' in input ? input.taskId : undefined))
            )
              throw new Error('Invalid internal journal replay scope');
          }
          return result;
        }
        const revisions = this.revisions(projectId);
        let previous: JournalEntry | undefined;
        if (method === 'POST') {
          if (!('taskId' in input)) throw new Error('Invalid journal method');
          this.task(projectId, input.taskId);
        } else previous = this.entry(projectId, entryId!);
        if (input.expectedJournalRevision !== revisions.journalRevision)
          throw new DomainError(
            'JOURNAL_REVISION_CONFLICT',
            'Ревизия журнала изменилась. Обновите список.',
            409,
          );
        const journalRevision = validated(
          revisionSchema,
          revisions.journalRevision + 1,
        );
        let result: JournalMutation;
        if (method === 'DELETE') {
          this.db
            .prepare('DELETE FROM journal_entries WHERE projectId=? AND id=?')
            .run(projectId, entryId);
          result = {
            journalContractVersion: 1,
            kind: 'deleted',
            projectId,
            journalRevision,
            deletedEntryId: entryId!,
          };
        } else {
          if (!('body' in input)) throw new Error('Invalid journal method');
          const timestamp = new Date(this.now()).toISOString();
          const entry = validated(journalEntrySchema, {
            id: previous?.id ?? randomUUID(),
            projectId,
            taskId:
              previous?.taskId ??
              ('taskId' in input ? input.taskId : undefined),
            workDate: input.workDate,
            body: input.body,
            createdAt: previous?.createdAt ?? timestamp,
            updatedAt: timestamp,
          });
          if (method === 'POST')
            this.db
              .prepare(
                `INSERT INTO journal_entries(${columns}) VALUES (@id,@projectId,@taskId,@workDate,@body,@createdAt,@updatedAt)`,
              )
              .run(entry);
          else
            this.db
              .prepare(
                'UPDATE journal_entries SET workDate=@workDate,body=@body,updatedAt=@updatedAt WHERE projectId=@projectId AND id=@id',
              )
              .run(entry);
          result = {
            journalContractVersion: 1,
            kind: 'saved',
            projectId,
            journalRevision,
            entry,
          };
        }
        this.db
          .prepare('UPDATE journal_state SET revision=? WHERE projectId=?')
          .run(journalRevision, projectId);
        result = validated(journalMutationSchema, result);
        const response = JSON.stringify(result);
        this.db
          .prepare(
            'INSERT INTO journal_operations(operationId,projectId,sessionId,payload,response,responseSha256,contractVersion) VALUES (?,?,?,?,?,?,1)',
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
