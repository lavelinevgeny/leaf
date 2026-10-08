import { describe, expect, it } from 'vitest';
import { conditionalDisplay } from '../src/domain/conditional-display.js';
import type { SourceFields } from '../src/shared/contracts.js';

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
