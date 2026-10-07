import { buildApp } from '../src/server/app.js';
import { spawnSync, execFileSync } from 'node:child_process';
import Database from 'better-sqlite3';
import { afterEach, expect, it } from 'vitest';
import {
  mkdtempSync,
  readFileSync,
  rmSync,
  renameSync,
  symlinkSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { openDatabase } from '../src/server/database.js';
import { previewOptionalUpgrade } from '../src/server/optional-upgrade.js';
const directories: string[] = [];
afterEach(() => {
  for (const d of directories.splice(0))
    rmSync(d, { recursive: true, force: true });
});
function fixture(version = 2) {
  const dir = mkdtempSync(join(tmpdir(), 'leaf-upgrade-registry-'));
  directories.push(dir);
  const path = join(dir, 'synthetic.sqlite');
  const db = new Database(path);
  db.exec('CREATE TABLE migrations(version INTEGER PRIMARY KEY) STRICT');
  for (let v = 1; v <= version; v++) {
    db.exec(
      readFileSync(
        `migrations/${v === 1 ? '001-initial.sql' : '002-scheduling.sql'}`,
        'utf8',
      ),
    );
    db.prepare('INSERT INTO migrations VALUES (?)').run(v);
  }
  return { db, path };
}
it('creates 1→2→3 fresh and reopens3 without approval', () => {
  const dir = mkdtempSync(join(tmpdir(), 'leaf-fresh-registry-'));
  directories.push(dir);
  const path = join(dir, 'synthetic.sqlite');
  let db = openDatabase(path);
  expect(
    db.prepare('SELECT version FROM migrations ORDER BY version').all(),
  ).toEqual([{ version: 1 }, { version: 2 }, { version: 3 }]);
  db.close();
  db = openDatabase(path);
  expect(
    db.prepare('SELECT * FROM scheduling_migration_archive').all(),
  ).toEqual([]);
  db.close();
});
it('refuses legacy startup before journal/DDL changes, then confirms2→3 preserving accounts', async () => {
  const { db, path } = fixture();
  db.prepare('INSERT INTO account VALUES (1,?)').run(
    'synthetic-placeholder-only',
  );
  const approval = previewOptionalUpgrade(db);
  db.close();
  const before = readFileSync(path);
  expect(() => openDatabase(path)).toThrow(/MIGRATION_APPROVAL_REQUIRED/);
  await expect(
    buildApp({ databasePath: path, publicOrigin: 'http://127.0.0.1:3000' }),
  ).rejects.toThrow(/MIGRATION_APPROVAL_REQUIRED/);
  expect(readFileSync(path)).toEqual(before);
  const active = openDatabase(path, approval);
  expect(active.prepare('SELECT passwordHash FROM account').get()).toEqual({
    passwordHash: 'synthetic-placeholder-only',
  });
  expect(
    active.prepare('SELECT version FROM migrations ORDER BY version').all(),
  ).toEqual([{ version: 1 }, { version: 2 }, { version: 3 }]);
  active.close();
});
it('rejects stale preview without mutation and source schema1 before history clearing', () => {
  const { db, path } = fixture();
  const approval = previewOptionalUpgrade(db);
  db.prepare('INSERT INTO projects VALUES (?,?,?,?,?,?,?,?)').run(
    '11111111-1111-4111-8111-111111111111',
    'Synthetic',
    0,
    '2026-10-08T00:00:00.000Z',
    '2026-10-08T00:00:00.000Z',
    null,
    'weekdays',
    'UTC',
  );
  db.close();
  const before = readFileSync(path);
  expect(() => openDatabase(path, approval)).toThrow(
    /MIGRATION_PREVIEW_CHANGED/,
  );
  expect(readFileSync(path)).toEqual(before);
  const old = fixture(1);
  old.db
    .prepare('INSERT INTO projects VALUES (?,?,?,?,?)')
    .run(
      'synthetic-project',
      'Synthetic',
      0,
      '2026-10-08T00:00:00.000Z',
      '2026-10-08T00:00:00.000Z',
    );
  old.db
    .prepare('INSERT INTO operations VALUES (?,?,?,?,?)')
    .run('synthetic-op', 'synthetic-project', 'synthetic-session', '{}', '{}');
  old.db.close();
  const bytes = readFileSync(old.path);
  expect(() => openDatabase(old.path)).toThrow(/Unsupported database schema/);
  expect(readFileSync(old.path)).toEqual(bytes);
});
it('rejects future/gapped registry before writes and rolls back failed version insertion', () => {
  for (const version of [4, 8]) {
    const { db, path } = fixture();
    db.prepare('INSERT INTO migrations VALUES (?)').run(version);
    db.close();
    const bytes = readFileSync(path);
    expect(() => openDatabase(path)).toThrow(/schema/);
    expect(readFileSync(path)).toEqual(bytes);
  }
  const { db, path } = fixture();
  const approval = previewOptionalUpgrade(db);
  db.exec(
    "CREATE TRIGGER synthetic_version_failure BEFORE INSERT ON migrations WHEN NEW.version=3 BEGIN SELECT RAISE(ABORT,'synthetic version failure'); END",
  );
  db.close();
  expect(() => openDatabase(path, approval)).toThrow(
    /synthetic version failure/,
  );
  const reopened = new Database(path);
  try {
    expect(
      reopened.prepare('SELECT version FROM migrations ORDER BY version').all(),
    ).toEqual([{ version: 1 }, { version: 2 }]);
    expect(
      reopened
        .prepare(
          "SELECT name FROM sqlite_schema WHERE name='scheduling_migration_archive'",
        )
        .get(),
    ).toBeUndefined();
  } finally {
    reopened.close();
  }
});

it('real CLI previews readonly, rejects ordinary/stale startup, explicitly applies and restarts', async () => {
  const { db, path } = fixture();
  db.close();
  const before = readFileSync(path);
  const env = {
    PATH: process.env.PATH,
    LEAF_DATA_DIR: dirname(path),
    LEAF_DB_PATH: path,
    LEAF_PUBLIC_ORIGIN: 'http://127.0.0.1:3000',
  };
  // The CLI uses the configured standard filename, owned solely by this fixture.
  renameSync(path, join(dirname(path), 'leaf.sqlite'));
  const cliPath = join(dirname(path), 'leaf.sqlite');
  const run = (args: string[]) =>
    spawnSync(
      process.execPath,
      ['--import', 'tsx', 'src/server/migrate.ts', ...args],
      { cwd: process.cwd(), env, encoding: 'utf8' },
    );
  const preview = run(['--preview']);
  expect(preview.status).toBe(0);
  const approval = JSON.parse(preview.stdout) as {
    previewDigest: string;
    policyId: string;
    counts: unknown;
  };
  expect(approval.policyId).toBe('legacy-scheduling-v1');
  expect(readFileSync(cliPath)).toEqual(before);
  expect(run([]).status).toBe(1);
  expect(readFileSync(cliPath)).toEqual(before);
  const source = new Database(cliPath);
  source
    .prepare('INSERT INTO projects VALUES (?,?,?,?,?,?,?,?)')
    .run(
      '11111111-1111-4111-8111-111111111111',
      'Synthetic',
      0,
      '2026-10-08T00:00:00.000Z',
      '2026-10-08T00:00:00.000Z',
      null,
      'weekdays',
      'UTC',
    );
  source.close();
  const changed = readFileSync(cliPath);
  expect(run([`--confirm-preview=${approval.previewDigest}`]).status).toBe(1);
  expect(readFileSync(cliPath)).toEqual(changed);
  const next = JSON.parse(run(['--preview']).stdout) as {
    previewDigest: string;
  };
  expect(run([`--confirm-preview=${next.previewDigest}`]).status).toBe(0);
  expect(run([]).status).toBe(0);
});
it('the actual pinned S3 registry rejects current schema3 downgrade', () => {
  const directory = mkdtempSync(join(tmpdir(), 'leaf-pinned-registry-'));
  directories.push(directory);
  execFileSync('git', [
    'archive',
    '--format=tar',
    `--output=${join(directory, 'source.tar')}`,
    '6317791dff9dc944de3a1676effebcf1322b2ff6',
    '--',
    'package.json',
    'src/server/database.ts',
    'src/server/config.ts',
    'migrations/001-initial.sql',
    'migrations/002-scheduling.sql',
  ]);
  execFileSync('tar', ['-xf', join(directory, 'source.tar'), '-C', directory]);
  symlinkSync(
    join(process.cwd(), 'node_modules'),
    join(directory, 'node_modules'),
    'dir',
  );
  const storage = mkdtempSync(join(tmpdir(), 'leaf-downgrade-storage-'));
  directories.push(storage);
  const path = join(storage, 'synthetic.sqlite');
  openDatabase(path).close();
  const source =
    "import {openDatabase} from './src/server/database.ts';try{openDatabase(process.argv[1]).close();process.exitCode=2;}catch(error){if(error.message!=='Unsupported database schema')process.exitCode=3;}";
  const result = spawnSync(
    process.execPath,
    ['--import', 'tsx', '--input-type=module', '-e', source, path],
    { cwd: directory, encoding: 'utf8' },
  );
  expect(result.status).toBe(0);
});
