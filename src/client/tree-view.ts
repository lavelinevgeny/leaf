import { visibleTree, orderedChildren, subtreeIds } from '../domain/tree.js';
import type { Task } from '../shared/contracts.js';
export { orderedChildren, subtreeIds };
export function treeRows(
  tasks: readonly Task[],
  collapsed: ReadonlySet<string>,
  rootId?: string,
) {
  if (!rootId) return visibleTree(tasks, collapsed);
  const descendants = subtreeIds(tasks, rootId);
  const originals = new Map(tasks.map((task) => [task.id, task]));
  return visibleTree(
    tasks
      .filter((task) => task.id !== rootId && descendants.has(task.id))
      .map((task) =>
        task.parentId === rootId ? { ...task, parentId: null } : task,
      ),
    collapsed,
  ).map((row) => ({ ...row, task: originals.get(row.task.id)! }));
}
export function dateLabel(task: Task) {
  return [task.inputStart, task.inputFinish].filter(Boolean).join(' – ');
}
