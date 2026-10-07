import Database from 'better-sqlite3';
import { chmodSync, mkdirSync, readFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { validateDatabasePath } from './config.js';
import {
  prepareOptionalMigration,
  loadLegacyContexts,
} from './optional-migration.js';
import { resolveLegacySources } from './legacy-compatibility.js';
import {
  requireOptionalUpgradeApproval,
  type OptionalUpgradeApproval,
} from './optional-upgrade.js';
export function openDatabase(
  databasePath: string,
  optionalUpgrade?: OptionalUpgradeApproval,
): Database.Database {
  let safePath = validateDatabasePath(databasePath);
  mkdirSync(dirname(safePath), { recursive: true, mode: 0o700 });
  safePath = validateDatabasePath(safePath);
  const db = new Database(safePath);
  try {
    const tables = db
      .prepare(
        "SELECT name FROM sqlite_schema WHERE type='table' AND name NOT LIKE 'sqlite_%'",
      )
      .all() as { name: string }[];
    const isFreshDatabase = tables.length === 0;
    const versions = tables.some((row) => row.name === 'migrations')
      ? (db
          .prepare('SELECT version FROM migrations ORDER BY version')
          .all() as { version: number }[])
      : [];
    if (
      !isFreshDatabase &&
      (versions.length < 2 ||
        versions.length > 3 ||
        versions.some((row, index) => row.version !== index + 1))
    )
      throw new Error('Unsupported database schema');
    // A legacy database must not receive even journal-mode/DDL changes before approval.
    if (!isFreshDatabase && versions.length === 2) {
      db.transaction(() =>
        requireOptionalUpgradeApproval(db, optionalUpgrade),
      ).immediate();
    }
    chmodSync(safePath, 0o600);
    db.pragma('foreign_keys = ON');
    db.pragma('busy_timeout = 5000');
    const migrations: {
      version: number;
      file: string;
      prepare?: (sql: string) => void;
    }[] = [
      { version: 1, file: '001-initial.sql' },
      { version: 2, file: '002-scheduling.sql' },
      {
        version: 3,
        file: '003-optional-scheduling.sql',
        prepare: (sql) => {
          if (!isFreshDatabase)
            requireOptionalUpgradeApproval(db, optionalUpgrade);
          prepareOptionalMigration(
            db,
            sql,
            resolveLegacySources(loadLegacyContexts(db)),
          );
        },
      },
    ];
    if (isFreshDatabase)
      db.exec('CREATE TABLE migrations (version INTEGER PRIMARY KEY) STRICT');
    for (const entry of migrations.slice(versions.length)) {
      let sql: string;
      try {
        sql = readFileSync(
          fileURLToPath(
            new URL(`../../migrations/${entry.file}`, import.meta.url),
          ),
          'utf8',
        );
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
        sql = readFileSync(
          fileURLToPath(
            new URL(`../../../migrations/${entry.file}`, import.meta.url),
          ),
          'utf8',
        );
      }
      db.transaction(() => {
        if (entry.prepare) entry.prepare(sql);
        else db.exec(sql);
        db.prepare('INSERT INTO migrations(version) VALUES (?)').run(
          entry.version,
        );
      }).immediate();
    }
    db.pragma('journal_mode = WAL');
    return db;
  } catch (error) {
    db.close();
    throw error;
  }
}
