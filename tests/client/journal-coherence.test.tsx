// @vitest-environment jsdom
import { act, cleanup, renderHook, waitFor } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { api, ApiError } from '../../src/client/api.js';
import { useJournal } from '../../src/client/use-journal.js';
import {
  journal5,
  page5,
  journalContext,
  tree0,
  renamedTree,
  deferred,
} from './journal-fixtures.js';
import type { JournalPage } from '../../src/shared/journal-contracts.js';
import type { ProjectTree } from '../../src/shared/contracts.js';
import { task } from './fixtures.js';
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});
it('uses coherent renamed/moved metadata while dirty planning baseline stays untouched', async () => {
  const moved = {
    ...renamedTree,
    tasks: [
      task(2, { title: 'New parent' }),
      task(1, { title: 'Remote renamed', parentId: task(2).id }),
    ],
  };
  vi.spyOn(api, 'journalProject').mockResolvedValue({
    ...page5,
    projectRevision: 1,
  });
  vi.spyOn(api, 'tree').mockResolvedValue(moved);
  const apply = vi.fn();
  const ctx = journalContext({ planningDirty: true, applyCleanTree: apply });
  const view = renderHook(() => useJournal(ctx));
  await waitFor(() =>
    expect(view.result.current.projectFeed?.phase).toBe('ready'),
  );
  expect(view.result.current.projectFeed?.metadata?.tasks).toEqual(moved.tasks);
  expect(apply).not.toHaveBeenCalled();
  expect(ctx.planningTree).toBe(tree0);
});
it('resolves nested new task/entry absent from the old tree before publishing titles or picker', async () => {
  const nested = task(2, {
    parentId: journal5.taskId,
    title: 'New nested task',
  });
  const late = deferred<ProjectTree>();
  vi.spyOn(api, 'journalProject').mockResolvedValue({
    ...page5,
    projectRevision: 1,
    entries: [{ ...journal5, taskId: nested.id }],
  });
  vi.spyOn(api, 'tree').mockReturnValue(late.promise);
  const view = renderHook(() => useJournal(journalContext()));
  await waitFor(() =>
    expect(
      view.result.current.projectFeed?.pendingPage?.entries[0]?.taskId,
    ).toBe(nested.id),
  );
  expect(view.result.current.projectFeed?.page).toBeNull();
  expect(view.result.current.unavailableTaskIds.size).toBe(0);
  await act(async () =>
    late.resolve({ ...renamedTree, tasks: [...tree0.tasks, nested] }),
  );
  expect(view.result.current.projectFeed?.metadata?.tasks.at(-1)?.title).toBe(
    'New nested task',
  );
});
it('page6/tree7 re-reads page7, tree6/page7 re-reads tree7', async () => {
  const t6 = { ...tree0, project: { ...tree0.project, revision: 6 } },
    t7 = { ...renamedTree, project: { ...renamedTree.project, revision: 7 } };
  const page = vi
    .spyOn(api, 'journalProject')
    .mockResolvedValueOnce({ ...page5, projectRevision: 6 })
    .mockResolvedValue({ ...page5, projectRevision: 7 });
  const tree = vi.spyOn(api, 'tree').mockResolvedValue(t7);
  const view = renderHook(() => useJournal(journalContext()));
  await waitFor(() =>
    expect(view.result.current.projectFeed?.metadata?.revision).toBe(7),
  );
  expect(page).toHaveBeenCalledTimes(2);
  view.unmount();
  page.mockClear().mockResolvedValue({ ...page5, projectRevision: 7 });
  tree.mockReset().mockResolvedValueOnce(t6).mockResolvedValue(t7);
  const second = renderHook(() => useJournal(journalContext()));
  await waitFor(() =>
    expect(second.result.current.projectFeed?.metadata?.revision).toBe(7),
  );
  expect(tree).toHaveBeenCalledTimes(2);
});
it('deletion between reads refetches page before declaring matched unavailable tasks', async () => {
  vi.spyOn(api, 'journalProject')
    .mockResolvedValueOnce({ ...page5, projectRevision: 1 })
    .mockResolvedValue({
      ...page5,
      projectRevision: 2,
      journalRevision: 6,
      entries: [],
    });
  vi.spyOn(api, 'tree').mockResolvedValue({
    ...tree0,
    project: { ...tree0.project, revision: 2 },
    tasks: [],
  });
  const view = renderHook(() => useJournal(journalContext()));
  await waitFor(() =>
    expect(view.result.current.projectFeed?.phase).toBe('empty'),
  );
  expect(view.result.current.projectFeed?.page?.entries).toEqual([]);
});
it('keeps pending page/draft after metadata error and restarts on explicit refresh', async () => {
  vi.spyOn(api, 'journalProject').mockResolvedValue({
    ...page5,
    projectRevision: 1,
  });
  const tree = vi
    .spyOn(api, 'tree')
    .mockRejectedValueOnce(new ApiError('NETWORK_ERROR', 'offline'))
    .mockResolvedValue(renamedTree);
  const view = renderHook(() => useJournal(journalContext()));
  await waitFor(() =>
    expect(view.result.current.projectFeed?.phase).toBe('metadata-error'),
  );
  expect(view.result.current.projectFeed?.pendingPage?.entries).toEqual([
    journal5,
  ]);
  expect(view.result.current.projectFeed?.page).toBeNull();
  await act(async () => view.result.current.refresh());
  expect(view.result.current.projectFeed?.phase).toBe('ready');
  expect(tree).toHaveBeenCalledTimes(2);
});
it('bounds racing revisions to three attempts and keeps the last coherent feed stale', async () => {
  const page = vi.spyOn(api, 'journalProject').mockResolvedValue(page5);
  const tree = vi.spyOn(api, 'tree');
  const view = renderHook(() => useJournal(journalContext()));
  await waitFor(() =>
    expect(view.result.current.projectFeed?.phase).toBe('ready'),
  );
  page
    .mockReset()
    .mockResolvedValueOnce({ ...page5, projectRevision: 1 })
    .mockResolvedValueOnce({ ...page5, projectRevision: 3 })
    .mockResolvedValueOnce({ ...page5, projectRevision: 5 });
  tree
    .mockResolvedValueOnce({
      ...renamedTree,
      project: { ...tree0.project, revision: 2 },
    })
    .mockResolvedValueOnce({
      ...renamedTree,
      project: { ...tree0.project, revision: 4 },
    })
    .mockResolvedValueOnce({
      ...renamedTree,
      project: { ...tree0.project, revision: 6 },
    });
  await act(async () => view.result.current.refresh());
  expect(view.result.current.projectFeed?.phase).toBe('stale');
  expect(page).toHaveBeenCalledTimes(3);
  expect(view.result.current.projectFeed?.page).toEqual(page5);
});
it('equal-revision missing task is an integrity error, not a blank linked card', async () => {
  vi.spyOn(api, 'journalProject').mockResolvedValue({
    ...page5,
    entries: [{ ...journal5, taskId: task(9).id }],
  });
  const view = renderHook(() => useJournal(journalContext()));
  await waitFor(() =>
    expect(view.result.current.projectFeed?.phase).toBe('metadata-error'),
  );
  expect(view.result.current.projectFeed?.page).toBeNull();
  expect(view.result.current.unavailableTaskIds.size).toBe(0);
});
it('late old-filter result cannot replace current feed', async () => {
  const late = deferred<JournalPage>();
  vi.spyOn(api, 'journalProject')
    .mockReturnValueOnce(late.promise)
    .mockResolvedValue({ ...page5, entries: [] });
  const view = renderHook(
    ({ q }) => useJournal(journalContext({ projectQuery: { q } })),
    { initialProps: { q: 'old' } },
  );
  view.rerender({ q: 'new' });
  await waitFor(() =>
    expect(view.result.current.projectFeed?.phase).toBe('no-match'),
  );
  await act(async () => late.resolve(page5));
  expect(view.result.current.projectFeed?.scope.query.q).toBe('new');
  expect(view.result.current.projectFeed?.page?.entries).toEqual([]);
});
it('stale cursor and failed more preserve existing rows', async () => {
  const page = vi
    .spyOn(api, 'journalProject')
    .mockResolvedValue({ ...page5, nextCursor: 'synthetic-cursor' });
  const view = renderHook(() => useJournal(journalContext()));
  await waitFor(() =>
    expect(view.result.current.projectFeed?.phase).toBe('ready'),
  );
  page.mockRejectedValueOnce(new ApiError('NETWORK_ERROR', 'offline'));
  await act(async () => view.result.current.loadMore('project'));
  expect(view.result.current.projectFeed?.phase).toBe('more-error');
  expect(view.result.current.projectFeed?.page?.entries).toEqual([journal5]);
  page.mockRejectedValueOnce(
    new ApiError('JOURNAL_CURSOR_STALE', 'stale', 409),
  );
  await act(async () => view.result.current.loadMore('project'));
  expect(view.result.current.projectFeed?.phase).toBe('stale');
  expect(view.result.current.projectFeed?.page?.entries).toEqual([journal5]);
});
it.each(['project', 'journal'] as const)(
  'round1 parallel scopes cannot lower the known %s revision after awaited metadata',
  async (floor) => {
    const oldPage = { ...page5, projectRevision: 1, journalRevision: 5 };
    const newPage = {
      ...page5,
      projectRevision: floor === 'project' ? 2 : 1,
      journalRevision: floor === 'journal' ? 6 : 5,
      entries: [],
    };
    const oldTree = { ...tree0, project: { ...tree0.project, revision: 1 } },
      newTree = {
        ...tree0,
        project: { ...tree0.project, revision: newPage.projectRevision },
        tasks: [{ ...tree0.tasks[0]!, title: 'Current metadata title' }],
      };
    const delayedTree = deferred<ProjectTree>(),
      delayedTask = deferred<JournalPage>();
    vi.spyOn(api, 'journalProject').mockResolvedValue(oldPage);
    vi.spyOn(api, 'journalTask')
      .mockReturnValueOnce(delayedTask.promise)
      .mockResolvedValue({ ...newPage, taskId: journal5.taskId });
    const tree = vi
      .spyOn(api, 'tree')
      .mockReturnValueOnce(delayedTree.promise)
      .mockResolvedValue(newTree);
    const apply = vi.fn();
    const view = renderHook(() =>
      useJournal(
        journalContext({
          taskId: journal5.taskId,
          planningDirty: true,
          applyCleanTree: apply,
        }),
      ),
    );
    await waitFor(() => expect(tree).toHaveBeenCalledOnce());
    await act(async () =>
      delayedTask.resolve({ ...newPage, taskId: journal5.taskId }),
    );
    await waitFor(() =>
      expect(view.result.current.taskFeed?.phase).toBe('empty'),
    );
    await act(async () => delayedTree.resolve(oldTree));
    await waitFor(() =>
      expect(view.result.current.projectFeed?.phase).toBe('stale'),
    );
    expect(view.result.current.projectFeed?.page).toBeNull();
    expect(view.result.current.taskFeed?.page).toEqual({
      ...newPage,
      taskId: journal5.taskId,
    });
    expect(api.journalProject).toHaveBeenCalledTimes(3);
    expect(apply).not.toHaveBeenCalled();
    vi.mocked(api.journalProject).mockResolvedValue(newPage);
    await act(async () => view.result.current.refresh());
    expect(view.result.current.projectFeed?.phase).toBe('empty');
    expect(view.result.current.projectFeed?.metadata?.tasks[0]?.title).toBe(
      'Current metadata title',
    );
  },
);
import type { JournalMutation } from '../../src/shared/journal-contracts.js';
import type { JournalDraftKey } from '../../src/client/journal-state.js';
it('round1 mutation acknowledgement invalidates an awaited older tree without republishing its page or frozen entry', async () => {
  const page = vi.spyOn(api, 'journalProject').mockResolvedValue(page5);
  const tree = vi.spyOn(api, 'tree');
  const ack = deferred<JournalMutation>(),
    oldTree = deferred<ProjectTree>();
  vi.spyOn(api, 'journalUpdate').mockReturnValue(ack.promise);
  const apply = vi.fn();
  const view = renderHook(() =>
    useJournal(journalContext({ planningDirty: true, applyCleanTree: apply })),
  );
  await waitFor(() =>
    expect(view.result.current.projectFeed?.phase).toBe('ready'),
  );
  let key: JournalDraftKey | null = null;
  act(() => {
    key = view.result.current.openEdit(journal5, 5);
  });
  act(() =>
    view.result.current.changeDraft(key!, {
      body: 'Sent before remote deletion',
    }),
  );
  let saving: Promise<boolean> | undefined, reading: Promise<void> | undefined;
  act(() => {
    saving = view.result.current.submit(key!);
  });
  page.mockResolvedValue({ ...page5, projectRevision: 1 });
  tree.mockReturnValueOnce(oldTree.promise).mockResolvedValue(renamedTree);
  act(() => {
    reading = view.result.current.refresh();
  });
  await waitFor(() => expect(tree).toHaveBeenCalledOnce());
  page.mockResolvedValue({
    ...page5,
    projectRevision: 1,
    journalRevision: 7,
    entries: [],
  });
  await act(async () => {
    ack.resolve({
      journalContractVersion: 1,
      kind: 'saved',
      projectId: journal5.projectId,
      journalRevision: 6,
      entry: journal5,
    });
    await saving;
  });
  expect(view.result.current.projectFeed?.page?.journalRevision).toBe(7);
  expect(view.result.current.projectFeed?.page?.entries).toEqual([]);
  await act(async () => {
    oldTree.resolve(renamedTree);
    await reading;
  });
  expect(view.result.current.projectFeed?.phase).toBe('empty');
  expect(view.result.current.projectFeed?.page?.journalRevision).toBe(7);
  expect(view.result.current.projectFeed?.page?.entries).toEqual([]);
  expect(view.result.current.getDraft(key!)).toBeUndefined();
  expect(apply).not.toHaveBeenCalled();
  expect(
    vi.mocked(api.journalUpdate).mock.calls[0]?.[2].expectedJournalRevision,
  ).toBe(5);
});
it('round1 a newer matching planning tree never applies a retained older reconciliation tree', async () => {
  const delayed = deferred<ProjectTree>();
  vi.spyOn(api, 'journalProject').mockResolvedValue({
    ...page5,
    projectRevision: 2,
  });
  const tree = vi.spyOn(api, 'tree').mockReturnValue(delayed.promise);
  const apply = vi.fn();
  const current = {
    ...tree0,
    project: { ...tree0.project, revision: 2 },
    tasks: [{ ...tree0.tasks[0]!, title: 'Current planning title' }],
  };
  const view = renderHook(
    ({ planningTree }) =>
      useJournal(journalContext({ planningTree, applyCleanTree: apply })),
    { initialProps: { planningTree: tree0 } },
  );
  await waitFor(() => expect(tree).toHaveBeenCalledOnce());
  view.rerender({ planningTree: current });
  await act(async () => delayed.resolve(renamedTree));
  expect(view.result.current.projectFeed?.phase).toBe('ready');
  expect(view.result.current.projectFeed?.metadata?.tasks[0]?.title).toBe(
    'Current planning title',
  );
  expect(apply).not.toHaveBeenCalled();
});
