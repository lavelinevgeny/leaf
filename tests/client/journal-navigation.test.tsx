// @vitest-environment jsdom
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
import { strings } from '../../src/client/strings.js';
import {
  parseWorkspaceUrl,
  workspaceUrl,
  writeWorkspaceVisit,
} from '../../src/client/workspace-navigation.js';
import { journal5, mockJournalApp, read6 } from './journal-fixtures.js';
import { task } from './fixtures.js';
beforeEach(() => window.history.replaceState(null, '', '/'));
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});
const projectId = journal5.projectId;
async function travel(direction: 'back' | 'forward') {
  await act(async () => {
    await new Promise<void>((resolve) => {
      window.addEventListener('popstate', () => resolve(), { once: true });
      window.history[direction]();
    });
  });
}
async function projectJournal() {
  await screen.findByRole('heading', { name: 'Демо-проект' });
  await userEvent.click(document.getElementById('project-tab-journal')!);
  await screen.findByText('Original synthetic text');
}
it('validates UUID/enums and emits only allowlisted URL fields and opaque history IDs', () => {
  expect(
    parseWorkspaceUrl(new URL('https://leaf.test/?project=bad&view=journal')),
  ).toBeNull();
  expect(
    parseWorkspaceUrl(
      new URL(`https://leaf.test/?project=${projectId}&view=board`),
    ),
  ).toBeNull();
  expect(
    parseWorkspaceUrl(
      new URL(`https://leaf.test/?project=${projectId}&task=bad`),
    ),
  ).toBeNull();
  const visit = {
    projectId,
    taskId: journal5.taskId,
    view: 'journal' as const,
    panel: 'journal' as const,
  };
  expect(
    parseWorkspaceUrl(
      new URL(`https://leaf.test/${workspaceUrl(visit)}&q=private`),
    ),
  ).toEqual(visit);
  writeWorkspaceVisit(visit, 'synthetic-visit', 'replace');
  expect(window.history.state).toEqual({
    leaf: { version: 1, visitId: 'synthetic-visit' },
  });
  expect(window.location.search).not.toContain('private');
  expect([...new URLSearchParams(window.location.search).keys()]).toEqual([
    'project',
    'view',
    'task',
    'panel',
  ]);
});
it('initial URL waits for authentication and never selects a foreign task', async () => {
  mockJournalApp();
  window.history.replaceState(
    null,
    '',
    `?project=${projectId}&view=journal&task=${task(99).id}&panel=journal`,
  );
  vi.mocked(api.session).mockResolvedValue({
    authenticated: false,
    setupRequired: false,
  });
  vi.spyOn(api, 'login').mockResolvedValue({
    authenticated: true,
    setupRequired: false,
  });
  render(<App />);
  await screen.findByLabelText('Пароль');
  expect(api.journalProject).not.toHaveBeenCalled();
  expect(api.tree).not.toHaveBeenCalled();
  fireEvent.change(screen.getByLabelText('Пароль'), {
    target: { value: 'synthetic-password' },
  });
  await userEvent.click(screen.getByRole('button', { name: 'Войти' }));
  await screen.findByText('Original synthetic text');
  expect(document.getElementById('project-tab-journal')).toHaveAttribute(
    'aria-selected',
    'true',
  );
  expect(document.getElementById('panel-journal')).toBeNull();
});
it('mounted task timeline, scale and quick draft survive tabs; history contains no draft/query', async () => {
  mockJournalApp();
  const local = vi.spyOn(Storage.prototype, 'setItem');
  render(<App />);
  await screen.findByRole('heading', { name: 'Демо-проект' });
  const timeline = document.querySelector('.task-timeline');
  fireEvent.change(screen.getByLabelText('Масштаб Ганта'), {
    target: { value: 'weeks' },
  });
  const quick = document.getElementById('quick-task')!;
  fireEvent.change(quick, { target: { value: 'Synthetic quick draft' } });
  await userEvent.click(document.getElementById('project-tab-journal')!);
  fireEvent.change(screen.getByLabelText('Поиск записей'), {
    target: { value: 'private synthetic query' },
  });
  await userEvent.click(document.getElementById('project-tab-tasks')!);
  expect(document.querySelector('.task-timeline')).toBe(timeline);
  expect(screen.getByLabelText('Масштаб Ганта')).toHaveValue('weeks');
  expect(document.getElementById('quick-task')).toHaveValue(
    'Synthetic quick draft',
  );
  expect(window.location.href).not.toContain('synthetic');
  expect(JSON.stringify(window.history.state)).not.toContain('synthetic');
  expect(local).not.toHaveBeenCalled();
});
it('title opens same project feed, close restores its origin and Back/Forward restores nested visits', async () => {
  mockJournalApp();
  render(<App />);
  await projectJournal();
  const feed = document.querySelector('[data-journal-feed="project"]');
  const title = screen.getByRole('button', { name: 'Работа 1' });
  await userEvent.click(title);
  await waitFor(() =>
    expect(document.getElementById('tab-journal')).toHaveAttribute(
      'aria-selected',
      'true',
    ),
  );
  expect(document.querySelector('[data-journal-feed="project"]')).toBe(feed);
  expect(new URLSearchParams(window.location.search).get('task')).toBe(
    journal5.taskId,
  );
  await userEvent.click(screen.getByRole('button', { name: 'Закрыть панель' }));
  expect(title).toHaveFocus();
  await travel('back');
  await waitFor(() =>
    expect(document.getElementById('panel-journal')).not.toBeNull(),
  );
  await travel('back');
  await waitFor(() =>
    expect(document.getElementById('panel-journal')).toBeNull(),
  );
  await travel('forward');
  await waitFor(() =>
    expect(document.getElementById('panel-journal')).not.toBeNull(),
  );
});
it('blocks Back for a dirty planning baseline and restores the prior history position', async () => {
  mockJournalApp();
  render(<App />);
  await screen.findByRole('heading', { name: 'Демо-проект' });
  await userEvent.click(screen.getByRole('treeitem', { name: /Работа 1/ }));
  fireEvent.change(screen.getByLabelText('Название задачи'), {
    target: { value: 'Pinned own plan title' },
  });
  const before = window.location.search;
  await travel('back');
  await screen.findByText(strings.unsaved);
  await waitFor(() => expect(window.location.search).toBe(before));
  expect(screen.getByLabelText('Название задачи')).toHaveValue(
    'Pinned own plan title',
  );
  expect(api.command).not.toHaveBeenCalled();
});
it('uncertain journal disables Undo/task/project navigation and retains exact editor through retry', async () => {
  const server = mockJournalApp();
  server.tree.canUndo = true;
  vi.mocked(api.journalCreate).mockRejectedValueOnce(
    new ApiError('NETWORK_ERROR', 'offline', null, true),
  );
  render(<App />);
  await projectJournal();
  await userEvent.click(screen.getByRole('button', { name: 'Работа 1' }));
  await waitFor(() =>
    expect(document.getElementById('panel-journal')).not.toBeNull(),
  );
  fireEvent.change(screen.getByLabelText('Текст записи'), {
    target: { value: 'Uncertain synthetic note' },
  });
  await userEvent.click(
    screen.getByRole('button', { name: 'Сохранить запись' }),
  );
  await screen.findByRole('button', { name: 'Повторить сохранение' });
  expect(
    screen.getByRole('button', { name: 'Отменить изменение плана' }),
  ).toBeDisabled();
  expect(screen.getByLabelText('Текст записи')).toBeDisabled();
  const before = window.location.search;
  await travel('back');
  await waitFor(() => expect(window.location.search).toBe(before));
  expect(screen.getByLabelText('Текст записи')).toHaveValue(
    'Uncertain synthetic note',
  );
  expect(api.command).not.toHaveBeenCalled();
});
it('rendered edit stays pinned5 across remote6 focus/close/reopen/Back and explicitly rebases with a fresh UUID', async () => {
  const server = mockJournalApp();
  render(<App />);
  await projectJournal();
  await userEvent.click(
    screen.getByRole('button', { name: 'Действия записи 2024-02-29' }),
  );
  await userEvent.click(
    screen.getByRole('menuitem', { name: 'Редактировать запись' }),
  );
  fireEvent.change(screen.getByLabelText('Текст записи'), {
    target: { value: 'My pinned edit' },
  });
  server.entries = [read6.entry];
  server.revision = 6;
  await act(async () => window.dispatchEvent(new Event('focus')));
  await userEvent.click(
    screen.getByRole('button', { name: 'Закрыть редактор' }),
  );
  await userEvent.click(document.getElementById('project-tab-tasks')!);
  await travel('back');
  await waitFor(() =>
    expect(document.getElementById('project-tab-journal')).toHaveAttribute(
      'aria-selected',
      'true',
    ),
  );
  await userEvent.click(
    screen.getByRole('button', { name: 'Действия записи 2024-02-29' }),
  );
  await userEvent.click(
    screen.getByRole('menuitem', { name: 'Редактировать запись' }),
  );
  expect(screen.getByLabelText('Текст записи')).toHaveValue('My pinned edit');
  vi.mocked(api.journalUpdate).mockRejectedValueOnce(
    new ApiError('JOURNAL_REVISION_CONFLICT', 'conflict', 409),
  );
  await userEvent.click(
    screen.getByRole('button', { name: 'Сохранить запись' }),
  );
  await screen.findByText(/Запись изменилась/);
  expect(
    vi.mocked(api.journalUpdate).mock.calls[0]?.[2].expectedJournalRevision,
  ).toBe(5);
  await userEvent.click(
    screen.getByRole('button', { name: 'Показать текущую запись' }),
  );
  await userEvent.click(
    await screen.findByRole('button', {
      name: 'Оставить мой текст и принять текущую версию',
    }),
  );
  expect(api.journalUpdate).toHaveBeenCalledOnce();
  await userEvent.click(
    screen.getByRole('button', { name: 'Сохранить запись' }),
  );
  await waitFor(() => expect(api.journalUpdate).toHaveBeenCalledTimes(2));
  expect(
    vi.mocked(api.journalUpdate).mock.calls[1]?.[2].expectedJournalRevision,
  ).toBe(6);
  expect(vi.mocked(api.journalUpdate).mock.calls[1]?.[2].operationId).not.toBe(
    vi.mocked(api.journalUpdate).mock.calls[0]?.[2].operationId,
  );
});
it('rendered delete confirmation remains pinned5 through remote6 and task view Back', async () => {
  const server = mockJournalApp();
  render(<App />);
  await projectJournal();
  await userEvent.click(
    screen.getByRole('button', { name: 'Действия записи 2024-02-29' }),
  );
  await userEvent.click(
    screen.getByRole('menuitem', { name: 'Удалить запись' }),
  );
  server.entries = [read6.entry];
  server.revision = 6;
  await act(async () => window.dispatchEvent(new Event('focus')));
  await userEvent.click(document.getElementById('project-tab-tasks')!);
  await travel('back');
  await waitFor(() =>
    expect(document.getElementById('project-tab-journal')).toHaveAttribute(
      'aria-selected',
      'true',
    ),
  );
  vi.mocked(api.journalDelete).mockRejectedValueOnce(
    new ApiError('JOURNAL_REVISION_CONFLICT', 'conflict', 409),
  );
  await userEvent.click(
    screen.getByRole('button', { name: 'Подтвердить удаление записи' }),
  );
  expect(
    vi.mocked(api.journalDelete).mock.calls[0]?.[2].expectedJournalRevision,
  ).toBe(5);
  await userEvent.click(
    screen.getByRole('button', { name: 'Отмена удаления' }),
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
  expect(
    vi.mocked(api.journalDelete).mock.calls[1]?.[2].expectedJournalRevision,
  ).toBe(6);
});
it.each(['main', 'subtasks'])(
  'common %s branch-delete uses exact bounded warning and Cancel preserves focus/data without writes',
  async (scope) => {
    const server = mockJournalApp();
    server.tree.tasks.push(task(2, { parentId: journal5.taskId }));
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(false);
    render(<App />);
    await screen.findByRole('heading', { name: 'Демо-проект' });
    let row: HTMLElement;
    if (scope === 'subtasks') {
      await userEvent.click(screen.getByRole('treeitem', { name: /Работа 1/ }));
      await userEvent.click(screen.getByRole('tab', { name: 'Подзадачи' }));
      row = within(document.getElementById('panel-subtasks')!).getByRole(
        'treeitem',
        { name: /Работа 2/ },
      );
    } else row = screen.getByRole('treeitem', { name: /Работа 1/ });
    row.focus();
    fireEvent.keyDown(row, { key: 'Delete' });
    expect(confirm).toHaveBeenCalledWith(
      'Удалить задачу и все её подзадачи, включая записи журнала этой ветки? Записи можно восстановить доступной отменой плана. Восстановление недоступно после удаления истории отмены или изменений плана другой сессией',
    );
    expect(row).toHaveFocus();
    expect(api.command).not.toHaveBeenCalled();
    expect(api.journalDelete).not.toHaveBeenCalled();
    fireEvent.keyDown(row, { key: 'ArrowDown' });
    expect(server.entries).toEqual([journal5]);
  },
);
it('row menu keyboard opens journal without accidental selection/plan writes; project tabs accept Home/End', async () => {
  mockJournalApp();
  render(<App />);
  await screen.findByRole('heading', { name: 'Демо-проект' });
  await userEvent.click(
    screen.getByRole('button', { name: 'Действия задачи: Работа 1' }),
  );
  const menu = screen.getByRole('menu');
  fireEvent.keyDown(menu, { key: 'ArrowDown' });
  expect(
    screen.getByRole('menuitem', { name: 'Добавить запись' }),
  ).toHaveFocus();
  await userEvent.keyboard('{Enter}');
  await waitFor(() =>
    expect(screen.getByLabelText('Текст записи')).toHaveFocus(),
  );
  expect(api.command).not.toHaveBeenCalled();
  fireEvent.keyDown(document.getElementById('project-tab-tasks')!, {
    key: 'End',
  });
  expect(document.getElementById('project-tab-journal')).toHaveAttribute(
    'aria-selected',
    'true',
  );
  fireEvent.keyDown(document.getElementById('project-tab-journal')!, {
    key: 'Home',
  });
  expect(document.getElementById('project-tab-tasks')).toHaveAttribute(
    'aria-selected',
    'true',
  );
});
it('dirty plan stays on its original title/source baseline while refreshed journal header/title use renamed metadata', async () => {
  const server = mockJournalApp();
  render(<App />);
  await screen.findByRole('treeitem', { name: /Работа 1/ });
  await userEvent.click(screen.getByRole('treeitem', { name: /Работа 1/ }));
  fireEvent.change(screen.getByLabelText('Название задачи'), {
    target: { value: 'Own plan title' },
  });
  await userEvent.click(document.getElementById('tab-journal')!);
  fireEvent.change(await screen.findByLabelText('Текст записи'), {
    target: { value: 'Own journal text' },
  });
  server.projects[0] = { ...server.projects[0]!, revision: 1 };
  server.tree = {
    ...server.tree,
    project: server.projects[0]!,
    tasks: [{ ...server.tree.tasks[0]!, title: 'Remote renamed task' }],
  };
  await act(async () => window.dispatchEvent(new Event('focus')));
  await screen.findByRole('heading', { name: 'Remote renamed task' });
  await userEvent.click(document.getElementById('tab-details')!);
  expect(screen.getByLabelText('Название задачи')).toHaveValue(
    'Own plan title',
  );
  await userEvent.click(document.getElementById('tab-journal')!);
  expect(screen.getByLabelText('Текст записи')).toHaveValue('Own journal text');
  expect(api.command).not.toHaveBeenCalled();
});
it('later manual focus cancels asynchronous journal textarea focus', async () => {
  mockJournalApp();
  render(<App />);
  await projectJournal();
  const callbacks: FrameRequestCallback[] = [];
  vi.spyOn(window, 'requestAnimationFrame').mockImplementation((callback) => {
    callbacks.push(callback);
    return callbacks.length;
  });
  await userEvent.click(screen.getByRole('button', { name: 'Работа 1' }));
  const search = screen.getByLabelText('Поиск записей');
  search.focus();
  act(() => callbacks.forEach((callback) => callback(0)));
  expect(search).toHaveFocus();
});
it('Back across projects restores Gantt scale, width, both scroll axes and filtered collapse from the visit snapshot', async () => {
  const server = mockJournalApp();
  server.tree.tasks.push(task(2, { parentId: journal5.taskId }));
  server.projects.push({
    ...server.projects[0]!,
    id: '44444444-4444-4444-8444-444444444444',
    title: 'Synthetic B',
  });
  render(<App />);
  await screen.findByRole('treeitem', { name: /Работа 1/ });
  fireEvent.change(screen.getByLabelText('Масштаб Ганта'), {
    target: { value: 'weeks' },
  });
  fireEvent.change(screen.getByLabelText('Поиск задач'), {
    target: { value: 'Работа 2' },
  });
  await userEvent.click(
    screen.getByRole('button', { name: 'Свернуть Работа 1' }),
  );
  const horizontal = document.querySelector<HTMLElement>('.timeline-time')!,
    vertical = document.querySelector<HTMLElement>('[data-plan-scroll]')!;
  horizontal.scrollLeft = 123;
  vertical.scrollTop = 80;
  fireEvent.scroll(horizontal);
  fireEvent.scroll(vertical);
  const width = document.querySelector('.task-timeline')?.getAttribute('style');
  await userEvent.click(screen.getByRole('button', { name: /Synthetic B/ }));
  await screen.findByRole('heading', { name: 'Synthetic B' });
  expect(document.getElementById('project-tab-tasks')).toHaveAttribute(
    'aria-selected',
    'true',
  );
  await travel('back');
  await screen.findByRole('heading', { name: 'Демо-проект' });
  await waitFor(() =>
    expect(screen.getByLabelText('Масштаб Ганта')).toHaveValue('weeks'),
  );
  expect(screen.getByLabelText('Поиск задач')).toHaveValue('Работа 2');
  expect(screen.getByRole('treeitem', { name: /Работа 1/ })).toHaveAttribute(
    'aria-expanded',
    'false',
  );
  expect(
    document.querySelector<HTMLElement>('.timeline-time')?.scrollLeft,
  ).toBe(123);
  expect(
    document.querySelector<HTMLElement>('[data-plan-scroll]')?.scrollTop,
  ).toBe(80);
  expect(document.querySelector('.task-timeline')?.getAttribute('style')).toBe(
    width,
  );
});
it('unknown initial project stays unavailable and permits a safe explicit return to a known project', async () => {
  mockJournalApp();
  const unknown = '66666666-6666-4666-8666-666666666666';
  window.history.replaceState(null, '', `?project=${unknown}&view=journal`);
  vi.mocked(api.tree).mockRejectedValueOnce(
    new ApiError('NOT_FOUND', 'Проект недоступен', 404),
  );
  render(<App />);
  await screen.findByText('Проект недоступен');
  expect(api.journalProject).not.toHaveBeenCalled();
  await userEvent.click(screen.getByRole('button', { name: /Демо-проект/ }));
  await screen.findByRole('heading', { name: 'Демо-проект' });
  expect(document.getElementById('project-tab-tasks')).toHaveAttribute(
    'aria-selected',
    'true',
  );
  expect(new URLSearchParams(window.location.search).get('project')).toBe(
    projectId,
  );
});
