import { useJournal } from './use-journal.js';
import { useProjectToday } from './use-project-today.js';
import { ProjectViewTabs } from './ProjectViewTabs.js';
import { ProjectJournal } from './ProjectJournal.js';
import { TaskJournal } from './TaskJournal.js';
import {
  parseWorkspaceUrl,
  writeWorkspaceVisit,
  type ProjectView,
  type WorkspaceVisit,
} from './workspace-navigation.js';
import type { JournalPosition } from './journal-state.js';
import type { JournalProjectQuery } from '../shared/journal-contracts.js';
import type {
  TimelineRestoreRequest,
  TimelineViewState,
} from './TaskTimeline.js';
import './styles/journal.css';
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from 'react';
import type {
  AuthSession,
  Command,
  CommandEnvelope,
  Project,
  ProjectTree,
  RenameProject,
  Task,
  SourceFields,
} from '../shared/contracts.js';
import { requiresWorkPreservation } from '../shared/work-preservation.js';
import { api, ApiError } from './api.js';
import { ProjectSidebar } from './ProjectSidebar.js';
import { QuickAdd, type AddContext } from './QuickAdd.js';
import {
  TaskPanel,
  type PanelTab,
  type TaskPanelActions,
} from './TaskPanel.js';
import { TaskLeaveDialog } from './TaskLeaveDialog.js';
import { panelScrollOwner } from './task-panel-view.js';
import { assertCanMove } from '../domain/tree.js';
import { visiblePanelTab } from './task-panel-view.js';
import { focusTaskRow, type TreeAction } from './TaskTree.js';
import { orderedChildren, subtreeIds } from './tree-view.js';
import { strings } from './strings.js';
import { ProjectControls } from './ProjectControls.js';
import { TaskViewControl } from './TaskViewControl.js';
import { TaskTimeline, type GanttReveal } from './TaskTimeline.js';
import { TaskFilters } from './TaskFilters.js';
import { ControlIcon } from './ControlIcon.js';
import { emptyTaskFilter, type TaskFilter } from './task-filter.js';
import { workingDaysInclusive } from '../domain/calendar.js';
import {
  gesturePatch,
  newTaskPlan,
  validateStartResize,
  type PlanGestureKind,
} from './planning-view.js';
import {
  draftTask,
  parentPlan,
  sameQuickDraft,
  hasQuickDraft,
  type QuickDraft,
} from './quick-add-view.js';
import { PredecessorPicker } from './PredecessorPicker.js';
import { incomingPredecessorIds } from './predecessor-view.js';
import './styles/app.css';
import './styles/planning.css';

type Mutation =
  | {
      kind: 'command';
      projectId: string;
      envelope: CommandEnvelope;
      knownIds: string[];
      quickKey?: string;
      sentQuickDraft?: QuickDraft;
      sentQuickRawVersion?: number;
      panelTaskId?: string;
      immediateTaskId?: string;
    }
  | { kind: 'rename'; projectId: string; envelope: RenameProject };
interface PanelVisit {
  taskId: string;
  tab: PanelTab;
  focusId?: string;
  scrollTop?: number;
  scrollLeft?: number;
}
interface UndoFocus {
  trigger: HTMLButtonElement;
  projectId: string;
}
function asError(error: unknown) {
  return error instanceof ApiError
    ? error
    : new ApiError('UNKNOWN_ERROR', strings.genericError);
}
function isTextInput(target: EventTarget | null) {
  return (
    target instanceof HTMLElement &&
    (['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName) ||
      target.isContentEditable)
  );
}
export function App() {
  const initialVisit = useRef(parseWorkspaceUrl(new URL(window.location.href)));
  const [projectView, setProjectView] = useState<ProjectView>('tasks');
  const [journalQuery, setJournalQuery] = useState<JournalProjectQuery>({});
  const feedPosition = useRef<JournalPosition>({
    id: null,
    date: null,
    offset: 0,
    top: 0,
    left: 0,
  });
  const [restoreFeed, setRestoreFeed] = useState<JournalPosition | undefined>(
    undefined,
  );
  const journalOrigin = useRef<HTMLElement | null>(null);
  const journalFocus = useRef(0);
  const journalFocusRequest = useRef<{ taskId: string; token: number } | null>(
    null,
  );
  const timelineView = useRef<TimelineViewState | undefined>(undefined);
  const [restoreTimeline, setRestoreTimeline] = useState<
    TimelineRestoreRequest | undefined
  >(undefined);
  type SessionVisit = {
    visit: WorkspaceVisit;
    index: number;
    collapsed: Set<string>;
    filter: TaskFilter;
    showGantt: boolean;
    query: JournalProjectQuery;
    timeline: TimelineViewState | undefined;
    scroll: JournalPosition;
    origin: HTMLElement | null;
  };
  const visits = useRef(new Map<string, SessionVisit>());
  const visitId = useRef<string | null>(null);
  const restoringVisit = useRef<SessionVisit | null>(null);
  const restorationApplied = useRef(false);
  const [restorationTick, setRestorationTick] = useState(0);
  const suppressedPop = useRef(false);
  const [session, setSession] = useState<AuthSession | null>(null);
  const sessionRef = useRef(session);
  sessionRef.current = session;
  const knownRevision = useRef<{ projectId: string; revision: number } | null>(
    null,
  );
  const [projects, setProjects] = useState<Project[]>([]);
  const [tree, setTree] = useState<ProjectTree | null>(null);
  const [durationChoice, setDurationChoice] = useState<{
    task: Task;
    patch: import('../shared/contracts.js').SourcePatch;
    target: string;
    projectId: string;
    revision: number;
  } | null>(null);
  const [selected, setSelected] = useState<Task | null>(null);
  const [panelTab, setPanelTab] = useState<PanelTab>('details');
  const [panelHistory, setPanelHistory] = useState<PanelVisit[]>([]);
  const panelOrigin = useRef<string | null>(null);
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const [taskFilter, setTaskFilter] = useState<TaskFilter>(emptyTaskFilter);
  const [quickDrafts, setQuickDrafts] = useState<Record<string, QuickDraft>>(
    {},
  );
  const quickRawVersions = useRef(new Map<string, number>());
  function noteQuickRawEdit(key: string) {
    quickRawVersions.current.set(
      key,
      (quickRawVersions.current.get(key) ?? 0) + 1,
    );
  }
  const [quickAcknowledgements, setQuickAcknowledgements] = useState<
    Record<string, number>
  >({});
  const [panelAcknowledgement, setPanelAcknowledgement] =
    useState<ProjectTree | null>(null);
  const [immediateHost, setImmediateHost] = useState<{
    taskId: string;
    projectId: string;
    trigger: HTMLElement;
  } | null>(null);
  const immediateHostRef = useRef(immediateHost);
  immediateHostRef.current = immediateHost;
  const [restoreImmediate, setRestoreImmediate] =
    useState<typeof immediateHost>(null);
  const undoFocus = useRef<UndoFocus | null>(null);
  const [restoreUndo, setRestoreUndo] = useState<{
    request: UndoFocus;
    snapshot: ProjectTree;
  } | null>(null);
  const [quickEditing, setQuickEditing] = useState(false);
  const quickOrigin = useRef<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<ApiError | null>(null);
  const [conflict, setConflict] = useState(false);
  const [notice, setNotice] = useState('');
  const [dirty, setDirty] = useState(false);
  const [projectDirty, setProjectDirty] = useState(false);
  const restoreStartHandle = useRef<{
    taskId: string;
    projectId: string;
    revealed?: boolean;
  } | null>(null);
  const [showGantt, setShowGantt] = useState(true);
  const [ganttReveal, setGanttReveal] = useState<GanttReveal | null>(null);
  const projectDirtyRef = useRef(false);
  const setProjectPlanDirty = useCallback((value: boolean) => {
    projectDirtyRef.current = value;
    setProjectDirty(value);
  }, []);
  const [pending, setPending] = useState<Mutation | null>(null);
  function cancelStartFocus() {
    restoreStartHandle.current = null;
    setGanttReveal((previous) => (previous?.focusStart ? null : previous));
  }
  function ownsStartFocus(target: Element | null, taskId: string) {
    // Busy removes the handle and implicitly focuses body. Recovery controls
    // belong to this command; any other focused control takes ownership away.
    return (
      target === document.body ||
      target?.getAttribute('data-gantt-resize-start') === taskId ||
      !!target?.closest('[data-gantt-start-recovery]')
    );
  }
  function restoreVisibleStart(taskId: string) {
    const restore = restoreStartHandle.current;
    if (
      !restore ||
      restore.taskId !== taskId ||
      !showGantt ||
      busy ||
      pending ||
      loading ||
      conflict ||
      tree?.project.id !== restore.projectId
    )
      return;
    if (!ownsStartFocus(document.activeElement, taskId)) {
      cancelStartFocus();
      return;
    }
    const handle = document.querySelector<SVGElement>(
      `[data-gantt-resize-start="${taskId}"]`,
    );
    if (!handle) return;
    handle.focus();
    restoreStartHandle.current = null;
  }
  useEffect(() => {
    const restore = restoreStartHandle.current;
    if (!restore || busy || pending || loading || conflict) return;
    if (!showGantt || tree?.project.id !== restore.projectId) {
      cancelStartFocus();
      return;
    }
    restoreVisibleStart(restore.taskId);
    if (restoreStartHandle.current && !restore.revealed) {
      restore.revealed = true;
      setGanttReveal((previous) => ({
        taskId: restore.taskId,
        sequence: (previous?.sequence ?? 0) + 1,
        focusStart: true,
      }));
    }
  }, [busy, pending, loading, conflict, tree, showGantt]);
  const [projectControlsOpen, setProjectControlsOpen] = useState(false);
  const [projectMenuTarget, setProjectMenuTarget] = useState<string | null>(
    null,
  );
  const [rename, setRename] = useState<string | null>(null);
  const [password, setPassword] = useState('');
  const [createUncertain, setCreateUncertain] = useState(false);
  const treeRef = useRef(tree);
  const pendingRef = useRef<Mutation | null>(null);
  const lock = useRef(false);
  const loadSequence = useRef(0);
  const dirtyRef = useRef(false);
  const conflictRef = useRef(conflict);
  conflictRef.current = conflict;
  const panelActions = useRef<TaskPanelActions | null>(null);
  const registerPanelActions = useCallback(
    (actions: TaskPanelActions | null) => {
      panelActions.current = actions;
    },
    [],
  );
  const pendingNavigation = useRef<{
    proceed: () => void;
    taskId: string | null;
    projectId: string | null;
    session: typeof sessionRef.current;
  } | null>(null);
  const [leaveOpen, setLeaveOpen] = useState(false);
  const [leaveSaving, setLeaveSaving] = useState(false);
  const selectedIdentity = useRef(selected?.id ?? null);
  selectedIdentity.current = selected?.id ?? null;
  const branchRestore = useRef(0);

  const currentProject = useRef<string | null>(null);
  const context = (tree && quickDrafts[tree.project.id]?.context) || {
    parentId: null,
  };
  const hasQuickDrafts = Object.values(quickDrafts).some(hasQuickDraft);
  const uncertain = !!pending && !!error?.uncertain;
  const panelRetry =
    uncertain &&
    pending?.kind === 'command' &&
    (pending.envelope.command.type === 'task.update' ||
      pending.envelope.command.type === 'task.edit') &&
    pending.envelope.command.taskId === selected?.id;
  const setPanelDirty = useCallback((value: boolean) => {
    dirtyRef.current = value;
    setDirty(value);
  }, []);
  const projectToday = useProjectToday(tree?.project.timezone ?? 'UTC');
  function clearTaskNavigation() {
    pendingNavigation.current = null;
    setLeaveOpen(false);
    ++branchRestore.current;
  }
  function expireSession() {
    clearTaskNavigation();
    ++loadSequence.current;
    journal.clearPrivateState();
    knownRevision.current = null;
    setSession({
      authenticated: false,
      setupRequired: false,
      ...(session?.demoMode ? { demoMode: true } : {}),
    });
    setProjects([]);
    setTree(null);
    treeRef.current = null;
    currentProject.current = null;
    setSelected(null);
    setQuickDrafts({});
    quickRawVersions.current.clear();
    setPending(null);
    pendingRef.current = null;
    setConflict(false);
    setPanelDirty(false);
    setProjectPlanDirty(false);
    visits.current.clear();
    visitId.current = null;
  }
  const journal = useJournal(
    session?.authenticated &&
      tree &&
      !loading &&
      tree.project.id === currentProject.current
      ? {
          status: 'active',
          projectId: tree.project.id,
          taskId: selected?.id ?? null,
          today: projectToday,
          projectQuery: journalQuery,
          planningTree: tree,
          planningDirty: dirty || projectDirty,
          planningUncertain: uncertain,
          planningBusy: busy || !!pending,
          applyCleanTree: (next) => {
            if (
              dirtyRef.current ||
              projectDirtyRef.current ||
              lock.current ||
              pendingRef.current
            )
              return false;
            return apply(next);
          },
          onAuthRequired: expireSession,
        }
      : {
          status: 'inactive',
          reason: !session
            ? 'auth-loading'
            : !session.authenticated
              ? 'signed-out'
              : loading
                ? 'project-loading'
                : !projects.length
                  ? 'no-projects'
                  : 'project-unavailable',
          onAuthRequired: expireSession,
        },
  );
  const journalLocked = journal.writing || !!journal.pending;
  for (const feed of [journal.projectFeed, journal.taskFeed]) {
    const metadata = feed?.metadata;
    if (
      metadata &&
      metadata.projectId === currentProject.current &&
      metadata.revision === feed?.page?.projectRevision
    ) {
      if (
        knownRevision.current?.projectId !== metadata.projectId ||
        knownRevision.current.revision < metadata.revision
      )
        knownRevision.current = {
          projectId: metadata.projectId,
          revision: metadata.revision,
        };
    }
  }
  function openTaskJournal(task: Task, trigger: HTMLElement): boolean {
    if (journalLocked) return false;
    const proceed = () => {
      journalOrigin.current = trigger;
      panelOrigin.current = task.id;
      setSelected(task);
      setPanelTab('journal');
      setPanelHistory([]);
      journal.openCreate(task.projectId, task.id, projectToday);
      journalFocusRequest.current = {
        taskId: task.id,
        token: ++journalFocus.current,
      };
    };
    if (selected?.id === task.id) proceed();
    else requestTaskNavigation(proceed);
    return true;
  }
  function changeProjectView(view: ProjectView) {
    if (journalLocked) return;
    lastCapture.current();
    cancelStartFocus();
    ++journalFocus.current;
    setProjectView(view);
  }
  function updateQuick(
    projectId: string,
    update: (draft: QuickDraft) => QuickDraft,
  ) {
    setQuickDrafts((previous) => ({
      ...previous,
      [projectId]: update(
        previous[projectId] ?? {
          title: '',
          predecessorIds: [],
          context: { parentId: null },
          plan: newTaskPlan(),
        },
      ),
    }));
  }
  function setContext(next: AddContext) {
    if (currentProject.current)
      updateQuick(currentProject.current, (draft) => ({
        ...draft,
        context: next,
      }));
  }
  function apply(next: ProjectTree) {
    if (currentProject.current !== next.project.id) return false;
    if (
      treeRef.current?.project.id === next.project.id &&
      treeRef.current.project.revision > next.project.revision
    )
      return false;
    setDurationChoice((choice) =>
      choice?.projectId === next.project.id &&
      choice.revision === next.project.revision
        ? choice
        : null,
    );
    treeRef.current = next;
    setTree(next);
    setQuickDrafts((previous) => {
      const saved = previous[next.project.id];
      const after = orderedChildren(next.tasks, null).at(-1);
      const preview = saved?.context ?? {
        parentId: null,
        ...(after ? { afterId: after.id } : {}),
      };
      const parentId =
        preview.parentId &&
        next.tasks.some((task) => task.id === preview.parentId)
          ? preview.parentId
          : null;
      return {
        ...previous,
        [next.project.id]: {
          title: saved?.title ?? '',
          predecessorIds: saved?.predecessorIds ?? [],
          plan: saved?.plan ?? newTaskPlan(),
          context: {
            parentId,
            ...(preview.afterId &&
            next.tasks.some(
              (task) =>
                task.id === preview.afterId && task.parentId === parentId,
            )
              ? { afterId: preview.afterId }
              : {}),
          },
        },
      };
    });
    setProjects((previous) =>
      previous.map((project) =>
        project.id === next.project.id ? next.project : project,
      ),
    );
    setSelected((previous) => {
      if (!previous) return null;
      const current = next.tasks.find((task) => task.id === previous.id);
      if (current) return current;
      if (
        dirtyRef.current ||
        [...journal.drafts.values()].some(
          (draft) =>
            draft.projectId === next.project.id &&
            draft.taskId === previous.id &&
            draft.dirty,
        ) ||
        (quickDrafts[`${next.project.id}/${previous.id}`] &&
          hasQuickDraft(quickDrafts[`${next.project.id}/${previous.id}`]!))
      )
        return previous;
      if (projectView === 'tasks')
        requestAnimationFrame(() =>
          document.getElementById('quick-task')?.focus(),
        );
      return null;
    });
    return true;
  }
  function canNavigate(allowRename = false, allowTaskDraft = false) {
    lastCapture.current();
    if (journalLocked) {
      setNotice('Повторите сохранение записи перед переходом.');
      return false;
    }
    if (lock.current || pendingRef.current || conflictRef.current || loading)
      return false;
    if (
      (!allowTaskDraft && dirtyRef.current) ||
      projectDirtyRef.current ||
      (!allowRename &&
        rename !== null &&
        rename !== treeRef.current?.project.title)
    ) {
      setNotice(strings.unsaved);
      return false;
    }
    setNotice('');
    return true;
  }
  function requestTaskNavigation(proceed: () => void): void {
    ++branchRestore.current;
    if (!canNavigate(false, true)) return;
    if (!dirtyRef.current) {
      clearTaskNavigation();
      proceed();
      return;
    }
    pendingNavigation.current = {
      proceed,
      taskId: selectedIdentity.current,
      projectId: currentProject.current,
      session: sessionRef.current,
    };
    setLeaveOpen(true);
  }
  function navigationStillCurrent(
    next: NonNullable<typeof pendingNavigation.current>,
  ) {
    return (
      pendingNavigation.current === next &&
      selectedIdentity.current === next.taskId &&
      currentProject.current === next.projectId &&
      sessionRef.current === next.session
    );
  }
  async function saveAndNavigate() {
    const next = pendingNavigation.current;
    const actions = panelActions.current;
    if (!next || !actions || !canNavigate(false, true)) return;
    setLeaveSaving(true);
    const saved = await actions.save();
    setLeaveSaving(false);
    if (!navigationStillCurrent(next)) return;
    if (!saved || dirtyRef.current || !canNavigate()) {
      // Return to the panel for repair/retry. The attempted transition is never queued.
      clearTaskNavigation();
      return;
    }
    clearTaskNavigation();
    next.proceed();
  }
  function discardAndNavigate() {
    const next = pendingNavigation.current;
    if (!next || !navigationStillCurrent(next) || !canNavigate(false, true))
      return;
    panelActions.current?.reset();
    clearTaskNavigation();
    next.proceed();
  }
  function branchVisit(focusId?: string): PanelVisit {
    const panel = document.querySelector<HTMLElement>('.task-panel');
    const owner = panel ? panelScrollOwner(panel) : null;
    return {
      taskId: selected!.id,
      tab: panelTab,
      ...(focusId ? { focusId } : {}),
      scrollTop: owner?.scrollTop ?? 0,
      scrollLeft: owner?.scrollLeft ?? 0,
    };
  }
  async function loadProject(id: string, preserveDraft = false) {
    if (restoreStartHandle.current?.projectId !== id) cancelStartFocus();
    setDurationChoice(null);
    if (!preserveDraft) setImmediateHost(null);
    const sequence = ++loadSequence.current;
    currentProject.current = id;
    setLoading(true);
    setError(null);
    setNotice('');
    if (!preserveDraft) {
      setProjectView('tasks');
      setShowGantt(true);
      timelineView.current = undefined;
      feedPosition.current = {
        id: null,
        date: null,
        offset: 0,
        top: 0,
        left: 0,
      };
      setRestoreFeed(undefined);
      setJournalQuery({});
      setRestoreTimeline(undefined);
      ++journalFocus.current;
      setQuickEditing(false);
      quickOrigin.current = null;
      setSelected(null);
      setPanelHistory([]);
      setPanelTab('details');
      setPanelDirty(false);
      setProjectPlanDirty(false);
      setTree(null);
      treeRef.current = null;
      setCollapsed(new Set());
      setTaskFilter(emptyTaskFilter);
      setRename(null);
    }
    try {
      const next = await api.tree(id);
      if (sequence !== loadSequence.current) return;
      if (!apply(next)) {
        setError(new ApiError('STALE_SNAPSHOT', strings.staleSnapshot));
        return;
      }
      setConflict(false);
      pendingRef.current = null;
      setPending(null);
    } catch (failure) {
      if (sequence === loadSequence.current) setError(asError(failure));
    } finally {
      if (sequence === loadSequence.current) setLoading(false);
    }
  }
  async function loadProjects() {
    setLoading(true);
    setError(null);
    try {
      const items = await api.projects();
      setProjects(items);
      setCreateUncertain(false);
      const unavailableVisit =
        initialVisit.current &&
        !items.some((item) => item.id === initialVisit.current?.projectId);
      if (unavailableVisit) initialVisit.current = null;
      if (initialVisit.current)
        await loadProject(initialVisit.current.projectId);
      else if (items[0])
        await loadProject(
          currentProject.current &&
            items.some((item) => item.id === currentProject.current)
            ? currentProject.current
            : items[0].id,
        );
      if (unavailableVisit)
        setNotice('Проект из ссылки недоступен. Показаны доступные проекты.');
    } catch (failure) {
      setError(asError(failure));
    } finally {
      setLoading(false);
    }
  }
  useEffect(() => {
    if (error?.status === 401 && session?.authenticated) expireSession();
  }, [error, session]);
  async function initialize() {
    setLoading(true);
    setError(null);
    try {
      const auth = await api.session();
      setSession(auth);
      if (auth.authenticated) await loadProjects();
    } catch (failure) {
      setError(asError(failure));
    } finally {
      setLoading(false);
    }
  }
  useEffect(() => {
    void initialize();
    return () => {
      ++loadSequence.current;
    };
  }, []);
  useEffect(() => {
    const beforeUnload = (event: BeforeUnloadEvent) => {
      if (
        journal.hasDirtyDrafts ||
        journalLocked ||
        dirty ||
        projectDirty ||
        hasQuickDrafts ||
        pending ||
        busy ||
        (rename !== null && rename !== tree?.project.title)
      ) {
        event.preventDefault();
        event.returnValue = '';
      }
    };
    window.addEventListener('beforeunload', beforeUnload);
    return () => window.removeEventListener('beforeunload', beforeUnload);
  }, [
    dirty,
    projectDirty,
    hasQuickDrafts,
    pending,
    busy,
    rename,
    tree,
    journal.hasDirtyDrafts,
    journalLocked,
  ]);
  useEffect(() => {
    const keydown = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && selected) {
        event.preventDefault();
        closePanel();
      }
      if (
        (event.ctrlKey || event.metaKey) &&
        event.key.toLowerCase() === 'z' &&
        !isTextInput(event.target)
      ) {
        event.preventDefault();
        void undo();
      }
    };
    window.addEventListener('keydown', keydown);
    return () => window.removeEventListener('keydown', keydown);
  });
  async function execute(job: Mutation): Promise<ProjectTree | null> {
    if (lock.current || journalLocked) return null;
    lock.current = true;
    setBusy(true);
    setError(null);
    setNotice('');
    pendingRef.current = job;
    setPending(job);
    const commandSession = sessionRef.current;
    try {
      const next =
        job.kind === 'command'
          ? await api.command(job.projectId, job.envelope)
          : await api.rename(job.projectId, job.envelope);
      if (
        currentProject.current !== job.projectId ||
        next.project.id !== job.projectId ||
        sessionRef.current !== commandSession ||
        !commandSession?.authenticated ||
        pendingRef.current !== job
      )
        return null;
      // A validated success acknowledges this exact operation even when its frozen
      // snapshot predates a revision already observed by a coherent journal read.
      const floor = Math.max(
        treeRef.current?.project.revision ?? 0,
        knownRevision.current?.projectId === job.projectId
          ? knownRevision.current.revision
          : 0,
      );
      pendingRef.current = null;
      setPending(null);
      if (next.project.revision >= floor) {
        apply(next);
      } else {
        try {
          const current = await api.tree(job.projectId);
          if (
            currentProject.current !== job.projectId ||
            sessionRef.current !== commandSession
          )
            return null;
          const currentFloor = Math.max(
            floor,
            treeRef.current?.project.revision ?? 0,
            knownRevision.current?.projectId === job.projectId
              ? knownRevision.current.revision
              : 0,
          );
          if (current.project.revision < currentFloor || !apply(current))
            throw new ApiError('STALE_SNAPSHOT', strings.staleSnapshot);
          if (job.kind === 'command' && job.panelTaskId) {
            const savedTask = next.tasks.find(
              (task) => task.id === job.panelTaskId,
            );
            const currentTask = current.tasks.find(
              (task) => task.id === job.panelTaskId,
            );
            const editable = (task: Task | undefined, snapshot: ProjectTree) =>
              task &&
              JSON.stringify({
                title: task.title,
                description: task.description,
                status: task.status,
                inputStart: task.inputStart,
                inputFinish: task.inputFinish,
                durationDays: task.durationDays,
                incoming: incomingPredecessorIds(snapshot, task.id),
              });
            if (editable(savedTask, next) !== editable(currentTask, current)) {
              setConflict(true);
              setError(new ApiError('STALE_SNAPSHOT', strings.staleSnapshot));
            }
          }
        } catch (failure) {
          // Read recovery cannot make an acknowledged write uncertain again.
          setError(asError(failure));
          setConflict(true);
        }
      }
      if (job.kind === 'command' && job.panelTaskId)
        setPanelAcknowledgement(next);
      if (
        job.kind === 'command' &&
        job.immediateTaskId &&
        immediateHostRef.current?.taskId === job.immediateTaskId &&
        immediateHostRef.current.projectId === job.projectId
      ) {
        setRestoreImmediate(immediateHostRef.current);
        setImmediateHost(null);
      }
      if (
        job.kind === 'command' &&
        job.envelope.command.type === 'task.create'
      ) {
        const added = job.envelope.command;
        const created = next.tasks.find(
          (task) =>
            !job.knownIds.includes(task.id) &&
            task.title === added.title.trim() &&
            task.parentId === added.parentId,
        );
        const key = job.quickKey ?? job.projectId;
        updateQuick(key, (draft) => {
          if (
            !job.sentQuickDraft ||
            (quickRawVersions.current.get(key) ?? 0) !==
              (job.sentQuickRawVersion ?? 0) ||
            !sameQuickDraft(draft, job.sentQuickDraft)
          )
            return draft;
          return {
            title: '',
            plan: newTaskPlan(),
            predecessorIds: [],
            context: created
              ? { parentId: created.parentId, afterId: created.id }
              : draft.context,
          };
        });
        setQuickAcknowledgements((previous) => ({
          ...previous,
          [key]: (previous[key] ?? 0) + 1,
        }));
        if (added.parentId)
          setCollapsed((previous) => {
            const expanded = new Set(previous);
            expanded.delete(added.parentId!);
            return expanded;
          });
      }
      pendingRef.current = null;
      setPending(null);
      void journal.refresh();
      return next;
    } catch (failure) {
      const failed = asError(failure);
      setError(failed);
      if (failed.status === 409) setConflict(true);
      if (!failed.uncertain) {
        pendingRef.current = null;
        setPending(null);
      }
      return null;
    } finally {
      lock.current = false;
      setBusy(false);
    }
  }
  async function commandTree(
    value: Command,
    options: {
      quickKey?: string;
      sentQuickDraft?: QuickDraft;
      sentQuickRawVersion?: number;
      panelTaskId?: string;
      immediateTaskId?: string;
    } = {},
  ) {
    if (
      journalLocked ||
      conflict ||
      loading ||
      lock.current ||
      !treeRef.current
    )
      return null;
    if (pendingRef.current) return execute(pendingRef.current);
    return execute({
      kind: 'command',
      projectId: treeRef.current.project.id,
      knownIds: treeRef.current.tasks.map((task) => task.id),
      ...options,
      envelope: {
        contractVersion: 2,
        expectedRevision: treeRef.current.project.revision,
        operationId: crypto.randomUUID(),
        command: value,
      },
    });
  }
  async function command(value: Command) {
    return !!(await commandTree(value));
  }
  function openPredecessors(task: Task, trigger: HTMLElement) {
    if (
      !canNavigate() ||
      !treeRef.current ||
      task.projectId !== treeRef.current.project.id
    )
      return;
    if (treeRef.current.tasks.some((child) => child.parentId === task.id)) {
      setNotice(strings.chooseLeaf);
      return;
    }
    setImmediateHost({ taskId: task.id, projectId: task.projectId, trigger });
  }
  function closePredecessors() {
    setRestoreImmediate(immediateHostRef.current);
    setImmediateHost(null);
  }
  useEffect(() => {
    if (!restoreImmediate || busy || loading || pending) return;
    if (
      restoreImmediate.trigger.isConnected &&
      !restoreImmediate.trigger.matches(':disabled') &&
      !restoreImmediate.trigger.closest('[hidden]')
    )
      restoreImmediate.trigger.focus();
    else {
      const inputId =
        restoreImmediate.trigger.dataset.quickInput ?? 'quick-task';
      const scope =
        inputId === 'quick-subtask'
          ? document.querySelector<HTMLElement>(
              '#panel-details .panel-subtasks',
            )
          : document;
      if (!scope || !focusTaskRow(restoreImmediate.taskId, scope))
        (
          document.getElementById(inputId) ??
          document.getElementById('quick-task')
        )?.focus();
    }
    setRestoreImmediate(null);
  }, [restoreImmediate, busy, loading, pending]);
  function immediateRelation(id: string, remove: boolean) {
    const host = immediateHostRef.current,
      current = treeRef.current;
    if (
      !host ||
      !current ||
      host.projectId !== current.project.id ||
      !canNavigate()
    )
      return;
    const edge = current.dependencies.find(
      (edge) => edge.predecessorId === id && edge.successorId === host.taskId,
    );
    if (remove && !edge) return;
    void commandTree(
      remove
        ? { type: 'dependency.delete', dependencyId: edge!.id }
        : {
            type: 'dependency.create',
            predecessorId: id,
            successorId: host.taskId,
          },
      { immediateTaskId: host.taskId },
    );
  }
  function preserveWork(parentId: string | null) {
    const current = treeRef.current;
    const parent = current?.tasks.find((task) => task.id === parentId);
    if (
      current &&
      parent &&
      !current.tasks.some((task) => task.parentId === parent.id) &&
      requiresWorkPreservation(parent, current.dependencies)
    )
      return window.confirm(strings.preserveConfirm) ? true : null;
    return false;
  }
  async function createTask(
    title: string,
    addContext: AddContext,
    plan: SourceFields,
    predecessorIds: string[],
    quickKey?: string,
  ) {
    if (!canNavigate()) return false;
    const preserved = preserveWork(addContext.parentId);
    if (preserved === null) return false;
    const key = quickKey ?? treeRef.current!.project.id;
    return !!(await commandTree(
      {
        type: 'task.create',
        predecessorIds: [...predecessorIds],
        ...plan,
        title,
        ...addContext,
        ...(preserved ? { preserveWork: true } : {}),
      },
      {
        quickKey: key,
        sentQuickRawVersion: quickRawVersions.current.get(key) ?? 0,
        sentQuickDraft: {
          title,
          context: { ...addContext },
          plan: { ...plan },
          predecessorIds: [...predecessorIds],
        },
      },
    ));
  }
  // false: refused, or the reused panel will not take focus (focus returns to the trigger).
  function selectTask(task: Task): boolean {
    requestTaskNavigation(() => {
      setSelected(task);
      setPanelTab('details');
      setPanelHistory([]);
      panelOrigin.current = task.id;
      // C31: selecting a row never moves the quick input; an untouched one returns to the end.
      const draft = quickDrafts[task.projectId];
      if (!draft || !hasQuickDraft(draft)) {
        setQuickEditing(false);
        quickOrigin.current = null;
        setContext({ parentId: null });
      }
    });
    return true;
  }
  function closePanel() {
    requestTaskNavigation(() => {
      const id = selected?.id;
      ++journalFocus.current;
      setSelected(null);
      setPanelHistory([]);
      if (projectView === 'journal' && journalOrigin.current?.isConnected) {
        journalOrigin.current.focus();
        return;
      }
      const mainTree = document.querySelector(
        `[role="tree"][aria-label="${strings.tasks}"]`,
      );
      if (
        !mainTree ||
        !(
          (id && focusTaskRow(id, mainTree)) ||
          (panelOrigin.current && focusTaskRow(panelOrigin.current, mainTree))
        )
      )
        document.getElementById('quick-task')?.focus();
    });
  }
  function selectSubtask(task: Task): boolean {
    requestTaskNavigation(() => {
      if (selected)
        setPanelHistory((previous) => [...previous, branchVisit(task.id)]);
      setSelected(task);
      setPanelTab('details');
    });
    return true;
  }
  function selectNeighbor(task: Task) {
    requestTaskNavigation(() => {
      if (selected) setPanelHistory((previous) => [...previous, branchVisit()]);
      setSelected(task);
      setPanelTab('dependencies');
    });
  }
  function showOnGantt(task: Task) {
    requestTaskNavigation(() => {
      if (!treeRef.current) return;
      cancelStartFocus();
      setProjectView('tasks');
      setTaskFilter(emptyTaskFilter);
      const byId = new Map(
        treeRef.current.tasks.map((item) => [item.id, item]),
      );
      setCollapsed((previous) => {
        const next = new Set(previous);
        let parent = task.parentId;
        while (parent) {
          next.delete(parent);
          parent = byId.get(parent)?.parentId ?? null;
        }
        return next;
      });
      setShowGantt(true);
      setGanttReveal((previous) => ({
        taskId: task.id,
        sequence: (previous?.sequence ?? 0) + 1,
      }));
    });
  }
  function toggle(id: string) {
    setCollapsed((previous) => {
      const next = new Set(previous);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }
  async function moveTask(
    task: Task,
    parentId: string | null,
    position?: number,
  ) {
    if (!canNavigate()) return;
    try {
      assertCanMove(treeRef.current?.tasks ?? [], task.id, parentId);
    } catch {
      setNotice('Нельзя перенести задачу в выбранную ветку.');
      return;
    }
    const originTree = document.activeElement?.closest('[role="tree"]');
    const preserved =
      task.parentId === parentId ? false : preserveWork(parentId);
    if (preserved === null) return;
    const siblings = orderedChildren(
      treeRef.current?.tasks ?? [],
      parentId,
    ).filter((sibling) => sibling.id !== task.id);
    if (
      await command({
        type: 'task.move',
        taskId: task.id,
        parentId,
        position: position ?? siblings.length,
        ...(preserved ? { preserveWork: true } : {}),
      })
    ) {
      if (parentId)
        setCollapsed((previous) => {
          const next = new Set(previous);
          next.delete(parentId);
          return next;
        });
      requestAnimationFrame(() => {
        if (
          !originTree ||
          !originTree.isConnected ||
          !focusTaskRow(task.id, originTree)
        )
          focusTaskRow(task.id);
      });
    }
  }
  function action(value: TreeAction, task: Task): boolean | void {
    if (!canNavigate()) return false;
    if (value === 'sibling' || value === 'child') {
      quickOrigin.current = task.id;
      setQuickEditing(true);
      setTaskFilter(emptyTaskFilter);
      if (value === 'child')
        setCollapsed((previous) => {
          const next = new Set(previous);
          next.delete(task.id);
          return next;
        });
      setContext(
        value === 'child'
          ? { parentId: task.id }
          : { parentId: task.parentId, afterId: task.id },
      );
      setSelected(null);
      requestAnimationFrame(() =>
        document.getElementById('quick-task')?.focus(),
      );
      return;
    }
    if (value === 'delete') {
      if (!window.confirm(strings.deleteConfirm)) return false;
      void command({ type: 'task.delete', taskId: task.id });
      return;
    }
    const tasks = treeRef.current?.tasks ?? [];
    const siblings = orderedChildren(tasks, task.parentId);
    const index = siblings.findIndex((sibling) => sibling.id === task.id);
    if (value === 'up' && index > 0)
      void moveTask(task, task.parentId, index - 1);
    if (value === 'down' && index < siblings.length - 1)
      void moveTask(task, task.parentId, index + 1);
    if (value === 'in' && siblings[index - 1])
      void moveTask(task, siblings[index - 1]!.id);
    if (value === 'out' && task.parentId) {
      const parent = tasks.find((candidate) => candidate.id === task.parentId);
      if (parent)
        void moveTask(
          task,
          parent.parentId,
          orderedChildren(tasks, parent.parentId).findIndex(
            (sibling) => sibling.id === parent.id,
          ) + 1,
        );
    }
  }
  useLayoutEffect(() => {
    if (!restoreUndo) return;
    const { request, snapshot } = restoreUndo;
    if (
      undoFocus.current !== request ||
      tree?.project.id !== request.projectId ||
      !request.trigger.isConnected
    ) {
      setRestoreUndo(null);
      if (undoFocus.current === request) undoFocus.current = null;
      return;
    }
    // Wait for the acknowledged tree and enabled controls to reach the DOM.
    if (tree !== snapshot || busy || loading || pending) return;
    undoFocus.current = null;
    setRestoreUndo(null);
    if (
      document.activeElement !== document.body &&
      document.activeElement !== request.trigger
    )
      return;
    if (!request.trigger.disabled) request.trigger.focus();
    else {
      const row = document.querySelector<HTMLElement>(
        '[role="tree"][aria-label="Задачи"] [role="treeitem"][tabindex="0"]',
      );
      if (row) row.focus();
      else document.getElementById('quick-task')?.focus();
    }
  }, [restoreUndo, tree, busy, loading, pending]);
  async function undo() {
    if (!canNavigate() || !treeRef.current?.canUndo) return;
    const trigger = document.activeElement;
    const request =
      trigger instanceof HTMLButtonElement
        ? { trigger, projectId: treeRef.current.project.id }
        : null;
    undoFocus.current = request;
    const next = await commandTree({ type: 'undo' });
    if (next && request && undoFocus.current === request)
      setRestoreUndo({ request, snapshot: next });
    else if (undoFocus.current === request) undoFocus.current = null;
  }
  async function planTask(task: Task, kind: PlanGestureKind, target: string) {
    if (!canNavigate() || !treeRef.current) return;
    try {
      const currentTask = treeRef.current.tasks.find(
        (candidate) => candidate.id === task.id,
      );
      if (
        !currentTask ||
        currentTask !== task ||
        treeRef.current.tasks.some(
          (candidate) => candidate.parentId === task.id,
        )
      )
        return;
      if (
        treeRef.current.schedule.summaries[task.id] ||
        !treeRef.current.schedule.tasks[task.id]?.startDate
      )
        return;
      if (kind === 'resize-start') {
        validateStartResize(
          currentTask,
          treeRef.current.project.calendarType,
          target,
        );
        if (currentTask.inputStart === target) return;
        if (
          document.activeElement?.getAttribute('data-gantt-resize-start') ===
          currentTask.id
        )
          restoreStartHandle.current = {
            taskId: currentTask.id,
            projectId: treeRef.current.project.id,
          };
        await command({
          type: 'task.resizeStart',
          taskId: currentTask.id,
          inputStart: target,
        });
        return;
      }
      const intent = gesturePatch(
        task,
        treeRef.current.project.calendarType,
        kind,
        target,
      );
      if (intent.requiresDurationChoice) {
        setDurationChoice({
          task,
          patch: intent.patch,
          target,
          projectId: treeRef.current.project.id,
          revision: treeRef.current.project.revision,
        });
        return;
      }
      await command({
        type: 'task.edit',
        taskId: task.id,
        changes: intent.patch,
      });
    } catch {
      setNotice(strings.invalidGesture);
    }
  }
  function finishDurationChoice(syncDuration: boolean) {
    const choice = durationChoice;
    const current = treeRef.current;
    setDurationChoice(null);
    if (
      !choice ||
      !current ||
      current.project.id !== choice.projectId ||
      current.project.revision !== choice.revision ||
      !canNavigate()
    )
      return;
    const task = current.tasks.find((item) => item.id === choice.task.id);
    if (!task?.inputStart || task.status === 'done') return;
    void command({
      type: 'task.edit',
      taskId: task.id,
      changes: {
        ...choice.patch,
        durationDays: syncDuration
          ? workingDaysInclusive(
              task.inputStart,
              choice.target,
              current.project.calendarType,
            )
          : null,
      },
    });
  }
  async function createProject(title: string) {
    if (!canNavigate() || createUncertain || !title.trim()) return false;
    lock.current = true;
    setBusy(true);
    setError(null);
    try {
      const project = await api.createProject(title);
      setProjects((previous) => [...previous, project]);
      await loadProject(project.id);
      return true;
    } catch (failure) {
      const failed = asError(failure);
      setError(failed);
      if (failed.uncertain) setCreateUncertain(true);
      return false;
    } finally {
      lock.current = false;
      setBusy(false);
    }
  }
  async function renameProject() {
    if (
      rename === null ||
      !canNavigate(true) ||
      !treeRef.current ||
      !rename.trim()
    )
      return;
    const success = await execute({
      kind: 'rename',
      projectId: treeRef.current.project.id,
      envelope: {
        title: rename,
        contractVersion: 2,
        expectedRevision: treeRef.current.project.revision,
        operationId: crypto.randomUUID(),
      },
    });
    if (success) setRename(null);
  }
  async function login() {
    if (lock.current || (!session?.demoMode && !password)) return;
    lock.current = true;
    setBusy(true);
    setError(null);
    try {
      const auth = await (session?.demoMode
        ? api.enterDemo()
        : api.login(password));
      setPassword('');
      setSession(auth);
      if (auth.authenticated) await loadProjects();
    } catch (failure) {
      setPassword('');
      setError(asError(failure));
    } finally {
      lock.current = false;
      setBusy(false);
    }
  }
  async function logout() {
    if (journalLocked) {
      setNotice('Повторите сохранение записи перед выходом.');
      return;
    }
    if (
      journal.hasDirtyDrafts &&
      !window.confirm('Выйти и потерять несохранённые черновики журнала?')
    )
      return;
    if (hasQuickDrafts) {
      setNotice(strings.unsavedQuick);
      return;
    }
    if (!canNavigate()) return;
    lock.current = true;
    setBusy(true);
    setError(null);
    try {
      await api.logout();
      clearTaskNavigation();
      journal.clearPrivateState();
      knownRevision.current = null;
      ++loadSequence.current;
      visits.current.clear();
      visitId.current = null;
      setSession({
        authenticated: false,
        setupRequired: false,
        ...(session?.demoMode ? { demoMode: true } : {}),
      });
      setProjects([]);
      setTree(null);
      treeRef.current = null;
      currentProject.current = null;
      setProjectMenuTarget(null);
      setSelected(null);
      setQuickDrafts({});
      quickRawVersions.current.clear();
    } catch (failure) {
      setError(asError(failure));
    } finally {
      lock.current = false;
      setBusy(false);
    }
  }
  function captureVisit() {
    const id = visitId.current,
      previous = id ? visits.current.get(id) : null;
    if (
      !id ||
      !previous ||
      loading ||
      restoringVisit.current ||
      tree?.project.id !== previous.visit.projectId
    )
      return;
    const feed = document.querySelector<HTMLElement>(
      '[data-journal-feed="project"]',
    );
    visits.current.set(id, {
      ...previous,
      collapsed: new Set(collapsed),
      filter: taskFilter,
      showGantt,
      query: journalQuery,
      timeline: timelineView.current,
      scroll: {
        ...feedPosition.current,
        top:
          feed && !feed.closest('[hidden]')
            ? feed.scrollTop
            : feedPosition.current.top,
        left:
          feed && !feed.closest('[hidden]')
            ? feed.scrollLeft
            : feedPosition.current.left,
      },
      origin: journalOrigin.current,
    });
  }
  const lastCapture = useRef(captureVisit);
  lastCapture.current = captureVisit;
  function adoptUnrememberedVisit(
    visit: WorkspaceVisit,
    snapshot?: SessionVisit,
  ): SessionVisit {
    // Reload loses the RAM indices. Adopt this actual browser entry as a new
    // local origin; no history delta can be inferred from an unfamiliar ID.
    const id = crypto.randomUUID();
    const saved: SessionVisit = {
      ...(snapshot ?? {
        collapsed: new Set(),
        filter: emptyTaskFilter,
        showGantt: true,
        query: {},
        timeline: undefined,
        scroll: { id: null, date: null, offset: 0, top: 0, left: 0 },
        origin: null,
      }),
      visit,
      index: 0,
    };
    visits.current.clear();
    visits.current.set(id, saved);
    visitId.current = id;
    writeWorkspaceVisit(visit, id, 'replace');
    return saved;
  }
  const navHandler = useRef<(event: PopStateEvent) => void>(() => {});
  navHandler.current = (event) => {
    if (suppressedPop.current) {
      suppressedPop.current = false;
      return;
    }
    const targetId = (
      event.state as { leaf?: { version?: number; visitId?: string } } | null
    )?.leaf?.visitId;
    // Repeated IDs cannot establish a distinct physical entry or target index.
    const target =
      targetId && targetId !== visitId.current
        ? visits.current.get(targetId)
        : undefined;
    const old = visitId.current
      ? visits.current.get(visitId.current)
      : undefined;
    if (!session?.authenticated) return;
    if (!canNavigate(false, true) || dirtyRef.current) {
      const parsed =
        target?.visit ?? parseWorkspaceUrl(new URL(window.location.href));
      if (old && target) {
        suppressedPop.current = true;
        window.history.go(old.index - target.index);
      } else if (old && visitId.current)
        adoptUnrememberedVisit(
          old.visit,
          visits.current.get(visitId.current) ?? old,
        );
      if (dirtyRef.current && parsed)
        requestTaskNavigation(() => {
          if (old && target) window.history.go(target.index - old.index);
          else {
            const saved = adoptUnrememberedVisit(parsed);
            restorationApplied.current = false;
            restoringVisit.current = saved;
            if (treeRef.current?.project.id !== parsed.projectId)
              void loadProject(parsed.projectId);
            else restoreWorkspace(saved, treeRef.current);
          }
        });
      return;
    }
    captureVisit();
    cancelStartFocus();
    ++journalFocus.current;
    const parsed =
      target?.visit ?? parseWorkspaceUrl(new URL(window.location.href));
    if (!parsed) return;
    restorationApplied.current = false;
    restoringVisit.current = target ?? adoptUnrememberedVisit(parsed);
    if (targetId && target) visitId.current = targetId;
    if (tree?.project.id !== parsed.projectId)
      void loadProject(parsed.projectId);
    else restoreWorkspace(restoringVisit.current, tree);
  };
  function restoreWorkspace(saved: SessionVisit, next: ProjectTree) {
    restorationApplied.current = true;
    setRestorationTick((value) => value + 1);
    setProjectView(saved.visit.view);
    setSelected(
      next.tasks.find((task) => task.id === saved.visit.taskId) ?? null,
    );
    setPanelTab(saved.visit.panel);
    setCollapsed(new Set(saved.collapsed));
    setTaskFilter(saved.filter);
    setShowGantt(saved.showGantt);
    setJournalQuery(saved.query);
    setRestoreTimeline(saved.timeline ? { state: saved.timeline } : undefined);
    setRestoreFeed({ ...saved.scroll });
    journalOrigin.current = saved.origin;
    ++journalFocus.current;
  }
  useEffect(() => {
    const handler = (event: PopStateEvent) => navHandler.current(event);
    window.addEventListener('popstate', handler);
    return () => window.removeEventListener('popstate', handler);
  }, []);
  useLayoutEffect(() => {
    if (!session?.authenticated || loading || !tree) return;
    if (initialVisit.current) {
      const visit = initialVisit.current;
      initialVisit.current = null;
      const id = crypto.randomUUID();
      visitId.current = id;
      const saved: SessionVisit = {
        visit,
        index: 0,
        collapsed: new Set(),
        filter: emptyTaskFilter,
        showGantt: true,
        query: {},
        timeline: undefined,
        scroll: { id: null, date: null, offset: 0, top: 0, left: 0 },
        origin: null,
      };
      visits.current.set(id, saved);
      writeWorkspaceVisit(visit, id, 'replace');
      restoringVisit.current = saved;
      restoreWorkspace(saved, tree);
      return;
    }
    if (restoringVisit.current) {
      const saved = restoringVisit.current;
      if (saved.visit.projectId !== tree.project.id) return;
      if (
        !restorationApplied.current ||
        projectView !== saved.visit.view ||
        panelTab !== saved.visit.panel ||
        (selected?.id ?? null) !==
          (tree.tasks.some((task) => task.id === saved.visit.taskId)
            ? saved.visit.taskId
            : null)
      ) {
        restoreWorkspace(saved, tree);
        return;
      }
      restoringVisit.current = null;
      if (visitId.current) visits.current.set(visitId.current, saved);
      return;
    }
    const visit: WorkspaceVisit = {
      projectId: tree.project.id,
      view: projectView,
      taskId: selected?.id ?? null,
      panel: panelTab,
    };
    const old = visitId.current ? visits.current.get(visitId.current) : null;
    if (old && JSON.stringify(old.visit) === JSON.stringify(visit)) return;
    const id = crypto.randomUUID();
    visitId.current = id;
    visits.current.set(id, {
      visit,
      index: old ? old.index + 1 : 0,
      collapsed: new Set(collapsed),
      filter: taskFilter,
      showGantt,
      query: journalQuery,
      timeline: timelineView.current,
      scroll: { id: null, date: null, offset: 0, top: 0, left: 0 },
      origin: journalOrigin.current,
    });
    writeWorkspaceVisit(visit, id, old ? 'push' : 'replace');
  }, [
    tree?.project.id,
    loading,
    projectView,
    selected?.id,
    panelTab,
    session?.authenticated,
    restorationTick,
  ]);
  useEffect(() => {
    captureVisit();
  }, [collapsed, taskFilter, showGantt, journalQuery]);
  const errorView = (
    <>
      {notice && (
        <div role="alert" className="error-message">
          <p>{notice}</p>
          {notice === strings.unsavedQuick && (
            <button
              type="button"
              onClick={() => {
                setQuickDrafts((previous) =>
                  Object.fromEntries(
                    Object.entries(previous).map(([id, draft]) => [
                      id,
                      {
                        ...draft,
                        title: '',
                        plan: newTaskPlan(),
                        predecessorIds: [],
                      },
                    ]),
                  ),
                );
                setNotice('');
              }}
            >
              {strings.discardQuickDrafts}
            </button>
          )}
        </div>
      )}
      {(error || conflict) && (
        <div className="error-message" role="alert">
          <p>{conflict ? strings.conflict : error?.message}</p>
          {conflict && error && error.status !== 409 && <p>{error.message}</p>}
          {conflict && tree && (
            <button
              type="button"
              disabled={busy || loading}
              data-gantt-start-recovery
              onClick={() => void loadProject(tree.project.id, true)}
            >
              {strings.reload}
            </button>
          )}
          {uncertain && (
            <button
              type="button"
              disabled={busy}
              data-gantt-start-recovery
              onClick={() => {
                if (pendingRef.current)
                  void execute(pendingRef.current).then((success) => {
                    if (success && pending?.kind === 'rename') setRename(null);
                  });
              }}
            >
              {strings.retry}
            </button>
          )}
          {createUncertain && (
            <>
              <p>{strings.projectCreateUncertain}</p>
              <button
                type="button"
                disabled={busy}
                onClick={() => void loadProjects()}
              >
                {strings.refreshProjects}
              </button>
            </>
          )}
          {!pending && !conflict && !createUncertain && !tree && (
            <button
              type="button"
              disabled={busy}
              onClick={() =>
                void (session?.authenticated
                  ? currentProject.current
                    ? loadProject(currentProject.current)
                    : loadProjects()
                  : initialize())
              }
            >
              {strings.retry}
            </button>
          )}
        </div>
      )}
    </>
  );
  if (!session?.authenticated)
    return (
      <main className="auth-screen">
        <div className="auth-card">
          <h1>{strings.app}</h1>
          {session?.demoMode && (
            <p className="demo-notice">{strings.demoNotice}</p>
          )}
          {loading ? (
            <p role="status">{strings.loading}</p>
          ) : session?.demoMode ? (
            <form
              onSubmit={(event) => {
                event.preventDefault();
                void login();
              }}
            >
              <button type="submit" className="primary" disabled={busy}>
                {strings.demoEntry}
              </button>
              {busy && <p role="status">{strings.loading}</p>}
            </form>
          ) : session?.setupRequired ? (
            <p>{strings.setup}</p>
          ) : (
            session && (
              <form
                onSubmit={(event) => {
                  event.preventDefault();
                  void login();
                }}
              >
                <label>
                  {strings.password}
                  <input
                    type="password"
                    autoComplete="current-password"
                    value={password}
                    disabled={busy}
                    onChange={(event) => setPassword(event.target.value)}
                  />
                </label>
                <button
                  type="submit"
                  className="primary"
                  disabled={busy || !password}
                >
                  {strings.login}
                </button>
              </form>
            )
          )}
          {errorView}
        </div>
      </main>
    );
  const selectedTask = selected
    ? (tree?.tasks.find((task) => task.id === selected.id) ?? selected)
    : null;
  const backVisit = panelHistory.at(-1);
  const backTask =
    tree?.tasks.find((task) => task.id === backVisit?.taskId) ?? null;
  const subtaskKey =
    tree && selectedTask ? `${tree.project.id}/${selectedTask.id}` : '';
  const subtaskDraft = quickDrafts[subtaskKey];
  const subtaskIds =
    tree &&
    selectedTask &&
    tree.tasks.some((task) => task.id === selectedTask.id)
      ? subtreeIds(tree.tasks, selectedTask.id)
      : new Set<string>();
  const subtaskParent = subtaskDraft?.context.parentId;
  const subtaskContext: AddContext = {
    parentId:
      subtaskParent && subtaskIds.has(subtaskParent)
        ? subtaskParent
        : (selectedTask?.id ?? null),
  };
  const subtaskAfter = tree?.tasks.find(
    (task) => task.id === subtaskDraft?.context.afterId,
  );
  if (subtaskAfter && subtaskAfter.parentId === subtaskContext.parentId)
    subtaskContext.afterId = subtaskAfter.id;
  function subtaskAction(value: TreeAction, task: Task): boolean | void {
    const parentId = value === 'child' ? task.id : task.parentId;
    if (
      visiblePanelTab(panelTab) === 'details' &&
      (value === 'child' || value === 'sibling') &&
      parentId &&
      subtaskIds.has(parentId)
    ) {
      if (!canNavigate()) return false;
      updateQuick(subtaskKey, (draft) => ({
        ...draft,
        context: {
          parentId,
          ...(value === 'sibling' ? { afterId: task.id } : {}),
        },
      }));
      const input = document.getElementById('quick-subtask');
      if (input) input.focus();
      else
        requestAnimationFrame(() =>
          document.getElementById('quick-subtask')?.focus(),
        );
    } else return action(value, task);
  }
  return (
    <div
      className="app-shell"
      onFocusCapture={(event) => {
        if (!(event.target as Element).closest('#panel-journal'))
          ++journalFocus.current;
        if (
          undoFocus.current &&
          (event.target as Element) !== undoFocus.current.trigger
        )
          undoFocus.current = null;
        const restore = restoreStartHandle.current;
        if (
          restore &&
          event.target instanceof Element &&
          !ownsStartFocus(event.target, restore.taskId)
        )
          cancelStartFocus();
      }}
    >
      <ProjectSidebar
        projects={projects}
        selectedId={tree?.project.id ?? null}
        onSelect={(id, openMenu = false) =>
          requestTaskNavigation(() => {
            initialVisit.current = null;
            setProjectMenuTarget(openMenu ? id : null);
            void loadProject(id);
          })
        }
        onCreate={createProject}
        onLogout={() => void logout()}
        controls={
          tree && (
            <ProjectControls
              key={tree.project.id}
              initialMenuOpen={projectMenuTarget === tree.project.id}
              project={tree.project}
              disabled={
                journalLocked ||
                busy ||
                loading ||
                !!pending ||
                conflict ||
                dirty
              }
              dirty={projectDirty}
              onSave={command}
              onDirty={setProjectPlanDirty}
              rename={rename}
              onRenameChange={setRename}
              onRename={() => void renameProject()}
              onOpen={canNavigate}
              onVisibility={setProjectControlsOpen}
              feedback={errorView}
            />
          )
        }
        busy={
          journalLocked ||
          busy ||
          !!pending ||
          conflict ||
          loading ||
          createUncertain
        }
      />
      <main className="workspace">
        {session.demoMode && (
          <p className="demo-notice">{strings.demoNotice}</p>
        )}
        <header
          className={`workspace-header${selectedTask ? ' panel-visible' : ''}`}
        >
          <div className="workspace-heading">
            <div className="project-title-line">
              <h1>{tree?.project.title ?? strings.app}</h1>
            </div>
            {tree && (
              <div className="workspace-actions">
                <button
                  type="button"
                  disabled={
                    journalLocked ||
                    !tree.canUndo ||
                    busy ||
                    loading ||
                    !!pending ||
                    conflict ||
                    dirty ||
                    projectDirty
                  }
                  aria-label={strings.undo}
                  title={strings.undo}
                  onClick={() => void undo()}
                >
                  <ControlIcon name="undo" />
                </button>
                {projectView === 'journal' && (
                  <label className="journal-header-search">
                    Поиск записей
                    <input
                      aria-label="Поиск записей"
                      maxLength={300}
                      value={journalQuery.q ?? ''}
                      onChange={(event) =>
                        setJournalQuery({
                          ...journalQuery,
                          q: event.target.value,
                        })
                      }
                    />
                  </label>
                )}
                {projectView === 'tasks' && (
                  <TaskFilters
                    key={tree.project.id}
                    filter={taskFilter}
                    tasks={tree.tasks}
                    onChange={(filter) => {
                      cancelStartFocus();
                      setTaskFilter(filter);
                    }}
                    disabled={loading}
                  />
                )}
              </div>
            )}
          </div>
          <ProjectViewTabs value={projectView} onChange={changeProjectView} />
        </header>
        <div className="workspace-content planning-workspace">
          {!selectedTask && !projectControlsOpen && errorView}
          {loading && <p role="status">{strings.loading}</p>}
          {!loading && !tree && !error && (
            <p className="empty-state">
              {projects.length ? strings.chooseProject : strings.noProjects}
            </p>
          )}
          {tree && (
            <>
              <div
                id="project-view-tasks"
                role="tabpanel"
                aria-labelledby="project-tab-tasks"
                hidden={projectView !== 'tasks'}
                className="task-view-container"
              >
                {!tree.tasks.length && (
                  <p className="empty-state">{strings.empty}</p>
                )}
                <TaskTimeline
                  key={`timeline-${tree.project.id}`}
                  tree={tree}
                  draft={{
                    task: draftTask(
                      tree,
                      context,
                      quickDrafts[tree.project.id]?.title ?? '',
                      quickDrafts[tree.project.id]?.plan ?? newTaskPlan(),
                    ),
                    context,
                    active:
                      quickEditing ||
                      !!quickDrafts[tree.project.id]?.title ||
                      !!quickDrafts[tree.project.id]?.plan.inputStart ||
                      !!quickDrafts[tree.project.id]?.plan.inputFinish,
                    input: (
                      <QuickAdd
                        tree={tree}
                        predecessorIds={
                          quickDrafts[tree.project.id]?.predecessorIds ?? []
                        }
                        onPredecessors={(predecessorIds) =>
                          updateQuick(tree.project.id, (draft) => ({
                            ...draft,
                            predecessorIds,
                          }))
                        }
                        onRawEdit={() => noteQuickRawEdit(tree.project.id)}
                        acknowledgement={
                          quickAcknowledgements[tree.project.id] ?? 0
                        }
                        key={tree.project.id}
                        inline
                        onEditing={setQuickEditing}
                        onCancel={() => {
                          setQuickEditing(false);
                          setContext({ parentId: null });
                          requestAnimationFrame(() => {
                            if (quickOrigin.current)
                              focusTaskRow(quickOrigin.current);
                          });
                        }}
                        parentPlan={parentPlan(tree, context.parentId)}
                        calendar={tree.project.calendarType}
                        timezone={tree.project.timezone}
                        plan={
                          quickDrafts[tree.project.id]?.plan ?? newTaskPlan()
                        }
                        onPlan={(plan) =>
                          updateQuick(tree.project.id, (draft) => ({
                            ...draft,
                            plan,
                          }))
                        }
                        tasks={tree.tasks}
                        context={context}
                        onContext={setContext}
                        onCreate={createTask}
                        busy={busy || loading}
                        submitBlockedReason={
                          dirty ? strings.saveTaskBeforeSubtask : null
                        }
                        blocked={
                          journalLocked || !!pending || conflict || projectDirty
                        }
                        title={quickDrafts[tree.project.id]?.title ?? ''}
                        onTitle={(title) =>
                          updateQuick(tree.project.id, (draft) => ({
                            ...draft,
                            title,
                          }))
                        }
                      />
                    ),
                  }}
                  show={showGantt}
                  viewControl={
                    <TaskViewControl
                      showGantt={showGantt}
                      onChange={(show) => {
                        cancelStartFocus();
                        setShowGantt(show);
                      }}
                    />
                  }
                  reveal={ganttReveal}
                  onViewChange={cancelStartFocus}
                  onStartHandleVisible={restoreVisibleStart}
                  disabled={
                    journalLocked ||
                    busy ||
                    loading ||
                    !!pending ||
                    conflict ||
                    dirty ||
                    projectDirty
                  }
                  onJournal={openTaskJournal}
                  onViewState={(value) => {
                    timelineView.current = value;
                    lastCapture.current();
                  }}
                  active={projectView === 'tasks'}
                  restoreRequest={restoreTimeline}
                  onRestoreApplied={(request) => {
                    setRestoreTimeline((pending) =>
                      pending === request ? undefined : pending,
                    );
                  }}
                  onPredecessors={openPredecessors}
                  onPlan={(task, kind, target) =>
                    void planTask(task, kind, target)
                  }
                  selectedId={selected?.id ?? null}
                  collapsed={collapsed}
                  filter={taskFilter}
                  onToggle={toggle}
                  onSelect={selectTask}
                  onAction={action}
                />
              </div>
              <div
                id="project-view-journal"
                role="tabpanel"
                aria-labelledby="project-tab-journal"
                hidden={projectView !== 'journal'}
                className="project-journal-container"
              >
                <ProjectJournal
                  visible={projectView === 'journal'}
                  disabled={busy || !!pending || conflict}
                  controller={journal}
                  projectId={tree.project.id}
                  today={projectToday}
                  query={journalQuery}
                  onQuery={setJournalQuery}
                  onOpenTask={openTaskJournal}
                  restorePosition={restoreFeed}
                  onPosition={(value) => {
                    feedPosition.current = value;
                    lastCapture.current();
                  }}
                />
              </div>
            </>
          )}
        </div>
      </main>
      {immediateHost && tree && immediateHost.projectId === tree.project.id && (
        <div className="immediate-predecessors">
          <PredecessorPicker
            tree={tree}
            successorId={immediateHost.taskId}
            selectedIds={incomingPredecessorIds(tree, immediateHost.taskId)}
            disabled={
              busy || loading || !!pending || conflict || dirty || projectDirty
            }
            {...(error ? { error: error.message } : {})}
            onAdd={(id) => immediateRelation(id, false)}
            onRemove={(id) => immediateRelation(id, true)}
            onClose={closePredecessors}
          />
        </div>
      )}
      {durationChoice && (
        <div
          role="dialog"
          aria-label="Длительность не совпадает"
          className="duration-choice"
          onKeyDown={(event) => {
            if (event.key === 'Escape') setDurationChoice(null);
          }}
        >
          <p>Новая дата окончания не совпадает с заданной длительностью.</p>
          <button onClick={() => finishDurationChoice(true)}>
            Синхронно изменить длительность
          </button>
          <button onClick={() => finishDurationChoice(false)}>
            Очистить длительность
          </button>
          <button autoFocus onClick={() => setDurationChoice(null)}>
            Отмена
          </button>
        </div>
      )}
      {selectedTask && tree && (
        <TaskPanel
          key={selectedTask.id}
          registerActions={registerPanelActions}
          task={selectedTask}
          removed={
            journal.unavailableTaskIds.has(selectedTask.id) ||
            !tree.tasks.some((task) => task.id === selectedTask.id)
          }
          tasks={tree.tasks}
          tree={tree}
          tab={panelTab}
          onTab={(tab) => {
            if (!journalLocked) {
              lastCapture.current();
              setPanelTab(tab);
            }
          }}
          onJournal={openTaskJournal}
          journalTitle={
            journal.taskFeed?.metadata?.tasks.find(
              (task) => task.id === selectedTask.id,
            )?.title
          }
          journalContent={
            <TaskJournal
              disabled={busy || !!pending || conflict}
              controller={journal}
              task={selectedTask}
              today={projectToday}
              onEditorReady={(editor) => {
                const request = journalFocusRequest.current;
                if (!request || request.taskId !== selectedTask.id) return;
                journalFocusRequest.current = null;
                requestAnimationFrame(() => {
                  if (
                    request.token === journalFocus.current &&
                    editor.isConnected &&
                    !editor.disabled &&
                    !editor.closest('[hidden]')
                  )
                    editor.focus();
                });
              }}
            />
          }
          onDependency={(value) =>
            canNavigate() ? command(value) : Promise.resolve(false)
          }
          onNeighbor={selectNeighbor}
          onShow={showOnGantt}
          backTask={backTask}
          onBack={() => {
            if (!backTask || !backVisit) return;
            requestTaskNavigation(() => {
              setSelected(backTask);
              setPanelTab(backVisit.tab);
              setPanelHistory((previous) => previous.slice(0, -1));
              const token = ++branchRestore.current;
              requestAnimationFrame(() => {
                if (
                  token !== branchRestore.current ||
                  (document.activeElement !== document.body &&
                    !document.activeElement?.closest('.panel-back'))
                )
                  return;
                const panel =
                  document.querySelector<HTMLElement>('.task-panel');
                const owner = panel ? panelScrollOwner(panel) : null;
                const subtree =
                  panel?.querySelector<HTMLElement>('.panel-subtasks');
                if (
                  backVisit.focusId &&
                  (!subtree || !focusTaskRow(backVisit.focusId, subtree))
                ) {
                  const fallback =
                    document.getElementById('quick-subtask') ??
                    document.getElementById('panel-subtasks-heading');
                  if (fallback) {
                    if (!fallback.hasAttribute('tabindex'))
                      fallback.tabIndex = -1;
                    fallback.focus({ preventScroll: true });
                  }
                }
                if (owner) {
                  owner.scrollTop = backVisit.scrollTop ?? 0;
                  owner.scrollLeft = backVisit.scrollLeft ?? 0;
                }
              });
            });
          }}
          collapsed={collapsed}
          onToggle={toggle}
          onSelect={selectSubtask}
          onAction={subtaskAction}
          onMove={(task, parentId) => void moveTask(task, parentId)}
          saveAcknowledgement={panelAcknowledgement}
          onSave={(changes) =>
            commandTree(
              { type: 'task.edit', taskId: selectedTask.id, changes },
              { panelTaskId: selectedTask.id },
            )
          }
          onDirty={setPanelDirty}
          onClose={closePanel}
          busy={busy || journal.writing}
          retry={panelRetry}
          conflict={conflict}
          locked={journalLocked || !!pending || loading || projectDirty}
          feedback={projectControlsOpen ? null : errorView}
          subtaskDraftActive={!!subtaskDraft && hasQuickDraft(subtaskDraft)}
          subtaskInput={
            <QuickAdd
              tree={tree}
              predecessorIds={subtaskDraft?.predecessorIds ?? []}
              onPredecessors={(predecessorIds) =>
                updateQuick(subtaskKey, (draft) => ({
                  ...draft,
                  context: subtaskContext,
                  predecessorIds,
                }))
              }
              onRawEdit={() => noteQuickRawEdit(subtaskKey)}
              acknowledgement={quickAcknowledgements[subtaskKey] ?? 0}
              key={subtaskKey}
              calendar={tree.project.calendarType}
              timezone={tree.project.timezone}
              plan={subtaskDraft?.plan ?? newTaskPlan()}
              onPlan={(plan) =>
                updateQuick(subtaskKey, (draft) => ({
                  ...draft,
                  context: subtaskContext,
                  plan,
                }))
              }
              tasks={tree.tasks}
              parentPlan={parentPlan(tree, subtaskContext.parentId)}
              rootId={selectedTask.id}
              inputId="quick-subtask"
              context={subtaskContext}
              onContext={(context) =>
                updateQuick(subtaskKey, (draft) => ({ ...draft, context }))
              }
              title={subtaskDraft?.title ?? ''}
              onTitle={(title) =>
                updateQuick(subtaskKey, (draft) => ({
                  ...draft,
                  title,
                  context: subtaskContext,
                }))
              }
              onCreate={(title, context, plan, predecessorIds) =>
                createTask(title, context, plan, predecessorIds, subtaskKey)
              }
              busy={busy || loading}
              submitBlockedReason={dirty ? strings.saveTaskBeforeSubtask : null}
              blocked={
                journalLocked ||
                !!pending ||
                conflict ||
                projectDirty ||
                !subtaskIds.size
              }
            />
          }
        />
      )}
      {leaveOpen && (
        <TaskLeaveDialog
          blocked={leaveSaving || !!pending || busy || journalLocked}
          saving={leaveSaving}
          onSave={() => void saveAndNavigate()}
          onDiscard={discardAndNavigate}
          onContinue={clearTaskNavigation}
        />
      )}
    </div>
  );
}
