import { describe, expect, expectTypeOf, it } from 'vitest';
import type { z } from 'zod';
import {
  calculateOptionalSchedule,
  conditionalFinish,
  validateOptionalDependency,
} from '../src/domain/optional-scheduling.js';
import type {
  OptionalResult,
  OptionalTask,
} from '../src/domain/optional-scheduling-types.js';
import type {
  CalendarType,
  SchedulingDependency,
} from '../src/domain/scheduling-types.js';
import { scheduleResultV2Schema } from '../src/shared/optional-contracts.js';

const t = (
  id: string,
  parentId: string | null = null,
  inputStart: string | null = null,
  inputFinish: string | null = null,
  durationDays: number | null = null,
): OptionalTask => ({
  id,
  parentId,
  inputStart,
  inputFinish,
  durationDays,
  status: 'todo',
});
const e = (
  id: string,
  predecessorId: string,
  successorId: string,
): SchedulingDependency => ({ id, predecessorId, successorId });
const schedule = (
  tasks: readonly OptionalTask[],
  dependencies: readonly SchedulingDependency[] = [],
  calendarType: CalendarType = 'weekdays',
): OptionalResult =>
  calculateOptionalSchedule({ calendarType, tasks, dependencies });
const unknown = {
  startDate: null,
  finishDate: null,
  calendarSpanDays: null,
};
const n02 = (): OptionalTask[] => [
  t('P'),
  t('A', 'P', '2026-10-05', '2026-10-06'),
  t('B', 'P', '2026-10-09', '2026-10-12'),
  t('C', 'P', null, null, 3),
];

describe('optional real intervals and summaries', () => {
  it('keeps N02 summary unknown while displaying C from the sibling anchor', () => {
    const tasks = n02();
    const before = structuredClone(tasks);
    const result = schedule(tasks);
    expect(result.coverage).toEqual({ knownLeafCount: 2, totalLeafCount: 3 });
    expect(result.summaries.P).toEqual({
      ...unknown,
      knownLeafCount: 2,
      totalLeafCount: 3,
    });
    expect(result.display.C).toEqual({
      kind: 'conditional',
      startDate: '2026-10-05',
      finishDate: '2026-10-07',
      clipped: false,
    });
    expect(result.tasks.C).toEqual(unknown);
    expect(result.analysisStatus).toBe('pending-policy');
    expect(result.criticalTaskIds).toEqual([]);
    expect(result.criticalDependencyIds).toEqual([]);
    expect(tasks).toEqual(before);
  });

  it('uses exactly one display day when C has no duration', () => {
    const tasks = n02();
    tasks[3]!.durationDays = null;
    expect(schedule(tasks).display.C).toEqual({
      kind: 'conditional',
      startDate: '2026-10-05',
      finishDate: '2026-10-05',
      clipped: false,
    });
  });

  it('uses a six-day calendar span, not the sum of children, for complete N02', () => {
    const tasks = n02();
    tasks[3] = t('C', 'P', '2026-10-07', '2026-10-09', 3);
    const result = schedule(tasks);
    expect(result.summaries.P).toEqual({
      startDate: '2026-10-05',
      finishDate: '2026-10-12',
      calendarSpanDays: 6,
      knownLeafCount: 3,
      totalLeafCount: 3,
    });
    expect(result.display).toEqual({});
    expect(result.tasks.C).toEqual({
      startDate: '2026-10-07',
      finishDate: '2026-10-09',
      calendarSpanDays: 3,
    });
    tasks[2]!.inputFinish = null;
    expect(schedule(tasks).summaries.P).toEqual({
      ...unknown,
      knownLeafCount: 2,
      totalLeafCount: 3,
    });
  });

  it('does not infer either boundary from duration or change done work', () => {
    const tasks = [
      t('A', null, '2026-10-05', null, 3),
      t('B', null, null, '2026-10-07', 3),
      {
        ...t('C', null, '2026-10-05', '2026-10-07', 3),
        status: 'done' as const,
      },
    ];
    const before = structuredClone(tasks);
    const result = schedule(tasks);
    expect(result.tasks.A).toEqual(unknown);
    expect(result.tasks.B).toEqual(unknown);
    expect(result.tasks.C).toEqual({
      startDate: '2026-10-05',
      finishDate: '2026-10-07',
      calendarSpanDays: 3,
    });
    expect(result.coverage).toEqual({ knownLeafCount: 1, totalLeafCount: 3 });
    expect(result.feasibility).toBe('feasible');
    expect(tasks).toEqual(before);
  });

  it.each([
    ['2026-10-12', '2026-10-09', null, 'INVALID_INTERVAL'],
    ['2026-10-10', '2026-10-12', null, 'INVALID_INTERVAL'],
    ['invalid', '2026-10-12', null, 'INVALID_INTERVAL'],
    ['2026-10-09', '2026-10-12', 3, 'DURATION_MISMATCH'],
  ] as const)(
    'reads invalid saved source %s / %s / %s without changing it',
    (start, finish, duration, code) => {
      const tasks = [t('P'), t('A', 'P', start, finish, duration)];
      const before = structuredClone(tasks);
      const result = schedule(tasks);
      expect(result.tasks.A).toEqual(unknown);
      expect(result.summaries.P).toEqual({
        ...unknown,
        knownLeafCount: 0,
        totalLeafCount: 1,
      });
      expect(result.coverage).toEqual({ knownLeafCount: 0, totalLeafCount: 1 });
      expect(result.feasibility).toBe('infeasible');
      expect(result.diagnostics).toEqual([
        {
          code,
          taskIds: ['A'],
          dependencyIds: [],
          messageKey: `scheduling.${code}`,
        },
      ]);
      expect(tasks).toEqual(before);
    },
  );

  it('keeps the empty pending result free of forecasts and CPM values', () => {
    expect(schedule([])).toEqual({
      analysisStatus: 'pending-policy',
      feasibility: 'feasible',
      coverage: { knownLeafCount: 0, totalLeafCount: 0 },
      tasks: {},
      summaries: {},
      display: {},
      criticalTaskIds: [],
      criticalDependencyIds: [],
      diagnostics: [],
    });
  });
});

describe('conditional display groups and calendars', () => {
  it('uses N03 descendant source minima independently of unknown P/Q summaries', () => {
    const tasks = [
      t('P'),
      t('Q', 'P'),
      t('A', 'Q', '2026-10-05'),
      t('B', 'P'),
      t('C', 'Q'),
    ];
    const result = schedule(tasks);
    for (const id of ['B', 'C'])
      expect(result.display[id]).toEqual({
        kind: 'conditional',
        startDate: '2026-10-05',
        finishDate: '2026-10-05',
        clipped: false,
      });
    for (const id of ['P', 'Q']) {
      expect(result.summaries[id]!.startDate).toBeNull();
      expect(result.summaries[id]!.finishDate).toBeNull();
    }
    expect(result.coverage).toEqual({ knownLeafCount: 0, totalLeafCount: 3 });
    tasks[2]!.inputStart = null;
    expect(schedule(tasks).display).toEqual({});
  });

  it('keeps finish-only source independent of its conditional display finish', () => {
    const tasks = [
      t('P'),
      t('B', 'P', null, '2026-10-02'),
      t('D', 'P', '2026-10-09'),
    ];
    const result = schedule(tasks);
    expect(result.tasks.B).toEqual(unknown);
    expect(result.display.B).toEqual({
      kind: 'conditional',
      startDate: '2026-10-09',
      finishDate: '2026-10-09',
      clipped: false,
    });
    expect(tasks[1]!.inputFinish).toBe('2026-10-02');
  });

  it.each([
    ['invalid', null, 'INVALID_INTERVAL'],
    [null, 0, 'INVALID_DURATION'],
  ] as const)(
    'keeps a valid source start as anchor when saved finish/duration is invalid',
    (finish, duration, code) => {
      const tasks = [
        t('P'),
        t('A', 'P', '2026-10-05', finish, duration),
        t('B', 'P'),
      ];
      const before = structuredClone(tasks);
      const result = schedule(tasks);
      expect(result.display.B).toEqual({
        kind: 'conditional',
        startDate: '2026-10-05',
        finishDate: '2026-10-05',
        clipped: false,
      });
      expect(result.tasks.A).toEqual(unknown);
      expect(result.summaries.P).toEqual({
        ...unknown,
        knownLeafCount: 0,
        totalLeafCount: 2,
      });
      expect(result.diagnostics).toEqual([
        {
          code,
          taskIds: ['A'],
          dependencyIds: [],
          messageKey: `scheduling.${code}`,
        },
      ]);
      expect(tasks).toEqual(before);
    },
  );

  it('does not borrow a root or external-branch anchor or display a summary', () => {
    const result = schedule([
      t('RootKnown', null, '2026-10-05'),
      t('RootMissing'),
      t('P'),
      t('A', 'P', '2026-10-09'),
      t('Q', 'P'),
      t('C', 'Q'),
      t('Other'),
      t('D', 'Other'),
    ]);
    expect(result.display).toEqual({});
    expect(result.summaries.P!.startDate).toBeNull();
    expect(result.tasks.RootMissing).toEqual(unknown);
  });

  it.each([
    ['2026-10-09', 2, 'weekdays', '2026-10-12'],
    ['2026-10-10', 1, 'weekdays', '2026-10-10'],
    ['2026-10-10', 2, 'weekdays', '2026-10-12'],
    ['2026-10-10', 3, 'weekdays', '2026-10-13'],
    ['2026-10-10', null, 'weekdays', '2026-10-10'],
    ['2026-10-09', 2, 'all-days', '2026-10-10'],
  ] as const)(
    'projects %s + %s in %s to %s',
    (anchor, duration, calendar, finish) => {
      expect(conditionalFinish(anchor, duration, calendar)).toEqual({
        finishDate: finish,
        clipped: false,
      });
    },
  );

  it('allows a one-sided weekend anchor only in the separate display projection', () => {
    const result = schedule([
      t('P'),
      t('A', 'P', '2026-10-10'),
      t('B', 'P', null, null, 2),
    ]);
    expect(result.display.B).toEqual({
      kind: 'conditional',
      startDate: '2026-10-10',
      finishDate: '2026-10-12',
      clipped: false,
    });
    expect(result.tasks.A).toEqual(unknown);
    expect(result.tasks.B).toEqual(unknown);
    expect(result.diagnostics).toEqual([]);
  });

  it.each(['weekdays', 'all-days'] as const)(
    'clips overflow in %s without changing duration',
    (calendar) => {
      const tasks = [
        t('P'),
        t('A', 'P', '9999-12-31'),
        t('B', 'P', null, null, 1000000),
      ];
      const before = structuredClone(tasks);
      expect(conditionalFinish('9999-12-31', 2, calendar)).toEqual({
        finishDate: '9999-12-31',
        clipped: true,
      });
      expect(schedule(tasks, [], calendar).display.B).toEqual({
        kind: 'conditional',
        startDate: '9999-12-31',
        finishDate: '9999-12-31',
        clipped: true,
      });
      expect(tasks).toEqual(before);
    },
  );

  it('does not swallow calendar errors other than supported-range overflow', () => {
    expect(() => conditionalFinish('invalid', 2, 'weekdays')).toThrowError(
      'INVALID_CALENDAR_DATE',
    );
  });
});

describe('explicit FS preparation', () => {
  it.each([
    ['weekdays', '2026-10-12', 'feasible', []],
    ['weekdays', '2026-10-09', 'infeasible', ['EXPLICIT_PRECEDENCE_CONFLICT']],
    ['all-days', '2026-10-10', 'feasible', []],
  ] as const)(
    'checks N04 Friday finish and %s successor %s',
    (calendar, start, feasibility, codes) => {
      const tasks = [
        t('A', null, '2026-10-09', '2026-10-09'),
        t('B', null, start, start),
      ];
      const before = structuredClone(tasks);
      const result = schedule(tasks, [e('AB', 'A', 'B')], calendar);
      expect(result.feasibility).toBe(feasibility);
      expect(result.diagnostics.map((item) => item.code)).toEqual(codes);
      expect(result.tasks.B).toEqual({
        startDate: start,
        finishDate: start,
        calendarSpanDays: 1,
      });
      expect(result.coverage).toEqual({ knownLeafCount: 2, totalLeafCount: 2 });
      expect(tasks).toEqual(before);
    },
  );

  it('checks only the needed finish/start edges even with zero real coverage', () => {
    const result = schedule(
      [
        t('A', null, null, '2026-10-09', 7),
        t('B', null, '2026-10-12', null, 9),
      ],
      [e('AB', 'A', 'B')],
    );
    expect(result.feasibility).toBe('feasible');
    expect(result.coverage).toEqual({ knownLeafCount: 0, totalLeafCount: 2 });
    expect(result.tasks).toEqual({ A: unknown, B: unknown });
    expect(result.diagnostics).toEqual([]);
  });

  it('reports unknown precedence without removing a known successor interval', () => {
    const result = schedule(
      [t('A'), t('B', null, '2026-10-12', '2026-10-13')],
      [e('AB', 'A', 'B')],
    );
    expect(result.feasibility).toBe('incomplete');
    expect(result.tasks.B).toEqual({
      startDate: '2026-10-12',
      finishDate: '2026-10-13',
      calendarSpanDays: 2,
    });
    expect(result.diagnostics).toEqual([
      {
        code: 'UNKNOWN_PRECEDENCE',
        taskIds: ['A', 'B'],
        dependencyIds: ['AB'],
        messageKey: 'scheduling.UNKNOWN_PRECEDENCE',
      },
    ]);
  });

  it('keeps a full summary and both conflict/unknown diagnostics when FS conflicts', () => {
    const result = schedule(
      [
        t('P'),
        t('A', 'P', '2026-10-09', '2026-10-09'),
        t('B', 'P', '2026-10-09', '2026-10-12'),
        t('U'),
      ],
      [e('UB', 'U', 'B'), e('AB', 'A', 'B')],
    );
    expect(result.feasibility).toBe('infeasible');
    expect(result.summaries.P).toEqual({
      startDate: '2026-10-09',
      finishDate: '2026-10-12',
      calendarSpanDays: 2,
      knownLeafCount: 2,
      totalLeafCount: 2,
    });
    expect(result.diagnostics).toEqual([
      {
        code: 'EXPLICIT_PRECEDENCE_CONFLICT',
        taskIds: ['A', 'B'],
        dependencyIds: ['AB'],
        messageKey: 'scheduling.EXPLICIT_PRECEDENCE_CONFLICT',
      },
      {
        code: 'UNKNOWN_PRECEDENCE',
        taskIds: ['B', 'U'],
        dependencyIds: ['UB'],
        messageKey: 'scheduling.UNKNOWN_PRECEDENCE',
      },
    ]);
    expect(result.criticalTaskIds).toEqual([]);
  });

  it.each([
    [null, '2026-10-10', '2026-10-12', null],
    [null, '2026-10-09', '2026-10-10', null],
  ] as const)(
    'rejects a non-working required FS edge independently of full pairs',
    (aStart, aFinish, bStart, bFinish) => {
      const result = schedule(
        [t('A', null, aStart, aFinish), t('B', null, bStart, bFinish)],
        [e('AB', 'A', 'B')],
      );
      expect(result.feasibility).toBe('infeasible');
      expect(result.diagnostics).toEqual([
        {
          code: 'NON_WORKING_DATE',
          taskIds: ['A', 'B'],
          dependencyIds: ['AB'],
          messageKey: 'scheduling.NON_WORKING_DATE',
        },
      ]);
      expect(result.coverage.knownLeafCount).toBe(0);
    },
  );

  it('never uses conditional edges or parent hierarchy as FS', () => {
    const tasks = [
      t('P'),
      t('A', 'P', '2026-10-09', '2026-10-09'),
      t('B', 'P', null, null, 3),
    ];
    expect(schedule(tasks).diagnostics).toEqual([]);
    const result = schedule(tasks, [e('AB', 'A', 'B')]);
    expect(result.display.B!.finishDate).toBe('2026-10-13');
    expect(result.feasibility).toBe('incomplete');
    expect(result.diagnostics[0]!.code).toBe('UNKNOWN_PRECEDENCE');
  });
});

describe('iteration, determinism and target DTO compatibility', () => {
  it.each([40, 10000])(
    'aggregates a %i-level hierarchy with one missing leaf iteratively',
    (depth) => {
      const tasks = Array.from({ length: depth }, (_, index) =>
        t(`P${index}`, index === 0 ? null : `P${index - 1}`),
      );
      tasks.push(
        t('A', `P${depth - 1}`, '2026-10-05', '2026-10-06'),
        t('B', `P${depth - 1}`),
      );
      const before = structuredClone(tasks);
      const result = schedule(tasks.reverse());
      expect(result.coverage).toEqual({ knownLeafCount: 1, totalLeafCount: 2 });
      expect(Object.keys(result.summaries)).toHaveLength(depth);
      for (const summary of Object.values(result.summaries))
        expect(summary).toEqual({
          ...unknown,
          knownLeafCount: 1,
          totalLeafCount: 2,
        });
      expect(result.display.B).toEqual({
        kind: 'conditional',
        startDate: '2026-10-05',
        finishDate: '2026-10-05',
        clipped: false,
      });
      expect(tasks).toEqual(before.reverse());
    },
  );

  it('returns identical sorted results for input permutations without mutations', () => {
    const tasks = [...n02(), t('U')];
    const dependencies = [
      e('UB', 'U', 'B'),
      e('AB', 'A', 'B'),
      e('BC', 'B', 'C'),
    ];
    const expected = schedule(tasks, dependencies);
    const frozenTasks = Object.freeze(
      tasks.map((task) => Object.freeze({ ...task })),
    );
    const frozenEdges = Object.freeze(
      dependencies.map((edge) => Object.freeze({ ...edge })),
    );
    expect(JSON.stringify(schedule(frozenTasks, frozenEdges))).toBe(
      JSON.stringify(expected),
    );
    expect(
      JSON.stringify(
        schedule([...tasks].reverse(), [...dependencies].reverse()),
      ),
    ).toBe(JSON.stringify(expected));
    expect(
      JSON.stringify(
        schedule(
          [...tasks.slice(2), ...tasks.slice(0, 2)],
          [dependencies[2]!, dependencies[0]!, dependencies[1]!],
        ),
      ),
    ).toBe(JSON.stringify(expected));
  });

  it('matches the strict pending DTO at compile time and parses real/display/diagnostic maps', () => {
    expectTypeOf<OptionalResult>().toEqualTypeOf<
      z.infer<typeof scheduleResultV2Schema>
    >();
    const p = '00000000-0000-4000-8000-000000000001';
    const a = '00000000-0000-4000-8000-000000000002';
    const b = '00000000-0000-4000-8000-000000000003';
    const edgeId = '00000000-0000-4000-8000-000000000004';
    const result = schedule(
      [t(p), t(a, p, '2026-10-05', '2026-10-06'), t(b, p)],
      [e(edgeId, a, b)],
    );
    expect(scheduleResultV2Schema.parse(result)).toEqual(result);
  });
});

describe('narrow optional graph validation', () => {
  const tasks = [t('P'), t('A', 'P'), t('B', 'P'), t('C')];
  it.each([
    ['A', 'A', [], 'DEPENDENCY_SELF', 'SELF_DEPENDENCY'],
    [
      'A',
      'B',
      [e('AB', 'A', 'B')],
      'DEPENDENCY_DUPLICATE',
      'DUPLICATE_DEPENDENCY',
    ],
    ['P', 'A', [], 'DEPENDENCY_SUMMARY', 'DEPENDENCY_REQUIRES_LEAVES'],
    [
      'A',
      'Foreign',
      [],
      'INVALID_DEPENDENCY_ENDPOINT',
      'DEPENDENCY_TASK_NOT_FOUND',
    ],
    ['B', 'A', [e('AB', 'A', 'B')], 'DEPENDENCY_CYCLE', 'DEPENDENCY_CYCLE'],
  ] as const)(
    'rejects %s -> %s before writes and returns safe pure diagnostics',
    (predecessor, successor, edges, errorCode, diagnosticCode) => {
      expect(() =>
        validateOptionalDependency(tasks, edges, predecessor, successor),
      ).toThrowError(expect.objectContaining({ code: errorCode }));
      const result = schedule(tasks, [
        ...edges,
        e('New', predecessor, successor),
      ]);
      expect(result.feasibility).toBe('infeasible');
      expect(
        result.diagnostics.some((item) => item.code === diagnosticCode),
      ).toBe(true);
      expect(
        result.diagnostics.every(
          (item) => item.messageKey === `scheduling.${item.code}`,
        ),
      ).toBe(true);
    },
  );

  it('accepts a DAG, with hierarchy providing no implied dependencies', () => {
    expect(() => validateOptionalDependency(tasks, [], 'A', 'B')).not.toThrow();
    expect(() =>
      validateOptionalDependency(tasks, [e('AB', 'A', 'B')], 'A', 'C'),
    ).not.toThrow();
  });

  it('reports only actual dependency cycle members, not downstream tasks', () => {
    const dependencies = [
      e('BC', 'B', 'C'),
      e('BA', 'B', 'A'),
      e('AB', 'A', 'B'),
    ];
    const result = schedule(tasks, dependencies);
    expect(result.diagnostics).toEqual([
      {
        code: 'DEPENDENCY_CYCLE',
        taskIds: ['A', 'B'],
        dependencyIds: ['AB', 'BA'],
        messageKey: 'scheduling.DEPENDENCY_CYCLE',
      },
    ]);
    expect(schedule([...tasks].reverse(), [...dependencies].reverse())).toEqual(
      result,
    );
  });

  it.each([
    [t('A'), t('A', 'P'), t('P')],
    [
      t('A', null, '2026-10-05', '2026-10-06'),
      t('A', 'P', null, '2026-10-09', 3),
      t('P'),
    ],
  ])(
    'fails closed for ambiguous task IDs in every permutation: %#',
    (first, second, parent) => {
      const tasks = Object.freeze(
        [first!, second!, parent!].map((task) => Object.freeze(task)),
      );
      const before = structuredClone(tasks);
      const expected: OptionalResult = {
        analysisStatus: 'pending-policy',
        feasibility: 'infeasible',
        coverage: { knownLeafCount: 0, totalLeafCount: 0 },
        tasks: {},
        summaries: {},
        display: {},
        criticalTaskIds: [],
        criticalDependencyIds: [],
        diagnostics: [
          {
            code: 'DUPLICATE_TASK_ID',
            taskIds: ['A'],
            dependencyIds: [],
            messageKey: 'scheduling.DUPLICATE_TASK_ID',
          },
        ],
      };
      for (const order of [
        [0, 1, 2],
        [0, 2, 1],
        [1, 0, 2],
        [1, 2, 0],
        [2, 0, 1],
        [2, 1, 0],
      ]) {
        const permuted = Object.freeze(order.map((index) => tasks[index]!));
        expect(schedule(permuted)).toEqual(expected);
        expect(JSON.stringify(schedule(permuted))).toBe(
          JSON.stringify(expected),
        );
      }
      expect(tasks).toEqual(before);
    },
  );

  it('keeps duplicate dependency IDs and pairs deterministic for different endpoints', () => {
    const graphTasks = Object.freeze(
      [t('A'), t('B'), t('C')].map((task) => Object.freeze(task)),
    );
    const dependencies = Object.freeze(
      [e('Same', 'A', 'B'), e('Same', 'B', 'C'), e('Z', 'A', 'B')].map((edge) =>
        Object.freeze(edge),
      ),
    );
    const before = structuredClone({ tasks: graphTasks, dependencies });
    const expected: OptionalResult = {
      analysisStatus: 'pending-policy',
      feasibility: 'infeasible',
      coverage: { knownLeafCount: 0, totalLeafCount: 3 },
      tasks: { A: unknown, B: unknown, C: unknown },
      summaries: {},
      display: {},
      criticalTaskIds: [],
      criticalDependencyIds: [],
      diagnostics: [
        {
          code: 'DUPLICATE_DEPENDENCY',
          taskIds: ['A', 'B'],
          dependencyIds: ['Same', 'Z'],
          messageKey: 'scheduling.DUPLICATE_DEPENDENCY',
        },
        {
          code: 'DUPLICATE_DEPENDENCY_ID',
          taskIds: ['B', 'C'],
          dependencyIds: ['Same'],
          messageKey: 'scheduling.DUPLICATE_DEPENDENCY_ID',
        },
      ],
    };
    for (const order of [
      [0, 1, 2],
      [0, 2, 1],
      [1, 0, 2],
      [1, 2, 0],
      [2, 0, 1],
      [2, 1, 0],
    ]) {
      const permuted = Object.freeze(
        order.map((index) => dependencies[index]!),
      );
      expect(schedule([...graphTasks].reverse(), permuted)).toEqual(expected);
      expect(JSON.stringify(schedule(graphTasks, permuted))).toBe(
        JSON.stringify(expected),
      );
    }
    expect({ tasks: graphTasks, dependencies }).toEqual(before);
  });

  it.each([
    [[t('A'), t('A')], [], 'DUPLICATE_TASK_ID'],
    [[t('A', 'Foreign')], [], 'INVALID_PARENT'],
    [[t('P', 'Q'), t('Q', 'P')], [], 'TREE_CYCLE'],
    [
      [t('A'), t('B'), t('C')],
      [e('Same', 'A', 'B'), e('Same', 'B', 'C')],
      'DUPLICATE_DEPENDENCY_ID',
    ],
  ] as const)(
    'safely reports malformed graph case %#',
    (invalidTasks, dependencies, code) => {
      const result = schedule(invalidTasks, dependencies);
      expect(result.feasibility).toBe('infeasible');
      expect(result.diagnostics.some((item) => item.code === code)).toBe(true);
    },
  );
});
