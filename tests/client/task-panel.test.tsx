// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import {
  cleanup,
  fireEvent,
  render,
  screen,
  within,
  act,
  waitFor,
} from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState, type ComponentProps } from 'react';
import { afterEach, expect, it, vi } from 'vitest';
import { TaskPanel, type PanelTab } from '../../src/client/TaskPanel.js';
import { page5 } from './journal-fixtures.js';
import { journalFeedCoherent } from '../../src/client/journal-state.js';
import { emptySchedule, optionalTreeFixture, task } from './fixtures.js';

HTMLDialogElement.prototype.showModal = function () {
  this.setAttribute('open', '');
};
HTMLDialogElement.prototype.close = function () {
  this.removeAttribute('open');
};
afterEach(cleanup);
const initial = () => ({
  ...optionalTreeFixture(),
  tasks: [task(1, { title: 'Работа A' })],
  schedule: structuredClone(emptySchedule),
});
function Harness(props: Partial<ComponentProps<typeof TaskPanel>>) {
  const [tree] = useState(initial);
  const [tab, onTab] = useState<PanelTab>(props.tab ?? 'details');
  return (
    <TaskPanel
      task={tree.tasks[0]!}
      tasks={tree.tasks}
      tree={tree}
      removed={false}
      onDependency={vi.fn(async () => true)}
      onNeighbor={vi.fn()}
      onShow={vi.fn()}
      backTask={null}
      onBack={vi.fn()}
      collapsed={new Set()}
      onToggle={vi.fn()}
      onSelect={vi.fn()}
      onAction={vi.fn()}
      onMove={vi.fn()}
      onSave={vi.fn(async () => null)}
      onDirty={vi.fn()}
      onClose={vi.fn()}
      busy={false}
      retry={false}
      conflict={false}
      locked={false}
      feedback={null}
      {...props}
      tab={tab}
      onTab={onTab}
    />
  );
}
it('keeps one controlled title/status and persistent save across three tabs without writes on navigation', async () => {
  const onSave = vi.fn(async () => null);
  const user = userEvent.setup();
  render(<Harness onSave={onSave} />);
  expect(screen.getAllByRole('tab').map((tab) => tab.textContent)).toEqual([
    'Задача',
    'Зависимости',
    'Журнал',
  ]);
  expect(screen.getByRole('heading', { name: 'Работа A' })).toBeVisible();
  expect(screen.queryByLabelText('Название задачи')).toBeNull();
  expect(
    within(document.querySelector('.panel-header')!).getByRole('button', {
      name: /^Статус:/,
    }),
  ).toBeVisible();
  await user.click(screen.getByRole('button', { name: 'Изменить название' }));
  await user.clear(screen.getByLabelText('Название задачи'));
  await user.type(screen.getByLabelText('Название задачи'), 'Работа B');
  for (const name of ['Зависимости', 'Журнал', 'Задача', 'Журнал']) {
    await user.click(screen.getByRole('tab', { name }));
    expect(screen.getByRole('button', { name: 'Сохранить' })).toBeVisible();
    expect(onSave).not.toHaveBeenCalled();
  }
  await user.click(screen.getByRole('button', { name: 'Сохранить' }));
  expect(onSave).toHaveBeenCalledExactlyOnceWith({ title: 'Работа B' });
  expect(document.querySelectorAll('#task-panel-edit')).toHaveLength(1);
  expect(screen.getByRole('button', { name: 'Сохранить' })).toHaveAttribute(
    'form',
    'task-panel-edit',
  );
});
it('cancels only the title edit session with Escape and keeps description editing through tabs', async () => {
  const onClose = vi.fn(),
    onSave = vi.fn(async () => null);
  const user = userEvent.setup();
  render(<Harness onClose={onClose} onSave={onSave} />);
  await user.click(screen.getByRole('button', { name: 'Добавить описание' }));
  await user.type(screen.getByLabelText('Описание'), 'Строка 1{Enter}Строка 2');
  await user.click(screen.getByRole('button', { name: 'Изменить название' }));
  await user.type(screen.getByLabelText('Название задачи'), ' draft');
  await user.keyboard('{Escape}');
  expect(onClose).not.toHaveBeenCalled();
  expect(screen.getByRole('heading', { name: 'Работа A' })).toBeVisible();
  await user.click(screen.getByRole('tab', { name: 'Журнал' }));
  await user.click(
    screen.getByRole('button', { name: 'Продолжить редактирование' }),
  );
  expect(screen.getByLabelText('Описание')).toHaveValue('Строка 1\nСтрока 2');
  await user.click(screen.getByRole('button', { name: 'Сохранить' }));
  expect(onSave).toHaveBeenCalledExactlyOnceWith({
    description: 'Строка 1\nСтрока 2',
  });
});
it('normalizes the old subtasks alias and uses three-value keyboard navigation', async () => {
  const user = userEvent.setup();
  render(<Harness tab="subtasks" />);
  // A separate stateful harness allows the compatibility value to normalize on navigation.
  expect(screen.getByRole('tab', { name: 'Задача' })).toHaveAttribute(
    'aria-selected',
    'true',
  );
  expect(screen.getByRole('heading', { name: /Подзадачи/ })).toBeVisible();
  const tabs = screen.getAllByRole('tab');
  tabs[0]!.focus();
  await user.keyboard('{ArrowRight}');
  expect(tabs[1]).toHaveFocus();
  await user.keyboard('{End}');
  expect(tabs[2]).toHaveFocus();
  await user.keyboard('{Home}{ArrowLeft}');
  expect(tabs[2]).toHaveFocus();
});
it('explains empty title and keeps clean explicit legacy adoption available', async () => {
  const onSave = vi.fn(async () => null),
    user = userEvent.setup();
  const tree = initial();
  tree.schedule.diagnostics = [
    {
      code: 'LEGACY_INTERVAL_UNAVAILABLE',
      dependencyIds: [],
      messageKey: 'scheduling.LEGACY_INTERVAL_UNAVAILABLE',
      taskIds: [tree.tasks[0]!.id],
    },
  ];
  render(
    <Harness
      tree={tree}
      tasks={tree.tasks}
      task={tree.tasks[0]!}
      onSave={onSave}
    />,
  );
  expect(
    screen.getByText('Прежний интервал недоступен; полный расчёт неизвестен.', {
      exact: true,
    }),
  ).toBeVisible();
  expect(screen.getByRole('button', { name: 'Сохранить' })).toBeEnabled();
  await user.click(screen.getByRole('button', { name: 'Сохранить' }));
  expect(onSave).toHaveBeenCalledExactlyOnceWith({
    inputStart: null,
    inputFinish: null,
    durationDays: null,
  });
  await user.click(screen.getByRole('button', { name: 'Изменить название' }));
  fireEvent.change(screen.getByLabelText('Название задачи'), {
    target: { value: '  ' },
  });
  expect(screen.getByRole('button', { name: 'Сохранить' })).toBeDisabled();
  expect(screen.getByText('Укажите название задачи')).toBeVisible();
  await user.keyboard('{Enter}');
  expect(screen.queryByLabelText('Название задачи')).toBeNull();
  await user.click(screen.getByRole('button', { name: 'Исправить…' }));
  expect(await screen.findByLabelText('Название задачи')).toHaveFocus();
});

it('resets to the pinned task/source/incoming baseline after an unrelated newer GET and preserves separate editors', async () => {
  const tree = initial();
  tree.tasks.push(task(2, { title: 'A' }), task(3, { title: 'C' }));
  tree.tasks[0] = {
    ...tree.tasks[0]!,
    inputStart: '2026-10-05',
    inputFinish: '2026-10-06',
    durationDays: 2,
  };
  tree.dependencies = [
    {
      id: task(90).id,
      projectId: tree.project.id,
      predecessorId: task(2).id,
      successorId: task(1).id,
    },
  ];
  const separate = (
    <>
      <form>
        <input aria-label="Separate quick draft" defaultValue="Branch draft" />
      </form>
      <form>
        <textarea
          aria-label="Separate journal draft"
          defaultValue="Journal draft"
        />
      </form>
    </>
  );
  const onSave = vi.fn(async () => null),
    user = userEvent.setup();
  const p = {
    task: tree.tasks[0]!,
    tasks: tree.tasks,
    tree,
    onSave,
    subtaskInput: separate,
  };
  const view = render(<Harness {...p} />);
  await user.click(screen.getByRole('button', { name: 'Добавить подзадачу' }));
  await user.click(screen.getByRole('button', { name: 'Добавить описание' }));
  await user.type(screen.getByLabelText('Описание'), 'Own draft');
  const newer = {
    ...tree,
    project: { ...tree.project, revision: 8 },
    tasks: tree.tasks.map((t) =>
      t.id === task(1).id
        ? {
            ...t,
            title: 'Remote title',
            inputStart: null,
            inputFinish: null,
            durationDays: 9,
          }
        : t,
    ),
    dependencies: [],
  };
  view.rerender(
    <Harness {...p} tree={newer} tasks={newer.tasks} task={newer.tasks[0]!} />,
  );
  await user.click(screen.getByRole('button', { name: 'Сбросить изменения' }));
  expect(screen.getByRole('heading', { name: 'Работа A' })).toBeVisible();
  expect(screen.getByLabelText('Начало')).toHaveValue('05.10.2026');
  expect(screen.getByLabelText('Окончание')).toHaveValue('06.10.2026');
  expect(screen.getByLabelText('Длительность, рабочих дней')).toHaveValue('2');
  expect(screen.getByLabelText('Описание')).toHaveValue('');
  expect(screen.getByLabelText('Separate quick draft')).toHaveValue(
    'Branch draft',
  );
  expect(screen.getByLabelText('Separate journal draft')).toHaveValue(
    'Journal draft',
  );
  await user.click(screen.getByRole('tab', { name: 'Зависимости' }));
  await user.click(
    screen.getByRole('button', { name: 'Добавить предшественника' }),
  );
  expect(
    screen.getByRole('button', { name: 'Убрать предшественника: A' }),
  ).toBeVisible();
  expect(onSave).not.toHaveBeenCalled();
});

it('keeps a newer established baseline after an older frozen acknowledgement and rejects stale GETs', async () => {
  const tree = initial(),
    user = userEvent.setup();
  const frozen = { ...tree, project: { ...tree.project, revision: 7 } };
  const onSave = vi.fn(async () => frozen);
  const p = { task: tree.tasks[0]!, tasks: tree.tasks, tree, onSave };
  const view = render(<Harness {...p} />);
  const newer = {
    ...tree,
    project: { ...tree.project, revision: 8 },
    tasks: [{ ...tree.tasks[0]!, title: 'New saved baseline' }],
  };
  view.rerender(
    <Harness {...p} tree={newer} tasks={newer.tasks} task={newer.tasks[0]!} />,
  );
  await user.click(screen.getByRole('button', { name: 'Изменить название' }));
  fireEvent.change(screen.getByLabelText('Название задачи'), {
    target: { value: 'Next draft' },
  });
  await user.click(screen.getByRole('button', { name: 'Сохранить' }));
  expect(screen.queryByText('Сохранено')).not.toBeInTheDocument();
  view.rerender(
    <Harness
      {...p}
      tree={frozen}
      tasks={frozen.tasks}
      task={frozen.tasks[0]!}
    />,
  );
  expect(screen.getByLabelText('Название задачи')).toHaveValue('Next draft');
  await user.click(screen.getByRole('button', { name: 'Сбросить изменения' }));
  expect(screen.getByLabelText('Название задачи')).toHaveValue(
    'New saved baseline',
  );
  expect(screen.queryByRole('button', { name: 'Сохранить' })).toBeNull();
});

it('saves title source and graph incoming draft in exactly one task.edit', async () => {
  const tree = initial();
  tree.tasks.push(task(2, { title: 'Predecessor' }));
  const onSave = vi.fn(async () => null),
    onDependency = vi.fn(),
    user = userEvent.setup();
  render(
    <Harness
      tree={tree}
      tasks={tree.tasks}
      task={tree.tasks[0]!}
      onSave={onSave}
      onDependency={onDependency}
    />,
  );
  await user.click(screen.getByRole('button', { name: 'Изменить название' }));
  await user.clear(screen.getByLabelText('Название задачи'));
  await user.type(screen.getByLabelText('Название задачи'), 'Edited');
  fireEvent.change(screen.getByLabelText('Длительность, рабочих дней'), {
    target: { value: '3' },
  });
  fireEvent.blur(screen.getByLabelText('Длительность, рабочих дней'));
  await user.click(screen.getByRole('tab', { name: 'Зависимости' }));
  await user.click(
    screen.getByRole('button', { name: 'Добавить предшественника' }),
  );
  await user.click(screen.getByRole('option', { name: /Predecessor/ }));
  await user.keyboard('{Escape}');
  expect(onSave).not.toHaveBeenCalled();
  expect(onDependency).not.toHaveBeenCalled();
  expect(screen.getByRole('tab', { name: 'Зависимости' })).toHaveTextContent(
    'Зависимости',
  );
  expect(screen.getByText('Не сохранено')).toBeVisible();
  expect(
    screen.getByRole('tab', { name: 'Зависимости' }),
  ).not.toHaveTextContent('(1)');
  expect(
    screen.getByRole('tab', { name: 'Зависимости' }),
  ).toHaveAccessibleDescription('Входящие связи: Не сохранено');
  await user.click(screen.getByRole('button', { name: 'Сохранить' }));
  expect(onSave).toHaveBeenCalledExactlyOnceWith({
    title: 'Edited',
    durationDays: 3,
    predecessorIds: [task(2).id],
  });
});

it('keeps newer incoming draft and current tree after a frozen acknowledgement of the sent graph snapshot', async () => {
  const tree = initial();
  tree.tasks.push(task(2, { title: 'A' }), task(3, { title: 'B' }));
  const frozen = {
    ...tree,
    project: { ...tree.project, revision: 1 },
    dependencies: [
      {
        id: task(90).id,
        projectId: tree.project.id,
        predecessorId: task(2).id,
        successorId: task(1).id,
      },
    ],
  };
  let acknowledge!: (tree: typeof frozen) => void;
  const onSave = vi.fn(
      () =>
        new Promise<typeof frozen>((resolve) => {
          acknowledge = resolve;
        }),
    ),
    user = userEvent.setup();
  const p = { tree, tasks: tree.tasks, task: tree.tasks[0]!, onSave };
  const view = render(<Harness {...p} />);
  await user.click(screen.getByRole('tab', { name: 'Зависимости' }));
  await user.click(
    screen.getByRole('button', { name: 'Добавить предшественника' }),
  );
  await user.click(screen.getByRole('option', { name: /^A/ }));
  await user.keyboard('{Escape}');
  await user.click(screen.getByRole('button', { name: 'Сохранить' }));
  // This component boundary fixture simulates a newer caller draft; App keeps actual busy/uncertain inputs locked.
  await user.click(
    screen.getByRole('button', { name: 'Добавить предшественника' }),
  );
  await user.click(screen.getByRole('option', { name: /^B/ }));
  await user.keyboard('{Escape}');
  const newer = {
    ...frozen,
    project: { ...tree.project, revision: 2 },
    tasks: tree.tasks.map((t) =>
      t.id === task(3).id ? { ...t, title: 'B newer' } : t,
    ),
  };
  view.rerender(
    <Harness {...p} tree={newer} tasks={newer.tasks} task={newer.tasks[0]!} />,
  );
  await act(async () => {
    acknowledge(frozen);
  });
  await waitFor(() =>
    expect(screen.getByRole('button', { name: 'Сохранить' })).toBeEnabled(),
  );
  expect(screen.queryByText('Сохранено', { exact: true })).toBeNull();
  expect(screen.getByText('Не сохранено', { exact: true })).toBeVisible();
  expect(
    screen.getByRole('button', { name: 'Открыть: B newer' }),
  ).toBeVisible();
  expect(screen.getByRole('tab', { name: 'Зависимости' })).toHaveTextContent(
    '(1)',
  );
  expect(
    screen.getByRole('tab', { name: 'Зависимости' }),
  ).toHaveAccessibleDescription('(1) Входящие связи: Не сохранено');
  await user.click(screen.getByRole('button', { name: 'Сбросить изменения' }));
  expect(screen.queryByText('Не сохранено', { exact: true })).toBeNull();
  expect(screen.queryByRole('button', { name: 'Открыть: B newer' })).toBeNull();
  expect(onSave).toHaveBeenCalledExactlyOnceWith({
    predecessorIds: [task(2).id],
  });
});
it('labels only scheduling edits as saved-plan analysis and keeps hard locks on incoming', async () => {
  const user = userEvent.setup();
  const view = render(<Harness />);
  await user.click(screen.getByRole('button', { name: 'Изменить название' }));
  await user.type(screen.getByLabelText('Название задачи'), ' draft');
  await user.click(screen.getByRole('tab', { name: 'Зависимости' }));
  expect(screen.queryByText('По сохранённому плану')).toBeNull();
  await user.click(screen.getByRole('button', { name: /^Статус:/ }));
  await user.click(screen.getByRole('menuitem', { name: 'В работе' }));
  expect(screen.queryByText('По сохранённому плану')).toBeNull();
  expect(screen.getByRole('alert')).toBeVisible();
  for (const lock of [
    { busy: true },
    { locked: true },
    { removed: true },
    { conflict: true },
  ]) {
    view.rerender(<Harness {...lock} />);
    expect(
      screen.getByRole('button', { name: 'Добавить предшественника' }),
    ).toBeDisabled();
  }
});

it.each([
  { revision: 8, matchingProject: true, newer: true },
  { revision: 7, matchingProject: true, newer: false },
  { revision: 6, matchingProject: true, newer: false },
  { revision: 8, matchingProject: false, newer: false },
])(
  'missing task feedback distinguishes newer coherent metadata from stale metadata: $revision/$matchingProject',
  ({ revision, matchingProject, newer }) => {
    const tree = initial();
    tree.project.revision = 7;
    tree.tasks = [];
    render(
      <Harness
        task={task(1)}
        tasks={[]}
        tree={tree}
        removed
        journalMetadata={{
          projectId: matchingProject
            ? tree.project.id
            : '99999999-9999-4999-8999-999999999999',
          revision,
          tasks: [task(1)],
        }}
      />,
    );
    if (newer) {
      expect(
        screen.getAllByText(
          'Обновите план, чтобы проверить задачу и продолжить редактирование.',
        )[0],
      ).toBeVisible();
      expect(screen.queryByText(/Выбранная задача удалена/)).toBeNull();
      expect(
        screen.queryByText('Сохранение удалённой задачи недоступно'),
      ).toBeNull();
    } else {
      expect(screen.getByText(/Выбранная задача удалена/)).toBeVisible();
      expect(
        screen.queryByText(
          'Обновите план, чтобы проверить задачу и продолжить редактирование.',
        ),
      ).toBeNull();
    }
    expect(screen.getByRole('button', { name: 'Сохранить' })).toBeDisabled();
  },
);

it.each(['ready', 'stale', 'metadata-error', 'error', 'loading'] as const)(
  'keeps journal ancestor context visible but gates navigation during %s',
  async (phase) => {
    const parent = task(2, { title: 'Сохранённый родитель' });
    const child = task(1, { parentId: parent.id });
    const onAncestor = vi.fn();
    const tree = { ...initial(), tasks: [parent, child] };
    const metadata = {
      projectId: tree.project.id,
      revision: tree.project.revision,
      tasks: tree.tasks,
    };
    render(
      <Harness
        task={child}
        tree={tree}
        tasks={tree.tasks}
        tab="journal"
        journalMetadata={metadata}
        journalNavigationDisabled={
          !journalFeedCoherent({
            metadata,
            page: { ...page5, projectRevision: metadata.revision },
            phase,
            scope: { projectId: tree.project.id, taskId: child.id, query: {} },
            pendingPage: null,
            error: null,
          })
        }
        onAncestor={onAncestor}
      />,
    );
    const ancestor = within(
      screen.getByRole('navigation', { name: 'Путь задачи' }),
    ).getByRole('button', { name: parent.title });
    expect(ancestor).toBeVisible();
    if (phase === 'ready') {
      expect(ancestor).toBeEnabled();
      fireEvent.click(ancestor);
      expect(onAncestor).toHaveBeenCalledExactlyOnceWith(parent, 'journal');
    } else {
      expect(ancestor).toBeDisabled();
      fireEvent.click(ancestor);
      expect(onAncestor).not.toHaveBeenCalled();
    }
  },
);

it('keeps actionable saved conflicts outside collapsed calculation on both planning tabs without missing-date warnings', async () => {
  const tree = initial();
  tree.schedule.analysisStatus = 'infeasible';
  tree.schedule.feasibility = 'infeasible';
  tree.schedule.diagnostics = [
    {
      code: 'EXPLICIT_PRECEDENCE_CONFLICT',
      taskIds: [task(1).id],
      dependencyIds: [],
      messageKey: 'scheduling.EXPLICIT_PRECEDENCE_CONFLICT',
    },
    {
      code: 'UNKNOWN_INTERVAL',
      taskIds: [task(1).id],
      dependencyIds: [],
      messageKey: 'scheduling.UNKNOWN_INTERVAL',
    },
  ];
  const user = userEvent.setup();
  render(<Harness tree={tree} />);
  const message = 'Предшественник заканчивается после явного начала.';
  expect(screen.getByText(message, { exact: true })).toBeVisible();
  await user.click(screen.getByRole('tab', { name: 'Зависимости' }));
  const calculation = screen
    .getByText('Расчёт', { exact: true })
    .closest('details')!;
  expect(calculation.open).toBe(false);
  expect(screen.getByText(message, { exact: true })).toBeVisible();
  await user.click(screen.getByText('Расчёт', { exact: true }));
  expect(screen.getAllByText(message, { exact: true })).toHaveLength(1);
  expect(
    screen.queryByText(/Полная пара дат не задана|Неполные сроки/),
  ).toBeNull();
});

it('edits the common title in Journal while saved heading/path remain visible and Escape restores only the edit session', async () => {
  const user = userEvent.setup();
  const tree = initial();
  const parent = task(2, { title: 'Сохранённая ветка' });
  tree.tasks[0]!.parentId = parent.id;
  const metadata = {
    projectId: tree.project.id,
    revision: tree.project.revision,
    tasks: [...tree.tasks, parent],
  };
  const onSave = vi.fn(async () => null);
  render(
    <Harness
      tree={tree}
      task={tree.tasks[0]!}
      tab="journal"
      journalMetadata={metadata}
      onSave={onSave}
    />,
  );
  await user.click(screen.getByRole('button', { name: 'Изменить название' }));
  expect(screen.getByText('Локальное название задачи')).toBeVisible();
  await user.type(screen.getByLabelText('Название задачи'), ' черновик');
  expect(screen.getByRole('heading', { name: 'Работа A' })).toHaveTextContent(
    'Работа A',
  );
  expect(screen.getByText('Сохранённая ветка')).toBeVisible();
  await user.keyboard('{Enter}');
  expect(
    screen.getByText('Несохранённое название: Работа A черновик'),
  ).toBeVisible();
  await user.click(screen.getByRole('button', { name: 'Изменить название' }));
  await user.type(screen.getByLabelText('Название задачи'), ' отменить');
  await user.keyboard('{Escape}');
  expect(
    screen.getByText('Несохранённое название: Работа A черновик'),
  ).toBeVisible();
  expect(screen.getByRole('heading', { name: 'Работа A' })).toHaveTextContent(
    'Работа A',
  );
  await user.click(screen.getByRole('button', { name: 'Сохранить' }));
  expect(onSave).toHaveBeenCalledExactlyOnceWith({
    title: 'Работа A черновик',
  });
});
it('returns matched task-save feedback to clean after a short interval and preserves newer edits', async () => {
  vi.useFakeTimers();
  try {
    const tree = initial();
    const ack = {
      ...tree,
      project: { ...tree.project, revision: tree.project.revision + 1 },
      tasks: [{ ...tree.tasks[0]!, title: 'Saved title' }],
    };
    render(<Harness onSave={vi.fn(async () => ack)} />);
    fireEvent.click(screen.getByRole('button', { name: 'Изменить название' }));
    fireEvent.change(screen.getByLabelText('Название задачи'), {
      target: { value: 'Saved title' },
    });
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Сохранить' }));
    });
    expect(screen.getByText('Сохранено', { exact: true })).toBeVisible();
    act(() => {
      vi.advanceTimersByTime(4000);
    });
    expect(screen.queryByText('Сохранено', { exact: true })).toBeNull();
    expect(
      within(document.querySelector('.panel-footer')!).getByRole('status', {
        hidden: true,
      }),
    ).toBeEmptyDOMElement();
    fireEvent.change(screen.getByLabelText('Название задачи'), {
      target: { value: 'todo' },
    });
    act(() => {
      vi.advanceTimersByTime(4000);
    });
    expect(screen.getByText('Есть несохранённые изменения')).toBeVisible();
  } finally {
    vi.useRealTimers();
  }
});
it.each(['status', 'source', 'raw', 'incoming'] as const)(
  'labels saved diagnostics for %s edits on Task without duplicating Dependencies',
  async (field) => {
    const tree = initial();
    tree.tasks.push(task(2, { title: 'Предшественник' }));
    tree.schedule.diagnostics = [
      {
        code: 'EXPLICIT_PRECEDENCE_CONFLICT',
        taskIds: [task(1).id],
        dependencyIds: [],
        messageKey: 'scheduling.EXPLICIT_PRECEDENCE_CONFLICT',
      },
    ];
    const user = userEvent.setup();
    render(<Harness tree={tree} tasks={tree.tasks} />);
    await user.click(screen.getByRole('button', { name: 'Изменить название' }));
    await user.type(screen.getByLabelText('Название задачи'), ' draft{Enter}');
    expect(screen.queryByText('По сохранённому плану')).toBeNull();
    if (field === 'status') {
      await user.click(screen.getByRole('button', { name: /^Статус:/ }));
      await user.click(screen.getByRole('menuitem', { name: 'В работе' }));
    } else if (field === 'incoming') {
      await user.click(screen.getByRole('tab', { name: 'Зависимости' }));
      await user.click(
        screen.getByRole('button', { name: 'Добавить предшественника' }),
      );
      await user.click(screen.getByRole('option', { name: /Предшественник/ }));
      await user.click(screen.getByRole('tab', { name: 'Задача' }));
    } else {
      await user.click(screen.getByRole('button', { name: /^Сроки задачи:/ }));
      const input = screen.getByRole('textbox', { name: /Длительность,/ });
      await user.clear(input);
      await user.type(input, field === 'raw' ? '3e' : '3');
      await user.keyboard('{Escape}');
    }
    if (field === 'status')
      expect(screen.queryByText('По сохранённому плану')).toBeNull();
    else expect(screen.getByText('По сохранённому плану')).toBeVisible();
    expect(
      screen.getByText('Предшественник заканчивается после явного начала.', {
        exact: true,
      }),
    ).toBeVisible();
    await user.click(screen.getByRole('tab', { name: 'Зависимости' }));
    expect(screen.queryAllByText('По сохранённому плану')).toHaveLength(
      field === 'status' ? 0 : 1,
    );
  },
);

it('cancels old success feedback on new drafts and unmount without clearing a newer task acknowledgement', async () => {
  vi.useFakeTimers();
  try {
    const tree = initial();
    const ack = {
      ...tree,
      project: { ...tree.project, revision: tree.project.revision + 1 },
      tasks: [{ ...tree.tasks[0]!, title: 'Saved title' }],
    };
    const save = async () => {
      fireEvent.click(
        screen.getByRole('button', { name: 'Изменить название' }),
      );
      fireEvent.change(screen.getByLabelText('Название задачи'), {
        target: { value: 'Saved title' },
      });
      await act(async () => {
        fireEvent.click(screen.getByRole('button', { name: 'Сохранить' }));
      });
    };
    const view = render(
      <Harness key="first" onSave={vi.fn(async () => ack)} />,
    );
    await save();
    act(() => {
      vi.advanceTimersByTime(500);
    });
    fireEvent.change(screen.getByLabelText('Название задачи'), {
      target: { value: 'todo' },
    });
    expect(screen.queryByText('Сохранено', { exact: true })).toBeNull();
    act(() => {
      vi.advanceTimersByTime(2500);
    });
    expect(screen.getByText('Есть несохранённые изменения')).toBeVisible();
    view.rerender(
      <Harness key="first-again" onSave={vi.fn(async () => ack)} />,
    );
    await save();
    expect(screen.getByText('Сохранено', { exact: true })).toBeVisible();
    act(() => {
      vi.advanceTimersByTime(1500);
    });
    const second = task(2, { title: 'Работа B' });
    const secondTree = { ...tree, tasks: [second] };
    const secondAck = {
      ...ack,
      tasks: [{ ...second, title: 'Saved title' }],
    };
    view.rerender(
      <Harness
        key="second"
        task={second}
        tasks={secondTree.tasks}
        tree={secondTree}
        onSave={vi.fn(async () => secondAck)}
      />,
    );
    await save();
    act(() => {
      vi.advanceTimersByTime(1000);
    });
    expect(screen.getByText('Сохранено', { exact: true })).toBeVisible();
    act(() => {
      vi.advanceTimersByTime(1500);
    });
    expect(screen.queryByText('Сохранено', { exact: true })).toBeNull();
  } finally {
    vi.useRealTimers();
  }
});
