import {
  sourceFieldsSchema,
  type ProjectTree,
  type SourceFields,
  type Task,
} from '../shared/contracts.js';
import type { AddContext } from './QuickAdd.js';
import { treeRows, subtreeIds } from './tree-view.js';
import { strings } from './strings.js';
import { compactDateLabel } from './gantt-view.js';
import { conditionalDisplay } from '../domain/conditional-display.js';
import { realInterval } from '../domain/planning.js';
import {
  nextWorkingDay,
  indexToDate,
  workingDaysInclusive,
} from '../domain/calendar.js';

export const draftTaskId = 'quick-add-draft';
export function parentPlan(
  tree: ProjectTree,
  id: string | null,
): SourceFields | null {
  if (!id) return null;
  const task = tree.tasks.find((task) => task.id === id);
  if (!task) return null;
  const summary = tree.schedule.summaries[id];
  const start = summary ? summary.startDate : task.inputStart;
  const finish = summary ? summary.finishDate : task.inputFinish;
  if (summary && (!start || !finish)) return null;
  const duration =
    summary && start && finish
      ? workingDaysInclusive(start, finish, tree.project.calendarType)
      : task.durationDays;
  return start || finish || duration !== null
    ? { inputStart: start, inputFinish: finish, durationDays: duration }
    : null;
}
export function draftTask(
  tree: ProjectTree,
  context: AddContext,
  title: string,
  plan: SourceFields,
): Task {
  return {
    id: draftTaskId,
    projectId: tree.project.id,
    parentId: context.parentId,
    sortOrder: 0,
    title: title || strings.newTask,
    description: '',
    status: 'todo',
    createdAt: tree.project.createdAt,
    updatedAt: tree.project.updatedAt,
    ...plan,
  };
}
export function insertDraftRow(
  rows: ReturnType<typeof treeRows>,
  task: Task,
  context: AddContext,
) {
  const result = [...rows];
  const anchor = context.afterId ?? context.parentId;
  const anchorIndex = rows.findIndex((row) => row.task.id === anchor);
  const parentDepth = rows.find(
    (row) => row.task.id === context.parentId,
  )?.depth;
  const depth = context.parentId === null ? 0 : (parentDepth ?? -1) + 1;
  let index = rows.length;
  if (anchorIndex >= 0) {
    index = anchorIndex + 1;
    const boundary = rows[anchorIndex]!.depth;
    while (index < rows.length && rows[index]!.depth > boundary) index++;
  }
  result.splice(index, 0, { task, depth, hasChildren: false });
  return result;
}
export function draftInterval(tree: ProjectTree, task: Task, today: string) {
  const real = realInterval(task, tree.project.calendarType);
  if (real)
    return {
      start: real.startDate,
      finish: real.finishDate,
      kind: 'conditional' as const,
      clipped: false,
    };
  const ids = task.parentId
    ? subtreeIds(tree.tasks, task.parentId)
    : new Set<string>();
  const parents = new Set(tree.tasks.map((item) => item.parentId));
  const groupStart =
    tree.tasks
      .filter((item) => ids.has(item.id) && !parents.has(item.id))
      .map((item) => item.inputStart)
      .filter((date): date is string => !!date)
      .sort()[0] ?? null;
  const display = conditionalDisplay(
    task,
    groupStart,
    today,
    tree.project.calendarType,
  );
  return display
    ? {
        start: display.startDate,
        finish: display.finishDate,
        kind: 'conditional' as const,
        clipped: display.clipped,
      }
    : null;
}
export function scheduleChip(
  plan: SourceFields,
  calendar: ProjectTree['project']['calendarType'],
) {
  if (!sourceFieldsSchema.safeParse(plan).success) return strings.checkSchedule;
  const dates = compactDateLabel({ ...plan } as Task).replaceAll('.', '');
  const label = dates || strings.noDate;
  return plan.durationDays === null
    ? label
    : `${label} · ${plan.durationDays} ${calendar === 'weekdays' ? 'р.д.' : 'дн.'}`;
}
export function fridayPlan(
  today: string,
  calendar: ProjectTree['project']['calendarType'],
): SourceFields {
  const weekday = new Date(`${today}T12:00:00Z`).getUTCDay();
  const finish = indexToDate((5 - weekday + 7) % 7, today, 'all-days');
  const start = nextWorkingDay(today, calendar);
  return {
    inputStart: start,
    inputFinish: finish,
    durationDays: workingDaysInclusive(start, finish, calendar),
  };
}
