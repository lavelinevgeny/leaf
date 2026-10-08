import { describe, expect, it } from 'vitest';
import { conditionalDisplay } from '../src/domain/conditional-display.js';
import type { SourceFields } from '../src/shared/contracts.js';
import {
  calculateSchedule,
  projectExplicitSchedule,
} from '../src/domain/scheduling.js';
import { leaf, edge } from './helpers/explicit-cpm-fixtures.js';
import type { OptionalInput } from '../src/domain/scheduling-types.js';

const empty: SourceFields = {
  inputStart: null,
  inputFinish: null,
  durationDays: null,
};
describe('C19 literal conditional geometry', () => {
  it.each([
    [{}, null, '2026-10-08', 'weekdays', '2026-10-08', '2026-10-08', false],
    [
      { durationDays: 3 },
      null,
      '2026-10-08',
      'weekdays',
      '2026-10-08',
      '2026-10-12',
      false,
    ],
    [
      { durationDays: 3 },
      null,
      '2026-10-08',
      'all-days',
      '2026-10-08',
      '2026-10-10',
      false,
    ],
    [
      { durationDays: 2 },
      '2026-10-05',
      '2026-10-08',
      'weekdays',
      '2026-10-05',
      '2026-10-06',
      false,
    ],
    [
      { inputStart: '2026-10-09' },
      '2026-10-05',
      '2026-10-08',
      'weekdays',
      '2026-10-09',
      '2026-10-09',
      false,
    ],
    [
      { inputStart: '2026-10-09', durationDays: 2 },
      '2026-10-05',
      null,
      'weekdays',
      '2026-10-09',
      '2026-10-12',
      false,
    ],
    [
      { inputFinish: '2026-10-12', durationDays: 2 },
      '2026-10-05',
      '2026-10-08',
      'weekdays',
      '2026-10-09',
      '2026-10-12',
      false,
    ],
    [
      { inputFinish: '2026-10-12', durationDays: 2 },
      null,
      null,
      'all-days',
      '2026-10-11',
      '2026-10-12',
      false,
    ],
    [
      { inputFinish: '2026-10-02' },
      '2026-10-09',
      null,
      'weekdays',
      '2026-10-02',
      '2026-10-02',
      false,
    ],
    [
      { inputStart: '2026-10-10', durationDays: 2 },
      null,
      null,
      'weekdays',
      '2026-10-10',
      '2026-10-12',
      false,
    ],
    [
      { inputFinish: '2026-10-10', durationDays: 2 },
      null,
      null,
      'weekdays',
      '2026-10-09',
      '2026-10-10',
      false,
    ],
    [
      { inputFinish: '2024-03-01', durationDays: 2 },
      null,
      null,
      'all-days',
      '2024-02-29',
      '2024-03-01',
      false,
    ],
    [
      { inputStart: '9999-12-31', durationDays: 2 },
      null,
      null,
      'weekdays',
      '9999-12-31',
      '9999-12-31',
      true,
    ],
    [
      { inputFinish: '0001-01-01', durationDays: 2 },
      null,
      null,
      'weekdays',
      '0001-01-01',
      '0001-01-01',
      true,
    ],
  ] as const)(
    'projects %j from %s / %s using %s',
    (patch, group, today, calendar, startDate, finishDate, clipped) => {
      const source = Object.freeze({ ...empty, ...patch });
      expect(conditionalDisplay(source, group, today, calendar)).toEqual({
        kind: 'conditional',
        startDate,
        finishDate,
        clipped,
      });
      expect(source).toEqual({ ...empty, ...patch });
    },
  );
  it.each([
    { inputStart: '2026-10-05', inputFinish: '2026-10-06' },
    { inputStart: '2026-10-07', inputFinish: '2026-10-06' },
    { inputStart: '2026-02-30' },
    { inputFinish: 'invalid' },
    { durationDays: 0 },
    { durationDays: 1.5 },
    { durationDays: Number.MAX_SAFE_INTEGER + 1 },
  ])(
    'does not invent a conditional interval for complete/invalid source %j',
    (patch) => {
      expect(
        conditionalDisplay(
          { ...empty, ...patch },
          '2026-10-05',
          '2026-10-08',
          'weekdays',
        ),
      ).toBeNull();
    },
  );
  it('leaves no-anchor server output empty while client today changes without source mutation', () => {
    expect(conditionalDisplay(empty, null, null, 'weekdays')).toBeNull();
    expect(
      conditionalDisplay(empty, null, '2026-10-08', 'weekdays')?.startDate,
    ).toBe('2026-10-08');
    expect(
      conditionalDisplay(empty, null, '2026-10-09', 'weekdays')?.startDate,
    ).toBe('2026-10-09');
  });
  it('clips a preserved duration above the current input limit without discarding it', () => {
    expect(
      conditionalDisplay(
        { ...empty, durationDays: 4000000 },
        null,
        '2026-10-08',
        'weekdays',
      ),
    ).toEqual({
      kind: 'conditional',
      startDate: '2026-10-08',
      finishDate: '9999-12-31',
      clipped: true,
    });
  });
});

describe('C25 dependency-aware conditional placement', () => {
  const project = (
    tasks: OptionalInput['tasks'],
    dependencies: OptionalInput['dependencies'],
  ): OptionalInput => ({ tasks, dependencies, calendarType: 'weekdays' });
  const dates = (input: OptionalInput, today: string | null = null) =>
    Object.fromEntries(
      Object.entries(projectExplicitSchedule(input, today).display).map(
        ([id, display]) => [
          id,
          [display.startDate, display.finishDate, display.clipped],
        ],
      ),
    );
  it('L04 real finish anchors an undated successor without today or persisted dates', () => {
    const input = project(
      [leaf('A', '2026-10-09', '2026-10-09'), leaf('B', null, null, 2)],
      [edge('AB', 'A', 'B')],
    );
    const before = structuredClone(input);
    expect(dates(input)).toEqual({ B: ['2026-10-12', '2026-10-13', false] });
    const schedule = calculateSchedule(input);
    expect(schedule.tasks.B?.startDate).toBeNull();
    expect(schedule.coverage.knownLeafCount).toBe(1);
    expect(schedule.criticalTaskIds).toEqual([]);
    expect(schedule.diagnostics.map((d) => d.code)).toContain(
      'UNKNOWN_PRECEDENCE',
    );
    expect(input).toEqual(before);
  });
  it('L05 full undated chain tracks today forward and backward independently of input order', () => {
    const input = project(
      [leaf('C', null, null), leaf('B', null, null), leaf('A', null, null)],
      [edge('BC', 'B', 'C'), edge('AB', 'A', 'B')],
    );
    expect(dates(input)).toEqual({});
    expect(dates(input, '2026-10-09')).toEqual({
      A: ['2026-10-09', '2026-10-09', false],
      B: ['2026-10-12', '2026-10-12', false],
      C: ['2026-10-13', '2026-10-13', false],
    });
    expect(dates(input, '2026-10-08')).toEqual({
      A: ['2026-10-08', '2026-10-08', false],
      B: ['2026-10-09', '2026-10-09', false],
      C: ['2026-10-12', '2026-10-12', false],
    });
  });
  it('L06 diamond joins once after the longest conditional branch', () => {
    const input = project(
      [
        leaf('A', null, '2026-10-09'),
        leaf('B', null, null, 2),
        leaf('C', null, null),
        leaf('D', null, null),
      ],
      [
        edge('AB', 'A', 'B'),
        edge('AC', 'A', 'C'),
        edge('BD', 'B', 'D'),
        edge('CD', 'C', 'D'),
      ],
    );
    expect(dates(input)).toEqual({
      A: ['2026-10-09', '2026-10-09', false],
      B: ['2026-10-12', '2026-10-13', false],
      C: ['2026-10-12', '2026-10-12', false],
      D: ['2026-10-14', '2026-10-14', false],
    });
  });
  it('keeps later group/today anchors and never derives group minima from shifted displays', () => {
    const input = project(
      [
        leaf('P', null, null),
        leaf('S', '2026-10-05', '2026-10-05', null, 'todo', 'P'),
        leaf('B', null, null, 1, 'todo', 'P'),
        leaf('C', null, null, 1, 'todo', 'P'),
        leaf('A', null, '2026-10-09'),
      ],
      [edge('AB', 'A', 'B')],
    );
    expect(dates(input, '2026-10-20')).toEqual({
      A: ['2026-10-09', '2026-10-09', false],
      B: ['2026-10-12', '2026-10-12', false],
      C: ['2026-10-05', '2026-10-05', false],
    });
    const roots = project(
      [leaf('A', null, '2026-10-09'), leaf('B', null, null)],
      [edge('AB', 'A', 'B')],
    );
    expect(dates(roots, '2026-10-20').B).toEqual([
      '2026-10-20',
      '2026-10-20',
      false,
    ]);
  });
  it('L07 own start/finish and real pairs keep their source positions', () => {
    const input = project(
      [
        leaf('A', null, '2026-10-09'),
        leaf('B', '2026-10-08', null, 2),
        leaf('C', null, '2026-10-08'),
        leaf('D', '2026-10-08', '2026-10-09'),
      ],
      [edge('AB', 'A', 'B'), edge('AC', 'A', 'C'), edge('AD', 'A', 'D')],
    );
    const result = projectExplicitSchedule(input, '2026-10-08');
    expect(dates(input, '2026-10-08')).toEqual({
      A: ['2026-10-09', '2026-10-09', false],
      B: ['2026-10-08', '2026-10-09', false],
      C: ['2026-10-08', '2026-10-08', false],
    });
    expect(result.tasks.D?.startDate).toBe('2026-10-08');
    expect(result.feasibility).toBe('infeasible');
  });
  it.each(['invalid', 'unavailable'] as const)(
    'does not derive display bounds from %s full pair',
    (kind) => {
      const input = {
        ...project(
          [
            leaf(
              'A',
              '2026-10-09',
              '2026-10-12',
              kind === 'invalid' ? 3 : null,
            ),
            leaf('B', null, null),
          ],
          [edge('AB', 'A', 'B')],
        ),
        unavailableTaskIds: kind === 'unavailable' ? ['A'] : [],
      };
      expect(dates(input)).toEqual({});
      expect(dates(input, '2026-10-08')).toEqual({
        B: ['2026-10-08', '2026-10-08', false],
      });
    },
  );
  it('L09 marks overflow and its successors clipped without source writes', () => {
    const input = {
      ...project(
        [
          leaf('A', null, '9999-12-31'),
          leaf('B', null, null, 3),
          leaf('C', null, null),
        ],
        [edge('AB', 'A', 'B'), edge('BC', 'B', 'C')],
      ),
      calendarType: 'all-days' as const,
    };
    expect(dates(input)).toEqual({
      A: ['9999-12-31', '9999-12-31', false],
      B: ['9999-12-31', '9999-12-31', true],
      C: ['9999-12-31', '9999-12-31', true],
    });
    expect(input.tasks[1]?.inputStart).toBeNull();
    expect(input.tasks[1]?.durationDays).toBe(3);
  });
  it('does not traverse cyclic or summary edges as a conditional plan', () => {
    expect(
      dates(
        project(
          [leaf('A', null, null), leaf('B', null, null)],
          [edge('AB', 'A', 'B'), edge('BA', 'B', 'A')],
        ),
        '2026-10-08',
      ),
    ).toEqual({});
    expect(
      dates(
        project(
          [
            leaf('P', null, null),
            leaf('A', null, null, null, 'todo', 'P'),
            leaf('B', null, null),
          ],
          [edge('PB', 'P', 'B')],
        ),
        '2026-10-08',
      ),
    ).toEqual({});
  });
  it('handles a deep DAG iteratively', () => {
    const count = 12000;
    const input = {
      tasks: Array.from({ length: count }, (_, i) =>
        leaf(String(i), null, null),
      ),
      dependencies: Array.from({ length: count - 1 }, (_, i) =>
        edge(String(i), String(i), String(i + 1)),
      ),
      calendarType: 'all-days' as const,
    };
    expect(dates(input, '0001-01-01')[String(count - 1)]).toEqual([
      '0033-11-08',
      '0033-11-08',
      false,
    ]);
  });
});
