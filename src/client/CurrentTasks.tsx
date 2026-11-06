import type { Task } from '../shared/contracts.js';
import type { CurrentGroup, CurrentGroupId } from './current-view.js';
import './styles/current.css';

export function CurrentTasks({
  groups,
  collapsed,
  onToggle,
  onOpen,
}: {
  groups: readonly CurrentGroup[];
  collapsed: ReadonlySet<CurrentGroupId>;
  onToggle: (id: CurrentGroupId) => void;
  onOpen: (task: Task, group: CurrentGroupId) => void;
}) {
  return (
    <div className="current-tasks">
      {groups.every((group) => !group.rows.length) && (
        <p className="empty-state">Нет незавершённых конечных задач</p>
      )}
      {groups.map((group) => (
        <section className={`current-group current-${group.id}`} key={group.id}>
          <h2>
            <button
              id={`current-group-${group.id}`}
              type="button"
              aria-expanded={!collapsed.has(group.id)}
              aria-controls={`current-region-${group.id}`}
              onClick={() => onToggle(group.id)}
            >
              <span className="current-chevron" aria-hidden="true">
                {collapsed.has(group.id) ? '›' : '⌄'}
              </span>
              {group.label}{' '}
              <span className="current-count">{group.rows.length}</span>
            </button>
          </h2>
          <div
            id={`current-region-${group.id}`}
            role="region"
            aria-labelledby={`current-group-${group.id}`}
            hidden={collapsed.has(group.id)}
          >
            {!group.rows.length && <p className="current-empty">Нет задач</p>}
            {group.rows.map(({ task, path }) => (
              <button
                className="current-row"
                type="button"
                id={`current-task-${task.id}`}
                key={task.id}
                data-current-group={group.id}
                onClick={() => onOpen(task, group.id)}
              >
                <span
                  className={`current-status current-status-${task.status}`}
                  role="img"
                  aria-label={
                    task.status === 'doing' ? 'В работе' : 'Не начато'
                  }
                />
                <span className="current-task-text">
                  <span className="current-title">{task.title}</span>
                  <span className="current-path">{path}</span>
                </span>
                <span className="current-date">
                  {task.inputFinish ? (
                    <>
                      <span>
                        Окончание:{' '}
                        {task.inputFinish.split('-').reverse().join('.')}
                      </span>
                      {(group.id === 'overdue' || group.id === 'today') && (
                        <span className="current-urgency">{group.label}</span>
                      )}
                    </>
                  ) : (
                    <span>Без окончания</span>
                  )}
                </span>
              </button>
            ))}
          </div>
        </section>
      ))}
    </div>
  );
}
