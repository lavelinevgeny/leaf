import { useCallback, useEffect, useRef, useState } from 'react';
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
import { TaskPanel, type PanelTab } from './TaskPanel.js';
import { focusTaskRow, type TreeAction } from './TaskTree.js';
import { orderedChildren, subtreeIds } from './tree-view.js';
import { strings } from './strings.js';
import { ProjectControls } from './ProjectControls.js';
import { TaskViewControl } from './TaskViewControl.js';
import { TaskTimeline, type GanttReveal } from './TaskTimeline.js';
import { TaskFilters } from './TaskFilters.js';
import { emptyTaskFilter, type TaskFilter } from './task-filter.js';
import { workingDaysInclusive } from '../domain/calendar.js';
import { gesturePatch, newTaskPlan } from './planning-view.js';
import { draftTask, parentPlan } from './quick-add-view.js';
import './styles/app.css';
import './styles/planning.css';

type Mutation =
  | {
      kind: 'command';
      projectId: string;
      envelope: CommandEnvelope;
      knownIds: string[];
      quickKey?: string;
    }
  | { kind: 'rename'; projectId: string; envelope: RenameProject };
interface QuickDraft {
  title: string;
  plan: SourceFields;
  context: AddContext;
}
interface PanelVisit {
  taskId: string;
  tab: PanelTab;
  focusId?: string;
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
  const [session, setSession] = useState<AuthSession | null>(null);
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
  const [quickEditing, setQuickEditing] = useState(false);
  const quickOrigin = useRef<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<ApiError | null>(null);
  const [conflict, setConflict] = useState(false);
  const [notice, setNotice] = useState('');
  const [dirty, setDirty] = useState(false);
  const [projectDirty, setProjectDirty] = useState(false);
  const [showGantt, setShowGantt] = useState(true);
  const [ganttReveal, setGanttReveal] = useState<GanttReveal | null>(null);
  const projectDirtyRef = useRef(false);
  const setProjectPlanDirty = useCallback((value: boolean) => {
    projectDirtyRef.current = value;
    setProjectDirty(value);
  }, []);
  const [pending, setPending] = useState<Mutation | null>(null);
  const [projectControlsOpen, setProjectControlsOpen] = useState(false);
  const [rename, setRename] = useState<string | null>(null);
  const [password, setPassword] = useState('');
  const [createUncertain, setCreateUncertain] = useState(false);
  const treeRef = useRef(tree);
  const pendingRef = useRef<Mutation | null>(null);
  const lock = useRef(false);
  const loadSequence = useRef(0);
  const dirtyRef = useRef(false);
  const currentProject = useRef<string | null>(null);
  const context = (tree && quickDrafts[tree.project.id]?.context) || {
    parentId: null,
  };
  const hasQuickDrafts = Object.values(quickDrafts).some(
    (draft) =>
      draft.title !== '' ||
      draft.plan.inputStart !== null ||
      draft.plan.inputFinish !== null ||
      draft.plan.durationDays !== 1,
  );
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
  function updateQuick(
    projectId: string,
    update: (draft: QuickDraft) => QuickDraft,
  ) {
    setQuickDrafts((previous) => ({
      ...previous,
      [projectId]: update(
        previous[projectId] ?? {
          title: '',
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
        quickDrafts[`${next.project.id}/${previous.id}`]?.title
      )
        return previous;
      requestAnimationFrame(() =>
        document.getElementById('quick-task')?.focus(),
      );
      return null;
    });
    return true;
  }
  function canNavigate(allowRename = false) {
    if (
      dirtyRef.current ||
      projectDirtyRef.current ||
      (!allowRename &&
        rename !== null &&
        rename !== treeRef.current?.project.title)
    ) {
      setNotice(strings.unsaved);
      return false;
    }
    if (lock.current || pendingRef.current || conflict || loading) return false;
    setNotice('');
    return true;
  }
  async function loadProject(id: string, preserveDraft = false) {
    setDurationChoice(null);
    const sequence = ++loadSequence.current;
    currentProject.current = id;
    setLoading(true);
    setError(null);
    setNotice('');
    if (!preserveDraft) {
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
      if (items[0])
        await loadProject(
          currentProject.current &&
            items.some((item) => item.id === currentProject.current)
            ? currentProject.current
            : items[0].id,
        );
    } catch (failure) {
      setError(asError(failure));
    } finally {
      setLoading(false);
    }
  }
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
  }, [dirty, projectDirty, hasQuickDrafts, pending, busy, rename, tree]);
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
  async function execute(job: Mutation): Promise<boolean> {
    if (lock.current) return false;
    lock.current = true;
    setBusy(true);
    setError(null);
    setNotice('');
    pendingRef.current = job;
    setPending(job);
    try {
      const next =
        job.kind === 'command'
          ? await api.command(job.projectId, job.envelope)
          : await api.rename(job.projectId, job.envelope);
      apply(next);
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
        updateQuick(job.quickKey ?? job.projectId, (draft) => ({
          title: draft.title.trim() === added.title.trim() ? '' : draft.title,
          plan:
            draft.title.trim() === added.title.trim()
              ? newTaskPlan()
              : draft.plan,
          context: created
            ? { parentId: created.parentId, afterId: created.id }
            : draft.context,
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
      return true;
    } catch (failure) {
      const failed = asError(failure);
      setError(failed);
      if (failed.status === 409) setConflict(true);
      if (!failed.uncertain) {
        pendingRef.current = null;
        setPending(null);
      }
      return false;
    } finally {
      lock.current = false;
      setBusy(false);
    }
  }
  async function command(value: Command, quickKey?: string) {
    if (conflict || loading || lock.current || !treeRef.current) return false;
    if (pendingRef.current) return execute(pendingRef.current);
    return execute({
      kind: 'command',
      projectId: treeRef.current.project.id,
      knownIds: treeRef.current.tasks.map((task) => task.id),
      ...(quickKey ? { quickKey } : {}),
      envelope: {
        contractVersion: 2,
        expectedRevision: treeRef.current.project.revision,
        operationId: crypto.randomUUID(),
        command: value,
      },
    });
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
    quickKey?: string,
  ) {
    if (!canNavigate()) return false;
    const preserved = preserveWork(addContext.parentId);
    if (preserved === null) return false;
    return command(
      {
        type: 'task.create',
        ...plan,
        title,
        ...addContext,
        ...(preserved ? { preserveWork: true } : {}),
      },
      quickKey,
    );
  }
  function selectTask(task: Task) {
    if (!canNavigate()) return;
    setSelected(task);
    setPanelTab('details');
    setPanelHistory([]);
    panelOrigin.current = task.id;
    setContext({ parentId: task.parentId, afterId: task.id });
  }
  function closePanel() {
    if (!canNavigate()) return;
    const id = selected?.id;
    setSelected(null);
    setPanelHistory([]);
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
  }
  function selectSubtask(task: Task) {
    if (!canNavigate()) return;
    if (selected)
      setPanelHistory((previous) => [
        ...previous,
        { taskId: selected.id, tab: panelTab, focusId: task.id },
      ]);
    setSelected(task);
    setPanelTab('details');
  }
  function selectNeighbor(task: Task) {
    if (!canNavigate()) return;
    if (selected)
      setPanelHistory((previous) => [
        ...previous,
        { taskId: selected.id, tab: panelTab },
      ]);
    setSelected(task);
    setPanelTab('dependencies');
  }
  function showOnGantt(task: Task) {
    if (!canNavigate() || !treeRef.current) return;
    setTaskFilter(emptyTaskFilter);
    const byId = new Map(treeRef.current.tasks.map((item) => [item.id, item]));
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
  function action(value: TreeAction, task: Task) {
    if (!canNavigate()) return;
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
      if (window.confirm(strings.deleteConfirm))
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
  async function undo() {
    if (!canNavigate() || !treeRef.current?.canUndo) return;
    const trigger = document.activeElement;
    await command({ type: 'undo' });
    if (trigger instanceof HTMLButtonElement)
      requestAnimationFrame(() => {
        if (!trigger.isConnected || document.activeElement !== document.body)
          return;
        if (!trigger.disabled) trigger.focus();
        else {
          const row = document.querySelector<HTMLElement>(
            '[role="tree"][aria-label="Задачи"] [role="treeitem"][tabindex="0"]',
          );
          if (row) row.focus();
          else document.getElementById('quick-task')?.focus();
        }
      });
  }
  async function planTask(task: Task, kind: 'move' | 'resize', target: string) {
    if (!canNavigate() || !treeRef.current) return;
    try {
      if (
        treeRef.current.schedule.summaries[task.id] ||
        !treeRef.current.schedule.tasks[task.id]?.startDate
      )
        return;
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
    if (lock.current || !password) return;
    lock.current = true;
    setBusy(true);
    setError(null);
    try {
      const auth = await api.login(password);
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
      setSession({ authenticated: false, setupRequired: false });
      setProjects([]);
      setTree(null);
      treeRef.current = null;
      currentProject.current = null;
      setSelected(null);
      setQuickDrafts({});
    } catch (failure) {
      setError(asError(failure));
    } finally {
      lock.current = false;
      setBusy(false);
    }
  }
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
                      { ...draft, title: '', plan: newTaskPlan() },
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
              onClick={() => void loadProject(tree.project.id, true)}
            >
              {strings.reload}
            </button>
          )}
          {uncertain && !panelRetry && (
            <button
              type="button"
              disabled={busy}
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
          {loading ? (
            <p role="status">{strings.loading}</p>
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
  function subtaskAction(value: TreeAction, task: Task) {
    const parentId = value === 'child' ? task.id : task.parentId;
    if (
      panelTab === 'subtasks' &&
      (value === 'child' || value === 'sibling') &&
      parentId &&
      subtaskIds.has(parentId)
    ) {
      if (!canNavigate()) return;
      updateQuick(subtaskKey, (draft) => ({
        ...draft,
        context: {
          parentId,
          ...(value === 'sibling' ? { afterId: task.id } : {}),
        },
      }));
      document.getElementById('quick-subtask')?.focus();
    } else action(value, task);
  }
  return (
    <div className="app-shell">
      <ProjectSidebar
        projects={projects}
        selectedId={tree?.project.id ?? null}
        onSelect={(id) => {
          if (canNavigate()) void loadProject(id);
        }}
        onCreate={createProject}
        onLogout={() => void logout()}
        controls={
          tree && (
            <ProjectControls
              key={tree.project.id}
              project={tree.project}
              disabled={busy || loading || !!pending || conflict || dirty}
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
        busy={busy || !!pending || conflict || loading || createUncertain}
      />
      <main className="workspace">
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
                  <span aria-hidden="true">↶</span>
                </button>
                <TaskFilters
                  filter={taskFilter}
                  onChange={setTaskFilter}
                  disabled={loading}
                />
              </div>
            )}
          </div>
          <span className="view-label">{strings.tasks}</span>
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
                      plan={quickDrafts[tree.project.id]?.plan ?? newTaskPlan()}
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
                      blocked={!!pending || conflict || dirty || projectDirty}
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
                    onChange={setShowGantt}
                  />
                }
                reveal={ganttReveal}
                disabled={
                  busy ||
                  loading ||
                  !!pending ||
                  conflict ||
                  dirty ||
                  projectDirty
                }
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
            </>
          )}
        </div>
      </main>
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
          task={selectedTask}
          removed={!tree.tasks.some((task) => task.id === selectedTask.id)}
          tasks={tree.tasks}
          tree={tree}
          tab={panelTab}
          onTab={setPanelTab}
          onDependency={command}
          onNeighbor={selectNeighbor}
          onShow={showOnGantt}
          backTask={backTask}
          onBack={() => {
            if (backTask && backVisit && canNavigate()) {
              setSelected(backTask);
              setPanelTab(backVisit.tab);
              setPanelHistory((previous) => previous.slice(0, -1));
              if (backVisit.focusId)
                requestAnimationFrame(() => {
                  const subtree = document.getElementById('panel-subtasks');
                  if (!subtree || !focusTaskRow(backVisit.focusId!, subtree))
                    document.getElementById('quick-subtask')?.focus();
                });
            }
          }}
          collapsed={collapsed}
          onToggle={toggle}
          onSelect={selectSubtask}
          onAction={subtaskAction}
          onMove={(task, parentId) => void moveTask(task, parentId)}
          onSave={(changes) =>
            command({ type: 'task.edit', taskId: selectedTask.id, changes })
          }
          onDirty={setPanelDirty}
          onClose={closePanel}
          busy={busy}
          retry={panelRetry}
          conflict={conflict}
          locked={!!pending || loading || projectDirty}
          feedback={projectControlsOpen ? null : errorView}
          subtaskInput={
            <QuickAdd
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
              onCreate={(title, context, plan) =>
                createTask(title, context, plan, subtaskKey)
              }
              busy={busy || loading}
              blocked={
                !!pending ||
                conflict ||
                dirty ||
                projectDirty ||
                !subtaskIds.size
              }
            />
          }
        />
      )}
    </div>
  );
}
