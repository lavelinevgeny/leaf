import { describe, expect, it } from 'vitest';
import { filterTasks, taskStatuses } from '../../src/client/task-filter.js';
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

  it('unions selected statuses, intersects search and retains parent context', () => {
    const result = filterTasks(tasks, {
      query: 'монтаж',
      statuses: ['todo', 'doing'],
    });
    expect([...result.matchIds]).toEqual([sibling.id, leaf.id]);
    expect(result.tasks).toEqual([sibling, leaf, root, group]);
    expect(result.active).toBe(true);
  });

  it('treats no selected statuses as no matches and all selected as inactive', () => {
    const none = filterTasks(tasks, { query: '', statuses: [] });
    expect(none.active).toBe(true);
    expect(none.matchIds.size).toBe(0);
    expect(none.tasks).toEqual([]);
    const all = filterTasks(tasks, { query: '', statuses: taskStatuses });
    expect(all.active).toBe(false);
    expect(all.tasks).toBe(tasks);
  });

  it('combines trimmed case-insensitive title and status with AND', () => {
    const result = filterTasks(tasks, {
      query: ' МОНТАЖ ',
      statuses: ['doing'],
    });
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
    const result = filterTasks(tasks, {
      query: 'монтаж',
      statuses: taskStatuses,
    });
    expect(result.tasks).toEqual([sibling, leaf, root, group]);
    for (const selected of result.tasks)
      expect(selected).toBe(
        tasks.find((candidate) => candidate.id === selected.id),
      );
    expect(tasks).toEqual(before);
    expect([...result.matchIds]).toEqual([sibling.id, leaf.id]);
  });

  it('counts direct parent matches without including nonmatching children', () => {
    const result = filterTasks(tasks, {
      query: 'ГРУППА',
      statuses: taskStatuses,
    });
    expect(result.tasks).toEqual([root, group]);
    expect([...result.matchIds]).toEqual([group.id]);
  });

  it('filters status independently and preserves ancestors with a different status', () => {
    const result = filterTasks(tasks, { query: '', statuses: ['doing'] });
    expect(result.tasks).toEqual([leaf, other, root, group]);
    expect([...result.matchIds]).toEqual([leaf.id, other.id]);
    expect(
      filterTasks(tasks, { query: 'Монтаж', statuses: ['done'] }).tasks,
    ).toEqual([]);
  });

  it('treats whitespace as inactive and retains the original task array', () => {
    const result = filterTasks(tasks, {
      query: ' \t\n ',
      statuses: taskStatuses,
    });
    expect(result.active).toBe(false);
    expect(result.tasks).toBe(tasks);
    expect(result.matchIds.size).toBe(5);
  });

  it('matches canonically equivalent Unicode and literal punctuation', () => {
    const unicode = task(6, { title: 'Café [A].*' });
    expect(
      filterTasks([unicode], { query: 'CAFE\u0301', statuses: taskStatuses })
        .tasks,
    ).toEqual([unicode]);
    expect(
      filterTasks([unicode], { query: '[A].*', statuses: taskStatuses }).tasks,
    ).toEqual([unicode]);
    expect(
      filterTasks([unicode], { query: '^.*$', statuses: taskStatuses }).tasks,
    ).toEqual([]);
  });

  it('handles empty projects and missing matches', () => {
    expect(
      filterTasks([], { query: '', statuses: taskStatuses }).matchIds.size,
    ).toBe(0);
    const result = filterTasks(tasks, {
      query: 'Нет совпадений',
      statuses: taskStatuses,
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
    const result = filterTasks(chain, { query: 'needle', statuses: ['todo'] });
    expect(result.tasks).toHaveLength(5_000);
    expect([...result.matchIds]).toEqual([chain[4_999]!.id]);
    expect(result.tasks[0]).toBe(chain[0]);
    expect(result.tasks[4_999]).toBe(chain[4_999]);
  });
});
