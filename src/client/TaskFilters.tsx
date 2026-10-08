import { useEffect, useId, useRef, useState } from 'react';
import type { Task } from '../shared/contracts.js';
import {
  emptyTaskFilter,
  hasStatusFilter,
  taskStatuses,
  type TaskFilter,
} from './task-filter.js';
import { statusLabels, strings } from './strings.js';
import { ControlIcon } from './ControlIcon.js';

interface Props {
  filter: TaskFilter;
  tasks: readonly Task[];
  onChange: (filter: TaskFilter) => void;
  disabled: boolean;
}

export function TaskFilters({ filter, tasks, onChange, disabled }: Props) {
  const [open, setOpen] = useState(false);
  const [draftStatuses, setDraftStatuses] = useState(filter.statuses);
  const input = useRef<HTMLInputElement>(null);
  const allCheckbox = useRef<HTMLInputElement>(null);
  const button = useRef<HTMLButtonElement>(null);
  const openerPointerDown = useRef(false);
  const popover = useRef<HTMLDivElement>(null);
  const popoverId = useId();
  const statusActive = hasStatusFilter(filter.statuses);
  const draftActive = hasStatusFilter(draftStatuses);
  const active = filter.query.trim() !== '' || statusActive || draftActive;
  const counts = { todo: 0, doing: 0, done: 0 };
  for (const task of tasks) counts[task.status]++;
  const buttonLabel = statusActive
    ? `${strings.filters} · ${filter.statuses.length}`
    : strings.filters;

  useEffect(() => {
    if (disabled) setOpen(false);
  }, [disabled]);
  useEffect(() => {
    if (allCheckbox.current)
      allCheckbox.current.indeterminate =
        draftActive && draftStatuses.length > 0;
  }, [open, draftActive, draftStatuses]);
  useEffect(() => {
    if (!open) return;
    allCheckbox.current?.focus();
    const closeOutside = (event: PointerEvent) => {
      if (
        event.target instanceof Node &&
        !popover.current?.contains(event.target) &&
        !button.current?.contains(event.target)
      )
        setOpen(false);
    };
    const endOpenerPress = () => {
      openerPointerDown.current = false;
    };
    document.addEventListener('pointerdown', closeOutside, true);
    document.addEventListener('pointerup', endOpenerPress, true);
    document.addEventListener('pointercancel', endOpenerPress, true);
    return () => {
      document.removeEventListener('pointerdown', closeOutside, true);
      document.removeEventListener('pointerup', endOpenerPress, true);
      document.removeEventListener('pointercancel', endOpenerPress, true);
      endOpenerPress();
    };
  }, [open]);

  return (
    <form
      role="search"
      aria-label={strings.taskFilters}
      className="task-filters"
      onSubmit={(event) => event.preventDefault()}
    >
      <div className="task-search">
        <ControlIcon name="search" />
        <input
          ref={input}
          type="text"
          role="searchbox"
          aria-label={strings.searchTasks}
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
      </div>
      <div className="task-filter-anchor">
        <button
          ref={button}
          type="button"
          className="task-filter-button"
          aria-label={buttonLabel}
          aria-expanded={open}
          aria-controls={popoverId}
          disabled={disabled}
          onPointerDown={() => {
            openerPointerDown.current = true;
          }}
          onClick={() => {
            openerPointerDown.current = false;
            if (!open) setDraftStatuses(filter.statuses);
            setOpen((value) => !value);
          }}
        >
          <ControlIcon name="filter" />
          <span>{strings.filters}</span>
          <span
            className={`task-filter-badge${statusActive ? '' : ' is-hidden'}`}
            aria-hidden="true"
          >
            {statusActive ? filter.statuses.length : 0}
          </span>
          <ControlIcon name="chevron" />
        </button>
        {open && !disabled && (
          <div
            ref={popover}
            id={popoverId}
            className="task-filter-popover"
            onBlur={(event) => {
              if (
                !event.currentTarget.contains(event.relatedTarget) &&
                !(
                  event.relatedTarget === button.current &&
                  openerPointerDown.current
                )
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
            <fieldset>
              <legend>{strings.taskStatus}</legend>
              <label className="task-status-option task-status-all">
                <input
                  ref={allCheckbox}
                  type="checkbox"
                  checked={!draftActive}
                  onChange={() =>
                    setDraftStatuses(draftActive ? taskStatuses : [])
                  }
                />
                <span>{strings.allStatuses}</span>
                <span className="task-status-count" aria-hidden="true">
                  {tasks.length}
                </span>
              </label>
              {taskStatuses.map((status) => (
                <label key={status} className="task-status-option">
                  <input
                    type="checkbox"
                    checked={draftStatuses.includes(status)}
                    onChange={() =>
                      setDraftStatuses((previous) =>
                        taskStatuses.filter((candidate) =>
                          candidate === status
                            ? !previous.includes(candidate)
                            : previous.includes(candidate),
                        ),
                      )
                    }
                  />
                  <span>{statusLabels[status]}</span>
                  <span className="task-status-count" aria-hidden="true">
                    {counts[status]}
                  </span>
                </label>
              ))}
            </fieldset>
            <div className="task-filter-actions">
              <button
                type="button"
                className="quiet"
                aria-label={strings.resetTaskFilters}
                disabled={!active}
                onClick={() => {
                  onChange(emptyTaskFilter);
                  setOpen(false);
                  input.current?.focus();
                }}
              >
                {strings.reset}
              </button>
              <button
                type="button"
                className="task-filter-apply"
                onClick={() => {
                  onChange({ ...filter, statuses: draftStatuses });
                  setOpen(false);
                  button.current?.focus();
                }}
              >
                {strings.applyFilters}
                {draftActive ? ` (${draftStatuses.length})` : ''}
              </button>
            </div>
          </div>
        )}
      </div>
    </form>
  );
}
