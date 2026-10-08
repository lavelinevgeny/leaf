import { useEffect, useId, useRef, useState } from 'react';
import { emptyTaskFilter, type TaskFilter } from './task-filter.js';
import { statusLabels, strings } from './strings.js';

interface Props {
  filter: TaskFilter;
  onChange: (filter: TaskFilter) => void;
  disabled: boolean;
}

export function TaskFilters({ filter, onChange, disabled }: Props) {
  const [open, setOpen] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  const select = useRef<HTMLSelectElement>(null);
  const button = useRef<HTMLButtonElement>(null);
  const popover = useRef<HTMLDivElement>(null);
  const popoverId = useId();
  const active = filter.query !== '' || filter.status !== 'all';

  useEffect(() => {
    if (disabled) setOpen(false);
  }, [disabled]);
  useEffect(() => {
    if (!open) return;
    select.current?.focus();
    const closeOutside = (event: PointerEvent) => {
      if (
        event.target instanceof Node &&
        !popover.current?.contains(event.target) &&
        !button.current?.contains(event.target)
      )
        setOpen(false);
    };
    document.addEventListener('pointerdown', closeOutside, true);
    return () =>
      document.removeEventListener('pointerdown', closeOutside, true);
  }, [open]);

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
          type="text"
          role="searchbox"
          inputMode="search"
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
      <button
        type="button"
        className={`quiet task-search-clear${filter.query ? '' : ' is-hidden'}`}
        aria-label={strings.clearTaskSearch}
        tabIndex={filter.query ? 0 : -1}
        disabled={disabled || !filter.query}
        onClick={() => {
          onChange({ ...filter, query: '' });
          input.current?.focus();
        }}
      >
        ×
      </button>
      <div className="task-filter-anchor">
        <button
          ref={button}
          type="button"
          className="quiet task-filter-button"
          aria-expanded={open}
          aria-controls={popoverId}
          disabled={disabled}
          onClick={() => setOpen((value) => !value)}
        >
          {filter.status === 'all' ? strings.filters : `${strings.filters} · 1`}
        </button>
        {open && !disabled && (
          <div
            ref={popover}
            id={popoverId}
            className="task-filter-popover"
            onBlur={(event) => {
              if (
                !event.currentTarget.contains(event.relatedTarget) &&
                event.relatedTarget !== button.current
              )
                setOpen(false);
            }}
            onKeyDown={(event) => {
              if (event.key === 'Escape') {
                event.preventDefault();
                event.stopPropagation();
                setOpen(false);
                button.current?.focus();
              }
            }}
          >
            <label>
              <span>{strings.filterStatus}</span>
              <select
                ref={select}
                value={filter.status}
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
            {active && (
              <button
                type="button"
                className="quiet"
                aria-label={strings.resetTaskFilters}
                onClick={() => {
                  onChange(emptyTaskFilter);
                  setOpen(false);
                  input.current?.focus();
                }}
              >
                {strings.reset}
              </button>
            )}
          </div>
        )}
      </div>
    </form>
  );
}
