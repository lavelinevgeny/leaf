import type { Task } from '../shared/contracts.js';

export interface TaskFilter {
  query: string;
  status: Task['status'] | 'all';
}
export const emptyTaskFilter: TaskFilter = { query: '', status: 'all' };

function normalized(value: string) {
  return value.normalize('NFC').toLocaleLowerCase('ru');
}

export function filterTasks(tasks: readonly Task[], filter: TaskFilter) {
  const query = normalized(filter.query.trim());
  const active = query !== '' || filter.status !== 'all';
  const matchIds = new Set(
    tasks
      .filter(
        (task) =>
          (filter.status === 'all' || task.status === filter.status) &&
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
