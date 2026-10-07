import type { ProjectTree, Task } from '../shared/contracts.js';
import { strings } from './strings.js';
const labels: Record<string, string> = {
  LEGACY_INTERVAL_UNAVAILABLE:
    'Прежний интервал не удалось определить. Проверьте и сохраните даты. Завершённую задачу сначала верните в работу.',
  INVALID_SOURCE_INTERVAL: 'Проверьте даты и длительность задачи.',
  EXPLICIT_PRECEDENCE_CONFLICT: 'Сроки задачи противоречат зависимости.',
  UNKNOWN_PREDECESSOR: 'Интервал связанной задачи неизвестен.',
};
export function ScheduleStatus({
  tree,
  task,
}: {
  tree: ProjectTree;
  task?: Task;
}) {
  const { schedule } = tree;
  const names = new Map(tree.tasks.map((item) => [item.id, item.title]));
  const diagnostics = schedule.diagnostics.filter(
    (item) => !task || item.taskIds.includes(task.id),
  );
  return (
    <div className="schedule-status" aria-live="polite">
      {!task && (
        <>
          <span>
            {strings.coverage} {schedule.coverage.knownLeafCount} {strings.of}{' '}
            {schedule.coverage.totalLeafCount} {strings.leaves}
          </span>
          <p>Расчёт критического пути ещё не подключён</p>
        </>
      )}
      {schedule.feasibility === 'incomplete' && (
        <span className="schedule-warning">Неполные сроки</span>
      )}
      {schedule.feasibility === 'infeasible' && (
        <span className="schedule-error">{strings.infeasible}</span>
      )}
      {diagnostics.length > 0 && (
        <ul className="schedule-diagnostics">
          {diagnostics.map((item, index) => (
            <li key={index}>
              {labels[item.code] ?? 'Проверьте сроки связанных задач.'}
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
