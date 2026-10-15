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
import type { PlanFieldError } from './PlanFields.js';
import {
  TaskPanelSchedule,
  type TaskPanelScheduleHandle,
} from './TaskPanelSchedule.js';
import { TaskPanelHeader } from './TaskPanelHeader.js';
import { TaskPanelFooter } from './TaskPanelFooter.js';
import { visiblePanelTab } from './task-panel-view.js';
import { useTaskPanelLayout } from './use-task-panel-layout.js';
import { sourceOf } from './planning-view.js';
import { ScheduleStatus } from './ScheduleStatus.js';
import { Dependencies } from './Dependencies.js';
import type { Command } from '../shared/contracts.js';
import { TaskTree, type TreeAction } from './TaskTree.js';
import { ActionMenu } from './ActionMenu.js';
import { TaskMoveDialog } from './TaskMoveDialog.js';
import { strings } from './strings.js';

type Draft = Pick<Task, 'title' | 'description' | 'status'>;
const draftOf = (task: Task): Draft => ({
  title: task.title,
  description: task.description,
  status: task.status,
});
export type PanelTab = 'details' | 'subtasks' | 'dependencies' | 'journal';
export type TaskPanelActions = {
  save: () => Promise<boolean>;
  reset: () => void;
  focusInvalid: () => void;
};
interface Props {
  registerActions?: (actions: TaskPanelActions | null) => void;
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
  registerActions,
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
  const scheduleEditor = useRef<TaskPanelScheduleHandle>(null);
  const [planError, setPlanError] = useState<PlanFieldError | null>(null);
  const planErrorRef = useRef<PlanFieldError | null>(null);
  function reportPlanError(error: PlanFieldError | null) {
    planErrorRef.current = error;
    setPlanError(error);
  }
  const [rawDirty, setRawDirty] = useState(false);
  const rawDirtyRef = useRef(false);
  const rawVersion = useRef(0);
  const [resetKey, setResetKey] = useState(0);
  function updateRaw(dirty: boolean) {
    rawDirtyRef.current = dirty;
    setRawDirty(dirty);
  }
  function clearFields() {
    updateRaw(false);
    reportPlanError(null);
    setPlanValid(true);
    setResetKey((key) => key + 1);
  }
  function updatePlan(next: SourceFields) {
    currentDraft.current.plan = next;
    setPlan(next);
    setSaved(false);
  }
  const [saved, setSaved] = useState(false);
  const [incoming, setIncoming] = useState(() =>
    incomingPredecessorIds(tree, task.id),
  );
  const [baselineIncoming, setBaselineIncoming] = useState(() =>
    incomingPredecessorIds(tree, task.id),
  );
  const [predecessorsOpen, setPredecessorsOpen] = useState(false);
  const predecessorTrigger = useRef<HTMLButtonElement>(null);
  const currentDraft = useRef({
    details: draft,
    plan,
    incoming,
    rawVersion: rawVersion.current,
  });
  currentDraft.current = {
    details: draft,
    plan,
    incoming,
    rawVersion: rawVersion.current,
  };
  const acknowledgedRevision = useRef(tree.project.revision);
  const submitted = useRef<typeof currentDraft.current | null>(null);
  const saveResult = useRef<((saved: boolean) => void) | null>(null);
  const [returnedAcknowledgement, setReturnedAcknowledgement] = useState<{
    tree: ProjectTree;
  } | null>(null);
  const draftKey = (value: {
    details: Draft;
    plan: SourceFields;
    incoming: string[];
  }) =>
    JSON.stringify({
      details: value.details,
      plan: value.plan,
      incoming: canonicalPredecessorIds(value.incoming),
    });
  function reconcile(ack: ProjectTree) {
    const sent = submitted.current;
    const canonical = ack.tasks.find((item) => item.id === task.id);
    if (!sent) return;
    if (!canonical || ack.project.id !== task.projectId) {
      saveResult.current?.(false);
      saveResult.current = null;
      return;
    }
    submitted.current = null;
    if (ack.project.revision < acknowledgedRevision.current) {
      setSaved(false);
      saveResult.current?.(false);
      saveResult.current = null;
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
      !rawDirtyRef.current &&
      rawVersion.current === sent.rawVersion &&
      draftKey(currentDraft.current) === draftKey(sent)
    ) {
      setDraft(details);
      setPlan(source);
      setIncoming(ids);
      setSaved(true);
      onDirty(false);
      saveResult.current?.(true);
    } else {
      setSaved(false);
      saveResult.current?.(false);
    }
    saveResult.current = null;
  }
  useEffect(() => {
    if (saveAcknowledgement) reconcile(saveAcknowledgement);
  }, [saveAcknowledgement]);
  useEffect(() => {
    if (returnedAcknowledgement) reconcile(returnedAcknowledgement.tree);
  }, [returnedAcknowledgement]);
  const [planValid, setPlanValid] = useState(true);
  const [menuOpen, setMenuOpen] = useState(false);
  const [moveOpen, setMoveOpen] = useState(false);
  const moveTrigger = useRef<HTMLButtonElement | null>(null);
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
    rawDirty ||
    incomingDirty;
  const summary = tasks.some((child) => child.parentId === task.id);
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
      (!retry && !draft.title.trim())
    ) {
      focusInvalid();
      return false;
    }
    if (!retry && !scheduleEditor.current?.finishInput()) {
      focusInvalid();
      return false;
    }
    const source = currentDraft.current.plan;
    if (!retry && !summary && !sourceFieldsSchema.safeParse(source).success) {
      focusInvalid();
      return false;
    }
    const fields = { ...draft, title: draft.title.trim() };
    const changes: Extract<Command, { type: 'task.edit' }>['changes'] = {};
    for (const key of ['title', 'description', 'status'] as const)
      if (fields[key] !== baseline[key])
        Object.assign(changes, { [key]: fields[key] });
    if (!summary)
      for (const key of ['inputStart', 'inputFinish', 'durationDays'] as const)
        if (source[key] !== baselinePlan[key] || (canAdopt && !dirty))
          Object.assign(changes, { [key]: source[key] });
    if (!summary && incomingDirty)
      changes.predecessorIds = canonicalPredecessorIds(incoming);
    // An exact replay retains this original submitted draft, including post-send changes.
    if (!retry || !submitted.current)
      submitted.current = structuredClone({
        ...currentDraft.current,
        rawVersion: rawVersion.current,
      });
    const confirmed = new Promise<boolean>((resolve) => {
      saveResult.current = resolve;
    });
    const ack = await onSave(changes);
    if (!ack) {
      saveResult.current?.(false);
      saveResult.current = null;
      return false;
    }
    setReturnedAcknowledgement({ tree: ack });
    return confirmed;
  }
  function reset() {
    clearFields();
    rawVersion.current++;
    setDraft({ ...baseline });
    setPlan({ ...baselinePlan });
    setIncoming([...baselineIncoming]);
    submitted.current = null;
    setSaved(false);
    onDirty(false);
  }
  function focusInvalid() {
    if (draft.title.trim()) scheduleEditor.current?.finishInput();
    onTab('details');
    requestAnimationFrame(() => {
      if (!draft.title.trim()) {
        const input = document.querySelector<HTMLElement>(
          '.panel-title-editor input',
        );
        if (input) input.focus();
        else
          document
            .querySelector<HTMLButtonElement>(
              `.panel-header [aria-label="${strings.editTitle}"]`,
            )
            ?.click();
      } else
        scheduleEditor.current?.focusField(
          planErrorRef.current?.field ?? 'inputStart',
        );
    });
  }
  useEffect(() => {
    registerActions?.({ save, reset, focusInvalid });
  });
  useEffect(
    () => () => {
      registerActions?.(null);
      saveResult.current?.(false);
      saveResult.current = null;
    },
    [registerActions],
  );
  const structuralReason = busy
    ? strings.saving
    : locked
      ? strings.loading
      : removed
        ? strings.taskRemoved
        : conflict
          ? strings.resolveTaskConflict
          : dirty
            ? strings.saveTaskBeforeSubtask
            : null;
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
        noValidate
        className="panel-edit-form"
        onSubmit={(event) => {
          event.preventDefault();
          void save();
        }}
      >
        <TaskPanelHeader
          schedule={
            <TaskPanelSchedule
              ref={scheduleEditor}
              plan={plan}
              project={tree.project}
              summary={summary}
              computed={tree.schedule.summaries[task.id]}
              error={planError}
              resetKey={resetKey}
              disabledReason={
                removed
                  ? strings.taskRemoved
                  : busy
                    ? strings.saving
                    : locked
                      ? strings.loading
                      : conflict
                        ? strings.resolveTaskConflict
                        : task.status === 'done' && draft.status === 'done'
                          ? strings.doneHint
                          : null
              }
              onChange={updatePlan}
              onValidityChange={setPlanValid}
              onErrorChange={reportPlanError}
              onRawChange={updateRaw}
              onEdit={() => {
                rawVersion.current++;
                setSaved(false);
              }}
              onResetFields={clearFields}
            />
          }
          title={draft.title}
          status={draft.status}
          onTitle={(title) => update('title', title)}
          onStatus={(status) => update('status', status)}
          disabled={busy || locked}
          closeDisabled={busy || locked}
          onClose={onClose}
          journalTitle={visibleTab === 'journal' ? journalTitle : undefined}
          actions={
            <ActionMenu
              label="Действия задачи"
              className="panel-action-menu"
              open={menuOpen}
              onOpenChange={setMenuOpen}
              items={[
                {
                  id: 'sibling',
                  label: strings.addSibling,
                  disabled: !!structuralReason,
                  disabledReason: structuralReason ?? undefined,
                  onSelect: () => onAction('sibling', task),
                },
                {
                  id: 'move',
                  label: 'Переместить…',
                  disabled: busy || locked || removed,
                  onSelect: (trigger) => {
                    moveTrigger.current = trigger;
                    setMoveOpen(true);
                  },
                },
                {
                  id: 'show',
                  label: 'Показать на Ганте',
                  disabled: busy || locked || removed,
                  onSelect: (trigger) => {
                    trigger.focus({ preventScroll: true });
                    onShow(task);
                  },
                },
                {
                  id: 'delete',
                  label: 'Удалить задачу…',
                  disabled: !!structuralReason,
                  disabledReason: structuralReason ?? undefined,
                  tone: 'danger',
                  separatorBefore: true,
                  onSelect: () => onAction('delete', task),
                },
              ]}
            />
          }
          back={
            backTask && (
              <button
                type="button"
                className="quiet panel-back"
                aria-label={`${strings.back}: ${backTask.title}`}
                disabled={busy || locked}
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
                  disabled={busy || locked || removed}
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
              navigationDisabled={busy || locked || conflict || removed}
              onCommand={onDependency}
              onSelect={onNeighbor}
              onShow={onShow}
            />
          </div>
        )}
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
                : !retry && !draft.title.trim()
                  ? strings.titleRequired
                  : !retry &&
                      (!planValid ||
                        (!summary &&
                          planDirty &&
                          !sourceFieldsSchema.safeParse(plan).success))
                    ? strings.planInputError
                    : locked && !retry
                      ? strings.loading
                      : null
        }
        resetDisabled={busy || locked}
        feedback={feedback}
        onSave={() => void save()}
        onReset={reset}
        onRepair={focusInvalid}
      />
      {moveOpen && (
        <TaskMoveDialog
          task={task}
          tasks={tasks}
          trigger={moveTrigger.current}
          blockedReason={structuralReason}
          onMove={onMove}
          onAction={onAction}
          onClose={() => setMoveOpen(false)}
        />
      )}
    </aside>
  );
}
