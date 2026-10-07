import type { SourceFields } from '../shared/optional-contracts.js';
import type {
  CalendarType,
  SchedulingDependency,
  ScheduleDiagnostic,
} from './scheduling-types.js';

export interface OptionalTask extends SourceFields {
  id: string;
  parentId: string | null;
  status: 'todo' | 'doing' | 'done';
}
export interface OptionalInput {
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
