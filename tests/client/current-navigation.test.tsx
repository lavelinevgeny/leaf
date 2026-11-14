// @vitest-environment jsdom
import {
  changeJournalField,
  expectJournalFieldValue,
} from './journal-editor-helpers.js';
import '@testing-library/jest-dom/vitest';
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { App } from '../../src/client/App.js';
import { api, ApiError } from '../../src/client/api.js';
import { deferred, mockJournalApp } from './journal-fixtures.js';
import { task, emptySchedule } from './fixtures.js';
// jsdom omits native scrolling; actual geometry is covered by browser tests.
HTMLElement.prototype.scrollIntoView = function () {};
HTMLDialogElement.prototype.showModal = function () {
  this.setAttribute('open', '');
};
HTMLDialogElement.prototype.close = function () {
  this.removeAttribute('open');
};
beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date('2026-11-06T12:00:00Z'));
  window.history.replaceState(null, '', '/');
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.useRealTimers();
  window.history.replaceState(null, '', '/');
});
const current = () => within(document.getElementById('project-view-current')!);
async function start() {
  const server = mockJournalApp();
  server.tree.tasks = [
    task(1, { inputFinish: '2026-11-06' }),
    task(2, { inputFinish: '2026-11-12' }),
  ];
  window.history.replaceState(
    null,
    '',
    `?project=${server.tree.project.id}&view=current`,
  );
  render(<App />);
  await screen.findByRole('tab', { name: 'Актуальное', selected: true });
  return server;
}
it('opens a direct current link and the existing details panel; close returns to its source row', async () => {
  await start();
  const row = current().getByRole('button', { name: /Работа 1/ });
  await userEvent.click(row);
  expect(document.getElementById('tab-details')).toHaveAttribute(
    'aria-selected',
    'true',
  );
  await userEvent.click(screen.getByRole('button', { name: 'Закрыть панель' }));
  expect(row).toHaveFocus();
});
it('preserves mounted details drafts and collapse across three tabs without a leave dialog', async () => {
  await start();
  await userEvent.click(current().getByRole('button', { name: 'Позже 1' }));
  await userEvent.click(current().getByRole('button', { name: /Работа 1/ }));
  await userEvent.click(
    screen.getByRole('button', { name: 'Изменить название' }),
  );
  const input = screen.getByLabelText('Название задачи');
  changeJournalField(input, { target: { value: 'Мой черновик' } });
  for (const id of ['journal', 'tasks', 'current'])
    await userEvent.click(document.getElementById(`project-tab-${id}`)!);
  expect(screen.getByLabelText('Название задачи')).toBe(input);
  expectJournalFieldValue(input, 'Мой черновик');
  expect(
    screen.queryByRole('dialog', { name: /Несохранённые/ }),
  ).not.toBeInTheDocument();
  expect(current().getByRole('button', { name: 'Позже 1' })).toHaveAttribute(
    'aria-expanded',
    'true',
  );
  expect(api.command).not.toHaveBeenCalled();
});
it('keeps current rows on the acknowledged snapshot while a panel save is pending and blocks pointer and keyboard view focus', async () => {
  const server = await start();
  await userEvent.click(current().getByRole('button', { name: /Работа 1/ }));
  await userEvent.click(
    screen.getByRole('button', { name: 'Изменить название' }),
  );
  changeJournalField(screen.getByLabelText('Название задачи'), {
    target: { value: 'После ack' },
  });
  const result = deferred<typeof server.tree>();
  vi.mocked(api.command).mockReturnValue(result.promise);
  await userEvent.click(screen.getByRole('button', { name: 'Сохранить' }));
  expect(current().getByRole('button', { name: /Работа 1/ })).toBeVisible();
  const beforeFocus = document.activeElement;
  const beforeUrl = window.location.href;
  await userEvent.click(document.getElementById('project-tab-tasks')!);
  expect(document.activeElement).toBe(beforeFocus);
  expect(window.location.href).toBe(beforeUrl);
  expect(document.getElementById('project-tab-current')).toHaveAttribute(
    'aria-selected',
    'true',
  );
  fireEvent.keyDown(document.getElementById('project-tab-current')!, {
    key: 'ArrowRight',
  });
  expect(document.activeElement).toBe(beforeFocus);
  await act(async () =>
    result.resolve({
      ...server.tree,
      project: { ...server.tree.project, revision: 1 },
      tasks: [
        task(1, { title: 'После ack', inputFinish: '2026-11-06' }),
        server.tree.tasks[1]!,
      ],
    }),
  );
  await waitFor(() =>
    expect(current().getByRole('button', { name: /После ack/ })).toBeVisible(),
  );
});

async function editTitle(value = 'Мой черновик') {
  await userEvent.click(
    screen.getByRole('button', { name: 'Изменить название' }),
  );
  changeJournalField(screen.getByLabelText('Название задачи'), {
    target: { value },
  });
}
async function travel(direction: 'back' | 'forward') {
  await act(async () => {
    await new Promise<void>((resolve) => {
      window.addEventListener('popstate', () => resolve(), { once: true });
      window.history[direction]();
    });
  });
}
it('searches current titles independently, reveals collapsed results and restores disclosure on clear', async () => {
  await start();
  const search = screen.getByRole('searchbox', { name: 'Поиск задач' });
  expect(
    screen.queryByRole('button', { name: 'Фильтры' }),
  ).not.toBeInTheDocument();
  await userEvent.type(search, '  РАБОТА 2  ');
  expect(
    current().queryByRole('button', { name: /Работа 1/ }),
  ).not.toBeInTheDocument();
  expect(current().getByRole('button', { name: /Работа 2/ })).toBeVisible();
  expect(current().getByRole('button', { name: 'Сегодня 0' })).toBeVisible();
  await userEvent.click(current().getByRole('button', { name: 'Позже 1' }));
  expect(
    current().queryByRole('button', { name: /Работа 2/ }),
  ).not.toBeInTheDocument();
  await userEvent.click(screen.getByRole('button', { name: 'Очистить поиск' }));
  expect(search).toHaveFocus();
  expectJournalFieldValue(search, '');
  expect(current().getByRole('button', { name: 'Позже 1' })).toHaveAttribute(
    'aria-expanded',
    'false',
  );
  expect(current().getByRole('button', { name: /Работа 1/ })).toBeVisible();
  await userEvent.type(search, 'Ничего такого');
  expect(current().getByRole('status')).toHaveTextContent('Нет совпадений');
  await userEvent.keyboard('{Escape}');
  expectJournalFieldValue(search, '');
  expect(search).toHaveFocus();
  expect(api.command).not.toHaveBeenCalled();
});

it('preserves separate current and Gantt queries across tabs and browser history', async () => {
  await start();
  await userEvent.type(
    screen.getByRole('searchbox', { name: 'Поиск задач' }),
    'Работа 2',
  );
  await userEvent.click(document.getElementById('project-tab-tasks')!);
  expectJournalFieldValue(
    screen.getByRole('searchbox', { name: 'Поиск задач' }),
    '',
  );
  await userEvent.type(
    screen.getByRole('searchbox', { name: 'Поиск задач' }),
    'Работа 1',
  );
  await userEvent.click(document.getElementById('project-tab-current')!);
  expectJournalFieldValue(
    screen.getByRole('searchbox', { name: 'Поиск задач' }),
    'Работа 2',
  );
  await userEvent.click(current().getByRole('button', { name: /Работа 2/ }));
  await travel('back');
  expectJournalFieldValue(
    screen.getByRole('searchbox', { name: 'Поиск задач' }),
    'Работа 2',
  );
  await travel('back');
  expectJournalFieldValue(
    screen.getByRole('searchbox', { name: 'Поиск задач' }),
    'Работа 1',
  );
  await travel('forward');
  expectJournalFieldValue(
    screen.getByRole('searchbox', { name: 'Поиск задач' }),
    'Работа 2',
  );
  expect(current().getByRole('button', { name: /Работа 2/ })).toBeVisible();
  expect(window.location.search).not.toContain('Работа');
});

it('searches only unfinished leaf titles while retaining complete parent paths', async () => {
  const server = mockJournalApp();
  server.tree.tasks = [
    task(1, { title: 'Найти группу' }),
    task(2, { title: 'Найти лист', parentId: task(1).id }),
    task(3, { title: 'Другой лист', parentId: task(1).id }),
    task(4, { title: 'Найти завершённое', status: 'done' }),
  ];
  window.history.replaceState(
    null,
    '',
    `?project=${server.tree.project.id}&view=current`,
  );
  render(<App />);
  await screen.findByRole('tab', { name: 'Актуальное', selected: true });
  await userEvent.type(
    screen.getByRole('searchbox', { name: 'Поиск задач' }),
    'НАЙТИ',
  );
  expect(
    current().getByRole('button', { name: 'Без окончания 1' }),
  ).toBeVisible();
  expect(
    current().getByRole('button', { name: /Найти лист.*Найти группу/ }),
  ).toBeVisible();
  expect(current().queryByText('Другой лист')).not.toBeInTheDocument();
  expect(current().queryByText('Найти завершённое')).not.toBeInTheDocument();
});
it.each(['done', 'summary', 'missing', 'dependencies'] as const)(
  'direct current link handles %s without inventing a row; close focuses the current tab',
  async (kind) => {
    const server = mockJournalApp();
    server.tree.tasks = [
      task(1, { status: kind === 'done' ? 'done' : 'todo' }),
    ];
    if (kind === 'summary')
      server.tree.tasks.push(task(2, { parentId: task(1).id }));
    window.history.replaceState(
      null,
      '',
      `?project=${server.tree.project.id}&view=current&task=${task(kind === 'missing' ? 99 : 1).id}&panel=${kind === 'dependencies' ? 'dependencies' : 'details'}`,
    );
    render(<App />);
    await screen.findByRole('tab', { name: 'Актуальное', selected: true });
    if (kind === 'missing')
      expect(
        screen.queryByRole('complementary', { name: 'Задача' }),
      ).not.toBeInTheDocument();
    else {
      if (kind === 'done' || kind === 'summary')
        expect(
          document.getElementById(`current-task-${task(1).id}`),
        ).not.toBeInTheDocument();
      if (kind === 'dependencies')
        expect(document.getElementById('tab-dependencies')).toHaveAttribute(
          'aria-selected',
          'true',
        );
      await userEvent.click(
        screen.getByRole('button', { name: 'Закрыть панель' }),
      );
      expect(document.getElementById('project-tab-current')).toHaveFocus();
    }
  },
);
it('validates unknown project links before loading IDs and keeps old/default views', async () => {
  const server = mockJournalApp();
  const unknown = '66666666-6666-4666-8666-666666666666';
  window.history.replaceState(null, '', `?project=${unknown}&view=current`);
  render(<App />);
  await screen.findByRole('heading', { name: 'Демо-проект' });
  expect(api.tree).toHaveBeenCalledWith(server.tree.project.id);
  expect(api.tree).not.toHaveBeenCalledWith(unknown);
  expect(document.getElementById('project-tab-tasks')).toHaveAttribute(
    'aria-selected',
    'true',
  );
});
it('cycles all three tabs, accepts clicks and keeps complete tree/filter/Gantt context', async () => {
  await start();
  const tab = document.getElementById('project-tab-current')!;
  tab.focus();
  for (const [key, id] of [
    ['{ArrowLeft}', 'tasks'],
    ['{ArrowLeft}', 'journal'],
    ['{ArrowRight}', 'tasks'],
    ['{ArrowRight}', 'current'],
    ['{End}', 'journal'],
    ['{Home}', 'tasks'],
  ]) {
    await userEvent.keyboard(key!);
    expect(document.getElementById(`project-tab-${id}`)).toHaveFocus();
  }
  changeJournalField(screen.getByLabelText('Поиск задач'), {
    target: { value: 'Нет совпадений' },
  });
  changeJournalField(screen.getByLabelText('Масштаб Ганта'), {
    target: { value: 'weeks' },
  });
  await userEvent.click(tab);
  expect(tab).toHaveFocus();
  expect(current().getByRole('button', { name: /Работа 1/ })).toBeVisible();
  await userEvent.click(document.getElementById('project-tab-tasks')!);
  expectJournalFieldValue(
    screen.getByLabelText('Поиск задач'),
    'Нет совпадений',
  );
  expectJournalFieldValue(screen.getByLabelText('Масштаб Ганта'), 'weeks');
});
it.each(['Продолжить редактирование', 'Не сохранять', 'Сохранить'])(
  'protects current task context: %s',
  async (decision) => {
    const server = await start();
    await userEvent.click(current().getByRole('button', { name: 'Позже 1' }));
    await userEvent.click(current().getByRole('button', { name: /Работа 1/ }));
    await editTitle();
    const url = window.location.href;
    await userEvent.click(current().getByRole('button', { name: /Работа 2/ }));
    const dialog = screen.getByRole('dialog', {
      name: 'Несохранённые изменения задачи',
    });
    expect(window.location.href).toBe(url);
    const result = deferred<typeof server.tree>();
    if (decision === 'Сохранить')
      vi.mocked(api.command).mockReturnValue(result.promise);
    await userEvent.click(
      within(dialog).getByRole('button', { name: decision }),
    );
    if (decision === 'Продолжить редактирование') {
      expectJournalFieldValue(
        screen.getByLabelText('Название задачи'),
        'Мой черновик',
      );
      expect(window.location.href).toBe(url);
    } else {
      if (decision === 'Сохранить') {
        expect(window.location.href).toBe(url);
        await act(async () =>
          result.resolve({
            ...server.tree,
            project: { ...server.tree.project, revision: 1 },
            tasks: [
              task(1, { title: 'Мой черновик', inputFinish: '2026-11-06' }),
              server.tree.tasks[1]!,
            ],
          }),
        );
      }
      await screen.findByRole('heading', { name: 'Работа 2' });
      expect(new URL(window.location.href).searchParams.get('task')).toBe(
        task(2).id,
      );
    }
  },
);
it('ack done removes a leaf while keeping its panel; Undo returns it and final Undo falls back to the active group', async () => {
  const server = await start();
  const original = structuredClone(server.tree);
  const result = deferred<typeof server.tree>();
  vi.mocked(api.command).mockReturnValueOnce(result.promise);
  await userEvent.click(current().getByRole('button', { name: /Работа 1/ }));
  await userEvent.click(screen.getByRole('button', { name: /^Статус:/ }));
  await userEvent.click(screen.getByRole('menuitem', { name: 'Готово' }));
  expect(current().getByRole('button', { name: /Работа 1/ })).toBeVisible();
  server.tree = {
    ...server.tree,
    project: { ...server.tree.project, revision: 1 },
    canUndo: true,
    tasks: [
      task(1, { status: 'done', inputFinish: '2026-11-06' }),
      server.tree.tasks[1]!,
    ],
  };
  await act(async () => result.resolve(server.tree));
  await waitFor(() =>
    expect(
      document.getElementById(`current-task-${task(1).id}`),
    ).not.toBeInTheDocument(),
  );
  expect(screen.getByRole('complementary', { name: 'Задача' })).toBeVisible();
  vi.mocked(api.command).mockResolvedValue({
    ...original,
    project: { ...original.project, revision: 2 },
    canUndo: false,
  });
  const undo = screen.getByRole<HTMLButtonElement>('button', {
    name: 'Отменить изменение плана',
  });
  await userEvent.click(undo);
  await waitFor(() =>
    expect(document.getElementById(`current-task-${task(1).id}`)).toBeVisible(),
  );
  expect(document.getElementById(`current-task-${task(1).id}`)).toHaveFocus();
  expect(undo).toBeDisabled();
});
it.each([
  new ApiError('INVALID_REQUEST', 'Синтетический отказ', 400),
  new ApiError('STALE_REVISION', 'Синтетический конфликт', 409),
  new ApiError('NETWORK_ERROR', 'Синтетическая потеря связи', null, true),
])(
  'keeps authoritative row and draft on $code; preserves existing retry/refresh locks',
  async (error) => {
    const server = await start();
    await userEvent.click(current().getByRole('button', { name: /Работа 1/ }));
    await editTitle();
    vi.mocked(api.command).mockRejectedValueOnce(error);
    await userEvent.click(screen.getByRole('button', { name: 'Сохранить' }));
    await screen.findByText(
      error.status === 409 ? /Проект изменён в другой сессии/ : error.message,
    );
    expectJournalFieldValue(
      screen.getByLabelText('Название задачи'),
      'Мой черновик',
    );
    expect(current().getByRole('button', { name: /Работа 1/ })).toBeVisible();
    if (error.status === 400) {
      await userEvent.click(document.getElementById('project-tab-journal')!);
      expect(document.getElementById('project-tab-journal')).toHaveAttribute(
        'aria-selected',
        'true',
      );
    } else {
      const focus = document.activeElement,
        url = window.location.href;
      await userEvent.click(document.getElementById('project-tab-tasks')!);
      expect(document.activeElement).toBe(focus);
      expect(window.location.href).toBe(url);
      if (error.uncertain) {
        const first = vi.mocked(api.command).mock.calls[0]![1];
        vi.mocked(api.command).mockResolvedValue({
          ...server.tree,
          project: { ...server.tree.project, revision: 1 },
          tasks: [
            task(1, { title: 'Мой черновик', inputFinish: '2026-11-06' }),
            server.tree.tasks[1]!,
          ],
        });
        await userEvent.click(
          screen.getByRole('button', { name: 'Повторить сохранение' }),
        );
        expect(vi.mocked(api.command).mock.calls[1]![1]).toEqual(first);
        await waitFor(() =>
          expect(
            current().getByRole('button', { name: /Мой черновик/ }),
          ).toBeVisible(),
        );
      } else {
        await userEvent.click(
          screen.getByRole('button', { name: 'Загрузить актуальный проект' }),
        );
        expectJournalFieldValue(
          screen.getByLabelText('Название задачи'),
          'Мой черновик',
        );
      }
    }
  },
);
it.each(['pending', 'uncertain'])(
  'journal %s blocks pointer/keyboard view navigation without losing editor focus or URL',
  async (mode) => {
    await start();
    await userEvent.click(current().getByRole('button', { name: /Работа 1/ }));
    await userEvent.click(document.getElementById('tab-journal')!);
    const input = await screen.findByLabelText('Текст записи');
    changeJournalField(input, { target: { value: 'Синтетический журнал' } });
    const result = deferred<Awaited<ReturnType<typeof api.journalCreate>>>();
    if (mode === 'pending')
      vi.mocked(api.journalCreate).mockReturnValue(result.promise);
    else
      vi.mocked(api.journalCreate).mockRejectedValue(
        new ApiError('NETWORK_ERROR', 'offline', null, true),
      );
    await userEvent.click(
      screen.getByRole('button', { name: 'Сохранить запись' }),
    );
    if (mode === 'uncertain')
      await screen.findByRole('button', { name: 'Повторить сохранение' });
    input.focus();
    const beforeFocus = document.activeElement,
      beforeUrl = window.location.href;
    await userEvent.click(document.getElementById('project-tab-journal')!);
    expect(document.activeElement).toBe(beforeFocus);
    fireEvent.keyDown(document.getElementById('project-tab-current')!, {
      key: 'ArrowRight',
    });
    expect(document.activeElement).toBe(beforeFocus);
    expect(window.location.href).toBe(beforeUrl);
    expect(document.getElementById('project-tab-current')).toHaveAttribute(
      'aria-selected',
      'true',
    );
  },
);
it('restores collapse/scroll from RAM visits and resets a new project without restoring historical rows', async () => {
  const server = await start();
  await userEvent.click(current().getByRole('button', { name: 'Позже 1' }));
  const panel = document.getElementById('project-view-current')!;
  panel.scrollTop = 320;
  fireEvent.scroll(panel);
  await userEvent.click(current().getByRole('button', { name: /Работа 1/ }));
  await userEvent.click(document.getElementById('project-tab-journal')!);
  await travel('back');
  expect(current().getByRole('button', { name: 'Позже 1' })).toHaveAttribute(
    'aria-expanded',
    'true',
  );
  expect(panel.scrollTop).toBe(320);
  await travel('forward');
  await userEvent.click(document.getElementById('project-tab-current')!);
  expect(panel.scrollTop).toBe(320);
  expect(server.tree.project.revision).toBe(0);
});
it('updates on minute, focus and visibility return using the project timezone without plan writes/history changes', async () => {
  const server = await start();
  await userEvent.click(current().getByRole('button', { name: 'Позже 1' }));
  const url = window.location.href;
  vi.setSystemTime(new Date('2026-11-07T00:01:00Z'));
  await act(async () => document.dispatchEvent(new Event('visibilitychange')));
  expect(current().getByRole('button', { name: 'Просрочено 1' })).toBeVisible();
  vi.setSystemTime(new Date('2026-11-06T23:30:00Z'));
  await act(async () => window.dispatchEvent(new Event('focus')));
  expect(current().getByRole('button', { name: 'Сегодня 1' })).toBeVisible();
  expect(current().getByRole('button', { name: 'Позже 1' })).toHaveAttribute(
    'aria-expanded',
    'true',
  );
  expect(window.location.href).toBe(url);
  expect(api.command).not.toHaveBeenCalled();
  expect(server.tree.project.revision).toBe(0);
});
it('source group is the close fallback when the source is collapsed; updates elsewhere never steal focus', async () => {
  await start();
  await userEvent.click(current().getByRole('button', { name: /Работа 1/ }));
  await userEvent.click(current().getByRole('button', { name: 'Сегодня 1' }));
  await userEvent.click(screen.getByRole('button', { name: 'Закрыть панель' }));
  expect(document.getElementById('current-group-today')).toHaveFocus();
  const tab = document.getElementById('project-tab-current')!;
  tab.focus();
  vi.setSystemTime(new Date('2026-11-07T12:00:00Z'));
  await act(async () => document.dispatchEvent(new Event('visibilitychange')));
  expect(tab).toHaveFocus();
});
it('a focused row moving groups on clock change retains visible row focus', async () => {
  await start();
  current()
    .getByRole('button', { name: /Работа 1/ })
    .focus();
  vi.setSystemTime(new Date('2026-11-07T00:01:00Z'));
  await act(async () => document.dispatchEvent(new Event('visibilitychange')));
  expect(document.getElementById(`current-task-${task(1).id}`)).toHaveFocus();
});
it('initial loading/error never shows false empty and retry loads the real snapshot', async () => {
  const server = mockJournalApp();
  server.tree.schedule = emptySchedule;
  const result = deferred<typeof server.tree>();
  vi.mocked(api.tree).mockReturnValueOnce(result.promise);
  window.history.replaceState(
    null,
    '',
    `?project=${server.tree.project.id}&view=current`,
  );
  render(<App />);
  await screen.findByText('Загрузка…');
  expect(
    screen.queryByText('Нет незавершённых конечных задач'),
  ).not.toBeInTheDocument();
  await act(async () =>
    result.reject(new ApiError('READ_ERROR', 'Синтетическая ошибка загрузки')),
  );
  await screen.findByText('Синтетическая ошибка загрузки');
  await userEvent.click(screen.getByRole('button', { name: 'Повторить' }));
  await screen.findByRole('tab', { name: 'Актуальное', selected: true });
});

it('a minute callback recomputes the project calendar day without mutation or URL changes', async () => {
  const ticks: (() => void)[] = [];
  const nativeInterval = window.setInterval.bind(window);
  vi.spyOn(window, 'setInterval').mockImplementation(
    (handler, timeout, ...args) => {
      if (timeout === 60000 && typeof handler === 'function')
        ticks.push(handler as () => void);
      return nativeInterval(handler, timeout, ...args) as unknown as ReturnType<
        typeof setInterval
      >;
    },
  );
  await start();
  const url = window.location.href;
  vi.setSystemTime(new Date('2026-11-07T00:00:10Z'));
  act(() => ticks.forEach((tick) => tick()));
  expect(current().getByRole('button', { name: 'Просрочено 1' })).toBeVisible();
  expect(api.command).not.toHaveBeenCalled();
  expect(window.location.href).toBe(url);
});
it('accepted calendar/timezone updates recompute immediately and retain disclosure and journal draft', async () => {
  const server = mockJournalApp();
  server.tree.canUndo = true;
  server.tree.tasks = [
    task(1, { inputFinish: '2026-11-11' }),
    task(2, { inputFinish: '2026-11-06' }),
  ];
  window.history.replaceState(
    null,
    '',
    `?project=${server.tree.project.id}&view=current`,
  );
  render(<App />);
  await screen.findByRole('tab', { name: 'Актуальное', selected: true });
  await userEvent.click(
    current().getByRole('button', { name: 'Без окончания 0' }),
  );
  await userEvent.click(current().getByRole('button', { name: /Работа 2/ }));
  await userEvent.click(document.getElementById('tab-journal')!);
  changeJournalField(await screen.findByLabelText('Текст записи'), {
    target: { value: 'Независимый черновик' },
  });
  vi.mocked(api.command).mockResolvedValue({
    ...server.tree,
    project: {
      ...server.tree.project,
      revision: 1,
      calendarType: 'all-days',
      timezone: 'Pacific/Kiritimati',
    },
  });
  await userEvent.click(
    screen.getByRole('button', { name: 'Отменить изменение плана' }),
  );
  await waitFor(() =>
    expect(current().getByRole('button', { name: 'Позже 1' })).toBeVisible(),
  );
  expect(current().getByRole('button', { name: 'Просрочено 1' })).toBeVisible();
  expect(
    current().getByRole('button', { name: 'Без окончания 0' }),
  ).toHaveAttribute('aria-expanded', 'true');
  expectJournalFieldValue(
    screen.getByLabelText('Текст записи'),
    'Независимый черновик',
  );
  expect(api.command).toHaveBeenCalledTimes(1);
});
it('accepted structural snapshot refresh removes former leaves and updates renamed/moved paths without stealing focus', async () => {
  const server = await start();
  await userEvent.click(
    current().getByRole('button', { name: 'Без окончания 0' }),
  );
  const focus = document.getElementById('current-group-undated')!;
  focus.focus();
  server.projects[0] = { ...server.projects[0]!, revision: 1 };
  server.tree = {
    ...server.tree,
    project: server.projects[0]!,
    tasks: [
      task(1, { title: 'Новый этап' }),
      task(2, {
        parentId: task(1).id,
        title: 'Перенесена',
        inputFinish: '2026-11-06',
      }),
    ],
  };
  await act(async () => window.dispatchEvent(new Event('focus')));
  await waitFor(() =>
    expect(
      within(document.getElementById(`current-task-${task(2).id}`)!).getByText(
        'Новый этап',
      ),
    ).toBeVisible(),
  );
  expect(
    document.getElementById(`current-task-${task(1).id}`),
  ).not.toBeInTheDocument();
  expect(focus).toHaveFocus();
});
it('a focused leaf removed by an accepted snapshot falls back to the original group', async () => {
  const server = await start();
  current()
    .getByRole('button', { name: /Работа 1/ })
    .focus();
  server.projects[0] = { ...server.projects[0]!, revision: 1 };
  server.tree = {
    ...server.tree,
    project: server.projects[0]!,
    tasks: [
      task(1, { status: 'done', inputFinish: '2026-11-06' }),
      server.tree.tasks[1]!,
    ],
  };
  await act(async () => window.dispatchEvent(new Event('focus')));
  await waitFor(() =>
    expect(current().getByRole('button', { name: 'Сегодня 0' })).toHaveFocus(),
  );
});
it('new project uses defaults, pending load shows no old rows, Back restores RAM disclosure and current snapshot', async () => {
  const server = mockJournalApp();
  const b = {
    ...server.projects[0]!,
    id: '44444444-4444-4444-8444-444444444444',
    title: 'Проект B',
  };
  server.projects.push(b);
  server.tree.tasks = [task(1, { inputFinish: '2026-11-06' })];
  window.history.replaceState(
    null,
    '',
    `?project=${server.tree.project.id}&view=current`,
  );
  render(<App />);
  await screen.findByRole('tab', { name: 'Актуальное', selected: true });
  await userEvent.click(
    current().getByRole('button', { name: 'Без окончания 0' }),
  );
  await userEvent.type(
    screen.getByRole('searchbox', { name: 'Поиск задач' }),
    'Работа',
  );
  const read = deferred<typeof server.tree>();
  vi.mocked(api.tree).mockReturnValueOnce(read.promise);
  await userEvent.click(screen.getByRole('button', { name: 'Проект B' }));
  expect(
    document.getElementById('project-view-current'),
  ).not.toBeInTheDocument();
  await act(async () =>
    read.resolve({ ...server.tree, project: b, tasks: [] }),
  );
  await screen.findByRole('heading', { name: 'Проект B' });
  await userEvent.click(document.getElementById('project-tab-current')!);
  expect(
    current().getByRole('button', { name: 'Без окончания 0' }),
  ).toHaveAttribute('aria-expanded', 'false');
  expectJournalFieldValue(
    screen.getByRole('searchbox', { name: 'Поиск задач' }),
    '',
  );
  await travel('back');
  await travel('back');
  await screen.findByRole('heading', { name: 'Демо-проект' });
  expectJournalFieldValue(
    screen.getByRole('searchbox', { name: 'Поиск задач' }),
    'Работа',
  );
  await waitFor(() =>
    expect(
      current().getByRole('button', { name: 'Без окончания 0' }),
    ).toHaveAttribute('aria-expanded', 'true'),
  );
});
it('last Undo with no origin focuses the current tab', async () => {
  const server = mockJournalApp();
  server.tree.canUndo = true;
  window.history.replaceState(
    null,
    '',
    `?project=${server.tree.project.id}&view=current`,
  );
  render(<App />);
  await screen.findByRole('tab', { name: 'Актуальное', selected: true });
  vi.mocked(api.command).mockResolvedValueOnce({
    ...server.tree,
    project: { ...server.tree.project, revision: 1 },
    canUndo: false,
  });
  await userEvent.click(
    screen.getByRole('button', { name: 'Отменить изменение плана' }),
  );
  expect(document.getElementById('project-tab-current')).toHaveFocus();
});
it('late Undo acknowledgement does not steal manual group focus', async () => {
  const server = mockJournalApp();
  server.tree.canUndo = true;
  window.history.replaceState(
    null,
    '',
    `?project=${server.tree.project.id}&view=current`,
  );
  render(<App />);
  await screen.findByRole('tab', { name: 'Актуальное', selected: true });
  const result = deferred<typeof server.tree>();
  vi.mocked(api.command).mockReturnValue(result.promise);
  await userEvent.click(
    screen.getByRole('button', { name: 'Отменить изменение плана' }),
  );
  const group = current().getByRole('button', { name: 'Сегодня 0' });
  group.focus();
  group.blur();
  await act(async () =>
    result.resolve({
      ...server.tree,
      project: { ...server.tree.project, revision: 1 },
      canUndo: false,
    }),
  );
  expect(document.activeElement).toBe(document.body);
});
it('only Show on Gantt changes to tasks and clears the preserved tree filter', async () => {
  await start();
  await userEvent.click(document.getElementById('project-tab-tasks')!);
  changeJournalField(screen.getByLabelText('Поиск задач'), {
    target: { value: 'Чужой фильтр' },
  });
  await userEvent.click(document.getElementById('project-tab-current')!);
  await userEvent.click(current().getByRole('button', { name: /Работа 1/ }));
  await userEvent.click(screen.getByRole('button', { name: 'Закрыть панель' }));
  expect(document.getElementById('project-tab-current')).toHaveAttribute(
    'aria-selected',
    'true',
  );
  await userEvent.click(current().getByRole('button', { name: /Работа 1/ }));
  await userEvent.click(
    screen.getByRole('button', { name: 'Действия задачи' }),
  );
  await userEvent.click(
    screen.getByRole('menuitem', { name: 'Показать на Ганте' }),
  );
  expect(document.getElementById('project-tab-tasks')).toHaveAttribute(
    'aria-selected',
    'true',
  );
  expectJournalFieldValue(screen.getByLabelText('Поиск задач'), '');
});

it('current panel sibling action opens the visible main composer and expands its exact insertion ancestry', async () => {
  const server = mockJournalApp();
  server.tree.tasks = [
    task(1, { title: 'Верхний этап' }),
    task(2, { title: 'Нижний этап', parentId: task(1).id }),
    task(3, { parentId: task(2).id, inputFinish: '2026-11-06' }),
    task(4, { parentId: task(2).id }),
  ];
  render(<App />);
  await screen.findByRole('heading', { name: 'Демо-проект' });
  await userEvent.click(
    screen.getByRole('button', { name: 'Свернуть Нижний этап' }),
  );
  await userEvent.click(
    screen.getByRole('button', { name: 'Свернуть Верхний этап' }),
  );
  changeJournalField(screen.getByLabelText('Поиск задач'), {
    target: { value: 'Нет совпадений' },
  });
  await userEvent.click(document.getElementById('project-tab-current')!);
  await userEvent.click(current().getByRole('button', { name: /Работа 3/ }));
  await userEvent.click(
    screen.getByRole('button', { name: 'Действия задачи' }),
  );
  await userEvent.click(
    screen.getByRole('menuitem', { name: 'Добавить соседнюю задачу' }),
  );
  const input = document.getElementById('quick-task')!;
  await waitFor(() => expect(input).toHaveFocus());
  expect(input.closest('[hidden]')).toBeNull();
  expect(document.getElementById('project-tab-tasks')).toHaveAttribute(
    'aria-selected',
    'true',
  );
  expect(
    screen.getByRole('button', { name: 'Свернуть Верхний этап' }),
  ).toBeVisible();
  expect(
    screen.getByRole('button', { name: 'Свернуть Нижний этап' }),
  ).toBeVisible();
  expectJournalFieldValue(screen.getByLabelText('Поиск задач'), '');
  expect(screen.getByText('Родитель: Нижний этап')).toBeVisible();
  vi.mocked(api.command).mockResolvedValue({
    ...server.tree,
    project: { ...server.tree.project, revision: 1 },
    tasks: [
      ...server.tree.tasks,
      task(5, { title: 'Новый сосед', parentId: task(2).id }),
    ],
  });
  changeJournalField(input, { target: { value: 'Новый сосед' } });
  await userEvent.click(
    screen.getByRole('button', { name: 'Добавить задачу' }),
  );
  await waitFor(() => expect(api.command).toHaveBeenCalled());
  expect(vi.mocked(api.command).mock.calls[0]![1].command).toMatchObject({
    type: 'task.create',
    parentId: task(2).id,
    afterId: task(3).id,
    title: 'Новый сосед',
  });
});

it('a later manual focus choice cancels deferred sibling editor focus even after it blurs', async () => {
  await start();
  await userEvent.click(current().getByRole('button', { name: /Работа 1/ }));
  await userEvent.click(
    screen.getByRole('button', { name: 'Действия задачи' }),
  );
  const frames: FrameRequestCallback[] = [];
  vi.spyOn(window, 'requestAnimationFrame').mockImplementation((callback) => {
    frames.push(callback);
    return frames.length;
  });
  await userEvent.click(
    screen.getByRole('menuitem', { name: 'Добавить соседнюю задачу' }),
  );
  const search = screen.getByLabelText('Поиск задач');
  search.focus();
  search.blur();
  act(() => frames.forEach((callback) => callback(0)));
  expect(document.activeElement).toBe(document.body);
  expect(document.getElementById('quick-task')).not.toHaveFocus();
});
