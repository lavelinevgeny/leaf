import { useEffect, useState } from 'react';
import type { Task } from '../shared/contracts.js';
import type { CurrentGroup, CurrentGroupId } from './current-view.js';
import { emptyTaskFilter, filterTasks } from './task-filter.js';
import './styles/current.css';

export function CurrentTasks({
  groups: sourceGroups,
  query = '',
  collapsed,
  onToggle,
  onOpen,
}: {
  groups: readonly CurrentGroup[];
  query?: string;
  collapsed: ReadonlySet<CurrentGroupId>;
  onToggle: (id: CurrentGroupId) => void;
  onOpen: (task: Task, group: CurrentGroupId) => void;
}) {
  const searching = query.trim() !== '';
  const [searchCollapsed, setSearchCollapsed] = useState(
    new Set<CurrentGroupId>(),
  );
  useEffect(() => setSearchCollapsed(new Set()), [query]);
  const effectiveCollapsed = searching ? searchCollapsed : collapsed;
  const matches = filterTasks(
    sourceGroups.flatMap((group) => group.rows.map((row) => row.task)),
    { ...emptyTaskFilter, query },
  ).matchIds;
  const groups = searching
    ? sourceGroups.map((group) => ({
        ...group,
        rows: group.rows.filter((row) => matches.has(row.task.id)),
      }))
    : sourceGroups;
  function toggle(id: CurrentGroupId) {
    if (!searching) return onToggle(id);
    setSearchCollapsed((previous) => {
      const next = new Set(previous);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }
  return (
    <div className="current-tasks">
      {groups.every((group) => !group.rows.length) && (
        <p className="empty-state" role="status">
          {searching ? 'Нет совпадений' : 'Нет незавершённых конечных задач'}
        </p>
      )}
      {groups.map((group) => (
        <section className={`current-group current-${group.id}`} key={group.id}>
          <h2>
            <button
              id={`current-group-${group.id}`}
              type="button"
              aria-expanded={!effectiveCollapsed.has(group.id)}
              aria-controls={`current-region-${group.id}`}
              onClick={() => toggle(group.id)}
            >
              <span className="current-chevron" aria-hidden="true">
                {effectiveCollapsed.has(group.id) ? '›' : '⌄'}
              </span>
              {group.label}{' '}
              <span className="current-count">{group.rows.length}</span>
            </button>
          </h2>
          <div
            id={`current-region-${group.id}`}
            role="region"
            aria-labelledby={`current-group-${group.id}`}
            hidden={effectiveCollapsed.has(group.id)}
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
