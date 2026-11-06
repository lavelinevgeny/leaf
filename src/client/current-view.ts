import type { Project, Task } from '../shared/contracts.js';
import { indexToDate, isWorkingDay } from '../domain/calendar.js';
import { treeRows } from './tree-view.js';

export type CurrentGroupId = 'overdue' | 'today' | 'soon' | 'later' | 'undated';
export type CurrentRow = { task: Task; path: string; order: number };
export type CurrentGroup = {
  id: CurrentGroupId;
  label: string;
  rows: CurrentRow[];
};
export type CurrentOrigin = {
  projectId: string;
  taskId: string;
  groupId: CurrentGroupId;
};

export function defaultCurrentCollapsed(): Set<CurrentGroupId> {
  return new Set(['later', 'undated']);
}
export function currentGroups(
  tasks: readonly Task[],
  calendar: Project['calendarType'],
  today: string,
): CurrentGroup[] {
  let soonEnd = today;
  let counted = 0;
  while (counted < 3 && soonEnd !== '9999-12-31') {
    soonEnd = indexToDate(1, soonEnd, 'all-days');
    if (isWorkingDay(soonEnd, calendar)) counted += 1;
  }
  const groups: CurrentGroup[] = [
    { id: 'overdue', label: 'Просрочено', rows: [] },
    { id: 'today', label: 'Сегодня', rows: [] },
    { id: 'soon', label: 'Скоро', rows: [] },
    { id: 'later', label: 'Позже', rows: [] },
    { id: 'undated', label: 'Без окончания', rows: [] },
  ];
  const ancestors: string[] = [];
  treeRows(tasks, new Set()).forEach(({ task, depth, hasChildren }, order) => {
    ancestors.length = depth;
    const path = ancestors.join(' / ') || 'Корень проекта';
    ancestors.push(task.title);
    if (hasChildren || task.status === 'done') return;
    const finish = task.inputFinish;
    const index =
      finish === null
        ? 4
        : finish < today
          ? 0
          : finish === today
            ? 1
            : finish <= soonEnd
              ? 2
              : 3;
    groups[index]!.rows.push({ task, path, order });
  });
  for (const group of groups)
    group.rows.sort(
      (a, b) =>
        (a.task.inputFinish ?? '').localeCompare(b.task.inputFinish ?? '') ||
        a.order - b.order,
    );
  return groups;
}
