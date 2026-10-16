import { useRef, useState, type ReactNode } from 'react';
import type { Task } from '../shared/contracts.js';
import { statusLabels, strings } from './strings.js';
import { ActionMenu } from './ActionMenu.js';

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
  const [statusOpen, setStatusOpen] = useState(false);
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
      {journalTitle !== undefined && editing && <h2>{journalTitle}</h2>}
      {journalTitle !== undefined && unsavedTitle && journalTitle !== title && (
        <p className="field-hint">Несохранённое название: {title}</p>
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
        <h2 aria-label={journalTitle ?? (title || strings.title)}>
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
            {journalTitle ?? (title || strings.title)}
          </button>
        </h2>
      )}
      <div className="panel-properties">
        <ActionMenu
          label={`${strings.status}: ${statusLabels[status]}`}
          className={`panel-status panel-status--${status}`}
          open={statusOpen}
          onOpenChange={setStatusOpen}
          disabled={disabled}
          triggerContent={
            <>
              <span className="panel-status-dot" aria-hidden="true" />
              {statusLabels[status]}
              <svg
                className="panel-chip-icon"
                width="16"
                height="16"
                viewBox="0 0 20 20"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.6"
                strokeLinecap="round"
                strokeLinejoin="round"
                aria-hidden="true"
              >
                <path d="m5 7.5 5 5 5-5" />
              </svg>
            </>
          }
          items={Object.entries(statusLabels).map(([value, label]) => ({
            id: value,
            label,
            selected: value === status,
            onSelect: (trigger) => {
              onStatus(value as Task['status']);
              trigger.focus({ preventScroll: true });
            },
          }))}
        />
        {schedule}
      </div>
    </header>
  );
}
