import { describe, expect, it } from 'vitest';
import { filterTasks } from '../../src/client/task-filter.js';
import { treeRows } from '../../src/client/tree-view.js';
import { task } from './fixtures.js';

describe('task filtering preserves full parent context', () => {
  const root = task(1, { title: 'Этап', status: 'done' });
  const group = task(2, { title: 'Группа', parentId: root.id });
  const leaf = task(3, {
    title: 'Монтаж A',
    parentId: group.id,
    status: 'doing',
  });
  const sibling = task(4, { title: 'Монтаж B', parentId: root.id });
  const other = task(5, { title: 'Другой этап', status: 'doing' });
  const tasks = [sibling, leaf, other, root, group];

  it('combines trimmed case-insensitive title and status with AND', () => {
    const result = filterTasks(tasks, { query: ' МОНТАЖ ', status: 'doing' });
    expect(result.active).toBe(true);
    expect([...result.matchIds]).toEqual([leaf.id]);
    expect(result.tasks).toEqual([leaf, root, group]);
    expect(
      treeRows(result.tasks, new Set()).map((row) => [row.task.id, row.depth]),
    ).toEqual([
      [root.id, 0],
      [group.id, 1],
      [leaf.id, 2],
    ]);
  });

  it('retains source objects and never changes task data or input ordering', () => {
    const before = structuredClone(tasks);
    const result = filterTasks(tasks, { query: 'монтаж', status: 'all' });
    expect(result.tasks).toEqual([sibling, leaf, root, group]);
    for (const selected of result.tasks)
      expect(selected).toBe(
        tasks.find((candidate) => candidate.id === selected.id),
      );
    expect(tasks).toEqual(before);
    expect([...result.matchIds]).toEqual([sibling.id, leaf.id]);
  });

  it('counts direct parent matches without including nonmatching children', () => {
    const result = filterTasks(tasks, { query: 'ГРУППА', status: 'all' });
    expect(result.tasks).toEqual([root, group]);
    expect([...result.matchIds]).toEqual([group.id]);
  });

  it('filters status independently and preserves ancestors with a different status', () => {
    const result = filterTasks(tasks, { query: '', status: 'doing' });
    expect(result.tasks).toEqual([leaf, other, root, group]);
    expect([...result.matchIds]).toEqual([leaf.id, other.id]);
    expect(
      filterTasks(tasks, { query: 'Монтаж', status: 'done' }).tasks,
    ).toEqual([]);
  });

  it('treats whitespace as inactive and retains the original task array', () => {
    const result = filterTasks(tasks, { query: ' \t\n ', status: 'all' });
    expect(result.active).toBe(false);
    expect(result.tasks).toBe(tasks);
    expect(result.matchIds.size).toBe(5);
  });

  it('matches canonically equivalent Unicode and literal punctuation', () => {
    const unicode = task(6, { title: 'Café [A].*' });
    expect(
      filterTasks([unicode], { query: 'CAFE\u0301', status: 'all' }).tasks,
    ).toEqual([unicode]);
    expect(
      filterTasks([unicode], { query: '[A].*', status: 'all' }).tasks,
    ).toEqual([unicode]);
    expect(
      filterTasks([unicode], { query: '^.*$', status: 'all' }).tasks,
    ).toEqual([]);
  });

  it('handles empty projects and missing matches', () => {
    expect(filterTasks([], { query: '', status: 'all' }).matchIds.size).toBe(0);
    const result = filterTasks(tasks, {
      query: 'Нет совпадений',
      status: 'all',
    });
    expect(result.active).toBe(true);
    expect(result.tasks).toEqual([]);
    expect(result.matchIds.size).toBe(0);
  });

  it('retains an arbitrary-depth chain iteratively', () => {
    const chain = Array.from({ length: 5_000 }, (_, index) =>
      task(index + 1, {
        parentId: index ? task(index).id : null,
        title: index === 4_999 ? 'Needle' : `Group ${index}`,
      }),
    );
    const result = filterTasks(chain, { query: 'needle', status: 'todo' });
    expect(result.tasks).toHaveLength(5_000);
    expect([...result.matchIds]).toEqual([chain[4_999]!.id]);
    expect(result.tasks[0]).toBe(chain[0]);
    expect(result.tasks[4_999]).toBe(chain[4_999]);
  });
});
