// @vitest-environment jsdom
import { act, renderHook, waitFor, cleanup } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { api } from '../../src/client/api.js';
import {
  useJournal,
  type JournalContext,
} from '../../src/client/use-journal.js';
import { tree0, page5, deferred } from './journal-fixtures.js';
import type { JournalPage } from '../../src/shared/journal-contracts.js';
const inactive: JournalContext = {
  status: 'inactive',
  reason: 'project-loading',
  onAuthRequired: vi.fn(),
};
export const active = (tree = tree0): JournalContext => ({
  status: 'active',
  projectId: tree.project.id,
  taskId: null,
  today: '2026-10-09',
  projectQuery: {},
  planningTree: tree,
  planningDirty: false,
  planningUncertain: false,
  planningBusy: false,
  applyCleanTree: vi.fn(() => true),
  onAuthRequired: vi.fn(),
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});
it('gates all inactive operations while preserving drafts across projects and clears private state explicitly', async () => {
  const read = vi
    .spyOn(api, 'journalProject')
    .mockImplementation(async (id) => ({
      ...page5,
      projectId: id,
      entries: [],
    }));
  const write = vi.spyOn(api, 'journalCreate');
  const view = renderHook(
    ({ context }: { context: JournalContext }) => useJournal(context),
    { initialProps: { context: inactive as JournalContext } },
  );
  expect(read).not.toHaveBeenCalled();
  view.rerender({ context: active() });
  await waitFor(() =>
    expect(view.result.current.projectFeed?.page).not.toBeNull(),
  );
  let key: ReturnType<typeof view.result.current.openCreate> = null;
  act(() => {
    key = view.result.current.openCreate(
      tree0.project.id,
      tree0.tasks[0]!.id,
      '2026-10-09',
    );
  });
  if (!key) throw Error('key');
  const draftKey = key;
  act(() =>
    view.result.current.changeDraft(draftKey, { body: 'Synthetic A draft' }),
  );
  view.rerender({ context: inactive });
  expect(view.result.current.active).toBe(false);
  expect(view.result.current.projectFeed).toBeNull();
  await act(async () =>
    expect(await view.result.current.submit(draftKey)).toBe(false),
  );
  expect(write).not.toHaveBeenCalled();
  expect(view.result.current.getDraft(draftKey)?.body).toBe(
    'Synthetic A draft',
  );
  view.rerender({ context: active() });
  expect(view.result.current.getDraft(draftKey)?.body).toBe(
    'Synthetic A draft',
  );
  act(() => view.result.current.clearPrivateState());
  expect(view.result.current.drafts.size).toBe(0);
  expect(view.result.current.pending).toBeNull();
});
it('does not publish reads completing after inactivity/private reset', async () => {
  const late = deferred<JournalPage>();
  vi.spyOn(api, 'journalProject').mockReturnValue(late.promise);
  const view = renderHook(
    ({ context }: { context: JournalContext }) => useJournal(context),
    { initialProps: { context: active() } },
  );
  view.rerender({ context: inactive });
  act(() => view.result.current.clearPrivateState());
  await act(async () => late.resolve(page5));
  expect(view.result.current.projectFeed).toBeNull();
  expect(view.result.current.drafts.size).toBe(0);
});
import '@testing-library/jest-dom/vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { App } from '../../src/client/App.js';
import { ApiError } from '../../src/client/api.js';
import {
  journal5,
  mockJournalApp,
  journalContext,
} from './journal-fixtures.js';
import type { ProjectTree } from '../../src/shared/contracts.js';
it('late A tree cannot replace B metadata after a loading-null transition', async () => {
  const late = deferred<ProjectTree>();
  const other = {
    ...tree0,
    project: { ...tree0.project, id: '44444444-4444-4444-8444-444444444444' },
    tasks: tree0.tasks.map((task) => ({
      ...task,
      projectId: '44444444-4444-4444-8444-444444444444',
    })),
  };
  vi.spyOn(api, 'journalProject').mockImplementation(async (id) => ({
    ...page5,
    projectId: id,
    projectRevision: id === tree0.project.id ? 1 : 0,
    entries: [],
  }));
  vi.spyOn(api, 'tree').mockReturnValue(late.promise);
  const view = renderHook(
    ({ context }: { context: JournalContext }) => useJournal(context),
    { initialProps: { context: journalContext() as JournalContext } },
  );
  await waitFor(() => expect(api.tree).toHaveBeenCalled());
  view.rerender({ context: inactive });
  view.rerender({
    context: journalContext({
      projectId: other.project.id,
      planningTree: other,
    }),
  });
  await waitFor(() =>
    expect(view.result.current.projectFeed?.page?.projectId).toBe(
      other.project.id,
    ),
  );
  await act(async () =>
    late.resolve({ ...tree0, project: { ...tree0.project, revision: 1 } }),
  );
  expect(view.result.current.projectFeed?.metadata?.projectId).toBe(
    other.project.id,
  );
});
it('App no projects → create A → draft → loading B → B → A preserves RAM text; canceled logout preserves, confirmed logout clears', async () => {
  window.history.replaceState(null, '', '/');
  const server = mockJournalApp();
  server.projects = [];
  vi.mocked(api.session).mockResolvedValue({
    authenticated: false,
    setupRequired: false,
  });
  vi.spyOn(api, 'login').mockResolvedValue({
    authenticated: true,
    setupRequired: false,
  });
  vi.spyOn(api, 'createProject').mockImplementation(async (title) => {
    const project = {
      ...tree0.project,
      id: server.projects.length
        ? '44444444-4444-4444-8444-444444444444'
        : tree0.project.id,
      title,
    };
    server.projects.push(project);
    return project;
  });
  render(<App />);
  await screen.findByLabelText('Пароль');
  fireEvent.change(screen.getByLabelText('Пароль'), {
    target: { value: 'synthetic-password' },
  });
  await userEvent.click(screen.getByRole('button', { name: 'Войти' }));
  await screen.findByText('Создайте первый проект.');
  expect(api.journalProject).not.toHaveBeenCalled();
  await userEvent.click(screen.getByRole('button', { name: 'Новый проект' }));
  fireEvent.change(screen.getByLabelText('Название проекта'), {
    target: { value: 'Демо-проект' },
  });
  await userEvent.click(screen.getByRole('button', { name: 'Создать проект' }));
  await screen.findByRole('heading', { name: 'Демо-проект' });
  await userEvent.click(screen.getByRole('treeitem', { name: /Работа 1/ }));
  await userEvent.click(document.getElementById('tab-journal')!);
  fireEvent.change(await screen.findByLabelText('Текст записи'), {
    target: { value: 'Project A private draft' },
  });
  await userEvent.click(screen.getByRole('button', { name: 'Закрыть панель' }));
  const late = deferred<ProjectTree>();
  vi.mocked(api.tree).mockReturnValueOnce(late.promise);
  await userEvent.click(screen.getByRole('button', { name: 'Новый проект' }));
  fireEvent.change(screen.getByLabelText('Название проекта'), {
    target: { value: 'Synthetic B' },
  });
  await userEvent.click(screen.getByRole('button', { name: 'Создать проект' }));
  await waitFor(() =>
    expect(
      screen.queryByRole('heading', { name: 'Демо-проект' }),
    ).not.toBeInTheDocument(),
  );
  await act(async () =>
    late.resolve({ ...tree0, project: server.projects[1]!, tasks: [] }),
  );
  await screen.findByRole('heading', { name: 'Synthetic B' });
  expect(document.getElementById('project-tab-tasks')).toHaveAttribute(
    'aria-selected',
    'true',
  );
  await userEvent.click(screen.getByRole('button', { name: /Демо-проект/ }));
  await screen.findByRole('treeitem', { name: /Работа 1/ });
  await userEvent.click(screen.getByRole('treeitem', { name: /Работа 1/ }));
  await userEvent.click(document.getElementById('tab-journal')!);
  expect(await screen.findByLabelText('Текст записи')).toHaveValue(
    'Project A private draft',
  );
  await userEvent.click(screen.getByRole('button', { name: 'Закрыть панель' }));
  const confirm = vi.spyOn(window, 'confirm').mockReturnValue(false);
  await userEvent.click(screen.getByRole('button', { name: 'Выйти' }));
  expect(api.logout).not.toHaveBeenCalled();
  confirm.mockReturnValue(true);
  await userEvent.click(screen.getByRole('button', { name: 'Выйти' }));
  await screen.findByLabelText('Пароль');
  fireEvent.change(screen.getByLabelText('Пароль'), {
    target: { value: 'synthetic-password' },
  });
  await userEvent.click(screen.getByRole('button', { name: 'Войти' }));
  await screen.findByRole('treeitem', { name: /Работа 1/ });
  await userEvent.click(screen.getByRole('treeitem', { name: /Работа 1/ }));
  await userEvent.click(document.getElementById('tab-journal')!);
  expect(await screen.findByLabelText('Текст записи')).toHaveValue('');
  expect(api.journalCreate).not.toHaveBeenCalled();
});
it('authenticated journal401 clears all drafts and stale authenticated content before new login', async () => {
  window.history.replaceState(null, '', '/');
  mockJournalApp();
  vi.spyOn(api, 'login').mockResolvedValue({
    authenticated: true,
    setupRequired: false,
  });
  render(<App />);
  await screen.findByRole('treeitem', { name: /Работа 1/ });
  await userEvent.click(
    screen.getByRole('button', { name: 'Сроки новой задачи' }),
  );
  fireEvent.change(screen.getByRole('textbox', { name: /Длительность,/ }), {
    target: { value: '3' },
  });
  fireEvent.blur(screen.getByRole('textbox', { name: /Длительность,/ }));
  fireEvent.change(screen.getByRole('textbox', { name: /Длительность,/ }), {
    target: { value: '3e' },
  });
  await userEvent.keyboard('{Escape}');
  await userEvent.click(screen.getByRole('treeitem', { name: /Работа 1/ }));
  await userEvent.click(document.getElementById('tab-journal')!);
  fireEvent.change(await screen.findByLabelText('Текст записи'), {
    target: { value: 'Will be cleared on401' },
  });
  vi.mocked(api.journalProject).mockRejectedValueOnce(
    new ApiError('AUTH_REQUIRED', 'auth', 401),
  );
  await act(async () => window.dispatchEvent(new Event('focus')));
  await screen.findByLabelText('Пароль');
  expect(screen.queryByText(journal5.body)).not.toBeInTheDocument();
  fireEvent.change(screen.getByLabelText('Пароль'), {
    target: { value: 'synthetic-password' },
  });
  await userEvent.click(screen.getByRole('button', { name: 'Войти' }));
  await screen.findByRole('treeitem', { name: /Работа 1/ });
  await userEvent.click(
    screen.getByRole('button', { name: 'Сроки новой задачи' }),
  );
  expect(screen.getByRole('textbox', { name: /Длительность,/ })).toHaveValue(
    '1',
  );
  expect(screen.queryByText(/Длительность: Введите целое/)).toBeNull();
  await userEvent.keyboard('{Escape}');

  await userEvent.click(screen.getByRole('treeitem', { name: /Работа 1/ }));
  await userEvent.click(document.getElementById('tab-journal')!);
  expect(await screen.findByLabelText('Текст записи')).toHaveValue('');
});
import type {
  JournalEntryRead,
  JournalMutation,
} from '../../src/shared/journal-contracts.js';
it.each(['feed', 'metadata', 'write', 'entry'] as const)(
  'round1 same-session late401 from %s clears privacy after every read identity transition',
  async (source) => {
    for (const transition of ['filter', 'project', 'inactive'] as const) {
      const auth = vi.fn();
      const read = vi
        .spyOn(api, 'journalProject')
        .mockImplementation(async (id) => ({
          ...page5,
          projectId: id,
          entries: id === tree0.project.id ? [journal5] : [],
        }));
      vi.spyOn(api, 'journalTask').mockResolvedValue({
        ...page5,
        taskId: journal5.taskId,
      });
      const update = vi.spyOn(api, 'journalUpdate');
      const metadata = vi.spyOn(api, 'tree');
      const entryRead = vi.spyOn(api, 'journalEntry');
      const view = renderHook(
        ({ context }: { context: JournalContext }) => useJournal(context),
        {
          initialProps: {
            context: journalContext({ onAuthRequired: auth }) as JournalContext,
          },
        },
      );
      await waitFor(() =>
        expect(view.result.current.projectFeed?.phase).toBe('ready'),
      );
      let key: ReturnType<typeof view.result.current.openEdit> = null;
      act(() => {
        key = view.result.current.openEdit(journal5, 5);
      });
      act(() =>
        view.result.current.changeDraft(key!, {
          body: 'Same-session private draft',
        }),
      );
      const late = deferred<
        JournalPage | ProjectTree | JournalMutation | JournalEntryRead
      >();
      let completion: Promise<unknown> | undefined;
      if (source === 'write') {
        update.mockReturnValueOnce(late.promise as Promise<JournalMutation>);
        act(() => {
          completion = view.result.current.submit(key!);
        });
      } else if (source === 'entry') {
        update.mockRejectedValueOnce(
          new ApiError('JOURNAL_REVISION_CONFLICT', 'conflict', 409),
        );
        await act(async () => view.result.current.submit(key!));
        entryRead.mockReturnValueOnce(
          late.promise as Promise<JournalEntryRead>,
        );
        act(() => {
          completion = view.result.current.showCurrent();
        });
      } else {
        if (source === 'metadata') {
          read.mockResolvedValueOnce({ ...page5, projectRevision: 1 });
          metadata.mockReturnValueOnce(late.promise as Promise<ProjectTree>);
        } else read.mockReturnValueOnce(late.promise as Promise<JournalPage>);
        act(() => {
          completion = view.result.current.refresh();
        });
        if (source === 'metadata')
          await waitFor(() => expect(metadata).toHaveBeenCalledOnce());
      }
      const otherId = '44444444-4444-4444-8444-444444444444';
      view.rerender({
        context:
          transition === 'inactive'
            ? {
                status: 'inactive',
                reason: 'project-loading',
                onAuthRequired: auth,
              }
            : transition === 'filter'
              ? journalContext({
                  projectQuery: { q: 'changed' },
                  onAuthRequired: auth,
                })
              : journalContext({
                  projectId: otherId,
                  planningTree: {
                    ...tree0,
                    project: { ...tree0.project, id: otherId },
                    tasks: [],
                  },
                  onAuthRequired: auth,
                }),
      });
      await act(async () => {
        late.reject(new ApiError('AUTH_REQUIRED', 'auth', 401));
        await completion;
      });
      expect(auth, `${source}/${transition}`).toHaveBeenCalledOnce();
      expect(view.result.current.drafts.size).toBe(0);
      expect(view.result.current.pending).toBeNull();
      expect(view.result.current.projectFeed).toBeNull();
      view.unmount();
      vi.restoreAllMocks();
    }
  },
);
it.each(['feed', 'metadata', 'write', 'entry'] as const)(
  'round1 old cleared-session late401 from %s never logs out the new private session',
  async (source) => {
    const auth = vi.fn();
    const read = vi.spyOn(api, 'journalProject').mockResolvedValue(page5),
      update = vi.spyOn(api, 'journalUpdate'),
      metadata = vi.spyOn(api, 'tree'),
      entryRead = vi.spyOn(api, 'journalEntry');
    const view = renderHook(
      ({ context }: { context: JournalContext }) => useJournal(context),
      {
        initialProps: {
          context: journalContext({ onAuthRequired: auth }) as JournalContext,
        },
      },
    );
    await waitFor(() =>
      expect(view.result.current.projectFeed?.phase).toBe('ready'),
    );
    let key: ReturnType<typeof view.result.current.openEdit> = null;
    act(() => {
      key = view.result.current.openEdit(journal5, 5);
    });
    const late = deferred<
      JournalPage | ProjectTree | JournalMutation | JournalEntryRead
    >();
    let completion: Promise<unknown> | undefined;
    if (source === 'write') {
      update.mockReturnValueOnce(late.promise as Promise<JournalMutation>);
      act(() => {
        completion = view.result.current.submit(key!);
      });
    } else if (source === 'entry') {
      update.mockRejectedValueOnce(
        new ApiError('JOURNAL_REVISION_CONFLICT', 'conflict', 409),
      );
      await act(async () => view.result.current.submit(key!));
      entryRead.mockReturnValueOnce(late.promise as Promise<JournalEntryRead>);
      act(() => {
        completion = view.result.current.showCurrent();
      });
    } else {
      if (source === 'metadata') {
        read.mockResolvedValueOnce({ ...page5, projectRevision: 1 });
        metadata.mockReturnValueOnce(late.promise as Promise<ProjectTree>);
      } else read.mockReturnValueOnce(late.promise as Promise<JournalPage>);
      act(() => {
        completion = view.result.current.refresh();
      });
      if (source === 'metadata')
        await waitFor(() => expect(metadata).toHaveBeenCalledOnce());
    }
    act(() => view.result.current.clearPrivateState());
    view.rerender({
      context: {
        status: 'inactive',
        reason: 'signed-out',
        onAuthRequired: auth,
      },
    });
    view.rerender({ context: journalContext({ onAuthRequired: auth }) });
    await waitFor(() =>
      expect(view.result.current.projectFeed?.phase).toBe('ready'),
    );
    let newKey: ReturnType<typeof view.result.current.openCreate> = null;
    act(() => {
      newKey = view.result.current.openCreate(
        tree0.project.id,
        journal5.taskId,
        '2026-10-10',
      );
    });
    act(() =>
      view.result.current.changeDraft(newKey!, {
        body: 'New private session draft',
      }),
    );
    await act(async () => {
      late.reject(new ApiError('AUTH_REQUIRED', 'auth', 401));
      await completion;
    });
    expect(auth).not.toHaveBeenCalled();
    expect(view.result.current.getDraft(newKey!)?.body).toBe(
      'New private session draft',
    );
    expect(view.result.current.projectFeed?.page).toEqual(page5);
  },
);
