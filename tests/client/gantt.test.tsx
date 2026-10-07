// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { cleanup, render, screen, fireEvent } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { TaskTimeline } from '../../src/client/TaskTimeline.js';
import { computed, emptySchedule, project, task } from './fixtures.js';
afterEach(cleanup);
describe('common tree and Gantt rows', () => {
  it('renders computed bars, summary shape, note markers and leaves undated rows empty', () => {
    const summary = task(1),
      work = task(2, {
        parentId: summary.id,
        planMode: 'auto',
        durationDays: 2,
      }),
      note = task(3, { inputStart: '2026-10-10' }),
      undated = task(4);
    const tree = {
      project,
      tasks: [summary, work, note, undated],
      dependencies: [],
      canUndo: false,
      schedule: {
        ...emptySchedule,
        tasks: { [work.id]: computed() },
        summaries: {
          [summary.id]: {
            start: 4,
            finish: 6,
            startDate: '2026-10-09',
            finishDate: '2026-10-12',
            partial: true,
            containsCritical: true,
          },
        },
        criticalTaskIds: [work.id],
      },
    };
    const props = {
      tree,
      selectedId: null,
      collapsed: new Set<string>(),
      onToggle: vi.fn(),
      onSelect: vi.fn(),
      onAction: vi.fn(),
      onPlan: vi.fn(),
      disabled: false,
      show: true,
      reveal: null,
    };
    const view = render(<TaskTimeline {...props} />);
    expect(view.container.querySelectorAll('[data-gantt-bar]')).toHaveLength(2);
    expect(view.container.querySelectorAll('[data-gantt-note]')).toHaveLength(
      1,
    );
    expect(
      view.container.querySelector(
        `[data-gantt-row="${undated.id}"] [data-gantt-bar]`,
      ),
    ).toBeNull();
    expect(
      screen.getByRole('treeitem', { name: /Работа 2/ }),
    ).toHaveTextContent('9–12 окт.');
    view.rerender(
      <TaskTimeline {...props} collapsed={new Set([summary.id])} />,
    );
    expect(view.container.querySelectorAll('[data-gantt-row]')).toHaveLength(3);
    expect(
      screen.queryByRole('treeitem', { name: /Работа 2/ }),
    ).not.toBeInTheDocument();
    expect(view.container.querySelectorAll('[data-gantt-bar]')).toHaveLength(1);
  });
  it('keyboard move/resize emit one explicit intent and done work stays locked', () => {
    const a = task(1, { planMode: 'auto', durationDays: 2 });
    const onPlan = vi.fn();
    const tree = {
      project,
      tasks: [a],
      dependencies: [],
      canUndo: false,
      schedule: { ...emptySchedule, tasks: { [a.id]: computed() } },
    };
    const props = {
      tree,
      selectedId: null,
      collapsed: new Set<string>(),
      onToggle: vi.fn(),
      onSelect: vi.fn(),
      onAction: vi.fn(),
      onPlan,
      disabled: false,
      show: true,
      reveal: null,
    };
    const view = render(<TaskTimeline {...props} />);
    const bar = screen.getByRole('button', { name: /Работа 1.*Перенести/ });
    fireEvent.keyDown(bar, { key: 'ArrowRight' });
    expect(onPlan).toHaveBeenCalledWith(a, 'move', '2026-10-12');
    fireEvent.keyDown(bar, { key: 'ArrowRight', shiftKey: true });
    expect(onPlan).toHaveBeenLastCalledWith(a, 'resize', '2026-10-13');
    view.rerender(
      <TaskTimeline
        {...props}
        tree={{ ...tree, tasks: [{ ...a, status: 'done' }] }}
      />,
    );
    fireEvent.keyDown(
      screen.getByRole('button', { name: /Работа 1.*Открыть/ }),
      { key: 'ArrowRight' },
    );
    expect(onPlan).toHaveBeenCalledTimes(2);
  });
});
