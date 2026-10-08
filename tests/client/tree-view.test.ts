import { expect, it } from 'vitest';
import { treeRows } from '../../src/client/tree-view.js';
import { task } from './fixtures.js';

it('projects a 5000-level subtree without a depth limit or replacing source objects', () => {
  const tasks = Array.from({ length: 5000 }, (_, index) =>
    task(index + 1, {
      parentId: index === 0 ? null : task(index).id,
    }),
  );
  const rows = treeRows(
    [...tasks, task(6000)],
    new Set([tasks[0]!.id]),
    tasks[0]!.id,
  );
  expect(rows).toHaveLength(4999);
  expect(rows[0]).toMatchObject({ depth: 0, hasChildren: true });
  expect(rows.at(-1)).toMatchObject({ depth: 4998, hasChildren: false });
  expect(rows[0]!.task).toBe(tasks[1]);
  expect(rows.at(-1)!.task).toBe(tasks.at(-1));
  expect(rows[0]!.task.parentId).toBe(tasks[0]!.id);
});

it('keeps literal subtree order, collapse and real parents without exposing another branch', () => {
  const root = task(1);
  const branch = task(2, { parentId: root.id });
  const leaf = task(3, { parentId: branch.id });
  const sibling = task(4, { parentId: root.id });
  const outside = task(5);
  const tasks = [
    sibling,
    task(6, { parentId: outside.id }),
    leaf,
    outside,
    branch,
    root,
  ];
  expect(
    treeRows(tasks, new Set(), root.id).map(({ task, depth }) => [
      task.id,
      depth,
    ]),
  ).toEqual([
    [branch.id, 0],
    [leaf.id, 1],
    [sibling.id, 0],
  ]);
  expect(
    treeRows(tasks, new Set([branch.id]), root.id).map(({ task, depth }) => [
      task.id,
      depth,
    ]),
  ).toEqual([
    [branch.id, 0],
    [sibling.id, 0],
  ]);
  expect(branch.parentId).toBe(root.id);
});
