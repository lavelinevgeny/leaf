import { describe, expect, it } from 'vitest';
import fixtures from '../fixtures/scheduling/cpm-cases.json';
import { calculateSchedule } from '../src/server/legacy-scheduling.js';
import { indexToDate } from '../src/domain/calendar.js';
import type {
  ScheduleInput,
  SchedulingTask,
} from '../src/server/legacy-scheduling-types.js';

const origin = '2026-10-07';
const task = (
  id: string,
  overrides: Partial<SchedulingTask> = {},
): SchedulingTask => ({
  id,
  parentId: null,
  status: 'todo',
  planMode: 'auto',
  durationDays: 1,
  inputStart: null,
  inputFinish: null,
  notBefore: null,
  deadline: null,
  completedStart: null,
  completedFinish: null,
  completedStartIndex: null,
  completedFinishIndex: null,
  ...overrides,
});
const input = (
  tasks: SchedulingTask[],
  edges: [string, string][] = [],
  overrides: Partial<ScheduleInput> = {},
): ScheduleInput => ({
  startDate: origin,
  calendarType: 'all-days',
  tasks,
  dependencies: edges.map(([predecessorId, successorId]) => ({
    id: `${predecessorId}>${successorId}`,
    predecessorId,
    successorId,
  })),
  ...overrides,
});
const date = (index: number) => indexToDate(index, origin, 'all-days');

describe('frozen legacy pure scheduling', () => {
  for (const fixture of fixtures.cases)
    it(`numerical fixture: ${fixture.id}`, () => {
      const tasks = fixture.tasks.map((t) =>
        task(t.id, {
          durationDays: t.duration,
          ...('notBefore' in t ? { notBefore: date(t.notBefore) } : {}),
          ...('fixedStart' in t
            ? {
                planMode: 'fixed' as const,
                inputStart: date(t.fixedStart),
                inputFinish: date(t.fixedFinish! - 1),
              }
            : {}),
        }),
      );
      const edges: [string, string][] = fixture.tasks.flatMap((t) =>
        t.predecessors.map((p): [string, string] => [p, t.id]),
      );
      const result = calculateSchedule(input(tasks, edges));
      const expected = fixture.expected;
      if ('error' in expected) {
        expect(result.feasibility).toBe('infeasible');
        expect(result.diagnostics.map((d) => d.code)).toContain(expected.error);
        expect(result.criticalTaskIds).toEqual([]);
        return;
      }
      expect(result.feasibility).toBe('feasible');
      expect(result.projectFinishIndex).toBe(expected.finish);
      expect(result.criticalTaskIds).toEqual(expected.criticalTasks.toSorted());
      expect(result.criticalDependencyIds).toEqual(
        expected.criticalEdges.toSorted(),
      );
      for (const [id, start] of Object.entries(expected.ES))
        expect(result.tasks[id]?.ES).toBe(start);
      for (const [id, float] of Object.entries(expected.float))
        expect(result.tasks[id]?.projectFloat).toBe(float);
      if ('constraintFloat' in expected)
        for (const [id, float] of Object.entries(expected.constraintFloat))
          expect(result.tasks[id]?.constraintFloat).toBe(float);
    });
  it('keeps relative CPM without an origin but blocks absolute restrictions', () => {
    const relative = calculateSchedule(
      input([task('A', { durationDays: 2 })], [], { startDate: null }),
    );
    expect(relative.feasibility).toBe('feasible');
    expect(relative.tasks.A).toMatchObject({
      ES: 0,
      EF: 2,
      startDate: null,
      finishDate: null,
    });
    const absolute = calculateSchedule(
      input([task('A', { notBefore: origin }), task('B')], [], {
        startDate: null,
      }),
    );
    expect(absolute.feasibility).toBe('incomplete');
    expect(absolute.tasks.A?.ES).toBeNull();
    expect(absolute.tasks.B?.ES).toBe(0);
    expect(absolute.diagnostics.map((d) => d.code)).toContain(
      'MISSING_PROJECT_START',
    );
  });
  it('requires an origin for an unscheduled explicit deadline while preserving independent relative work', () => {
    const tasks = [
      task('A'),
      task('U', {
        planMode: 'unscheduled',
        durationDays: null,
        deadline: '2026-10-10',
      }),
    ];
    const result = calculateSchedule(input(tasks, [], { startDate: null }));
    expect(result.feasibility).toBe('incomplete');
    expect(result.coverage).toEqual({ knownLeafCount: 1, totalLeafCount: 2 });
    expect(result.tasks.A).toMatchObject({
      ES: 0,
      EF: 1,
      startDate: null,
      finishDate: null,
    });
    expect(result.tasks.U).toMatchObject({
      ES: null,
      EF: null,
      startDate: null,
      finishDate: null,
    });
    expect(
      result.diagnostics.find((d) => d.code === 'MISSING_PROJECT_START')
        ?.taskIds,
    ).toContain('U');
    const withOrigin = calculateSchedule(
      input(tasks, [], { calendarType: 'weekdays' }),
    );
    expect(withOrigin.feasibility).toBe('feasible');
    expect(withOrigin.coverage).toEqual({
      knownLeafCount: 1,
      totalLeafCount: 2,
    });
    expect(withOrigin.tasks.U).toMatchObject({
      ES: null,
      EF: null,
      startDate: null,
      finishDate: null,
    });
    expect(withOrigin.diagnostics).toEqual([]);
  });
  it('validates an unscheduled deadline without treating one-sided date annotations as restrictions', () => {
    const annotated = calculateSchedule(
      input(
        [
          task('A'),
          task('U', {
            planMode: 'unscheduled',
            durationDays: null,
            inputStart: '2026-10-10',
          }),
        ],
        [],
        { startDate: null },
      ),
    );
    expect(annotated.feasibility).toBe('feasible');
    expect(annotated.diagnostics).toEqual([]);
    const invalid = calculateSchedule(
      input(
        [
          task('A'),
          task('U', {
            planMode: 'unscheduled',
            durationDays: null,
            deadline: '2026-02-30',
          }),
        ],
        [],
        { startDate: null },
      ),
    );
    expect(invalid.feasibility).toBe('infeasible');
    expect(
      invalid.diagnostics.find((d) => d.code === 'INVALID_CALENDAR_DATE')
        ?.taskIds,
    ).toEqual(['U']);
  });
  it('blocks descendants of unknown work without assigning invented duration', () => {
    const result = calculateSchedule(
      input(
        [
          task('A'),
          task('U', {
            planMode: 'unscheduled',
            durationDays: null,
            inputStart: origin,
          }),
          task('B'),
          task('C'),
        ],
        [
          ['A', 'U'],
          ['U', 'B'],
        ],
      ),
    );
    expect(result.feasibility).toBe('incomplete');
    expect(result.coverage).toEqual({ knownLeafCount: 2, totalLeafCount: 4 });
    expect(result.tasks.U).toMatchObject({
      ES: null,
      EF: null,
      startDate: null,
      blockedReason: 'BLOCKED_BY_UNKNOWN',
    });
    expect(result.tasks.B?.blockedReason).toBe('BLOCKED_BY_UNKNOWN');
    expect(result.tasks.A?.EF).toBe(1);
    expect(result.tasks.C?.EF).toBe(1);
    expect(
      result.diagnostics.some(
        (d) =>
          d.taskIds.includes('U') &&
          d.taskIds.includes('B') &&
          d.dependencyIds.includes('U>B'),
      ),
    ).toBe(true);
  });
  it('aggregates partial summary dates without introducing precedence', () => {
    const result = calculateSchedule(
      input([
        task('P'),
        task('A', { parentId: 'P', durationDays: 3 }),
        task('U', {
          parentId: 'P',
          planMode: 'unscheduled',
          durationDays: null,
        }),
      ]),
    );
    expect(result.feasibility).toBe('feasible');
    expect(result.coverage).toEqual({ knownLeafCount: 1, totalLeafCount: 2 });
    expect(result.tasks.P).toBeUndefined();
    expect(result.summaries.P).toEqual({
      start: 0,
      finish: 3,
      startDate: origin,
      finishDate: date(2),
      partial: true,
      containsCritical: true,
    });
  });
  it('retains completed locks and detects predecessor changes', () => {
    const done = task('B', {
      status: 'done',
      durationDays: 99,
      completedStart: date(2),
      completedFinish: date(3),
      completedStartIndex: 2,
      completedFinishIndex: 4,
    });
    expect(
      calculateSchedule(
        input([task('A', { durationDays: 2 }), done], [['A', 'B']]),
      ).tasks.B,
    ).toMatchObject({ ES: 2, EF: 4 });
    const conflict = calculateSchedule(
      input([task('A', { durationDays: 3 }), done], [['A', 'B']]),
    );
    expect(conflict.feasibility).toBe('infeasible');
    expect(conflict.tasks.B?.ES).toBe(2);
    expect(conflict.diagnostics.map((d) => d.code)).toContain(
      'FIXED_PRECEDENCE_CONFLICT',
    );
    expect(
      calculateSchedule(
        input(
          [
            task('B', {
              status: 'done',
              completedStartIndex: 2,
              completedFinishIndex: 4,
            }),
          ],
          [],
          { startDate: null },
        ),
      ).tasks.B,
    ).toMatchObject({ ES: 2, EF: 4 });
  });
  it('distinguishes project float and chained fixed constraints', () => {
    const result = calculateSchedule(
      input(
        [
          task('A', { durationDays: 2 }),
          task('B', {
            planMode: 'fixed',
            inputStart: date(5),
            inputFinish: date(5),
          }),
          task('D', {
            planMode: 'fixed',
            inputStart: date(8),
            inputFinish: date(8),
          }),
          task('C', { durationDays: 15 }),
        ],
        [
          ['A', 'B'],
          ['B', 'D'],
        ],
      ),
    );
    expect(result.tasks.A).toMatchObject({
      projectFloat: 11,
      constraintFloat: 3,
    });
    expect(result.tasks.B).toMatchObject({
      projectFloat: 8,
      constraintFloat: 0,
    });
    expect(result.criticalTaskIds).toEqual(['C']);
  });
  it('keeps deadlines separate from project CPM', () => {
    const result = calculateSchedule(
      input([
        task('A', { durationDays: 5, deadline: date(2) }),
        task('B', { durationDays: 10 }),
      ]),
    );
    expect(result.feasibility).toBe('feasible');
    expect(result.criticalTaskIds).toEqual(['B']);
    expect(result.tasks.A).toMatchObject({ ES: 0, EF: 5, projectFloat: 5 });
    expect(result.diagnostics.map((d) => d.code)).toContain(
      'DEADLINE_EXCEEDED',
    );
  });
  it('excludes a release gap between critical tasks from critical edges', () => {
    const result = calculateSchedule(
      input(
        [
          task('A', { durationDays: 2 }),
          task('B', { notBefore: date(5) }),
          task('C', { durationDays: 4 }),
        ],
        [
          ['A', 'B'],
          ['A', 'C'],
        ],
      ),
    );
    expect(result.criticalTaskIds).toEqual(['A', 'B', 'C']);
    expect(result.criticalDependencyIds).toEqual(['A>C']);
    expect(result.tasks.B?.ES).toBe(5);
  });
  it('preserves absolute completed dates when project origin changes', () => {
    const value = input(
      [
        task('A', {
          status: 'done',
          completedStart: date(4),
          completedFinish: date(5),
          completedStartIndex: 4,
          completedFinishIndex: 6,
        }),
      ],
      [],
      { startDate: date(1) },
    );
    expect(calculateSchedule(value).tasks.A).toMatchObject({
      ES: 3,
      EF: 5,
      startDate: date(4),
      finishDate: date(5),
    });
  });
  it('keeps an unknown terminal dependency incomplete and an isolated unknown feasible', () => {
    const tasks = [
      task('A', { durationDays: 4 }),
      task('U', { planMode: 'unscheduled', durationDays: null }),
    ];
    expect(calculateSchedule(input(tasks)).feasibility).toBe('feasible');
    const linked = calculateSchedule(input(tasks, [['A', 'U']]));
    expect(linked.feasibility).toBe('incomplete');
    expect(linked.projectFinishIndex).toBe(4);
    expect(linked.coverage).toEqual({ knownLeafCount: 1, totalLeafCount: 2 });
    expect(linked.criticalTaskIds).toEqual(['A']);
  });
  it('returns identifiable diagnostics for malformed graphs and cycles', () => {
    const cycle = calculateSchedule(
      input(
        [task('A'), task('B'), task('C')],
        [
          ['A', 'B'],
          ['B', 'A'],
          ['B', 'C'],
        ],
      ),
    );
    expect(
      cycle.diagnostics.find((d) => d.code === 'DEPENDENCY_CYCLE'),
    ).toMatchObject({ taskIds: ['A', 'B'], dependencyIds: ['A>B', 'B>A'] });
    for (const value of [
      input([task('A')], [['A', 'A']]),
      input([task('A')], [['A', 'missing']]),
      input(
        [task('A'), task('B')],
        [
          ['A', 'B'],
          ['A', 'B'],
        ],
      ),
      input([task('P'), task('C', { parentId: 'P' }), task('B')], [['P', 'B']]),
      input([task('A', { parentId: 'B' }), task('B', { parentId: 'A' })]),
    ]) {
      const result = calculateSchedule(value);
      expect(result.feasibility).toBe('infeasible');
      expect(result.diagnostics.length).toBeGreaterThan(0);
    }
  });
  it('returns diagnostics for invalid dates, locked weekend and calendar overflow', () => {
    for (const value of [
      input(
        [
          task('A', {
            planMode: 'fixed',
            inputStart: '2026-10-10',
            inputFinish: '2026-10-12',
          }),
        ],
        [],
        { calendarType: 'weekdays' },
      ),
      input([task('A', { durationDays: 2 })], [], { startDate: '9999-12-31' }),
      input([task('A', { durationDays: Number.MAX_SAFE_INTEGER })]),
      input([task('A', { notBefore: '2026-02-30' })]),
      input([
        task('A', {
          planMode: 'fixed',
          inputStart: date(-1),
          inputFinish: origin,
        }),
      ]),
    ]) {
      expect(() => calculateSchedule(value)).not.toThrow();
      expect(calculateSchedule(value).feasibility).toBe('infeasible');
    }
    const normalized = calculateSchedule(
      input([task('A', { notBefore: '2026-10-10' })], [], {
        startDate: '2026-10-10',
        calendarType: 'weekdays',
      }),
    );
    expect(normalized.originDate).toBe('2026-10-12');
    expect(normalized.tasks.A?.startDate).toBe('2026-10-12');
  });
  it('is deterministic, immutable and handles deep summaries iteratively', () => {
    const tasks = Array.from({ length: 12000 }, (_, i) =>
      task(`n${i}`, { parentId: i ? `n${i - 1}` : null }),
    );
    const value = input(tasks);
    const before = structuredClone(value);
    const result = calculateSchedule(value);
    expect(result.summaries.n0).toMatchObject({
      start: 0,
      finish: 1,
      partial: false,
    });
    expect(value).toEqual(before);
    expect(calculateSchedule({ ...value, tasks: tasks.toReversed() })).toEqual(
      result,
    );
  });
  it('handles deep dependency chains without recursive traversal', () => {
    const tasks = Array.from({ length: 12000 }, (_, i) => task(String(i)));
    const edges: [string, string][] = tasks
      .slice(1)
      .map((t, i) => [String(i), t.id]);
    const result = calculateSchedule(input(tasks, edges, { startDate: null }));
    expect(result.feasibility).toBe('feasible');
    expect(result.projectFinishIndex).toBe(12000);
    expect(result.criticalTaskIds).toHaveLength(12000);
    expect(result.criticalDependencyIds).toHaveLength(11999);
    expect(result.tasks['11999']).toMatchObject({ ES: 11999, EF: 12000 });
  });
  it('keeps missing-origin propagation distinct from unknown duration', () => {
    const result = calculateSchedule(
      input(
        [task('A', { notBefore: origin }), task('B'), task('C')],
        [['A', 'B']],
        { startDate: null },
      ),
    );
    expect(result.feasibility).toBe('incomplete');
    expect(result.tasks.B?.blockedReason).toBe(
      'BLOCKED_BY_MISSING_PROJECT_START',
    );
    expect(result.tasks.B?.ES).toBeNull();
    expect(result.tasks.C?.ES).toBe(0);
  });
  it('accepts the last calendar day for one-day tasks and avoids prototype-key ambiguity', () => {
    const last = calculateSchedule(
      input([task('A')], [], { startDate: '9999-12-31' }),
    );
    expect(last.feasibility).toBe('feasible');
    expect(last.tasks.A?.finishDate).toBe('9999-12-31');
    const result = calculateSchedule(
      input([
        task('constructor'),
        task('__proto__', { parentId: 'constructor' }),
      ]),
    );
    expect(result.summaries.constructor).toMatchObject({ start: 0, finish: 1 });
    expect(result.tasks.__proto__).toMatchObject({ ES: 0, EF: 1 });
  });
  it('satisfies independently generated DAG durations and FS constraints', () => {
    for (let seed = 1; seed <= 12; seed++) {
      const tasks = Array.from({ length: 24 }, (_, i) =>
        task(String(i), { durationDays: ((i * seed) % 7) + 1 }),
      );
      const edges: [string, string][] = [];
      for (let i = 0; i < 24; i++)
        for (let j = i + 1; j < 24; j++)
          if ((i * 17 + j * seed) % 19 === 0)
            edges.push([String(i), String(j)]);
      const value = input(tasks, edges);
      const result = calculateSchedule(value);
      expect(result.feasibility).toBe('feasible');
      for (const t of tasks) {
        const scheduled = result.tasks[t.id]!;
        expect(scheduled.EF! - scheduled.ES!).toBe(t.durationDays);
        expect(scheduled.LF! - scheduled.LS!).toBe(t.durationDays);
        expect(scheduled.projectFloat).toBeGreaterThanOrEqual(0);
        const predecessorFinish = edges
          .filter((e) => e[1] === t.id)
          .map((e) => result.tasks[e[0]]!.EF!);
        expect(scheduled.ES).toBe(Math.max(0, ...predecessorFinish));
      }
      for (const [p, s] of edges)
        expect(result.tasks[s]!.ES!).toBeGreaterThanOrEqual(
          result.tasks[p]!.EF!,
        );
      expect(
        calculateSchedule({
          ...value,
          tasks: tasks.toReversed(),
          dependencies: value.dependencies.toReversed(),
        }),
      ).toEqual(result);
    }
  });
});
