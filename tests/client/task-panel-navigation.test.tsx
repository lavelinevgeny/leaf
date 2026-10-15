// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
// jsdom has no native modal implementation; browsers exercise showModal in E2E.
HTMLDialogElement.prototype.showModal = function () {
  this.setAttribute('open', '');
};
HTMLDialogElement.prototype.close = function () {
  this.removeAttribute('open');
};
import {
  cleanup,
  act,
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
let commandCalls: CommandEnvelope[];
let fetchMock: ReturnType<
  typeof vi.fn<(url: string, init?: RequestInit) => Promise<Response>>
>;
const json = (body: unknown, status = 200) =>
  Promise.resolve(
    new Response(JSON.stringify(body), {
      status,
      headers: { 'Content-Type': 'application/json' },
    }),
  );
beforeEach(() => {
  window.history.replaceState(null, '', '/');
  tree = {
    contractVersion: 2,
    project: { ...project },
    tasks: [],
    canUndo: false,
    dependencies: [],
    schedule: structuredClone(emptySchedule),
  };
  commandCalls = [];
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
    if (/\/journal(?:\?|$)/.test(url) && init?.method === 'GET')
      return json({
        journalContractVersion: 1,
        projectId: tree.project.id,
        taskId: url.includes('/tasks/')
          ? url.split('/tasks/')[1]!.split('/')[0]
          : null,
        projectRevision: tree.project.revision,
        journalRevision: 0,
        entries: [],
        nextCursor: null,
      });
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
      const command = envelope.command;
      if (command.type === 'task.create') {
        tree.tasks.push(
          task(
            50 + commandCalls.length,
            command.title,
            command.parentId,
            tree.tasks.length,
          ),
        );
        Object.assign(tree.tasks.at(-1)!, {
          inputStart: command.inputStart ?? null,
          inputFinish: command.inputFinish ?? null,
          durationDays: command.durationDays ?? null,
        });
      }
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
      if (command.type === 'dependency.create')
        tree.dependencies.push({
          id: id(90),
          projectId: project.id,
          predecessorId: command.predecessorId,
          successorId: command.successorId,
        });
      if (command.type === 'dependency.delete')
        tree.dependencies = tree.dependencies.filter(
          (edge) => edge.id !== command.dependencyId,
        );
      if (command.type === 'task.edit' && command.changes.predecessorIds)
        tree.dependencies = [
          ...tree.dependencies.filter(
            (edge) => edge.successorId !== command.taskId,
          ),
          ...command.changes.predecessorIds.map((predecessorId, index) => ({
            id: id(90 + index),
            projectId: project.id,
            predecessorId,
            successorId: command.taskId,
          })),
        ];
      if (command.type === 'task.create' && command.predecessorIds)
        tree.dependencies.push(
          ...command.predecessorIds.map((predecessorId, index) => ({
            id: id(90 + index),
            projectId: project.id,
            predecessorId,
            successorId: tree.tasks.at(-1)!.id,
          })),
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
  vi.stubGlobal('fetch', (url: string, init?: RequestInit) => {
    if (init?.method === 'POST' && url.endsWith('/commands'))
      commandCalls.push(JSON.parse(String(init.body)) as CommandEnvelope);
    return fetchMock(url, init);
  });
  vi.spyOn(window, 'confirm').mockReturnValue(true);
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

async function openDirty(
  tasks = [task(1, 'Работа A'), task(2, 'Работа C', null, 1)],
) {
  tree.tasks = tasks;
  const user = userEvent.setup();
  render(<App />);
  await user.click(await screen.findByRole('treeitem', { name: /^Работа A,/ }));
  await user.click(screen.getByRole('button', { name: 'Изменить название' }));
  await user.clear(screen.getByRole('textbox', { name: 'Название задачи' }));
  await user.type(
    screen.getByRole('textbox', { name: 'Название задачи' }),
    'Работа B',
  );
  return user;
}
async function leave(user: ReturnType<typeof userEvent.setup>) {
  await user.click(screen.getByRole('treeitem', { name: /^Работа C,/ }));
  return screen.getByRole('dialog', { name: 'Несохранённые изменения задачи' });
}
describe('task navigation decisions', () => {
  it('keeps draft on continue and discards only after an explicit choice', async () => {
    const user = await openDirty();
    await leave(user);
    await user.click(
      screen.getByRole('button', { name: 'Продолжить редактирование' }),
    );
    expect(
      screen.getByRole('textbox', { name: 'Название задачи' }),
    ).toHaveValue('Работа B');
    expect(commandCalls).toHaveLength(0);
    await leave(user);
    await user.click(screen.getByRole('button', { name: 'Не сохранять' }));
    expect(screen.getByRole('heading', { name: 'Работа C' })).toBeVisible();
    expect(commandCalls).toHaveLength(0);
  });
  it('waits for the save acknowledgement before continuing', async () => {
    const user = await openDirty();
    const original = fetchMock.getMockImplementation() as (
      url: string,
      init?: RequestInit,
    ) => Promise<Response>;
    let resolve!: (value: Response) => void;
    fetchMock.mockImplementation((url: string, init?: RequestInit) => {
      if (url.endsWith('/commands')) {
        return new Promise<Response>((done) => {
          resolve = done;
        });
      }
      return original(url, init);
    });
    await leave(user);
    await user.click(
      within(screen.getByRole('dialog')).getByRole('button', {
        name: 'Сохранить',
      }),
    );
    expect(
      screen.getByRole('textbox', { name: 'Название задачи' }),
    ).toHaveValue('Работа B');
    expect(commandCalls).toHaveLength(1);
    tree = {
      ...tree,
      project: { ...project, revision: 1 },
      tasks: tree.tasks.map((t) =>
        t.id === id(1) ? { ...t, title: 'Работа B' } : t,
      ),
    };
    await act(async () => resolve(await json(tree)));
    await screen.findByRole('heading', { name: 'Работа C' });
  });
  it('focuses an invalid title and allows discard', async () => {
    const user = await openDirty();
    await user.clear(screen.getByRole('textbox', { name: 'Название задачи' }));
    await leave(user);
    await user.click(
      within(screen.getByRole('dialog')).getByRole('button', {
        name: 'Сохранить',
      }),
    );
    await waitFor(() =>
      expect(
        screen.getByRole('textbox', { name: 'Название задачи' }),
      ).toHaveFocus(),
    );
    expect(commandCalls).toHaveLength(0);
    await leave(user);
    await user.click(screen.getByRole('button', { name: 'Не сохранять' }));
    expect(screen.getByRole('heading', { name: 'Работа C' })).toBeVisible();
  });
});

it.each(['rejected', 'uncertain'] as const)(
  'keeps values after %s save and blocks uncertain discard/close',
  async (kind) => {
    const user = await openDirty();
    const original = fetchMock.getMockImplementation() as (
      url: string,
      init?: RequestInit,
    ) => Promise<Response>;
    fetchMock.mockImplementation((url: string, init?: RequestInit) => {
      if (url.endsWith('/commands')) {
        return kind === 'uncertain'
          ? Promise.reject(new TypeError('synthetic offline'))
          : json(
              { code: 'INVALID_INPUT', message: 'Синтетический отказ' },
              400,
            );
      }
      return original(url, init);
    });
    const dialog = await leave(user);
    await user.click(within(dialog).getByRole('button', { name: 'Сохранить' }));
    await screen.findByText(
      kind === 'uncertain' ? /Нет связи с сервером/ : 'Синтетический отказ',
    );
    expect(
      screen.getByRole('textbox', { name: 'Название задачи' }),
    ).toHaveValue('Работа B');
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(commandCalls).toHaveLength(1);
    await user.click(screen.getByRole('treeitem', { name: /^Работа C,/ }));
    if (kind === 'uncertain') {
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
      expect(
        screen.getByRole('button', { name: 'Закрыть панель' }),
      ).toBeDisabled();
      expect(
        screen.getByRole('button', { name: 'Сбросить изменения' }),
      ).toBeDisabled();
    } else {
      await user.click(screen.getByRole('button', { name: 'Не сохранять' }));
      expect(screen.getByRole('heading', { name: 'Работа C' })).toBeVisible();
    }
  },
);
it('keeps a newer draft after the sent snapshot is acknowledged', async () => {
  const user = await openDirty();
  const original = fetchMock.getMockImplementation() as (
    url: string,
    init?: RequestInit,
  ) => Promise<Response>;
  let resolve!: (response: Response) => void;
  fetchMock.mockImplementation((url: string, init?: RequestInit) => {
    if (url.endsWith('/commands')) {
      return new Promise<Response>((done) => {
        resolve = done;
      });
    }
    return original(url, init);
  });
  await leave(user);
  await user.click(
    within(screen.getByRole('dialog')).getByRole('button', {
      name: 'Сохранить',
    }),
  );
  fireEvent.change(screen.getByRole('textbox', { name: 'Название задачи' }), {
    target: { value: 'Следующий черновик' },
  });
  const ack = {
    ...tree,
    project: { ...project, revision: 1 },
    tasks: tree.tasks.map((t) =>
      t.id === id(1) ? { ...t, title: 'Работа B' } : t,
    ),
  };
  await act(async () => resolve(await json(ack)));
  await waitFor(() =>
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument(),
  );
  expect(screen.getByRole('textbox', { name: 'Название задачи' })).toHaveValue(
    'Следующий черновик',
  );
  expect(screen.getByRole('button', { name: 'Сохранить' })).toBeEnabled();
  expect(commandCalls).toHaveLength(1);
});
it('drops the continuation when a save expires the authenticated session', async () => {
  const user = await openDirty();
  const original = fetchMock.getMockImplementation() as (
    url: string,
    init?: RequestInit,
  ) => Promise<Response>;
  fetchMock.mockImplementation((url: string, init?: RequestInit) =>
    url.endsWith('/commands')
      ? json({ code: 'UNAUTHORIZED', message: 'Сессия завершена' }, 401)
      : original(url, init),
  );
  await leave(user);
  await user.click(
    within(screen.getByRole('dialog')).getByRole('button', {
      name: 'Сохранить',
    }),
  );
  await screen.findByLabelText('Пароль');
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  expect(
    screen.queryByRole('complementary', { name: 'Задача' }),
  ).not.toBeInTheDocument();
  expect(window.location.search).not.toContain(id(2));
});
it('leaves independent QuickAdd drafts editable and blocks only their submit while task is dirty', async () => {
  const user = await openDirty();
  await user.click(screen.getByRole('button', { name: 'Добавить подзадачу' }));
  const panel = within(screen.getByRole('complementary', { name: 'Задача' }));
  await user.type(
    panel.getByRole('textbox', { name: 'Новая задача' }),
    'Черновик ребёнка{Enter}',
  );
  const main = document.getElementById('quick-task')!;
  await user.type(main, 'Черновик корня{Enter}');
  expect(panel.getByRole('textbox', { name: 'Новая задача' })).toHaveValue(
    'Черновик ребёнка',
  );
  expect(main).toHaveValue('Черновик корня');
  expect(panel.getByRole('button', { name: 'Добавить задачу' })).toBeDisabled();
  expect(
    panel.getByRole('button', { name: 'Добавить задачу' }),
  ).toHaveAccessibleDescription('Сначала сохраните изменения задачи');
  expect(commandCalls).toHaveLength(0);
  await user.click(screen.getByRole('button', { name: 'Сбросить изменения' }));
  expect(panel.getByRole('textbox', { name: 'Новая задача' })).toHaveValue(
    'Черновик ребёнка',
  );
  expect(main).toHaveValue('Черновик корня');
  expect(panel.getByRole('button', { name: 'Добавить задачу' })).toBeEnabled();
});
it('guards close and show-on-Gantt and cancels a superseded continuation', async () => {
  const user = await openDirty();
  await user.click(screen.getByRole('button', { name: 'Закрыть панель' }));
  await user.click(
    screen.getByRole('button', { name: 'Продолжить редактирование' }),
  );
  await user.click(screen.getByRole('button', { name: 'Действия задачи' }));
  await user.click(screen.getByRole('menuitem', { name: 'Показать на Ганте' }));
  await user.click(
    screen.getByRole('button', { name: 'Продолжить редактирование' }),
  );
  await leave(user);
  await user.click(screen.getByRole('button', { name: 'Не сохранять' }));
  expect(screen.getByRole('heading', { name: 'Работа C' })).toBeVisible();
  expect(commandCalls).toHaveLength(0);
});
it('searches move targets by full path, excludes own subtree and explains order boundaries', async () => {
  tree.tasks = [
    task(1, 'Группа'),
    task(2, 'Ветка', id(1)),
    task(3, 'Потомок', id(2)),
    task(4, 'Новый родитель', null, 1),
    task(5, 'Вложенный', id(4)),
  ];
  const user = userEvent.setup();
  render(<App />);
  await user.click(await screen.findByRole('treeitem', { name: /^Ветка,/ }));
  await user.click(screen.getByRole('button', { name: 'Действия задачи' }));
  await user.click(screen.getByRole('menuitem', { name: 'Переместить…' }));
  const dialog = within(
    screen.getByRole('dialog', { name: 'Переместить задачу' }),
  );
  const targets = dialog.getByRole('group', { name: 'Новый родитель' });
  expect(
    within(targets).queryByRole('button', { name: /Ветка|Потомок/ }),
  ).not.toBeInTheDocument();
  await user.type(
    dialog.getByRole('textbox', { name: 'Поиск родителя' }),
    'Новый родитель',
  );
  expect(
    dialog.getByRole('button', { name: 'Новый родитель / Вложенный' }),
  ).toBeVisible();
  await user.click(dialog.getByText('Порядок и уровень'));
  for (const label of ['Выше', 'Ниже', 'Вложить в предыдущую задачу']) {
    expect(dialog.getByRole('button', { name: label })).toBeDisabled();
    expect(
      dialog.getByRole('button', { name: label }),
    ).toHaveAccessibleDescription();
  }
  await user.click(dialog.getByRole('button', { name: 'В корень' }));
  await user.click(dialog.getByRole('button', { name: 'Перенести' }));
  await waitFor(() => expect(commandCalls).toHaveLength(1));
  expect(commandCalls[0]?.command).toEqual({
    type: 'task.move',
    taskId: id(2),
    parentId: null,
    position: 2,
  });
});

it('guards child and parent return and restores both branch scroll offsets', async () => {
  const user = await openDirty([
    task(1, 'Работа A'),
    task(2, 'Работа C', id(1)),
  ]);
  const owner = document.querySelector<HTMLElement>(
    '[data-panel-scroll-owner]',
  )!;
  owner.scrollTop = 172;
  owner.scrollLeft = 13;
  await user.click(
    within(screen.getByRole('tree', { name: 'Подзадачи' })).getByRole(
      'treeitem',
      { name: /^Работа C,/ },
    ),
  );
  await user.click(screen.getByRole('button', { name: 'Не сохранять' }));
  await user.click(screen.getByRole('button', { name: 'Изменить название' }));
  await user.type(
    screen.getByRole('textbox', { name: 'Название задачи' }),
    ' изменена',
  );
  await user.click(screen.getByRole('button', { name: 'Назад: Работа A' }));
  await user.click(
    screen.getByRole('button', { name: 'Продолжить редактирование' }),
  );
  expect(screen.getByRole('textbox', { name: 'Название задачи' })).toHaveValue(
    'Работа C изменена',
  );
  await user.click(screen.getByRole('button', { name: 'Назад: Работа A' }));
  await user.click(screen.getByRole('button', { name: 'Не сохранять' }));
  await screen.findByRole('heading', { name: 'Работа A' });
  await waitFor(() =>
    expect(
      document.querySelector<HTMLElement>('[data-panel-scroll-owner]')!
        .scrollTop,
    ).toBe(172),
  );
  expect(
    document.querySelector<HTMLElement>('[data-panel-scroll-owner]')!
      .scrollLeft,
  ).toBe(13);
  expect(
    within(screen.getByRole('tree', { name: 'Подзадачи' })).getByRole(
      'treeitem',
      { name: /^Работа C,/ },
    ),
  ).toHaveFocus();
  expect(commandCalls).toHaveLength(0);
});
it('routes dependency-neighbor selection through the guard while writes stay blocked', async () => {
  tree.dependencies = [
    {
      id: id(90),
      projectId: project.id,
      predecessorId: id(2),
      successorId: id(1),
    },
  ];
  const user = await openDirty();
  await user.click(screen.getByRole('tab', { name: 'Зависимости' }));
  expect(
    screen.getByRole('button', { name: 'Удалить связь: Работа C' }),
  ).toBeDisabled();
  await user.click(screen.getByRole('button', { name: 'Открыть: Работа C' }));
  await user.click(screen.getByRole('button', { name: 'Не сохранять' }));
  expect(screen.getByRole('heading', { name: 'Работа C' })).toBeVisible();
  expect(screen.getByRole('tab', { name: 'Зависимости' })).toHaveAttribute(
    'aria-selected',
    'true',
  );
  expect(commandCalls).toHaveLength(0);
});
async function travel(direction: 'back' | 'forward') {
  await act(async () => {
    await new Promise<void>((resolve) => {
      window.addEventListener('popstate', () => resolve(), { once: true });
      window.history[direction]();
    });
  });
}
it('compensates dirty Back, cancels to the old URL and performs one accepted Back/Forward', async () => {
  const user = await openDirty();
  const old = window.location.search;
  await travel('back');
  await screen.findByRole('dialog', { name: 'Несохранённые изменения задачи' });
  await waitFor(() => expect(window.location.search).toBe(old));
  await user.click(
    screen.getByRole('button', { name: 'Продолжить редактирование' }),
  );
  expect(screen.getByRole('textbox', { name: 'Название задачи' })).toHaveValue(
    'Работа B',
  );
  await travel('back');
  await screen.findByRole('dialog', { name: 'Несохранённые изменения задачи' });
  await waitFor(() => expect(window.location.search).toBe(old));
  await user.click(screen.getByRole('button', { name: 'Не сохранять' }));
  await waitFor(() =>
    expect(
      screen.queryByRole('complementary', { name: 'Задача' }),
    ).not.toBeInTheDocument(),
  );
  await travel('forward');
  await screen.findByRole('heading', { name: 'Работа A' });
  expect(window.location.search).toBe(old);
  expect(commandCalls).toHaveLength(0);
});
it('guards dirty Forward and saves once before executing its history transition', async () => {
  const user = await openDirty();
  await leave(user);
  await user.click(screen.getByRole('button', { name: 'Не сохранять' }));
  await screen.findByRole('heading', { name: 'Работа C' });
  const target = window.location.search;
  await travel('back');
  await screen.findByRole('heading', { name: 'Работа A' });
  await user.click(screen.getByRole('button', { name: 'Изменить название' }));
  await user.type(
    screen.getByRole('textbox', { name: 'Название задачи' }),
    ' изменена',
  );
  const old = window.location.search;
  await travel('forward');
  await screen.findByRole('dialog', { name: 'Несохранённые изменения задачи' });
  await waitFor(() => expect(window.location.search).toBe(old));
  await user.click(
    within(screen.getByRole('dialog')).getByRole('button', {
      name: 'Сохранить',
    }),
  );
  await screen.findByRole('heading', { name: 'Работа C' });
  expect(window.location.search).toBe(target);
  expect(commandCalls).toHaveLength(1);
  expect(commandCalls[0]?.command).toEqual({
    type: 'task.edit',
    taskId: id(1),
    changes: { title: 'Работа A изменена' },
  });
});
it('waits for a task decision before loading another project', async () => {
  const other = {
    ...project,
    id: '33333333-3333-4333-8333-333333333333',
    title: 'Второй демо-проект',
  };
  const original = fetchMock.getMockImplementation() as (
    url: string,
    init?: RequestInit,
  ) => Promise<Response>;
  fetchMock.mockImplementation((url: string, init?: RequestInit) => {
    if (url === '/api/projects') return json([project, other]);
    if (url === `/api/projects/${other.id}/tree`)
      return json({ ...tree, project: other, tasks: [] });
    return original(url, init);
  });
  const user = await openDirty();
  await user.click(screen.getByRole('button', { name: /Второй демо-проект/ }));
  expect(
    fetchMock.mock.calls.filter(
      ([url]) => url === `/api/projects/${other.id}/tree`,
    ),
  ).toHaveLength(0);
  await user.click(screen.getByRole('button', { name: 'Не сохранять' }));
  await screen.findByRole('heading', { name: 'Второй демо-проект' });
  expect(commandCalls).toHaveLength(0);
});
it('does not reuse a cancelled continuation after explicit logout and a new login', async () => {
  const user = await openDirty();
  await leave(user);
  await user.click(
    screen.getByRole('button', { name: 'Продолжить редактирование' }),
  );
  await user.click(screen.getByRole('button', { name: 'Сбросить изменения' }));
  await user.click(screen.getByRole('button', { name: 'Выйти' }));
  await screen.findByLabelText('Пароль');
  const original = fetchMock.getMockImplementation() as (
    url: string,
    init?: RequestInit,
  ) => Promise<Response>;
  fetchMock.mockImplementation((url: string, init?: RequestInit) =>
    url === '/api/auth/login'
      ? json({ authenticated: true, setupRequired: false })
      : original(url, init),
  );
  await user.type(
    screen.getByLabelText('Пароль'),
    'synthetic-navigation-password',
  );
  await user.click(screen.getByRole('button', { name: 'Войти' }));
  await screen.findByRole('heading', { name: project.title });
  expect(
    screen.queryByRole('complementary', { name: 'Задача' }),
  ).not.toBeInTheDocument();
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  expect(commandCalls).toHaveLength(0);
});
it('explains all four ordering boundaries for the only root task and cancels without a write', async () => {
  const user = await openDirty([task(1, 'Работа A')]);
  await user.click(screen.getByRole('button', { name: 'Сбросить изменения' }));
  const trigger = screen.getByRole('button', { name: 'Действия задачи' });
  await user.click(trigger);
  await user.click(screen.getByRole('menuitem', { name: 'Переместить…' }));
  const dialog = within(
    screen.getByRole('dialog', { name: 'Переместить задачу' }),
  );
  await user.click(dialog.getByText('Порядок и уровень'));
  for (const name of [
    'Выше',
    'Ниже',
    'На уровень выше',
    'Вложить в предыдущую задачу',
  ]) {
    const button = dialog.getByRole('button', { name });
    expect(button).toBeDisabled();
    expect(button).toHaveAccessibleDescription();
  }
  await user.click(dialog.getByRole('button', { name: 'Отмена' }));
  expect(trigger).toHaveFocus();
  expect(commandCalls).toHaveLength(0);
});
