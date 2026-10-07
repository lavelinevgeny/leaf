// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import {
  cleanup,
  render,
  screen,
  fireEvent,
  within,
} from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { Dependencies } from '../../src/client/Dependencies.js';
import { emptySchedule, project, task } from './fixtures.js';
afterEach(cleanup);
describe('direct dependency graph', () => {
  const a = task(1),
    b = task(2),
    current = task(3),
    d = task(4);
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
  ];
  const tree = {
    contractVersion: 2 as const,
    project,
    tasks: [a, b, current, d],
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
        disabled={false}
        onCommand={onCommand}
        onSelect={onSelect}
        onShow={onShow}
      />,
    );
    expect(
      view.container.querySelectorAll('[data-dependency-edge]'),
    ).toHaveLength(3);
    expect(screen.queryByText('Критическая связь')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /Открыть: Работа 1/ }));
    expect(onSelect).toHaveBeenCalledWith(a);
    fireEvent.click(
      screen.getByRole('button', { name: 'Удалить связь: Работа 1' }),
    );
    expect(onCommand).toHaveBeenCalledWith({
      type: 'dependency.delete',
      dependencyId: edges[0]!.id,
    });
    fireEvent.click(screen.getByRole('button', { name: 'Показать на Ганте' }));
    expect(onShow).toHaveBeenCalledWith(current);
  });
  it('offers only valid leaves and explains a cycle using titles', () => {
    const summary = task(5),
      child = task(6, { parentId: summary.id });
    render(
      <Dependencies
        task={current}
        tree={{ ...tree, tasks: [...tree.tasks, summary, child] }}
        disabled={false}
        onCommand={vi.fn()}
        onSelect={vi.fn()}
        onShow={vi.fn()}
      />,
    );
    fireEvent.change(screen.getByLabelText('Направление связи'), {
      target: { value: 'successor' },
    });
    const select = screen.getByLabelText('Работа для связи');
    expect(
      within(select).queryByRole('option', { name: 'Работа 5' }),
    ).not.toBeInTheDocument();
    expect(
      within(select).queryByRole('option', { name: 'Работа 1' }),
    ).not.toBeInTheDocument();
    fireEvent.change(screen.getByLabelText('Поиск работы для связи'), {
      target: { value: 'Работа 1' },
    });
    expect(
      screen.getByText(/Цикл зависимостей: Работа 3 → Работа 1 → Работа 3/),
    ).toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: 'Добавить зависимость' }),
    ).toBeDisabled();
  });
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
