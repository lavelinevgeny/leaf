// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { cleanup, render, screen, fireEvent } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { calculateSchedule } from '../../src/domain/scheduling.js';
import { Gantt } from '../../src/client/Gantt.js';
import { TaskTimeline } from '../../src/client/TaskTimeline.js';
import { treeRows } from '../../src/client/tree-view.js';
import { optionalTreeFixture, optionalIds } from './fixtures.js';
import type { ProjectTree } from '../../src/shared/contracts.js';
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});
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
it('cancels a pending pointer gesture when filtering changes the shared rows', () => {
  const tree = optionalTreeFixture();
  const p = props(tree);
  const view = render(<Gantt {...p} />);
  const work = screen.getByRole('button', { name: /Работа A, 2026/ });
  Object.defineProperty(work, 'setPointerCapture', { value: vi.fn() });
  function pointer(type: string, clientX: number) {
    const event = new MouseEvent(type, { bubbles: true, button: 0, clientX });
    Object.defineProperty(event, 'pointerId', { value: 7 });
    fireEvent(work, event);
  }
  pointer('pointerdown', 100);
  pointer('pointermove', 190);
  pointer('pointerup', 190);
  expect(p.onPlan).toHaveBeenCalledOnce();
  p.onPlan.mockClear();
  pointer('pointerdown', 100);
  pointer('pointermove', 190);
  view.rerender(
    <Gantt {...p} rows={treeRows(tree.tasks.slice(0, 2), new Set())} />,
  );
  pointer('pointerup', 190);
  expect(p.onPlan).not.toHaveBeenCalled();
});
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
    name: /Работа C.*Условное размещение; полный интервал не задан/,
  });
  expect(bar).toBeVisible();
  expect(screen.queryByText('2026-10-05 – 2026-10-07')).toBeNull();
  fireEvent.keyDown(bar, { key: 'ArrowRight' });
  expect(p.onPlan).not.toHaveBeenCalled();
  fireEvent.keyDown(bar, { key: 'Enter' });
  expect(p.onSelect).toHaveBeenCalledWith(tree.tasks[2]);
});
it('shows start-only with its source marker and a conditional bar', () => {
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
  ).toBeVisible();
});
it('prioritizes finish2 over group9 and never gestures on markers', () => {
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
  ).toBeVisible();
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
      name: /Работа C.*2026-10-02.*Условное размещение/,
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
it.each([
  ['start-only', '2030-01-02', null, 1],
  ['finish-only', null, '2030-01-02', 1],
  ['unavailable pair', '2030-01-02', '2030-01-03', 2],
] as const)(
  'initially locates and reveals a distant %s source without planning',
  (_, inputStart, inputFinish, count) => {
    const tree = optionalTreeFixture();
    vi.spyOn(window, 'requestAnimationFrame').mockReturnValue(0);
    const source = {
      ...tree.tasks[2]!,
      parentId: null,
      inputStart,
      inputFinish,
      durationDays: null,
    };
    tree.tasks = [source];
    if (tree.schedule.analysisStatus !== 'pending-policy')
      throw new Error('Expected frozen pending fixture');
    tree.schedule = {
      ...tree.schedule,
      coverage: { knownLeafCount: 0, totalLeafCount: 1 },
      tasks: {
        [source.id]: {
          startDate: null,
          finishDate: null,
          calendarSpanDays: null,
        },
      },
      summaries: {},
      display: {},
    };
    const before = JSON.stringify(tree);
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
    const view = render(<TaskTimeline {...p} />);
    expect(view.container.querySelectorAll('[data-gantt-marker]')).toHaveLength(
      count,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Следующий период' }));
    expect(view.container.querySelectorAll('[data-gantt-marker]')).toHaveLength(
      0,
    );
    view.rerender(
      <TaskTimeline {...p} reveal={{ taskId: source.id, sequence: 1 }} />,
    );
    expect(view.container.querySelectorAll('[data-gantt-marker]')).toHaveLength(
      count,
    );
    const marker = screen.getAllByRole('button', {
      name: /Работа C, Исходное/,
    })[0]!;
    fireEvent.keyDown(marker, { key: 'ArrowRight', shiftKey: true });
    expect(p.onPlan).not.toHaveBeenCalled();
    if (count === 2)
      expect(view.container.querySelector('[data-gantt-bar]')).toBeNull();
    else expect(view.container.querySelector('[data-gantt-bar]')).toBeVisible();
    expect(JSON.stringify(tree)).toBe(before);
  },
);
it('projects the literal overflow example without changing its source duration', () => {
  const tree = optionalTreeFixture();
  tree.tasks[1]!.inputStart = '9999-12-31';
  tree.tasks[1]!.inputFinish = null;
  tree.tasks[2]!.durationDays = 2;
  const before = JSON.stringify(tree.tasks);
  const result = calculateSchedule({
    tasks: tree.tasks,
    dependencies: [],
    calendarType: 'all-days',
  });
  expect(result.display[optionalIds.c]).toEqual({
    kind: 'conditional',
    startDate: '9999-12-31',
    finishDate: '9999-12-31',
    clipped: true,
  });
  expect(JSON.stringify(tree.tasks)).toBe(before);
});
it('explains a clipped conditional display in its title and accessible label', () => {
  const tree = optionalTreeFixture();
  tree.project.calendarType = 'all-days';
  tree.tasks[1]!.inputStart = '9999-12-31';
  tree.tasks[1]!.inputFinish = null;
  tree.tasks[2]!.durationDays = 2;
  tree.schedule.display[optionalIds.c] = {
    kind: 'conditional',
    startDate: '9999-12-31',
    finishDate: '9999-12-31',
    clipped: true,
  };
  const before = JSON.stringify(tree);
  render(<Gantt {...props(tree)} start="9999-12-28" />);
  const bar = screen.getByRole('button', {
    name: /Работа C.*9999-12-31.*Отображение ограничено предельной датой/,
  });
  expect(bar.querySelector('title')).toHaveTextContent(
    'Отображение ограничено предельной датой',
  );
  expect(JSON.stringify(tree)).toBe(before);
});

it('keeps the view control available without Gantt help or planning writes', () => {
  const tree = optionalTreeFixture(),
    before = structuredClone(tree);
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
    viewControl: (
      <label>
        <input type="checkbox" defaultChecked />
        Гант
      </label>
    ),
  };
  const view = render(<TaskTimeline {...p} />);
  expect(screen.queryByRole('button', { name: 'Помощь Ганта' })).toBeNull();
  expect(screen.queryByText(/Перенос — обе даты/)).toBeNull();
  expect(screen.getByRole('checkbox', { name: 'Гант' })).toBeVisible();
  expect(screen.getByRole('combobox', { name: 'Масштаб Ганта' })).toBeVisible();
  view.rerender(<TaskTimeline {...p} show={false} />);
  expect(screen.getByRole('checkbox', { name: 'Гант' })).toBeVisible();
  expect(screen.queryByRole('combobox', { name: 'Масштаб Ганта' })).toBeNull();
  expect(screen.queryByRole('button', { name: 'Сегодня' })).toBeNull();
  expect(
    screen.queryByRole('button', { name: 'Предыдущий период' }),
  ).toBeNull();
  expect(screen.queryByRole('button', { name: 'Следующий период' })).toBeNull();
  view.rerender(<TaskTimeline {...p} />);
  expect(screen.getByRole('combobox', { name: 'Масштаб Ганта' })).toBeVisible();
  expect(tree).toEqual(before);
  expect(p.onPlan).not.toHaveBeenCalled();
});
