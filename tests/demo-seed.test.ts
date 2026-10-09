import { afterEach, expect, it, vi } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openDatabase } from '../src/server/database.js';
import { Repository } from '../src/server/repository.js';
import { seedDemo } from '../src/server/demo-seed.js';
import {
  liveProjectTreeV2Schema,
  liveScheduleResponseV2Schema,
} from '../src/shared/contracts.js';
const directories: string[] = [];
afterEach(() => {
  vi.restoreAllMocks();
  for (const path of directories.splice(0))
    rmSync(path, { recursive: true, force: true });
});
function fixture() {
  const dir = mkdtempSync(join(tmpdir(), 'leaf-seed-test-'));
  directories.push(dir);
  const db = openDatabase(join(dir, 'synthetic.sqlite'));
  return { db, repository: new Repository(db) };
}
it.each([
  [
    '2026-10-09T23:59:59Z',
    ['2026-10-09', '2026-10-12', '2026-10-13', '2026-10-15', '2026-10-16'],
  ],
  [
    '2026-10-10T00:00:00Z',
    ['2026-10-12', '2026-10-13', '2026-10-14', '2026-10-16', '2026-10-19'],
  ],
  [
    '2026-12-31T23:59:59Z',
    ['2026-12-31', '2027-01-01', '2027-01-04', '2027-01-06', '2027-01-07'],
  ],
])('seeds a truthful partial analysis from UTC clock %s', (clock, dates) => {
  const { db, repository } = fixture();
  try {
    seedDemo(db, repository, () => Date.parse(clock));
    const projects = repository.listProjects();
    expect(projects).toHaveLength(1);
    expect(projects[0]).toMatchObject({
      title: 'Демо-проект',
      timezone: 'UTC',
      calendarType: 'weekdays',
    });
    const tree = liveProjectTreeV2Schema.parse(
      repository.getTree(projects[0]!.id, 'synthetic-viewer'),
    );
    expect(tree.canUndo).toBe(false);
    expect(tree.tasks).toHaveLength(10);
    const task = (title: string) => tree.tasks.find((t) => t.title === title)!;
    expect(task('План работ')).toMatchObject({
      parentId: task('Подготовка').id,
      inputStart: dates[0],
      inputFinish: dates[1],
      durationDays: 2,
    });
    expect(task('Подготовка').parentId).toBe(task('Запуск примера').id);
    expect(task('Реализация')).toMatchObject({
      inputStart: dates[2],
      inputFinish: dates[3],
      durationDays: 3,
    });
    expect(task('Проверка')).toMatchObject({
      inputStart: dates[4],
      inputFinish: dates[4],
      durationDays: 1,
    });
    expect(task('Исследовать вариант')).toMatchObject({
      inputStart: null,
      inputFinish: null,
      durationDays: 2,
    });
    expect(task('Обсудить результат')).toMatchObject({
      inputStart: null,
      inputFinish: null,
      durationDays: null,
    });
    expect(task('Уточнить начало')).toMatchObject({
      inputStart: dates[0],
      inputFinish: null,
      durationDays: null,
    });
    expect(task('Уточнить окончание')).toMatchObject({
      inputStart: null,
      inputFinish: dates[3],
      durationDays: null,
    });
    expect(
      tree.dependencies.map((d) => [
        tree.tasks.find((t) => t.id === d.predecessorId)!.title,
        tree.tasks.find((t) => t.id === d.successorId)!.title,
      ]),
    ).toEqual(
      expect.arrayContaining([
        ['План работ', 'Реализация'],
        ['Реализация', 'Проверка'],
        ['Исследовать вариант', 'Обсудить результат'],
      ]),
    );
    const schedule = liveScheduleResponseV2Schema.parse(
      repository.getSchedule(projects[0]!.id),
    );
    expect(schedule.schedule.analysisStatus).toBe('incomplete');
    expect(schedule.schedule.criticalTaskIds).toEqual([]);
    expect(schedule.schedule.partialAnalysis).toMatchObject({
      labelKey: 'scheduling.PARTIAL_ANALYSIS',
      coverage: { analyzedLeafCount: 3, blockedLeafCount: 4 },
    });
    expect(
      new Set(schedule.schedule.partialAnalysis!.partialCriticalTaskIds),
    ).toEqual(
      new Set([
        task('План работ').id,
        task('Реализация').id,
        task('Проверка').id,
      ]),
    );
    expect(
      schedule.schedule.partialAnalysis!.partialCriticalDependencyIds,
    ).toHaveLength(2);

    expect(db.prepare('SELECT COUNT(*) AS n FROM operations').get()).toEqual({
      n: 0,
    });
    expect(
      db.prepare('SELECT COUNT(*) AS n FROM undo_snapshots').get(),
    ).toEqual({ n: 0 });
  } finally {
    db.close();
  }
});
it('rolls back project, tasks, edges and history if a command fails', () => {
  const { db, repository } = fixture();
  try {
    const apply = repository.applyCommand.bind(repository);
    let calls = 0;
    vi.spyOn(repository, 'applyCommand').mockImplementation((...args) => {
      if (++calls === 5) throw new Error('Synthetic seed failure');
      return apply(...args);
    });
    expect(() =>
      seedDemo(db, repository, () => Date.parse('2026-10-09T00:00:00Z')),
    ).toThrow();
    for (const table of [
      'projects',
      'tasks',
      'dependencies',
      'operations',
      'undo_snapshots',
    ])
      expect(db.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get()).toEqual({
        n: 0,
      });
  } finally {
    db.close();
  }
});
