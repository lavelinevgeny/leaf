import { expect, it } from 'vitest';
import {
  openEditDraft,
  mergeJournalPages,
  journalTaskPath,
} from '../../src/client/journal-state.js';
import { journal5, page5 } from './journal-fixtures.js';
import { task } from './fixtures.js';
it('reopening pins the first baseline and preserves own text', () => {
  const first = openEditDraft(undefined, journal5, 5);
  const own = { ...first, body: 'Own draft', dirty: true };
  expect(openEditDraft(own, { ...journal5, body: 'Remote' }, 6)).toBe(own);
  expect(own.baselineEntry).toEqual(journal5);
  expect(own.baselineJournalRevision).toBe(5);
  expect(first.baselineEntry).not.toBe(journal5);
});
it('merges matching pages without duplicate IDs, rejecting mixed revisions', () => {
  expect(mergeJournalPages(page5, page5).entries).toEqual([journal5]);
  expect(() =>
    mergeJournalPages(page5, { ...page5, journalRevision: 6 }),
  ).toThrow();
});
it('builds the complete ancestor path', () =>
  expect(
    journalTaskPath([task(1), task(2, { parentId: task(1).id })], task(2).id),
  ).toBe('Работа 1 / Работа 2'));
