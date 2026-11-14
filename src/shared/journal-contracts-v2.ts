import { z } from 'zod';
import { calendarDateSchema, uuidSchema } from './contracts.js';
import {
  collectJournalMediaIds,
  journalContentSchema,
  projectJournalContent,
} from './journal-content.js';
import {
  journalMediaSchema,
  journalUnicodeStringSchema,
} from './journal-media-contracts.js';
const revision = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER);
const timestamp = z.iso.datetime().refine((value) => {
  const date = new Date(value);
  return Number.isFinite(date.getTime()) && date.toISOString() === value;
}, 'Invalid UTC timestamp');
export const journalEntryV2Schema = z
  .strictObject({
    id: uuidSchema,
    projectId: uuidSchema,
    taskId: uuidSchema,
    workDate: calendarDateSchema,
    body: journalUnicodeStringSchema.min(1).max(10000),
    createdAt: timestamp,
    updatedAt: timestamp,
    content: journalContentSchema,
    media: z.array(journalMediaSchema).max(10),
  })
  .refine((entry) => {
    const ids = collectJournalMediaIds(entry.content);
    if (
      entry.media.length !== ids.length ||
      new Set(entry.media.map((item) => item.id)).size !== ids.length ||
      entry.media.some((item) => !ids.includes(item.id))
    )
      return false;
    try {
      return projectJournalContent(entry.content, entry.media) === entry.body;
    } catch {
      return false;
    }
  }, 'Invalid journal projection or media');
const envelope = {
  journalContractVersion: z.literal(2),
  operationId: uuidSchema,
  expectedJournalRevision: revision,
};
export const journalCreateV2Schema = z.strictObject({
  ...envelope,
  taskId: uuidSchema,
  workDate: calendarDateSchema,
  content: journalContentSchema,
});
export const journalUpdateV2Schema = z.strictObject({
  ...envelope,
  workDate: calendarDateSchema,
  content: journalContentSchema,
});
export const journalDeleteV2Schema = z.strictObject(envelope);
const response = {
  journalContractVersion: z.literal(2),
  projectId: uuidSchema,
  journalRevision: revision,
};
export const journalMutationV2Schema = z.discriminatedUnion('kind', [
  z.strictObject({
    ...response,
    kind: z.literal('saved'),
    entry: journalEntryV2Schema,
  }),
  z.strictObject({
    ...response,
    kind: z.literal('deleted'),
    deletedEntryId: uuidSchema,
  }),
]);
export const journalPageV2Schema = z.strictObject({
  ...response,
  taskId: uuidSchema.nullable(),
  projectRevision: revision,
  entries: z.array(journalEntryV2Schema),
  nextCursor: z.string().max(4096).nullable(),
});
export const journalEntryReadV2Schema = z.strictObject({
  ...response,
  projectRevision: revision,
  entry: journalEntryV2Schema,
});
export type JournalCreateV2 = z.infer<typeof journalCreateV2Schema>;
export type JournalUpdateV2 = z.infer<typeof journalUpdateV2Schema>;
export type JournalDeleteV2 = z.infer<typeof journalDeleteV2Schema>;
export type JournalEntryV2 = z.infer<typeof journalEntryV2Schema>;
export type JournalMutationV2 = z.infer<typeof journalMutationV2Schema>;
export type JournalPageV2 = z.infer<typeof journalPageV2Schema>;
export type JournalEntryReadV2 = z.infer<typeof journalEntryReadV2Schema>;
