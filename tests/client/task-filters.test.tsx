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
  expect(
    screen.getByRole('combobox', { name: 'Фильтр по статусу' }),
  ).toHaveValue('all');
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
  await user.click(screen.getByRole('checkbox', { name: 'Гант' }));
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
  await user.selectOptions(
    screen.getByRole('combobox', { name: 'Фильтр по статусу' }),
    'doing',
  );
  await user.click(screen.getByRole('button', { name: /Другой демо-проект/ }));
  await screen.findByRole('heading', { name: other.title });
  await waitFor(() => expect(screen.getByRole('searchbox')).toHaveValue(''));
  expect(
    screen.getByRole('combobox', { name: 'Фильтр по статусу' }),
  ).toHaveValue('all');
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
  expect(
    screen.getByRole('combobox', { name: 'Фильтр по статусу' }),
  ).toBeDisabled();
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
