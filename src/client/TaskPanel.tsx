import { useEffect, useState, type ReactNode } from 'react';
import type { Task } from '../shared/contracts.js';
import { TaskTree, type TreeAction } from './TaskTree.js';
import { subtreeIds } from './tree-view.js';
import { statusLabels, strings } from './strings.js';

type Draft = Pick<
  Task,
  'title' | 'description' | 'status' | 'inputStart' | 'inputFinish'
>;
const draftOf = (task: Task): Draft => ({
  title: task.title,
  description: task.description,
  status: task.status,
  inputStart: task.inputStart,
  inputFinish: task.inputFinish,
});
interface Props {
  task: Task;
  removed: boolean;
  tasks: Task[];
  collapsed: ReadonlySet<string>;
  onToggle: (id: string) => void;
  onSelect: (task: Task) => void;
  onAction: (action: TreeAction, task: Task) => void;
  onMove: (task: Task, parentId: string | null) => void;
  onSave: (changes: Draft) => Promise<boolean>;
  onDirty: (dirty: boolean) => void;
  onClose: () => void;
  busy: boolean;
  retry: boolean;
  conflict: boolean;
  locked: boolean;
  feedback: ReactNode;
}
export function TaskPanel({
  task,
  removed,
  tasks,
  collapsed,
  onToggle,
  onSelect,
  onAction,
  onMove,
  onSave,
  onDirty,
  onClose,
  busy,
  retry,
  conflict,
  locked,
  feedback,
}: Props) {
  const [draft, setDraft] = useState<Draft>(() => draftOf(task));
  const [baseline, setBaseline] = useState<Draft>(() => draftOf(task));
  const [saved, setSaved] = useState(false);
  const [tab, setTab] = useState<'details' | 'subtasks'>('details');
  const [moveParent, setMoveParent] = useState(task.parentId ?? '');
  const dirty = JSON.stringify(draft) !== JSON.stringify(baseline);
  const summary = tasks.some((child) => child.parentId === task.id);
  const excluded = removed ? new Set<string>() : subtreeIds(tasks, task.id);
  useEffect(() => {
    onDirty(dirty);
  }, [dirty, onDirty]);
  // Server reloads may update the tree, but never replace a dirty panel draft.
  useEffect(() => {
    if (!dirty && !busy) {
      const fresh = draftOf(task);
      setDraft(fresh);
      setBaseline(fresh);
    }
  }, [task, dirty, busy]);
  function update<K extends keyof Draft>(field: K, value: Draft[K]) {
    setDraft((previous) => ({ ...previous, [field]: value }));
    setSaved(false);
  }
  async function save() {
    if (busy || removed || conflict || !draft.title.trim()) return;
    const fields = { ...draft, title: draft.title.trim() };
    if (await onSave(fields)) {
      setDraft(fields);
      setBaseline(fields);
      setSaved(true);
      onDirty(false);
    }
  }
  return (
    <aside
      className="task-panel"
      aria-label={strings.task}
      onKeyDown={(event) => {
        if (event.key === 'Escape') {
          event.preventDefault();
          event.stopPropagation();
          onClose();
        }
      }}
    >
      <header className="panel-header">
        <h2>{task.title}</h2>
        <button
          type="button"
          aria-label={strings.close}
          disabled={busy || locked}
          onClick={onClose}
        >
          ×
        </button>
      </header>
      <div className="panel-tabs" role="tablist" aria-label={strings.task}>
        {(['details', 'subtasks'] as const).map((value) => (
          <button
            type="button"
            key={value}
            role="tab"
            id={`tab-${value}`}
            aria-controls={`panel-${value}`}
            aria-selected={tab === value}
            tabIndex={tab === value ? 0 : -1}
            onClick={() => setTab(value)}
            onKeyDown={(event) => {
              if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') {
                event.preventDefault();
                const next = tab === 'details' ? 'subtasks' : 'details';
                setTab(next);
                document.getElementById(`tab-${next}`)?.focus();
              }
            }}
          >
            {value === 'details' ? strings.details : strings.subtasks}
          </button>
        ))}
      </div>
      <div className="panel-content">
        {feedback}
        {removed && <p role="status">{strings.taskRemoved}</p>}
        {tab === 'details' ? (
          <div role="tabpanel" id="panel-details" aria-labelledby="tab-details">
            <form
              onSubmit={(event) => {
                event.preventDefault();
                void save();
              }}
            >
              <fieldset disabled={busy || locked}>
                <label>
                  {strings.title}
                  <input
                    autoFocus
                    value={draft.title}
                    maxLength={300}
                    onChange={(event) => update('title', event.target.value)}
                  />
                </label>
                <label>
                  {strings.status}
                  <select
                    value={draft.status}
                    onChange={(event) =>
                      update('status', event.target.value as Task['status'])
                    }
                  >
                    {Object.entries(statusLabels).map(([value, label]) => (
                      <option key={value} value={value}>
                        {label}
                      </option>
                    ))}
                  </select>
                </label>
                <div className="date-fields">
                  <label>
                    {strings.start}
                    <input
                      type="date"
                      disabled={summary || removed}
                      value={draft.inputStart ?? ''}
                      onChange={(event) =>
                        update('inputStart', event.target.value || null)
                      }
                    />
                  </label>
                  <label>
                    {strings.finish}
                    <input
                      type="date"
                      disabled={summary || removed}
                      value={draft.inputFinish ?? ''}
                      onChange={(event) =>
                        update('inputFinish', event.target.value || null)
                      }
                    />
                  </label>
                </div>
                <p className="field-hint">
                  {summary ? strings.summaryHint : strings.datesHint}
                </p>
                <label>
                  {strings.description}
                  <textarea
                    value={draft.description}
                    maxLength={10000}
                    rows={6}
                    onChange={(event) =>
                      update('description', event.target.value)
                    }
                  />
                </label>
              </fieldset>
              <div className="save-controls">
                <button
                  type="submit"
                  className="primary"
                  disabled={
                    busy ||
                    removed ||
                    conflict ||
                    (locked && !retry) ||
                    (!dirty && !retry) ||
                    !draft.title.trim()
                  }
                >
                  {busy
                    ? strings.saving
                    : retry
                      ? strings.retrySave
                      : strings.save}
                </button>
                <span role="status">
                  {busy
                    ? strings.saving
                    : saved && !dirty
                      ? strings.saved
                      : dirty
                        ? strings.dirty
                        : ''}
                </span>
              </div>
              {dirty && (
                <button
                  type="button"
                  className="quiet"
                  disabled={busy || locked}
                  onClick={() => {
                    const fresh = draftOf(task);
                    setDraft(fresh);
                    setBaseline(fresh);
                    setSaved(false);
                    onDirty(false);
                  }}
                >
                  {strings.discard}
                </button>
              )}
            </form>
          </div>
        ) : (
          <div
            role="tabpanel"
            id="panel-subtasks"
            aria-labelledby="tab-subtasks"
          >
            {tasks.some((child) => child.parentId === task.id) ? (
              <TaskTree
                tasks={tasks}
                rootId={task.id}
                selectedId={task.id}
                collapsed={collapsed}
                onToggle={onToggle}
                onSelect={onSelect}
                onAction={onAction}
                label={strings.subtasks}
              />
            ) : (
              <p className="empty-state">{strings.emptySubtasks}</p>
            )}
          </div>
        )}
        <div className="task-actions">
          <button
            type="button"
            disabled={busy || locked || removed || dirty}
            onClick={() => onAction('child', task)}
          >
            {strings.addChild}
          </button>
          <button
            type="button"
            disabled={busy || locked || removed || dirty}
            onClick={() => onAction('sibling', task)}
          >
            {strings.addSibling}
          </button>
        </div>
        <fieldset
          className="move-controls"
          disabled={busy || locked || removed || dirty}
        >
          <legend>{strings.move}</legend>
          <div className="order-actions">
            <button type="button" onClick={() => onAction('up', task)}>
              {strings.moveUp}
            </button>
            <button type="button" onClick={() => onAction('down', task)}>
              {strings.moveDown}
            </button>
            <button type="button" onClick={() => onAction('out', task)}>
              {strings.moveOut}
            </button>
            <button type="button" onClick={() => onAction('in', task)}>
              {strings.moveIn}
            </button>
          </div>
          <label>
            {strings.moveParent}
            <select
              value={moveParent}
              onChange={(event) => setMoveParent(event.target.value)}
            >
              <option value="">{strings.root}</option>
              {tasks
                .filter((candidate) => !excluded.has(candidate.id))
                .map((candidate) => (
                  <option key={candidate.id} value={candidate.id}>
                    {candidate.title}
                  </option>
                ))}
            </select>
          </label>
          <button
            type="button"
            onClick={() => onMove(task, moveParent || null)}
          >
            {strings.move}
          </button>
        </fieldset>
        <button
          type="button"
          className="danger quiet"
          disabled={busy || locked || removed || dirty}
          onClick={() => onAction('delete', task)}
        >
          {strings.delete}
        </button>
      </div>
    </aside>
  );
}
