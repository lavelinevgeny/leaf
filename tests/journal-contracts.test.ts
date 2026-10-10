import { expect, it } from 'vitest';
import {
  journalCreateSchema,
  journalEntrySchema,
  journalMutationSchema,
  journalProjectQuerySchema,
  journalTaskQuerySchema,
} from '../src/shared/journal-contracts.js';
const id = '11111111-1111-4111-8111-111111111111';
const create = {
  journalContractVersion: 1,
  operationId: id,
  expectedJournalRevision: 0,
  taskId: id,
  workDate: '2024-02-29',
  body: '  Text\n  ',
};
it('validates strict bodies, dates and safe revisions preserving submitted text', () => {
  expect(journalCreateSchema.parse(create)).toEqual(create);
  for (const body of ['', ' \n\t ', 'x'.repeat(10001), '😀'.repeat(5001)])
    expect(journalCreateSchema.safeParse({ ...create, body }).success).toBe(
      false,
    );
  for (const workDate of ['0001-01-01', '9999-12-31', '2000-02-29'])
    expect(journalCreateSchema.safeParse({ ...create, workDate }).success).toBe(
      true,
    );
  for (const workDate of [
    '0000-01-01',
    '1900-02-29',
    '2023-02-29',
    '2024-2-29',
  ])
    expect(journalCreateSchema.safeParse({ ...create, workDate }).success).toBe(
      false,
    );
  expect(
    journalCreateSchema.safeParse({ ...create, body: 'x'.repeat(10000) })
      .success,
  ).toBe(true);
  for (const expectedJournalRevision of [-1, 1.5, Number.MAX_SAFE_INTEGER + 1])
    expect(
      journalCreateSchema.safeParse({ ...create, expectedJournalRevision })
        .success,
    ).toBe(false);
  expect(
    journalCreateSchema.safeParse({
      ...create,
      createdAt: '2026-01-01T00:00:00.000Z',
    }).success,
  ).toBe(false);
});
it('requires canonical UTC timestamps and exclusive success union', () => {
  const entry = {
    id,
    projectId: id,
    taskId: id,
    workDate: '2024-02-29',
    body: 'Text',
    createdAt: '2026-10-10T12:00:00.000Z',
    updatedAt: '2026-10-10T12:00:00.000Z',
  };
  expect(journalEntrySchema.safeParse(entry).success).toBe(true);
  for (const createdAt of [
    '2026-10-10T12:00:00Z',
    '2026-10-10T12:00:00.000+00:00',
    '2026-02-30T12:00:00.000Z',
  ])
    expect(journalEntrySchema.safeParse({ ...entry, createdAt }).success).toBe(
      false,
    );
  expect(
    journalMutationSchema.safeParse({
      journalContractVersion: 1,
      kind: 'saved',
      projectId: id,
      journalRevision: 1,
      entry,
      deletedEntryId: id,
    }).success,
  ).toBe(false);
});
it('parses strict HTTP queries and normalizes Russian/NFC literal substring', () => {
  expect(
    journalProjectQuerySchema.parse({ q: ' ЁЕ\u0308 ', limit: '50' }),
  ).toEqual({ q: 'ёё', limit: 50 });
  for (const limit of ['', '0', '101', '1.5', '+1', '-1', '1e1', ' 2'])
    expect(journalProjectQuerySchema.safeParse({ limit }).success).toBe(false);
  expect(
    journalProjectQuerySchema.safeParse({
      from: '2024-03-01',
      to: '2024-02-29',
    }).success,
  ).toBe(false);
  expect(journalProjectQuerySchema.safeParse({ status: 'done' }).success).toBe(
    false,
  );
  expect(journalTaskQuerySchema.safeParse({ q: 'text' }).success).toBe(false);
});
it('limits normalized query UTF-16 units including lowercasing expansion', () => {
  expect(
    journalProjectQuerySchema.safeParse({ q: '😀'.repeat(151) }).success,
  ).toBe(false);
  expect(
    journalProjectQuerySchema.safeParse({ q: 'İ'.repeat(151) }).success,
  ).toBe(false);
  expect(
    journalProjectQuerySchema.safeParse({ q: 'İ'.repeat(150) }).success,
  ).toBe(true);
});
it('preserves valid NUL and surrogate pairs while rejecting malformed body/query Unicode', () => {
  const body = '\0Synthetic\u0001\n😀';
  expect(journalCreateSchema.parse({ ...create, body }).body).toBe(body);
  for (const malformed of ['\ud800', '\udfff', 'A\ud800B', '\udc00\ud800']) {
    expect(
      journalCreateSchema.safeParse({ ...create, body: malformed }).success,
    ).toBe(false);
    expect(journalProjectQuerySchema.safeParse({ q: malformed }).success).toBe(
      false,
    );
  }
  expect(journalProjectQuerySchema.parse({ q: '😀' })).toEqual({ q: '😀' });
});
