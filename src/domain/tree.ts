import type { Task } from '../shared/contracts.js';

export class DomainError extends Error {
  constructor(
    public readonly code: string,
    message: string,
    public readonly statusCode = 400,
  ) {
    super(message);
  }
}
export function orderedChildren(
  tasks: readonly Task[],
  parentId: string | null,
): Task[] {
  return tasks
    .filter((task) => task.parentId === parentId)
    .sort((a, b) => a.sortOrder - b.sortOrder || a.id.localeCompare(b.id));
}
export function childMap(tasks: readonly Task[]): Map<string | null, Task[]> {
  const children = new Map<string | null, Task[]>();
  for (const task of tasks) {
    const siblings = children.get(task.parentId) ?? [];
    siblings.push(task);
    children.set(task.parentId, siblings);
  }
  for (const siblings of children.values())
    siblings.sort(
      (a, b) => a.sortOrder - b.sortOrder || a.id.localeCompare(b.id),
    );
  return children;
}
export function subtreeIds(
  tasks: readonly Task[],
  rootId: string,
): Set<string> {
  if (!tasks.some((task) => task.id === rootId))
    throw new DomainError('TASK_NOT_FOUND', 'Задача не найдена.', 404);
  const children = childMap(tasks);
  const result = new Set<string>();
  const stack = [rootId];
  while (stack.length) {
    const id = stack.pop()!;
    if (result.has(id)) continue;
    result.add(id);
    const descendants = children.get(id) ?? [];
    for (let i = descendants.length - 1; i >= 0; i--)
      stack.push(descendants[i]!.id);
  }
  return result;
}
export function assertCanMove(
  tasks: readonly Task[],
  taskId: string,
  parentId: string | null,
): void {
  if (parentId !== null && !tasks.some((task) => task.id === parentId))
    throw new DomainError('INVALID_PARENT', 'Родитель не принадлежит проекту.');
  if (parentId !== null && subtreeIds(tasks, taskId).has(parentId))
    throw new DomainError(
      'TREE_CYCLE',
      'Нельзя перенести задачу в собственную ветку.',
    );
  if (!tasks.some((task) => task.id === taskId))
    throw new DomainError('TASK_NOT_FOUND', 'Задача не найдена.', 404);
}
export interface VisibleTreeRow {
  task: Task;
  depth: number;
  hasChildren: boolean;
}
export function visibleTree(
  tasks: readonly Task[],
  collapsed: ReadonlySet<string> = new Set(),
): VisibleTreeRow[] {
  const children = childMap(tasks);
  const stack = (children.get(null) ?? [])
    .toReversed()
    .map((task) => ({ task, depth: 0 }));
  const result: VisibleTreeRow[] = [];
  const seen = new Set<string>();
  while (stack.length) {
    const row = stack.pop()!;
    if (seen.has(row.task.id))
      throw new DomainError('TREE_CYCLE', 'Дерево содержит цикл.');
    seen.add(row.task.id);
    const descendants = children.get(row.task.id) ?? [];
    result.push({ ...row, hasChildren: descendants.length > 0 });
    if (!collapsed.has(row.task.id))
      for (let i = descendants.length - 1; i >= 0; i--)
        stack.push({ task: descendants[i]!, depth: row.depth + 1 });
  }
  return result;
}
