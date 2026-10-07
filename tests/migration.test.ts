import Database from 'better-sqlite3';
import { afterEach, describe, expect, it } from 'vitest';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { openDatabase } from '../src/server/database.js';
import { Repository } from '../src/server/repository.js';

const directories: string[] = [];
afterEach(() => {
  for (const directory of directories.splice(0))
    rmSync(directory, { recursive: true, force: true });
});
function legacy() {
  const directory = mkdtempSync(join(tmpdir(), 'leaf-migration-synthetic-'));
  directories.push(directory);
  const path = join(directory, 'synthetic.sqlite');
  const db = new Database(path);
  db.exec('CREATE TABLE migrations (version INTEGER PRIMARY KEY) STRICT');
  db.exec(readFileSync('migrations/001-initial.sql', 'utf8'));
  db.prepare('INSERT INTO migrations VALUES (1)').run();
  const projectId = randomUUID();
  const taskId = randomUUID();
  db.prepare('INSERT INTO projects VALUES (?, ?, 7, ?, ?)').run(
    projectId,
    'Synthetic legacy project',
    '2026-10-07T00:00:00.000Z',
    '2026-10-07T00:00:00.000Z',
  );
  db.prepare(
    'INSERT INTO tasks VALUES (?, ?, NULL, ?, ?, 0, ?, ?, ?, ?, ?)',
  ).run(
    taskId,
    projectId,
    'Synthetic legacy task',
    'Synthetic description',
    'doing',
    '2026-10-07',
    '2026-10-08',
    '2026-10-07T00:00:00.000Z',
    '2026-10-07T00:00:00.000Z',
  );
  db.prepare('INSERT INTO account VALUES (1, ?)').run(
    'synthetic-placeholder-only',
  );
  db.prepare('INSERT INTO sessions VALUES (?, ?)').run(
    'synthetic-session',
    2000000000000,
  );
  db.prepare('INSERT INTO operations VALUES (?, ?, ?, ?, ?)').run(
    randomUUID(),
    projectId,
    'synthetic-session',
    '{}',
    '{}',
  );
  db.prepare(
    'INSERT INTO undo_snapshots(projectId,sessionId,afterRevision,beforeSnapshot) VALUES (?, ?, 7, ?)',
  ).run(projectId, 'synthetic-session', '{}');
  return { path, db, projectId, taskId };
}
describe('scheduling schema migration', () => {
  it('migrates synthetic S1 data without assigning scheduling modes or changing auth', () => {
    const fixture = legacy();
    fixture.db.close();
    const db = openDatabase(fixture.path);
    try {
      expect(
        db.prepare('SELECT version FROM migrations ORDER BY version').all(),
      ).toEqual([{ version: 1 }, { version: 2 }]);
      expect(db.prepare('SELECT * FROM account').get()).toEqual({
        id: 1,
        passwordHash: 'synthetic-placeholder-only',
      });
      expect(db.prepare('SELECT * FROM sessions').get()).toEqual({
        id: 'synthetic-session',
        expiresAt: 2000000000000,
      });
      const tree = new Repository(db).getTree(
        fixture.projectId,
        'synthetic-session',
      );
      expect(tree.project).toMatchObject({
        id: fixture.projectId,
        revision: 7,
        startDate: null,
        calendarType: 'weekdays',
        timezone: 'UTC',
      });
      expect(tree.tasks[0]).toMatchObject({
        id: fixture.taskId,
        title: 'Synthetic legacy task',
        status: 'doing',
        inputStart: '2026-10-07',
        inputFinish: '2026-10-08',
        planMode: 'unscheduled',
        durationDays: null,
      });
      expect(tree.schedule.tasks[fixture.taskId]!.ES).toBeNull();
      expect(tree.dependencies).toEqual([]);
      expect(tree.canUndo).toBe(false);
      expect(
        db.prepare('SELECT COUNT(*) AS count FROM operations').get(),
      ).toEqual({ count: 0 });
    } finally {
      db.close();
    }
    const reopened = openDatabase(fixture.path);
    try {
      expect(
        reopened.prepare('SELECT COUNT(*) AS count FROM migrations').get(),
      ).toEqual({ count: 2 });
    } finally {
      reopened.close();
    }
  });
  it('rolls back migration DDL and old command-history cleanup when version insertion fails', () => {
    const fixture = legacy();
    fixture.db.exec(
      "CREATE TRIGGER synthetic_migration_failure BEFORE INSERT ON migrations WHEN NEW.version=2 BEGIN SELECT RAISE(ABORT, 'Synthetic migration failure'); END",
    );
    fixture.db.close();
    expect(() => openDatabase(fixture.path)).toThrow();
    const db = new Database(fixture.path);
    try {
      expect(db.prepare('SELECT version FROM migrations').all()).toEqual([
        { version: 1 },
      ]);
      const columns = db.pragma('table_info(projects)') as { name: string }[];
      expect(columns.some((column) => column.name === 'calendarType')).toBe(
        false,
      );
      expect(
        db.prepare('SELECT COUNT(*) AS count FROM operations').get(),
      ).toEqual({ count: 1 });
      expect(
        db.prepare('SELECT COUNT(*) AS count FROM undo_snapshots').get(),
      ).toEqual({ count: 1 });
    } finally {
      db.close();
    }
  });
  it('fails closed when the synthetic database has a newer schema', () => {
    const fixture = legacy();
    fixture.db.prepare('INSERT INTO migrations VALUES (3)').run();
    fixture.db.close();
    expect(() => openDatabase(fixture.path)).toThrowError(/schema/);
  });
});
