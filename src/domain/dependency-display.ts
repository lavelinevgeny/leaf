import { indexToDate, nextWorkingDay } from './calendar.js';
import { conditionalDisplay } from './conditional-display.js';
import type {
  CalendarType,
  ConditionalDisplay,
  OptionalTask,
  RealTask,
  SchedulingDependency,
} from './scheduling-types.js';

// Presentation only. The caller validates the DAG and builds C19 own/group/today
// bases. Conditional finishes constrain geometry, never source dates or CPM.
export function dependencyDisplay(
  tasks: readonly OptionalTask[],
  dependencies: readonly SchedulingDependency[],
  real: Readonly<Record<string, RealTask>>,
  bases: Readonly<Record<string, ConditionalDisplay>>,
  calendar: CalendarType,
): Record<string, ConditionalDisplay> {
  const leaves = tasks.filter((task) => Object.hasOwn(real, task.id));
  const incoming = new Map(leaves.map((task) => [task.id, [] as string[]]));
  const outgoing = new Map(leaves.map((task) => [task.id, [] as string[]]));
  const remaining = new Map(leaves.map((task) => [task.id, 0]));
  for (const edge of dependencies) {
    if (!incoming.has(edge.successorId) || !outgoing.has(edge.predecessorId))
      continue;
    incoming.get(edge.successorId)!.push(edge.predecessorId);
    outgoing.get(edge.predecessorId)!.push(edge.successorId);
    remaining.set(edge.successorId, remaining.get(edge.successorId)! + 1);
  }
  const byId = new Map(leaves.map((task) => [task.id, task]));
  const order = leaves
    .filter((task) => remaining.get(task.id) === 0)
    .map((task) => task.id);
  for (let i = 0; i < order.length; i++)
    for (const id of outgoing.get(order[i]!)!) {
      const count = remaining.get(id)! - 1;
      remaining.set(id, count);
      if (count === 0) order.push(id);
    }
  if (order.length !== leaves.length) return { ...bases };
  const display: Record<string, ConditionalDisplay> = {};
  for (const id of order) {
    const task = byId.get(id)!;
    const base = bases[id];
    if (task.inputStart !== null || task.inputFinish !== null) {
      if (base) display[id] = base;
      continue;
    }
    let start = base?.startDate ?? null;
    let clipped = false;
    for (const predecessorId of incoming.get(id)!) {
      const finish =
        real[predecessorId]?.finishDate ?? display[predecessorId]?.finishDate;
      if (!finish) continue;
      let boundary: string;
      try {
        boundary = nextWorkingDay(indexToDate(1, finish, 'all-days'), calendar);
      } catch (error) {
        if (
          !(error instanceof RangeError) ||
          error.message !== 'CALENDAR_RANGE_EXCEEDED'
        )
          throw error;
        boundary = '9999-12-31';
        clipped = true;
      }
      if (start === null || boundary > start) start = boundary;
    }
    const interval = conditionalDisplay(task, start, null, calendar);
    if (interval)
      display[id] = { ...interval, clipped: interval.clipped || clipped };
  }
  return display;
}
