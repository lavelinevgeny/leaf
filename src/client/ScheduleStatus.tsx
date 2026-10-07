import type { ProjectTree, Task } from '../shared/contracts.js';
import { diagnosticLabels, strings } from './strings.js';
export function ScheduleStatus({
  tree,
  task,
}: {
  tree: ProjectTree;
  task?: Task;
}) {
  const { schedule } = tree;
  const names = new Map(tree.tasks.map((item) => [item.id, item.title]));
  const computed = task ? schedule.tasks[task.id] : undefined;
  const summary = task ? schedule.summaries[task.id] : undefined;
  const diagnostics = schedule.diagnostics.filter(
    (item) => !task || item.taskIds.includes(task.id),
  );
  return (
    <div className="schedule-status" aria-live="polite">
      {!task && (
        <span>
          {strings.coverage} {schedule.coverage.knownLeafCount} {strings.of}{' '}
          {schedule.coverage.totalLeafCount} {strings.leaves}
        </span>
      )}
      {schedule.feasibility === 'incomplete' && (
        <span className="schedule-warning">{strings.preliminary}</span>
      )}
      {schedule.feasibility === 'infeasible' && (
        <span className="schedule-error">{strings.infeasible}</span>
      )}
      {!schedule.originDate && <p>{strings.missingOrigin}</p>}
      {task && schedule.criticalTaskIds.includes(task.id) && (
        <p className="critical-label">{strings.critical}</p>
      )}
      {summary?.containsCritical && <p>{strings.containsCritical}</p>}
      {summary?.partial && <p>{strings.partial}</p>}
      {computed?.blockedReason && (
        <p>
          {strings.blocked}:{' '}
          {diagnosticLabels[computed.blockedReason] ?? computed.blockedReason}
        </p>
      )}
      {computed?.projectFloat != null && (
        <p>
          {strings.projectFloat}: {computed.projectFloat} {strings.workingDays}
        </p>
      )}
      {computed?.constraintFloat != null && (
        <p>
          {strings.constraintFloat}: {computed.constraintFloat}{' '}
          {strings.workingDays}
        </p>
      )}
      {diagnostics.length > 0 && (
        <ul className="schedule-diagnostics">
          {diagnostics.map((item, index) => (
            <li key={index}>
              {diagnosticLabels[item.code] ?? item.code}
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
