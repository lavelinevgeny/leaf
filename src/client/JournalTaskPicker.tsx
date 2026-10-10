import { useEffect, useId, useRef, useState } from 'react';
import type { JournalMetadata } from './journal-state.js';
import { journalTaskPath } from './journal-state.js';
export function JournalTaskPicker({
  metadata,
  value,
  onChange,
  disabled,
}: {
  metadata: JournalMetadata;
  value: string | null;
  onChange: (taskId: string) => void;
  disabled: boolean;
}) {
  const [open, setOpen] = useState(false),
    [query, setQuery] = useState(''),
    [index, setIndex] = useState(0);
  const trigger = useRef<HTMLButtonElement>(null);
  const id = useId();
  const results = metadata.tasks
    .map((task) => ({ task, path: journalTaskPath(metadata.tasks, task.id) }))
    .filter((item) =>
      item.path
        .toLocaleLowerCase('ru')
        .includes(query.trim().toLocaleLowerCase('ru')),
    );
  useEffect(() => {
    if (open)
      document
        .getElementById(`${id}-${index}`)
        ?.scrollIntoView?.({ block: 'nearest' });
  }, [open, index, query, id]);
  const close = () => {
    setOpen(false);
    trigger.current?.focus();
  };
  const pick = (taskId: string) => {
    onChange(taskId);
    close();
  };
  return (
    <div className="journal-task-picker">
      <button
        ref={trigger}
        type="button"
        disabled={disabled}
        aria-expanded={open}
        aria-controls={id}
        onClick={() => setOpen(!open)}
      >
        {value ? journalTaskPath(metadata.tasks, value) : 'Выбрать задачу'}
      </button>
      {open && (
        <div
          onKeyDown={(event) => {
            event.stopPropagation();
            if (event.key === 'Escape') {
              event.preventDefault();
              close();
            }
            if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
              event.preventDefault();
              setIndex((previous) =>
                Math.max(
                  0,
                  Math.min(
                    results.length - 1,
                    previous + (event.key === 'ArrowDown' ? 1 : -1),
                  ),
                ),
              );
            }
            if (event.key === 'Enter') {
              event.preventDefault();
              const result = results[index] ?? results[0];
              if (result) pick(result.task.id);
            }
          }}
        >
          <label>
            Поиск задачи
            <input
              autoFocus
              role="combobox"
              aria-expanded="true"
              aria-controls={id}
              aria-activedescendant={
                results[index] ? `${id}-${index}` : undefined
              }
              value={query}
              onChange={(event) => {
                setQuery(event.target.value);
                setIndex(0);
              }}
            />
          </label>
          <div
            id={id}
            role="listbox"
            className="journal-picker-results"
            aria-label="Задачи для записи"
          >
            {results.map(({ task, path }, i) => (
              <button
                type="button"
                role="option"
                id={`${id}-${i}`}
                key={task.id}
                aria-selected={i === index}
                tabIndex={-1}
                onClick={() => pick(task.id)}
              >
                {path}
              </button>
            ))}
          </div>
          {!results.length && <p role="status">Задачи не найдены</p>}
        </div>
      )}
    </div>
  );
}
