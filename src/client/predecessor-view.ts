import type { ProjectTree, Task } from '../shared/contracts.js';
import { validateDependency, realInterval } from '../domain/planning.js';
import { DomainError } from '../domain/tree.js';
import { treeRows } from './tree-view.js';
export type DependencyDirection = 'predecessor' | 'successor';
export interface DependencyProposal {
  task: Task;
  isNew: boolean;
  predecessorIds: readonly string[];
  successorIds: readonly string[];
}
export interface DependencySelectionIssue {
  direction: DependencyDirection;
  taskId: string;
  reason: string;
}
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
export function outgoingSuccessorIds(
  tree: ProjectTree,
  taskId: string,
): string[] {
  return canonicalPredecessorIds(
    tree.dependencies
      .filter((edge) => edge.predecessorId === taskId)
      .map((edge) => edge.successorId),
  );
}
function proposalGraph(tree: ProjectTree, proposal: DependencyProposal) {
  const tasks = tree.tasks.filter((task) => task.projectId === tree.project.id);
  if (proposal.isNew && proposal.task.projectId === tree.project.id)
    tasks.push(proposal.task);
  const selected = (['predecessor', 'successor'] as const).flatMap(
    (direction) =>
      (direction === 'predecessor'
        ? proposal.predecessorIds
        : proposal.successorIds
      ).map((taskId, index) => ({
        id: `proposal:${direction}:${index}:${taskId}`,
        direction,
        taskId,
        predecessorId: direction === 'predecessor' ? taskId : proposal.task.id,
        successorId: direction === 'predecessor' ? proposal.task.id : taskId,
      })),
  );
  const edges = [
    ...tree.dependencies.filter(
      (edge) =>
        edge.projectId === tree.project.id &&
        edge.predecessorId !== proposal.task.id &&
        edge.successorId !== proposal.task.id,
    ),
    ...selected,
  ];
  return { tasks, edges, selected };
}
export function dependencyCandidates(
  tree: ProjectTree,
  proposal: DependencyProposal,
  direction: DependencyDirection,
  query: string,
): PredecessorCandidate[] {
  const { tasks, edges } = proposalGraph(tree, proposal);
  const byId = new Map(tasks.map((task) => [task.id, task]));
  const result: PredecessorCandidate[] = [];
  for (const { task } of treeRows(tasks, new Set())) {
    try {
      validateDependency(
        tasks,
        edges,
        direction === 'predecessor' ? task.id : proposal.task.id,
        direction === 'predecessor' ? proposal.task.id : task.id,
      );
    } catch {
      continue;
    }
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
    result.push({
      task,
      path,
      incomplete: !realInterval(task, tree.project.calendarType),
    });
  }
  return result;
}
export function dependencySelectionIssues(
  tree: ProjectTree,
  proposal: DependencyProposal,
): DependencySelectionIssue[] {
  const { tasks, edges, selected } = proposalGraph(tree, proposal);
  const issues: DependencySelectionIssue[] = [];
  for (const edge of selected) {
    try {
      // Check each selection against every other selection, including the opposite direction.
      validateDependency(
        tasks,
        edges.filter((other) => other !== edge),
        edge.predecessorId,
        edge.successorId,
      );
    } catch (error) {
      issues.push({
        direction: edge.direction,
        taskId: edge.taskId,
        reason:
          error instanceof DomainError
            ? error.code === 'DEPENDENCY_CYCLE'
              ? 'Связь создаёт цикл зависимостей.'
              : error.message
            : 'Связь недопустима.',
      });
    }
  }
  return issues;
}
