// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import {
  cleanup,
  render,
  screen,
  waitFor,
  within,
} from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { App } from '../../src/client/App.js';
import { TaskFilters } from '../../src/client/TaskFilters.js';
import { emptyTaskFilter } from '../../src/client/task-filter.js';
import { project, task, emptySchedule } from './fixtures.js';
import type { ProjectTree } from '../../src/shared/contracts.js';

let tree: ProjectTree;
let fetchMock: ReturnType<typeof vi.fn>;
const root = task(1, { title: 'Этап A' });
const group = task(2, { title: 'Группа', parentId: root.id });
const a = task(3, { title: 'Монтаж A', parentId: group.id, status: 'doing' });
const b = task(4, { title: 'Монтаж B', parentId: root.id });
const done = task(5, { title: 'Готовая работа', status: 'done' });
const other = {
  ...project,
  id: '44444444-4444-4444-8444-444444444444',
  title: 'Другой демо-проект',
};
const json = (body: unknown) =>
  Promise.resolve(
    new Response(JSON.stringify(body), {
      headers: { 'Content-Type': 'application/json' },
    }),
  );

beforeEach(() => {
  tree = {
    contractVersion: 2,
    project: { ...project },
    tasks: structuredClone([root, group, a, b, done]),
    canUndo: false,
    dependencies: [],
    schedule: structuredClone(emptySchedule),
  };
  fetchMock = vi.fn((url: string) => {
    if (url === '/api/auth/session')
      return json({ authenticated: true, setupRequired: false });
    if (url === '/api/projects') return json([project, other]);
    if (url.includes(other.id))
      return json({ ...tree, project: other, tasks: [] });
    if (url.endsWith('/tree')) return json(tree);
    throw new Error('Unexpected synthetic request');
  });
  vi.stubGlobal('fetch', fetchMock);
  vi.spyOn(window, 'confirm').mockReturnValue(true);
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});
async function open() {
  const view = render(<App />);
  await screen.findByRole('treeitem', { name: /Монтаж A,/ });
  return view;
}
function ids() {
  return within(screen.getByRole('tree', { name: 'Задачи' }))
    .queryAllByRole('treeitem')
    .map((row) => row.dataset.taskId);
}

it('opens a status popover, contains Escape and keeps status when clearing text', async () => {
  await open();
  const user = userEvent.setup();
  await user.click(screen.getByRole('treeitem', { name: /Монтаж A,/ }));
  const opener = screen.getByRole('button', { name: 'Фильтры' });
  opener.focus();
  await user.keyboard('{Enter}');
  const status = screen.getByRole('combobox', { name: 'Фильтр по статусу' });
  expect(status).toHaveFocus();
  await user.selectOptions(status, 'doing');
  expect(screen.getByRole('button', { name: 'Фильтры · 1' })).toHaveAttribute(
    'aria-expanded',
    'true',
  );
  await user.keyboard('{Escape}');
  expect(screen.getByRole('button', { name: 'Фильтры · 1' })).toHaveFocus();
  expect(screen.getByRole('complementary', { name: 'Задача' })).toBeVisible();
  await user.keyboard(' ');
  expect(
    screen.getByRole('combobox', { name: 'Фильтр по статусу' }),
  ).toHaveFocus();
  await user.keyboard('{Escape}');
  const search = screen.getByRole('searchbox', { name: 'Поиск задач' });
  await user.type(search, 'Монтаж');
  await user.click(screen.getByRole('button', { name: 'Очистить поиск' }));
  expect(search).toHaveValue('');
  expect(search).toHaveFocus();
  expect(screen.getByRole('button', { name: 'Фильтры · 1' })).toBeVisible();
  await user.type(search, 'Монтаж{Escape}');
  expect(search).toHaveValue('');
  expect(screen.getByRole('button', { name: 'Фильтры · 1' })).toBeVisible();
  expect(ids()).toEqual([root.id, group.id, a.id]);
});

it('closes on outside focus, Tab departure and a project switch', async () => {
  await open();
  const user = userEvent.setup();
  await user.click(screen.getByRole('button', { name: 'Фильтры' }));
  await user.click(screen.getByRole('searchbox', { name: 'Поиск задач' }));
  expect(
    screen.queryByRole('combobox', { name: 'Фильтр по статусу' }),
  ).toBeNull();
  await user.click(screen.getByRole('button', { name: 'Фильтры' }));
  await user.click(screen.getByRole('button', { name: 'Список' }));
  expect(
    screen.queryByRole('combobox', { name: 'Фильтр по статусу' }),
  ).toBeNull();
  expect(screen.getByRole('button', { name: 'Список' })).toHaveFocus();
  await user.click(screen.getByRole('button', { name: 'Фильтры' }));
  await user.tab();
  expect(
    screen.queryByRole('combobox', { name: 'Фильтр по статусу' }),
  ).toBeNull();
  await user.click(screen.getByRole('button', { name: 'Фильтры' }));
  await user.click(screen.getByRole('button', { name: /Другой демо-проект/ }));
  await screen.findByRole('heading', { name: other.title });
  expect(
    screen.queryByRole('combobox', { name: 'Фильтр по статусу' }),
  ).toBeNull();
});

it('closes the popover when loading disables its controls', async () => {
  const user = userEvent.setup();
  const onChange = vi.fn();
  const view = render(
    <TaskFilters
      filter={emptyTaskFilter}
      onChange={onChange}
      disabled={false}
    />,
  );
  await user.click(screen.getByRole('button', { name: 'Фильтры' }));
  expect(
    screen.getByRole('combobox', { name: 'Фильтр по статусу' }),
  ).toHaveFocus();
  view.rerender(
    <TaskFilters filter={emptyTaskFilter} onChange={onChange} disabled />,
  );
  expect(screen.getByRole('button', { name: 'Фильтры' })).toBeDisabled();
  expect(
    screen.queryByRole('combobox', { name: 'Фильтр по статусу' }),
  ).toBeNull();
  expect(screen.getByRole('button', { name: 'Фильтры' })).toHaveAttribute(
    'aria-expanded',
    'false',
  );
});

it('closes on Shift+Tab back to the opener and still toggles by pointer', async () => {
  const user = userEvent.setup();
  render(
    <TaskFilters
      filter={emptyTaskFilter}
      onChange={vi.fn()}
      disabled={false}
    />,
  );
  const opener = screen.getByRole('button', { name: 'Фильтры' });
  opener.focus();
  await user.keyboard('{Enter}');
  expect(
    screen.getByRole('combobox', { name: 'Фильтр по статусу' }),
  ).toHaveFocus();
  await user.tab({ shift: true });
  expect(opener).toHaveFocus();
  expect(opener).toHaveAttribute('aria-expanded', 'false');
  await user.click(opener);
  expect(
    screen.getByRole('combobox', { name: 'Фильтр по статусу' }),
  ).toHaveFocus();
  await user.click(opener);
  expect(opener).toHaveAttribute('aria-expanded', 'false');
  expect(opener).toHaveFocus();
});

it('reveals matches in collapsed branches and shares literal rows with Gantt without requests', async () => {
  const { container } = await open();
  const user = userEvent.setup();
  const before = structuredClone(tree);
  expect(
    screen.queryByRole('button', { name: 'Сбросить поиск и фильтры' }),
  ).toBeNull();
  await user.click(screen.getByRole('button', { name: 'Свернуть Этап A' }));
  expect(ids()).toEqual([root.id, done.id]);
  const requests = fetchMock.mock.calls.length;
  await user.type(
    screen.getByRole('searchbox', { name: 'Поиск задач' }),
    ' МОНТАЖ ',
  );
  expect(ids()).toEqual([root.id, group.id, a.id, b.id]);
  await user.click(screen.getByRole('button', { name: 'Фильтры' }));
  await user.selectOptions(
    screen.getByRole('combobox', { name: 'Фильтр по статусу' }),
    'doing',
  );
  expect(ids()).toEqual([root.id, group.id, a.id]);
  expect(
    [...container.querySelectorAll('[data-gantt-row]')].map((node) =>
      node.getAttribute('data-gantt-row'),
    ),
  ).toEqual([root.id, group.id, a.id]);
  expect(screen.getByText('Найдено задач: 1')).toBeVisible();
  expect(
    screen.getByRole('treeitem', { name: /Этап A,/ }),
  ).toHaveAccessibleDescription('Родительский контекст');
  expect(
    screen.getByRole('treeitem', { name: /Монтаж A,/ }),
  ).not.toHaveAccessibleDescription('Родительский контекст');
  expect(fetchMock.mock.calls).toHaveLength(requests);
  expect(tree).toEqual(before);
});

it('keeps filtered collapse temporary, resets it on criteria changes and restores ordinary collapse', async () => {
  await open();
  const user = userEvent.setup();
  await user.click(screen.getByRole('button', { name: 'Свернуть Этап A' }));
  await user.type(screen.getByRole('searchbox'), 'Монтаж A');
  await user.click(screen.getByRole('button', { name: 'Свернуть Группа' }));
  expect(ids()).toEqual([root.id, group.id]);
  expect(screen.getByRole('treeitem', { name: /Группа,/ })).toHaveAttribute(
    'aria-expanded',
    'false',
  );
  await user.click(screen.getByRole('button', { name: 'Фильтры' }));
  await user.selectOptions(
    screen.getByRole('combobox', { name: 'Фильтр по статусу' }),
    'doing',
  );
  expect(ids()).toEqual([root.id, group.id, a.id]);
  await user.click(
    screen.getByRole('button', { name: 'Сбросить поиск и фильтры' }),
  );
  expect(ids()).toEqual([root.id, done.id]);
  expect(screen.getByRole('searchbox')).toHaveFocus();
  expect(
    screen.queryByRole('button', { name: 'Сбросить поиск и фильтры' }),
  ).toBeNull();
  expect(screen.getByRole('button', { name: 'Фильтры' })).toHaveAttribute(
    'aria-expanded',
    'false',
  );
});

it('distinguishes no matches, clears search with Escape and supports list-only keyboard navigation', async () => {
  await open();
  const user = userEvent.setup();
  const search = screen.getByRole('searchbox');
  await user.type(search, 'Отсутствует');
  expect(ids()).toEqual([]);
  expect(
    screen.getByText('Ничего не найдено. Измените поиск или статус.'),
  ).toBeVisible();
  expect(
    screen.queryByText('В проекте пока нет задач.'),
  ).not.toBeInTheDocument();
  await user.keyboard('{Escape}');
  expect(search).toHaveValue('');
  expect(search).toHaveFocus();
  expect(ids()).toEqual([root.id, group.id, a.id, b.id, done.id]);
  await user.type(search, 'Монтаж A');
  await user.click(screen.getByRole('button', { name: 'Список' }));
  const first = screen.getByRole('treeitem', { name: /Этап A,/ });
  first.focus();
  await user.keyboard('{ArrowDown}{ArrowDown}');
  expect(screen.getByRole('treeitem', { name: /Монтаж A,/ })).toHaveFocus();
  await user.keyboard('{Enter}');
  expect(screen.getByRole('complementary', { name: 'Задача' })).toBeVisible();
});

it('preserves selected dirty panel and quick draft when filtering hides the task', async () => {
  await open();
  const user = userEvent.setup();
  await user.type(screen.getByLabelText('Новая задача'), 'Быстрый черновик');
  await user.click(screen.getByRole('treeitem', { name: /Монтаж A,/ }));
  await user.type(screen.getByLabelText('Описание'), 'Черновик панели');
  const requests = fetchMock.mock.calls.length;
  await user.type(screen.getByRole('searchbox'), 'Готовая');
  expect(ids()).toEqual([done.id]);
  expect(screen.getByLabelText('Описание')).toHaveValue('Черновик панели');
  expect(screen.getByLabelText('Новая задача')).toHaveValue('Быстрый черновик');
  await user.keyboard('{Escape}');
  expect(screen.getByRole('searchbox')).toHaveValue('');
  expect(screen.getByLabelText('Описание')).toHaveValue('Черновик панели');
  expect(fetchMock.mock.calls).toHaveLength(requests);
});

it('resets filters on a project switch and uses the actual empty-project message', async () => {
  await open();
  const user = userEvent.setup();
  await user.type(screen.getByRole('searchbox'), 'Монтаж');
  await user.click(screen.getByRole('button', { name: 'Фильтры' }));
  await user.selectOptions(
    screen.getByRole('combobox', { name: 'Фильтр по статусу' }),
    'doing',
  );
  await user.click(screen.getByRole('button', { name: /Другой демо-проект/ }));
  await screen.findByRole('heading', { name: other.title });
  await waitFor(() => expect(screen.getByRole('searchbox')).toHaveValue(''));
  expect(screen.getByRole('button', { name: 'Фильтры' })).toHaveAttribute(
    'aria-expanded',
    'false',
  );
  expect(screen.getByText('В проекте пока нет задач.')).toBeVisible();
  expect(
    screen.queryByText('Ничего не найдено. Измените поиск или статус.'),
  ).not.toBeInTheDocument();
});

it('clears filters before showing a hidden selected task on Gantt', async () => {
  await open();
  const user = userEvent.setup();
  await user.click(screen.getByRole('treeitem', { name: /Монтаж A,/ }));
  await user.click(screen.getByRole('tab', { name: 'Зависимости' }));
  await user.type(
    screen.getByRole('searchbox', { name: 'Поиск задач' }),
    'Готовая',
  );
  expect(ids()).toEqual([done.id]);
  await user.click(screen.getByRole('button', { name: 'Показать на Ганте' }));
  expect(screen.getByRole('searchbox', { name: 'Поиск задач' })).toHaveValue(
    '',
  );
  expect(ids()).toEqual([root.id, group.id, a.id, b.id, done.id]);
});

it('keeps query and dirty draft through conflict loading and disables only the loading controls', async () => {
  await open();
  const user = userEvent.setup();
  const search = screen.getByRole('searchbox', { name: 'Поиск задач' });
  await user.type(search, 'Монтаж A');
  await user.click(screen.getByRole('treeitem', { name: /Монтаж A,/ }));
  await user.type(screen.getByLabelText('Описание'), 'Черновик');
  fetchMock.mockImplementationOnce(() =>
    Promise.resolve(
      new Response(
        JSON.stringify({
          code: 'REVISION_CONFLICT',
          message: 'Проект изменён.',
        }),
        { status: 409 },
      ),
    ),
  );
  await user.click(screen.getByRole('button', { name: 'Сохранить' }));
  const reload = await screen.findByRole('button', {
    name: 'Загрузить актуальный проект',
  });
  let reply!: (response: Response) => void;
  fetchMock.mockImplementationOnce(
    () =>
      new Promise<Response>((resolve) => {
        reply = resolve;
      }),
  );
  await user.click(reload);
  expect(search).toBeDisabled();
  expect(screen.getByRole('button', { name: 'Фильтры' })).toBeDisabled();
  expect(
    screen.queryByRole('combobox', { name: 'Фильтр по статусу' }),
  ).toBeNull();
  expect(screen.getByLabelText('Описание')).toHaveValue('Черновик');
  reply(
    new Response(
      JSON.stringify({ ...tree, project: { ...tree.project, revision: 1 } }),
    ),
  );
  await waitFor(() => expect(search).toBeEnabled());
  expect(search).toHaveValue('Монтаж A');
  expect(screen.getByLabelText('Описание')).toHaveValue('Черновик');
  expect(ids()).toEqual([root.id, group.id, a.id]);
});

it('allows display filtering after an uncertain offline save without hiding the error or draft', async () => {
  await open();
  const user = userEvent.setup();
  await user.click(screen.getByRole('treeitem', { name: /Монтаж A,/ }));
  await user.type(screen.getByLabelText('Описание'), 'Черновик offline');
  fetchMock.mockImplementationOnce(() =>
    Promise.reject(new TypeError('synthetic offline')),
  );
  await user.click(screen.getByRole('button', { name: 'Сохранить' }));
  await screen.findByText(/Нет связи с сервером/);
  const requests = fetchMock.mock.calls.length;
  await user.type(
    screen.getByRole('searchbox', { name: 'Поиск задач' }),
    'Готовая',
  );
  expect(ids()).toEqual([done.id]);
  expect(screen.getByText(/Нет связи с сервером/)).toBeVisible();
  expect(screen.getByLabelText('Описание')).toHaveValue('Черновик offline');
  expect(fetchMock.mock.calls).toHaveLength(requests);
});
