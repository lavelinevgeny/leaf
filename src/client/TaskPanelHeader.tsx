import { useRef, useState, type ReactNode } from 'react';
import type { Task } from '../shared/contracts.js';
import { statusLabels, strings } from './strings.js';

interface Props {
  title: string;
  status: Task['status'];
  onTitle: (title: string) => void;
  onStatus: (status: Task['status']) => void;
  disabled: boolean;
  closeDisabled: boolean;
  onClose: () => void;
  back: ReactNode;
  actions?: ReactNode;
  schedule: ReactNode;
  path?: ReactNode;
  unsavedTitle?: boolean;
  journalTitle?: string | undefined;
}
export function TaskPanelHeader({
  title,
  status,
  onTitle,
  onStatus,
  disabled,
  closeDisabled,
  onClose,
  back,
  actions,
  schedule,
  journalTitle,
  path,
  unsavedTitle,
}: Props) {
  const [editing, setEditing] = useState(false);
  const snapshot = useRef(title);
  const trigger = useRef<HTMLButtonElement>(null);
  function finish() {
    setEditing(false);
    requestAnimationFrame(() => trigger.current?.focus());
  }
  const TitleContainer = journalTitle === undefined ? 'h2' : 'div';
  return (
    <header className="panel-header">
      <div className="panel-header-actions">
        {back}
        {actions}
        <button
          type="button"
          aria-label={strings.close}
          disabled={closeDisabled}
          onClick={onClose}
        >
          ×
        </button>
      </div>
      {path}
      {journalTitle !== undefined && (
        <>
          <h2>{journalTitle}</h2>
          {unsavedTitle && journalTitle !== title && (
            <p className="field-hint">Несохранённое название: {title}</p>
          )}
        </>
      )}
      {editing ? (
        <TitleContainer
          aria-label={journalTitle === undefined ? title : undefined}
        >
          {journalTitle !== undefined && (
            <p className="field-hint">Локальное название задачи</p>
          )}
          <label className="panel-title-editor">
            <span className="sr-only">{strings.title}</span>
            <input
              autoFocus
              value={title}
              maxLength={300}
              disabled={disabled}
              aria-invalid={!title.trim()}
              aria-describedby={
                !title.trim() ? 'task-panel-save-reason' : undefined
              }
              onChange={(event) => onTitle(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Escape') {
                  event.preventDefault();
                  event.stopPropagation();
                  onTitle(snapshot.current);
                  finish();
                } else if (event.key === 'Enter') {
                  event.preventDefault();
                  event.stopPropagation();
                  finish();
                }
              }}
            />
          </label>
        </TitleContainer>
      ) : (
        <TitleContainer
          aria-label={
            journalTitle === undefined ? title || strings.title : undefined
          }
        >
          <button
            ref={trigger}
            type="button"
            className="panel-title"
            aria-label={strings.editTitle}
            disabled={disabled}
            onClick={() => {
              snapshot.current = title;
              setEditing(true);
            }}
          >
            {journalTitle === undefined
              ? title || strings.title
              : strings.editTitle}
          </button>
        </TitleContainer>
      )}
      <label className="panel-status">
        {strings.status}
        <select
          aria-label={strings.status}
          value={status}
          disabled={disabled}
          onChange={(event) => onStatus(event.target.value as Task['status'])}
        >
          {Object.entries(statusLabels).map(([value, label]) => (
            <option key={value} value={value}>
              {label}
            </option>
          ))}
        </select>
      </label>
      {schedule}
    </header>
  );
}
