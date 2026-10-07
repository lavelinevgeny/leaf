export type CalendarType = 'weekdays' | 'all-days';
export type PlanMode = 'unscheduled' | 'auto' | 'fixed';
export interface SchedulingTask {
  id: string;
  parentId: string | null;
  status: 'todo' | 'doing' | 'done';
  planMode: PlanMode;
  durationDays: number | null;
  inputStart: string | null;
  inputFinish: string | null;
  notBefore: string | null;
  deadline: string | null;
  completedStart: string | null;
  completedFinish: string | null;
  completedStartIndex: number | null;
  completedFinishIndex: number | null;
}
export interface SchedulingDependency {
  id: string;
  predecessorId: string;
  successorId: string;
}
export interface ScheduleInput {
  startDate: string | null;
  calendarType: CalendarType;
  tasks: readonly SchedulingTask[];
  dependencies: readonly SchedulingDependency[];
}
export interface ScheduledTask {
  ES: number | null;
  EF: number | null;
  LS: number | null;
  LF: number | null;
  projectFloat: number | null;
  constraintFloat: number | null;
  startDate: string | null;
  finishDate: string | null;
  blockedReason: string | null;
}
export interface ScheduleSummary {
  start: number | null;
  finish: number | null;
  startDate: string | null;
  finishDate: string | null;
  partial: boolean;
  containsCritical: boolean;
}
export interface ScheduleDiagnostic {
  code: string;
  taskIds: string[];
  dependencyIds: string[];
  messageKey: string;
}
export interface ScheduleResult {
  feasibility: 'feasible' | 'incomplete' | 'infeasible';
  originDate: string | null;
  projectFinishIndex: number | null;
  coverage: { knownLeafCount: number; totalLeafCount: number };
  tasks: Record<string, ScheduledTask>;
  summaries: Record<string, ScheduleSummary>;
  criticalTaskIds: string[];
  criticalDependencyIds: string[];
  diagnostics: ScheduleDiagnostic[];
}
