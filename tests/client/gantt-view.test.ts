import { validateStartResize } from '../../src/client/planning-view.js';
import { expect, it } from 'vitest';
import {
  ganttInterval,
  ganttIntervals,
  sourceMarkers,
  computedDateLabel,
  compactDateLabel,
  shiftDate,
  windowFor,
  todayInZone,
} from '../../src/client/gantt-view.js';
import { gesturePatch, sourceOf } from '../../src/client/planning-view.js';
import { optionalTreeFixture, optionalIds, task } from './fixtures.js';
import { calculateSchedule } from '../../src/domain/scheduling.js';
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

it('C25 rebuilds full-graph geometry from source rather than shifted cached displays', () => {
  const tree = optionalTreeFixture();
  tree.dependencies = [
    {
      id: 'AB',
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
  // A retained shifted display must not become the group's input anchor.
  tree.schedule.display[optionalIds.c]!.startDate = '2026-10-20';
  tree.schedule.display[optionalIds.c]!.finishDate = '2026-10-22';
  const before = structuredClone(tree);
  expect(ganttIntervals(tree, '2026-10-08').get(optionalIds.c)).toEqual({
    start: '2026-10-07',
    finish: '2026-10-09',
    kind: 'conditional',
    clipped: false,
  });
  expect(tree).toEqual(before);
});
it('C25 root-chain client geometry follows today in both directions while server stays timeless', () => {
  const tree = optionalTreeFixture();
  tree.tasks = [task(1), task(2), task(3)];
  tree.dependencies = [
    {
      id: 'AB',
      projectId: tree.project.id,
      predecessorId: tree.tasks[0]!.id,
      successorId: tree.tasks[1]!.id,
    },
    {
      id: 'BC',
      projectId: tree.project.id,
      predecessorId: tree.tasks[1]!.id,
      successorId: tree.tasks[2]!.id,
    },
  ];
  tree.schedule = calculateSchedule({
    tasks: tree.tasks,
    dependencies: tree.dependencies,
    calendarType: 'weekdays',
  });
  expect(tree.schedule.display).toEqual({});
  expect(ganttIntervals(tree, '2026-10-09').get(tree.tasks[2]!.id)?.start).toBe(
    '2026-10-13',
  );
  expect(ganttIntervals(tree, '2026-10-08').get(tree.tasks[2]!.id)?.start).toBe(
    '2026-10-12',
  );
  expect(
    tree.tasks.every((t) => t.inputStart === null && t.inputFinish === null),
  ).toBe(true);
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

it('shows a no-anchor root today without changing real labels or the schedule', () => {
  const tree = optionalTreeFixture();
  const root = task(4);
  const before = structuredClone(tree);
  expect(
    ganttInterval(root, tree.schedule, {
      today: '2026-10-08',
      calendar: 'weekdays',
    }),
  ).toEqual({
    start: '2026-10-08',
    finish: '2026-10-08',
    kind: 'conditional',
    clipped: false,
  });
  expect(computedDateLabel(root, tree.schedule)).toBe('');
  expect(
    ganttInterval(tree.tasks[0]!, tree.schedule, {
      today: '2026-10-08',
      calendar: 'weekdays',
    }),
  ).toBeNull();
  expect(tree).toEqual(before);
});

it('validates left intent without mutating nullable source or accepting range/weekend/reverse/overflow', () => {
  const a = optionalTreeFixture().tasks[1]!;
  const before = structuredClone(a);
  expect(() => validateStartResize(a, 'weekdays', '2026-10-02')).not.toThrow();
  expect(() => validateStartResize(a, 'weekdays', '2026-10-06')).not.toThrow();
  for (const target of ['2026-10-03', '2026-10-07', '0000-01-01', '2026-02-30'])
    expect(() => validateStartResize(a, 'weekdays', target)).toThrow();
  expect(() =>
    validateStartResize(
      { ...a, inputStart: '9999-12-31', inputFinish: '9999-12-31' },
      'all-days',
      '0001-01-01',
    ),
  ).toThrow('DURATION_RANGE_EXCEEDED');
  expect(a).toEqual(before);
});
