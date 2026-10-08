import { useEffect, useRef, useState } from 'react';
import type { Task } from '../shared/contracts.js';
import { orderedChildren } from './tree-view.js';
import { strings } from './strings.js';
export interface AddContext {
  parentId: string | null;
  afterId?: string;
}
interface Props {
  tasks: Task[];
  context: AddContext;
  onContext: (context: AddContext) => void;
  onCreate: (title: string, context: AddContext) => Promise<boolean>;
  busy: boolean;
  blocked: boolean;
  title: string;
  onTitle: (title: string) => void;
  inputId?: string;
  rootId?: string;
}
export function QuickAdd({
  tasks,
  context,
  onContext,
  onCreate,
  busy,
  blocked,
  title,
  onTitle,
  inputId = 'quick-task',
  rootId,
}: Props) {
  const [editing, setEditing] = useState(false);
  const [restoreFocus, setRestoreFocus] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  const parent = tasks.find((task) => task.id === context.parentId);
  useEffect(() => {
    if (!restoreFocus || busy || blocked) return;
    if (
      document.activeElement === document.body ||
      document.activeElement === input.current
    )
      input.current?.focus();
    setRestoreFocus(false);
  }, [restoreFocus, busy, blocked]);
  async function submit() {
    if (!title.trim() || busy || blocked) return;
    if (await onCreate(title, context)) {
      setRestoreFocus(true);
    }
  }
  return (
    <form
      className="quick-add"
      onSubmit={(event) => {
        event.preventDefault();
        void submit();
      }}
    >
      <div className="quick-line">
        <span aria-hidden="true">＋</span>
        <input
          id={inputId}
          ref={input}
          aria-label={strings.newTask}
          placeholder={strings.newTask}
          value={title}
          maxLength={300}
          disabled={busy || blocked}
          onFocus={() => setEditing(true)}
          onChange={(event) => onTitle(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Escape') {
              event.preventDefault();
              event.stopPropagation();
              setEditing(false);
              return;
            }
            if (event.key !== 'Tab' || !editing) return;
            event.preventDefault();
            if (event.shiftKey && parent && parent.id !== rootId)
              onContext({ parentId: parent.parentId, afterId: parent.id });
            else if (!event.shiftKey) {
              const candidate =
                tasks.find((task) => task.id === context.afterId) ??
                orderedChildren(tasks, context.parentId).at(-1);
              if (candidate) onContext({ parentId: candidate.id });
            }
          }}
        />
        <button type="submit" disabled={busy || blocked || !title.trim()}>
          {strings.addTask}
        </button>
      </div>
      <div className="quick-meta">
        <span>
          {strings.parent}: {parent?.title ?? strings.root}
        </span>
        <span>{strings.quickHint}</span>
        {title && (
          <>
            <span role="status">{strings.quickDirty}</span>
            <button
              type="button"
              disabled={busy || blocked}
              onClick={() => onTitle('')}
            >
              {strings.clearQuick}
            </button>
          </>
        )}
      </div>
    </form>
  );
}
