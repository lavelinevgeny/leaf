// @vitest-environment jsdom
import {
  act,
  cleanup,
  render,
  renderHook,
  screen,
  waitFor,
} from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { api, ApiError } from '../../src/client/api.js';
import userEvent from '@testing-library/user-event';
import { JournalConflict } from '../../src/client/JournalEditor.js';
import { useJournal } from '../../src/client/use-journal.js';
import {
  journal5,
  page5,
  read6,
  journalContext,
  deferred,
} from './journal-fixtures.js';
import type { JournalDraftKey } from '../../src/client/journal-state.js';
import type { JournalMutation } from '../../src/shared/journal-contracts.js';
beforeEach(() => {
  vi.spyOn(api, 'journalProject').mockResolvedValue(page5);
  vi.spyOn(api, 'journalTask').mockResolvedValue({
    ...page5,
    taskId: journal5.taskId,
  });
  vi.spyOn(api, 'journalEntry').mockResolvedValue(read6);
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});
async function setup() {
  const view = renderHook(() => useJournal(journalContext()));
  await waitFor(() =>
    expect(view.result.current.projectFeed?.phase).toBe('ready'),
  );
  return view;
}
it('pins editor and delete baselines through focus refresh and reopening, adopts only explicit current response', async () => {
  const view = await setup();
  let key: JournalDraftKey | null = null;
  act(() => {
    key = view.result.current.openEdit(journal5, 5);
    view.result.current.askDelete(journal5, 5);
  });
  if (!key) throw Error('key');
  const editKey = key;
  act(() =>
    view.result.current.changeDraft(editKey, {
      body: 'Own draft',
      workDate: '2024-03-01',
    }),
  );
  vi.mocked(api.journalProject).mockResolvedValue({
    ...page5,
    journalRevision: 6,
    entries: [read6.entry],
  });
  await act(async () => view.result.current.refresh());
  act(() => {
    view.result.current.openEdit(read6.entry, 6);
    view.result.current.askDelete(read6.entry, 6);
  });
  expect(view.result.current.getDraft(editKey)).toMatchObject({
    body: 'Own draft',
    workDate: '2024-03-01',
    baselineJournalRevision: 5,
    baselineEntry: journal5,
  });
  expect(view.result.current.deleteConfirmation?.baselineJournalRevision).toBe(
    5,
  );
  const update = vi
    .spyOn(api, 'journalUpdate')
    .mockRejectedValue(
      new ApiError('JOURNAL_REVISION_CONFLICT', 'conflict', 409),
    );
  await act(async () =>
    expect(await view.result.current.submit(editKey)).toBe(false),
  );
  expect(update.mock.calls[0]?.[2]).toMatchObject({
    expectedJournalRevision: 5,
    body: 'Own draft',
  });
  await act(async () => view.result.current.showCurrent());
  expect(view.result.current.getDraft(editKey)?.baselineJournalRevision).toBe(
    5,
  );
  act(() => view.result.current.acceptCurrent(editKey, 'keep-own'));
  expect(view.result.current.getDraft(editKey)).toMatchObject({
    body: 'Own draft',
    workDate: '2024-03-01',
    baselineJournalRevision: 6,
  });
  update.mockResolvedValue({
    journalContractVersion: 1,
    kind: 'saved',
    projectId: journal5.projectId,
    journalRevision: 7,
    entry: { ...journal5, body: 'Own draft' },
  });
  vi.mocked(api.journalProject).mockResolvedValue({
    ...page5,
    journalRevision: 7,
  });
  await act(async () => view.result.current.submit(editKey));
  expect(update.mock.calls[1]?.[2].operationId).not.toBe(
    update.mock.calls[0]?.[2].operationId,
  );
  expect(update.mock.calls[1]?.[2].expectedJournalRevision).toBe(6);
});
it('delete sends pinned5 after refresh6; cancel then a new confirmation can pin6', async () => {
  const view = await setup();
  act(() => view.result.current.askDelete(journal5, 5));
  vi.mocked(api.journalProject).mockResolvedValue({
    ...page5,
    journalRevision: 6,
  });
  await act(async () => view.result.current.refresh());
  const remove = vi
    .spyOn(api, 'journalDelete')
    .mockRejectedValue(
      new ApiError('JOURNAL_REVISION_CONFLICT', 'conflict', 409),
    );
  await act(async () => view.result.current.confirmDelete());
  expect(remove.mock.calls[0]?.[2].expectedJournalRevision).toBe(5);
  act(() => {
    view.result.current.cancelDelete();
    view.result.current.askDelete(journal5, 6);
  });
  expect(view.result.current.deleteConfirmation?.baselineJournalRevision).toBe(
    6,
  );
});
it('locks exact uncertain envelope and clears only its matching draft after frozen older acknowledgement', async () => {
  const view = await setup();
  let key: JournalDraftKey | null = null;
  act(() => {
    key = view.result.current.openCreate(
      journal5.projectId,
      journal5.taskId,
      '2026-10-09',
    );
  });
  if (!key) throw Error('key');
  const createKey = key;
  act(() =>
    view.result.current.changeDraft(createKey, { body: 'Exact own text' }),
  );
  let other: JournalDraftKey | null = null;
  act(() => {
    other = view.result.current.openCreate(
      journal5.projectId,
      null,
      '2026-10-09',
    );
  });
  if (!other) throw Error('other');
  const otherKey = other;
  act(() => view.result.current.changeDraft(otherKey, { body: 'Other draft' }));
  const write = vi
    .spyOn(api, 'journalCreate')
    .mockRejectedValueOnce(new ApiError('NETWORK_ERROR', 'offline', null, true))
    .mockResolvedValueOnce({
      journalContractVersion: 1,
      projectId: journal5.projectId,
      journalRevision: 6,
      kind: 'saved',
      entry: journal5,
    });
  await act(async () => view.result.current.submit(createKey));
  const envelope = structuredClone(view.result.current.pending);
  act(() =>
    view.result.current.changeDraft(createKey, { body: 'must not change' }),
  );
  expect(view.result.current.getDraft(createKey)?.body).toBe('Exact own text');
  expect(view.result.current.pending).toEqual(envelope);
  vi.mocked(api.journalProject).mockResolvedValue({
    ...page5,
    journalRevision: 9,
    entries: [],
  });
  await act(async () => view.result.current.refresh());
  await act(async () => view.result.current.retry());
  expect(write.mock.calls[1]).toEqual(write.mock.calls[0]);
  expect(view.result.current.getDraft(createKey)).toBeUndefined();
  expect(view.result.current.getDraft(otherKey)?.body).toBe('Other draft');
  expect(view.result.current.projectFeed?.page?.journalRevision).toBe(9);
  expect(view.result.current.projectFeed?.page?.entries).toEqual([]);
});
it.each(['', '   ', 'x'.repeat(10001), '\ud800'])(
  'rejects invalid body before UUID/write: %s',
  async (body) => {
    const view = await setup();
    const uuid = vi.spyOn(crypto, 'randomUUID');
    const write = vi.spyOn(api, 'journalCreate');
    let key: JournalDraftKey | null = null;
    act(() => {
      key = view.result.current.openCreate(
        journal5.projectId,
        journal5.taskId,
        '2026-10-09',
      );
    });
    if (!key) throw Error('key');
    const k = key;
    act(() => view.result.current.changeDraft(k, { body }));
    await act(async () => view.result.current.submit(k));
    expect(write).not.toHaveBeenCalled();
    expect(uuid).not.toHaveBeenCalled();
  },
);
it('entry task is immutable; removed conflict remains copyable and cannot recreate', async () => {
  const view = await setup();
  let key: JournalDraftKey | null = null;
  act(() => {
    key = view.result.current.openEdit(journal5, 5);
  });
  if (!key) throw Error('key');
  const k = key;
  act(() =>
    view.result.current.changeDraft(k, {
      taskId: '44444444-4444-4444-8444-444444444444',
      body: 'Copy this synthetic text',
    }),
  );
  expect(view.result.current.getDraft(k)?.taskId).toBe(journal5.taskId);
  vi.spyOn(api, 'journalUpdate').mockRejectedValue(
    new ApiError('NOT_FOUND', 'missing', 404),
  );
  await act(async () => view.result.current.submit(k));
  expect(view.result.current.conflictRemoved).toBe(true);
  await act(async () =>
    expect(await view.result.current.submit(k)).toBe(false),
  );
  expect(view.result.current.getDraft(k)?.body).toBe(
    'Copy this synthetic text',
  );
});
it('does not resurrect any state after a late mutation following private reset', async () => {
  const view = await setup();
  const late = deferred<JournalMutation>();
  vi.spyOn(api, 'journalUpdate').mockReturnValue(late.promise);
  let key: JournalDraftKey | null = null;
  act(() => {
    key = view.result.current.openEdit(journal5, 5);
  });
  if (!key) throw Error('key');
  let completion: Promise<boolean>;
  act(() => {
    completion = view.result.current.submit(key!);
  });
  act(() => view.result.current.clearPrivateState());
  await act(async () => {
    late.resolve({
      journalContractVersion: 1,
      kind: 'saved',
      projectId: journal5.projectId,
      journalRevision: 6,
      entry: journal5,
    });
    await completion;
  });
  expect(view.result.current.drafts.size).toBe(0);
  expect(view.result.current.pending).toBeNull();
  expect(view.result.current.projectFeed).toBeNull();
  expect(view.result.current.lastWrite).toBeNull();
});
it('planning busy or uncertainty blocks competing writes while a dirty plan alone permits journal save', async () => {
  const ctx = journalContext();
  const view = renderHook(
    ({ busy, uncertain, dirty }) =>
      useJournal({
        ...ctx,
        planningBusy: busy,
        planningUncertain: uncertain,
        planningDirty: dirty,
      }),
    { initialProps: { busy: false, uncertain: false, dirty: true } },
  );
  await waitFor(() =>
    expect(view.result.current.projectFeed?.phase).toBe('ready'),
  );
  let key: JournalDraftKey | null = null;
  act(() => {
    key = view.result.current.openCreate(
      journal5.projectId,
      journal5.taskId,
      '2026-10-09',
    );
  });
  act(() =>
    view.result.current.changeDraft(key!, { body: 'independent note' }),
  );
  const write = vi.spyOn(api, 'journalCreate').mockResolvedValue({
    journalContractVersion: 1,
    kind: 'saved',
    projectId: journal5.projectId,
    journalRevision: 5,
    entry: journal5,
  });
  view.rerender({ busy: true, uncertain: false, dirty: true });
  await act(async () =>
    expect(await view.result.current.submit(key!)).toBe(false),
  );
  view.rerender({ busy: false, uncertain: true, dirty: true });
  await act(async () =>
    expect(await view.result.current.submit(key!)).toBe(false),
  );
  expect(write).not.toHaveBeenCalled();
  view.rerender({ busy: false, uncertain: false, dirty: true });
  await act(async () =>
    expect(await view.result.current.submit(key!)).toBe(true),
  );
  expect(write).toHaveBeenCalledOnce();
});
it('an A conflict never blocks or appears in an independent project B delete', async () => {
  const ctx = journalContext();
  const view = renderHook(({ context }) => useJournal(context), {
    initialProps: { context: ctx },
  });
  await waitFor(() =>
    expect(view.result.current.projectFeed?.phase).toBe('ready'),
  );
  let key: JournalDraftKey | null = null;
  act(() => {
    key = view.result.current.openEdit(journal5, 5);
  });
  vi.spyOn(api, 'journalUpdate').mockRejectedValue(
    new ApiError('JOURNAL_REVISION_CONFLICT', 'conflict', 409),
  );
  await act(async () => view.result.current.submit(key!));
  const otherId = '44444444-4444-4444-8444-444444444444',
    otherEntry = { ...journal5, projectId: otherId },
    otherTree = {
      ...ctx.planningTree,
      project: { ...ctx.planningTree.project, id: otherId },
      tasks: ctx.planningTree.tasks.map((task) => ({
        ...task,
        projectId: otherId,
      })),
    };
  vi.mocked(api.journalProject).mockResolvedValue({
    ...page5,
    projectId: otherId,
    entries: [otherEntry],
  });
  view.rerender({
    context: journalContext({ projectId: otherId, planningTree: otherTree }),
  });
  await waitFor(() =>
    expect(view.result.current.projectFeed?.phase).toBe('ready'),
  );
  expect(view.result.current.activeConflictKey).toBeNull();
  expect(view.result.current.mutationError).toBeNull();
  const remove = vi.spyOn(api, 'journalDelete').mockResolvedValue({
    journalContractVersion: 1,
    kind: 'deleted',
    projectId: otherId,
    journalRevision: 5,
    deletedEntryId: otherEntry.id,
  });
  act(() => view.result.current.askDelete(otherEntry, 5));
  await act(async () =>
    expect(await view.result.current.confirmDelete()).toBe(true),
  );
  expect(remove).toHaveBeenCalledOnce();
  expect(view.result.current.getDraft(key!)?.baselineJournalRevision).toBe(5);
});
import type { JournalContext } from '../../src/client/use-journal.js';
it.each(['filter', 'inactive'] as const)(
  'round1 %s transition plus rejected write retains accessible exact retry',
  async (transition) => {
    const view = renderHook(
      ({ context }: { context: JournalContext }) => useJournal(context),
      { initialProps: { context: journalContext() as JournalContext } },
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
        body: 'Exact cross-identity draft',
      }),
    );
    const late = deferred<JournalMutation>();
    const write = vi
      .spyOn(api, 'journalUpdate')
      .mockReturnValueOnce(late.promise)
      .mockResolvedValueOnce({
        journalContractVersion: 1,
        kind: 'saved',
        projectId: journal5.projectId,
        journalRevision: 5,
        entry: journal5,
      });
    let completion: Promise<boolean> | undefined;
    act(() => {
      completion = view.result.current.submit(key!);
    });
    const pending = view.result.current.pending;
    view.rerender({
      context:
        transition === 'filter'
          ? journalContext({ projectQuery: { q: 'changed' } })
          : {
              status: 'inactive',
              reason: 'project-loading',
              onAuthRequired: vi.fn(),
            },
    });
    await act(async () => {
      late.reject(new ApiError('NETWORK_ERROR', 'offline', null, true));
      await completion;
    });
    expect(view.result.current.pending).toBe(pending);
    expect(view.result.current.writing).toBe(false);
    expect(view.result.current.uncertain).toBe(true);
    expect(view.result.current.mutationError).toMatch(/неизвестен/);
    if (transition === 'inactive') {
      await act(async () =>
        expect(await view.result.current.retry()).toBe(false),
      );
      view.rerender({ context: journalContext() });
      await waitFor(() =>
        expect(view.result.current.projectFeed?.phase).toBe('ready'),
      );
    }
    await act(async () => expect(await view.result.current.retry()).toBe(true));
    expect(write.mock.calls[1]).toEqual(write.mock.calls[0]);
    expect(view.result.current.getDraft(key!)).toBeUndefined();
  },
);
it('round1 filter change plus late success clears only the sent draft, refreshes current query and cancels old completion focus', async () => {
  const view = renderHook(
    ({ q }) => useJournal(journalContext({ projectQuery: { q } })),
    { initialProps: { q: '' } },
  );
  await waitFor(() =>
    expect(view.result.current.projectFeed?.phase).toBe('ready'),
  );
  let key: JournalDraftKey | null = null,
    other: JournalDraftKey | null = null;
  act(() => {
    key = view.result.current.openEdit(journal5, 5);
    other = view.result.current.openCreate(
      journal5.projectId,
      null,
      '2026-10-10',
    );
  });
  act(() => {
    view.result.current.changeDraft(key!, { body: 'Sent text' });
    view.result.current.changeDraft(other!, { body: 'Other text' });
  });
  const late = deferred<JournalMutation>();
  vi.spyOn(api, 'journalUpdate').mockReturnValueOnce(late.promise);
  let completion: Promise<boolean> | undefined;
  act(() => {
    completion = view.result.current.submit(key!);
  });
  vi.mocked(api.journalProject).mockResolvedValue({
    ...page5,
    journalRevision: 6,
    entries: [],
  });
  view.rerender({ q: 'new-filter' });
  await waitFor(() =>
    expect(view.result.current.projectFeed?.phase).toBe('no-match'),
  );
  let result: boolean | undefined;
  await act(async () => {
    late.resolve({
      journalContractVersion: 1,
      kind: 'saved',
      projectId: journal5.projectId,
      journalRevision: 6,
      entry: { ...journal5, body: 'Sent text' },
    });
    result = await completion;
  });
  expect(result).toBe(false);
  expect(view.result.current.pending).toBeNull();
  expect(view.result.current.uncertain).toBe(false);
  expect(view.result.current.getDraft(key!)).toBeUndefined();
  expect(view.result.current.getDraft(other!)?.body).toBe('Other text');
  expect(view.result.current.projectFeed?.scope.query).toEqual({
    q: 'new-filter',
  });
  expect(view.result.current.projectFeed?.page?.entries).toEqual([]);
});

it.each(['POST', 'PATCH', 'DELETE'] as const)(
  'unknown %s outcome survives admission429 until the frozen exact acknowledgement',
  async (method) => {
    const view = await setup();
    let key: JournalDraftKey | null = null;
    act(() => {
      if (method === 'POST') {
        key = view.result.current.openCreate(
          journal5.projectId,
          journal5.taskId,
          '2026-10-09',
        );
        view.result.current.changeDraft(key!, { body: 'Exact unknown body' });
      } else if (method === 'PATCH') {
        key = view.result.current.openEdit(journal5, 5);
        view.result.current.changeDraft(key!, { body: 'Exact unknown body' });
      } else view.result.current.askDelete(journal5, 5);
    });
    const write = vi
      .spyOn(
        api,
        method === 'POST'
          ? 'journalCreate'
          : method === 'PATCH'
            ? 'journalUpdate'
            : 'journalDelete',
      )
      .mockRejectedValueOnce(
        new ApiError('NETWORK_ERROR', 'offline', null, true),
      )
      .mockRejectedValueOnce(new ApiError('DEMO_RATE_LIMIT', 'limited', 429));
    await act(async () => {
      if (method === 'DELETE') await view.result.current.confirmDelete();
      else await view.result.current.submit(key!);
    });
    const original = structuredClone(view.result.current.pending);
    expect(original).not.toBeNull();
    await act(async () =>
      expect(await view.result.current.retry()).toBe(false),
    );
    expect(view.result.current.pending).toEqual(original);
    expect(view.result.current.uncertain).toBe(true);
    if (key) {
      act(() =>
        view.result.current.changeDraft(key!, { body: 'Must stay locked' }),
      );
      expect(view.result.current.getDraft(key)?.body).toBe(
        'Exact unknown body',
      );
    }
    write.mockResolvedValueOnce(
      method === 'DELETE'
        ? {
            journalContractVersion: 1,
            kind: 'deleted',
            projectId: journal5.projectId,
            journalRevision: 6,
            deletedEntryId: journal5.id,
          }
        : {
            journalContractVersion: 1,
            kind: 'saved',
            projectId: journal5.projectId,
            journalRevision: 6,
            entry: journal5,
          },
    );
    vi.mocked(api.journalProject).mockResolvedValue({
      ...page5,
      journalRevision: 9,
      entries: [],
    });
    await act(async () => expect(await view.result.current.retry()).toBe(true));
    expect(write.mock.calls).toHaveLength(3);
    expect(write.mock.calls[1]).toEqual(write.mock.calls[0]);
    expect(write.mock.calls[2]).toEqual(write.mock.calls[0]);
    expect(view.result.current.pending).toBeNull();
    expect(view.result.current.uncertain).toBe(false);
    expect(view.result.current.projectFeed?.page?.entries).toEqual([]);
  },
);

it('unknown update followed by definite409 unlocks explicit comparison and rebase', async () => {
  const view = await setup();
  let key: JournalDraftKey | null = null;
  act(() => {
    key = view.result.current.openEdit(journal5, 5);
    view.result.current.changeDraft(key!, { body: 'Own unresolved text' });
  });
  const write = vi
    .spyOn(api, 'journalUpdate')
    .mockRejectedValueOnce(new ApiError('NETWORK_ERROR', 'offline', null, true))
    .mockRejectedValueOnce(
      new ApiError('JOURNAL_REVISION_CONFLICT', 'conflict', 409),
    );
  await act(async () => view.result.current.submit(key!));
  await act(async () => view.result.current.retry());
  expect(write.mock.calls[1]).toEqual(write.mock.calls[0]);
  expect(view.result.current.pending).toBeNull();
  expect(view.result.current.uncertain).toBe(false);
  expect(view.result.current.getDraft(key!)?.baselineJournalRevision).toBe(5);
  await act(async () => view.result.current.showCurrent());
  act(() => view.result.current.acceptCurrent(key!, 'keep-own'));
  expect(view.result.current.getDraft(key!)).toMatchObject({
    body: 'Own unresolved text',
    baselineJournalRevision: 6,
  });
  write.mockResolvedValueOnce({
    journalContractVersion: 1,
    kind: 'saved',
    projectId: journal5.projectId,
    journalRevision: 7,
    entry: { ...journal5, body: 'Own unresolved text' },
  });
  await act(async () =>
    expect(await view.result.current.submit(key!)).toBe(true),
  );
  expect(write.mock.calls[2]?.[2].expectedJournalRevision).toBe(6);
  expect(write.mock.calls[2]?.[2].operationId).not.toBe(
    write.mock.calls[0]?.[2].operationId,
  );
});

it('unknown update followed by definite404 preserves only the removed copyable draft', async () => {
  const view = await setup();
  let key: JournalDraftKey | null = null;
  act(() => {
    key = view.result.current.openEdit(journal5, 5);
    view.result.current.changeDraft(key!, { body: 'Copy removed own text' });
  });
  const write = vi
    .spyOn(api, 'journalUpdate')
    .mockRejectedValueOnce(new ApiError('NETWORK_ERROR', 'offline', null, true))
    .mockRejectedValueOnce(new ApiError('NOT_FOUND', 'missing', 404));
  await act(async () => view.result.current.submit(key!));
  await act(async () => view.result.current.retry());
  expect(write.mock.calls[1]).toEqual(write.mock.calls[0]);
  expect(view.result.current.pending).toBeNull();
  expect(view.result.current.uncertain).toBe(false);
  expect(view.result.current.conflictRemoved).toBe(true);
  act(() => view.result.current.acceptCurrent(key!, 'keep-own'));
  await act(async () =>
    expect(await view.result.current.submit(key!)).toBe(false),
  );
  expect(write).toHaveBeenCalledTimes(2);
  expect(view.result.current.getDraft(key!)?.body).toBe(
    'Copy removed own text',
  );
});

it('rendered conflict replacement confirms before discarding own body/date or adopting baseline', async () => {
  const view = await setup();
  let key: JournalDraftKey | null = null;
  act(() => {
    key = view.result.current.openEdit(journal5, 5);
    view.result.current.changeDraft(key!, {
      body: 'Own nonempty revision5 draft',
      workDate: '2024-03-15',
    });
  });
  const write = vi
    .spyOn(api, 'journalUpdate')
    .mockRejectedValue(
      new ApiError('JOURNAL_REVISION_CONFLICT', 'conflict', 409),
    );
  await act(async () => view.result.current.submit(key!));
  await act(async () => view.result.current.showCurrent());
  const own = structuredClone(view.result.current.getDraft(key!));
  const current = view.result.current.conflictCurrent;
  const uuid = vi.spyOn(crypto, 'randomUUID');
  const confirm = vi.spyOn(window, 'confirm').mockReturnValue(false);
  const ui = render(
    <JournalConflict controller={view.result.current} draftKey={key!} />,
  );
  await userEvent.click(
    screen.getByRole('button', { name: 'Заменить черновик текущей записью' }),
  );
  expect(confirm).toHaveBeenCalledOnce();
  expect(view.result.current.getDraft(key!)).toEqual(own);
  expect(view.result.current.conflictCurrent).toBe(current);
  expect(view.result.current.activeConflictKey).toBe(key);
  expect(write).toHaveBeenCalledOnce();
  expect(uuid).not.toHaveBeenCalled();
  confirm.mockReturnValue(true);
  ui.rerender(
    <JournalConflict controller={view.result.current} draftKey={key!} />,
  );
  await userEvent.click(
    screen.getByRole('button', { name: 'Заменить черновик текущей записью' }),
  );
  expect(confirm).toHaveBeenCalledTimes(2);
  expect(view.result.current.getDraft(key!)).toMatchObject({
    body: read6.entry.body,
    workDate: read6.entry.workDate,
    baselineEntry: read6.entry,
    baselineJournalRevision: 6,
    dirty: false,
  });
  expect(view.result.current.activeConflictKey).toBeNull();
  expect(write).toHaveBeenCalledOnce();
  expect(uuid).not.toHaveBeenCalled();
  act(() =>
    view.result.current.changeDraft(key!, { body: 'Explicit follow-up' }),
  );
  write.mockResolvedValue({
    journalContractVersion: 1,
    kind: 'saved',
    projectId: journal5.projectId,
    journalRevision: 7,
    entry: { ...read6.entry, body: 'Explicit follow-up' },
  });
  await act(async () => view.result.current.submit(key!));
  expect(write.mock.calls[1]?.[2].expectedJournalRevision).toBe(6);
  expect(write.mock.calls[1]?.[2].operationId).not.toBe(
    write.mock.calls[0]?.[2].operationId,
  );
});

it.each(['POST', 'PATCH', 'DELETE'] as const)(
  'acknowledges %s independently from a failed subsequent task GET',
  async (method) => {
    const view = renderHook(() =>
      useJournal(journalContext({ taskId: journal5.taskId })),
    );
    await waitFor(() =>
      expect(view.result.current.taskFeed?.phase).toBe('ready'),
    );
    let key: JournalDraftKey | null = null;
    act(() => {
      key =
        method === 'POST'
          ? view.result.current.openCreate(
              journal5.projectId,
              journal5.taskId,
              '2026-10-09',
            )
          : view.result.current.openEdit(journal5, 5);
      if (method !== 'DELETE')
        view.result.current.changeDraft(key!, { body: 'Acknowledged text' });
      else view.result.current.askDelete(journal5, 5);
    });
    const ack: JournalMutation =
      method === 'DELETE'
        ? {
            journalContractVersion: 1,
            projectId: journal5.projectId,
            journalRevision: 6,
            kind: 'deleted',
            deletedEntryId: journal5.id,
          }
        : {
            journalContractVersion: 1,
            projectId: journal5.projectId,
            journalRevision: 6,
            kind: 'saved',
            entry: journal5,
          };
    const write =
      method === 'POST'
        ? vi.spyOn(api, 'journalCreate').mockResolvedValue(ack)
        : method === 'PATCH'
          ? vi.spyOn(api, 'journalUpdate').mockResolvedValue(ack)
          : vi.spyOn(api, 'journalDelete').mockResolvedValue(ack);
    vi.mocked(api.journalProject).mockResolvedValue({
      ...page5,
      journalRevision: 6,
    });
    vi.mocked(api.journalTask).mockRejectedValue(
      new ApiError('NETWORK_ERROR', 'synthetic read failure'),
    );
    await act(async () =>
      expect(
        await (method === 'DELETE'
          ? view.result.current.confirmDelete()
          : view.result.current.submit(key!)),
      ).toBe(true),
    );
    expect(view.result.current.pending).toBeNull();
    expect(view.result.current.uncertain).toBe(false);
    expect(view.result.current.mutationError).toBeNull();
    expect(view.result.current.lastWrite).toEqual({
      projectId: journal5.projectId,
      taskId: journal5.taskId,
      operationId: (method === 'POST'
        ? vi.mocked(api.journalCreate).mock.calls[0]?.[1]
        : method === 'PATCH'
          ? vi.mocked(api.journalUpdate).mock.calls[0]?.[2]
          : vi.mocked(api.journalDelete).mock.calls[0]?.[2]
      )?.operationId,
      result: method === 'DELETE' ? 'deleted' : 'saved',
    });
    expect(view.result.current.taskFeed?.phase).toBe('error');
    if (method !== 'DELETE')
      expect(view.result.current.getDraft(key!)).toBeUndefined();
    else expect(view.result.current.deleteConfirmation).toBeNull();
    await act(async () => view.result.current.refresh());
    expect(write).toHaveBeenCalledTimes(1);
    act(() => view.result.current.clearPrivateState());
    expect(view.result.current.lastWrite).toBeNull();
  },
);

it('an acknowledged operation cannot erase a newer draft created while its read is still pending', async () => {
  const view = await setup();
  let key: JournalDraftKey | null = null;
  act(() => {
    key = view.result.current.openCreate(
      journal5.projectId,
      journal5.taskId,
      '2026-10-09',
    );
  });
  act(() => view.result.current.changeDraft(key!, { body: 'Sent snapshot' }));
  vi.spyOn(api, 'journalCreate').mockResolvedValue({
    journalContractVersion: 1,
    projectId: journal5.projectId,
    journalRevision: 6,
    kind: 'saved',
    entry: journal5,
  });
  const read = deferred<typeof page5>();
  vi.mocked(api.journalProject).mockReturnValue(read.promise);
  let saving: Promise<boolean> | undefined;
  act(() => {
    saving = view.result.current.submit(key!);
  });
  await waitFor(() =>
    expect(view.result.current.lastWrite?.result).toBe('saved'),
  );
  expect(view.result.current.pending).toBeNull();
  expect(view.result.current.writing).toBe(false);
  act(() => {
    view.result.current.openCreate(
      journal5.projectId,
      journal5.taskId,
      '2026-10-09',
    );
  });
  act(() => view.result.current.changeDraft(key!, { body: 'New local draft' }));
  await act(async () => {
    read.resolve({ ...page5, journalRevision: 6 });
    await saving;
  });
  expect(view.result.current.getDraft(key!)?.body).toBe('New local draft');
});

it('401 after an acknowledged write clears the outcome and all private drafts', async () => {
  const view = await setup();
  let key: JournalDraftKey | null = null;
  act(() => {
    key = view.result.current.openEdit(journal5, 5);
  });
  vi.spyOn(api, 'journalUpdate').mockResolvedValue({
    journalContractVersion: 1,
    projectId: journal5.projectId,
    journalRevision: 6,
    kind: 'saved',
    entry: journal5,
  });
  vi.mocked(api.journalProject).mockResolvedValue({
    ...page5,
    journalRevision: 6,
  });
  await act(async () => view.result.current.submit(key!));
  expect(view.result.current.lastWrite?.result).toBe('saved');
  vi.mocked(api.journalProject).mockRejectedValue(
    new ApiError('AUTH_REQUIRED', 'synthetic expiry', 401),
  );
  await act(async () => view.result.current.refresh());
  expect(view.result.current.lastWrite).toBeNull();
  expect(view.result.current.notice).toBeNull();
  expect(view.result.current.drafts.size).toBe(0);
});
