// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import {
  cleanup,
  render,
  screen,
  fireEvent,
  act,
  within,
} from '@testing-library/react';
import { useState } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { Dependencies } from '../../src/client/Dependencies.js';
import { emptySchedule, project, task } from './fixtures.js';
afterEach(cleanup);
describe('direct dependency graph', () => {
  const a = task(1),
    b = task(2),
    current = task(3),
    d = task(4),
    e = task(8);
  const edges = [
    {
      id: '33333333-3333-4333-8333-000000000001',
      projectId: project.id,
      predecessorId: a.id,
      successorId: current.id,
    },
    {
      id: '33333333-3333-4333-8333-000000000002',
      projectId: project.id,
      predecessorId: b.id,
      successorId: current.id,
    },
    {
      id: '33333333-3333-4333-8333-000000000003',
      projectId: project.id,
      predecessorId: current.id,
      successorId: d.id,
    },
    {
      id: '33333333-3333-4333-8333-000000000004',
      projectId: project.id,
      predecessorId: current.id,
      successorId: e.id,
    },
  ];
  const tree = {
    contractVersion: 2 as const,
    project,
    tasks: [a, b, current, d, e],
    dependencies: edges,
    schedule: { ...emptySchedule },
    canUndo: false,
  };
  it('draws one separate edge per neighbor, selects neighbors and deletes only a link', () => {
    const onCommand = vi.fn().mockResolvedValue(true),
      onSelect = vi.fn(),
      onShow = vi.fn();
    const view = render(
      <Dependencies
        task={current}
        tree={tree}
        incomingIds={[a.id, b.id]}
        onIncomingChange={vi.fn()}
        taskDirty={false}
        scheduleDirty={false}
        disabled={false}
        onCommand={onCommand}
        onSelect={onSelect}
        onShow={onShow}
      />,
    );
    expect(
      view.container.querySelectorAll('[data-dependency-edge]'),
    ).toHaveLength(4);
    expect(
      [...view.container.querySelectorAll('[data-dependency-edge] title')].map(
        (node) => node.textContent,
      ),
    ).toEqual([
      'Работа 1 → Работа 3',
      'Работа 2 → Работа 3',
      'Работа 3 → Работа 4',
      'Работа 3 → Работа 8',
    ]);
    expect(screen.queryByText('Критическая связь')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /Открыть: Работа 1/ }));
    expect(onSelect).toHaveBeenCalledWith(a);
    fireEvent.click(
      screen.getByRole('button', { name: 'Удалить связь: Работа 1' }),
    );
    expect(onCommand).not.toHaveBeenCalled();
    fireEvent.click(
      screen.getByRole('button', { name: 'Удалить связь: Работа 4' }),
    );
    expect(onCommand).toHaveBeenCalledWith({
      type: 'dependency.delete',
      dependencyId: edges[2]!.id,
    });
    fireEvent.click(screen.getByRole('button', { name: 'Показать на Ганте' }));
    expect(onShow).toHaveBeenCalledWith(current);
  });
  it('edits incoming as a restorable draft and blocks outgoing until saved', () => {
    const onCommand = vi.fn().mockResolvedValue(true),
      onIncomingChange = vi.fn();
    function DraftGraph() {
      const [ids, setIds] = useState([a.id, b.id]);
      return (
        <Dependencies
          task={current}
          tree={{ ...tree, tasks: [...tree.tasks, task(7)] }}
          disabled={false}
          incomingIds={ids}
          onIncomingChange={(next) => {
            setIds(next);
            onIncomingChange(next);
          }}
          taskDirty={ids.join() !== [a.id, b.id].join()}
          scheduleDirty={ids.join() !== [a.id, b.id].join()}
          onCommand={onCommand}
          onSelect={vi.fn()}
          onShow={vi.fn()}
        />
      );
    }
    const view = render(<DraftGraph />);
    fireEvent.click(
      screen.getByRole('button', { name: 'Удалить связь: Работа 1' }),
    );
    expect(
      view.container.querySelectorAll('[data-dependency-edge]'),
    ).toHaveLength(4);
    expect(screen.getByText('Ожидает удаления')).toBeVisible();
    expect(
      screen.getByRole('button', { name: 'Добавить последователя' }),
    ).toBeDisabled();
    expect(
      screen.getByText('Сначала сохраните или отмените изменения задачи'),
    ).toBeVisible();
    fireEvent.click(
      screen.getByRole('button', { name: 'Восстановить связь: Работа 1' }),
    );
    fireEvent.click(
      screen.getByRole('button', { name: 'Добавить предшественника' }),
    );
    fireEvent.click(screen.getByRole('option', { name: /Работа 7/ }));
    expect(onCommand).not.toHaveBeenCalled();
    expect(onIncomingChange).toHaveBeenLastCalledWith([a.id, b.id, task(7).id]);
    expect(screen.getAllByText('Не сохранено').length).toBeGreaterThan(0);
    expect(screen.getByText('По сохранённому плану')).toBeVisible();
    expect(
      view.container.querySelectorAll('[data-dependency-edge]'),
    ).toHaveLength(5);
  });
  it('selects a clean successor through one immediate outgoing command', () => {
    const onCommand = vi.fn().mockResolvedValue(true);
    render(
      <Dependencies
        task={current}
        tree={{ ...tree, tasks: [...tree.tasks, task(7)] }}
        incomingIds={[a.id, b.id]}
        onIncomingChange={vi.fn()}
        taskDirty={false}
        scheduleDirty={false}
        disabled={false}
        onCommand={onCommand}
        onSelect={vi.fn()}
        onShow={vi.fn()}
      />,
    );
    fireEvent.click(
      screen.getByRole('button', { name: 'Добавить последователя' }),
    );
    expect(screen.queryByRole('option', { name: /Работа 1/ })).toBeNull();
    fireEvent.click(screen.getByRole('option', { name: /Работа 7/ }));
    expect(onCommand).toHaveBeenCalledExactlyOnceWith({
      type: 'dependency.create',
      predecessorId: current.id,
      successorId: task(7).id,
    });
  });
  it.each([false, true])(
    'restores outgoing focus after busy clears unless the user focused then blurred: %s',
    async (userChangedFocus) => {
      let acknowledge!: (success: boolean) => void;
      let finishBusy!: () => void;
      const pending = new Promise<boolean>((resolve) => {
        acknowledge = resolve;
      });
      function BusyGraph() {
        const [busy, setBusy] = useState(false);
        finishBusy = () => setBusy(false);
        return (
          <>
            <button type="button">Другой контрол</button>
            <Dependencies
              task={current}
              tree={{ ...tree, tasks: [...tree.tasks, task(7)] }}
              incomingIds={[a.id, b.id]}
              onIncomingChange={vi.fn()}
              taskDirty={false}
              scheduleDirty={false}
              disabled={busy}
              onCommand={() => {
                setBusy(true);
                return pending;
              }}
              onSelect={vi.fn()}
              onShow={vi.fn()}
            />
          </>
        );
      }
      render(<BusyGraph />);
      const trigger = screen.getByRole('button', {
        name: 'Добавить последователя',
      });
      fireEvent.click(trigger);
      fireEvent.click(screen.getByRole('option', { name: /Работа 7/ }));
      expect(trigger).toBeDisabled();
      if (userChangedFocus) {
        const other = screen.getByRole('button', { name: 'Другой контрол' });
        other.focus();
        other.blur();
      }
      await act(async () => {
        acknowledge(true);
        await pending;
      });
      expect(screen.queryByRole('dialog')).toBeNull();
      act(() => {
        finishBusy();
      });
      expect(trigger).toBeEnabled();
      if (userChangedFocus) expect(document.activeElement).toBe(document.body);
      else expect(trigger).toHaveFocus();
    },
  );
  it.each(['incoming', 'outgoing'] as const)(
    'keeps current card and remaining %s neighbors visible when the last page shrinks',
    (direction) => {
      const neighbors = Array.from({ length: 5 }, (_, index) =>
        task(index + 10),
      );
      const dependencies = neighbors.map((item, index) => ({
        id: `33333333-3333-4333-8333-${String(index + 10).padStart(12, '0')}`,
        projectId: project.id,
        predecessorId: direction === 'incoming' ? item.id : current.id,
        successorId: direction === 'incoming' ? current.id : item.id,
      }));
      const props = {
        task: current,
        incomingIds:
          direction === 'incoming' ? neighbors.map((item) => item.id) : [],
        onIncomingChange: vi.fn(),
        taskDirty: false,
        scheduleDirty: false,
        disabled: false,
        onCommand: vi.fn(),
        onSelect: vi.fn(),
        onShow: vi.fn(),
      };
      const large = { ...tree, tasks: [current, ...neighbors], dependencies };
      const view = render(<Dependencies {...props} tree={large} />);
      fireEvent.click(screen.getByRole('button', { name: 'Показать ещё' }));
      expect(
        screen.getByRole('button', { name: /Открыть: Работа 14/ }),
      ).toBeInTheDocument();
      view.rerender(
        <Dependencies
          {...props}
          incomingIds={
            direction === 'incoming'
              ? neighbors.slice(0, 4).map((item) => item.id)
              : []
          }
          tree={{ ...large, dependencies: dependencies.slice(0, 4) }}
        />,
      );
      expect(
        view.container.querySelectorAll('[data-dependency-edge]'),
      ).toHaveLength(4);
      expect(
        screen.getByRole('button', { name: /Открыть: Работа 10/ }),
      ).toBeInTheDocument();
      expect(
        screen.getByRole('button', { name: /Открыть: Работа 3/ }),
      ).toBeInTheDocument();
    },
  );
});

it('summary explains leaf-only and offers leaf navigation without add actions', () => {
  const parent = task(20),
    child = task(21, { parentId: parent.id }),
    onSelect = vi.fn();
  render(
    <Dependencies
      task={parent}
      tree={{
        contractVersion: 2,
        project,
        tasks: [parent, child],
        dependencies: [],
        schedule: emptySchedule,
        canUndo: false,
      }}
      incomingIds={[]}
      onIncomingChange={vi.fn()}
      taskDirty={false}
      scheduleDirty={false}
      disabled={false}
      onSelect={onSelect}
      onShow={vi.fn()}
      onCommand={vi.fn()}
    />,
  );
  expect(
    screen.queryByRole('button', { name: 'Добавить предшественника' }),
  ).toBeNull();
  expect(
    screen.queryByRole('button', { name: 'Добавить последователя' }),
  ).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: child.title }));
  expect(onSelect).toHaveBeenCalledWith(child);
});

it('retains a missing incoming endpoint after a newer tree without crashing or enabling navigation', () => {
  const current = task(1);
  render(
    <Dependencies
      task={current}
      tree={{
        contractVersion: 2,
        project,
        tasks: [current],
        dependencies: [],
        schedule: emptySchedule,
        canUndo: false,
      }}
      incomingIds={[task(2).id]}
      onIncomingChange={vi.fn()}
      taskDirty
      scheduleDirty
      disabled
      onCommand={vi.fn()}
      onSelect={vi.fn()}
      onShow={vi.fn()}
    />,
  );
  expect(screen.getByText('Задача удалена')).toBeVisible();
  expect(
    screen.getByRole('button', { name: 'Открыть: Задача удалена' }),
  ).toBeDisabled();
});

it.each([0, 1, 5])(
  'renders matching section headers, all counts and independent paging for %i neighbors',
  (count) => {
    const current = task(50),
      incoming = Array.from({ length: count }, (_, i) => task(i + 1)),
      outgoing = Array.from({ length: count }, (_, i) => task(i + 10));
    const dependencies = [
      ...incoming.map((item) => ({
        id: `in:${item.id}`,
        projectId: project.id,
        predecessorId: item.id,
        successorId: current.id,
      })),
      ...outgoing.map((item) => ({
        id: `out:${item.id}`,
        projectId: project.id,
        predecessorId: current.id,
        successorId: item.id,
      })),
    ];
    const props = {
      task: current,
      incomingIds: incoming.map((x) => x.id),
      onIncomingChange: vi.fn(),
      taskDirty: false,
      scheduleDirty: false,
      disabled: false,
      onCommand: vi.fn(),
      onSelect: vi.fn(),
      onShow: vi.fn(),
    };
    const view = render(
      <Dependencies
        {...props}
        tree={{
          contractVersion: 2,
          project,
          tasks: [current, ...incoming, ...outgoing],
          dependencies,
          schedule: emptySchedule,
          canUndo: false,
        }}
      />,
    );
    const graph = view.container.querySelector('.dependency-graph')!;
    const headers = graph.querySelectorAll('.dependency-section-header');
    expect(headers).toHaveLength(2);
    expect(headers[0]).toHaveTextContent(`Предшественники (${count})`);
    expect(headers[1]).toHaveTextContent(`Последователи (${count})`);
    expect(
      within(headers[0] as HTMLElement).getByRole('button', {
        name: 'Добавить предшественника',
      }),
    ).toHaveTextContent('+ Добавить');
    expect(
      within(headers[1] as HTMLElement).getByRole('button', {
        name: 'Добавить последователя',
      }),
    ).toHaveTextContent('+ Добавить');
    expect(graph.querySelectorAll('[data-dependency-edge]')).toHaveLength(
      Math.min(4, count) * 2,
    );
    if (count === 5) {
      fireEvent.click(
        within(headers[0] as HTMLElement).getByRole('button', {
          name: 'Показать ещё',
        }),
      );
      expect(
        within(graph as HTMLElement).getByRole('button', {
          name: 'Открыть: Работа 5',
        }),
      ).toBeVisible();
      expect(
        within(graph as HTMLElement).getByRole('button', {
          name: 'Открыть: Работа 10',
        }),
      ).toBeVisible();
    }
  },
);
it('counts only final incoming IDs while retaining removed cards and section unsaved marker', () => {
  const current = task(3),
    before = task(1),
    after = task(2);
  const view = render(
    <Dependencies
      task={current}
      tree={{
        contractVersion: 2,
        project,
        tasks: [before, current, after],
        dependencies: [
          {
            id: 'in',
            projectId: project.id,
            predecessorId: before.id,
            successorId: current.id,
          },
        ],
        schedule: emptySchedule,
        canUndo: false,
      }}
      incomingIds={[]}
      onIncomingChange={vi.fn()}
      taskDirty
      scheduleDirty
      disabled={false}
      onCommand={vi.fn()}
      onSelect={vi.fn()}
      onShow={vi.fn()}
    />,
  );
  const header = view.container.querySelector('.dependency-section-header')!;
  expect(header).toHaveTextContent('Предшественники (0)');
  expect(header).toHaveTextContent('Не сохранено');
  expect(
    screen.getByRole('button', { name: 'Восстановить связь: Работа 1' }),
  ).toBeVisible();
});

it.each([
  'close',
  'outside-pointer',
  'task-change',
  'missing-trigger',
] as const)(
  'handles pending graph focus intent and %s without stealing focus',
  async (action) => {
    const current = task(40),
      next = task(41),
      candidate = task(42);
    const tree = {
      contractVersion: 2 as const,
      project,
      tasks: [current, next, candidate],
      dependencies: [],
      schedule: emptySchedule,
      canUndo: false,
    };
    let acknowledge!: (success: boolean) => void;
    const pending = new Promise<boolean>((resolve) => {
      acknowledge = resolve;
    });
    const props = {
      task: current,
      tree,
      incomingIds: [],
      onIncomingChange: vi.fn(),
      taskDirty: false,
      scheduleDirty: false,
      disabled: false,
      onCommand: vi.fn(() => pending),
      onSelect: vi.fn(),
      onShow: vi.fn(),
    };
    const view = render(
      <>
        <button type="button">Outside</button>
        <Dependencies {...props} />
      </>,
    );
    const trigger = screen.getByRole('button', {
      name: 'Добавить последователя',
    });
    fireEvent.click(trigger);
    fireEvent.click(screen.getByRole('option', { name: /Работа 42/ }));
    view.rerender(
      <>
        <button type="button">Outside</button>
        <Dependencies {...props} disabled />
      </>,
    );
    fireEvent.click(
      screen.getByRole('button', { name: 'Закрыть выбор последователей' }),
    );
    expect(screen.queryByRole('dialog')).toBeNull();
    if (action === 'outside-pointer') fireEvent.pointerDown(document.body);
    if (action === 'task-change')
      view.rerender(
        <>
          <button type="button">Outside</button>
          <Dependencies {...props} task={next} disabled />
        </>,
      );
    if (action === 'missing-trigger') {
      const summaryTree = {
        ...tree,
        tasks: [...tree.tasks, task(43, { parentId: current.id })],
      };
      view.rerender(
        <>
          <button type="button">Outside</button>
          <Dependencies {...props} tree={summaryTree} disabled />
        </>,
      );
    }
    await act(async () => {
      acknowledge(true);
      await pending;
    });
    const finalTask = action === 'task-change' ? next : current;
    const finalTree =
      action === 'missing-trigger'
        ? {
            ...tree,
            tasks: [...tree.tasks, task(43, { parentId: current.id })],
          }
        : tree;
    view.rerender(
      <>
        <button type="button">Outside</button>
        <Dependencies {...props} task={finalTask} tree={finalTree} />
      </>,
    );
    if (action === 'close') expect(trigger).toHaveFocus();
    else if (action === 'missing-trigger')
      expect(
        view.container.querySelectorAll('.dependency-section-header')[1],
      ).toHaveFocus();
    else expect(document.activeElement).toBe(document.body);
    // A completed one-time request never reclaims focus after later interaction.
    const outside = screen.getByRole('button', { name: 'Outside' });
    outside.focus();
    outside.blur();
    view.rerender(
      <>
        <button type="button">Outside</button>
        <Dependencies {...props} task={finalTask} tree={finalTree} />
      </>,
    );
    expect(document.activeElement).toBe(document.body);
  },
);
it('rechecks dirty outgoing guards while open, deletes the exact edge and keeps removal picker open', async () => {
  const current = task(40),
    candidate = task(41),
    selected = task(42),
    incoming = task(43);
  const tree = {
    contractVersion: 2 as const,
    project,
    tasks: [current, candidate, selected, incoming],
    dependencies: [
      {
        id: 'exact-outgoing-edge',
        projectId: project.id,
        predecessorId: current.id,
        successorId: selected.id,
      },
      {
        id: 'other-incoming-edge',
        projectId: project.id,
        predecessorId: incoming.id,
        successorId: selected.id,
      },
    ],
    schedule: emptySchedule,
    canUndo: false,
  };
  const onCommand = vi.fn().mockResolvedValue(true),
    onIncomingChange = vi.fn();
  const props = {
    task: current,
    tree,
    incomingIds: [],
    onIncomingChange,
    taskDirty: false,
    scheduleDirty: false,
    disabled: false,
    onCommand,
    onSelect: vi.fn(),
    onShow: vi.fn(),
  };
  const view = render(<Dependencies {...props} />);
  fireEvent.click(
    screen.getByRole('button', { name: 'Добавить последователя' }),
  );
  fireEvent.change(screen.getByRole('searchbox'), {
    target: { value: 'Работа 41' },
  });
  view.rerender(<Dependencies {...props} taskDirty />);
  expect(screen.getByRole('searchbox')).toHaveValue('Работа 41');
  expect(screen.getByRole('option')).toBeDisabled();
  expect(
    screen.getByRole('button', { name: 'Убрать последователя: Работа 42' }),
  ).toBeDisabled();
  fireEvent.keyDown(screen.getByRole('searchbox'), { key: 'Enter' });
  expect(onCommand).not.toHaveBeenCalled();
  view.rerender(<Dependencies {...props} />);
  fireEvent.click(
    screen.getByRole('button', { name: 'Убрать последователя: Работа 42' }),
  );
  expect(onCommand).toHaveBeenCalledExactlyOnceWith({
    type: 'dependency.delete',
    dependencyId: 'exact-outgoing-edge',
  });
  expect(onIncomingChange).not.toHaveBeenCalled();
  await act(async () => {
    await Promise.resolve();
  });
  expect(
    screen.getByRole('dialog', { name: 'Добавить последователя' }),
  ).toBeVisible();
  // Removal stays until an acknowledged snapshot removes it.
  expect(
    screen.getByRole('button', { name: 'Убрать последователя: Работа 42' }),
  ).toBeVisible();
});
it('changing selected task closes the old picker permanently, even when returning to the original task', () => {
  const a = task(40),
    b = task(41);
  const tree = {
    contractVersion: 2 as const,
    project,
    tasks: [a, b],
    dependencies: [],
    schedule: emptySchedule,
    canUndo: false,
  };
  const props = {
    tree,
    incomingIds: [],
    onIncomingChange: vi.fn(),
    taskDirty: false,
    scheduleDirty: false,
    disabled: false,
    onCommand: vi.fn(),
    onSelect: vi.fn(),
    onShow: vi.fn(),
  };
  const view = render(<Dependencies {...props} task={a} />);
  fireEvent.click(
    screen.getByRole('button', { name: 'Добавить предшественника' }),
  );
  view.rerender(<Dependencies {...props} task={b} />);
  expect(screen.queryByRole('dialog')).toBeNull();
  view.rerender(<Dependencies {...props} task={a} />);
  expect(screen.queryByRole('dialog')).toBeNull();
});
it('does not mark unchanged incoming when only dates are dirty', () => {
  const current = task(1);
  const view = render(
    <Dependencies
      task={current}
      tree={{
        contractVersion: 2,
        project,
        tasks: [current],
        dependencies: [],
        schedule: emptySchedule,
        canUndo: false,
      }}
      incomingIds={[]}
      onIncomingChange={vi.fn()}
      taskDirty
      scheduleDirty
      disabled={false}
      onCommand={vi.fn()}
      onSelect={vi.fn()}
      onShow={vi.fn()}
    />,
  );
  expect(
    view.container.querySelector('.dependency-section-header'),
  ).not.toHaveTextContent('Не сохранено');
});
