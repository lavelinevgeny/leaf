import { z } from 'zod';
import { calendarDateSchema, uuidSchema } from './contracts.js';
const revision = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER);
const journalTimestampSchema = z.iso.datetime().refine((value) => {
  const date = new Date(value);
  return Number.isFinite(date.getTime()) && date.toISOString() === value;
}, 'Invalid UTC timestamp');
const wellFormed = (value: string) =>
  !/[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/.test(
    value,
  );
const body = z
  .string()
  .refine(wellFormed, 'Invalid Unicode')
  .min(1)
  .max(10000)
  .refine((value) => value.length <= 10000, 'Body too long')
  .refine((value) => value.trim().length > 0, 'Empty body');
export const journalEntrySchema = z.strictObject({
  id: uuidSchema,
  projectId: uuidSchema,
  taskId: uuidSchema,
  workDate: calendarDateSchema,
  body,
  createdAt: journalTimestampSchema,
  updatedAt: journalTimestampSchema,
});
const envelope = {
  journalContractVersion: z.literal(1),
  operationId: uuidSchema,
  expectedJournalRevision: revision,
};
export const journalCreateSchema = z.strictObject({
  ...envelope,
  taskId: uuidSchema,
  workDate: calendarDateSchema,
  body,
});
export const journalUpdateSchema = z.strictObject({
  ...envelope,
  workDate: calendarDateSchema,
  body,
});
export const journalDeleteSchema = z.strictObject(envelope);
const response = {
  journalContractVersion: z.literal(1),
  projectId: uuidSchema,
  journalRevision: revision,
};
export const journalMutationSchema = z.discriminatedUnion('kind', [
  z.strictObject({
    ...response,
    kind: z.literal('saved'),
    entry: journalEntrySchema,
  }),
  z.strictObject({
    ...response,
    kind: z.literal('deleted'),
    deletedEntryId: uuidSchema,
  }),
]);
export const journalPageSchema = z.strictObject({
  ...response,
  taskId: uuidSchema.nullable(),
  projectRevision: revision,
  entries: z.array(journalEntrySchema),
  nextCursor: z.string().max(4096).nullable(),
});
export const journalEntryReadSchema = z.strictObject({
  ...response,
  projectRevision: revision,
  entry: journalEntrySchema,
});
const limit = z
  .string()
  .regex(/^\d+$/)
  .transform(Number)
  .pipe(z.number().int().min(1).max(100))
  .optional();
const cursor = z.string().min(1).max(4096).optional();
const normalizeJournalQuery = (value: string) =>
  value.trim().normalize('NFC').toLocaleLowerCase('ru');
export const journalProjectQuerySchema = z
  .strictObject({
    q: z
      .string()
      .refine(wellFormed, 'Invalid Unicode')
      .max(300)
      .refine((value) => value.length <= 300, 'Query too long')
      .transform(normalizeJournalQuery)
      .refine((value) => value.length <= 300, 'Query too long')
      .optional(),
    from: calendarDateSchema.optional(),
    to: calendarDateSchema.optional(),
    limit,
    cursor,
  })
  .refine(
    (value) => !value.from || !value.to || value.from <= value.to,
    'Invalid date range',
  )
  .transform((value): JournalProjectQuery => ({
    ...(value.q === undefined ? {} : { q: value.q }),
    ...(value.from === undefined ? {} : { from: value.from }),
    ...(value.to === undefined ? {} : { to: value.to }),
    ...(value.limit === undefined ? {} : { limit: value.limit }),
    ...(value.cursor === undefined ? {} : { cursor: value.cursor }),
  }));
export const journalTaskQuerySchema = z
  .strictObject({ limit, cursor })
  .transform((value): JournalTaskQuery => ({
    ...(value.limit === undefined ? {} : { limit: value.limit }),
    ...(value.cursor === undefined ? {} : { cursor: value.cursor }),
  }));
export type JournalEntry = {
  id: string;
  projectId: string;
  taskId: string;
  workDate: string;
  body: string;
  createdAt: string;
  updatedAt: string;
};
export type JournalCreate = {
  journalContractVersion: 1;
  operationId: string;
  expectedJournalRevision: number;
  taskId: string;
  workDate: string;
  body: string;
};
export type JournalUpdate = Omit<JournalCreate, 'taskId'>;
export type JournalDelete = Pick<
  JournalCreate,
  'journalContractVersion' | 'operationId' | 'expectedJournalRevision'
>;
export type JournalMutation =
  | {
      journalContractVersion: 1;
      kind: 'saved';
      projectId: string;
      journalRevision: number;
      entry: JournalEntry;
    }
  | {
      journalContractVersion: 1;
      kind: 'deleted';
      projectId: string;
      journalRevision: number;
      deletedEntryId: string;
    };
export type JournalPage = {
  journalContractVersion: 1;
  projectId: string;
  taskId: string | null;
  journalRevision: number;
  projectRevision: number;
  entries: JournalEntry[];
  nextCursor: string | null;
};
export type JournalEntryRead = {
  journalContractVersion: 1;
  projectId: string;
  journalRevision: number;
  projectRevision: number;
  entry: JournalEntry;
};
export type JournalProjectQuery = {
  q?: string;
  from?: string;
  to?: string;
  limit?: number;
  cursor?: string;
};
export type JournalTaskQuery = { limit?: number; cursor?: string };
