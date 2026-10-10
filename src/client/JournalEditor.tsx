import { useId, type ReactNode } from 'react';
import type { JournalDraft, JournalController } from './journal-state.js';
import { journalUpdateSchema } from '../shared/journal-contracts.js';
import { CalendarDateInput } from './CalendarDateInput.js';
export function JournalEditor({
  draft,
  controller,
  disabled,
  onSaved,
  onCancel,
  taskPicker,
}: {
  draft: JournalDraft;
  controller: JournalController;
  disabled: boolean;
  onSaved: () => void;
  onCancel?: () => void;
  taskPicker?: ReactNode;
}) {
  const id = useId();
  const locked = disabled || controller.writing || !!controller.pending;
  const valid = journalUpdateSchema.safeParse({
    journalContractVersion: 1,
    operationId: '00000000-0000-4000-8000-000000000000',
    expectedJournalRevision: draft.baselineJournalRevision,
    body: draft.body,
    workDate: draft.workDate,
  }).success;
  const submit = async () => {
    if (!locked && (await controller.submit(draft.key))) onSaved();
  };
  const conflict = controller.activeConflictKey === draft.key;
  return (
    <form
      className="journal-editor"
      data-journal-editor
      onSubmit={(event) => {
        event.preventDefault();
        void submit();
      }}
      onKeyDown={(event) => {
        if ((event.ctrlKey || event.metaKey) && event.key === 'Enter') {
          event.preventDefault();
          void submit();
        }
      }}
    >
      {taskPicker}
      <CalendarDateInput
        label="Дата записи"
        value={draft.workDate}
        disabled={locked}
        invalid={!draft.workDate}
        descriptionId={id}
        onChange={(value) =>
          controller.changeDraft(draft.key, { workDate: value ?? '' })
        }
      />
      <label>
        Текст записи
        <textarea
          data-journal-body
          value={draft.body}
          rows={5}
          disabled={locked}
          aria-describedby={id}
          onChange={(event) =>
            controller.changeDraft(draft.key, { body: event.target.value })
          }
        />
      </label>
      <p id={id} className="journal-hint">
        {draft.body.length}/10000 · Нужны дата и непустой текст. Ctrl/Cmd+Enter
        — сохранить.
      </p>
      {controller.unavailableTaskIds.has(draft.taskId ?? '') && (
        <p role="alert">Задача удалена. Скопируйте текст черновика.</p>
      )}
      {controller.mutationError && (
        <p role="alert">{controller.mutationError}</p>
      )}
      {conflict && (
        <JournalConflict controller={controller} draftKey={draft.key} />
      )}
      <div className="journal-editor-actions">
        <button
          type="submit"
          className="primary"
          disabled={
            locked ||
            !valid ||
            !draft.taskId ||
            conflict ||
            controller.unavailableTaskIds.has(draft.taskId ?? '')
          }
        >
          Сохранить запись
        </button>
        {controller.uncertain && (
          <button
            type="button"
            disabled={controller.writing}
            onClick={() =>
              void controller.retry().then((saved) => {
                if (saved) onSaved();
              })
            }
          >
            Повторить сохранение
          </button>
        )}
        {onCancel && (
          <button
            type="button"
            disabled={controller.writing || !!controller.pending}
            onClick={() => onCancel()}
          >
            Закрыть редактор
          </button>
        )}
        <button
          type="button"
          disabled={locked}
          onClick={() => {
            if (
              (!draft.body && !draft.dirty) ||
              window.confirm('Очистить черновик записи?')
            ) {
              controller.clearDraft(draft.key);
              onSaved();
            }
          }}
        >
          Очистить черновик
        </button>
      </div>
    </form>
  );
}
export function JournalConflict({
  controller,
  draftKey,
}: {
  controller: JournalController;
  draftKey: JournalDraft['key'];
}) {
  if (!controller.getDraft(draftKey)?.entryId && controller.getDraft(draftKey))
    return (
      <button
        type="button"
        onClick={() => controller.acceptCurrent(draftKey, 'keep-own')}
      >
        Принять текущую версию журнала
      </button>
    );
  return (
    <div className="journal-conflict">
      <button
        type="button"
        disabled={controller.writing}
        onClick={() => void controller.showCurrent()}
      >
        Показать текущую запись
      </button>
      {controller.conflictRemoved ? (
        <p role="alert">
          Запись удалена. Можно скопировать свой текст; восстановление через
          этот редактор недоступно.
        </p>
      ) : (
        controller.conflictCurrent && (
          <>
            <p>
              Текущая дата:{' '}
              {controller.conflictCurrent.entry.workDate
                .split('-')
                .reverse()
                .join('.')}
            </p>
            <p className="journal-body">
              {controller.conflictCurrent.entry.body}
            </p>
            <button
              type="button"
              onClick={() => controller.acceptCurrent(draftKey, 'replace')}
            >
              Заменить черновик текущей записью
            </button>
            <button
              type="button"
              onClick={() => controller.acceptCurrent(draftKey, 'keep-own')}
            >
              Оставить мой текст и принять текущую версию
            </button>
            <p>После выбора сохраните отдельно.</p>
          </>
        )
      )}
    </div>
  );
}
