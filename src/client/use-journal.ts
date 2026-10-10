import { useEffect, useRef, useState } from 'react';
import type { ProjectTree } from '../shared/contracts.js';
import type {
  JournalProjectQuery,
  JournalPage,
  JournalEntry,
  JournalEntryRead,
} from '../shared/journal-contracts.js';
import type {
  JournalController,
  JournalDraft,
  JournalDraftKey,
  JournalFeedState,
  JournalMetadata,
  JournalPending,
  JournalDeleteConfirmation,
} from './journal-state.js';
export type { JournalController, JournalDraftKey } from './journal-state.js';
export type JournalActiveContext = {
  status: 'active'; // App session authenticated, matching project tree loaded
  projectId: string;
  taskId: string | null;
  today: string;
  projectQuery: JournalProjectQuery;
  planningTree: ProjectTree;
  planningDirty: boolean;
  planningUncertain: boolean;
  planningBusy: boolean;
  applyCleanTree: (tree: ProjectTree) => boolean;
  onAuthRequired: () => void;
};
export type JournalInactiveContext = {
  status: 'inactive';
  reason:
    | 'auth-loading'
    | 'signed-out'
    | 'no-projects'
    | 'project-loading'
    | 'project-unavailable';
  onAuthRequired: () => void;
};
export type JournalContext = JournalActiveContext | JournalInactiveContext;
// export function useJournal(context: JournalContext): JournalController;
import { api, ApiError } from './api.js';
import {
  journalCreateSchema,
  journalUpdateSchema,
  journalDeleteSchema,
} from '../shared/journal-contracts.js';
import {
  createDraftKey,
  openEditDraft,
  mergeJournalPages,
  sameJournalDraft,
} from './journal-state.js';
const safeError = 'Не удалось загрузить журнал. Повторите попытку.';
const staleError = 'Данные изменились; обновите журнал';
export function useJournal(context: JournalContext): JournalController {
  const current = useRef(context);
  current.current = context;
  const [, render] = useState(0);
  const publish = () => render((n) => n + 1);
  const state = useRef({
    drafts: new Map<JournalDraftKey, JournalDraft>(),
    feeds: {
      project: null as JournalFeedState | null,
      task: null as JournalFeedState | null,
    },
    cache: new Map<string, JournalFeedState>(),
    metadata: new Map<string, JournalMetadata>(),
    known: new Map<string, { project: number; journal: number }>(),
    pending: null as JournalPending | null,
    writing: false,
    uncertain: false,
    confirmation: null as JournalDeleteConfirmation | null,
    error: null as string | null,
    notice: null as string | null,
    conflict: null as JournalDraftKey | null,
    conflictCurrent: null as JournalEntryRead | null,
    removed: false,
    unavailable: new Set<string>(),
  });
  const generation = useRef(0),
    privateGeneration = useRef(0),
    conflictReadSequence = useRef(0),
    requests = useRef({ project: 0, task: 0 });
  const identity =
    context.status === 'active'
      ? `${context.projectId}/${context.taskId ?? ''}/${JSON.stringify(context.projectQuery)}`
      : 'inactive';
  const identityRef = useRef(identity);
  if (identityRef.current !== identity) {
    identityRef.current = identity;
    generation.current++;
    requests.current.project++;
    requests.current.task++;
  }
  const active = () =>
    current.current.status === 'active' ? current.current : null;
  function clearPrivateState() {
    privateGeneration.current++;
    generation.current++;
    requests.current.project++;
    requests.current.task++;
    state.current = {
      drafts: new Map(),
      feeds: { project: null, task: null },
      cache: new Map(),
      metadata: new Map(),
      known: new Map(),
      pending: null,
      writing: false,
      uncertain: false,
      confirmation: null,
      error: null,
      notice: null,
      conflict: null,
      conflictCurrent: null,
      removed: false,
      unavailable: new Set(),
    };
    publish();
  }
  function auth(error: unknown, privacy: number) {
    if (
      privacy === privateGeneration.current &&
      error instanceof ApiError &&
      error.status === 401
    ) {
      clearPrivateState();
      current.current.onAuthRequired();
      return true;
    }
    return false;
  }
  async function read(scope: 'project' | 'task', more = false): Promise<void> {
    const ctx = active();
    if (!ctx || (scope === 'task' && !ctx.taskId)) return;
    const epoch = generation.current,
      privacy = privateGeneration.current,
      token = ++requests.current[scope];
    const valid = () =>
      epoch === generation.current &&
      token === requests.current[scope] &&
      active()?.projectId === ctx.projectId;
    const old = state.current.feeds[scope];
    const query = scope === 'project' ? ctx.projectQuery : {};
    const taskId = scope === 'task' ? ctx.taskId : null;
    const same =
      old?.scope.projectId === ctx.projectId &&
      old.scope.taskId === taskId &&
      JSON.stringify(old.scope.query) === JSON.stringify(query);
    const cacheKey = JSON.stringify([ctx.projectId, taskId, query]);
    const previous = same ? old : (state.current.cache.get(cacheKey) ?? null);
    if (more && !previous?.page?.nextCursor) return;
    let next: JournalFeedState = {
      scope: { projectId: ctx.projectId, taskId, query },
      page: previous?.page ?? null,
      metadata: previous?.metadata ?? null,
      pendingPage: null,
      phase: more ? 'loading-more' : 'loading',
      error: null,
    };
    state.current.feeds[scope] = next;
    publish();
    try {
      let page: JournalPage | null = null;
      let reconciledTree: ProjectTree | null = null;
      const belowKnown = (candidate: JournalPage) => {
        const floor = state.current.known.get(ctx.projectId);
        return (
          !!floor &&
          (candidate.projectRevision < floor.project ||
            candidate.journalRevision < floor.journal)
        );
      };
      for (let attempt = 0; attempt < 3; attempt++) {
        if (!page) {
          const cursor =
            more && previous?.page?.nextCursor
              ? { cursor: previous.page.nextCursor }
              : {};
          page = taskId
            ? await api.journalTask(ctx.projectId, taskId, cursor)
            : await api.journalProject(ctx.projectId, { ...query, ...cursor });
          if (!valid()) return;
        }
        if (page.projectId !== ctx.projectId || page.taskId !== taskId)
          throw Error('INTEGRITY');
        next = { ...next, pendingPage: page };
        state.current.feeds[scope] = next;
        publish();
        const known = state.current.known.get(ctx.projectId) ?? {
          project: 0,
          journal: 0,
        };
        if (
          page.projectRevision < known.project ||
          page.journalRevision < known.journal
        ) {
          page = null;
          continue;
        }
        state.current.known.set(ctx.projectId, {
          project: Math.max(known.project, page.projectRevision),
          journal: Math.max(known.journal, page.journalRevision),
        });
        const now = active();
        if (!now) return;
        let metadata = reconciledTree
          ? {
              projectId: ctx.projectId,
              revision: reconciledTree.project.revision,
              tasks: reconciledTree.tasks,
            }
          : state.current.metadata.get(ctx.projectId);
        if (now.planningTree.project.revision === page.projectRevision)
          metadata = {
            projectId: ctx.projectId,
            revision: page.projectRevision,
            tasks: now.planningTree.tasks,
          };
        if (!metadata || metadata.revision !== page.projectRevision) {
          const tree = await api.tree(ctx.projectId);
          if (!valid()) return;
          if (tree.project.id !== ctx.projectId) throw Error('INTEGRITY');
          metadata = {
            projectId: ctx.projectId,
            revision: tree.project.revision,
            tasks: tree.tasks,
          };
          const latest = state.current.known.get(ctx.projectId)!;
          state.current.known.set(ctx.projectId, {
            ...latest,
            project: Math.max(latest.project, metadata.revision),
          });
          reconciledTree = tree;
          // Another scope or a mutation may raise either floor while tree awaits.
          if (belowKnown(page)) {
            page = null;
            continue;
          }
          if (metadata.revision < page.projectRevision) continue;
        }
        if (belowKnown(page)) {
          page = null;
          continue;
        }
        if (metadata.revision > page.projectRevision) {
          if (more) break;
          page = null;
          continue;
        }
        if (
          page.entries.some(
            (entry) =>
              entry.projectId !== ctx.projectId ||
              !metadata.tasks.some((task) => task.id === entry.taskId) ||
              (taskId && entry.taskId !== taskId),
          )
        )
          throw Error('INTEGRITY');
        const clean = active();
        if (
          reconciledTree &&
          reconciledTree.project.revision === page.projectRevision &&
          clean &&
          !clean.planningDirty &&
          !clean.planningUncertain &&
          !clean.planningBusy
        )
          clean.applyCleanTree(reconciledTree);
        if (!valid()) return;
        if (belowKnown(page)) {
          page = null;
          continue;
        }
        state.current.metadata.set(ctx.projectId, metadata);
        state.current.unavailable = new Set([
          ...ctx.planningTree.tasks
            .filter(
              (task) =>
                !metadata.tasks.some((current) => current.id === task.id),
            )
            .map((task) => task.id),
          ...[...state.current.drafts.values()]
            .filter(
              (draft) =>
                draft.projectId === ctx.projectId &&
                draft.taskId &&
                !metadata.tasks.some((task) => task.id === draft.taskId),
            )
            .map((draft) => draft.taskId!),
        ]);
        if (more && previous?.page)
          page = mergeJournalPages(previous.page, page);
        next = {
          ...next,
          page,
          metadata,
          pendingPage: null,
          phase: page.entries.length
            ? 'ready'
            : scope === 'project' && (query.q || query.from || query.to)
              ? 'no-match'
              : 'empty',
          error: null,
        };
        state.current.feeds[scope] = next;
        state.current.cache.set(cacheKey, next);
        const other = scope === 'project' ? 'task' : 'project';
        const sibling = state.current.feeds[other];
        if (
          sibling?.page?.projectId === ctx.projectId &&
          (sibling.page.projectRevision < page.projectRevision ||
            sibling.page.journalRevision < page.journalRevision) &&
          !['loading', 'loading-more'].includes(sibling.phase)
        ) {
          state.current.feeds[other] = {
            ...sibling,
            phase: 'stale',
            error: staleError,
          };
          void read(other);
        }
        publish();
        return;
      }
      state.current.feeds[scope] = {
        ...next,
        phase: 'stale',
        error: staleError,
      };
      publish();
    } catch (error) {
      if (auth(error, privacy) || !valid()) return;
      if (error instanceof ApiError && error.status === 404 && taskId)
        state.current.unavailable.add(taskId);
      const stale =
        (error instanceof ApiError && error.code === 'JOURNAL_CURSOR_STALE') ||
        (error instanceof Error && error.message === 'JOURNAL_CURSOR_STALE');
      state.current.feeds[scope] = {
        ...next,
        phase: stale
          ? 'stale'
          : more
            ? 'more-error'
            : next.pendingPage
              ? 'metadata-error'
              : 'error',
        error: stale ? staleError : safeError,
      };
      publish();
    }
  }
  async function refresh() {
    if (!active()) return;
    await Promise.all([read('project'), read('task')]);
  }
  useEffect(() => {
    if (context.status === 'active') void refresh();
  }, [identity]);
  useEffect(() => {
    const refreshVisible = () => {
      if (document.visibilityState !== 'hidden') void refresh();
    };
    window.addEventListener('focus', refreshVisible);
    document.addEventListener('visibilitychange', refreshVisible);
    return () => {
      generation.current++;
      privateGeneration.current++;
      window.removeEventListener('focus', refreshVisible);
      document.removeEventListener('visibilitychange', refreshVisible);
    };
  }, []);
  const today = context.status === 'active' ? context.today : null;
  useEffect(() => {
    const ctx = active();
    if (!ctx) return;
    let changed = false;
    for (const [key, draft] of state.current.drafts) {
      if (
        draft.projectId === ctx.projectId &&
        !draft.entryId &&
        !draft.dateTouched &&
        !draft.dirty &&
        draft.workDate !== ctx.today
      ) {
        state.current.drafts.set(key, { ...draft, workDate: ctx.today });
        changed = true;
      }
    }
    if (changed) publish();
  }, [today, identity]);
  function editable() {
    return !!active() && !state.current.pending && !state.current.writing;
  }
  function openCreate(projectId: string, taskId: string | null, today: string) {
    const ctx = active();
    if (!ctx || ctx.projectId !== projectId || !editable()) return null;
    const key = createDraftKey(projectId, taskId);
    if (!state.current.drafts.has(key)) {
      state.current.drafts.set(key, {
        key,
        projectId,
        taskId,
        entryId: null,
        body: '',
        workDate: today,
        dateTouched: false,
        dirty: false,
        baselineEntry: null,
        baselineJournalRevision: 0,
      });
      publish();
    }
    return key;
  }
  function openEdit(entry: JournalEntry, revision: number) {
    const ctx = active();
    if (!ctx || ctx.projectId !== entry.projectId || !editable()) return null;
    const key: JournalDraftKey = `project:${entry.projectId}:entry:${entry.id}:edit`;
    state.current.drafts.set(
      key,
      openEditDraft(state.current.drafts.get(key), entry, revision),
    );
    publish();
    return key;
  }
  function changeDraft(
    key: JournalDraftKey,
    fields: Partial<Pick<JournalDraft, 'body' | 'workDate' | 'taskId'>>,
  ) {
    if (!editable()) return;
    const old = state.current.drafts.get(key);
    if (!old || old.projectId !== active()?.projectId) return;
    const { taskId, ...rest } = fields;
    state.current.drafts.set(key, {
      ...old,
      ...rest,
      ...(!old.entryId && taskId !== undefined ? { taskId } : {}),
      dateTouched: old.dateTouched || fields.workDate !== undefined,
      dirty: true,
    });
    publish();
  }
  async function send(job: JournalPending): Promise<boolean> {
    const ctx = active();
    if (
      !ctx ||
      ctx.projectId !== job.projectId ||
      state.current.writing ||
      ctx.planningBusy ||
      ctx.planningUncertain
    )
      return false;
    const epoch = generation.current,
      privacy = privateGeneration.current;
    Object.freeze(job.input);
    if (job.method !== 'DELETE') Object.freeze(job.sentDraft);
    Object.freeze(job);
    state.current.pending = job;
    state.current.writing = true;
    state.current.error = null;
    publish();
    try {
      const ack =
        job.method === 'POST'
          ? await api.journalCreate(job.projectId, job.input)
          : job.method === 'PATCH'
            ? await api.journalUpdate(job.projectId, job.entryId, job.input)
            : await api.journalDelete(job.projectId, job.entryId, job.input);
      if (privacy !== privateGeneration.current) return false;
      const known = state.current.known.get(job.projectId) ?? {
        project: 0,
        journal: 0,
      };
      state.current.known.set(job.projectId, {
        ...known,
        journal: Math.max(known.journal, ack.journalRevision),
      });
      if (job.method !== 'DELETE') {
        const draft = state.current.drafts.get(job.key);
        if (draft && sameJournalDraft(draft, job.sentDraft))
          state.current.drafts.delete(job.key);
      } else state.current.confirmation = null;
      state.current.pending = null;
      state.current.uncertain = false;
      state.current.conflict = null;
      state.current.conflictCurrent = null;
      state.current.removed = false;
      state.current.notice = 'Запись сохранена';
      if (active()?.projectId === job.projectId) await refresh();
      if (epoch !== generation.current || privacy !== privateGeneration.current)
        return false;
      if (job.method !== 'DELETE') {
        const query = active()?.projectQuery;
        const input = job.input;
        if (
          query &&
          ((query.q &&
            ![
              input.body,
              state.current.metadata
                .get(job.projectId)
                ?.tasks.find((task) => task.id === job.sentDraft.taskId)
                ?.title ?? '',
            ].some((text) =>
              text
                .normalize('NFC')
                .toLocaleLowerCase('ru')
                .includes(
                  query.q!.trim().normalize('NFC').toLocaleLowerCase('ru'),
                ),
            )) ||
            (query.from && input.workDate < query.from) ||
            (query.to && input.workDate > query.to))
        )
          state.current.notice = 'Запись сохранена; она не подходит под фильтр';
      }
      return true;
    } catch (error) {
      if (privacy !== privateGeneration.current || auth(error, privacy))
        return false;
      const failed = error instanceof ApiError ? error : null;
      state.current.uncertain = failed?.uncertain ?? true;
      state.current.error = state.current.uncertain
        ? 'Результат сохранения неизвестен. Повторите сохранение.'
        : failed?.status === 409
          ? 'Запись изменилась. Черновик сохранён; покажите текущую запись для сравнения.'
          : 'Не удалось сохранить запись. Проверьте дату и текст.';
      if (!state.current.uncertain) {
        state.current.pending = null;
        if (failed?.status === 409) {
          state.current.conflict = job.key;
          state.current.conflictCurrent = null;
          if (active()?.projectId === job.projectId) void refresh();
        }
        if (failed?.status === 404) {
          state.current.conflict = job.key;
          state.current.removed = true;
        }
      }
      return false;
    } finally {
      if (privacy === privateGeneration.current) {
        state.current.writing = false;
        publish();
      }
    }
  }
  async function submit(key: JournalDraftKey) {
    const ctx = active(),
      draft = state.current.drafts.get(key);
    if (
      !ctx ||
      !draft ||
      draft.projectId !== ctx.projectId ||
      !editable() ||
      ctx.planningBusy ||
      ctx.planningUncertain ||
      state.current.conflict === key
    )
      return false;
    const feed = state.current.feeds.project,
      metadata = feed?.metadata;
    if (
      !metadata ||
      metadata.revision !== feed?.page?.projectRevision ||
      ['stale', 'metadata-error', 'error', 'loading'].includes(feed.phase) ||
      !metadata.tasks.some((task) => task.id === draft.taskId)
    ) {
      state.current.error =
        'Задача недоступна. Обновите журнал; текст черновика сохранён.';
      publish();
      return false;
    }
    const base = {
      journalContractVersion: 1 as const,
      operationId: '00000000-0000-4000-8000-000000000000',
      expectedJournalRevision: draft.entryId
        ? draft.baselineJournalRevision
        : (state.current.known.get(ctx.projectId)?.journal ?? 0),
      body: draft.body,
      workDate: draft.workDate,
    };
    const parsed = draft.entryId
      ? journalUpdateSchema.safeParse(base)
      : journalCreateSchema.safeParse({ ...base, taskId: draft.taskId });
    if (!parsed.success) {
      state.current.error = 'Введите дату и текст от 1 до 10000 символов.';
      publish();
      return false;
    }
    const operationId = crypto.randomUUID();
    const sentDraft = {
      ...draft,
      baselineJournalRevision: base.expectedJournalRevision,
    };
    state.current.drafts.set(key, sentDraft);
    return draft.entryId
      ? send({
          method: 'PATCH',
          key,
          projectId: draft.projectId,
          entryId: draft.entryId,
          input: { ...base, operationId },
          sentDraft,
        })
      : send({
          method: 'POST',
          key,
          projectId: draft.projectId,
          input: { ...base, operationId, taskId: draft.taskId! },
          sentDraft,
        });
  }
  function askDelete(entry: JournalEntry, revision: number) {
    if (!editable() || entry.projectId !== active()?.projectId) return;
    if (state.current.confirmation?.entry.id !== entry.id)
      state.current.confirmation = {
        projectId: entry.projectId,
        entry: Object.freeze({ ...entry }),
        baselineJournalRevision: revision,
      };
    publish();
  }
  async function confirmDelete() {
    const ctx = active(),
      confirmation = state.current.confirmation;
    if (
      !ctx ||
      !confirmation ||
      confirmation.projectId !== ctx.projectId ||
      !editable() ||
      state.current.conflict?.startsWith(`project:${ctx.projectId}:`)
    )
      return false;
    const input = journalDeleteSchema.parse({
      journalContractVersion: 1,
      operationId: crypto.randomUUID(),
      expectedJournalRevision: confirmation.baselineJournalRevision,
    });
    return send({
      method: 'DELETE',
      key: `project:${ctx.projectId}:entry:${confirmation.entry.id}:edit`,
      projectId: ctx.projectId,
      entryId: confirmation.entry.id,
      input,
      baselineEntry: confirmation.entry,
    });
  }
  async function showCurrent() {
    const ctx = active(),
      key = state.current.conflict;
    if (!ctx || !key || !key.startsWith(`project:${ctx.projectId}:`)) return;
    const draft = state.current.drafts.get(key),
      entryId = draft?.entryId ?? state.current.confirmation?.entry.id;
    if (!entryId) return;
    const epoch = generation.current,
      privacy = privateGeneration.current,
      request = ++conflictReadSequence.current;
    const valid = () =>
      epoch === generation.current &&
      request === conflictReadSequence.current &&
      state.current.conflict === key;
    try {
      const read = await api.journalEntry(ctx.projectId, entryId);
      if (!valid()) return;
      const known = state.current.known.get(ctx.projectId);
      if (
        read.projectId !== ctx.projectId ||
        read.entry.id !== entryId ||
        (known &&
          (read.journalRevision < known.journal ||
            read.projectRevision < known.project))
      ) {
        state.current.error = staleError;
        publish();
        return;
      }
      state.current.conflictCurrent = read;
      state.current.removed = false;
      publish();
    } catch (error) {
      if (auth(error, privacy) || !valid()) return;
      if (error instanceof ApiError && error.status === 404)
        state.current.removed = true;
      else state.current.error = safeError;
      publish();
    }
  }
  function acceptCurrent(key: JournalDraftKey, mode: 'replace' | 'keep-own') {
    if (
      !editable() ||
      key !== state.current.conflict ||
      !key.startsWith(`project:${active()?.projectId}:`)
    )
      return;
    const read = state.current.conflictCurrent;
    const old = state.current.drafts.get(key);
    if (old && !old.entryId && !state.current.removed) {
      state.current.conflict = null;
      state.current.error = null;
      publish();
      return;
    }
    if (!read || state.current.removed) return;
    if (old) {
      const next = openEditDraft(undefined, read.entry, read.journalRevision);
      state.current.drafts.set(
        key,
        mode === 'replace'
          ? next
          : {
              ...next,
              body: old.body,
              workDate: old.workDate,
              dirty: old.dirty,
              dateTouched: old.dateTouched,
            },
      );
    }
    if (state.current.confirmation?.entry.id === read.entry.id)
      state.current.confirmation = {
        projectId: read.projectId,
        entry: read.entry,
        baselineJournalRevision: read.journalRevision,
      };
    state.current.conflict = null;
    state.current.conflictCurrent = null;
    state.current.error = null;
    publish();
  }
  const data = state.current;
  const scopedConflict =
    context.status === 'active' &&
    data.conflict?.startsWith(`project:${context.projectId}:`)
      ? data.conflict
      : null;
  return {
    active: context.status === 'active',
    projectFeed:
      context.status === 'active' &&
      data.feeds.project?.scope.projectId === context.projectId
        ? data.feeds.project
        : null,
    taskFeed:
      context.status === 'active' &&
      data.feeds.task?.scope.projectId === context.projectId &&
      data.feeds.task.scope.taskId === context.taskId
        ? data.feeds.task
        : null,
    drafts: data.drafts,
    pending: data.pending,
    writing: data.writing,
    uncertain: data.uncertain,
    deleteConfirmation: data.confirmation,
    hasDirtyDrafts: [...data.drafts.values()].some((draft) => draft.dirty),
    unavailableTaskIds: data.unavailable,
    mutationError: data.conflict && !scopedConflict ? null : data.error,
    notice: data.notice,
    activeConflictKey: scopedConflict,
    conflictCurrent: scopedConflict ? data.conflictCurrent : null,
    conflictRemoved: !!scopedConflict && data.removed,
    getDraft: (key) => data.drafts.get(key),
    openCreate,
    openEdit,
    changeDraft,
    clearDraft: (key) => {
      if (!editable()) return;
      data.drafts.delete(key);
      if (data.conflict === key) {
        data.conflict = null;
        data.conflictCurrent = null;
        data.removed = false;
      }
      data.error = null;
      publish();
    },
    submit,
    retry: async () => (data.pending ? send(data.pending) : false),
    askDelete,
    cancelDelete: () => {
      if (!editable()) return;
      data.confirmation = null;
      data.conflict = null;
      data.conflictCurrent = null;
      data.removed = false;
      publish();
    },
    confirmDelete,
    showCurrent,
    acceptCurrent,
    refresh,
    loadMore: (scope) => read(scope, true),
    clearPrivateState,
  };
}
