import type { ReactNode } from 'react';
import { strings } from './strings.js';

interface Props {
  dirty: boolean;
  busy: boolean;
  saving: boolean;
  retry: boolean;
  disabledReason: string | null;
  onSave: () => void;
  onReset: () => void;
  onRepair: () => void;
  feedback: ReactNode;
  saved: boolean;
  canAdopt: boolean;
  resetDisabled: boolean;
  editorOwnsSave: boolean;
  descriptionEditing: boolean;
  hasFeedback: boolean;
}
export function TaskPanelFooter({
  dirty,
  busy,
  saving,
  retry,
  disabledReason,
  onSave,
  onReset,
  onRepair,
  feedback,
  saved,
  canAdopt,
  resetDisabled,
  editorOwnsSave,
  descriptionEditing,
  hasFeedback,
}: Props) {
  return (
    <footer
      className="panel-footer"
      aria-label={strings.taskSave}
      hidden={
        !dirty &&
        !busy &&
        !saving &&
        !retry &&
        !canAdopt &&
        !saved &&
        !hasFeedback &&
        !disabledReason
      }
    >
      {feedback}
      <div role="status">
        {saving
          ? strings.saving
          : saved && !dirty
            ? strings.saved
            : dirty
              ? strings.dirty
              : ''}
      </div>
      {disabledReason && <p id="task-panel-save-reason">{disabledReason}</p>}
      {(retry || canAdopt || dirty || !!disabledReason) && (
        <div className="save-controls">
          {(!editorOwnsSave || retry || canAdopt) && (
            <button
              type="submit"
              form="task-panel-edit"
              className="primary"
              aria-label={
                descriptionEditing && !retry
                  ? 'Сохранить все изменения'
                  : undefined
              }
              disabled={!!disabledReason || (!dirty && !retry && !canAdopt)}
              aria-describedby={
                disabledReason ? 'task-panel-save-reason' : undefined
              }
              onClick={(event) => {
                event.preventDefault();
                onSave();
              }}
            >
              {saving
                ? strings.saving
                : retry
                  ? strings.retrySave
                  : strings.save}
            </button>
          )}
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
                {disabledReason === strings.planInputError
                  ? strings.repairSchedule
                  : strings.repairTask}
              </button>
            )}
        </div>
      )}
    </footer>
  );
}
