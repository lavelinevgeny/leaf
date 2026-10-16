import { useEffect, useRef, type KeyboardEvent } from 'react';

export function trapDialogKeys(event: KeyboardEvent<HTMLDialogElement>) {
  event.stopPropagation();
  if (event.key !== 'Tab') return;
  const controls = [
    ...event.currentTarget.querySelectorAll<HTMLElement>(
      'button:not(:disabled), input:not(:disabled), select:not(:disabled), summary, [tabindex="0"]',
    ),
  ].filter(
    (node) =>
      !node.closest('details:not([open])') || node.tagName === 'SUMMARY',
  );
  const first = controls[0],
    last = controls.at(-1);
  if (
    event.shiftKey &&
    (document.activeElement === first ||
      !event.currentTarget.contains(document.activeElement))
  ) {
    event.preventDefault();
    last?.focus();
  } else if (!event.shiftKey && document.activeElement === last) {
    event.preventDefault();
    first?.focus();
  }
}
export function TaskLeaveDialog({
  blocked,
  saving,
  onSave,
  onDiscard,
  onContinue,
}: {
  blocked: boolean;
  saving: boolean;
  onSave: () => void;
  onDiscard: () => void;
  onContinue: () => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const trigger = document.activeElement;
    const node = dialog.current!;
    node.showModal();
    node.querySelector<HTMLButtonElement>('[data-continue]')?.focus();
    return () => {
      const restore =
        node.contains(document.activeElement) ||
        document.activeElement === document.body;
      node.close();
      if (restore && trigger instanceof HTMLElement && trigger.isConnected)
        trigger.focus({ preventScroll: true });
    };
  }, []);
  return (
    <dialog
      ref={dialog}
      className="task-dialog"
      aria-labelledby="task-leave-title"
      onKeyDown={trapDialogKeys}
      onCancel={(event) => {
        event.preventDefault();
        if (!blocked) onContinue();
      }}
    >
      <h2 id="task-leave-title">Несохранённые изменения задачи</h2>
      <p>Сохранить изменения перед переходом?</p>
      {blocked && (
        <p id="task-leave-reason" role="status">
          {saving
            ? 'Сохраняем…'
            : 'Не удалось подтвердить сохранение. Повторите сохранение в карточке.'}
        </p>
      )}
      <div className="dialog-actions">
        <button type="button" disabled={blocked} onClick={onSave}>
          Сохранить
        </button>
        <button
          type="button"
          disabled={blocked}
          aria-describedby={blocked ? 'task-leave-reason' : undefined}
          onClick={onDiscard}
        >
          Не сохранять
        </button>
        <button
          type="button"
          data-continue=""
          disabled={saving}
          onClick={onContinue}
        >
          Продолжить редактирование
        </button>
      </div>
    </dialog>
  );
}
