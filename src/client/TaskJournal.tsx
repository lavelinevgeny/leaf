import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { Task } from '../shared/contracts.js';
import type { JournalController, JournalDraftKey } from './journal-state.js';
import { createDraftKey } from './journal-state.js';
import { JournalEditor } from './JournalEditor.js';
import { JournalFeed, journalUndoCopy } from './JournalFeed.js';
export function TaskJournal({
  controller,
  disabled = false,
  task,
  today,
  onEditorReady,
}: {
  controller: JournalController;
  disabled?: boolean;
  task: Task;
  today: string;
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
  useLayoutEffect(() => {
    const editor = root.current?.querySelector<HTMLTextAreaElement>(
      '[data-journal-editor] textarea',
    );
    if (editor && !editor.disabled) onEditorReady?.(editor);
  });
  return (
    <div className="task-journal" ref={root}>
      <p className="journal-hint">{journalUndoCopy}</p>
      {draft ? (
        <JournalEditor
          draft={draft}
          controller={controller}
          disabled={disabled || !controller.active}
          onSaved={() =>
            setKey(controller.openCreate(task.projectId, task.id, today))
          }
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
      {controller.notice && <p role="status">{controller.notice}</p>}
      {controller.taskFeed ? (
        <JournalFeed
          disabled={disabled}
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
