import Database from 'better-sqlite3';
import { readFileSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, it } from 'vitest';
import { openDatabase } from '../src/server/database.js';
const projectId = '11111111-1111-4111-8111-111111111111';
const taskId = '22222222-2222-4222-8222-222222222222';
function fixture() {
  const dir = mkdtempSync(join(tmpdir(), 'leaf-media-migration-synthetic-'));
  const path = join(dir, 'synthetic.sqlite');
  const db = new Database(path);
  db.exec('CREATE TABLE migrations(version INTEGER PRIMARY KEY) STRICT');
  for (const [i, file] of [
    '001-initial.sql',
    '002-scheduling.sql',
    '003-optional-scheduling.sql',
    '004-task-journal.sql',
  ].entries()) {
    db.exec(readFileSync(`migrations/${file}`, 'utf8'));
    db.prepare('INSERT INTO migrations VALUES (?)').run(i + 1);
  }
  db.prepare(
    'INSERT INTO projects(id,title,revision,createdAt,updatedAt) VALUES (?, ?,7,?,?)',
  ).run(
    projectId,
    'Synthetic',
    '2026-11-14T12:00:00.000Z',
    '2026-11-14T12:00:00.000Z',
  );
  db.prepare(
    "INSERT INTO tasks(id,projectId,parentId,title,description,sortOrder,status,inputStart,inputFinish,createdAt,updatedAt) VALUES (?,?,NULL,'Synthetic','',0,'todo',NULL,NULL,'2026-11-14T12:00:00.000Z','2026-11-14T12:00:00.000Z')",
  ).run(taskId, projectId);
  db.prepare('UPDATE journal_state SET revision=9 WHERE projectId=?').run(
    projectId,
  );
  db.prepare(
    "INSERT INTO undo_snapshots(sequence,projectId,sessionId,afterRevision,beforeSnapshot,journalLifecycleVersion) VALUES (1,?,'synthetic',7,?,1),(80,?,'synthetic',8,'{}',0)",
  ).run(projectId, ' { "exact": "snapshot" } ', projectId);
  db.exec('DELETE FROM undo_snapshots WHERE sequence=80');
  const body = ' <img> **literal**\r\n\0 exact ';
  db.prepare(
    "INSERT INTO journal_entries VALUES ('entry',?,?,'2026-11-14',?,'created','updated')",
  ).run(projectId, taskId, body);
  db.prepare(
    "INSERT INTO undo_journal_entries VALUES (1,'old-entry',?,?,'2026-11-13',?,'before','after')",
  ).run(projectId, taskId, body);
  db.exec("INSERT INTO undo_journal_manifest VALUES (1,1,'exact-manifest')");
  db.prepare(
    "INSERT INTO journal_operations VALUES ('operation',?,'synthetic',?,?,?,1)",
  ).run(
    projectId,
    ' { "exact": "payload" } ',
    ' { "exact": "response" } ',
    'exact-sha',
  );
  return { dir, path, db };
}
function history(db: Database.Database) {
  return ['journal_state', 'journal_operations']
    .map((table) => db.prepare(`SELECT * FROM ${table}`).all())
    .concat([
      db
        .prepare(
          'SELECT undoSequence,entryCount,entriesSha256 FROM undo_journal_manifest',
        )
        .all(),
      db
        .prepare(
          'SELECT sequence,projectId,sessionId,afterRevision,beforeSnapshot,journalLifecycleVersion FROM undo_snapshots',
        )
        .all(),
      db
        .prepare(
          'SELECT id,projectId,taskId,workDate,body,createdAt,updatedAt FROM journal_entries',
        )
        .all(),
      db
        .prepare(
          'SELECT undoSequence,id,projectId,taskId,workDate,body,createdAt,updatedAt FROM undo_journal_entries',
        )
        .all(),
    ]);
}
it('upgrades exact historical bytes/sidecars and sequence watermark, activates schema6 and reopens without DDL', () => {
  const f = fixture();
  try {
    const before = history(f.db);
    f.db.close();
    let db = openDatabase(f.path);
    try {
      expect(
        db.prepare('SELECT MAX(version) AS version FROM migrations').get(),
      ).toEqual({ version: 6 });
      expect(history(db)).toEqual(before);
      expect(
        db.prepare('SELECT contentJson FROM journal_entries').all(),
      ).toEqual([{ contentJson: null }]);
      expect(
        db.prepare('SELECT contentJson FROM undo_journal_entries').all(),
      ).toEqual([{ contentJson: null }]);
      expect(
        db
          .prepare(
            "SELECT seq FROM sqlite_sequence WHERE name='undo_snapshots'",
          )
          .get(),
      ).toEqual({ seq: 80 });
      expect(db.pragma('foreign_keys', { simple: true })).toBe(1);
      expect(db.pragma('foreign_key_check')).toEqual([]);
      db.prepare(
        "INSERT INTO undo_snapshots(projectId,sessionId,afterRevision,beforeSnapshot,journalLifecycleVersion) VALUES (?,'synthetic',8,'{}',2)",
      ).run(projectId);
      expect(
        db
          .prepare('SELECT MAX(sequence) AS sequence FROM undo_snapshots')
          .get(),
      ).toEqual({ sequence: 81 });
      db.prepare(
        "INSERT INTO journal_operations VALUES ('v2',?,'synthetic','{}','{}','digest',2)",
      ).run(projectId);
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
    } finally {
      db.close();
    }
  } finally {
    f.db.close();
    rmSync(f.dir, { recursive: true, force: true });
  }
});
it('rolls migration005 rebuild and sequence back on synthetic failure', () => {
  const f = fixture();
  try {
    f.db.exec(
      "CREATE TRIGGER synthetic_abort BEFORE INSERT ON migrations WHEN NEW.version=5 BEGIN SELECT RAISE(ABORT,'Synthetic rollback'); END",
    );
    const before = history(f.db);
    const schema = f.db
      .prepare('SELECT type,name,sql FROM sqlite_schema ORDER BY name')
      .all();
    f.db.close();
    expect(() => openDatabase(f.path)).toThrow();
    const db = new Database(f.path);
    try {
      expect(history(db)).toEqual(before);
      expect(
        db
          .prepare('SELECT type,name,sql FROM sqlite_schema ORDER BY name')
          .all(),
      ).toEqual(schema);
      expect(
        db
          .prepare(
            "SELECT seq FROM sqlite_sequence WHERE name='undo_snapshots'",
          )
          .get(),
      ).toEqual({ seq: 80 });
    } finally {
      db.close();
    }
  } finally {
    f.db.close();
    rmSync(f.dir, { recursive: true, force: true });
  }
});
it('retains media through task deletion and live/Undo pins, cascades only on project deletion', () => {
  const f = fixture();
  try {
    f.db.close();
    const db = openDatabase(f.path);
    try {
      db.prepare(
        "INSERT INTO journal_media(id,uploadId,projectId,taskId,sessionId,fileName,kind,mediaType,sourceByteLength,sourceSha256,byteLength,storedSha256,createdAt,unreferencedAt,bytes) VALUES ('media','upload',?,?,'synthetic','example.txt','file','application/octet-stream',1,?,1,?,'created','created',X'61')",
      ).run(projectId, taskId, 'a'.repeat(64), 'b'.repeat(64));
      db.exec(
        "INSERT INTO journal_entry_media(entryId,mediaId) VALUES ('entry','media'); INSERT INTO undo_journal_media(undoSequence,entryId,mediaId) VALUES (1,'old-entry','media')",
      );
      db.prepare('DELETE FROM tasks WHERE id=?').run(taskId);
      expect(
        db.prepare('SELECT length(bytes) AS n FROM journal_media').get(),
      ).toEqual({ n: 1 });
      expect(db.prepare('SELECT * FROM journal_entry_media').all()).toEqual([]);
      expect(
        db.prepare('SELECT count(*) AS n FROM undo_journal_media').get(),
      ).toEqual({ n: 1 });
      db.prepare('DELETE FROM projects WHERE id=?').run(projectId);
      expect(db.prepare('SELECT * FROM journal_media').all()).toEqual([]);
      expect(db.pragma('foreign_key_check')).toEqual([]);
    } finally {
      db.close();
    }
  } finally {
    f.db.close();
    rmSync(f.dir, { recursive: true, force: true });
  }
});
it('preserves additional indexes/triggers on rebuilt tables and an empty sequence high-water mark', () => {
  const f = fixture();
  try {
    f.db.exec(
      'CREATE INDEX synthetic_journal_session ON journal_operations(sessionId); CREATE TRIGGER synthetic_snapshot_insert AFTER INSERT ON undo_snapshots BEGIN SELECT 1; END; DELETE FROM undo_journal_manifest; DELETE FROM undo_journal_entries; DELETE FROM undo_snapshots',
    );
    const objects = f.db
      .prepare(
        "SELECT type,name,sql FROM sqlite_schema WHERE name IN ('synthetic_journal_session','synthetic_snapshot_insert') ORDER BY name",
      )
      .all();
    f.db.close();
    const db = openDatabase(f.path);
    try {
      expect(
        db
          .prepare(
            "SELECT type,name,sql FROM sqlite_schema WHERE name IN ('synthetic_journal_session','synthetic_snapshot_insert') ORDER BY name",
          )
          .all(),
      ).toEqual(objects);
      db.prepare(
        "INSERT INTO undo_snapshots(projectId,sessionId,afterRevision,beforeSnapshot,journalLifecycleVersion) VALUES (?,'synthetic',9,'{}',2)",
      ).run(projectId);
      expect(db.prepare('SELECT sequence FROM undo_snapshots').get()).toEqual({
        sequence: 81,
      });
    } finally {
      db.close();
    }
  } finally {
    f.db.close();
    rmSync(f.dir, { recursive: true, force: true });
  }
});
it('fails closed and rolls back schema5 when an old sidecar contains a foreign key violation', () => {
  const f = fixture();
  try {
    // Corrupt only this disposable synthetic fixture to exercise fail-closed startup.
    f.db.pragma('foreign_keys = OFF');
    f.db.exec('UPDATE undo_journal_entries SET undoSequence=999');
    const schema = f.db
      .prepare('SELECT type,name,sql FROM sqlite_schema ORDER BY name')
      .all();
    const before = history(f.db);
    f.db.close();
    expect(() => openDatabase(f.path)).toThrow(
      'Migration foreign key validation failed',
    );
    const db = new Database(f.path);
    try {
      expect(
        db
          .prepare('SELECT type,name,sql FROM sqlite_schema ORDER BY name')
          .all(),
      ).toEqual(schema);
      expect(history(db)).toEqual(before);
      expect(
        db.prepare('SELECT MAX(version) AS version FROM migrations').get(),
      ).toEqual({ version: 4 });
    } finally {
      db.close();
    }
  } finally {
    f.db.close();
    rmSync(f.dir, { recursive: true, force: true });
  }
});
it('adds006 to schema5 preserving bytes/history and backfills only saved source names', () => {
  const f = fixture();
  try {
    f.db.exec(readFileSync('migrations/005-journal-media.sql', 'utf8'));
    f.db.exec('INSERT INTO migrations VALUES (5)');
    f.db
      .prepare(
        "INSERT INTO journal_media(id,uploadId,projectId,taskId,sessionId,fileName,kind,mediaType,sourceByteLength,sourceSha256,byteLength,storedSha256,width,height,createdAt,unreferencedAt,bytes) VALUES ('media','upload',?,?,'synthetic','saved.webp','image','image/webp',1,?,1,?,1,1,'created','created',?)",
      )
      .run(projectId, taskId, 'a'.repeat(64), 'b'.repeat(64), Buffer.from('x'));
    const before = history(f.db);
    f.db.close();
    const db = openDatabase(f.path);
    try {
      expect(history(db)).toEqual(before);
      expect(
        db
          .prepare(
            'SELECT sourceFileName,fileName,hex(bytes) AS bytes FROM journal_media',
          )
          .get(),
      ).toEqual({
        sourceFileName: 'saved.webp',
        fileName: 'saved.webp',
        bytes: '78',
      });
      expect(
        db.prepare('SELECT max(version) AS version FROM migrations').get(),
      ).toEqual({ version: 6 });
    } finally {
      db.close();
    }
  } finally {
    f.db.close();
    rmSync(f.dir, { recursive: true, force: true });
  }
});
