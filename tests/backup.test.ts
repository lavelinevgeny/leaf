import Database from 'better-sqlite3';
import {
  mkdtemp,
  readFile,
  rm,
  stat,
  symlink,
  writeFile,
} from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { afterEach, expect, it } from 'vitest';
import { backupDatabase } from '../src/server/backup.js';
import { openDatabase } from '../src/server/database.js';

const directories: string[] = [];
async function fixture() {
  const directory = await mkdtemp(join(tmpdir(), 'leaf-backup-'));
  directories.push(directory);
  return directory;
}
afterEach(async () => {
  await Promise.all(
    directories
      .splice(0)
      .map((path) => rm(path, { recursive: true, force: true })),
  );
});
it('backs up committed WAL state consistently while a writer remains open', async () => {
  const directory = await fixture();
  const source = join(directory, 'leaf.sqlite');
  const destination = join(directory, 'backups', 'snapshot.sqlite');
  const db = openDatabase(source);
  try {
    db.pragma('wal_autocheckpoint = 0');
    db.exec(
      'CREATE TABLE synthetic (id INTEGER PRIMARY KEY, title TEXT) STRICT',
    );
    db.prepare('INSERT INTO synthetic VALUES (?, ?)').run(1, 'Задача A');
    await backupDatabase(source, destination);
    db.prepare('INSERT INTO synthetic VALUES (?, ?)').run(2, 'Задача B');
    const snapshot = new Database(destination, { readonly: true });
    try {
      expect(snapshot.pragma('integrity_check', { simple: true })).toBe('ok');
      expect(snapshot.prepare('SELECT id, title FROM synthetic').all()).toEqual(
        [{ id: 1, title: 'Задача A' }],
      );
      expect(
        snapshot
          .prepare('SELECT MAX(version) AS version FROM migrations')
          .get(),
      ).toEqual({ version: 6 });
    } finally {
      snapshot.close();
    }
    expect((await stat(destination)).mode & 0o777).toBe(0o600);
    expect((await stat(join(directory, 'backups'))).mode & 0o777).toBe(0o700);
  } finally {
    db.close();
  }
});
it('refuses overwrite, same-file backup, links and repository output without changing existing bytes', async () => {
  const directory = await fixture();
  const source = join(directory, 'leaf.sqlite');
  openDatabase(source).close();
  const destination = join(directory, 'existing.sqlite');
  await writeFile(destination, 'synthetic existing file');
  const bytes = await readFile(source);
  await expect(backupDatabase(source, destination)).rejects.toThrow();
  expect(await readFile(destination, 'utf8')).toBe('synthetic existing file');
  await expect(backupDatabase(source, source)).rejects.toThrow();
  const link = join(directory, 'linked.sqlite');
  await symlink(destination, link);
  await expect(backupDatabase(source, link)).rejects.toThrow();
  await expect(
    backupDatabase(source, join(process.cwd(), 'backup.sqlite')),
  ).rejects.toThrow();
  expect(await readFile(source)).toEqual(bytes);
});

import { JournalRepository } from '../src/server/journal-repository.js';
import {
  journalFixture,
  createInput,
  rawTables,
} from './helpers/journal-fixture.js';
it('backs up active journal, replay and private deletion sidecar then reopens schema4', async () => {
  const f = journalFixture();
  try {
    const j = new JournalRepository(f.db, f.now);
    j.create(f.project.id, createInput(f.taskId), 'synthetic-session');
    f.command({ type: 'task.create', parentId: null, title: 'Surviving' });
    const task = f.plan
      .getTree(f.project.id, 'synthetic-session')
      .tasks.find((t) => t.title === 'Surviving')!;
    j.create(
      f.project.id,
      createInput(task.id, 1, 'Synthetic active'),
      'synthetic-session',
    );
    f.command({ type: 'task.delete', taskId: f.taskId });
    const tables = [
      'journal_entries',
      'journal_state',
      'journal_operations',
      'undo_journal_entries',
      'undo_journal_manifest',
      'undo_snapshots',
      'scheduling_migration_archive',
    ];
    const expected = rawTables(f.db, tables);
    const dest = join(await fixture(), 'snapshot.sqlite');
    await backupDatabase(f.path, dest);
    const readonly = new Database(dest, { readonly: true });
    try {
      expect(rawTables(readonly, tables)).toEqual(expected);
      expect(
        readonly
          .prepare('SELECT taskId,body,workDate FROM journal_entries')
          .all(),
      ).toEqual([
        { taskId: task.id, body: 'Synthetic active', workDate: '2024-02-29' },
      ]);
      expect(
        readonly
          .prepare('SELECT taskId,body,workDate FROM undo_journal_entries')
          .all(),
      ).toEqual([
        {
          taskId: f.taskId,
          body: '  Первая строка\nВторая строка  ',
          workDate: '2024-02-29',
        },
      ]);
      expect(readonly.prepare('SELECT * FROM journal_state').all()).toEqual([
        { projectId: f.project.id, revision: 3 },
      ]);
      expect(
        readonly.prepare('SELECT COUNT(*) AS n FROM journal_operations').get(),
      ).toEqual({ n: 2 });
      expect(readonly.pragma('integrity_check', { simple: true })).toBe('ok');
      expect(readonly.pragma('foreign_key_check')).toEqual([]);
    } finally {
      readonly.close();
    }
    const reopened = openDatabase(dest);
    try {
      expect(rawTables(reopened, tables)).toEqual(expected);
      expect(
        new JournalRepository(reopened, f.now).getTaskPage(
          f.project.id,
          task.id,
          {},
        ).entries[0]!.body,
      ).toBe('Synthetic active');
    } finally {
      reopened.close();
    }
  } finally {
    f.close();
  }
});

import { richFixture, mediaContent } from './helpers/journal-rich-fixture.js';
import { JournalRepositoryV2 } from '../src/server/journal-repository-v2.js';
import { JournalMediaRepository } from '../src/server/journal-media-repository.js';
import { Repository } from '../src/server/repository.js';
import { randomUUID } from 'node:crypto';
it('reopens one independent backup with live/staged/Undo BLOBs and restores exact rich content', async () => {
  const f = await richFixture();
  try {
    f.command({ type: 'task.create', title: 'survivor', parentId: null });
    const task = f.plan
      .getTree(f.project.id, 'synthetic-session')
      .tasks.find((t) => t.title === 'survivor')!;
    const undoMedia = await f.stage('undo.txt');
    const original = f.journal.create(
      f.project.id,
      f.input(mediaContent(undoMedia.id)),
      'synthetic-session',
    );
    if (original.kind !== 'saved') throw Error('fixture');
    const stage = (name: string) =>
      f.media.stage({
        projectId: f.project.id,
        taskId: task.id,
        sessionId: 'synthetic-session',
        uploadId: randomUUID(),
        kind: 'file',
        fileName: name,
        bytes: Buffer.from(name),
      });
    const active = await stage('active.txt');
    const staged = await stage('staged.txt');
    f.journal.create(
      f.project.id,
      { ...f.input(mediaContent(active.id), 1), taskId: task.id },
      'synthetic-session',
    );
    f.command({ type: 'task.delete', taskId: f.taskId });
    const names = [
      'journal_entries',
      'journal_state',
      'journal_operations',
      'journal_media',
      'journal_entry_media',
      'undo_snapshots',
      'undo_journal_entries',
      'undo_journal_media',
      'undo_journal_manifest',
      'scheduling_migration_archive',
    ];
    const expected = rawTables(f.db, names);
    const dest = join(await fixture(), 'rich-snapshot.sqlite');
    await backupDatabase(f.path, dest);
    const copy = openDatabase(dest);
    try {
      expect(rawTables(copy, names)).toEqual(expected);
      const media = new JournalMediaRepository(copy, f.now);
      expect(
        media.read(f.project.id, task.id, active.id, 'synthetic-session')!
          .bytes,
      ).toEqual(Buffer.from('active.txt'));
      expect(
        media.read(f.project.id, task.id, staged.id, 'synthetic-session')!
          .bytes,
      ).toEqual(Buffer.from('staged.txt'));
      expect(
        media.read(f.project.id, f.taskId, undoMedia.id, 'synthetic-session'),
      ).toBeUndefined();
      const plan = new Repository(copy, f.now);
      plan.applyCommand(
        f.project.id,
        {
          contractVersion: 2,
          operationId: randomUUID(),
          expectedRevision: plan.getTree(f.project.id, 'synthetic-session')
            .project.revision,
          command: { type: 'undo' },
        },
        'synthetic-session',
      );
      expect(
        new JournalRepositoryV2(copy, f.now).getEntry(
          f.project.id,
          original.entry.id,
        ).entry,
      ).toEqual(original.entry);
      expect(
        media.read(f.project.id, f.taskId, undoMedia.id, 'synthetic-session')!
          .bytes,
      ).toEqual(Buffer.from('synthetic bytes'));
      expect(copy.pragma('foreign_key_check')).toEqual([]);
    } finally {
      copy.close();
    }
  } finally {
    f.close();
  }
});
