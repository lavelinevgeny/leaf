import { describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import {
  calendarDateSchema,
  commandEnvelopeSchema,
  taskSchema,
  type Task,
} from '../src/shared/contracts.js';
import {
  assertCanMove,
  orderedChildren,
  subtreeIds,
  visibleTree,
} from '../src/domain/tree.js';

const projectId = randomUUID();
function task(id: string, parentId: string | null, sortOrder = 0): Task {
  return {
    id,
    projectId,
    parentId,
    sortOrder,
    title: 'Synthetic task',
    description: '',
    status: 'todo',

    durationDays: null,

    inputStart: null,
    inputFinish: null,
    createdAt: '2026-10-07T00:00:00.000Z',
    updatedAt: '2026-10-07T00:00:00.000Z',
  };
}
describe('calendar input boundary', () => {
  it.each([
    '2026-02-29',
    '2026-02-30',
    '2026-13-01',
    '2026-00-01',
    '2026-01-00',
    '2026-1-01',
    '0000-01-01',
    '2026-10-07T00:00:00Z',
  ])('rejects %s', (value) =>
    expect(calendarDateSchema.safeParse(value).success).toBe(false),
  );
  it.each([
    '2024-02-29',
    '2026-10-07',
    '2000-02-29',
    '0001-01-01',
    '9999-12-31',
  ])('accepts %s', (value) =>
    expect(calendarDateSchema.parse(value)).toBe(value),
  );
  it('rejects unknown command properties and invalid task dates', () => {
    expect(
      commandEnvelopeSchema.safeParse({
        contractVersion: 2 as const,
        expectedRevision: 0,
        operationId: randomUUID(),
        command: {
          type: 'task.create',
          title: 'A',
          parentId: null,
          admin: true,
        },
      }).success,
    ).toBe(false);
    expect(
      taskSchema.safeParse({
        ...task(randomUUID(), null),
        inputStart: '2026-02-30',
      }).success,
    ).toBe(false);
  });
});
describe('pure iterative tree', () => {
  it('keeps depth 40 and collapse independent from source data', () => {
    const tasks = Array.from({ length: 40 }, (_, i) =>
      task(String(i), i === 0 ? null : String(i - 1)),
    );
    const before = JSON.stringify(tasks);
    expect(visibleTree(tasks, new Set()).map((row) => row.depth)).toEqual(
      Array.from({ length: 40 }, (_, i) => i),
    );
    expect(
      visibleTree(tasks, new Set(['0'])).map((row) => row.task.id),
    ).toEqual(['0']);
    expect(JSON.stringify(tasks)).toBe(before);
  });
  it('rejects a move below a descendant without mutation', () => {
    const tasks = [task('a', null), task('b', 'a'), task('c', 'b')];
    const before = JSON.stringify(tasks);
    expect(() => assertCanMove(tasks, 'a', 'c')).toThrow();
    expect(() => assertCanMove(tasks, 'a', 'a')).toThrow();
    expect(JSON.stringify(tasks)).toBe(before);
  });
  it('orders siblings and finds exact subtree IDs', () => {
    const tasks = [
      task('c', 'b'),
      task('d', null, 1),
      task('b', 'a'),
      task('a', null, 0),
      task('e', null, 2),
    ];
    expect(orderedChildren(tasks, null).map((t) => t.id)).toEqual([
      'a',
      'd',
      'e',
    ]);
    expect([...subtreeIds(tasks, 'a')]).toEqual(['a', 'b', 'c']);
    expect(() => assertCanMove(tasks, 'b', 'missing')).toThrow();
  });
});
