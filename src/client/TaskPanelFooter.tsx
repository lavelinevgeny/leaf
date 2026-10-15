import type { ReactNode } from 'react';
import { strings } from './strings.js';

interface Props {
  dirty: boolean;
  busy: boolean;
  retry: boolean;
  disabledReason: string | null;
  onSave: () => void;
  onReset: () => void;
  onRepair: () => void;
  feedback: ReactNode;
  saved: boolean;
  canAdopt: boolean;
  resetDisabled: boolean;
}
export function TaskPanelFooter({
  dirty,
  busy,
  retry,
  disabledReason,
  onSave,
  onReset,
  onRepair,
  feedback,
  saved,
  canAdopt,
  resetDisabled,
}: Props) {
  return (
    <footer className="panel-footer" aria-label={strings.taskSave}>
      {feedback}
      <div role="status">
        {busy
          ? strings.saving
          : saved && !dirty
            ? strings.saved
            : dirty
              ? strings.dirty
              : ''}
      </div>
      {disabledReason && <p id="task-panel-save-reason">{disabledReason}</p>}
      <div className="save-controls">
        <button
          type="submit"
          form="task-panel-edit"
          className="primary"
          disabled={!!disabledReason || (!dirty && !retry && !canAdopt)}
          aria-describedby={
            disabledReason ? 'task-panel-save-reason' : undefined
          }
          onClick={(event) => {
            event.preventDefault();
            onSave();
          }}
        >
          {busy ? strings.saving : retry ? strings.retrySave : strings.save}
        </button>
        {dirty && (
          <button
            type="button"
            className="quiet"
            disabled={resetDisabled}
            onClick={onReset}
          >
            {strings.resetTask}
          </button>
        )}
        {dirty &&
          (disabledReason === strings.titleRequired ||
            disabledReason === strings.planInputError) &&
          !busy &&
          !retry && (
            <button type="button" className="quiet" onClick={onRepair}>
              {strings.repairTask}
            </button>
          )}
      </div>
    </footer>
  );
}
