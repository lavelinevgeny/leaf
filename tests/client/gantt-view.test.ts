import { describe, expect, it } from 'vitest';
import {
  compactDateLabel,
  intervalOf,
  shiftDate,
  windowFor,
  todayInZone,
} from '../../src/client/gantt-view.js';
import {
  planForGesture,
  planOf,
  durationForFinish,
} from '../../src/client/planning-view.js';
import { computed, emptySchedule, project, task } from './fixtures.js';
describe('calendar presentation and explicit planning intents', () => {
  it('uses compact visible dates with full ISO dates retained by the accessibility label', () => {
    expect(
      compactDateLabel(
        task(1, { inputStart: '2026-10-09', inputFinish: '2026-10-12' }),
      ),
    ).toBe('9–12 окт.');
    expect(compactDateLabel(task(1, { inputFinish: '2026-10-09' }))).toBe(
      '9 окт.',
    );
    expect(
      compactDateLabel(
        task(1, { inputStart: '2026-09-30', inputFinish: '2026-10-02' }),
      ),
    ).toBe('30 сент. – 2 окт.');
    expect(
      compactDateLabel(
        task(1, { inputStart: '2026-12-31', inputFinish: '2027-01-01' }),
      ),
    ).toBe('31 дек. 2026 – 1 янв. 2027');
  });
  it('uses server dates for work, notes for unscheduled tasks, and no invented interval', () => {
    const a = task(1);
    expect(intervalOf(a, emptySchedule)).toBeNull();
    expect(
      intervalOf({ ...a, inputStart: '2026-10-09' }, emptySchedule),
    ).toEqual({ start: '2026-10-09', finish: null, kind: 'note' });
    expect(
      intervalOf(
        { ...a, planMode: 'auto' },
        { ...emptySchedule, tasks: { [a.id]: computed() } },
      ),
    ).toEqual({ start: '2026-10-09', finish: '2026-10-12', kind: 'work' });
    expect(
      intervalOf(a, {
        ...emptySchedule,
        summaries: {
          [a.id]: {
            start: 0,
            finish: 3,
            startDate: '2026-10-05',
            finishDate: '2026-10-07',
            partial: true,
            containsCritical: true,
          },
        },
      }),
    ).toEqual({ start: '2026-10-05', finish: '2026-10-07', kind: 'summary' });
  });
  it('handles civil days across DST, leap year, month/year and bounded scale windows', () => {
    expect(shiftDate('2026-03-28', 2)).toBe('2026-03-30');
    expect(shiftDate('2024-02-28', 1)).toBe('2024-02-29');
    expect(shiftDate('2026-12-31', 1)).toBe('2027-01-01');
    expect(shiftDate('0001-01-01', -5)).toBe('0001-01-01');
    for (const scale of ['days', 'weeks', 'months'] as const) {
      const view = windowFor('2026-10-05', scale);
      expect(view.days).toBeLessThanOrEqual(366);
      expect(view.width).toBe(view.days * view.dayWidth);
    }
    expect(todayInZone('Europe/Moscow', new Date('2026-10-06T22:00:00Z'))).toBe(
      '2026-10-07',
    );
    expect(
      todayInZone('America/New_York', new Date('2026-10-06T22:00:00Z')),
    ).toBe('2026-10-06');
  });
  it('moves Auto with notBefore and resizes in working days, preserving deadline', () => {
    const a = task(1, {
      planMode: 'auto',
      durationDays: 2,
      deadline: '2026-10-20',
    });
    expect(planOf(a)).toEqual({
      mode: 'auto',
      durationDays: 2,
      notBefore: null,
      deadline: '2026-10-20',
    });
    expect(
      planForGesture(a, computed(), project, 'move', '2026-10-12'),
    ).toEqual({
      mode: 'auto',
      durationDays: 2,
      notBefore: '2026-10-12',
      deadline: '2026-10-20',
    });
    expect(
      planForGesture(a, computed(), project, 'resize', '2026-10-13'),
    ).toMatchObject({ mode: 'auto', durationDays: 3 });
    expect(durationForFinish('2026-10-09', '2026-10-12', 'weekdays')).toBe(2);
    expect(() =>
      durationForFinish('2026-10-09', '2026-10-10', 'weekdays'),
    ).toThrow();
  });
  it('moves Fixed as a work interval, rejects weekend input and locks done/summary/unknown', () => {
    const a = task(1, {
      planMode: 'fixed',
      durationDays: 2,
      inputStart: '2026-10-09',
      inputFinish: '2026-10-12',
    });
    expect(
      planForGesture(a, computed(), project, 'move', '2026-10-12'),
    ).toMatchObject({
      mode: 'fixed',
      inputStart: '2026-10-12',
      inputFinish: '2026-10-13',
    });
    expect(() =>
      planForGesture(a, computed(), project, 'move', '2026-10-10'),
    ).toThrow();
    expect(() =>
      planForGesture(
        { ...a, status: 'done' },
        computed(),
        project,
        'move',
        '2026-10-12',
      ),
    ).toThrow();
    expect(() =>
      planForGesture(task(2), undefined, project, 'resize', '2026-10-12'),
    ).toThrow();
  });
});
