// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { ScheduleStatus } from '../../src/client/ScheduleStatus.js';
import { Dependencies } from '../../src/client/Dependencies.js';
import { projectTreeV2Schema } from '../../src/shared/contracts.js';
import { TaskTree } from '../../src/client/TaskTree.js';
import { Gantt } from '../../src/client/Gantt.js';
import { treeRows } from '../../src/client/tree-view.js';
afterEach(cleanup);
const A = '22222222-2222-4222-8222-222222222222';
const U = '22222222-2222-4222-8222-222222222223';
const projectId = '11111111-1111-4111-8111-111111111111';
const timestamp = '2026-10-07T00:00:00.000Z';
const project = {
  id: projectId,
  title: 'Демо-проект',
  revision: 5,
  calendarType: 'all-days',
  timezone: 'UTC',
  createdAt: timestamp,
  updatedAt: timestamp,
};
const task = (
  id: string,
  title: string,
  inputStart: string | null,
  inputFinish: string | null,
) => ({
  id,
  projectId,
  parentId: null,
  title,
  description: '',
  sortOrder: id === A ? 0 : 1,
  status: 'todo',
  inputStart,
  inputFinish,
  durationDays: null,
  createdAt: timestamp,
  updatedAt: timestamp,
});
const partialTree = () =>
  projectTreeV2Schema.parse({
    contractVersion: 2,
    project,
    canUndo: true,
    tasks: [
      task(A, 'Работа A', '2026-10-05', '2026-10-06'),
      task(U, 'Работа U', null, null),
    ],
    dependencies: [],
    schedule: {
      analysisStatus: 'incomplete',
      feasibility: 'incomplete',
      coverage: { knownLeafCount: 1, totalLeafCount: 2 },
      tasks: {
        [A]: {
          startDate: '2026-10-05',
          finishDate: '2026-10-06',
          calendarSpanDays: 2,
          projectFloat: null,
          constraintFloat: null,
        },
        [U]: {
          startDate: null,
          finishDate: null,
          calendarSpanDays: null,
          projectFloat: null,
          constraintFloat: null,
        },
      },
      summaries: {},
      display: {},
      horizonFinishDate: null,
      criticalTaskIds: [],
      criticalDependencyIds: [],
      diagnostics: [
        {
          code: 'UNKNOWN_INTERVAL',
          taskIds: [U],
          dependencyIds: [],
          messageKey: 'scheduling.UNKNOWN_INTERVAL',
        },
      ],
      partialAnalysis: {
        labelKey: 'scheduling.PARTIAL_ANALYSIS',
        knownHorizonFinishDate: '2026-10-06',
        coverage: { analyzedLeafCount: 1, blockedLeafCount: 1 },
        tasks: { [A]: { knownHorizonFloat: 0 } },
        partialCriticalTaskIds: [A],
        partialCriticalDependencyIds: [],
        partialCriticalSummaryIds: [],
      },
    },
  });
it('labels partial criticality and never substitutes ordinary/global floats', () => {
  const tree = partialTree();
  render(<ScheduleStatus tree={tree} task={tree.tasks[0]!} />);
  expect(
    screen.getByText(
      'Анализ датированной части; полный критический путь неизвестен',
    ),
  ).toBeVisible();
  expect(screen.getByText(/Резерв до известного горизонта: 0/)).toBeVisible();
  expect(
    screen.queryByText(/^Критична для окончания проекта$/),
  ).not.toBeInTheDocument();
  expect(screen.queryByText(/^Резерв проекта:/)).not.toBeInTheDocument();
});
it('conflict removes all partial labels and highlights', () => {
  const tree = partialTree();
  tree.schedule = projectTreeV2Schema.parse({
    ...tree,
    schedule: {
      ...tree.schedule,
      analysisStatus: 'infeasible',
      feasibility: 'infeasible',
      partialAnalysis: null,
      diagnostics: [
        {
          code: 'EXPLICIT_PRECEDENCE_CONFLICT',
          taskIds: [A, U],
          dependencyIds: [],
          messageKey: 'scheduling.EXPLICIT_PRECEDENCE_CONFLICT',
        },
      ],
    },
  }).schedule;
  render(<ScheduleStatus tree={tree} task={tree.tasks[0]!} />);
  expect(
    screen.queryByText(/Анализ датированной части/),
  ).not.toBeInTheDocument();
  expect(
    screen.queryByText(/Резерв до известного горизонта/),
  ).not.toBeInTheDocument();
});

const B = '22222222-2222-4222-8222-222222222224';
const C = '22222222-2222-4222-8222-222222222225';
const AB = '33333333-3333-4333-8333-000000000001';
const BC = '33333333-3333-4333-8333-000000000002';
const AC = '33333333-3333-4333-8333-000000000003';
const partialEdgeTree = () =>
  projectTreeV2Schema.parse({
    contractVersion: 2,
    project,
    canUndo: true,
    tasks: [
      { ...task(A, 'Работа A', '2026-10-05', '2026-10-06'), sortOrder: 0 },
      { ...task(B, 'Работа B', '2026-10-07', '2026-10-09'), sortOrder: 1 },
      { ...task(C, 'Работа C', '2026-10-10', '2026-10-11'), sortOrder: 2 },
      { ...task(U, 'Работа U', null, null), sortOrder: 3 },
    ],
    dependencies: [
      { id: AB, projectId, predecessorId: A, successorId: B },
      { id: BC, projectId, predecessorId: B, successorId: C },
      { id: AC, projectId, predecessorId: A, successorId: C },
    ],
    schedule: {
      analysisStatus: 'incomplete',
      feasibility: 'incomplete',
      coverage: { knownLeafCount: 3, totalLeafCount: 4 },
      tasks: {
        [A]: {
          startDate: '2026-10-05',
          finishDate: '2026-10-06',
          calendarSpanDays: 2,
          projectFloat: null,
          constraintFloat: null,
        },
        [B]: {
          startDate: '2026-10-07',
          finishDate: '2026-10-09',
          calendarSpanDays: 3,
          projectFloat: null,
          constraintFloat: null,
        },
        [C]: {
          startDate: '2026-10-10',
          finishDate: '2026-10-11',
          calendarSpanDays: 2,
          projectFloat: null,
          constraintFloat: null,
        },
        [U]: {
          startDate: null,
          finishDate: null,
          calendarSpanDays: null,
          projectFloat: null,
          constraintFloat: null,
        },
      },
      summaries: {},
      display: {},
      horizonFinishDate: null,
      criticalTaskIds: [],
      criticalDependencyIds: [],
      diagnostics: [
        {
          code: 'UNKNOWN_INTERVAL',
          taskIds: [U],
          dependencyIds: [],
          messageKey: 'scheduling.UNKNOWN_INTERVAL',
        },
      ],
      partialAnalysis: {
        labelKey: 'scheduling.PARTIAL_ANALYSIS',
        knownHorizonFinishDate: '2026-10-11',
        coverage: { analyzedLeafCount: 3, blockedLeafCount: 1 },
        tasks: {
          [A]: { knownHorizonFloat: 0 },
          [B]: { knownHorizonFloat: 0 },
          [C]: { knownHorizonFloat: 0 },
        },
        partialCriticalTaskIds: [A, B, C],
        partialCriticalDependencyIds: [AB, BC],
        partialCriticalSummaryIds: [],
      },
    },
  });
it('renders positive partial edges with a partial label and no global edge style', () => {
  const tree = partialEdgeTree();
  expect(tree.schedule.criticalTaskIds).toEqual([]);
  expect(tree.schedule.criticalDependencyIds).toEqual([]);
  if (tree.schedule.analysisStatus !== 'incomplete')
    throw new Error('Expected incomplete');
  expect(tree.schedule.partialAnalysis?.partialCriticalDependencyIds).toEqual([
    AB,
    BC,
  ]);
  const props = {
    tree,
    disabled: false,
    onCommand: vi.fn().mockResolvedValue(true),
    onSelect: vi.fn(),
    onShow: vi.fn(),
  };
  const first = render(
    <Dependencies {...props} task={tree.tasks.find((t) => t.id === B)!} />,
  );
  for (const id of [AB, BC]) {
    const path = first.container.querySelector(
      '[data-dependency-edge="' + id + '"]',
    )!;
    expect(path).toHaveClass('partial-critical');
    expect(path).not.toHaveClass('critical');
    expect(path.querySelector('title')).toHaveTextContent(
      'Критическая связь датированной части',
    );
  }
  expect(
    screen.getAllByText('Критическая связь датированной части', {
      exact: true,
    }),
  ).toHaveLength(2);
  expect(
    screen.queryByText('Критическая связь', { exact: true }),
  ).not.toBeInTheDocument();
  first.unmount();
  const second = render(
    <Dependencies {...props} task={tree.tasks.find((t) => t.id === A)!} />,
  );
  const ac = second.container.querySelector(
    '[data-dependency-edge="' + AC + '"]',
  )!;
  expect(ac).not.toHaveClass('partial-critical');
  expect(ac).not.toHaveClass('critical');
  expect(ac.querySelector('title')).not.toHaveTextContent(
    'Критическая связь датированной части',
  );
});

const readyN06Tree = (doneB = false) =>
  projectTreeV2Schema.parse({
    ...partialEdgeTree(),
    tasks: [
      task(A, 'Работа A', '2026-10-05', '2026-10-06'),
      {
        ...task(B, 'Работа B', '2026-10-10', '2026-10-10'),
        status: doneB ? 'done' : 'todo',
      },
      task(C, 'Работа C', '2026-10-05', '2026-10-14'),
    ],
    dependencies: [{ id: AB, projectId, predecessorId: A, successorId: B }],
    schedule: {
      analysisStatus: 'ready',
      feasibility: 'feasible',
      coverage: { knownLeafCount: 3, totalLeafCount: 3 },
      tasks: {
        [A]: {
          startDate: '2026-10-05',
          finishDate: '2026-10-06',
          calendarSpanDays: 2,
          projectFloat: 7,
          constraintFloat: 3,
        },
        [B]: {
          startDate: '2026-10-10',
          finishDate: '2026-10-10',
          calendarSpanDays: 1,
          projectFloat: 4,
          constraintFloat: doneB ? 0 : 4,
        },
        [C]: {
          startDate: '2026-10-05',
          finishDate: '2026-10-14',
          calendarSpanDays: 10,
          projectFloat: 0,
          constraintFloat: 0,
        },
      },
      summaries: {},
      display: {},
      horizonFinishDate: '2026-10-14',
      partialAnalysis: null,
      criticalTaskIds: [C],
      criticalDependencyIds: [],
      diagnostics: [],
    },
  });
it('renders N06 project/local floats separately and does not promote done to critical', () => {
  const tree = readyN06Tree();
  render(<ScheduleStatus tree={tree} task={tree.tasks[0]!} />);
  expect(screen.getByText(/Резерв проекта: 7/)).toBeVisible();
  expect(screen.getByText(/Резерв текущего размещения: 3/)).toBeVisible();
  expect(
    screen.queryByText('Критична для окончания проекта', { exact: true }),
  ).not.toBeInTheDocument();
  cleanup();
  const done = readyN06Tree(true);
  render(<ScheduleStatus tree={done} task={done.tasks[1]!} />);
  expect(screen.getByText(/Резерв проекта: 4/)).toBeVisible();
  expect(screen.getByText(/Резерв текущего размещения: 0/)).toBeVisible();
  expect(
    screen.queryByText('Критична для окончания проекта', { exact: true }),
  ).not.toBeInTheDocument();
  cleanup();
  render(<ScheduleStatus tree={tree} task={tree.tasks[2]!} />);
  expect(
    screen.getByText('Критична для окончания проекта', { exact: true }),
  ).toBeVisible();
});
it('ready F03 keeps AC noncritical while tight AB and BC are global critical edges', () => {
  const base = partialEdgeTree();
  const tree = projectTreeV2Schema.parse({
    ...base,
    tasks: base.tasks.filter((t) => t.id !== U),
    schedule: {
      analysisStatus: 'ready',
      feasibility: 'feasible',
      coverage: { knownLeafCount: 3, totalLeafCount: 3 },
      tasks: {
        [A]: {
          startDate: '2026-10-05',
          finishDate: '2026-10-06',
          calendarSpanDays: 2,
          projectFloat: 0,
          constraintFloat: 0,
        },
        [B]: {
          startDate: '2026-10-07',
          finishDate: '2026-10-09',
          calendarSpanDays: 3,
          projectFloat: 0,
          constraintFloat: 0,
        },
        [C]: {
          startDate: '2026-10-10',
          finishDate: '2026-10-11',
          calendarSpanDays: 2,
          projectFloat: 0,
          constraintFloat: 0,
        },
      },
      summaries: {},
      display: {},
      horizonFinishDate: '2026-10-11',
      partialAnalysis: null,
      criticalTaskIds: [A, B, C],
      criticalDependencyIds: [AB, BC],
      diagnostics: [],
    },
  });
  const props = {
    tree,
    disabled: false,
    onCommand: vi.fn().mockResolvedValue(true),
    onSelect: vi.fn(),
    onShow: vi.fn(),
  };
  const bView = render(
    <Dependencies {...props} task={tree.tasks.find((t) => t.id === B)!} />,
  );
  for (const id of [AB, BC])
    expect(
      bView.container.querySelector('[data-dependency-edge="' + id + '"]'),
    ).toHaveClass('critical');
  bView.unmount();
  const aView = render(
    <Dependencies {...props} task={tree.tasks.find((t) => t.id === A)!} />,
  );
  expect(
    aView.container.querySelector('[data-dependency-edge="' + AC + '"]'),
  ).not.toHaveClass('critical');
  expect(
    screen.queryByText('Критическая связь датированной части', { exact: true }),
  ).not.toBeInTheDocument();
});
it('partial summary has a partial descendant label and frozen pending keeps its own copy', () => {
  const P = '22222222-2222-4222-8222-222222222226',
    base = partialEdgeTree();
  if (base.schedule.analysisStatus !== 'incomplete')
    throw new Error('Expected incomplete');
  const tree = projectTreeV2Schema.parse({
    ...base,
    tasks: [
      task(P, 'Этап P', null, null),
      ...base.tasks.map((t) => ({ ...t, parentId: P })),
    ],
    schedule: {
      ...base.schedule,
      summaries: {
        [P]: {
          startDate: null,
          finishDate: null,
          calendarSpanDays: null,
          knownLeafCount: 3,
          totalLeafCount: 4,
          containsCritical: null,
        },
      },
      partialAnalysis: {
        ...base.schedule.partialAnalysis,
        partialCriticalSummaryIds: [P],
      },
    },
  });
  render(<ScheduleStatus tree={tree} task={tree.tasks[0]!} />);
  expect(
    screen.getByText(
      'Анализ датированной части; полный критический путь неизвестен',
    ),
  ).toBeVisible();
  expect(
    screen.getByText('Содержит критические задачи датированной части', {
      exact: true,
    }),
  ).toBeVisible();
  expect(
    screen.queryByText('Содержит критические задачи', { exact: true }),
  ).not.toBeInTheDocument();
  cleanup();
  const frozen = projectTreeV2Schema.parse({
    ...partialTree(),
    schedule: {
      analysisStatus: 'pending-policy',
      feasibility: 'feasible',
      coverage: { knownLeafCount: 1, totalLeafCount: 2 },
      tasks: {
        [A]: {
          startDate: '2026-10-05',
          finishDate: '2026-10-06',
          calendarSpanDays: 2,
        },
        [U]: { startDate: null, finishDate: null, calendarSpanDays: null },
      },
      summaries: {},
      display: {},
      criticalTaskIds: [],
      criticalDependencyIds: [],
      diagnostics: [],
    },
  });
  render(<ScheduleStatus tree={frozen} />);
  expect(
    screen.getByText('Сохранённый результат без расчёта критического пути'),
  ).toBeVisible();
  expect(
    screen.queryByText(/Анализ датированной части/),
  ).not.toBeInTheDocument();
  expect(screen.queryByText(/Резерв проекта:/)).not.toBeInTheDocument();
});

it('filtered rows and scale do not change the literal authoritative schedule or bypass edges', () => {
  const tree = partialEdgeTree(),
    before = structuredClone(tree);
  const rows = treeRows(tree.tasks, new Set<string>()).filter(
    (row) => row.task.id === A || row.task.id === C,
  );
  const props = {
    tree,
    rows,
    start: '2026-10-05',
    today: '2026-10-07',
    selectedId: null,
    disabled: false,
    onSelect: vi.fn(),
    onPlan: vi.fn(),
  };
  const view = render(<Gantt {...props} scale="days" />);
  expect(
    view.container.querySelector('[data-gantt-row="' + B + '"]'),
  ).toBeNull();
  expect(view.container.querySelectorAll('[data-gantt-edge]')).toHaveLength(1);
  expect(
    view.container.querySelector('[data-gantt-edge="' + AC + '"]'),
  ).not.toHaveClass('critical');
  for (const scale of ['weeks', 'months', 'days'] as const) {
    view.rerender(<Gantt {...props} scale={scale} />);
    expect(tree).toEqual(before);
    expect(view.container.querySelectorAll('[data-gantt-edge]')).toHaveLength(
      1,
    );
    expect(
      view.container.querySelector('[data-gantt-edge="' + AC + '"]'),
    ).not.toHaveClass('critical');
  }
  expect(props.onPlan).not.toHaveBeenCalled();
});

const c17PublicTree = () =>
  projectTreeV2Schema.parse({
    contractVersion: 2,
    project,
    canUndo: true,
    tasks: [
      task('22222222-2222-4222-8222-222222222227', 'Этап C17', null, null),
      {
        ...task(A, 'Работа A', '2026-10-05', '2026-10-07'),
        durationDays: 3,
        status: 'done',
        parentId: '22222222-2222-4222-8222-222222222227',
      },
      {
        ...task(B, 'Работа B', '2026-10-09', '2026-10-10'),
        parentId: '22222222-2222-4222-8222-222222222227',
      },
      task(C, 'Работа C', '2026-10-05', '2026-10-08'),
      {
        ...task(U, 'Работа U', null, null),
        durationDays: 3,
        parentId: '22222222-2222-4222-8222-222222222227',
      },
    ],
    dependencies: [{ id: AB, projectId, predecessorId: A, successorId: B }],
    schedule: {
      analysisStatus: 'incomplete',
      feasibility: 'incomplete',
      coverage: { knownLeafCount: 2, totalLeafCount: 4 },
      tasks: {
        [A]: {
          startDate: null,
          finishDate: null,
          calendarSpanDays: null,
          projectFloat: null,
          constraintFloat: null,
        },
        [B]: {
          startDate: '2026-10-09',
          finishDate: '2026-10-10',
          calendarSpanDays: 2,
          projectFloat: null,
          constraintFloat: null,
        },
        [C]: {
          startDate: '2026-10-05',
          finishDate: '2026-10-08',
          calendarSpanDays: 4,
          projectFloat: null,
          constraintFloat: null,
        },
        [U]: {
          startDate: null,
          finishDate: null,
          calendarSpanDays: null,
          projectFloat: null,
          constraintFloat: null,
        },
      },
      summaries: {
        ['22222222-2222-4222-8222-222222222227']: {
          startDate: null,
          finishDate: null,
          calendarSpanDays: null,
          knownLeafCount: 1,
          totalLeafCount: 3,
          containsCritical: null,
        },
      },
      display: {
        [U]: {
          kind: 'conditional',
          startDate: '2026-10-05',
          finishDate: '2026-10-07',
          clipped: false,
        },
      },
      horizonFinishDate: null,
      criticalTaskIds: [],
      criticalDependencyIds: [],
      diagnostics: [
        {
          code: 'LEGACY_INTERVAL_UNAVAILABLE',
          taskIds: [A],
          dependencyIds: [],
          messageKey: 'scheduling.LEGACY_INTERVAL_UNAVAILABLE',
        },
        {
          code: 'UNKNOWN_INTERVAL',
          taskIds: [U],
          dependencyIds: [],
          messageKey: 'scheduling.UNKNOWN_INTERVAL',
        },
      ],
      partialAnalysis: {
        labelKey: 'scheduling.PARTIAL_ANALYSIS',
        knownHorizonFinishDate: '2026-10-10',
        coverage: { analyzedLeafCount: 1, blockedLeafCount: 3 },
        tasks: { [C]: { knownHorizonFloat: 2 } },
        partialCriticalTaskIds: [],
        partialCriticalDependencyIds: [],
        partialCriticalSummaryIds: [],
      },
    },
  });
it('C17 valid source remains visible as notes while real bar and ordinary criticality stay absent', () => {
  const tree = c17PublicTree(),
    before = structuredClone(tree);
  render(
    <ScheduleStatus tree={tree} task={tree.tasks.find((t) => t.id === A)!} />,
  );
  expect(
    screen.getByText('Прежний интервал недоступен; полный расчёт неизвестен.'),
  ).toBeVisible();
  expect(screen.queryByText(/^Резерв проекта:/)).not.toBeInTheDocument();
  expect(
    screen.queryByText('Критична для окончания проекта', { exact: true }),
  ).not.toBeInTheDocument();
  cleanup();
  const gantt = render(
    <Gantt
      tree={tree}
      rows={treeRows(tree.tasks, new Set())}
      start="2026-10-05"
      today="2026-10-07"
      scale="days"
      selectedId={null}
      disabled={false}
      onSelect={vi.fn()}
      onPlan={vi.fn()}
    />,
  );
  expect(
    gantt.container.querySelector('[data-gantt-bar="' + A + '"]'),
  ).toBeNull();
  expect(
    screen.getByRole('button', {
      name: 'Работа A, Исходное начало: 2026-10-05',
    }),
  ).toBeVisible();
  expect(
    screen.getByRole('button', {
      name: 'Работа A, Исходное окончание: 2026-10-07',
    }),
  ).toBeVisible();
  expect(
    screen.getByRole('button', {
      name: /Работа U.*Условное размещение; начало не задано/,
    }),
  ).toBeVisible();
  gantt.unmount();
  const graph = render(
    <Dependencies
      tree={tree}
      task={tree.tasks.find((t) => t.id === B)!}
      disabled={false}
      onCommand={vi.fn().mockResolvedValue(true)}
      onSelect={vi.fn()}
      onShow={vi.fn()}
    />,
  );
  expect(
    graph.container.querySelector('[data-dependency-edge="' + AB + '"]'),
  ).toBeInTheDocument();
  expect(
    graph.container.querySelector('[data-dependency-edge="' + AB + '"]'),
  ).not.toHaveClass('critical');
  expect(
    graph.container.querySelector('[data-dependency-edge="' + AB + '"]'),
  ).not.toHaveClass('partial-critical');
  expect(tree).toEqual(before);
  expect(tree).not.toHaveProperty('legacyIntervalUnavailable');
});

it('partial Gantt and tree use positive partial IDs without global styles or bypass edges', () => {
  const tree = partialEdgeTree(),
    before = structuredClone(tree);
  const view = render(
    <Gantt
      tree={tree}
      rows={treeRows(tree.tasks, new Set())}
      start="2026-10-05"
      today="2026-10-07"
      scale="days"
      selectedId={null}
      disabled={false}
      onSelect={vi.fn()}
      onPlan={vi.fn()}
    />,
  );
  for (const id of [A, B, C]) {
    const bar = view.container.querySelector(
      '[data-gantt-bar="' + id + '"]',
    )!.parentElement;
    expect(bar).toHaveClass('partial-critical');
    expect(bar).not.toHaveClass('critical');
    expect(bar).toHaveAttribute(
      'aria-label',
      expect.stringContaining('Критична для датированной части'),
    );
  }
  for (const id of [AB, BC]) {
    const edge = view.container.querySelector('[data-gantt-edge="' + id + '"]');
    expect(edge).toHaveClass('partial-critical');
    expect(edge).not.toHaveClass('critical');
    expect(edge?.querySelector('title')).toHaveTextContent(
      'Критическая связь датированной части',
    );
  }
  expect(
    view.container.querySelector('[data-gantt-edge="' + AC + '"]'),
  ).not.toHaveClass('partial-critical');
  expect(view.container.querySelectorAll('[data-gantt-edge]')).toHaveLength(3);
  view.unmount();
  render(
    <TaskTree
      tasks={tree.tasks}
      schedule={tree.schedule}
      selectedId={null}
      collapsed={new Set()}
      onToggle={vi.fn()}
      onSelect={vi.fn()}
      onAction={vi.fn()}
    />,
  );
  expect(
    screen.getAllByLabelText('Критична для датированной части', {
      exact: true,
    }),
  ).toHaveLength(3);
  expect(
    screen.queryByLabelText('Критична для окончания проекта', { exact: true }),
  ).not.toBeInTheDocument();
  expect(tree).toEqual(before);
});
it('true full summary has a global descendant indicator only in ready and partial summary uses its own IDs', () => {
  const P = '22222222-2222-4222-8222-222222222226';
  const base = readyN06Tree();
  if (base.schedule.analysisStatus !== 'ready')
    throw new Error('Expected ready');
  const tree = projectTreeV2Schema.parse({
    ...base,
    tasks: [
      task(P, 'Этап P', null, null),
      ...base.tasks.map((t) => ({ ...t, parentId: P })),
    ],
    schedule: {
      ...base.schedule,
      summaries: {
        [P]: {
          startDate: '2026-10-05',
          finishDate: '2026-10-14',
          calendarSpanDays: 10,
          knownLeafCount: 3,
          totalLeafCount: 3,
          containsCritical: true,
        },
      },
    },
  });
  const props = {
    tasks: tree.tasks,
    schedule: tree.schedule,
    selectedId: null,
    collapsed: new Set([P]),
    onToggle: vi.fn(),
    onSelect: vi.fn(),
    onAction: vi.fn(),
  };
  const view = render(<TaskTree {...props} />);
  expect(
    screen.getByLabelText('Содержит критические задачи', { exact: true }),
  ).toBeVisible();
  expect(
    screen.queryByLabelText('Критична для окончания проекта', { exact: true }),
  ).not.toBeInTheDocument();
  if (tree.schedule.analysisStatus !== 'ready')
    throw new Error('Expected ready');
  const quiet = projectTreeV2Schema.parse({
    ...tree,
    schedule: {
      ...tree.schedule,
      summaries: {
        [P]: { ...tree.schedule.summaries[P], containsCritical: false },
      },
    },
  });
  view.rerender(<TaskTree {...props} schedule={quiet.schedule} />);
  expect(
    screen.queryByLabelText('Содержит критические задачи', { exact: true }),
  ).not.toBeInTheDocument();
  view.unmount();
  const partial = partialEdgeTree();
  if (partial.schedule.analysisStatus !== 'incomplete')
    throw new Error('Expected incomplete');
  const unknown = projectTreeV2Schema.parse({
    ...partial,
    tasks: [
      task(P, 'Этап P', null, null),
      ...partial.tasks.map((t) => ({ ...t, parentId: P })),
    ],
    schedule: {
      ...partial.schedule,
      summaries: {
        [P]: {
          startDate: null,
          finishDate: null,
          calendarSpanDays: null,
          knownLeafCount: 3,
          totalLeafCount: 4,
          containsCritical: null,
        },
      },
      partialAnalysis: {
        ...partial.schedule.partialAnalysis,
        partialCriticalSummaryIds: [P],
      },
    },
  });
  render(
    <TaskTree {...props} tasks={unknown.tasks} schedule={unknown.schedule} />,
  );
  expect(
    screen.getByLabelText('Содержит критические задачи датированной части', {
      exact: true,
    }),
  ).toBeVisible();
  expect(
    screen.queryByLabelText('Содержит критические задачи', { exact: true }),
  ).not.toBeInTheDocument();
});
it.each(['infeasible', 'pending-policy'] as const)(
  '%s keeps real bars and edges without any critical styles',
  (status) => {
    const base = partialEdgeTree();
    const real = {
      [A]: {
        startDate: '2026-10-05',
        finishDate: '2026-10-06',
        calendarSpanDays: 2,
      },
      [B]: {
        startDate: '2026-10-07',
        finishDate: '2026-10-09',
        calendarSpanDays: 3,
      },
      [C]: {
        startDate: '2026-10-10',
        finishDate: '2026-10-11',
        calendarSpanDays: 2,
      },
      [U]: { startDate: null, finishDate: null, calendarSpanDays: null },
    };
    const schedule =
      status === 'pending-policy'
        ? {
            analysisStatus: status,
            feasibility: 'feasible',
            coverage: { knownLeafCount: 3, totalLeafCount: 4 },
            tasks: real,
            summaries: {},
            display: {},
            criticalTaskIds: [],
            criticalDependencyIds: [],
            diagnostics: [],
          }
        : {
            ...base.schedule,
            analysisStatus: status,
            feasibility: 'infeasible',
            partialAnalysis: null,
          };
    const tree = projectTreeV2Schema.parse({ ...base, schedule });
    const props = {
      tree,
      disabled: false,
      onCommand: vi.fn().mockResolvedValue(true),
      onSelect: vi.fn(),
      onShow: vi.fn(),
    };
    const graph = render(
      <Dependencies {...props} task={tree.tasks.find((t) => t.id === B)!} />,
    );
    expect(
      graph.container.querySelectorAll('[data-dependency-edge]'),
    ).toHaveLength(2);
    expect(
      graph.container.querySelectorAll('.critical, .partial-critical'),
    ).toHaveLength(0);
    graph.unmount();
    const gantt = render(
      <Gantt
        tree={tree}
        rows={treeRows(tree.tasks, new Set())}
        start="2026-10-05"
        today="2026-10-07"
        scale="days"
        selectedId={null}
        disabled={false}
        onSelect={vi.fn()}
        onPlan={vi.fn()}
      />,
    );
    expect(gantt.container.querySelectorAll('[data-gantt-bar]')).toHaveLength(
      3,
    );
    expect(gantt.container.querySelectorAll('[data-gantt-edge]')).toHaveLength(
      3,
    );
    expect(
      gantt.container.querySelectorAll(
        '.critical, .partial-critical, .contains-critical',
      ),
    ).toHaveLength(0);
  },
);
