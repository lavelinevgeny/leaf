import { useCallback, useEffect, useRef, useState } from 'react';
import type {
  AuthSession,
  Command,
  CommandEnvelope,
  Project,
  ProjectTree,
  RenameProject,
  Task,
} from '../shared/contracts.js';
import { api, ApiError } from './api.js';
import { ProjectSidebar } from './ProjectSidebar.js';
import { QuickAdd, type AddContext } from './QuickAdd.js';
import { TaskPanel } from './TaskPanel.js';
import { focusTaskRow, TaskTree, type TreeAction } from './TaskTree.js';
import { orderedChildren } from './tree-view.js';
import { strings } from './strings.js';
import './styles/app.css';

type Mutation =
  | {
      kind: 'command';
      projectId: string;
      envelope: CommandEnvelope;
      knownIds: string[];
    }
  | { kind: 'rename'; projectId: string; envelope: RenameProject };
interface QuickDraft {
  title: string;
  context: AddContext;
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
  const [selected, setSelected] = useState<Task | null>(null);
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const [quickDrafts, setQuickDrafts] = useState<Record<string, QuickDraft>>(
    {},
  );
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<ApiError | null>(null);
  const [conflict, setConflict] = useState(false);
  const [notice, setNotice] = useState('');
  const [dirty, setDirty] = useState(false);
  const [pending, setPending] = useState<Mutation | null>(null);
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
    (draft) => draft.title !== '',
  );
  const uncertain = !!pending && !!error?.uncertain;
  const panelRetry =
    uncertain &&
    pending?.kind === 'command' &&
    pending.envelope.command.type === 'task.update' &&
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
        previous[projectId] ?? { title: '', context: { parentId: null } },
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
    setSelected((previous) =>
      previous
        ? (next.tasks.find((task) => task.id === previous.id) ??
          (dirtyRef.current ? previous : null))
        : null,
    );
    return true;
  }
  function canNavigate(allowRename = false) {
    if (
      dirtyRef.current ||
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
    const sequence = ++loadSequence.current;
    currentProject.current = id;
    setLoading(true);
    setError(null);
    setNotice('');
    if (!preserveDraft) {
      setSelected(null);
      setPanelDirty(false);
      setTree(null);
      treeRef.current = null;
      setCollapsed(new Set());
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
  }, [dirty, hasQuickDrafts, pending, busy, rename, tree]);
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
        updateQuick(job.projectId, (draft) => ({
          title: draft.title.trim() === added.title.trim() ? '' : draft.title,
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
  async function command(value: Command) {
    if (conflict || loading || lock.current || !treeRef.current) return false;
    if (pendingRef.current) return execute(pendingRef.current);
    return execute({
      kind: 'command',
      projectId: treeRef.current.project.id,
      knownIds: treeRef.current.tasks.map((task) => task.id),
      envelope: {
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
      parent &&
      !current?.tasks.some((task) => task.parentId === parent.id) &&
      (parent.inputStart || parent.inputFinish)
    )
      return window.confirm(strings.preserveConfirm) ? true : null;
    return false;
  }
  async function createTask(title: string, addContext: AddContext) {
    if (!canNavigate()) return false;
    const preserved = preserveWork(addContext.parentId);
    if (preserved === null) return false;
    return command({
      type: 'task.create',
      title,
      ...addContext,
      ...(preserved ? { preserveWork: true } : {}),
    });
  }
  function selectTask(task: Task) {
    if (!canNavigate()) return;
    setSelected(task);
    setContext({ parentId: task.parentId, afterId: task.id });
  }
  function closePanel() {
    if (!canNavigate()) return;
    const id = selected?.id;
    setSelected(null);
    if (!id || !focusTaskRow(id))
      document.getElementById('quick-task')?.focus();
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
      requestAnimationFrame(() => focusTaskRow(task.id));
    }
  }
  function action(value: TreeAction, task: Task) {
    if (!canNavigate()) return;
    if (value === 'sibling' || value === 'child') {
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
    if (canNavigate() && treeRef.current?.canUndo)
      await command({ type: 'undo' });
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
                      { ...draft, title: '' },
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
        busy={busy || !!pending || conflict || loading || createUncertain}
      />
      <main className="workspace">
        <header className="workspace-header">
          <div className="project-title-line">
            <h1>{tree?.project.title ?? strings.app}</h1>
            {tree && (
              <button
                type="button"
                className="quiet"
                aria-label={strings.renameProject}
                disabled={busy || !!pending || conflict}
                onClick={() => {
                  if (canNavigate()) setRename(tree.project.title);
                }}
              >
                ✎
              </button>
            )}
          </div>
          <span className="view-label">{strings.tasks}</span>
        </header>
        {rename !== null && (
          <form
            className="rename-project"
            onSubmit={(event) => {
              event.preventDefault();
              void renameProject();
            }}
          >
            <label>
              {strings.projectTitle}
              <input
                value={rename}
                maxLength={120}
                disabled={busy || !!pending}
                onChange={(event) => setRename(event.target.value)}
              />
            </label>
            <button disabled={busy || !!pending || conflict || !rename.trim()}>
              {strings.renameProject}
            </button>
            <button
              type="button"
              disabled={busy || !!pending}
              onClick={() => {
                setRename(null);
                setNotice('');
              }}
            >
              {strings.cancel}
            </button>
          </form>
        )}
        <div className="workspace-content">
          {!selectedTask && errorView}
          {loading && <p role="status">{strings.loading}</p>}
          {!loading && !tree && !error && (
            <p className="empty-state">
              {projects.length ? strings.chooseProject : strings.noProjects}
            </p>
          )}
          {tree && (
            <>
              <div className="tree-toolbar">
                <span>{strings.tasks}</span>
                <button
                  type="button"
                  disabled={
                    !tree.canUndo ||
                    busy ||
                    loading ||
                    !!pending ||
                    conflict ||
                    dirty
                  }
                  onClick={() => void undo()}
                >
                  {strings.undo}
                </button>
              </div>
              {!tree.tasks.length && (
                <p className="empty-state">{strings.empty}</p>
              )}
              <TaskTree
                tasks={tree.tasks}
                selectedId={selected?.id ?? null}
                collapsed={collapsed}
                onToggle={toggle}
                onSelect={selectTask}
                onAction={action}
              />
              <QuickAdd
                tasks={tree.tasks}
                context={context}
                onContext={setContext}
                onCreate={createTask}
                busy={busy || loading}
                blocked={!!pending || conflict || dirty}
                title={quickDrafts[tree.project.id]?.title ?? ''}
                onTitle={(title) =>
                  updateQuick(tree.project.id, (draft) => ({ ...draft, title }))
                }
              />
            </>
          )}
        </div>
      </main>
      {selectedTask && tree && (
        <TaskPanel
          key={selectedTask.id}
          task={selectedTask}
          removed={!tree.tasks.some((task) => task.id === selectedTask.id)}
          tasks={tree.tasks}
          collapsed={collapsed}
          onToggle={toggle}
          onSelect={selectTask}
          onAction={action}
          onMove={(task, parentId) => void moveTask(task, parentId)}
          onSave={(changes) =>
            command({
              type: 'task.update',
              taskId: selectedTask.id,
              changes: tree.tasks.some(
                (task) => task.parentId === selectedTask.id,
              )
                ? {
                    title: changes.title,
                    description: changes.description,
                    status: changes.status,
                  }
                : changes,
            })
          }
          onDirty={setPanelDirty}
          onClose={closePanel}
          busy={busy}
          retry={panelRetry}
          conflict={conflict}
          locked={!!pending || loading}
          feedback={errorView}
        />
      )}
    </div>
  );
}
