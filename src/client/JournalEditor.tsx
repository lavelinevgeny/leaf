import { useId, useLayoutEffect, useRef, type ReactNode } from 'react';
import type { JournalDraft, JournalController } from './journal-state.js';
import { journalUpdateSchema } from '../shared/journal-contracts.js';
import { calendarDateSchema } from '../shared/contracts.js';
import { CalendarDateInput } from './CalendarDateInput.js';
export function JournalEditor({
  draft,
  controller,
  disabled,
  onSaved,
  onCancel,
  taskPicker,
  placeholder,
  compactIdle = false,
}: {
  draft: JournalDraft;
  controller: JournalController;
  disabled: boolean;
  onSaved: () => void;
  onCancel?: () => void;
  taskPicker?: ReactNode;
  placeholder?: string;
  compactIdle?: boolean;
}) {
  const id = useId();
  const textarea = useRef<HTMLTextAreaElement>(null);
  const fontProbe = useRef<HTMLSpanElement>(null);
  useLayoutEffect(() => {
    const node = textarea.current;
    if (!node?.closest('.task-journal')) return;
    const resize = () => {
      node.style.height = 'auto';
      const style = getComputedStyle(node);
      const border =
        style.boxSizing === 'border-box'
          ? parseFloat(style.borderTopWidth) +
            parseFloat(style.borderBottomWidth)
          : 0;
      node.style.height = `${node.scrollHeight + border}px`;
    };
    resize();
    let active = true;
    const resizeFont = () => {
      if (active) resize();
    };
    void document.fonts?.ready.then(resizeFont);
    document.fonts?.addEventListener('loadingdone', resizeFont);
    const observer =
      typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(resize);
    if (node.parentElement) observer?.observe(node.parentElement);
    if (fontProbe.current) observer?.observe(fontProbe.current);
    return () => {
      active = false;
      observer?.disconnect();
      document.fonts?.removeEventListener('loadingdone', resizeFont);
    };
  }, [draft.body]);
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
  const idle =
    compactIdle &&
    !draft.entryId &&
    draft.body === '' &&
    !controller.mutationError &&
    !conflict &&
    !controller.uncertain &&
    controller.pending?.key !== draft.key;
  const showClear = !compactIdle || draft.dirty || draft.body !== '';
  const dateValid = calendarDateSchema.safeParse(draft.workDate).success;
  const hintVisible =
    !compactIdle ||
    !dateValid ||
    draft.body.length > 10000 ||
    (draft.body !== '' && !draft.body.trim());
  return (
    <form
      className={`journal-editor${compactIdle ? ' journal-editor--compact' : ''}`}
      data-journal-editor
      onSubmit={(event) => {
        event.preventDefault();
        void submit();
      }}
      onKeyDown={(event) => {
        if (event.nativeEvent.isComposing) return;
        if ((event.ctrlKey || event.metaKey) && event.key === 'Enter') {
          event.preventDefault();
          void submit();
        }
      }}
    >
      {taskPicker}
      <label>
        <span className={compactIdle ? 'sr-only' : undefined}>
          Текст записи
        </span>
        <textarea
          ref={textarea}
          data-journal-body
          value={draft.body}
          rows={compactIdle ? 2 : 5}
          placeholder={placeholder}
          disabled={locked}
          aria-describedby={id}
          onChange={(event) =>
            controller.changeDraft(draft.key, { body: event.target.value })
          }
        />
        <span
          ref={fontProbe}
          className="journal-font-probe"
          aria-hidden="true"
        />
      </label>
      <p
        id={id}
        className={hintVisible ? 'journal-hint' : 'journal-hint sr-only'}
      >
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
      <div className="journal-editor-footer">
        <CalendarDateInput
          label="Дата записи"
          value={draft.workDate}
          disabled={locked}
          invalid={!dateValid}
          descriptionId={id}
          onChange={(value) =>
            controller.changeDraft(draft.key, { workDate: value ?? '' })
          }
        />
        <div className="journal-editor-actions">
          {!idle && (
            <button
              type="submit"
              className="primary"
              aria-label={compactIdle ? 'Сохранить запись' : undefined}
              title={compactIdle ? 'Сохранить запись' : undefined}
              disabled={
                locked ||
                !valid ||
                !draft.taskId ||
                conflict ||
                controller.unavailableTaskIds.has(draft.taskId ?? '')
              }
            >
              {compactIdle ? (
                <svg
                  aria-hidden="true"
                  viewBox="0 0 24 24"
                  width="18"
                  height="18"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="1.8"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                >
                  <path d="m5 12 4 4L19 6" />
                </svg>
              ) : (
                'Сохранить запись'
              )}
            </button>
          )}
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
          {showClear && (
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
          )}
        </div>
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
