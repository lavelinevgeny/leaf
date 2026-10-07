import type {
  SourceFields,
  FrozenPendingScheduleV2,
  LiveScheduleResultV2,
  ScheduleResultV2,
} from '../shared/contracts.js';
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
export type OptionalResult = ScheduleResultV2;
export type LiveResult = LiveScheduleResultV2;
export type ExplicitProjection = Omit<
  FrozenPendingScheduleV2,
  'analysisStatus' | 'criticalTaskIds' | 'criticalDependencyIds'
>;
export interface WorkingInterval {
  s: number;
  f: number;
  d: number;
}
export interface CpmVertex extends WorkingInterval {
  id: string;
  status: 'todo' | 'doing' | 'done';
}
export interface CpmGraph {
  vertices: ReadonlyMap<string, CpmVertex>; // Only valid real leaves.
  leafIds: readonly string[]; // Includes unknown leaves.
  dependencies: readonly SchedulingDependency[]; // Original validated DAG.
  topoIds: readonly string[]; // All leaves, no summary vertices.
  weakComponents: readonly (readonly string[])[];
  originDate: string;
  calendarType: CalendarType;
}
export interface BackwardValue {
  LS: number;
  LF: number;
  projectFloat: number;
  constraintFloat: number;
}
export interface BackwardAnalysis {
  horizon: number | null;
  values: ReadonlyMap<string, BackwardValue>;
  criticalTaskIds: string[];
  criticalDependencyIds: string[];
}
export type SchedulingTask = OptionalTask;
export type ScheduleInput = OptionalInput;
export type ScheduleResult = OptionalResult;
