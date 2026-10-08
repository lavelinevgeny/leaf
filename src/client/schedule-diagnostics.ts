import type { ProjectTree } from '../shared/contracts.js';

type Diagnostic = ProjectTree['schedule']['diagnostics'][number];
const actionableCodes = new Set([
  'EXPLICIT_PRECEDENCE_CONFLICT',
  'INVALID_INTERVAL',
  'DURATION_MISMATCH',
  'INVALID_PRECEDENCE_BOUNDARY',
  'INVALID_DURATION',
  'NON_WORKING_DATE',
  'CALENDAR_RANGE_EXCEEDED',
]);
const absenceOnlyCodes = new Set([
  'UNKNOWN_INTERVAL',
  'UNKNOWN_PRECEDENCE',
  'UNKNOWN_DEPENDENCY',
  'BLOCKED_BY_UNKNOWN',
  'MISSING_PROJECT_START',
  'BLOCKED_BY_MISSING_PROJECT_START',
]);

export function actionableDiagnostics(diagnostics: readonly Diagnostic[]) {
  return diagnostics.filter((item) => actionableCodes.has(item.code));
}

export function isAbsenceOnlyDiagnostic(diagnostic: Diagnostic) {
  return absenceOnlyCodes.has(diagnostic.code);
}
