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
      ).toEqual({ version: 2 });
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
