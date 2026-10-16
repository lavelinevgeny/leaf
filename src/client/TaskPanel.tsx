import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import {
  sourceFieldsSchema,
  type Task,
  type SourceFields,
  type ProjectTree,
} from '../shared/contracts.js';
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
import { TaskDescription } from './TaskDescription.js';
import { TaskLeaveDialog } from './TaskLeaveDialog.js';
import { ScheduleProblems } from './ScheduleStatus.js';
import { TaskPanelFooter } from './TaskPanelFooter.js';
import type { JournalMetadata } from './journal-state.js';
import { panelScrollOwner, visiblePanelTab } from './task-panel-view.js';
import { useTaskPanelLayout } from './use-task-panel-layout.js';
import { sourceOf } from './planning-view.js';
import { Dependencies } from './Dependencies.js';
import type { Command } from '../shared/contracts.js';
import { TaskTree, type TreeAction } from './TaskTree.js';
import { ActionMenu } from './ActionMenu.js';
import { TaskMoveDialog } from './TaskMoveDialog.js';
import { strings } from './strings.js';

type Draft = Pick<Task, 'title' | 'description' | 'status'>;
type SaveScope = 'all' | 'status' | 'description' | 'schedule';
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
  taskSaving?: boolean;
  journalWriting?: boolean;
  retry: boolean;
  conflict: boolean;
  locked: boolean;
  feedback: ReactNode;
  subtaskInput?: ReactNode;
  subtaskDraftActive?: boolean;
  journalContent?:
    ReactNode | ((scrollContainer: HTMLElement | null) => ReactNode);
  journalMetadata?: JournalMetadata | null | undefined;
  journalNavigationDisabled?: boolean;
  onAncestor?: ((task: Task, tab: PanelTab) => void) | undefined;
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
  taskSaving = busy,
  journalWriting = false,
  retry,
  conflict,
  locked,
  feedback,
  subtaskInput,
  subtaskDraftActive = false,
  journalContent,
  journalMetadata,
  journalNavigationDisabled = true,
  onAncestor,
  onJournal,
  registerActions,
}: Props) {
  const visibleTab = visiblePanelTab(tab);
  const layout = useTaskPanelLayout(tab);
  const [scrollContainer, setScrollContainer] = useState<HTMLElement | null>(
    null,
  );
  useLayoutEffect(() => {
    setScrollContainer(
      layout.panel.current ? panelScrollOwner(layout.panel.current) : null,
    );
  }, [layout.shellScroll]);
  const pathTasks =
    visibleTab === 'journal' ? (journalMetadata?.tasks ?? []) : tree.tasks;
  const path: Task[] = [];
  const seen = new Set<string>();
  let pathTask = pathTasks.find((item) => item.id === task.id);
  while (pathTask && !seen.has(pathTask.id)) {
    if (pathTask.id !== task.id) path.unshift(pathTask);
    seen.add(pathTask.id);
    pathTask = pathTasks.find((item) => item.id === pathTask?.parentId);
  }
  const metadataOnlyTask =
    journalMetadata?.projectId === tree.project.id &&
    journalMetadata.revision > tree.project.revision &&
    journalMetadata.tasks.some((item) => item.id === task.id);
  const removedReason = metadataOnlyTask
    ? 'Обновите план, чтобы проверить задачу и продолжить редактирование.'
    : strings.taskRemoved;
  const journalTitle =
    visibleTab === 'journal'
      ? (journalMetadata?.tasks.find((item) => item.id === task.id)?.title ??
        'Загрузка задачи…')
      : undefined;
  const [descriptionEditing, setDescriptionEditing] = useState(false);
  const descriptionSnapshot = useRef(task.description);
  const [pendingTab, setPendingTab] = useState<PanelTab | null>(null);
  const [localSaving, setLocalSaving] = useState(false);
  const [saveError, setSaveError] = useState<{
    scope: SaveScope;
    message: string;
  } | null>(null);
  const [subtaskOpen, setSubtaskOpen] = useState(
    tab === 'subtasks' || subtaskDraftActive,
  );
  useEffect(() => {
    if (tab === 'subtasks' || subtaskDraftActive) setSubtaskOpen(true);
  }, [tab, subtaskDraftActive]);
  const latestTree = useRef(tree);
  latestTree.current = tree;
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
  useEffect(() => {
    if (!saved) return;
    const timer = window.setTimeout(() => setSaved(false), 2500);
    return () => window.clearTimeout(timer);
  }, [saved, task.id]);
  const [incoming, setIncoming] = useState(() =>
    incomingPredecessorIds(tree, task.id),
  );
  const [baselineIncoming, setBaselineIncoming] = useState(() =>
    incomingPredecessorIds(tree, task.id),
  );
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
  const submitted = useRef<
    | (typeof currentDraft.current & {
        scope: SaveScope;
        baseline: typeof currentDraft.current;
      })
    | null
  >(null);
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
    if (sent.scope !== 'all' && !conflict && !divergent) {
      const currentValue = currentDraft.current;
      const nextDetails = { ...currentValue.details };
      for (const key of ['title', 'description', 'status'] as const) {
        if (
          currentValue.details[key] === sent.details[key] &&
          (sent.scope === key ||
            sent.details[key] === sent.baseline.details[key])
        )
          Object.assign(nextDetails, { [key]: details[key] });
      }
      setDraft(nextDetails);
      const samePlan =
        JSON.stringify(currentValue.plan) === JSON.stringify(sent.plan);
      const cleanPlan =
        JSON.stringify(sent.plan) === JSON.stringify(sent.baseline.plan);
      if (
        !rawDirtyRef.current &&
        rawVersion.current === sent.rawVersion &&
        samePlan &&
        (sent.scope === 'schedule' || cleanPlan)
      )
        setPlan(source);
      const sameIncoming =
        canonicalPredecessorIds(currentValue.incoming).join('\0') ===
        canonicalPredecessorIds(sent.incoming).join('\0');
      const cleanIncoming =
        canonicalPredecessorIds(sent.incoming).join('\0') ===
        canonicalPredecessorIds(sent.baseline.incoming).join('\0');
      if (sameIncoming && (sent.scope === 'schedule' || cleanIncoming))
        setIncoming(ids);
      const targetUnchanged =
        sent.scope === 'status'
          ? currentValue.details.status === sent.details.status
          : sent.scope === 'description'
            ? currentValue.details.description === sent.details.description
            : samePlan &&
              !rawDirtyRef.current &&
              rawVersion.current === sent.rawVersion;
      setSaved(targetUnchanged);
      if (targetUnchanged && sent.scope === 'description')
        setDescriptionEditing(false);
      if (targetUnchanged && sent.scope === 'schedule')
        scheduleEditor.current?.closeSaved();
      saveResult.current?.(targetUnchanged);
    } else if (
      !conflict &&
      !divergent &&
      !rawDirtyRef.current &&
      rawVersion.current === sent.rawVersion &&
      draftKey(currentDraft.current) === draftKey(sent)
    ) {
      setDraft(details);
      setDescriptionEditing(false);
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
  const scheduleDirty =
    planDirty || rawDirty || incomingDirty || draft.status !== baseline.status;
  const dirty =
    JSON.stringify(draft) !== JSON.stringify(baseline) ||
    planDirty ||
    rawDirty ||
    incomingDirty;
  const savedDependencyCount = tree.dependencies.filter(
    (edge) => edge.predecessorId === task.id || edge.successorId === task.id,
  ).length;
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
  async function save(scope: SaveScope = 'all', status?: Task['status']) {
    if (
      busy ||
      localSaving ||
      (locked && !retry) ||
      removed ||
      conflict ||
      (!retry && scope === 'all' && !draft.title.trim())
    ) {
      focusInvalid();
      return false;
    }
    const savingPlan = scope === 'all' || scope === 'schedule';
    if (!retry && savingPlan && !scheduleEditor.current?.finishInput()) {
      focusInvalid();
      return false;
    }
    const source = currentDraft.current.plan;
    if (
      !retry &&
      savingPlan &&
      !summary &&
      !sourceFieldsSchema.safeParse(source).success
    ) {
      focusInvalid();
      return false;
    }
    const fields = { ...draft, title: draft.title.trim() };
    const changes: Extract<Command, { type: 'task.edit' }>['changes'] = {};
    for (const key of ['title', 'description', 'status'] as const)
      if ((scope === 'all' || scope === key) && fields[key] !== baseline[key])
        Object.assign(changes, { [key]: fields[key] });
    if (scope === 'status' && status !== undefined) changes.status = status;
    if (savingPlan && !summary)
      for (const key of ['inputStart', 'inputFinish', 'durationDays'] as const)
        if (source[key] !== baselinePlan[key] || (canAdopt && !dirty))
          Object.assign(changes, { [key]: source[key] });
    if (savingPlan && !summary && incomingDirty)
      changes.predecessorIds = canonicalPredecessorIds(incoming);
    if (!retry && Object.keys(changes).length === 0) {
      setSaveError(null);
      return true;
    }
    // An exact replay retains this original submitted draft, including post-send changes.
    if (!retry || !submitted.current)
      submitted.current = structuredClone({
        ...currentDraft.current,
        scope,
        baseline: {
          details: baseline,
          plan: baselinePlan,
          incoming: baselineIncoming,
          rawVersion: rawVersion.current,
        },
        rawVersion: rawVersion.current,
      });
    setSaveError(null);
    setLocalSaving(true);
    const confirmed = new Promise<boolean>((resolve) => {
      saveResult.current = resolve;
    });
    try {
      const ack = await onSave(changes);
      if (!ack) {
        saveResult.current?.(false);
        saveResult.current = null;
        setSaveError({
          scope: submitted.current?.scope ?? scope,
          message:
            'Не удалось подтвердить сохранение. Введённые данные сохранены в карточке. Повторите сохранение.',
        });
        return false;
      }
      setReturnedAcknowledgement({ tree: ack });
      const result = await confirmed;
      if (result) setSaveError(null);
      return result;
    } catch {
      saveResult.current?.(false);
      saveResult.current = null;
      setSaveError({
        scope,
        message:
          'Не удалось сохранить. Проверьте соединение и повторите сохранение.',
      });
      return false;
    } finally {
      setLocalSaving(false);
    }
  }
  function cancelDescription() {
    if (busy || localSaving || locked || retry) return;
    update('description', descriptionSnapshot.current);
    setDescriptionEditing(false);
    setSaveError(null);
  }
  async function saveDescription() {
    if (await save('description')) {
      setDescriptionEditing(false);
      descriptionSnapshot.current = currentDraft.current.details.description;
    }
  }
  function requestTab(next: PanelTab) {
    if (
      visiblePanelTab(next) !== visibleTab &&
      descriptionEditing &&
      draft.description !== descriptionSnapshot.current
    ) {
      setPendingTab(next);
      return;
    }
    onTab(next);
  }

  function reset() {
    clearFields();
    rawVersion.current++;
    descriptionSnapshot.current = baseline.description;
    setSaveError(null);
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
  const busyReason = taskSaving
    ? strings.saving
    : journalWriting
      ? 'Дождитесь сохранения записи журнала.'
      : 'Дождитесь завершения операции.';
  const structuralReason = busy
    ? busyReason
    : locked
      ? strings.loading
      : removed
        ? removedReason
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
              baselinePlan={baselinePlan}
              project={tree.project}
              summary={summary}
              computed={tree.schedule.summaries[task.id]}
              error={planError}
              resetKey={resetKey}
              disabledReason={
                localSaving
                  ? strings.saving
                  : removed
                    ? removedReason
                    : busy
                      ? busyReason
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
              onSave={() => save('schedule')}
              incomingDirty={incomingDirty}
              saving={localSaving}
              cancelDisabled={busy || localSaving || locked || retry}
              saveError={
                saveError?.scope === 'schedule' ? saveError.message : null
              }
            />
          }
          title={draft.title}
          status={draft.status}
          onTitle={(title) => update('title', title)}
          onStatus={(status) => {
            if (status !== draft.status) void save('status', status);
          }}
          disabled={busy || locked || conflict || removed}
          closeDisabled={busy || localSaving || locked}
          onClose={onClose}
          journalTitle={journalTitle}
          unsavedTitle={!!journalMetadata && draft.title !== journalTitle}
          path={
            <nav aria-label="Путь задачи" className="panel-task-path">
              <span>{tree.project.title}</span>
              {path.map((item) => (
                <span key={item.id}>
                  <span aria-hidden="true"> / </span>
                  <button
                    type="button"
                    disabled={
                      busy ||
                      locked ||
                      !onAncestor ||
                      (visibleTab === 'journal' && journalNavigationDisabled)
                    }
                    onClick={() =>
                      onAncestor?.(
                        item,
                        visibleTab === 'journal' ? 'journal' : 'details',
                      )
                    }
                  >
                    {item.title}
                  </button>
                </span>
              ))}
            </nav>
          }
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
            aria-label={
              value === 'dependencies' ? strings.dependencies : undefined
            }
            aria-describedby={
              value === 'dependencies'
                ? [
                    savedDependencyCount ? 'saved-dependency-count' : '',
                    incomingDirty ? 'incoming-draft-marker' : '',
                  ]
                    .filter(Boolean)
                    .join(' ') || undefined
                : undefined
            }
            aria-selected={visibleTab === value}
            tabIndex={visibleTab === value ? 0 : -1}
            onClick={() => {
              requestTab(value);
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
                requestTab(next);
                if (
                  !descriptionEditing ||
                  draft.description === descriptionSnapshot.current
                )
                  document.getElementById(`tab-${next}`)?.focus();
              }
            }}
          >
            {value === 'details'
              ? strings.task
              : value === 'journal'
                ? strings.workProgress
                : strings[value]}
            {value === 'dependencies' && savedDependencyCount > 0 && (
              <span id="saved-dependency-count"> ({savedDependencyCount})</span>
            )}
            {value === 'dependencies' && incomingDirty && (
              <>
                <span className="dependency-draft-marker" aria-hidden="true">
                  {' '}
                  •
                </span>
                <span id="incoming-draft-marker" hidden>
                  {strings.incomingDraft}
                </span>
              </>
            )}
          </button>
        ))}
      </div>
      <div
        ref={layout.content}
        className="panel-content"
        data-panel-scroll-owner={layout.shellScroll ? undefined : ''}
      >
        {removed && <p role="status">{removedReason}</p>}
        {visibleTab !== 'journal' && (
          <ScheduleProblems
            tree={tree}
            task={task}
            savedPlan={visibleTab === 'details' && scheduleDirty}
          />
        )}
        {visibleTab === 'journal' ? (
          <div role="tabpanel" id="panel-journal" aria-labelledby="tab-journal">
            {typeof journalContent === 'function'
              ? journalContent(scrollContainer)
              : journalContent}
          </div>
        ) : visibleTab === 'details' ? (
          <div role="tabpanel" id="panel-details" aria-labelledby="tab-details">
            <TaskDescription
              changed={draft.description !== baseline.description}
              value={draft.description}
              editing={descriptionEditing}
              disabled={busy || locked || conflict || removed}
              cancelDisabled={busy || localSaving || locked || retry}
              saving={localSaving}
              error={
                saveError?.scope === 'description' ? saveError.message : null
              }
              onChange={(description) => update('description', description)}
              onEdit={() => {
                descriptionSnapshot.current = draft.description;
                setSaveError(null);
                setDescriptionEditing(true);
              }}
              onCancel={cancelDescription}
              onSave={() => void saveDescription()}
            />
            <section
              className="panel-subtasks"
              aria-labelledby="panel-subtasks-heading"
            >
              <div className="panel-section-heading">
                <h3 id="panel-subtasks-heading">
                  {strings.subtasks}{' '}
                  <span>
                    (
                    {tasks.filter((child) => child.parentId === task.id).length}
                    )
                  </span>
                </h3>
                {!subtaskOpen && subtaskInput && (
                  <button
                    type="button"
                    className="quiet panel-add-subtask"
                    aria-label={strings.addChild}
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
                    + Добавить
                  </button>
                )}
              </div>
              {dirty && (
                <p id="panel-subtasks-blocked" className="field-hint">
                  {strings.saveTaskBeforeSubtask}
                </p>
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
              incomingIds={incoming}
              onIncomingChange={(ids) => {
                setIncoming(canonicalPredecessorIds(ids));
                setSaved(false);
              }}
              taskDirty={dirty}
              scheduleDirty={scheduleDirty}
              disabled={busy || locked || conflict || removed}
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
        saving={taskSaving}
        retry={retry}
        saved={saved}
        canAdopt={canAdopt}
        disabledReason={
          busy
            ? busyReason
            : removed
              ? metadataOnlyTask
                ? removedReason
                : strings.cannotSaveRemovedTask
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
        resetDisabled={busy || localSaving || locked}
        editorOwnsSave={
          descriptionEditing &&
          visibleTab === 'details' &&
          draft.title === baseline.title &&
          draft.status === baseline.status &&
          !planDirty &&
          !rawDirty &&
          !incomingDirty
        }
        descriptionEditing={descriptionEditing && visibleTab === 'details'}
        feedback={
          <>
            {feedback}
            {saveError &&
              saveError.scope !== 'description' &&
              saveError.scope !== 'schedule' && (
                <p role="alert" className="error-message">
                  {saveError.message}
                </p>
              )}
          </>
        }
        hasFeedback={!!feedback || !!saveError}
        onSave={() => void save()}
        onReset={reset}
        onRepair={focusInvalid}
      />
      {pendingTab && (
        <TaskLeaveDialog
          blocked={busy || localSaving || locked || retry}
          saving={busy || localSaving}
          onContinue={() => setPendingTab(null)}
          onDiscard={() => {
            cancelDescription();
            onTab(pendingTab);
            setPendingTab(null);
          }}
          onSave={() => {
            void save('description').then((ok) => {
              if (ok) {
                setDescriptionEditing(false);
                onTab(pendingTab);
                setPendingTab(null);
              } else setPendingTab(null);
            });
          }}
        />
      )}
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
