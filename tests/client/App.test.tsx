// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { App } from '../../src/client/App.js';
import type {
  CommandEnvelope,
  ProjectTree,
  Task,
} from '../../src/shared/contracts.js';

// Independent synthetic HTTP fixtures; no domain/tree implementation builds them.
const project = {
  id: '11111111-1111-4111-8111-111111111111',
  title: 'Демо-проект',
  revision: 0,
  createdAt: '2026-10-07T00:00:00.000Z',
  updatedAt: '2026-10-07T00:00:00.000Z',
};
const id = (n: number) =>
  `22222222-2222-4222-8222-${String(n).padStart(12, '0')}`;
const task = (
  n: number,
  title: string,
  parentId: string | null = null,
  sortOrder = 0,
): Task => ({
  id: id(n),
  projectId: project.id,
  parentId,
  title,
  description: '',
  sortOrder,
  status: 'todo',
  inputStart: null,
  inputFinish: null,
  createdAt: project.createdAt,
  updatedAt: project.updatedAt,
});
let tree: ProjectTree;
let commands: CommandEnvelope[];
let fetchMock: ReturnType<typeof vi.fn>;
const json = (body: unknown, status = 200) =>
  Promise.resolve(
    new Response(JSON.stringify(body), {
      status,
      headers: { 'Content-Type': 'application/json' },
    }),
  );
beforeEach(() => {
  tree = { project: { ...project }, tasks: [], canUndo: false };
  commands = [];
  fetchMock = vi.fn((url: string, init?: RequestInit) => {
    if (url === '/api/auth/session')
      return json({ authenticated: true, setupRequired: false });
    if (url === '/api/auth/logout')
      return json({ authenticated: false, setupRequired: false });
    if (url === '/api/projects') {
      if (init?.method === 'POST') {
        tree = {
          project: {
            ...project,
            id: '33333333-3333-4333-8333-333333333333',
            title: JSON.parse(String(init.body)).title,
          },
          tasks: [],
          canUndo: false,
        };
        return json(tree.project);
      }
      return json([tree.project]);
    }
    if (url.endsWith('/tree')) return json(tree);
    if (init?.method === 'PATCH') {
      tree = {
        ...tree,
        project: {
          ...tree.project,
          title: JSON.parse(String(init.body)).title,
          revision: tree.project.revision + 1,
        },
      };
      return json(tree);
    }
    if (url.endsWith('/commands')) {
      const envelope = JSON.parse(String(init?.body)) as CommandEnvelope;
      commands.push(envelope);
      const command = envelope.command;
      if (command.type === 'task.create')
        tree.tasks.push(
          task(
            50 + commands.length,
            command.title,
            command.parentId,
            tree.tasks.length,
          ),
        );
      if (command.type === 'task.update')
        tree.tasks = tree.tasks.map((t) =>
          t.id === command.taskId
            ? ({
                ...t,
                ...Object.fromEntries(
                  Object.entries(command.changes).filter(
                    ([, value]) => value !== undefined,
                  ),
                ),
              } as Task)
            : t,
        );
      if (command.type === 'task.delete')
        tree.tasks = tree.tasks.filter((t) => t.id !== command.taskId);
      tree = {
        ...tree,
        project: { ...tree.project, revision: tree.project.revision + 1 },
        canUndo: true,
      };
      return json(tree);
    }
    return json(
      { code: 'TEST_UNEXPECTED_ROUTE', message: 'Непредвиденный маршрут.' },
      400,
    );
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
  render(<App />);
  await screen.findByRole('heading', { name: project.title });
}

describe('client HTTP interactions', () => {
  it('shows loading, empty project and creation confirmed by the server', async () => {
    render(<App />);
    expect(screen.getByRole('status')).toHaveTextContent('Загрузка');
    await screen.findByText('В проекте пока нет задач.');
    const user = userEvent.setup();
    await user.type(screen.getByLabelText('Новая задача'), 'Задача A{Enter}');
    await screen.findByRole('treeitem', { name: /Задача A/ });
    expect(commands[0]).toMatchObject({
      expectedRevision: 0,
      command: { type: 'task.create', title: 'Задача A', parentId: null },
    });
    expect(commands[0]?.operationId).toMatch(/^[\da-f-]{36}$/);
    expect(
      fetchMock.mock.calls.find(([url]) =>
        String(url).endsWith('/commands'),
      )?.[1],
    ).toMatchObject({
      headers: { 'Content-Type': 'application/json' },
      credentials: 'same-origin',
    });
  });
  it('shows setup-needed and login states without local browser persistence', async () => {
    fetchMock.mockImplementationOnce(() =>
      json({ authenticated: false, setupRequired: true }),
    );
    const view = render(<App />);
    await screen.findByText(/admin:setup/);
    expect(screen.queryByLabelText('Пароль')).not.toBeInTheDocument();
    view.unmount();
    fetchMock.mockImplementationOnce(() =>
      json({ authenticated: false, setupRequired: false }),
    );
    render(<App />);
    await screen.findByLabelText('Пароль');
    fetchMock.mockImplementationOnce(() =>
      json({ authenticated: true, setupRequired: false }),
    );
    const user = userEvent.setup();
    await user.type(screen.getByLabelText('Пароль'), 'synthetic-test-password');
    await user.click(screen.getByRole('button', { name: 'Войти' }));
    await screen.findByRole('heading', { name: project.title });
  });
  it('retries a loading failure explicitly', async () => {
    fetchMock.mockImplementationOnce(() =>
      Promise.reject(new TypeError('synthetic offline')),
    );
    render(<App />);
    await screen.findByRole('alert');
    await userEvent.click(screen.getByRole('button', { name: 'Повторить' }));
    await screen.findByRole('heading', { name: project.title });
  });
  it('navigates and collapses a 40-level tree without hiding hierarchy', async () => {
    tree.tasks = Array.from({ length: 40 }, (_, n) =>
      task(n + 1, `Уровень ${n + 1}`, n === 0 ? null : id(n)),
    );
    await open();
    expect(screen.getAllByRole('treeitem')).toHaveLength(40);
    const root = screen.getByRole('treeitem', { name: /Уровень 1,/ });
    root.focus();
    const user = userEvent.setup();
    await user.keyboard('{ArrowLeft}');
    expect(screen.getAllByRole('treeitem')).toHaveLength(1);
    await user.keyboard('{ArrowRight}{ArrowDown}{Enter}');
    expect(
      screen.getByRole('complementary', { name: 'Задача' }),
    ).toBeInTheDocument();
    expect(screen.getByLabelText('Название задачи')).toHaveValue('Уровень 2');
    await user.keyboard('{Escape}');
    expect(
      screen.queryByRole('complementary', { name: 'Задача' }),
    ).not.toBeInTheDocument();
    expect(screen.getByRole('treeitem', { name: /Уровень 2,/ })).toHaveFocus();
  });
  it('preserves failed drafts, blocks selection loss and retries the exact uncertain envelope', async () => {
    tree.tasks = [task(1, 'Задача A'), task(2, 'Задача B', null, 1)];
    await open();
    const user = userEvent.setup();
    await user.click(screen.getByRole('treeitem', { name: /Задача A,/ }));
    await user.clear(screen.getByLabelText('Название задачи'));
    await user.type(screen.getByLabelText('Название задачи'), 'Новое название');
    await user.click(screen.getByRole('treeitem', { name: /Задача B,/ }));
    expect(screen.getByLabelText('Название задачи')).toHaveValue(
      'Новое название',
    );
    expect(screen.getByRole('alert')).toHaveTextContent(/несохранённые/i);
    fetchMock.mockImplementationOnce(() =>
      Promise.reject(new TypeError('synthetic offline')),
    );
    await user.click(screen.getByRole('button', { name: 'Сохранить' }));
    await screen.findByText(/Нет связи с сервером/);
    expect(screen.getByLabelText('Название задачи')).toHaveValue(
      'Новое название',
    );
    expect(screen.queryByText('Сохранено')).not.toBeInTheDocument();
    const first = fetchMock.mock.calls
      .filter(([url]) => String(url).endsWith('/commands'))
      .at(-1)?.[1]?.body;
    await user.click(
      screen.getByRole('button', { name: 'Повторить сохранение' }),
    );
    await screen.findByText('Сохранено');
    const retry = fetchMock.mock.calls
      .filter(([url]) => String(url).endsWith('/commands'))
      .at(-1)?.[1]?.body;
    expect(retry).toBe(first);
    expect(commands).toHaveLength(1);
  });
  it('reloads a conflict explicitly while retaining the unsaved panel values', async () => {
    tree.tasks = [task(1, 'Задача A')];
    await open();
    const user = userEvent.setup();
    await user.click(screen.getByRole('treeitem', { name: /Задача A,/ }));
    await user.type(screen.getByLabelText('Описание'), 'Черновик');
    fetchMock.mockImplementationOnce(() =>
      json({ code: 'STALE_REVISION', message: 'Проект изменён.' }, 409),
    );
    await user.click(screen.getByRole('button', { name: 'Сохранить' }));
    await screen.findByText(/Проект изменён/);
    tree = { ...tree, project: { ...project, revision: 9 } };
    await user.click(
      screen.getByRole('button', { name: 'Загрузить актуальный проект' }),
    );
    await waitFor(() =>
      expect(
        fetchMock.mock.calls.filter(([url]) => String(url).endsWith('/tree')),
      ).toHaveLength(2),
    );
    expect(screen.getByLabelText('Описание')).toHaveValue('Черновик');
    await user.click(screen.getByRole('button', { name: 'Сохранить' }));
    await screen.findByText('Сохранено');
    expect(commands[0]?.expectedRevision).toBe(9);
  });
  it('changes quick input depth with Tab only there; ordinary form Tab stays native', async () => {
    tree.tasks = [task(1, 'Задача A')];
    await open();
    const user = userEvent.setup();
    const input = screen.getByLabelText('Новая задача');
    await user.click(input);
    await user.type(input, 'Ребёнок');
    await user.tab();
    expect(input).toHaveFocus();
    expect(screen.getByText('Родитель: Задача A')).toBeInTheDocument();
    await user.tab({ shift: true });
    expect(input).toHaveFocus();
    expect(screen.getByText('Родитель: Корень проекта')).toBeInTheDocument();
    await user.tab();
    await user.keyboard('{Enter}');
    await screen.findByRole('treeitem', { name: /Ребёнок,/ });
    expect(commands[0]?.command).toMatchObject({ parentId: id(1) });
    await user.click(screen.getByRole('treeitem', { name: /Задача A,/ }));
    screen.getByLabelText('Название задачи').focus();
    await user.tab();
    expect(screen.getByLabelText('Статус')).toHaveFocus();
    expect(screen.getByLabelText('Начало')).toBeDisabled();
  });
  it('confirms preserving dated work and uses the same tree in subtasks', async () => {
    tree.tasks = [{ ...task(1, 'Задача A'), inputStart: '2026-10-07' }];
    await open();
    const user = userEvent.setup();
    await user.click(screen.getByRole('treeitem', { name: /Задача A,/ }));
    await user.click(
      screen.getByRole('button', { name: 'Добавить подзадачу' }),
    );
    await user.type(screen.getByLabelText('Новая задача'), 'Подзадача{Enter}');
    await screen.findByRole('treeitem', { name: /Подзадача,/ });
    expect(window.confirm).toHaveBeenCalledWith(
      expect.stringContaining('сохранить'),
    );
    expect(commands[0]?.command).toMatchObject({ preserveWork: true });
    await user.click(screen.getByRole('tab', { name: 'Подзадачи' }));
    expect(
      within(screen.getByRole('complementary', { name: 'Задача' })).getByRole(
        'tree',
        { name: 'Подзадачи' },
      ),
    ).toBeInTheDocument();
  });
  it('offers keyboard branch deletion and server undo', async () => {
    tree.tasks = [task(1, 'Задача A')];
    await open();
    const user = userEvent.setup();
    screen.getByRole('treeitem', { name: /Задача A,/ }).focus();
    await user.keyboard('{Delete}');
    await screen.findByText('В проекте пока нет задач.');
    expect(screen.getByLabelText('Новая задача')).toHaveFocus();
    expect(window.confirm).toHaveBeenCalled();
    expect(commands[0]?.command).toMatchObject({
      type: 'task.delete',
      taskId: id(1),
    });
    await user.click(
      screen.getByRole('button', { name: 'Отменить последнее изменение' }),
    );
    await waitFor(() => expect(commands[1]?.command).toEqual({ type: 'undo' }));
  });
  it('clears a quick draft only after an uncertain create is confirmed by exact retry', async () => {
    await open();
    const user = userEvent.setup();
    fetchMock.mockImplementationOnce(() =>
      Promise.reject(new TypeError('synthetic offline')),
    );
    await user.type(screen.getByLabelText('Новая задача'), 'Задача A{Enter}');
    await screen.findByText(/Нет связи с сервером/);
    expect(screen.getByLabelText('Новая задача')).toHaveValue('Задача A');
    const firstBody = fetchMock.mock.calls
      .filter(([url]) => String(url).endsWith('/commands'))
      .at(-1)?.[1]?.body;
    await user.click(screen.getByRole('button', { name: 'Повторить' }));
    await screen.findByRole('treeitem', { name: /Задача A,/ });
    expect(screen.getByLabelText('Новая задача')).toHaveValue('');
    expect(
      fetchMock.mock.calls
        .filter(([url]) => String(url).endsWith('/commands'))
        .at(-1)?.[1]?.body,
    ).toBe(firstBody);
    expect(commands).toHaveLength(1);
  });
  it('prevents duplicate panel submissions while awaiting the server', async () => {
    tree.tasks = [task(1, 'Задача A')];
    await open();
    const user = userEvent.setup();
    await user.click(screen.getByRole('treeitem', { name: /Задача A,/ }));
    await user.type(screen.getByLabelText('Описание'), 'Черновик');
    let resolve!: (value: Response) => void;
    const response = new Promise<Response>((done) => {
      resolve = done;
    });
    fetchMock.mockImplementationOnce(() => response);
    await user.dblClick(screen.getByRole('button', { name: 'Сохранить' }));
    expect(screen.getByLabelText('Описание')).toBeDisabled();
    expect(screen.queryByText('Сохранено')).not.toBeInTheDocument();
    expect(
      fetchMock.mock.calls.filter(([url]) => String(url).endsWith('/commands')),
    ).toHaveLength(1);
    resolve(
      new Response(
        JSON.stringify({
          ...tree,
          project: { ...project, revision: 1 },
          tasks: [{ ...tree.tasks[0]!, description: 'Черновик' }],
        }),
      ),
    );
    await screen.findByText('Сохранено');
  });
  it('retains a draft if a conflict reload reveals the selected task was deleted', async () => {
    tree.tasks = [task(1, 'Задача A')];
    await open();
    const user = userEvent.setup();
    await user.click(screen.getByRole('treeitem', { name: /Задача A,/ }));
    await user.type(screen.getByLabelText('Описание'), 'Черновик');
    fetchMock.mockImplementationOnce(() =>
      json({ code: 'STALE_REVISION', message: 'Проект изменён.' }, 409),
    );
    await user.click(screen.getByRole('button', { name: 'Сохранить' }));
    tree = { ...tree, tasks: [], project: { ...project, revision: 1 } };
    await user.click(
      await screen.findByRole('button', {
        name: 'Загрузить актуальный проект',
      }),
    );
    await screen.findByText(/Выбранная задача удалена/);
    expect(screen.getByLabelText('Описание')).toHaveValue('Черновик');
    expect(screen.getByRole('button', { name: 'Сохранить' })).toBeDisabled();
    await user.click(
      screen.getByRole('button', { name: 'Отбросить изменения' }),
    );
    await user.keyboard('{Escape}');
    expect(screen.getByLabelText('Новая задача')).toHaveFocus();
  });
  it('does not apply a tree response older than the current revision', async () => {
    tree.project.revision = 5;
    tree.tasks = [task(1, 'Задача A')];
    await open();
    const user = userEvent.setup();
    await user.click(screen.getByRole('treeitem', { name: /Задача A,/ }));
    await user.type(screen.getByLabelText('Описание'), 'Черновик');
    fetchMock.mockImplementationOnce(() =>
      json({ code: 'STALE_REVISION', message: 'Проект изменён.' }, 409),
    );
    await user.click(screen.getByRole('button', { name: 'Сохранить' }));
    tree = {
      ...tree,
      project: { ...project, revision: 2 },
      tasks: [task(2, 'Старый снимок')],
    };
    await user.click(
      await screen.findByRole('button', {
        name: 'Загрузить актуальный проект',
      }),
    );
    await screen.findByRole('treeitem', { name: /Задача A,/ });
    expect(
      screen.queryByRole('treeitem', { name: /Старый снимок,/ }),
    ).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Сохранить' }));
    await waitFor(() => expect(commands).toHaveLength(1));
    expect(commands[0]?.expectedRevision).toBe(5);
  });
  it('provides keyboard moves and excludes descendants from the parent picker', async () => {
    tree.tasks = [
      task(1, 'Задача A'),
      task(2, 'Задача B', null, 1),
      task(3, 'Ребёнок B', id(2)),
    ];
    await open();
    const user = userEvent.setup();
    const row = screen.getByRole('treeitem', { name: /Задача B,/ });
    row.focus();
    await user.keyboard('{Alt>}{ArrowRight}{/Alt}');
    await waitFor(() =>
      expect(commands[0]?.command).toMatchObject({
        type: 'task.move',
        taskId: id(2),
        parentId: id(1),
        position: 0,
      }),
    );
    await user.click(row);
    const picker = screen.getByLabelText('Новый родитель');
    expect(
      within(picker).queryByRole('option', { name: 'Ребёнок B' }),
    ).not.toBeInTheDocument();
    expect(
      within(picker).queryByRole('option', { name: 'Задача B' }),
    ).not.toBeInTheDocument();
  });
  it('permits cancelling the dated-work conversion before any command', async () => {
    tree.tasks = [{ ...task(1, 'Задача A'), inputFinish: '2026-10-07' }];
    await open();
    const user = userEvent.setup();
    await user.click(screen.getByRole('treeitem', { name: /Задача A,/ }));
    await user.click(
      screen.getByRole('button', { name: 'Добавить подзадачу' }),
    );
    vi.mocked(window.confirm).mockReturnValueOnce(false);
    await user.type(screen.getByLabelText('Новая задача'), 'Ребёнок{Enter}');
    expect(commands).toHaveLength(0);
    expect(screen.getByLabelText('Новая задача')).toHaveValue('Ребёнок');
  });
  it('creates and renames a project through HTTP without invented controls', async () => {
    fetchMock.mockImplementationOnce(() =>
      json({ authenticated: true, setupRequired: false }),
    );
    fetchMock.mockImplementationOnce(() => json([]));
    render(<App />);
    await screen.findByText('Создайте первый проект.');
    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: 'Новый проект' }));
    await user.type(
      screen.getByLabelText('Название проекта'),
      'Новый демо-проект',
    );
    await user.click(screen.getByRole('button', { name: 'Создать проект' }));
    await screen.findByRole('heading', { name: 'Новый демо-проект' });
    await user.click(
      screen.getByRole('button', { name: 'Переименовать проект' }),
    );
    await user.clear(screen.getByLabelText('Название проекта'));
    await user.type(
      screen.getByLabelText('Название проекта'),
      'Переименованный проект',
    );
    await user.click(
      within(
        screen.getByLabelText('Название проекта').closest('form')!,
      ).getByRole('button', { name: 'Переименовать проект' }),
    );
    await screen.findByRole('heading', { name: 'Переименованный проект' });
    const patch = fetchMock.mock.calls.find(
      ([, init]) => init?.method === 'PATCH',
    );
    expect(JSON.parse(String(patch?.[1]?.body))).toMatchObject({
      expectedRevision: 0,
      title: 'Переименованный проект',
    });
    expect(screen.queryByText('Гант')).not.toBeInTheDocument();
    expect(screen.queryByText('Доска')).not.toBeInTheDocument();
  });
  it('keeps the real parent when creating a sibling from the reused subtask tree', async () => {
    tree.tasks = [task(1, 'Задача A'), task(2, 'Ребёнок A', id(1))];
    await open();
    const user = userEvent.setup();
    await user.click(screen.getByRole('treeitem', { name: /Задача A,/ }));
    await user.click(screen.getByRole('tab', { name: 'Подзадачи' }));
    const childRow = within(
      screen.getByRole('complementary', { name: 'Задача' }),
    ).getByRole('treeitem', { name: /Ребёнок A,/ });
    childRow.focus();
    await user.keyboard('{Insert}');
    await user.type(
      screen.getByLabelText('Новая задача'),
      'Сосед ребёнка{Enter}',
    );
    await waitFor(() => expect(commands).toHaveLength(1));
    expect(commands[0]?.command).toMatchObject({
      type: 'task.create',
      parentId: id(1),
      afterId: id(2),
    });
  });
  it('puts panel save errors inside the panel and allows leaving the quick editor with Esc', async () => {
    tree.tasks = [task(1, 'Задача A')];
    await open();
    const user = userEvent.setup();
    const quick = screen.getByLabelText('Новая задача');
    await user.click(quick);
    await user.type(quick, 'Черновик');
    await user.keyboard('{Escape}');
    await user.tab();
    expect(quick).not.toHaveFocus();
    await user.clear(quick);
    await user.click(screen.getByRole('treeitem', { name: /Задача A,/ }));
    await user.type(screen.getByLabelText('Описание'), 'Черновик');
    fetchMock.mockImplementationOnce(() =>
      json(
        { code: 'INVALID_REQUEST', message: 'Проверьте поля запроса.' },
        400,
      ),
    );
    await user.click(screen.getByRole('button', { name: 'Сохранить' }));
    expect(
      await within(
        screen.getByRole('complementary', { name: 'Задача' }),
      ).findByRole('alert'),
    ).toHaveTextContent('Проверьте поля запроса.');
    expect(screen.getByLabelText('Описание')).toHaveValue('Черновик');
  });
  it('saves title, status, description and optional dates, then clears a date to null', async () => {
    tree.tasks = [task(1, 'Задача A')];
    await open();
    const user = userEvent.setup();
    await user.click(screen.getByRole('treeitem', { name: /Задача A,/ }));
    await user.clear(screen.getByLabelText('Название задачи'));
    await user.type(screen.getByLabelText('Название задачи'), 'Задача A1');
    await user.type(
      screen.getByLabelText('Описание'),
      'Синтетическое описание',
    );
    await user.selectOptions(screen.getByLabelText('Статус'), 'doing');
    fireEvent.change(screen.getByLabelText('Начало'), {
      target: { value: '2026-10-07' },
    });
    fireEvent.change(screen.getByLabelText('Окончание'), {
      target: { value: '2026-10-08' },
    });
    await user.click(screen.getByRole('button', { name: 'Сохранить' }));
    await screen.findByText('Сохранено');
    expect(commands[0]?.command).toMatchObject({
      type: 'task.update',
      taskId: id(1),
      changes: {
        title: 'Задача A1',
        description: 'Синтетическое описание',
        status: 'doing',
        inputStart: '2026-10-07',
        inputFinish: '2026-10-08',
      },
    });
    fireEvent.change(screen.getByLabelText('Начало'), {
      target: { value: '' },
    });
    await user.click(screen.getByRole('button', { name: 'Сохранить' }));
    await screen.findByText('Сохранено');
    expect(commands[1]).toMatchObject({
      expectedRevision: 1,
      command: { changes: { inputStart: null } },
    });
  });
  it('blocks switching projects while dirty and allows it after explicit discard', async () => {
    const other = {
      ...project,
      id: '44444444-4444-4444-8444-444444444444',
      title: 'Другой демо-проект',
    };
    tree.tasks = [task(1, 'Задача A')];
    fetchMock.mockImplementationOnce(() =>
      json({ authenticated: true, setupRequired: false }),
    );
    fetchMock.mockImplementationOnce(() => json([project, other]));
    await open();
    const user = userEvent.setup();
    await user.click(screen.getByRole('treeitem', { name: /Задача A,/ }));
    await user.type(screen.getByLabelText('Описание'), 'Черновик');
    await user.click(
      screen.getByRole('button', { name: /Другой демо-проект/ }),
    );
    expect(screen.getByRole('alert')).toHaveTextContent(/несохранённые/);
    expect(screen.getByLabelText('Описание')).toHaveValue('Черновик');
    expect(
      fetchMock.mock.calls.filter(([url]) => String(url).endsWith('/tree')),
    ).toHaveLength(1);
    await user.click(
      screen.getByRole('button', { name: 'Отбросить изменения' }),
    );
    fetchMock.mockImplementationOnce(() =>
      json({ project: other, tasks: [], canUndo: false }),
    );
    await user.click(
      screen.getByRole('button', { name: /Другой демо-проект/ }),
    );
    await screen.findByRole('heading', { name: 'Другой демо-проект' });
    expect(
      screen.queryByRole('complementary', { name: 'Задача' }),
    ).not.toBeInTheDocument();
  });
  it('logs out with a JSON request and returns to the login form', async () => {
    await open();
    await userEvent.click(screen.getByRole('button', { name: 'Выйти' }));
    await screen.findByLabelText('Пароль');
    const call = fetchMock.mock.calls.find(
      ([url]) => url === '/api/auth/logout',
    );
    expect(call?.[1]).toMatchObject({
      method: 'POST',
      body: '{}',
      credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json' },
    });
    expect(screen.queryByRole('tree')).not.toBeInTheDocument();
  });
});
