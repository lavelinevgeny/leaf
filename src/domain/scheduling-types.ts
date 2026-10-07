import type { SourceFields } from '../shared/contracts.js';
export type CalendarType = 'weekdays' | 'all-days';
export interface SchedulingDependency {
  id: string;
  predecessorId: string;
  successorId: string;
}
export interface ScheduleDiagnostic {
  code: string;
  taskIds: string[];
  dependencyIds: string[];
  messageKey: string;
}

export interface OptionalTask extends SourceFields {
  id: string;
  parentId: string | null;
  status: 'todo' | 'doing' | 'done';
}
export interface OptionalInput {
  // Server-private C17 provenance; does not change source fields or FS edges.
  unavailableTaskIds?: readonly string[];
  calendarType: CalendarType;
  tasks: readonly OptionalTask[];
  dependencies: readonly SchedulingDependency[];
}
export interface RealTask {
  startDate: string | null;
  finishDate: string | null;
  calendarSpanDays: number | null;
}
export interface OptionalSummary extends RealTask {
  knownLeafCount: number;
  totalLeafCount: number;
}
export interface ConditionalDisplay {
  kind: 'conditional';
  startDate: string;
  finishDate: string;
  clipped: boolean;
}
export interface OptionalResult {
  analysisStatus: 'pending-policy';
  feasibility: 'feasible' | 'incomplete' | 'infeasible';
  coverage: { knownLeafCount: number; totalLeafCount: number };
  tasks: Record<string, RealTask>;
  summaries: Record<string, OptionalSummary>;
  display: Record<string, ConditionalDisplay>;
  criticalTaskIds: string[];
  criticalDependencyIds: string[];
  diagnostics: ScheduleDiagnostic[];
}

export type SchedulingTask = OptionalTask;
export type ScheduleInput = OptionalInput;
export type ScheduleResult = OptionalResult;
