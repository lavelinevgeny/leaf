// src/server/legacy-pending-types.ts: server-only compatibility, not public task fields.
export type CalendarType = 'weekdays' | 'all-days';
export interface SourceFields {
  inputStart: string | null;
  inputFinish: string | null;
  durationDays: number | null;
}
export type SourcePatch = Partial<SourceFields>;
export interface OptionalTask extends SourceFields {
  id: string;
  parentId: string | null;
  status: 'todo' | 'doing' | 'done';
}
export interface SchedulingDependency {
  id: string;
  predecessorId: string;
  successorId: string;
}
export interface LegacyPendingInput {
  calendarType: CalendarType;
  tasks: readonly OptionalTask[];
  dependencies: readonly SchedulingDependency[];
  unavailableTaskIds?: readonly string[];
}
export interface RealTask {
  startDate: string | null;
  finishDate: string | null;
  calendarSpanDays: number | null;
}
export interface ConditionalDisplay {
  kind: 'conditional';
  startDate: string;
  finishDate: string;
  clipped: boolean;
}
