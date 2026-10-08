import type { ProjectTree, Task } from '../shared/contracts.js';
import { validateDependency, realInterval } from '../domain/planning.js';
import { treeRows } from './tree-view.js';
export interface PredecessorCandidate {
  task: Task;
  path: string;
  incomplete: boolean;
}
export function canonicalPredecessorIds(ids: readonly string[]): string[] {
  return [...new Set(ids)].sort();
}
export function incomingPredecessorIds(
  tree: ProjectTree,
  taskId: string,
): string[] {
  return canonicalPredecessorIds(
    tree.dependencies
      .filter((edge) => edge.successorId === taskId)
      .map((edge) => edge.predecessorId),
  );
}
export function predecessorCandidates(
  tree: ProjectTree,
  successorId: string | null,
  selectedIds: readonly string[],
  query: string,
): PredecessorCandidate[] {
  const tasks = tree.tasks.filter((task) => task.projectId === tree.project.id);
  const byId = new Map(tasks.map((task) => [task.id, task]));
  const summaryIds = new Set(tasks.map((task) => task.parentId));
  const selected = new Set(selectedIds);
  const proposed = [
    ...tree.dependencies.filter((edge) => edge.successorId !== successorId),
    ...selectedIds.map((predecessorId) => ({
      id: `draft:${predecessorId}`,
      predecessorId,
      successorId: successorId ?? '',
    })),
  ];
  const result: PredecessorCandidate[] = [];
  for (const { task } of treeRows(tasks, new Set())) {
    if (
      summaryIds.has(task.id) ||
      task.id === successorId ||
      selected.has(task.id)
    )
      continue;
    const ancestors: string[] = [];
    const visited = new Set([task.id]);
    let parent = task.parentId ? byId.get(task.parentId) : undefined;
    while (parent && !visited.has(parent.id)) {
      visited.add(parent.id);
      ancestors.unshift(parent.title);
      parent = parent.parentId ? byId.get(parent.parentId) : undefined;
    }
    const path = ancestors.join(' / ');
    if (
      !`${task.title} ${path}`
        .toLocaleLowerCase('ru')
        .includes(query.trim().toLocaleLowerCase('ru'))
    )
      continue;
    if (successorId) {
      try {
        validateDependency(tasks, proposed, task.id, successorId);
      } catch {
        continue;
      }
    }
    result.push({
      task,
      path,
      incomplete: !realInterval(task, tree.project.calendarType),
    });
  }
  return result;
}
