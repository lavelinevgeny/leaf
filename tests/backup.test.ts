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
      ).toEqual({ version: 4 });
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
