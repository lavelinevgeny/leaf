// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { cleanup, render, screen, fireEvent } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { calculateSchedule } from '../../src/domain/scheduling.js';
import { Gantt } from '../../src/client/Gantt.js';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { TaskViewControl } from '../../src/client/TaskViewControl.js';
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

it('C25 renders undated successor after a hidden predecessor without changing labels or enabling writes', () => {
  const tree = optionalTreeFixture();
  tree.dependencies = [
    {
      id: 'AC',
      projectId: tree.project.id,
      predecessorId: optionalIds.a,
      successorId: optionalIds.c,
    },
  ];
  tree.schedule = calculateSchedule({
    tasks: tree.tasks,
    dependencies: tree.dependencies,
    calendarType: 'weekdays',
  });
  const before = structuredClone(tree);
  const p = props(tree);
  render(
    <Gantt
      {...p}
      rows={p.rows.filter((row) => row.task.id === optionalIds.c)}
    />,
  );
  const bar = screen.getByRole('button', {
    name: /Работа C.*2026-10-07 – 2026-10-09.*Условное размещение/,
  });
  expect(bar).toBeVisible();
  expect(document.querySelector('.gantt-edge')).toBeNull();
  fireEvent.keyDown(bar, { key: 'ArrowRight' });
  fireEvent.keyDown(bar, { key: 'ArrowRight', shiftKey: true });
  expect(p.onPlan).not.toHaveBeenCalled();
  expect(tree).toEqual(before);
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
it.each(['successor', 'predecessor', 'both', 'start-only', 'finish-only'])(
  'renders a saved FS edge with a conditional %s without changing source dates or CPM',
  (kind) => {
    const tree = optionalTreeFixture();
    const a = tree.tasks[1]!,
      c = tree.tasks[2]!;
    if (kind === 'both') {
      a.inputStart = null;
      a.inputFinish = null;
      tree.schedule.tasks[a.id] = {
        startDate: null,
        finishDate: null,
        calendarSpanDays: null,
      };
      tree.schedule.display = {};
    }
    if (kind === 'start-only') c.inputStart = '2026-10-09';
    if (kind === 'finish-only') c.inputFinish = '2026-10-09';
    const predecessorId = kind === 'predecessor' ? c.id : a.id;
    const successorId = kind === 'predecessor' ? a.id : c.id;
    tree.dependencies = [
      {
        id: '33333333-3333-4333-8333-333333333333',
        projectId: tree.project.id,
        predecessorId,
        successorId,
      },
    ];
    const before = structuredClone(tree);
    const p = props(tree);
    const view = render(<Gantt {...p} />);
    const edge = view.container.querySelector('[data-gantt-edge]');
    expect(edge).toHaveClass('conditional');
    expect(edge).not.toHaveClass('critical', 'partial-critical');
    expect(edge?.querySelector('title')).toHaveTextContent(
      'Связь; условное размещение, полный интервал не задан',
    );
    const from = view.container.querySelector(
      `[data-gantt-bar="${predecessorId}"]`,
    )!;
    const to = view.container.querySelector(
      `[data-gantt-bar="${successorId}"]`,
    )!;
    const fromX =
      Number(from.getAttribute('x')) + Number(from.getAttribute('width'));
    const fromY = Number(from.getAttribute('y')) + 10;
    const toX = Number(to.getAttribute('x'));
    const toY = Number(to.getAttribute('y')) + 10;
    expect(edge?.getAttribute('d')).toMatch(
      new RegExp(`^M${fromX},${fromY} H`),
    );
    expect(edge?.getAttribute('d')).toMatch(new RegExp(`V${toY} H${toX}$`));
    expect(tree).toEqual(before);
    expect(p.onPlan).not.toHaveBeenCalled();
    view.rerender(
      <Gantt
        {...p}
        rows={p.rows.filter((row) => row.task.id !== successorId)}
      />,
    );
    expect(view.container.querySelector('[data-gantt-edge]')).toBeNull();
    view.rerender(<Gantt {...p} start="2027-01-01" />);
    expect(view.container.querySelector('[data-gantt-edge]')).toBeNull();
  },
);
it('shares collapsed rows, hides collapsed edges, and locks done and summary bars', () => {
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
  expect(view.container.querySelector('[data-gantt-edge]')).toHaveClass(
    'conditional',
  );
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
  expect(view.container.querySelector('[data-gantt-edge]')).toBeNull();
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
    viewControl: <TaskViewControl showGantt onChange={vi.fn()} />,
  };
  const view = render(<TaskTimeline {...p} />);
  expect(screen.queryByRole('button', { name: 'Помощь Ганта' })).toBeNull();
  expect(screen.queryByText(/Перенос — обе даты/)).toBeNull();
  expect(screen.getByRole('button', { name: 'Гант' })).toBeVisible();
  expect(screen.getByRole('combobox', { name: 'Масштаб Ганта' })).toBeVisible();
  view.rerender(<TaskTimeline {...p} show={false} />);
  expect(screen.getByRole('button', { name: 'Гант' })).toBeVisible();
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

it('switches two pressed-state view buttons with mouse and keyboard', async () => {
  const user = userEvent.setup();
  function Views() {
    const [show, setShow] = useState(true);
    return <TaskViewControl showGantt={show} onChange={setShow} />;
  }
  render(<Views />);
  expect(
    screen.getByRole('group', { name: 'Представление задач' }),
  ).toBeVisible();
  const gantt = screen.getByRole('button', { name: 'Гант' });
  const list = screen.getByRole('button', { name: 'Список' });
  expect(gantt).toHaveAttribute('aria-pressed', 'true');
  await user.click(list);
  expect(list).toHaveAttribute('aria-pressed', 'true');
  expect(gantt).toHaveAttribute('aria-pressed', 'false');
  await user.tab();
  expect(gantt).toHaveFocus();
  await user.keyboard('{Enter}');
  expect(gantt).toHaveAttribute('aria-pressed', 'true');
  await user.tab({ shift: true });
  await user.keyboard(' ');
  expect(list).toHaveAttribute('aria-pressed', 'true');
  await user.click(gantt);
  expect(gantt).toHaveAttribute('aria-pressed', 'true');
});

it('focuses List on a pointer click when the focused Gantt scale is removed', async () => {
  const user = userEvent.setup();
  const tree = optionalTreeFixture();
  function Views() {
    const [show, setShow] = useState(true);
    return (
      <TaskTimeline
        tree={tree}
        selectedId={null}
        collapsed={new Set<string>()}
        onToggle={vi.fn()}
        onSelect={vi.fn()}
        onAction={vi.fn()}
        onPlan={vi.fn()}
        disabled={false}
        show={show}
        reveal={null}
        viewControl={<TaskViewControl showGantt={show} onChange={setShow} />}
      />
    );
  }
  render(<Views />);
  const scale = screen.getByRole('combobox', { name: 'Масштаб Ганта' });
  const list = screen.getByRole('button', { name: 'Список' });
  scale.focus();
  expect(scale).toHaveFocus();
  await user.click(list);
  expect(list).toHaveFocus();
  expect(list).toHaveAttribute('aria-pressed', 'true');
  expect(scale).not.toBeInTheDocument();
});

it('preserves active editor focus and selection on pointer switching without changing keyboard focus', async () => {
  const user = userEvent.setup();
  const blur = vi.fn();
  function Views() {
    const [show, setShow] = useState(true);
    return (
      <>
        <input
          aria-label="Synthetic input"
          defaultValue="Synthetic draft"
          onBlur={blur}
        />
        <textarea
          aria-label="Synthetic description"
          defaultValue="Synthetic panel draft"
          onBlur={blur}
        />
        <TaskViewControl showGantt={show} onChange={setShow} />
        <button type="button">Other action</button>
      </>
    );
  }
  render(<Views />);
  const list = screen.getByRole('button', { name: 'Список' });
  const gantt = screen.getByRole('button', { name: 'Гант' });
  for (const name of ['Synthetic input', 'Synthetic description']) {
    const editor = screen.getByRole('textbox', { name }) as HTMLInputElement;
    await user.click(editor);
    editor.setSelectionRange(2, 7);
    blur.mockClear();
    for (const button of [list, gantt]) {
      await user.click(button);
      expect(editor).toHaveFocus();
      expect([editor.selectionStart, editor.selectionEnd]).toEqual([2, 7]);
      expect(button).toHaveAttribute('aria-pressed', 'true');
      expect(blur).not.toHaveBeenCalled();
    }
  }
  await user.tab();
  expect(list).toHaveFocus();
  await user.keyboard('{Enter}');
  expect(list).toHaveFocus();
  expect(list).toHaveAttribute('aria-pressed', 'true');
  await user.tab();
  await user.keyboard(' ');
  expect(gantt).toHaveFocus();
  expect(gantt).toHaveAttribute('aria-pressed', 'true');
  const other = screen.getByRole('button', { name: 'Other action' });
  await user.click(screen.getByRole('textbox', { name: 'Synthetic input' }));
  await user.click(other);
  expect(other).toHaveFocus();
});

it('discloses the project today on hover and focus and updates it across timezone and day changes', async () => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date('2026-10-08T23:30:00Z'));
  try {
    const user = userEvent.setup();
    const tree = optionalTreeFixture();
    tree.project.timezone = 'Asia/Tokyo';
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
    const today = screen.getByRole('button', { name: 'Сегодня' });
    expect(screen.queryByRole('tooltip')).toBeNull();
    await user.hover(today);
    expect(screen.getByRole('tooltip')).toHaveTextContent('09.10.2026');
    expect(today).toHaveAccessibleDescription('09.10.2026');
    await user.unhover(today);
    expect(screen.queryByRole('tooltip')).toBeNull();
    today.focus();
    fireEvent.focus(today);
    expect(screen.getByRole('tooltip')).toHaveTextContent('09.10.2026');
    const changed = {
      ...tree,
      project: { ...tree.project, timezone: 'America/Los_Angeles' },
    };
    view.rerender(<TaskTimeline {...p} tree={changed} />);
    expect(screen.getByRole('tooltip')).toHaveTextContent('08.10.2026');
    vi.setSystemTime(new Date('2026-10-09T23:30:00Z'));
    fireEvent(window, new Event('focus'));
    expect(screen.getByRole('tooltip')).toHaveTextContent('09.10.2026');
    expect(
      view.container.querySelector('.gantt-toolbar')?.textContent,
    ).not.toMatch(/\d{4}-\d{2}-\d{2}/);
    expect(p.onPlan).not.toHaveBeenCalled();
  } finally {
    vi.useRealTimers();
  }
});

it('uses sibling HTML chain controls for conditional leaves and Alt+L without starting move/resize or selection', async () => {
  const tree = optionalTreeFixture(),
    p = props(tree),
    onPredecessors = vi.fn();
  const view = render(<Gantt {...p} onPredecessors={onPredecessors} />);
  const trigger = screen.getByRole('button', {
      name: 'После окончания: Работа C',
    }),
    bar = screen.getByRole('button', { name: /Работа C, 2026/ });
  expect(trigger).toBeInstanceOf(HTMLButtonElement);
  expect(trigger.parentElement?.tagName).toBe('foreignObject');
  expect(trigger.parentElement?.closest('[role="button"]')).toBeNull();
  fireEvent.keyDown(bar, { key: 'l', altKey: true });
  expect(onPredecessors).toHaveBeenCalledExactlyOnceWith(
    tree.tasks[2],
    trigger,
  );
  fireEvent.pointerDown(trigger, { button: 0, clientX: 100 });
  fireEvent.pointerUp(trigger, { clientX: 140 });
  await userEvent.click(trigger);
  expect(p.onPlan).not.toHaveBeenCalled();
  expect(p.onSelect).not.toHaveBeenCalled();
  expect(onPredecessors).toHaveBeenCalledTimes(2);
  trigger.focus();
  expect(trigger).toHaveFocus();
  expect(
    screen.queryByRole('button', { name: 'После окончания: Этап P' }),
  ).not.toBeInTheDocument();
  view.rerender(<Gantt {...p} disabled onPredecessors={onPredecessors} />);
  expect(trigger).toBeDisabled();
});
