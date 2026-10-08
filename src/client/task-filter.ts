import type { Task } from '../shared/contracts.js';

export interface TaskFilter {
  query: string;
  statuses: readonly Task['status'][];
}
export const taskStatuses = ['todo', 'doing', 'done'] as const;
export const emptyTaskFilter: TaskFilter = {
  query: '',
  statuses: taskStatuses,
};

export function hasStatusFilter(statuses: TaskFilter['statuses']) {
  return !taskStatuses.every((status) => statuses.includes(status));
}

function normalized(value: string) {
  return value.normalize('NFC').toLocaleLowerCase('ru');
}

export function filterTasks(tasks: readonly Task[], filter: TaskFilter) {
  const query = normalized(filter.query.trim());
  const active = query !== '' || hasStatusFilter(filter.statuses);
  const matchIds = new Set(
    tasks
      .filter(
        (task) =>
          filter.statuses.includes(task.status) &&
          normalized(task.title).includes(query),
      )
      .map((task) => task.id),
  );
  if (!active) return { tasks, matchIds, active };

  const byId = new Map(tasks.map((task) => [task.id, task]));
  const retained = new Set<string>();
  for (const matchId of matchIds) {
    let current: string | null = matchId;
    while (current && !retained.has(current)) {
      retained.add(current);
      current = byId.get(current)?.parentId ?? null;
    }
  }
  return {
    tasks: tasks.filter((task) => retained.has(task.id)),
    matchIds,
    active,
  };
}
