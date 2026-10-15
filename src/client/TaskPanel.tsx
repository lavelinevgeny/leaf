import { useEffect, useRef, useState, type ReactNode } from 'react';
import {
  sourceFieldsSchema,
  type Task,
  type SourceFields,
  type ProjectTree,
} from '../shared/contracts.js';
import { PredecessorPicker } from './PredecessorPicker.js';
import { ControlIcon } from './ControlIcon.js';
import {
  incomingPredecessorIds,
  canonicalPredecessorIds,
} from './predecessor-view.js';
import { PlanFields } from './PlanFields.js';
import { TaskPanelHeader } from './TaskPanelHeader.js';
import { TaskPanelFooter } from './TaskPanelFooter.js';
import { visiblePanelTab } from './task-panel-view.js';
import { useTaskPanelLayout } from './use-task-panel-layout.js';
import { sourceOf } from './planning-view.js';
import { ScheduleStatus } from './ScheduleStatus.js';
import { Dependencies } from './Dependencies.js';
import type { Command } from '../shared/contracts.js';
import { TaskTree, type TreeAction } from './TaskTree.js';
import { subtreeIds } from './tree-view.js';
import { strings } from './strings.js';

type Draft = Pick<Task, 'title' | 'description' | 'status'>;
const draftOf = (task: Task): Draft => ({
  title: task.title,
  description: task.description,
  status: task.status,
});
export type PanelTab = 'details' | 'subtasks' | 'dependencies' | 'journal';
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
  onSelect: (task: Task) => boolean | void;
  onAction: (action: TreeAction, task: Task) => boolean | void;
  onMove: (task: Task, parentId: string | null) => void;
  onSave: (
    changes: Extract<Command, { type: 'task.edit' }>['changes'],
  ) => Promise<ProjectTree | null>;
  saveAcknowledgement?: ProjectTree | null;
  onDirty: (dirty: boolean) => void;
  onClose: () => void;
  busy: boolean;
  retry: boolean;
  conflict: boolean;
  locked: boolean;
  feedback: ReactNode;
  subtaskInput?: ReactNode;
  subtaskDraftActive?: boolean;
  journalContent?: ReactNode;
  journalTitle?: string | undefined;
  onJournal?:
    ((task: Task, trigger: HTMLElement) => boolean | void) | undefined;
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
  saveAcknowledgement,
  onDirty,
  onClose,
  busy,
  retry,
  conflict,
  locked,
  feedback,
  subtaskInput,
  subtaskDraftActive = false,
  journalContent,
  journalTitle,
  onJournal,
}: Props) {
  const visibleTab = visiblePanelTab(tab);
  const layout = useTaskPanelLayout(tab);
  const [descriptionEditing, setDescriptionEditing] = useState(false);
  const [descriptionExpanded, setDescriptionExpanded] = useState(false);
  const [subtaskOpen, setSubtaskOpen] = useState(
    tab === 'subtasks' || subtaskDraftActive,
  );
  useEffect(() => {
    if (tab === 'subtasks' || subtaskDraftActive) setSubtaskOpen(true);
  }, [tab, subtaskDraftActive]);
  const descriptionEditor = useRef<HTMLTextAreaElement>(null);
  useEffect(() => {
    if (descriptionEditing) descriptionEditor.current?.focus();
  }, [descriptionEditing]);
  const latestTree = useRef(tree);
  latestTree.current = tree;
  useEffect(() => {
    const editor = descriptionEditor.current;
    if (editor) {
      editor.style.height = 'auto';
      editor.style.height = `${editor.scrollHeight}px`;
    }
  });
  const [draft, setDraft] = useState<Draft>(() => draftOf(task));
  const [baseline, setBaseline] = useState<Draft>(() => draftOf(task));
  const [plan, setPlan] = useState<SourceFields>(() => sourceOf(task));
  const [baselinePlan, setBaselinePlan] = useState<SourceFields>(() =>
    sourceOf(task),
  );
  const [saved, setSaved] = useState(false);
  const [incoming, setIncoming] = useState(() =>
    incomingPredecessorIds(tree, task.id),
  );
  const [baselineIncoming, setBaselineIncoming] = useState(() =>
    incomingPredecessorIds(tree, task.id),
  );
  const [predecessorsOpen, setPredecessorsOpen] = useState(false);
  const predecessorTrigger = useRef<HTMLButtonElement>(null);
  const currentDraft = useRef({ details: draft, plan, incoming });
  currentDraft.current = { details: draft, plan, incoming };
  const acknowledgedRevision = useRef(tree.project.revision);
  const submitted = useRef<typeof currentDraft.current | null>(null);
  const [returnedAcknowledgement, setReturnedAcknowledgement] = useState<{
    tree: ProjectTree;
  } | null>(null);
  const draftKey = (value: typeof currentDraft.current) =>
    JSON.stringify({
      details: value.details,
      plan: value.plan,
      incoming: canonicalPredecessorIds(value.incoming),
    });
  function reconcile(ack: ProjectTree) {
    const sent = submitted.current;
    const canonical = ack.tasks.find((item) => item.id === task.id);
    if (!sent || !canonical || ack.project.id !== task.projectId) return;
    submitted.current = null;
    if (ack.project.revision < acknowledgedRevision.current) {
      setSaved(false);
      return;
    }
    acknowledgedRevision.current = ack.project.revision;
    const details = draftOf(canonical),
      source = sourceOf(canonical),
      ids = incomingPredecessorIds(ack, task.id);
    setBaseline(details);
    setBaselinePlan(source);
    setBaselineIncoming(ids);
    const current = latestTree.current;
    const newerTask = current.tasks.find((item) => item.id === task.id);
    const divergent =
      current.project.revision > ack.project.revision &&
      (!newerTask ||
        draftKey({
          details: draftOf(newerTask),
          plan: sourceOf(newerTask),
          incoming: incomingPredecessorIds(current, task.id),
        }) !== draftKey({ details, plan: source, incoming: ids }));
    if (
      !conflict &&
      !divergent &&
      draftKey(currentDraft.current) === draftKey(sent)
    ) {
      setDraft(details);
      setPlan(source);
      setIncoming(ids);
      setSaved(true);
      onDirty(false);
    } else {
      setSaved(false);
    }
  }
  useEffect(() => {
    if (saveAcknowledgement) reconcile(saveAcknowledgement);
  }, [saveAcknowledgement]);
  useEffect(() => {
    if (returnedAcknowledgement) reconcile(returnedAcknowledgement.tree);
  }, [returnedAcknowledgement]);
  const [planValid, setPlanValid] = useState(true);
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
  const incomingDirty =
    canonicalPredecessorIds(incoming).join('\0') !==
    canonicalPredecessorIds(baselineIncoming).join('\0');
  const dirty =
    JSON.stringify(draft) !== JSON.stringify(baseline) ||
    planDirty ||
    incomingDirty;
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
    if (
      !dirty &&
      !busy &&
      !conflict &&
      !retry &&
      tree.project.revision >= acknowledgedRevision.current
    ) {
      const fresh = draftOf(task);
      setDraft(fresh);
      setBaseline(fresh);
      setPlan(sourceOf(task));
      setBaselinePlan(sourceOf(task));
      const ids = incomingPredecessorIds(tree, task.id);
      setIncoming(ids);
      setBaselineIncoming(ids);
      acknowledgedRevision.current = tree.project.revision;
    }
    // A tree observed during editing never becomes a new baseline merely because
    // Reset cleared dirty. Only a fresh clean read or a matched acknowledgement does.
  }, [task, tree]);
  function update<K extends keyof Draft>(field: K, value: Draft[K]) {
    setDraft((previous) => ({ ...previous, [field]: value }));
    setSaved(false);
  }
  async function save() {
    if (
      busy ||
      (locked && !retry) ||
      removed ||
      conflict ||
      !draft.title.trim() ||
      !planValid
    )
      return;
    const fields = { ...draft, title: draft.title.trim() };
    if (!summary && planDirty && !sourceFieldsSchema.safeParse(plan).success)
      return;
    const changes: Extract<Command, { type: 'task.edit' }>['changes'] = {};
    for (const key of ['title', 'description', 'status'] as const)
      if (fields[key] !== baseline[key])
        Object.assign(changes, { [key]: fields[key] });
    if (!summary)
      for (const key of ['inputStart', 'inputFinish', 'durationDays'] as const)
        if (plan[key] !== baselinePlan[key] || (canAdopt && !dirty))
          Object.assign(changes, { [key]: plan[key] });
    if (!summary && incomingDirty)
      changes.predecessorIds = canonicalPredecessorIds(incoming);
    // An exact replay retains this original submitted draft, including post-send changes.
    if (!retry || !submitted.current)
      submitted.current = structuredClone(currentDraft.current);
    const ack = await onSave(changes);
    if (ack) setReturnedAcknowledgement({ tree: ack });
  }
  return (
    <aside
      ref={layout.panel}
      className={`task-panel${layout.shellScroll ? ' task-panel--scroll-shell' : ''}`}
      data-panel-scroll-owner={layout.shellScroll ? '' : undefined}
      aria-label={strings.task}
      onKeyDown={(event) => {
        if (event.key === 'Escape') {
          event.preventDefault();
          event.stopPropagation();
          onClose();
        }
      }}
    >
      <form
        id="task-panel-edit"
        className="panel-edit-form"
        onSubmit={(event) => {
          event.preventDefault();
          void save();
        }}
      >
        <TaskPanelHeader
          title={draft.title}
          status={draft.status}
          onTitle={(title) => update('title', title)}
          onStatus={(status) => update('status', status)}
          disabled={busy || locked}
          closeDisabled={busy || locked}
          onClose={onClose}
          journalTitle={visibleTab === 'journal' ? journalTitle : undefined}
          back={
            backTask && (
              <button
                type="button"
                className="quiet panel-back"
                aria-label={`${strings.back}: ${backTask.title}`}
                disabled={busy || locked || dirty}
                onClick={onBack}
              >
                ←
              </button>
            )
          }
        />
      </form>
      <div className="panel-tabs" role="tablist" aria-label={strings.task}>
        {(['details', 'dependencies', 'journal'] as const).map((value) => (
          <button
            type="button"
            key={value}
            role="tab"
            id={`tab-${value}`}
            aria-controls={`panel-${value}`}
            aria-selected={visibleTab === value}
            tabIndex={visibleTab === value ? 0 : -1}
            onClick={() => {
              onTab(value);
            }}
            onKeyDown={(event) => {
              if (
                ['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)
              ) {
                event.preventDefault();
                const tabs = ['details', 'dependencies', 'journal'] as const;
                const next =
                  tabs[
                    event.key === 'Home'
                      ? 0
                      : event.key === 'End'
                        ? 2
                        : (tabs.indexOf(visibleTab) +
                            (event.key === 'ArrowRight' ? 1 : 2)) %
                          3
                  ]!;
                onTab(next);
                document.getElementById(`tab-${next}`)?.focus();
              }
            }}
          >
            {value === 'details' ? strings.task : strings[value]}
          </button>
        ))}
      </div>
      <div
        ref={layout.content}
        className="panel-content"
        data-panel-scroll-owner={layout.shellScroll ? undefined : ''}
      >
        {removed && <p role="status">{strings.taskRemoved}</p>}
        {visibleTab === 'journal' ? (
          <div role="tabpanel" id="panel-journal" aria-labelledby="tab-journal">
            {journalContent}
          </div>
        ) : visibleTab === 'details' ? (
          <div role="tabpanel" id="panel-details" aria-labelledby="tab-details">
            <fieldset disabled={busy || locked}>
              <PlanFields
                timezone={tree.project.timezone}
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
                onValidityChange={setPlanValid}
                onChange={(next) => {
                  setPlan(next);
                  setSaved(false);
                }}
              />
              {summary ? (
                <p className="field-hint">{strings.chooseLeaf}</p>
              ) : (
                <div className="panel-predecessors">
                  <button
                    ref={predecessorTrigger}
                    type="button"
                    aria-label={strings.afterFinish}
                    aria-expanded={predecessorsOpen}
                    disabled={removed || conflict}
                    onClick={() => setPredecessorsOpen((open) => !open)}
                  >
                    <ControlIcon name="chain" /> {strings.afterFinish}
                  </button>
                  <div className="predecessor-chips">
                    {canonicalPredecessorIds(incoming).map((id) => (
                      <span className="predecessor-chip" key={id}>
                        {tree.tasks.find((task) => task.id === id)?.title ??
                          strings.removedPredecessor}
                      </span>
                    ))}
                  </div>
                  {predecessorsOpen && (
                    <PredecessorPicker
                      tree={tree}
                      successorId={task.id}
                      selectedIds={incoming}
                      disabled={busy || locked || removed || conflict}
                      onAdd={(id) => {
                        setIncoming(canonicalPredecessorIds([...incoming, id]));
                        setSaved(false);
                      }}
                      onRemove={(id) => {
                        setIncoming(
                          incoming.filter((selected) => selected !== id),
                        );
                        setSaved(false);
                      }}
                      onClose={() => {
                        setPredecessorsOpen(false);
                        predecessorTrigger.current?.focus();
                      }}
                    />
                  )}
                </div>
              )}
              <ScheduleStatus tree={tree} task={task} />
            </fieldset>
            <section className="panel-description-section">
              {descriptionEditing ? (
                <>
                  <label>
                    {strings.description}
                    <textarea
                      form="task-panel-edit"
                      aria-label={strings.description}
                      ref={descriptionEditor}
                      disabled={busy || locked}
                      value={draft.description}
                      maxLength={10000}
                      rows={1}
                      onChange={(event) =>
                        update('description', event.target.value)
                      }
                    />
                  </label>
                  <button
                    type="button"
                    className="quiet"
                    onClick={() => setDescriptionEditing(false)}
                  >
                    {strings.confirmSchedule}
                  </button>
                </>
              ) : draft.description ? (
                <>
                  <p
                    className={`panel-description${descriptionExpanded ? '' : ' is-collapsed'}`}
                  >
                    {draft.description}
                  </p>
                  <button
                    type="button"
                    className="quiet"
                    onClick={() => setDescriptionExpanded((value) => !value)}
                  >
                    {descriptionExpanded
                      ? strings.collapseDescription
                      : strings.expandDescription}
                  </button>
                  <button
                    type="button"
                    className="quiet"
                    disabled={busy || locked}
                    onClick={() => setDescriptionEditing(true)}
                  >
                    {strings.editDescription}
                  </button>
                </>
              ) : (
                <button
                  type="button"
                  className="quiet"
                  disabled={busy || locked}
                  onClick={() => setDescriptionEditing(true)}
                >
                  {strings.addDescription}
                </button>
              )}
            </section>
            <section
              className="panel-subtasks"
              aria-labelledby="panel-subtasks-heading"
            >
              <h3 id="panel-subtasks-heading">
                {strings.subtasks}{' '}
                <span>
                  ({tasks.filter((child) => child.parentId === task.id).length})
                </span>
              </h3>
              {dirty && (
                <p id="panel-subtasks-blocked" className="field-hint">
                  {strings.saveTaskBeforeSubtask}
                </p>
              )}
              {!subtaskOpen && subtaskInput && (
                <button
                  type="button"
                  disabled={busy || locked || removed || dirty}
                  aria-describedby={
                    dirty ? 'panel-subtasks-blocked' : undefined
                  }
                  onClick={(event) => {
                    const trigger = event.currentTarget;
                    setSubtaskOpen(true);
                    onTab('subtasks');
                    requestAnimationFrame(() => {
                      if (
                        document.activeElement === document.body ||
                        document.activeElement === trigger
                      )
                        document.getElementById('quick-subtask')?.focus();
                    });
                  }}
                >
                  {strings.addChild}
                </button>
              )}
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
                  onAction={(action, child) => {
                    if (action === 'child' || action === 'sibling') {
                      setSubtaskOpen(true);
                      onTab('subtasks');
                    }
                    return onAction(action, child);
                  }}
                  onJournal={onJournal}
                  label={strings.subtasks}
                  schedule={tree.schedule}
                  quickInputId="quick-subtask"
                  disabled={busy || locked || conflict || removed || dirty}
                />
              )}
              {subtaskOpen && subtaskInput}
            </section>
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
          {visibleTab !== 'details' && (
            <button
              type="button"
              disabled={busy || locked || removed || dirty}
              onClick={() => onAction('child', task)}
            >
              {strings.addChild}
            </button>
          )}
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
      <TaskPanelFooter
        dirty={dirty}
        busy={busy}
        retry={retry}
        saved={saved}
        canAdopt={canAdopt}
        disabledReason={
          busy
            ? strings.saving
            : removed
              ? strings.cannotSaveRemovedTask
              : conflict
                ? strings.resolveTaskConflict
                : !draft.title.trim()
                  ? strings.titleRequired
                  : !planValid ||
                      (!summary &&
                        planDirty &&
                        !sourceFieldsSchema.safeParse(plan).success)
                    ? strings.planInputError
                    : locked && !retry
                      ? strings.loading
                      : null
        }
        resetDisabled={busy || locked}
        feedback={feedback}
        onSave={() => void save()}
        onReset={() => {
          setDraft({ ...baseline });
          setPlan({ ...baselinePlan });
          setIncoming([...baselineIncoming]);
          submitted.current = null;
          setSaved(false);
          onDirty(false);
        }}
        onRepair={() => {
          onTab('details');
          requestAnimationFrame(() => {
            if (!draft.title.trim()) {
              const titleInput = document.querySelector<HTMLElement>(
                '.panel-title-editor input',
              );
              if (titleInput) titleInput.focus();
              else
                document
                  .querySelector<HTMLButtonElement>(
                    `.panel-header [aria-label="${strings.editTitle}"]`,
                  )
                  ?.click();
            } else
              document
                .querySelector<HTMLElement>(
                  '#panel-details [aria-invalid="true"]',
                )
                ?.focus();
          });
        }}
      />
    </aside>
  );
}
