import { expect, it } from 'vitest';
import {
  ganttInterval,
  sourceMarkers,
  computedDateLabel,
  compactDateLabel,
  shiftDate,
  windowFor,
  todayInZone,
} from '../../src/client/gantt-view.js';
import { gesturePatch, sourceOf } from '../../src/client/planning-view.js';
import { optionalTreeFixture, optionalIds, task } from './fixtures.js';
it('keeps display and original marker dates independent', () => {
  const tree = optionalTreeFixture();
  const c = tree.tasks[2]!;
  c.inputFinish = '2026-10-02';
  expect(ganttInterval(c, tree.schedule)).toEqual({
    start: '2026-10-05',
    finish: '2026-10-07',
    kind: 'conditional',
    clipped: false,
  });
  expect(sourceMarkers(c, tree.schedule)).toEqual([
    { taskId: c.id, kind: 'source-finish', date: '2026-10-02' },
  ]);
  expect(computedDateLabel(c, tree.schedule)).toBe('Окончание: 2026-10-02');
  expect(compactDateLabel(c, tree.schedule)).toBe('2 окт.');
  expect(ganttInterval(tree.tasks[0]!, tree.schedule)).toBeNull();
  expect(computedDateLabel(tree.tasks[0]!, tree.schedule)).toBe('');
  expect(sourceMarkers(tree.tasks[1]!, tree.schedule)).toEqual([]);
  expect(tree.schedule.tasks[optionalIds.c]!.startDate).toBeNull();
});
it('moves an explicit interval equally and requires an explicit resize duration choice', () => {
  const a = task(1, { inputStart: '2026-10-09', inputFinish: '2026-10-12' });
  expect(gesturePatch(a, 'weekdays', 'move', '2026-10-12')).toEqual({
    patch: { inputStart: '2026-10-12', inputFinish: '2026-10-13' },
    requiresDurationChoice: false,
  });
  expect(sourceOf(a).durationDays).toBeNull();
  expect(
    gesturePatch({ ...a, durationDays: 2 }, 'weekdays', 'resize', '2026-10-13'),
  ).toEqual({
    patch: { inputFinish: '2026-10-13' },
    requiresDurationChoice: true,
  });
  expect(() =>
    gesturePatch({ ...a, status: 'done' }, 'weekdays', 'move', '2026-10-12'),
  ).toThrow('LOCKED_PLAN');
  expect(() =>
    gesturePatch({ ...a, inputFinish: null }, 'weekdays', 'move', '2026-10-12'),
  ).toThrow('LOCKED_PLAN');
});
it('uses civil days, bounded scale windows and project timezone for Today', () => {
  expect(shiftDate('2026-03-28', 2)).toBe('2026-03-30');
  expect(shiftDate('2024-02-28', 1)).toBe('2024-02-29');
  expect(windowFor('9999-12-31', 'months').days).toBe(1);
  expect(todayInZone('UTC', new Date('2026-10-07T23:30:00Z'))).toBe(
    '2026-10-07',
  );
  expect(
    compactDateLabel(
      task(1, { inputStart: '2026-12-31', inputFinish: '2027-01-01' }),
    ),
  ).toBe('31 дек. 2026 – 1 янв. 2027');
});

it('retained unavailable source pair stays labelled as source rather than a computed interval', () => {
  const tree = optionalTreeFixture();
  const a = tree.tasks[1]!;
  tree.schedule.tasks[a.id] = {
    startDate: null,
    finishDate: null,
    calendarSpanDays: null,
  };
  expect(computedDateLabel(a, tree.schedule)).toBe(
    'Исходное начало: 2026-10-05; исходное окончание: 2026-10-06',
  );
  expect(ganttInterval(a, tree.schedule)).toBeNull();
  expect(sourceMarkers(a, tree.schedule)).toHaveLength(2);
});
