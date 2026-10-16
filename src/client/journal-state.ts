import type { Task } from '../shared/contracts.js';
import type {
  JournalEntry,
  JournalPage,
  JournalEntryRead,
  JournalCreate,
  JournalUpdate,
  JournalDelete,
  JournalProjectQuery,
} from '../shared/journal-contracts.js';
export type JournalDraftKey =
  | `project:${string}:task:${string}:create`
  | `project:${string}:modal:create`
  | `project:${string}:entry:${string}:edit`;
export type JournalDraft = {
  key: JournalDraftKey;
  projectId: string;
  taskId: string | null;
  entryId: string | null;
  body: string;
  workDate: string;
  dateTouched: boolean;
  dirty: boolean;
  baselineEntry: JournalEntry | null;
  baselineJournalRevision: number; // pinned for edit; create pins at send
};
export type JournalPending =
  | {
      key: JournalDraftKey;
      method: 'POST';
      projectId: string;
      input: JournalCreate;
      sentDraft: JournalDraft;
    }
  | {
      key: JournalDraftKey;
      method: 'PATCH';
      projectId: string;
      entryId: string;
      input: JournalUpdate;
      sentDraft: JournalDraft;
    }
  | {
      key: JournalDraftKey;
      method: 'DELETE';
      projectId: string;
      entryId: string;
      input: JournalDelete;
      baselineEntry: JournalEntry;
    };
export type JournalDeleteConfirmation = {
  projectId: string;
  entry: JournalEntry;
  baselineJournalRevision: number;
};
export type JournalMetadata = {
  projectId: string;
  revision: number;
  tasks: readonly Task[];
};
export type JournalFeedState = {
  scope: {
    projectId: string;
    taskId: string | null;
    query: JournalProjectQuery;
  };
  page: JournalPage | null;
  metadata: JournalMetadata | null;
  pendingPage: JournalPage | null;
  phase:
    | 'loading'
    | 'ready'
    | 'empty'
    | 'no-match'
    | 'error'
    | 'loading-more'
    | 'more-error'
    | 'stale'
    | 'metadata-error';
  error: string | null; // safe display string, no HTTP dumps
};
export type JournalLastWrite = {
  projectId: string;
  taskId: string | null;
  operationId: string;
  result: 'saved' | 'deleted';
};
export type JournalController = {
  lastWrite: JournalLastWrite | null;
  active: boolean;
  projectFeed: JournalFeedState | null;
  taskFeed: JournalFeedState | null;
  drafts: ReadonlyMap<JournalDraftKey, JournalDraft>;
  pending: JournalPending | null;
  writing: boolean;
  uncertain: boolean;
  deleteConfirmation: JournalDeleteConfirmation | null;
  hasDirtyDrafts: boolean;
  unavailableTaskIds: ReadonlySet<string>;
  mutationError: string | null;
  notice: string | null;
  activeConflictKey: JournalDraftKey | null;
  conflictCurrent: JournalEntryRead | null;
  conflictRemoved: boolean;
  getDraft(key: JournalDraftKey): JournalDraft | undefined;
  openCreate(
    projectId: string,
    taskId: string | null,
    today: string,
  ): JournalDraftKey | null;
  openEdit(
    entry: JournalEntry,
    journalRevision: number,
  ): JournalDraftKey | null;
  changeDraft(
    key: JournalDraftKey,
    fields: Partial<Pick<JournalDraft, 'body' | 'workDate' | 'taskId'>>,
  ): void;
  clearDraft(key: JournalDraftKey): void; // caller confirms nonempty loss
  submit(key: JournalDraftKey): Promise<boolean>;
  retry(): Promise<boolean>;
  askDelete(entry: JournalEntry, journalRevision: number): void;
  cancelDelete(): void;
  confirmDelete(): Promise<boolean>;
  showCurrent(): Promise<void>;
  acceptCurrent(key: JournalDraftKey, mode: 'replace' | 'keep-own'): void;
  refresh(): Promise<void>;
  loadMore(scope: 'project' | 'task'): Promise<void>;
  clearPrivateState(): void;
};
export function createDraftKey(
  projectId: string,
  taskId: string | null,
): JournalDraftKey {
  return taskId
    ? `project:${projectId}:task:${taskId}:create`
    : `project:${projectId}:modal:create`;
}
export function openEditDraft(
  existing: JournalDraft | undefined,
  entry: JournalEntry,
  revision: number,
): JournalDraft {
  const key: JournalDraftKey = `project:${entry.projectId}:entry:${entry.id}:edit`;
  if (existing?.key === key) return existing;
  return {
    key,
    projectId: entry.projectId,
    taskId: entry.taskId,
    entryId: entry.id,
    body: entry.body,
    workDate: entry.workDate,
    dateTouched: false,
    dirty: false,
    baselineEntry: Object.freeze({ ...entry }),
    baselineJournalRevision: revision,
  };
}
export function journalTaskPath(tasks: readonly Task[], id: string): string {
  const byId = new Map(tasks.map((task) => [task.id, task]));
  const names: string[] = [];
  const seen = new Set<string>();
  let task = byId.get(id);
  while (task && !seen.has(task.id)) {
    seen.add(task.id);
    names.unshift(task.title);
    task = task.parentId ? byId.get(task.parentId) : undefined;
  }
  return names.join(' / ');
}
export function orderJournal(entries: readonly JournalEntry[]): JournalEntry[] {
  return [...entries].sort(
    (a, b) =>
      b.workDate.localeCompare(a.workDate) ||
      b.createdAt.localeCompare(a.createdAt) ||
      b.id.localeCompare(a.id),
  );
}
export function mergeJournalPages(a: JournalPage, b: JournalPage): JournalPage {
  if (
    a.projectId !== b.projectId ||
    a.taskId !== b.taskId ||
    a.projectRevision !== b.projectRevision ||
    a.journalRevision !== b.journalRevision
  )
    throw Error('JOURNAL_CURSOR_STALE');
  return {
    ...b,
    entries: orderJournal([
      ...new Map(
        [...a.entries, ...b.entries].map((entry) => [entry.id, entry]),
      ).values(),
    ]),
  };
}
export function sameJournalDraft(a: JournalDraft, b: JournalDraft): boolean {
  return (
    a.body === b.body &&
    a.workDate === b.workDate &&
    a.taskId === b.taskId &&
    a.baselineJournalRevision === b.baselineJournalRevision
  );
}

export type JournalPosition = {
  id: string | null;
  date: string | null;
  offset: number;
  top: number;
  left: number;
};
