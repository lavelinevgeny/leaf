// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { cleanup, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, expect, it, vi } from 'vitest';
import {
  actionableDiagnostics,
  isAbsenceOnlyDiagnostic,
} from '../../src/client/schedule-diagnostics.js';
import { TaskTree } from '../../src/client/TaskTree.js';
import { ScheduleStatus } from '../../src/client/ScheduleStatus.js';
import { optionalTreeFixture } from './fixtures.js';
import type { ProjectTree } from '../../src/shared/contracts.js';

afterEach(cleanup);
type Diagnostic = ProjectTree['schedule']['diagnostics'][number];
const diagnostic = (code: string, taskIds: string[] = []): Diagnostic => ({
  code,
  taskIds,
  dependencyIds: [],
  messageKey: `scheduling.${code}`,
});
const absenceCodes = [
  'UNKNOWN_INTERVAL',
  'UNKNOWN_PRECEDENCE',
  'UNKNOWN_DEPENDENCY',
  'BLOCKED_BY_UNKNOWN',
  'MISSING_PROJECT_START',
  'BLOCKED_BY_MISSING_PROJECT_START',
];
const actionableCodes = [
  'EXPLICIT_PRECEDENCE_CONFLICT',
  'INVALID_INTERVAL',
  'DURATION_MISMATCH',
  'INVALID_PRECEDENCE_BOUNDARY',
  'INVALID_DURATION',
  'NON_WORKING_DATE',
  'CALENDAR_RANGE_EXCEEDED',
];
function conflictTree() {
  const tree = optionalTreeFixture();
  const base = tree.tasks[1]!;
  tree.tasks = ['A', 'B', 'C', 'D', 'E'].map((title, index) => ({
    ...base,
    id: `22222222-2222-4222-8222-${String(index + 1).padStart(12, '0')}`,
    title: `Работа ${title}`,
    parentId: null,
    sortOrder: index,
    inputStart: null,
    inputFinish: null,
    durationDays: null,
  }));
  const [a, b, , d, e] = tree.tasks;
  tree.schedule = {
    analysisStatus: 'infeasible',
    feasibility: 'infeasible',
    coverage: { knownLeafCount: 0, totalLeafCount: 5 },
    tasks: {},
    summaries: {},
    display: {},
    criticalTaskIds: [],
    criticalDependencyIds: [],
    partialAnalysis: null,
    horizonFinishDate: null,
    diagnostics: [
      {
        ...diagnostic('EXPLICIT_PRECEDENCE_CONFLICT', [a!.id, b!.id]),
        dependencyIds: ['33333333-3333-4333-8333-333333333333'],
      },
      diagnostic('UNKNOWN_INTERVAL', [d!.id]),
      diagnostic('INVALID_DURATION', [e!.id]),
    ],
  };
  return tree;
}
it('selects only the explicit actionable allowlist without mutating diagnostic input', () => {
  const diagnostics = [
    ...actionableCodes,
    ...absenceCodes,
    'LEGACY_INTERVAL_UNAVAILABLE',
    'FUTURE_UNKNOWN_CODE',
  ].map((code) => diagnostic(code));
  const before = structuredClone(diagnostics);
  Object.freeze(diagnostics);
  expect(actionableDiagnostics(diagnostics).map((item) => item.code)).toEqual(
    actionableCodes,
  );
  expect(diagnostics).toEqual(before);
});
it.each(absenceCodes)(
  'suppresses absence-only %s without hiding availability or real errors',
  (code) => {
    expect(isAbsenceOnlyDiagnostic(diagnostic(code))).toBe(true);
    for (const retained of [
      ...actionableCodes,
      'LEGACY_INTERVAL_UNAVAILABLE',
      'INVALID_UNAVAILABLE_TASK',
      'FUTURE_UNKNOWN_CODE',
    ])
      expect(isAbsenceOnlyDiagnostic(diagnostic(retained))).toBe(false);
  },
);
it('puts localized conflict indicators on both FS tasks and invalid input, with existing row selection', async () => {
  const tree = conflictTree(),
    before = structuredClone(tree),
    onSelect = vi.fn();
  const view = render(
    <TaskTree
      tasks={tree.tasks}
      schedule={tree.schedule}
      selectedId={null}
      collapsed={new Set()}
      onSelect={onSelect}
      onToggle={vi.fn()}
      onAction={vi.fn()}
    />,
  );
  const rows = screen.getAllByRole('treeitem');
  for (const index of [0, 1]) {
    const indicator = within(rows[index]!).getByRole('img', {
      name: 'Конфликт плана: Предшественник заканчивается после явного начала.',
    });
    expect(indicator).toHaveAttribute(
      'title',
      'Конфликт плана: Предшественник заканчивается после явного начала.',
    );
    await userEvent.click(indicator);
    expect(onSelect).toHaveBeenLastCalledWith(tree.tasks[index]);
  }
  for (const index of [2, 3])
    expect(within(rows[index]!).queryByRole('img')).toBeNull();
  expect(
    within(rows[4]!).getByRole('img', {
      name: 'Конфликт плана: Проверьте длительность задачи.',
    }),
  ).toBeVisible();
  rows[0]!.focus();
  await userEvent.keyboard('{Enter}');
  expect(onSelect).toHaveBeenLastCalledWith(tree.tasks[0]);
  view.rerender(
    <TaskTree
      tasks={tree.tasks}
      rows={[{ task: tree.tasks[2]!, depth: 0, hasChildren: false }]}
      schedule={tree.schedule}
      selectedId={null}
      collapsed={new Set()}
      onSelect={onSelect}
      onToggle={vi.fn()}
      onAction={vi.fn()}
    />,
  );
  expect(screen.queryByRole('img')).toBeNull();
  expect(tree).toEqual(before);
});
it('keeps actual conflict detail local while an independent task has no infeasible badge', () => {
  const tree = conflictTree(),
    before = structuredClone(tree);
  const view = render(<ScheduleStatus tree={tree} task={tree.tasks[0]!} />);
  expect(
    screen.getByText('Предшественник заканчивается после явного начала.'),
  ).toBeVisible();
  expect(screen.getByText('Конфликт плана')).toBeVisible();
  view.rerender(<ScheduleStatus tree={tree} task={tree.tasks[2]!} />);
  expect(screen.queryByText('Конфликт плана')).toBeNull();
  expect(screen.queryByRole('list')).toBeNull();
  view.rerender(<ScheduleStatus tree={tree} task={tree.tasks[3]!} />);
  expect(screen.queryByText('Полная пара дат не задана.')).toBeNull();
  expect(screen.queryByText('Неполные сроки')).toBeNull();
  expect(tree).toEqual(before);
});
it('keeps frozen explanation and legacy availability but removes missing-origin-only warnings', () => {
  const tree = optionalTreeFixture();
  tree.schedule.diagnostics = [
    ...absenceCodes.map((code) => diagnostic(code, [tree.tasks[1]!.id])),
    diagnostic('LEGACY_INTERVAL_UNAVAILABLE', [tree.tasks[1]!.id]),
  ];
  tree.schedule.feasibility = 'incomplete';
  const before = structuredClone(tree);
  render(<ScheduleStatus tree={tree} task={tree.tasks[1]!} />);
  expect(
    screen.getByText('Сохранённый результат без расчёта критического пути'),
  ).toBeVisible();
  expect(
    screen.getByText('Прежний интервал недоступен; полный расчёт неизвестен.'),
  ).toBeVisible();
  expect(screen.queryByText('Неполные сроки')).toBeNull();
  expect(screen.getAllByRole('listitem')).toHaveLength(1);
  expect(tree).toEqual(before);
});
