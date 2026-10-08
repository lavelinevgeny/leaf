import { useEffect, useRef, useState, type ReactNode } from 'react';
import {
  sourceFieldsSchema,
  type Task,
  type SourceFields,
  type ProjectTree,
} from '../shared/contracts.js';
import { PlanFields } from './PlanFields.js';
import { sourceOf } from './planning-view.js';
import { ScheduleStatus } from './ScheduleStatus.js';
import { Dependencies } from './Dependencies.js';
import type { Command } from '../shared/contracts.js';
import { TaskTree, type TreeAction } from './TaskTree.js';
import { subtreeIds } from './tree-view.js';
import { statusLabels, strings } from './strings.js';

type Draft = Pick<Task, 'title' | 'description' | 'status'>;
const draftOf = (task: Task): Draft => ({
  title: task.title,
  description: task.description,
  status: task.status,
});
export type PanelTab = 'details' | 'subtasks' | 'dependencies';
interface Props {
  task: Task;
  removed: boolean;
  tasks: Task[];
  tree: ProjectTree;
  tab: PanelTab;
  onTab: (tab: PanelTab) => void;
  onDependency: (command: Command) => Promise<boolean>;
  onNeighbor: (task: Task) => void;
  onShow: (task: Task) => void;
  backTask: Task | null;
  onBack: () => void;
  collapsed: ReadonlySet<string>;
  onToggle: (id: string) => void;
  onSelect: (task: Task) => void;
  onAction: (action: TreeAction, task: Task) => void;
  onMove: (task: Task, parentId: string | null) => void;
  onSave: (
    changes: Partial<Draft> & import('../shared/contracts.js').SourcePatch,
  ) => Promise<boolean>;
  onDirty: (dirty: boolean) => void;
  onClose: () => void;
  busy: boolean;
  retry: boolean;
  conflict: boolean;
  locked: boolean;
  feedback: ReactNode;
  subtaskInput?: ReactNode;
}
export function TaskPanel({
  task,
  removed,
  tasks,
  tree,
  tab,
  onTab,
  onDependency,
  onNeighbor,
  onShow,
  backTask,
  onBack,
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
  subtaskInput,
}: Props) {
  const [draft, setDraft] = useState<Draft>(() => draftOf(task));
  const [baseline, setBaseline] = useState<Draft>(() => draftOf(task));
  const [plan, setPlan] = useState<SourceFields>(() => sourceOf(task));
  const [baselinePlan, setBaselinePlan] = useState<SourceFields>(() =>
    sourceOf(task),
  );
  const [saved, setSaved] = useState(false);
  const [moveParent, setMoveParent] = useState(task.parentId ?? '');
  const previousParent = useRef(task.parentId);
  const unavailable = tree.schedule.diagnostics.some(
    (item) =>
      item.code === 'LEGACY_INTERVAL_UNAVAILABLE' &&
      item.taskIds.includes(task.id),
  );
  const canAdopt =
    unavailable &&
    task.status !== 'done' &&
    draft.status !== 'done' &&
    !summaryOfTask();
  function summaryOfTask() {
    return tasks.some((child) => child.parentId === task.id);
  }
  const planDirty = JSON.stringify(plan) !== JSON.stringify(baselinePlan);
  const dirty = JSON.stringify(draft) !== JSON.stringify(baseline) || planDirty;
  const summary = tasks.some((child) => child.parentId === task.id);
  const excluded = removed ? new Set<string>() : subtreeIds(tasks, task.id);
  useEffect(() => {
    const parentChanged = previousParent.current !== task.parentId;
    setMoveParent((preview) =>
      parentChanged ||
      (preview &&
        (!tasks.some((candidate) => candidate.id === preview) ||
          excluded.has(preview)))
        ? (task.parentId ?? '')
        : preview,
    );
    previousParent.current = task.parentId;
  }, [task.parentId, tasks, removed]);
  useEffect(() => {
    onDirty(dirty);
  }, [dirty, onDirty]);
  // Server reloads may update the tree, but never replace a dirty panel draft.
  useEffect(() => {
    if (!dirty && !busy) {
      const fresh = draftOf(task);
      setDraft(fresh);
      setBaseline(fresh);
      setPlan(sourceOf(task));
      setBaselinePlan(sourceOf(task));
    }
  }, [task, dirty, busy]);
  function update<K extends keyof Draft>(field: K, value: Draft[K]) {
    setDraft((previous) => ({ ...previous, [field]: value }));
    setSaved(false);
  }
  async function save() {
    if (busy || removed || conflict || !draft.title.trim()) return;
    const fields = { ...draft, title: draft.title.trim() };
    if (!summary && planDirty && !sourceFieldsSchema.safeParse(plan).success)
      return;
    const changes: Partial<Draft> &
      import('../shared/contracts.js').SourcePatch = {};
    for (const key of ['title', 'description', 'status'] as const)
      if (fields[key] !== baseline[key])
        Object.assign(changes, { [key]: fields[key] });
    if (!summary)
      for (const key of ['inputStart', 'inputFinish', 'durationDays'] as const)
        if (plan[key] !== baselinePlan[key] || (canAdopt && !dirty))
          Object.assign(changes, { [key]: plan[key] });
    if (await onSave(changes)) {
      setDraft(fields);
      setBaseline(fields);
      setBaselinePlan(plan);
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
        {backTask && (
          <button
            type="button"
            className="quiet panel-back"
            aria-label={`${strings.back}: ${backTask.title}`}
            disabled={busy || locked || dirty}
            onClick={onBack}
          >
            ←
          </button>
        )}
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
        {(['details', 'subtasks', 'dependencies'] as const).map((value) => (
          <button
            type="button"
            key={value}
            role="tab"
            id={`tab-${value}`}
            aria-controls={`panel-${value}`}
            aria-selected={tab === value}
            tabIndex={tab === value ? 0 : -1}
            onClick={() => onTab(value)}
            onKeyDown={(event) => {
              if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') {
                event.preventDefault();
                const tabs = ['details', 'subtasks', 'dependencies'] as const;
                const next =
                  tabs[
                    (tabs.indexOf(tab) + (event.key === 'ArrowRight' ? 1 : 2)) %
                      3
                  ]!;
                onTab(next);
                document.getElementById(`tab-${next}`)?.focus();
              }
            }}
          >
            {strings[value]}
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
                    aria-label={strings.status}
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
                <PlanFields
                  task={{
                    ...task,
                    status:
                      task.status === 'done' && draft.status === 'done'
                        ? 'done'
                        : 'doing',
                  }}
                  plan={plan}
                  computed={
                    tree.schedule.tasks[task.id] ??
                    tree.schedule.summaries[task.id]
                  }
                  calendar={tree.project.calendarType}
                  summary={summary}
                  disabled={removed}
                  onChange={(next) => {
                    setPlan(next);
                    setSaved(false);
                  }}
                />
                <ScheduleStatus tree={tree} task={task} />
                <label>
                  {strings.description}
                  <textarea
                    aria-label={strings.description}
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
                    (!dirty && !retry && !canAdopt) ||
                    !draft.title.trim() ||
                    (!summary &&
                      planDirty &&
                      !sourceFieldsSchema.safeParse(plan).success)
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
                    setPlan(sourceOf(task));
                    setBaselinePlan(sourceOf(task));
                    setSaved(false);
                    onDirty(false);
                  }}
                >
                  {strings.discard}
                </button>
              )}
            </form>
          </div>
        ) : tab === 'subtasks' ? (
          <div
            role="tabpanel"
            id="panel-subtasks"
            aria-labelledby="tab-subtasks"
          >
            {!summary && !removed && (
              <p className="empty-state">{strings.emptySubtasks}</p>
            )}
            {!removed && (
              <TaskTree
                tasks={tasks}
                rootId={task.id}
                selectedId={task.id}
                collapsed={collapsed}
                onToggle={onToggle}
                onSelect={onSelect}
                onAction={onAction}
                label={strings.subtasks}
                schedule={tree.schedule}
                quickInputId="quick-subtask"
              />
            )}
            {subtaskInput}
          </div>
        ) : (
          <div
            role="tabpanel"
            id="panel-dependencies"
            aria-labelledby="tab-dependencies"
          >
            <Dependencies
              task={task}
              tree={tree}
              disabled={busy || locked || conflict || removed || dirty}
              onCommand={onDependency}
              onSelect={onNeighbor}
              onShow={onShow}
            />
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
