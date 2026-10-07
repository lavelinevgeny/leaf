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
  confirmed: { operationId: string; title: string } | null;
}
export function QuickAdd({
  tasks,
  context,
  onContext,
  onCreate,
  busy,
  blocked,
  confirmed,
}: Props) {
  const [title, setTitle] = useState('');
  const [editing, setEditing] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  const parent = tasks.find((task) => task.id === context.parentId);
  useEffect(() => {
    if (confirmed)
      setTitle((value) =>
        value.trim() === confirmed.title.trim() ? '' : value,
      );
  }, [confirmed]);
  async function submit() {
    if (!title.trim() || busy || blocked) return;
    if (await onCreate(title, context)) {
      setTitle('');
      input.current?.focus();
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
          id="quick-task"
          ref={input}
          aria-label={strings.newTask}
          placeholder={strings.newTask}
          value={title}
          maxLength={300}
          disabled={busy || blocked}
          onFocus={() => setEditing(true)}
          onChange={(event) => setTitle(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Escape') {
              event.preventDefault();
              event.stopPropagation();
              setEditing(false);
              return;
            }
            if (event.key !== 'Tab' || !editing) return;
            event.preventDefault();
            if (event.shiftKey && parent)
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
      </div>
    </form>
  );
}
