// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import {
  act,
  cleanup,
  fireEvent,
  render,
  renderHook,
  screen,
  waitFor,
  within,
} from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import userEvent from '@testing-library/user-event';
import { App } from '../../src/client/App.js';
import { useJournal } from '../../src/client/use-journal.js';
import { useProjectToday } from '../../src/client/use-project-today.js';
import { api } from '../../src/client/api.js';
import {
  journalContext,
  journal5,
  page5,
  mockJournalApp,
} from './journal-fixtures.js';
import type { JournalDraftKey } from '../../src/client/journal-state.js';
HTMLDialogElement.prototype.showModal = function () {
  this.setAttribute('open', '');
};
HTMLDialogElement.prototype.close = function () {
  this.removeAttribute('open');
};
beforeEach(() => {
  window.history.replaceState(null, '', '/');
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.useRealTimers();
  vi.unstubAllEnvs();
});
async function openProjectJournal() {
  await screen.findByRole('heading', { name: 'Демо-проект' });
  await userEvent.click(screen.getByRole('tab', { name: 'Журнал' }));
  await screen.findByText('Original synthetic text');
}
it('performs project create, task read, edit and single-entry delete through the shared controller', async () => {
  mockJournalApp();
  render(<App />);
  await openProjectJournal();
  await userEvent.click(
    screen.getByRole('button', { name: 'Добавить запись' }),
  );
  const dialog = screen.getByRole('region', { name: 'Новая запись журнала' });
  await userEvent.click(
    within(dialog).getByRole('button', { name: 'Выбрать задачу' }),
  );
  fireEvent.keyDown(within(dialog).getByRole('combobox'), { key: 'Enter' });
  fireEvent.change(within(dialog).getByLabelText('Текст записи'), {
    target: { value: '  <script>synthetic</script>\nЯ 🌿  ' },
  });
  await userEvent.click(
    within(dialog).getByRole('button', { name: 'Сохранить запись' }),
  );
  await waitFor(() =>
    expect(
      screen.queryByRole('region', { name: 'Новая запись журнала' }),
    ).not.toBeInTheDocument(),
  );
  expect(api.journalCreate).toHaveBeenCalledOnce();
  expect(vi.mocked(api.journalCreate).mock.calls[0]?.[1].body).toBe(
    '  <script>synthetic</script>\nЯ 🌿  ',
  );
  expect(document.querySelector('script')).toBeNull();
  await userEvent.click(
    screen.getAllByRole('button', { name: 'Работа 1' })[0]!,
  );
  await waitFor(() =>
    expect(document.getElementById('tab-journal')).toHaveAttribute(
      'aria-selected',
      'true',
    ),
  );
  const panel = document.getElementById('panel-journal')!;
  expect(
    within(panel).getByText('Original synthetic text'),
  ).toBeInTheDocument();
  expect(api.command).not.toHaveBeenCalled();
  await userEvent.click(screen.getByRole('button', { name: 'Закрыть панель' }));
  const feed = document.querySelector('[data-journal-feed="project"]')!;
  await userEvent.click(
    within(feed as HTMLElement).getByRole('button', {
      name: 'Действия записи 2024-02-29',
    }),
  );
  await userEvent.click(
    screen.getByRole('menuitem', { name: 'Редактировать запись' }),
  );
  fireEvent.change(screen.getByLabelText('Текст записи'), {
    target: { value: 'Edited synthetic body' },
  });
  fireEvent.keyDown(screen.getByLabelText('Текст записи'), {
    key: 'Enter',
    ctrlKey: true,
  });
  await waitFor(() => expect(api.journalUpdate).toHaveBeenCalledOnce());
  await waitFor(() =>
    expect(screen.queryByLabelText('Текст записи')).not.toBeInTheDocument(),
  );
  await userEvent.click(
    screen.getByRole('button', { name: 'Действия записи 2024-02-29' }),
  );
  await userEvent.click(
    screen.getByRole('menuitem', { name: 'Удалить запись' }),
  );
  await userEvent.click(
    screen.getByRole('button', { name: 'Подтвердить удаление записи' }),
  );
  await waitFor(() => expect(api.journalDelete).toHaveBeenCalledOnce());
  expect(api.command).not.toHaveBeenCalled();
});
it('composer Escape preserves its draft, restores trigger and leaves inline body styles untouched; period validation does not query', async () => {
  mockJournalApp();
  document.body.style.overflow = 'auto';
  document.body.style.paddingRight = '3px';
  render(<App />);
  await openProjectJournal();
  const add = screen.getByRole('button', { name: 'Добавить запись' });
  await userEvent.click(add);
  fireEvent.change(screen.getByLabelText('Текст записи'), {
    target: { value: 'Modal draft' },
  });
  expect(document.body.style.overflow).toBe('auto');
  fireEvent.keyDown(screen.getByLabelText('Текст записи'), { key: 'Escape' });
  await waitFor(() => expect(add).toHaveFocus());
  expect(document.body.style.overflow).toBe('auto');
  expect(document.body.style.paddingRight).toBe('3px');
  await userEvent.click(add);
  expect(screen.getByLabelText('Текст записи')).toHaveValue('Modal draft');
  fireEvent.keyDown(screen.getByLabelText('Текст записи'), { key: 'Escape' });
  await userEvent.click(
    screen.getByRole('button', { name: 'Период: Все даты' }),
  );
  fireEvent.change(screen.getByLabelText('С даты'), {
    target: { value: '2024-03-10' },
  });
  fireEvent.change(screen.getByLabelText('По дату'), {
    target: { value: '2024-03-01' },
  });
  const calls = vi.mocked(api.journalProject).mock.calls.length;
  await userEvent.click(screen.getByRole('button', { name: 'Применить' }));
  expect(screen.getByRole('alert')).toHaveTextContent('Проверьте период');
  expect(api.journalProject).toHaveBeenCalledTimes(calls);
});
it('J02 defaults task/modal dates in project Moscow, updates only untouched drafts across midnight and timezone change', async () => {
  vi.stubEnv('TZ', 'UTC');
  expect(Intl.DateTimeFormat().resolvedOptions().timeZone).toBe('UTC');
  vi.useFakeTimers();
  vi.setSystemTime(new Date('2026-10-08T22:30:00Z'));
  vi.spyOn(api, 'journalProject').mockResolvedValue(page5);
  vi.spyOn(api, 'journalCreate').mockResolvedValue({
    journalContractVersion: 1,
    kind: 'saved',
    projectId: journal5.projectId,
    journalRevision: 5,
    entry: journal5,
  });
  const view = renderHook(
    ({ zone }) => {
      const today = useProjectToday(zone);
      return { ...useJournal(journalContext({ today })), projectToday: today };
    },
    { initialProps: { zone: 'Europe/Moscow' } },
  );
  await act(async () => {});
  let taskKey: JournalDraftKey | null = null,
    modalKey: JournalDraftKey | null = null;
  act(() => {
    taskKey = view.result.current.openCreate(
      journal5.projectId,
      journal5.taskId,
      view.result.current.projectToday,
    );
    modalKey = view.result.current.openCreate(
      journal5.projectId,
      null,
      view.result.current.projectToday,
    );
  });
  expect(new Date().toISOString().slice(0, 10)).toBe('2026-10-08');
  expect(view.result.current.getDraft(taskKey!)?.workDate).toBe('2026-10-09');
  expect(view.result.current.getDraft(modalKey!)?.workDate).toBe('2026-10-09');
  await act(async () => {
    vi.setSystemTime(new Date('2026-10-09T22:30:00Z'));
    window.dispatchEvent(new Event('focus'));
  });
  expect(view.result.current.getDraft(taskKey!)?.workDate).toBe('2026-10-10');
  expect(view.result.current.getDraft(modalKey!)?.workDate).toBe('2026-10-10');
  view.rerender({ zone: 'UTC' });
  expect(view.result.current.getDraft(taskKey!)?.workDate).toBe('2026-10-09');
  act(() =>
    view.result.current.changeDraft(taskKey!, {
      body: 'submitted project date',
    }),
  );
  await act(async () => view.result.current.submit(taskKey!));
  expect(vi.mocked(api.journalCreate).mock.calls[0]?.[1].workDate).toBe(
    '2026-10-09',
  );
});
it.each([
  { fields: { workDate: '2024-02-29' }, date: '2024-02-29' },
  { fields: { body: 'dirty' }, date: '2026-10-09' },
  { fields: { workDate: '' }, date: '' },
])(
  'J02 never replaces touched, dirty or cleared date $date',
  async ({ fields, date }) => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-10-08T22:30:00Z'));
    vi.spyOn(api, 'journalProject').mockResolvedValue(page5);
    const view = renderHook(
      ({ zone }) => {
        const today = useProjectToday(zone);
        return {
          ...useJournal(journalContext({ today })),
          projectToday: today,
        };
      },
      { initialProps: { zone: 'Europe/Moscow' } },
    );
    await act(async () => {});
    let key: JournalDraftKey | null = null;
    act(() => {
      key = view.result.current.openCreate(
        journal5.projectId,
        journal5.taskId,
        view.result.current.projectToday,
      );
    });
    act(() => view.result.current.changeDraft(key!, fields));
    await act(async () => {
      vi.setSystemTime(new Date('2026-10-09T22:30:00Z'));
      document.dispatchEvent(new Event('visibilitychange'));
    });
    expect(view.result.current.getDraft(key!)?.workDate).toBe(date);
    view.rerender({ zone: 'UTC' });
    expect(view.result.current.getDraft(key!)?.workDate).toBe(date);
    if (date === '')
      await act(async () =>
        expect(await view.result.current.submit(key!)).toBe(false),
      );
    act(() => view.result.current.clearDraft(key!));
    act(() => {
      key = view.result.current.openCreate(
        journal5.projectId,
        journal5.taskId,
        view.result.current.projectToday,
      );
    });
    expect(view.result.current.getDraft(key!)?.workDate).toBe('2026-10-09');
  },
);
it('filtered success preserves search and announces exclusion without plan writes', async () => {
  mockJournalApp();
  render(<App />);
  await openProjectJournal();
  fireEvent.change(screen.getByLabelText('Поиск записей'), {
    target: { value: 'Original' },
  });
  await waitFor(() =>
    expect(api.journalProject).toHaveBeenLastCalledWith(journal5.projectId, {
      q: 'Original',
    }),
  );
  await userEvent.click(
    screen.getByRole('button', { name: 'Добавить запись' }),
  );
  await userEvent.click(screen.getByRole('button', { name: 'Выбрать задачу' }));
  fireEvent.keyDown(screen.getByRole('combobox'), { key: 'Enter' });
  fireEvent.change(screen.getByLabelText('Текст записи'), {
    target: { value: 'Different synthetic text' },
  });
  await userEvent.click(
    screen.getByRole('button', { name: 'Сохранить запись' }),
  );
  await screen.findByText('Запись сохранена; она не подходит под фильтр');
  expect(screen.getByLabelText('Поиск записей')).toHaveValue('Original');
  expect(api.command).not.toHaveBeenCalled();
});
import { JournalFeed } from '../../src/client/JournalFeed.js';
import { JournalTaskPicker } from '../../src/client/JournalTaskPicker.js';
import type { JournalFeedState } from '../../src/client/journal-state.js';
import { task, project } from './fixtures.js';
it.each([
  ['empty', 'Записей пока нет'],
  ['no-match', 'Нет записей по выбранным условиям'],
  ['loading', 'Загрузка журнала…'],
  ['error', 'Synthetic safe error'],
  ['metadata-error', 'Synthetic safe error'],
  ['stale', 'Synthetic safe error'],
  ['more-error', 'Synthetic safe error'],
] as const)(
  'renders the distinct %s state and only coherent links',
  (phase, label) => {
    const state: JournalFeedState = {
      scope: { projectId: project.id, taskId: null, query: {} },
      page: phase === 'stale' || phase === 'more-error' ? page5 : null,
      metadata:
        phase === 'stale' || phase === 'more-error'
          ? { projectId: project.id, revision: 0, tasks: [task(1)] }
          : null,
      pendingPage: null,
      phase,
      error: ['error', 'metadata-error', 'stale', 'more-error'].includes(phase)
        ? 'Synthetic safe error'
        : null,
    };
    function Fixture() {
      const controller = useJournal({
        status: 'inactive',
        reason: 'signed-out',
        onAuthRequired: () => {},
      });
      return (
        <JournalFeed
          state={state}
          controller={controller}
          onOpenTask={() => {}}
          showTaskTitles
        />
      );
    }
    render(<Fixture />);
    expect(screen.getByText(label)).toBeInTheDocument();
    if (phase === 'stale')
      expect(screen.getByRole('button', { name: 'Работа 1' })).toBeDisabled();
  },
);
it('picker includes summary/done/undated with unique full paths and keyboard Escape/Enter isolation', async () => {
  const change = vi.fn();
  render(
    <JournalTaskPicker
      metadata={{
        projectId: project.id,
        revision: 0,
        tasks: [
          task(1, { title: 'Root' }),
          task(2, { title: 'Same', parentId: task(1).id, status: 'done' }),
          task(3, { title: 'Same' }),
        ],
      }}
      value={null}
      onChange={change}
      disabled={false}
    />,
  );
  const trigger = screen.getByRole('button', { name: 'Выбрать задачу' });
  await userEvent.click(trigger);
  expect(
    screen.getByRole('option', { name: 'Root / Same' }),
  ).toBeInTheDocument();
  expect(screen.getByRole('option', { name: 'Same' })).toBeInTheDocument();
  fireEvent.change(screen.getByRole('combobox'), {
    target: { value: 'Root /' },
  });
  fireEvent.keyDown(screen.getByRole('combobox'), { key: 'Enter' });
  expect(change).toHaveBeenCalledWith(task(2).id);
  expect(trigger).toHaveFocus();
  await userEvent.click(trigger);
  fireEvent.keyDown(screen.getByRole('combobox'), { key: 'Escape' });
  expect(trigger).toHaveFocus();
});
it('project empty task set disables add with explanation', async () => {
  const server = mockJournalApp();
  server.tree.tasks = [];
  server.entries = [];
  render(<App />);
  await screen.findByRole('heading', { name: 'Демо-проект' });
  await userEvent.click(document.getElementById('project-tab-journal')!);
  expect(
    await screen.findByText('Сначала создайте задачу, чтобы добавить запись.'),
  ).toBeVisible();
  expect(
    screen.getByRole('button', { name: 'Добавить запись' }),
  ).toBeDisabled();
});
it('project composer clear confirmation preserves draft on Cancel and requires no plan command', async () => {
  mockJournalApp();
  vi.spyOn(window, 'confirm').mockReturnValue(false);
  render(<App />);
  await openProjectJournal();
  await userEvent.click(
    screen.getByRole('button', { name: 'Добавить запись' }),
  );
  const dialog = screen.getByRole('region', { name: 'Новая запись журнала' });
  fireEvent.change(screen.getByLabelText('Текст записи'), {
    target: { value: 'Keep text' },
  });
  await userEvent.click(
    within(dialog).getByRole('button', { name: 'Очистить черновик' }),
  );
  expect(window.confirm).toHaveBeenCalledWith('Очистить черновик записи?');
  expect(screen.getByLabelText('Текст записи')).toHaveValue('Keep text');
  const unload = new Event('beforeunload', { cancelable: true });
  window.dispatchEvent(unload);
  expect(unload.defaultPrevented).toBe(true);
  expect(api.command).not.toHaveBeenCalled();
});
import { ApiError } from '../../src/client/api.js';
it('exact retry of a project composer save leaves body styles untouched and returns add focus', async () => {
  mockJournalApp();
  vi.mocked(api.journalCreate).mockRejectedValueOnce(
    new ApiError('NETWORK_ERROR', 'offline', null, true),
  );
  document.body.style.overflow = 'auto';
  render(<App />);
  await openProjectJournal();
  const add = screen.getByRole('button', { name: 'Добавить запись' });
  await userEvent.click(add);
  await userEvent.click(screen.getByRole('button', { name: 'Выбрать задачу' }));
  fireEvent.keyDown(screen.getByRole('combobox'), { key: 'Enter' });
  fireEvent.change(screen.getByLabelText('Текст записи'), {
    target: { value: 'Exact modal retry' },
  });
  await userEvent.click(
    screen.getByRole('button', { name: 'Сохранить запись' }),
  );
  await userEvent.click(
    await screen.findByRole('button', { name: 'Повторить сохранение' }),
  );
  await waitFor(() =>
    expect(
      screen.queryByRole('region', { name: 'Новая запись журнала' }),
    ).not.toBeInTheDocument(),
  );
  expect(document.body.style.overflow).toBe('auto');
  await waitFor(() => expect(add).toHaveFocus());
  expect(vi.mocked(api.journalCreate).mock.calls[1]).toEqual(
    vi.mocked(api.journalCreate).mock.calls[0],
  );
});
import type { JournalMutation } from '../../src/shared/journal-contracts.js';
import { deferred } from './journal-fixtures.js';
it.each(['composer', 'inline', 'orphan'] as const)(
  'round1 pending %s editor cannot close and hide its only retry control',
  async (kind) => {
    const server = mockJournalApp();
    render(<App />);
    await openProjectJournal();
    const add = screen.getByRole('button', { name: 'Добавить запись' });
    if (kind === 'composer') {
      vi.mocked(api.journalCreate).mockRejectedValueOnce(
        new ApiError('NETWORK_ERROR', 'offline', null, true),
      );
      await userEvent.click(add);
      await userEvent.click(
        screen.getByRole('button', { name: 'Выбрать задачу' }),
      );
      fireEvent.keyDown(screen.getByRole('combobox'), { key: 'Enter' });
    } else {
      vi.mocked(api.journalUpdate).mockRejectedValueOnce(
        new ApiError('NETWORK_ERROR', 'offline', null, true),
      );
      await userEvent.click(
        screen.getByRole('button', { name: 'Действия записи 2024-02-29' }),
      );
      await userEvent.click(
        screen.getByRole('menuitem', { name: 'Редактировать запись' }),
      );
    }
    fireEvent.change(screen.getByLabelText('Текст записи'), {
      target: { value: 'Retain pending editor' },
    });
    await userEvent.click(
      screen.getByRole('button', { name: 'Сохранить запись' }),
    );
    await screen.findByRole('button', { name: 'Повторить сохранение' });
    if (kind === 'orphan') {
      server.entries = [];
      await act(async () => window.dispatchEvent(new Event('focus')));
      await screen.findByText(
        'Запись отсутствует в текущей ленте. Черновик сохранён.',
      );
    }
    const close = screen.getByRole('button', { name: 'Закрыть редактор' });
    await userEvent.click(close);
    expect(
      screen.getByRole('button', { name: 'Повторить сохранение' }),
    ).toBeVisible();
    expect(close).toBeDisabled();
    fireEvent.keyDown(screen.getByLabelText('Текст записи'), { key: 'Escape' });
    expect(
      screen.getByRole('button', { name: 'Повторить сохранение' }),
    ).toBeVisible();
    await userEvent.click(
      screen.getByRole('button', { name: 'Повторить сохранение' }),
    );
    await waitFor(() =>
      expect(
        screen.queryByRole('button', { name: 'Повторить сохранение' }),
      ).not.toBeInTheDocument(),
    );
    if (kind === 'composer') {
      await waitFor(() =>
        expect(
          screen.queryByRole('region', { name: 'Новая запись журнала' }),
        ).not.toBeInTheDocument(),
      );
      expect(document.body.style.overflow).not.toBe('hidden');
    }
  },
);
it('round1 rendered task editor retains recovery when header search changes before lost write response', async () => {
  mockJournalApp();
  const late = deferred<JournalMutation>();
  vi.mocked(api.journalCreate).mockReturnValueOnce(late.promise);
  render(<App />);
  await openProjectJournal();
  await userEvent.click(screen.getByRole('button', { name: 'Работа 1' }));
  fireEvent.change(await screen.findByLabelText('Текст записи'), {
    target: { value: 'Lost task editor write' },
  });
  await userEvent.click(
    screen.getByRole('button', { name: 'Сохранить запись' }),
  );
  const sent = vi.mocked(api.journalCreate).mock.calls[0];
  fireEvent.change(screen.getByLabelText('Поиск записей'), {
    target: { value: 'changed-search' },
  });
  await act(async () =>
    late.reject(new ApiError('NETWORK_ERROR', 'offline', null, true)),
  );
  expect(
    await screen.findByRole('button', { name: 'Повторить сохранение' }),
  ).toBeVisible();
  await userEvent.click(screen.getByRole('button', { name: 'Закрыть панель' }));
  expect(
    screen.getByRole('button', { name: 'Повторить сохранение' }),
  ).toBeVisible();
  await userEvent.click(
    screen.getByRole('button', { name: 'Повторить сохранение' }),
  );
  await waitFor(() => expect(api.journalCreate).toHaveBeenCalledTimes(2));
  expect(vi.mocked(api.journalCreate).mock.calls[1]).toEqual(sent);
});
import { ProjectJournal } from '../../src/client/ProjectJournal.js';
import { TaskJournal } from '../../src/client/TaskJournal.js';
import type { JournalContext } from '../../src/client/use-journal.js';
import { tree0 } from './journal-fixtures.js';
it.each(['composer', 'inline', 'task'] as const)(
  'round1 %s editor recovers exact retry after inactive unmount and reentry',
  async (kind) => {
    mockJournalApp();
    const late = deferred<JournalMutation>();
    const write =
      kind === 'inline'
        ? vi.mocked(api.journalUpdate)
        : vi.mocked(api.journalCreate);
    write.mockReturnValueOnce(late.promise);
    function Harness({ context }: { context: JournalContext }) {
      const controller = useJournal(context);
      return context.status === 'inactive' ? (
        <p>Inactive</p>
      ) : kind === 'task' ? (
        <TaskJournal
          controller={controller}
          task={tree0.tasks[0]!}
          today="2026-10-10"
        />
      ) : (
        <ProjectJournal
          controller={controller}
          projectId={journal5.projectId}
          today="2026-10-10"
          query={{}}
          onQuery={() => {}}
          onOpenTask={() => {}}
        />
      );
    }
    const context = journalContext({
      taskId: kind === 'task' ? journal5.taskId : null,
    });
    const view = render(<Harness context={context} />);
    await screen.findByText('Original synthetic text');
    if (kind === 'composer') {
      await userEvent.click(
        screen.getByRole('button', { name: 'Добавить запись' }),
      );
      await userEvent.click(
        screen.getByRole('button', { name: 'Выбрать задачу' }),
      );
      fireEvent.keyDown(screen.getByRole('combobox'), { key: 'Enter' });
    }
    if (kind === 'inline') {
      await userEvent.click(
        screen.getByRole('button', { name: 'Действия записи 2024-02-29' }),
      );
      await userEvent.click(
        screen.getByRole('menuitem', { name: 'Редактировать запись' }),
      );
    }
    fireEvent.change(screen.getByLabelText('Текст записи'), {
      target: { value: 'Recovery after reentry' },
    });
    await userEvent.click(
      screen.getByRole('button', { name: 'Сохранить запись' }),
    );
    const sent = write.mock.calls[0];
    view.rerender(
      <Harness
        context={{
          status: 'inactive',
          reason: 'project-loading',
          onAuthRequired: vi.fn(),
        }}
      />,
    );
    await act(async () =>
      late.reject(new ApiError('NETWORK_ERROR', 'offline', null, true)),
    );
    view.rerender(<Harness context={context} />);
    expect(
      await screen.findByRole('button', { name: 'Повторить сохранение' }),
    ).toBeVisible();
    await userEvent.click(
      screen.getByRole('button', { name: 'Повторить сохранение' }),
    );
    await waitFor(() => expect(write).toHaveBeenCalledTimes(2));
    expect(write.mock.calls[1]).toEqual(sent);
    await waitFor(() =>
      expect(
        screen.queryByRole('button', { name: 'Повторить сохранение' }),
      ).not.toBeInTheDocument(),
    );
  },
);
it('round1 filter superseded successful composer save leaves body styles untouched without an obsolete completion focus', async () => {
  mockJournalApp();
  const late = deferred<JournalMutation>();
  vi.mocked(api.journalCreate).mockReturnValueOnce(late.promise);
  function Harness({ q }: { q: string }) {
    const controller = useJournal(journalContext({ projectQuery: { q } }));
    return (
      <>
        <button>Current filter focus</button>
        <ProjectJournal
          controller={controller}
          projectId={journal5.projectId}
          today="2026-10-10"
          query={{ q }}
          onQuery={() => {}}
          onOpenTask={() => {}}
        />
      </>
    );
  }
  document.body.style.overflow = 'auto';
  const view = render(<Harness q="" />);
  await screen.findByText('Original synthetic text');
  await userEvent.click(
    screen.getByRole('button', { name: 'Добавить запись' }),
  );
  await userEvent.click(screen.getByRole('button', { name: 'Выбрать задачу' }));
  fireEvent.keyDown(screen.getByRole('combobox'), { key: 'Enter' });
  fireEvent.change(screen.getByLabelText('Текст записи'), {
    target: { value: 'Late modal success' },
  });
  await userEvent.click(
    screen.getByRole('button', { name: 'Сохранить запись' }),
  );
  vi.mocked(api.journalProject).mockResolvedValue({
    ...page5,
    journalRevision: 6,
    entries: [],
  });
  view.rerender(<Harness q="new-filter" />);
  const currentFocus = screen.getByRole('button', {
    name: 'Current filter focus',
  });
  currentFocus.focus();
  await act(async () =>
    late.resolve({
      journalContractVersion: 1,
      kind: 'saved',
      projectId: journal5.projectId,
      journalRevision: 6,
      entry: journal5,
    }),
  );
  await waitFor(() =>
    expect(
      screen.queryByRole('region', { name: 'Новая запись журнала' }),
    ).not.toBeInTheDocument(),
  );
  expect(document.body.style.overflow).toBe('auto');
  expect(currentFocus).toHaveFocus();
  await userEvent.click(
    screen.getByRole('button', { name: 'Добавить запись' }),
  );
  expect(
    screen.getByRole('region', { name: 'Новая запись журнала' }),
  ).toBeVisible();
  fireEvent.keyDown(screen.getByLabelText('Текст записи'), { key: 'Escape' });
  await waitFor(() =>
    expect(
      screen.queryByRole('region', { name: 'Новая запись журнала' }),
    ).not.toBeInTheDocument(),
  );
});

it.each([false, true])(
  'successful composer save waits for its enabled trigger and respects later focus=%s',
  async (laterFocus) => {
    const server = mockJournalApp();
    render(<App />);
    await openProjectJournal();
    const add = screen.getByRole('button', { name: 'Добавить запись' });
    await userEvent.click(add);
    const dialog = screen.getByRole('region', { name: 'Новая запись журнала' });
    await userEvent.click(
      within(dialog).getByRole('button', { name: 'Выбрать задачу' }),
    );
    fireEvent.keyDown(within(dialog).getByRole('combobox'), { key: 'Enter' });
    fireEvent.change(within(dialog).getByLabelText('Текст записи'), {
      target: { value: 'Delayed refresh note' },
    });
    let resolve!: (value: typeof page5) => void;
    const refresh = new Promise<typeof page5>((yes) => {
      resolve = yes;
    });
    vi.mocked(api.journalProject).mockImplementationOnce(() => refresh);
    await userEvent.click(
      within(dialog).getByRole('button', { name: 'Сохранить запись' }),
    );
    await waitFor(() => expect(add).toBeDisabled());
    // A frame may run before React commits the disabled→enabled trigger render.
    vi.spyOn(window, 'requestAnimationFrame').mockImplementation((callback) => {
      callback(0);
      return 0;
    });
    document.body.focus();
    const search = screen.getByLabelText('Поиск записей');
    if (laterFocus) search.focus();
    await act(async () => {
      resolve({
        ...page5,
        journalRevision: server.revision,
        entries: server.entries,
      });
    });
    await waitFor(() => expect(add).toBeEnabled());
    await waitFor(() => expect(laterFocus ? search : add).toHaveFocus());
  },
);
