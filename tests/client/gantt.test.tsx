// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { cleanup, render, screen, fireEvent } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { Gantt } from '../../src/client/Gantt.js';
import { TaskTimeline } from '../../src/client/TaskTimeline.js';
import { treeRows } from '../../src/client/tree-view.js';
import { optionalTreeFixture, optionalIds } from './fixtures.js';
import type { ProjectTree } from '../../src/shared/contracts.js';
afterEach(cleanup);
function props(tree: ProjectTree) {
  return {
    tree,
    rows: treeRows(tree.tasks, new Set<string>()),
    start: '2026-10-01',
    scale: 'days' as const,
    today: '2026-10-07',
    selectedId: null,
    disabled: false,
    onSelect: vi.fn(),
    onPlan: vi.fn(),
  };
}
it('renders a conditional bar without promoting it to task dates or accepting a gesture', () => {
  const tree = optionalTreeFixture();
  const p = {
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
  render(<TaskTimeline {...p} />);
  const bar = screen.getByRole('button', {
    name: /Работа C.*Условное размещение; начало не задано/,
  });
  expect(bar).toBeVisible();
  expect(screen.queryByText('2026-10-05 – 2026-10-07')).toBeNull();
  fireEvent.keyDown(bar, { key: 'ArrowRight' });
  expect(p.onPlan).not.toHaveBeenCalled();
  fireEvent.keyDown(bar, { key: 'Enter' });
  expect(p.onSelect).toHaveBeenCalledWith(tree.tasks[2]);
});
it('shows start-only as a source marker without a bar', () => {
  const tree = optionalTreeFixture();
  tree.tasks[2]!.inputStart = '2026-10-09';
  tree.schedule.display = {};
  const { container } = render(<Gantt {...props(tree)} />);
  expect(
    screen.getByRole('button', {
      name: 'Работа C, Исходное начало: 2026-10-09',
    }),
  ).toBeVisible();
  expect(
    container.querySelector(`[data-gantt-bar="${optionalIds.c}"]`),
  ).toBeNull();
});
it('keeps finish2 separate from conditional9 and never gestures on markers', () => {
  const tree = optionalTreeFixture();
  tree.tasks[2]!.inputFinish = '2026-10-02';
  tree.tasks[2]!.durationDays = null;
  tree.schedule.display = {};
  const p = props(tree);
  const view = render(<Gantt {...p} />);
  const marker = screen.getByRole('button', {
    name: 'Работа C, Исходное окончание: 2026-10-02',
  });
  expect(marker).toBeVisible();
  expect(
    view.container.querySelector(`[data-gantt-bar="${optionalIds.c}"]`),
  ).toBeNull();
  tree.schedule.display[optionalIds.c] = {
    kind: 'conditional',
    startDate: '2026-10-09',
    finishDate: '2026-10-09',
    clipped: false,
  };
  view.rerender(<Gantt {...p} />);
  expect(marker).toBeVisible();
  expect(
    screen.getByRole('button', {
      name: /Работа C.*2026-10-09.*Условное размещение/,
    }),
  ).toBeVisible();
  fireEvent.keyDown(marker, { key: 'ArrowRight' });
  expect(p.onPlan).not.toHaveBeenCalled();
  fireEvent.keyDown(marker, { key: ' ' });
  expect(p.onSelect).toHaveBeenCalled();
  expect(tree.tasks[2]!.inputFinish).toBe('2026-10-02');
});
it('shares collapsed rows, hides unknown arrows, and locks done and summary bars', () => {
  const tree = optionalTreeFixture();
  tree.dependencies = [
    {
      id: '33333333-3333-4333-8333-333333333333',
      projectId: tree.project.id,
      predecessorId: optionalIds.a,
      successorId: optionalIds.c,
    },
  ];
  const p = props(tree);
  const view = render(<Gantt {...p} />);
  expect(view.container.querySelectorAll('[data-gantt-row]')).toHaveLength(3);
  expect(view.container.querySelector('[data-gantt-edge]')).toBeNull();
  const work = screen.getByRole('button', { name: /Работа A, 2026/ });
  fireEvent.keyDown(work, { key: 'ArrowRight' });
  expect(p.onPlan).toHaveBeenCalledWith(tree.tasks[1], 'move', '2026-10-06');
  tree.tasks[1]!.status = 'done';
  view.rerender(<Gantt {...p} />);
  p.onPlan.mockClear();
  fireEvent.keyDown(work, { key: 'ArrowRight' });
  expect(p.onPlan).not.toHaveBeenCalled();
  view.rerender(
    <Gantt {...p} rows={treeRows(tree.tasks, new Set([optionalIds.p]))} />,
  );
  expect(view.container.querySelectorAll('[data-gantt-row]')).toHaveLength(1);
});
