import type { ProjectTree, Task } from '../shared/contracts.js';
import {
  actionableDiagnostics,
  isAbsenceOnlyDiagnostic,
} from './schedule-diagnostics.js';
import { diagnosticLabels, strings } from './strings.js';
export function ScheduleStatus({
  tree,
  task,
}: {
  tree: ProjectTree;
  task?: Task;
}) {
  const { schedule } = tree;
  const partial =
    schedule.analysisStatus === 'incomplete' ? schedule.partialAnalysis : null;
  const ordinary =
    schedule.analysisStatus === 'ready' && task
      ? schedule.tasks[task.id]
      : undefined;
  const summary =
    schedule.analysisStatus === 'ready' && task
      ? schedule.summaries[task.id]
      : undefined;
  const known = partial && task ? partial.tasks[task.id] : undefined;
  const names = new Map(tree.tasks.map((item) => [item.id, item.title]));
  const diagnostics = schedule.diagnostics.filter(
    (item) =>
      !isAbsenceOnlyDiagnostic(item) &&
      (!task || item.taskIds.includes(task.id)),
  );
  return (
    <div className="schedule-status" aria-live="polite">
      {!task && (
        <>
          <span>
            {strings.coverage} {schedule.coverage.knownLeafCount} {strings.of}{' '}
            {schedule.coverage.totalLeafCount} {strings.leaves}
          </span>
        </>
      )}
      {schedule.analysisStatus === 'pending-policy' && (
        <p>{strings.frozenPending}</p>
      )}
      {schedule.analysisStatus === 'ready' && <p>{strings.readyCritical}</p>}
      {schedule.analysisStatus === 'incomplete' && (
        <p>{partial ? strings[partial.labelKey] : strings.unknownCritical}</p>
      )}
      {task && ordinary && (
        <>
          {schedule.criticalTaskIds.includes(task.id) && (
            <p className="critical-label">{strings.critical}</p>
          )}
          <p title="Структурный резерв введённого расписания; не меняет исходные даты.">
            {strings.projectFloat}: {ordinary.projectFloat}{' '}
            {strings.workingDays}
          </p>
          <p title="Локальный резерв при сохранении остальных введённых интервалов; не разрешает изменить завершённую работу.">
            {strings.constraintFloat}: {ordinary.constraintFloat}{' '}
            {strings.workingDays}
          </p>
        </>
      )}
      {summary?.containsCritical === true && (
        <p className="critical-label">{strings.containsCritical}</p>
      )}
      {known && (
        <p>
          {strings.knownHorizonFloat}: {known.knownHorizonFloat}{' '}
          {strings.workingDays}
        </p>
      )}
      {partial && task && partial.partialCriticalTaskIds.includes(task.id) && (
        <p className="partial-critical-label">{strings.partialCritical}</p>
      )}
      {partial &&
        task &&
        partial.partialCriticalSummaryIds.includes(task.id) && (
          <p className="partial-critical-label">
            {strings.partialContainsCritical}
          </p>
        )}
      {schedule.feasibility === 'infeasible' &&
        (!task || actionableDiagnostics(diagnostics).length > 0) && (
          <span className="schedule-error">{strings.infeasible}</span>
        )}
      {diagnostics.length > 0 && (
        <ul className="schedule-diagnostics">
          {diagnostics.map((item, index) => (
            <li key={index}>
              {diagnosticLabels[item.code] ??
                'Проверьте сроки связанных задач.'}
              {!task && item.taskIds.length > 0
                ? ` (${item.taskIds.map((id) => names.get(id) ?? strings.taskRemoved).join(', ')})`
                : ''}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
