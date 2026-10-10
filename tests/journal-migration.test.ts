import Database from 'better-sqlite3';
import { createHash } from 'node:crypto';
import { readFileSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, it } from 'vitest';
import { openDatabase } from '../src/server/database.js';
const projectId = '11111111-1111-4111-8111-111111111111';
function schema3() {
  const dir = mkdtempSync(join(tmpdir(), 'leaf-journal-migration-synthetic-'));
  const path = join(dir, 'synthetic.sqlite');
  const db = new Database(path);
  db.exec('CREATE TABLE migrations(version INTEGER PRIMARY KEY) STRICT');
  for (const sql of [
    '001-initial.sql',
    '002-scheduling.sql',
    '003-optional-scheduling.sql',
  ])
    db.exec(readFileSync(`migrations/${sql}`, 'utf8'));
  db.exec('INSERT INTO migrations VALUES (1),(2),(3)');
  db.prepare(
    'INSERT INTO projects(id,title,revision,createdAt,updatedAt) VALUES (?,?,?,?,?)',
  ).run(
    projectId,
    'Synthetic historical',
    0,
    '2026-10-10T12:00:00.000Z',
    '2026-10-10T12:00:00.000Z',
  );
  db.prepare(
    'INSERT INTO undo_snapshots(projectId,sessionId,afterRevision,beforeSnapshot) VALUES (?,?,?,?)',
  ).run(
    projectId,
    'synthetic-session',
    1,
    '{ "historical": "exact snapshot bytes" }',
  );
  db.prepare(
    'INSERT INTO operations(operationId,projectId,sessionId,payload,response,responseSha256) VALUES (?,?,?,?,?,?)',
  ).run(
    'synthetic-operation',
    projectId,
    'synthetic-session',
    '{ "payload": 1 }',
    '{ "response": 2 }',
    'synthetic-digest',
  );
  const originalText = '{ "legacy": "synthetic exact bytes" }';
  db.prepare(
    'INSERT INTO scheduling_migration_archive VALUES (?,?,?,?,?,?)',
  ).run(
    projectId,
    'project',
    projectId,
    2,
    originalText,
    createHash('sha256').update(originalText).digest('hex'),
  );
  return { dir, path, db };
}
function history(db: Database.Database) {
  return ['operations', 'scheduling_migration_archive']
    .map((t) => db.prepare(`SELECT * FROM ${t}`).all())
    .concat([
      db
        .prepare(
          'SELECT sequence,projectId,sessionId,afterRevision,beforeSnapshot FROM undo_snapshots',
        )
        .all(),
    ]);
}
it('upgrades schema3 additively preserving historical byte strings and v0 then reopens without DDL', () => {
  const f = schema3();
  try {
    const before = history(f.db);
    f.db.close();
    let db = openDatabase(f.path);
    try {
      expect(history(db)).toEqual(before);
      expect(
        db.prepare('SELECT journalLifecycleVersion FROM undo_snapshots').all(),
      ).toEqual([{ journalLifecycleVersion: 0 }]);
      expect(db.prepare('SELECT * FROM journal_state').all()).toEqual([
        { projectId, revision: 0 },
      ]);
      expect(db.prepare('SELECT version FROM migrations').all()).toEqual([
        { version: 1 },
        { version: 2 },
        { version: 3 },
        { version: 4 },
      ]);
      const schema = db
        .prepare('SELECT type,name,sql FROM sqlite_schema ORDER BY name')
        .all();
      db.close();
      db = openDatabase(f.path);
      expect(
        db
          .prepare('SELECT type,name,sql FROM sqlite_schema ORDER BY name')
          .all(),
      ).toEqual(schema);
      expect(history(db)).toEqual(before);
    } finally {
      db.close();
    }
  } finally {
    f.db.close();
    rmSync(f.dir, { recursive: true, force: true });
  }
});
it('rolls all004 DDL and new lifecycle column back when version insertion fails', () => {
  const f = schema3();
  try {
    f.db.exec(
      "CREATE TRIGGER synthetic_abort BEFORE INSERT ON migrations WHEN NEW.version=4 BEGIN SELECT RAISE(ABORT,'Synthetic migration rollback'); END",
    );
    const before = history(f.db);
    const schema = f.db
      .prepare('SELECT type,name,sql FROM sqlite_schema ORDER BY name')
      .all();
    f.db.close();
    expect(() => openDatabase(f.path)).toThrow();
    const raw = new Database(f.path);
    try {
      expect(history(raw)).toEqual(before);
      expect(
        raw
          .prepare('SELECT type,name,sql FROM sqlite_schema ORDER BY name')
          .all(),
      ).toEqual(schema);
      expect(raw.prepare('SELECT * FROM migrations').all()).toEqual([
        { version: 1 },
        { version: 2 },
        { version: 3 },
      ]);
    } finally {
      raw.close();
    }
  } finally {
    f.db.close();
    rmSync(f.dir, { recursive: true, force: true });
  }
});
