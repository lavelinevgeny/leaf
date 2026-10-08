import { useRef } from 'react';
import { emptyTaskFilter, type TaskFilter } from './task-filter.js';
import { statusLabels, strings } from './strings.js';

interface Props {
  filter: TaskFilter;
  onChange: (filter: TaskFilter) => void;
  disabled: boolean;
}

export function TaskFilters({ filter, onChange, disabled }: Props) {
  const input = useRef<HTMLInputElement>(null);
  return (
    <form
      role="search"
      aria-label={strings.taskFilters}
      className="task-filters"
      onSubmit={(event) => event.preventDefault()}
    >
      <label className="task-search">
        <span className="sr-only">{strings.searchTasks}</span>
        <input
          ref={input}
          type="search"
          placeholder={strings.searchTasks}
          value={filter.query}
          disabled={disabled}
          onChange={(event) =>
            onChange({ ...filter, query: event.target.value })
          }
          onKeyDown={(event) => {
            if (event.key === 'Escape' && filter.query !== '') {
              event.preventDefault();
              event.stopPropagation();
              onChange({ ...filter, query: '' });
            }
          }}
        />
      </label>
      <label>
        <span className="sr-only">{strings.filterStatus}</span>
        <select
          value={filter.status}
          disabled={disabled}
          onChange={(event) =>
            onChange({
              ...filter,
              status: event.target.value as TaskFilter['status'],
            })
          }
        >
          <option value="all">{strings.allStatuses}</option>
          {Object.entries(statusLabels).map(([value, label]) => (
            <option key={value} value={value}>
              {label}
            </option>
          ))}
        </select>
      </label>
      {(filter.query !== '' || filter.status !== 'all') && (
        <button
          type="button"
          className="quiet"
          aria-label={strings.resetTaskFilters}
          disabled={disabled}
          onClick={() => {
            onChange(emptyTaskFilter);
            input.current?.focus();
          }}
        >
          {strings.reset}
        </button>
      )}
    </form>
  );
}
