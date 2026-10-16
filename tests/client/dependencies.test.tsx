// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import {
  cleanup,
  render,
  screen,
  fireEvent,
  act,
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
      screen.getByText('Сначала сохраните изменения задачи'),
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
    expect(screen.getByText('Не сохранено')).toBeVisible();
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
  it('keeps the current card and remaining neighbors visible when the last page shrinks', () => {
    const neighbors = Array.from({ length: 5 }, (_, index) => task(index + 10));
    const dependencies = neighbors.map((item, index) => ({
      id: `33333333-3333-4333-8333-${String(index + 10).padStart(12, '0')}`,
      projectId: project.id,
      predecessorId: item.id,
      successorId: current.id,
    }));
    const props = {
      task: current,
      incomingIds: [],
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
  });
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
