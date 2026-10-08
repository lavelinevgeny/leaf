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

  calendarType: 'weekdays' as const,
  timezone: 'UTC',
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

  durationDays: null,

  inputStart: null,
  inputFinish: null,
  createdAt: project.createdAt,
  updatedAt: project.updatedAt,
});
const emptySchedule: ProjectTree['schedule'] = {
  analysisStatus: 'pending-policy',
  display: {},
  feasibility: 'feasible',

  coverage: { knownLeafCount: 0, totalLeafCount: 0 },
  tasks: {},
  summaries: {},
  criticalTaskIds: [],
  criticalDependencyIds: [],
  diagnostics: [],
};
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
  tree = {
    contractVersion: 2,
    project: { ...project },
    tasks: [],
    canUndo: false,
    dependencies: [],
    schedule: structuredClone(emptySchedule),
  };
  commands = [];
  fetchMock = vi.fn((url: string, init?: RequestInit) => {
    if (url === '/api/auth/session')
      return json({ authenticated: true, setupRequired: false });
    if (url === '/api/auth/logout')
      return json({ authenticated: false, setupRequired: false });
    if (url === '/api/projects') {
      if (init?.method === 'POST') {
        tree = {
          contractVersion: 2,
          project: {
            ...project,
            id: '33333333-3333-4333-8333-333333333333',
            title: JSON.parse(String(init.body)).title,
          },
          tasks: [],
          canUndo: false,
          dependencies: [],
          schedule: structuredClone(emptySchedule),
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
      if (command.type === 'task.update' || command.type === 'task.edit')
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
  it('adds nested work inside the subtasks tab without retargeting the main quick draft', async () => {
    tree.tasks = [task(1, 'Этап'), task(2, 'Ребёнок', id(1))];
    await open();
    const user = userEvent.setup();
    const mainInput = screen.getByLabelText('Новая задача');
    await user.type(mainInput, 'Главный черновик');
    await user.click(screen.getByRole('treeitem', { name: /^Этап,/ }));
    await user.click(screen.getByRole('tab', { name: 'Подзадачи' }));
    const panel = within(screen.getByRole('complementary', { name: 'Задача' }));
    const input = panel.getByLabelText('Новая задача');
    await user.type(input, 'Новая работа');
    await user.keyboard('{Shift>}{Tab}{/Shift}');
    expect(panel.getByText('Родитель: Этап')).toBeInTheDocument();
    await user.keyboard('{Tab}');
    expect(panel.getByText('Родитель: Ребёнок')).toBeInTheDocument();
    await user.keyboard('{Enter}');
    await waitFor(() => expect(input).toHaveValue(''));
    expect(input).toHaveFocus();
    expect(mainInput).toHaveValue('Главный черновик');
    expect(commands[0]?.command).toEqual({
      type: 'task.create',
      title: 'Новая работа',
      parentId: id(2),
    });
    expect(
      panel.getByRole('treeitem', { name: /^Новая работа,/ }),
    ).toHaveAttribute('aria-level', '2');
    expect(panel.getByRole('tab', { name: 'Подзадачи' })).toHaveAttribute(
      'aria-selected',
      'true',
    );
  });

  it('returns through nested panels to the originating subtask row and keeps its quick draft', async () => {
    tree.tasks = [
      task(1, 'Этап'),
      task(2, 'Ребёнок', id(1)),
      task(3, 'Внук', id(2)),
    ];
    await open();
    const user = userEvent.setup();
    const mainTree = within(screen.getByRole('tree', { name: 'Задачи' }));
    await user.click(mainTree.getByRole('button', { name: 'Свернуть Этап' }));
    await user.click(mainTree.getByRole('treeitem', { name: /^Этап,/ }));
    await user.click(screen.getByRole('tab', { name: 'Подзадачи' }));
    let panel = within(screen.getByRole('complementary', { name: 'Задача' }));
    await user.type(panel.getByLabelText('Новая задача'), 'Черновик этапа');
    await user.click(panel.getByRole('treeitem', { name: /^Ребёнок,/ }));
    await user.click(screen.getByRole('tab', { name: 'Подзадачи' }));
    panel = within(screen.getByRole('complementary', { name: 'Задача' }));
    await user.click(panel.getByRole('treeitem', { name: /^Внук,/ }));
    await user.click(screen.getByRole('button', { name: 'Назад: Ребёнок' }));
    await waitFor(() =>
      expect(
        screen
          .getByRole('tree', { name: 'Подзадачи' })
          .querySelector('[data-task-id="' + id(3) + '"]'),
      ).toHaveFocus(),
    );
    await user.click(screen.getByRole('button', { name: 'Назад: Этап' }));
    panel = within(screen.getByRole('complementary', { name: 'Задача' }));
    await waitFor(() =>
      expect(panel.getByRole('treeitem', { name: /^Ребёнок,/ })).toHaveFocus(),
    );
    expect(panel.getByLabelText('Новая задача')).toHaveValue('Черновик этапа');
    await user.keyboard('{Escape}');
    expect(mainTree.getByRole('treeitem', { name: /^Этап,/ })).toHaveFocus();
    expect(
      mainTree.queryByRole('treeitem', { name: /^Ребёнок,/ }),
    ).not.toBeInTheDocument();
    expect(commands).toHaveLength(0);
  });

  it('keeps a subtask create draft through a lost response and clears only that draft after exact retry', async () => {
    tree.tasks = [task(1, 'Этап')];
    await open();
    const user = userEvent.setup();
    const mainInput = screen.getByLabelText('Новая задача');
    await user.type(mainInput, 'Главный черновик');
    await user.click(screen.getByRole('treeitem', { name: /^Этап,/ }));
    await user.click(screen.getByRole('tab', { name: 'Подзадачи' }));
    const panel = within(screen.getByRole('complementary', { name: 'Задача' }));
    expect(panel.getByText('Подзадач пока нет.')).toBeInTheDocument();
    fetchMock.mockImplementationOnce(() =>
      Promise.reject(new TypeError('synthetic offline')),
    );
    await user.type(panel.getByLabelText('Новая задача'), 'Ребёнок{Enter}');
    await panel.findByText(/Нет связи с сервером/);
    expect(panel.getByLabelText('Новая задача')).toHaveValue('Ребёнок');
    expect(panel.getByLabelText('Новая задача')).toBeDisabled();
    const firstBody = fetchMock.mock.calls
      .filter(([url]) => String(url).endsWith('/commands'))
      .at(-1)?.[1]?.body;
    await user.click(panel.getByRole('button', { name: 'Повторить' }));
    await panel.findByRole('treeitem', { name: /^Ребёнок,/ });
    expect(
      fetchMock.mock.calls
        .filter(([url]) => String(url).endsWith('/commands'))
        .at(-1)?.[1]?.body,
    ).toBe(firstBody);
    expect(panel.getByLabelText('Новая задача')).toHaveValue('');
    expect(mainInput).toHaveValue('Главный черновик');
    expect(commands).toHaveLength(1);
  });

  it('restores focus to the subtask input after deleting its last row', async () => {
    tree.tasks = [task(1, 'Этап'), task(2, 'Ребёнок', id(1))];
    await open();
    const user = userEvent.setup();
    await user.click(screen.getByRole('treeitem', { name: /^Этап,/ }));
    await user.click(screen.getByRole('tab', { name: 'Подзадачи' }));
    const panel = within(screen.getByRole('complementary', { name: 'Задача' }));
    panel.getByRole('treeitem', { name: /^Ребёнок,/ }).focus();
    await user.keyboard('{Delete}');
    await panel.findByText('Подзадач пока нет.');
    await waitFor(() =>
      expect(panel.getByLabelText('Новая задача')).toHaveFocus(),
    );
    expect(commands[0]?.command).toEqual({
      type: 'task.delete',
      taskId: id(2),
    });
  });

  it('uses the scoped quick input for subtask Insert and keeps both drafts through tab changes', async () => {
    tree.tasks = [task(1, 'Этап'), task(2, 'Ребёнок', id(1))];
    await open();
    const user = userEvent.setup();
    await user.click(screen.getByRole('treeitem', { name: /^Этап,/ }));
    await user.click(screen.getByRole('tab', { name: 'Подзадачи' }));
    const panel = within(screen.getByRole('complementary', { name: 'Задача' }));
    await user.type(panel.getByLabelText('Новая задача'), 'Черновик ветки');
    panel.getByRole('treeitem', { name: /^Ребёнок,/ }).focus();
    await user.keyboard('{Shift>}{Insert}{/Shift}');
    expect(panel.getByLabelText('Новая задача')).toHaveFocus();
    expect(panel.getByText('Родитель: Ребёнок')).toBeInTheDocument();
    await user.click(panel.getByRole('tab', { name: 'Детали' }));
    await user.type(panel.getByLabelText('Описание'), 'Черновик деталей');
    await user.click(panel.getByRole('tab', { name: 'Подзадачи' }));
    expect(panel.getByLabelText('Новая задача')).toHaveValue('Черновик ветки');
    expect(panel.getByLabelText('Новая задача')).toBeDisabled();
    await user.click(panel.getByRole('treeitem', { name: /^Ребёнок,/ }));
    expect(panel.getByRole('heading', { name: 'Этап' })).toBeInTheDocument();
    await user.click(panel.getByRole('tab', { name: 'Детали' }));
    expect(panel.getByLabelText('Описание')).toHaveValue('Черновик деталей');
    expect(commands).toHaveLength(0);
  });

  it('does not take focus from search when a pending subtask create succeeds', async () => {
    tree.tasks = [task(1, 'Этап')];
    await open();
    const user = userEvent.setup();
    await user.click(screen.getByRole('treeitem', { name: /^Этап,/ }));
    await user.click(screen.getByRole('tab', { name: 'Подзадачи' }));
    const panel = within(screen.getByRole('complementary', { name: 'Задача' }));
    let resolve!: (response: Response) => void;
    fetchMock.mockImplementationOnce(
      () =>
        new Promise<Response>((done) => {
          resolve = done;
        }),
    );
    await user.type(panel.getByLabelText('Новая задача'), 'Ребёнок{Enter}');
    expect(panel.getByLabelText('Новая задача')).toBeDisabled();
    const search = screen.getByRole('searchbox', { name: 'Поиск задач' });
    await user.click(search);
    resolve(
      new Response(
        JSON.stringify({
          ...tree,
          project: { ...project, revision: 1 },
          tasks: [...tree.tasks, task(2, 'Ребёнок', id(1))],
        }),
      ),
    );
    await waitFor(() =>
      expect(panel.getByLabelText('Новая задача')).toHaveValue(''),
    );
    expect(search).toHaveFocus();
  });

  it('returns to scoped input when a visited child has moved outside the parent subtree', async () => {
    tree.tasks = [task(1, 'Этап'), task(2, 'Ребёнок', id(1))];
    await open();
    const user = userEvent.setup();
    await user.click(screen.getByRole('treeitem', { name: /^Этап,/ }));
    await user.click(screen.getByRole('tab', { name: 'Подзадачи' }));
    await user.click(
      within(screen.getByRole('tree', { name: 'Подзадачи' })).getByRole(
        'treeitem',
        { name: /^Ребёнок,/ },
      ),
    );
    await user.selectOptions(screen.getByLabelText('Новый родитель'), '');
    tree = {
      ...tree,
      project: { ...project, revision: 1 },
      tasks: [task(1, 'Этап'), task(2, 'Ребёнок')],
    };
    fetchMock.mockImplementationOnce(() => json(tree));
    await user.click(screen.getByRole('button', { name: 'Перенести' }));
    await user.click(screen.getByRole('button', { name: 'Назад: Этап' }));
    const panel = within(screen.getByRole('complementary', { name: 'Задача' }));
    await panel.findByText('Подзадач пока нет.');
    await waitFor(() =>
      expect(panel.getByLabelText('Новая задача')).toHaveFocus(),
    );
  });

  it('keeps a quick-only draft visible when conflict reload removes its selected parent', async () => {
    tree.tasks = [task(1, 'Этап')];
    await open();
    const user = userEvent.setup();
    await user.click(screen.getByRole('treeitem', { name: /^Этап,/ }));
    await user.click(screen.getByRole('tab', { name: 'Подзадачи' }));
    const panel = within(screen.getByRole('complementary', { name: 'Задача' }));
    fetchMock.mockImplementationOnce(() =>
      json({ code: 'STALE_REVISION', message: 'Проект изменён.' }, 409),
    );
    await user.type(
      panel.getByLabelText('Новая задача'),
      'Черновик ветки{Enter}',
    );
    tree = { ...tree, tasks: [], project: { ...project, revision: 1 } };
    await user.click(
      panel.getByRole('button', { name: 'Загрузить актуальный проект' }),
    );
    await panel.findByText(/Выбранная задача удалена/);
    expect(panel.getByLabelText('Новая задача')).toHaveValue('Черновик ветки');
    expect(panel.getByLabelText('Новая задача')).toBeDisabled();
    expect(panel.queryByRole('tree')).not.toBeInTheDocument();
    expect(commands).toHaveLength(0);
  });

  it('preserves a combined plan draft and retries the exact envelope after a lost save response', async () => {
    tree = { ...tree, tasks: [task(1, 'Работа A')] };
    await open();
    const user = userEvent.setup();
    await user.click(screen.getByRole('treeitem', { name: /Работа A,/ }));
    await user.clear(screen.getByLabelText('Название задачи'));
    await user.type(screen.getByLabelText('Название задачи'), 'Работа revised');
    await user.type(screen.getByLabelText('Длительность, рабочих дней'), '9');
    let first: CommandEnvelope | undefined;
    fetchMock.mockImplementationOnce((_url: string, init: RequestInit) => {
      first = JSON.parse(String(init.body)) as CommandEnvelope;
      return Promise.reject(new TypeError('synthetic lost response'));
    });
    await user.click(screen.getByRole('button', { name: /^Сохранить$/ }));
    await screen.findByText(/Нет связи с сервером/);
    expect(screen.getByLabelText('Название задачи')).toHaveValue(
      'Работа revised',
    );
    expect(screen.getByLabelText('Длительность, рабочих дней')).toHaveValue(9);
    expect(screen.getByLabelText('Длительность, рабочих дней')).toBeDisabled();
    expect(
      screen.queryByText('Сохранено', { exact: true }),
    ).not.toBeInTheDocument();
    fetchMock.mockImplementationOnce((_url: string, init: RequestInit) => {
      expect(JSON.parse(String(init.body))).toEqual(first);
      return json({
        ...tree,
        project: { ...project, revision: 1 },
        tasks: [{ ...task(1, 'Работа revised'), durationDays: 9 }],
        canUndo: true,
      });
    });
    await user.click(
      screen.getByRole('button', { name: 'Повторить сохранение' }),
    );
    await screen.findByText('Сохранено', { exact: true });
    expect(first?.command).toMatchObject({
      type: 'task.edit',
      changes: { title: 'Работа revised', durationDays: 9 },
    });
    expect(screen.getByLabelText('Длительность, рабочих дней')).toHaveValue(9);
  });
  it('keeps quick intent on rejected stale reload and reconciles it only on a fresh conflict snapshot', async () => {
    tree = {
      ...tree,
      project: { ...project, revision: 5 },
      tasks: [task(1, 'Родитель A')],
    };
    await open();
    const user = userEvent.setup();
    await user.type(screen.getByLabelText('Новая задача'), 'Черновик ребёнка');
    await user.tab();
    fetchMock.mockImplementationOnce(() =>
      json({ code: 'STALE_REVISION', message: 'Проект изменён.' }, 409),
    );
    await user.keyboard('{Enter}');
    tree = { ...tree, project: { ...project, revision: 2 }, tasks: [] };
    await user.click(
      await screen.findByRole('button', {
        name: 'Загрузить актуальный проект',
      }),
    );
    await screen.findByText(/Получен устаревший/);
    expect(screen.getByLabelText('Новая задача')).toHaveValue(
      'Черновик ребёнка',
    );
    expect(screen.getByText('Родитель: Родитель A')).toBeInTheDocument();
    expect(screen.getByLabelText('Новая задача')).toBeDisabled();
    tree = { ...tree, project: { ...project, revision: 6 } };
    await user.click(
      screen.getByRole('button', { name: 'Загрузить актуальный проект' }),
    );
    await waitFor(() =>
      expect(screen.getByLabelText('Новая задача')).toBeEnabled(),
    );
    expect(screen.getByText('Родитель: Корень проекта')).toBeInTheDocument();
    expect(screen.getByLabelText('Новая задача')).toHaveValue(
      'Черновик ребёнка',
    );
    await user.click(screen.getByLabelText('Новая задача'));
    await user.keyboard('{Enter}');
    await waitFor(() => expect(commands).toHaveLength(1));
    expect(commands[0]).toMatchObject({
      expectedRevision: 6,
      command: {
        type: 'task.create',
        title: 'Черновик ребёнка',
        parentId: null,
      },
    });
    expect(commands[0]?.command).not.toHaveProperty('afterId');
  });
  it('reconciles quick context after creating and deleting the only root', async () => {
    await open();
    const user = userEvent.setup();
    await user.type(screen.getByLabelText('Новая задача'), 'Задача A{Enter}');
    await user.click(
      await screen.findByRole('treeitem', { name: /Задача A,/ }),
    );
    await user.type(screen.getByLabelText('Новая задача'), 'Черновик B');
    await user.click(screen.getByRole('button', { name: 'Удалить ветку' }));
    await screen.findByText('В проекте пока нет задач.');
    expect(screen.getByLabelText('Новая задача')).toHaveValue('Черновик B');
    await user.click(screen.getByLabelText('Новая задача'));
    await user.keyboard('{Enter}');
    await waitFor(() => expect(commands).toHaveLength(3));
    expect(commands[2]?.command).toEqual({
      type: 'task.create',
      title: 'Черновик B',
      parentId: null,
    });
  });
  it('reconciles a removed quick anchor after undoing creation without losing text', async () => {
    await open();
    const user = userEvent.setup();
    await user.type(screen.getByLabelText('Новая задача'), 'Задача A{Enter}');
    await screen.findByRole('treeitem', { name: /Задача A,/ });
    await user.type(screen.getByLabelText('Новая задача'), 'Черновик B');
    // Independent server snapshot for undo, not generated by client tree logic.
    tree = { ...tree, tasks: [] };
    await user.click(
      screen.getByRole('button', { name: 'Отменить последнее изменение' }),
    );
    await screen.findByText('В проекте пока нет задач.');
    expect(screen.getByLabelText('Новая задача')).toHaveValue('Черновик B');
    await user.click(screen.getByLabelText('Новая задача'));
    await user.keyboard('{Enter}');
    await waitFor(() => expect(commands).toHaveLength(3));
    expect(commands[2]?.command).toEqual({
      type: 'task.create',
      title: 'Черновик B',
      parentId: null,
    });
  });
  it.each(['delete', 'undo'] as const)(
    'falls back to root when %s removes the intended quick parent',
    async (operation) => {
      tree = { ...tree, tasks: [task(1, 'Родитель A')], canUndo: true };
      await open();
      const user = userEvent.setup();
      await user.type(
        screen.getByLabelText('Новая задача'),
        'Черновик ребёнка',
      );
      await user.tab();
      expect(screen.getByText('Родитель: Родитель A')).toBeInTheDocument();
      if (operation === 'delete') {
        screen.getByRole('treeitem', { name: /Родитель A,/ }).focus();
        await user.keyboard('{Delete}');
      } else {
        tree = { ...tree, tasks: [] };
        await user.click(
          screen.getByRole('button', { name: 'Отменить последнее изменение' }),
        );
      }
      await screen.findByText('В проекте пока нет задач.');
      expect(screen.getByLabelText('Новая задача')).toHaveValue(
        'Черновик ребёнка',
      );
      await user.click(screen.getByLabelText('Новая задача'));
      await user.keyboard('{Enter}');
      await waitFor(() => expect(commands).toHaveLength(2));
      expect(commands[1]?.command).toEqual({
        type: 'task.create',
        title: 'Черновик ребёнка',
        parentId: null,
      });
    },
  );
  it('drops a moved quick anchor while retaining the intended parent and text', async () => {
    tree.tasks = [task(1, 'Задача A'), task(2, 'Задача B', null, 1)];
    await open();
    const user = userEvent.setup();
    await user.click(screen.getByRole('treeitem', { name: /Задача B,/ }));
    await user.type(screen.getByLabelText('Новая задача'), 'Черновик корня');
    tree = {
      ...tree,
      tasks: [task(1, 'Задача A'), task(2, 'Задача B', id(1))],
    };
    await user.click(
      screen.getByRole('button', { name: 'Вложить в предыдущую задачу' }),
    );
    await waitFor(() =>
      expect(screen.getByLabelText('Новый родитель')).toHaveValue(id(1)),
    );
    expect(screen.getByLabelText('Новая задача')).toHaveValue('Черновик корня');
    expect(screen.getByText('Родитель: Корень проекта')).toBeInTheDocument();
    await user.click(screen.getByLabelText('Новая задача'));
    await user.keyboard('{Enter}');
    await waitFor(() => expect(commands).toHaveLength(2));
    expect(commands[1]?.command).toEqual({
      type: 'task.create',
      title: 'Черновик корня',
      parentId: null,
    });
  });
  it('retains a surviving quick parent when its child anchor is deleted', async () => {
    tree.tasks = [task(1, 'Родитель A'), task(2, 'Ребёнок A', id(1))];
    await open();
    const user = userEvent.setup();
    await user.click(screen.getByRole('treeitem', { name: /Ребёнок A,/ }));
    await user.type(screen.getByLabelText('Новая задача'), 'Сосед ребёнка');
    await user.click(screen.getByRole('button', { name: 'Удалить ветку' }));
    await waitFor(() =>
      expect(
        screen.queryByRole('treeitem', { name: /Ребёнок A,/ }),
      ).not.toBeInTheDocument(),
    );
    expect(screen.getByText('Родитель: Родитель A')).toBeInTheDocument();
    expect(screen.getByLabelText('Новая задача')).toHaveValue('Сосед ребёнка');
    await user.click(screen.getByLabelText('Новая задача'));
    await user.keyboard('{Enter}');
    await waitFor(() => expect(commands).toHaveLength(2));
    expect(commands[1]?.command).toEqual({
      type: 'task.create',
      title: 'Сосед ребёнка',
      parentId: id(1),
    });
  });
  it('retains valid quick parent and anchor through an unrelated accepted undo snapshot', async () => {
    tree = {
      ...tree,
      tasks: [
        task(1, 'Родитель A'),
        task(2, 'Ребёнок A', id(1)),
        task(3, 'Задача B', null, 1),
      ],
      canUndo: true,
    };
    await open();
    const user = userEvent.setup();
    await user.click(screen.getByRole('treeitem', { name: /Ребёнок A,/ }));
    await user.type(screen.getByLabelText('Новая задача'), 'Сосед ребёнка');
    tree = {
      ...tree,
      tasks: [task(1, 'Родитель A'), task(2, 'Ребёнок A', id(1))],
    };
    await user.click(
      screen.getByRole('button', { name: 'Отменить последнее изменение' }),
    );
    await waitFor(() =>
      expect(
        screen.queryByRole('treeitem', { name: /Задача B,/ }),
      ).not.toBeInTheDocument(),
    );
    expect(screen.getByLabelText('Новая задача')).toHaveValue('Сосед ребёнка');
    await user.click(screen.getByLabelText('Новая задача'));
    await user.keyboard('{Enter}');
    await waitFor(() => expect(commands).toHaveLength(2));
    expect(commands[1]?.command).toEqual({
      type: 'task.create',
      title: 'Сосед ребёнка',
      parentId: id(1),
      afterId: id(2),
    });
  });
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
    await screen.findByText(/make admin-setup/);
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
    await user.click(screen.getByRole('treeitem', { name: /Задача A,/ }));
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
    expect(screen.getByRole('button', { name: 'Сохранить' })).toBeDisabled();
    expect(commands).toHaveLength(0);
    tree = {
      ...tree,
      project: { ...project, revision: 6 },
      tasks: [task(1, 'Задача A')],
    };
    await user.click(
      screen.getByRole('button', { name: 'Загрузить актуальный проект' }),
    );
    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'Сохранить' })).toBeEnabled(),
    );
    await user.click(screen.getByRole('button', { name: 'Сохранить' }));
    await waitFor(() => expect(commands).toHaveLength(1));
    expect(commands[0]?.expectedRevision).toBe(6);
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
    expect(screen.getByRole('checkbox', { name: 'Гант' })).toBeChecked();
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
      within(
        screen.getByRole('complementary', { name: 'Задача' }),
      ).getByLabelText('Новая задача'),
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
      type: 'task.edit',
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
      json({
        contractVersion: 2,
        project: other,
        tasks: [],
        canUndo: false,
        dependencies: [],
        schedule: structuredClone(emptySchedule),
      }),
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
  it('retains unsent quick text and parent preview across A→B→A, guards logout/unload and permits explicit discard', async () => {
    const other = {
      ...project,
      id: '44444444-4444-4444-8444-444444444444',
      title: 'Другой демо-проект',
    };
    tree.tasks = [task(1, 'Задача A')];
    const treeA = { ...tree, tasks: [...tree.tasks] };
    fetchMock.mockImplementationOnce(() =>
      json({ authenticated: true, setupRequired: false }),
    );
    fetchMock.mockImplementationOnce(() => json([project, other]));
    await open();
    const user = userEvent.setup();
    await user.type(screen.getByLabelText('Новая задача'), 'Черновик A');
    await user.tab();
    expect(screen.getByText('Родитель: Задача A')).toBeInTheDocument();
    const unload = new Event('beforeunload', { cancelable: true });
    window.dispatchEvent(unload);
    expect(unload.defaultPrevented).toBe(true);
    fetchMock.mockImplementationOnce(() =>
      json({
        contractVersion: 2,
        project: other,
        tasks: [],
        canUndo: false,
        dependencies: [],
        schedule: structuredClone(emptySchedule),
      }),
    );
    await user.click(
      screen.getByRole('button', { name: /Другой демо-проект/ }),
    );
    await screen.findByRole('heading', { name: other.title });
    expect(screen.getByLabelText('Новая задача')).toHaveValue('');
    await user.type(screen.getByLabelText('Новая задача'), 'Черновик B');
    fetchMock.mockImplementationOnce(() => json(treeA));
    await user.click(screen.getByRole('button', { name: /Демо-проект/ }));
    await screen.findByRole('heading', { name: project.title });
    expect(screen.getByLabelText('Новая задача')).toHaveValue('Черновик A');
    expect(screen.getByText('Родитель: Задача A')).toBeInTheDocument();
    expect(commands).toHaveLength(0);
    await user.click(screen.getByRole('button', { name: 'Выйти' }));
    expect(screen.getByRole('alert')).toHaveTextContent(/быстр/i);
    expect(
      fetchMock.mock.calls.some(([url]) => url === '/api/auth/logout'),
    ).toBe(false);
    await user.click(
      screen.getByRole('button', { name: 'Отбросить быстрые черновики' }),
    );
    expect(screen.getByLabelText('Новая задача')).toHaveValue('');
    const cleanUnload = new Event('beforeunload', { cancelable: true });
    window.dispatchEvent(cleanUnload);
    expect(cleanUnload.defaultPrevented).toBe(false);
    expect(commands).toHaveLength(0);
    await user.click(screen.getByRole('button', { name: 'Выйти' }));
    await screen.findByLabelText('Пароль');
  });
  it('keeps conflict recovery and blocks saving after a failed reload until a validated fresh snapshot arrives', async () => {
    tree.project.revision = 4;
    tree.tasks = [task(1, 'Задача A')];
    await open();
    const user = userEvent.setup();
    await user.click(screen.getByRole('treeitem', { name: /Задача A,/ }));
    await user.type(
      screen.getByLabelText('Описание'),
      'Черновик после конфликта',
    );
    fetchMock.mockImplementationOnce(() =>
      json({ code: 'REVISION_CONFLICT', message: 'Проект изменён.' }, 409),
    );
    await user.click(screen.getByRole('button', { name: 'Сохранить' }));
    fetchMock.mockImplementationOnce(() =>
      Promise.reject(new TypeError('synthetic offline')),
    );
    await user.click(
      await screen.findByRole('button', {
        name: 'Загрузить актуальный проект',
      }),
    );
    await screen.findByText(/Нет связи с сервером/);
    expect(
      screen.getByRole('button', { name: 'Загрузить актуальный проект' }),
    ).toBeEnabled();
    expect(screen.getByRole('button', { name: 'Сохранить' })).toBeDisabled();
    expect(screen.getByLabelText('Описание')).toHaveValue(
      'Черновик после конфликта',
    );
    expect(
      screen.getByRole('treeitem', { name: /Задача A,/ }),
    ).toBeInTheDocument();
    expect(commands).toHaveLength(0);
    // A schema-invalid success is not a validated snapshot and cannot lift the conflict.
    fetchMock.mockImplementationOnce(() =>
      json({
        project: { ...project, revision: 7 },
        tasks: [],
        canUndo: 'invalid',
      }),
    );
    await user.click(
      screen.getByRole('button', { name: 'Загрузить актуальный проект' }),
    );
    await screen.findByText('Не удалось выполнить запрос.');
    expect(screen.getByRole('button', { name: 'Сохранить' })).toBeDisabled();
    tree = { ...tree, project: { ...project, revision: 8 } };
    await user.click(
      screen.getByRole('button', { name: 'Загрузить актуальный проект' }),
    );
    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'Сохранить' })).toBeEnabled(),
    );
    expect(screen.getByLabelText('Описание')).toHaveValue(
      'Черновик после конфликта',
    );
    await user.click(screen.getByRole('button', { name: 'Сохранить' }));
    await screen.findByText('Сохранено');
    expect(commands[0]?.expectedRevision).toBe(8);
  });
  it('closes the clean panel for child and sibling actions and exposes the focused quick editor', async () => {
    tree.tasks = [task(1, 'Задача A')];
    await open();
    const user = userEvent.setup();
    for (const name of ['Добавить подзадачу', 'Добавить соседнюю задачу']) {
      await user.click(screen.getByRole('treeitem', { name: /Задача A,/ }));
      await user.click(screen.getByRole('button', { name }));
      expect(
        screen.queryByRole('complementary', { name: 'Задача' }),
      ).not.toBeInTheDocument();
      await waitFor(() =>
        expect(screen.getByLabelText('Новая задача')).toHaveFocus(),
      );
      expect(
        screen.getByText(
          name === 'Добавить подзадачу'
            ? 'Родитель: Задача A'
            : 'Родитель: Корень проекта',
        ),
      ).toBeInTheDocument();
    }
    expect(commands).toHaveLength(0);
  });
  it('synchronizes the parent picker after a same-task server move and undo', async () => {
    tree.tasks = [task(1, 'Задача A'), task(2, 'Задача B', null, 1)];
    await open();
    const user = userEvent.setup();
    await user.click(screen.getByRole('treeitem', { name: /Задача B,/ }));
    expect(screen.getByLabelText('Новый родитель')).toHaveValue('');
    tree = {
      ...tree,
      tasks: [task(1, 'Задача A'), task(2, 'Задача B', id(1))],
    };
    await user.click(
      screen.getByRole('button', { name: 'Вложить в предыдущую задачу' }),
    );
    await waitFor(() =>
      expect(screen.getByLabelText('Новый родитель')).toHaveValue(id(1)),
    );
    tree = {
      ...tree,
      tasks: [task(1, 'Задача A'), task(2, 'Задача B', null, 1)],
    };
    await user.click(
      screen.getByRole('button', { name: 'Отменить последнее изменение' }),
    );
    await waitFor(() =>
      expect(screen.getByLabelText('Новый родитель')).toHaveValue(''),
    );
  });
  describe.each(['create', 'move'] as const)(
    'preserve-work confirmation for %s',
    (action) => {
      async function attempt(user: ReturnType<typeof userEvent.setup>) {
        if (action === 'create') {
          await user.click(
            screen.getByRole('treeitem', { name: /Собственная работа,/ }),
          );
          await user.click(
            screen.getByRole('button', { name: 'Добавить подзадачу' }),
          );
          await user.type(
            screen.getByLabelText('Новая задача'),
            'Новый ребёнок{Enter}',
          );
        } else {
          screen.getByRole('treeitem', { name: /Переносимая задача,/ }).focus();
          await user.keyboard('{Alt>}{ArrowRight}{/Alt}');
        }
      }
      function fixture(
        kind: 'done' | 'duration' | 'finish' | 'linked' | 'empty' | 'summary',
      ) {
        const parent = task(1, 'Собственная работа');
        if (kind === 'done') parent.status = 'done';
        if (kind === 'duration') {
          parent.durationDays = 3;
        }
        if (kind === 'finish') parent.inputFinish = '2026-10-20';
        tree.tasks = [parent, task(2, 'Переносимая задача', null, 1)];
        if (kind === 'linked')
          tree.dependencies = [
            {
              id: id(9),
              projectId: project.id,
              predecessorId: id(1),
              successorId: id(2),
            },
          ];
        if (kind === 'summary') {
          parent.inputFinish = '2026-10-20';
          tree.tasks.push(task(3, 'Существующий ребёнок', id(1)));
        }
      }
      it.each(['done', 'duration', 'finish', 'linked'] as const)(
        'confirms undated %s work and sends preserveWork',
        async (kind) => {
          fixture(kind);
          await open();
          await attempt(userEvent.setup());
          await waitFor(() => expect(commands).toHaveLength(1));
          expect(window.confirm).toHaveBeenCalledWith(
            expect.stringContaining('сохранить'),
          );
          expect(commands[0]!.command).toMatchObject({
            type: action === 'create' ? 'task.create' : 'task.move',
            parentId: id(1),
            preserveWork: true,
          });
        },
      );
      it.each(['done', 'linked'] as const)(
        'cancels conversion of undated %s work without sending a mutation',
        async (kind) => {
          fixture(kind);
          const before = structuredClone(tree);
          vi.mocked(window.confirm).mockReturnValueOnce(false);
          await open();
          await attempt(userEvent.setup());
          expect(window.confirm).toHaveBeenCalledWith(
            expect.stringContaining('сохранить'),
          );
          expect(commands).toEqual([]);
          expect(tree).toEqual(before);
          if (action === 'create')
            expect(screen.getByLabelText('Новая задача')).toHaveValue(
              'Новый ребёнок',
            );
        },
      );
      it.each(['empty', 'summary'] as const)(
        'does not confirm conversion for %s parent',
        async (kind) => {
          fixture(kind);
          await open();
          await attempt(userEvent.setup());
          await waitFor(() => expect(commands).toHaveLength(1));
          expect(window.confirm).not.toHaveBeenCalled();
          expect(commands[0]!.command).not.toHaveProperty('preserveWork');
        },
      );
    },
  );
});
