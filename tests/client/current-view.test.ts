import { expect, it } from 'vitest';
import {
  currentGroups,
  defaultCurrentCollapsed,
} from '../../src/client/current-view.js';
import { task } from './fixtures.js';

it('groups the full tree using real finishes and three working days strictly after today', () => {
  const parent = task(1, { title: 'Этап', status: 'done' });
  const leaf = (n: number, finish: string | null) =>
    task(n, { parentId: parent.id, inputFinish: finish });
  const input = [
    leaf(7, null),
    leaf(6, '2026-11-12'),
    leaf(5, '2026-11-11'),
    leaf(4, '2026-11-09'),
    leaf(3, '2026-11-06'),
    leaf(2, '2026-11-05'),
    parent,
  ];
  const before = structuredClone(input);
  expect(
    currentGroups(input, 'weekdays', '2026-11-06').map((g) => [
      g.id,
      g.rows.map((r) => r.task.id),
    ]),
  ).toEqual([
    ['overdue', [task(2).id]],
    ['today', [task(3).id]],
    ['soon', [task(4).id, task(5).id]],
    ['later', [task(6).id]],
    ['undated', [task(7).id]],
  ]);
  expect(input).toEqual(before);
});
it.each([
  ['all-days', '2026-11-06', '2026-11-09', 'soon'],
  ['all-days', '2026-11-06', '2026-11-10', 'later'],
  ['weekdays', '2026-11-07', '2026-11-11', 'soon'],
  ['weekdays', '2026-11-07', '2026-11-12', 'later'],
  ['weekdays', '2026-11-07', '2026-11-07', 'today'],
  ['weekdays', '2026-11-06', '2026-11-08', 'soon'],
  ['weekdays', '9999-12-31', '9999-12-31', 'today'],
  ['weekdays', '9999-12-30', '9999-12-31', 'soon'],
  ['all-days', '9999-12-29', '9999-12-31', 'soon'],
] as const)(
  'handles %s today %s finish %s as %s',
  (calendar, today, finish, id) => {
    expect(
      currentGroups([task(1, { inputFinish: finish })], calendar, today).find(
        (g) => g.rows.length,
      )?.id,
    ).toBe(id);
  },
);
it('keeps finish-only; ignores summaries, done leaves and implied finishes; builds complete ancestor paths before filtering', () => {
  const root = task(1, {
    title: 'Этап',
    status: 'done',
    inputFinish: '2026-11-01',
  });
  const parent = task(2, { title: 'Ветка', parentId: root.id, status: 'done' });
  const input = [
    root,
    parent,
    task(3, { parentId: parent.id, inputFinish: '2026-11-06' }),
    task(4, { inputStart: '2026-11-01' }),
    task(5, { durationDays: 8 }),
    task(6, { status: 'done' }),
  ];
  const groups = currentGroups(input, 'weekdays', '2026-11-06');
  expect(groups[1]!.rows.map((r) => [r.task.id, r.path])).toEqual([
    [task(3).id, 'Этап / Ветка'],
  ]);
  expect(groups[4]!.rows.map((r) => [r.task.id, r.path])).toEqual([
    [task(4).id, 'Корень проекта'],
    [task(5).id, 'Корень проекта'],
  ]);
  expect(
    currentGroups(
      input.map((t) =>
        t.id === parent.id ? { ...t, title: 'Новое', parentId: null } : t,
      ),
      'weekdays',
      '2026-11-06',
    )[1]!.rows[0]!.path,
  ).toBe('Новое');
});
it('sorts old finishes first and equal/null finishes by preorder, sibling sortOrder then ID regardless of input order', () => {
  const input = [
    task(8, { inputFinish: '2026-11-04' }),
    task(2, { sortOrder: 1, inputFinish: '2026-11-05' }),
    task(1, { sortOrder: 1, inputFinish: '2026-11-05' }),
    task(3, { parentId: task(1).id }),
    task(4, { parentId: task(1).id, sortOrder: 3 }),
    task(7, { inputFinish: '2026-11-01' }),
    task(6),
  ];
  const expected = [
    ['overdue', [task(7).id, task(8).id, task(2).id]],
    ['today', []],
    ['soon', []],
    ['later', []],
    ['undated', [task(3).id, task(4).id, task(6).id]],
  ];
  for (const tasks of [input, [...input].reverse()])
    expect(
      currentGroups(tasks, 'weekdays', '2026-11-06').map((g) => [
        g.id,
        g.rows.map((r) => r.task.id),
      ]),
    ).toEqual(expected);
});
it('returns five empty groups and fresh collapse defaults', () => {
  expect(
    currentGroups([], 'weekdays', '2026-11-06').map((g) => g.rows),
  ).toEqual([[], [], [], [], []]);
  const defaults = defaultCurrentCollapsed();
  expect([...defaults]).toEqual(['later', 'undated']);
  defaults.clear();
  expect(defaultCurrentCollapsed().size).toBe(2);
});

it('breaks equal-date ties by complete preorder and sibling sortOrder/id', () => {
  const input = [
    task(2, { sortOrder: 1, inputFinish: '2026-11-06' }),
    task(4, { parentId: task(9).id, sortOrder: 2, inputFinish: '2026-11-06' }),
    task(1, { sortOrder: 1, inputFinish: '2026-11-06' }),
    task(9, { sortOrder: 0 }),
    task(3, { parentId: task(9).id, sortOrder: 2, inputFinish: '2026-11-06' }),
  ];
  for (const tasks of [input, [...input].reverse()])
    expect(
      currentGroups(tasks, 'weekdays', '2026-11-06')[1]!.rows.map(
        (row) => row.task.id,
      ),
    ).toEqual([task(3).id, task(4).id, task(1).id, task(2).id]);
  expect(
    currentGroups(
      [task(5, { inputStart: '2026-11-02', durationDays: 2 })],
      'weekdays',
      '2026-11-06',
    )[4]!.rows.map((row) => row.task.id),
  ).toEqual([task(5).id]);
});
