import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { Task } from '../shared/contracts.js';
import type { JournalController, JournalDraftKey } from './journal-state.js';
import { createDraftKey } from './journal-state.js';
import { JournalEditor } from './JournalEditor.js';
import { JournalFeed } from './JournalFeed.js';
export function TaskJournal({
  controller,
  disabled = false,
  task,
  today,
  onEditorReady,
  scrollContainer,
}: {
  controller: JournalController;
  disabled?: boolean;
  task: Task;
  today: string;
  scrollContainer?: HTMLElement | null | undefined;
  onEditorReady?: ((editor: HTMLTextAreaElement) => void) | undefined;
}) {
  const [key, setKey] = useState<JournalDraftKey | null>(null);
  useEffect(() => {
    if (controller.active)
      setKey(
        controller.getDraft(createDraftKey(task.projectId, task.id))?.key ??
          controller.openCreate(task.projectId, task.id, today),
      );
  }, [task.id, controller.active]);
  const draft = key ? controller.getDraft(key) : undefined;
  const root = useRef<HTMLDivElement>(null);
  // Set by a successful save or clear; consumed after the next commit that
  // renders an enabled composer, so an async save cannot outrun the focus.
  // The draft key is stable per task, so the tick guarantees that commit.
  const focusPending = useRef(false);
  const [, requestFocus] = useState(0);
  useLayoutEffect(() => {
    const node = root.current;
    const editor = node?.querySelector<HTMLTextAreaElement>(
      '[data-journal-editor] textarea',
    );
    if (!editor) return;
    if (editor.disabled) {
      // Blocked by the panel rather than by this save: drop the request so a
      // stale flag cannot move focus when the composer is enabled later.
      if (!controller.writing) focusPending.current = false;
      return;
    }
    onEditorReady?.(editor);
    if (!focusPending.current || !node) return;
    const active = document.activeElement;
    focusPending.current = false;
    if (
      !node.closest('[hidden]') &&
      (!active || active === document.body || node.contains(active))
    )
      editor.focus({ preventScroll: true });
  });
  return (
    <div className="task-journal" ref={root}>
      {draft ? (
        <JournalEditor
          draft={draft}
          controller={controller}
          disabled={disabled || !controller.active}
          placeholder="Что сделали или узнали по задаче?"
          compactIdle
          onSaved={() => {
            setKey(controller.openCreate(task.projectId, task.id, today));
            focusPending.current = true;
            requestFocus((tick) => tick + 1);
          }}
        />
      ) : (
        <button
          type="button"
          data-journal-add
          disabled={disabled || !controller.active || !!controller.pending}
          onClick={() =>
            setKey(controller.openCreate(task.projectId, task.id, today))
          }
        >
          Добавить запись
        </button>
      )}
      {controller.notice &&
        !controller.mutationError &&
        controller.lastWrite?.projectId === task.projectId &&
        controller.lastWrite.taskId === task.id && (
          <p role="status">{controller.notice}</p>
        )}
      {controller.taskFeed ? (
        <JournalFeed
          disabled={disabled}
          scrollContainer={scrollContainer}
          state={controller.taskFeed}
          controller={controller}
          showTaskTitles={false}
          onOpenTask={() => {}}
        />
      ) : (
        <p role="status">Загрузка журнала…</p>
      )}
    </div>
  );
}
