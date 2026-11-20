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
        versions.length > 6 ||
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
      { version: 4, file: '004-task-journal.sql' },
      { version: 5, file: '005-journal-media.sql' },
      { version: 6, file: '006-journal-media-source-name.sql' },
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
      // Only migration005 rebuilds a referenced table. This connection is not yet
      // exposed to runtime callers; ordinary application writes always enforce FKs.
      const rebuildReferencedTable = entry.version === 5;
      const rebuiltObjects = rebuildReferencedTable
        ? (db
            .prepare(
              "SELECT type,name,sql FROM sqlite_schema WHERE tbl_name IN ('undo_snapshots','journal_operations') AND type IN ('index','trigger') AND sql IS NOT NULL",
            )
            .all() as { type: string; name: string; sql: string }[])
        : [];
      if (rebuildReferencedTable) {
        db.pragma('foreign_keys = OFF');
        if (db.pragma('foreign_keys', { simple: true }) !== 0)
          throw new Error('Migration cannot rebuild referenced tables');
      }
      try {
        db.transaction(() => {
          if (entry.prepare) entry.prepare(sql);
          else db.exec(sql);
          for (const object of rebuiltObjects) {
            if (
              !db
                .prepare('SELECT 1 FROM sqlite_schema WHERE type=? AND name=?')
                .get(object.type, object.name)
            )
              db.exec(object.sql);
          }
          db.prepare('INSERT INTO migrations(version) VALUES (?)').run(
            entry.version,
          );
          if (
            rebuildReferencedTable &&
            (db.pragma('foreign_key_check') as unknown[]).length !== 0
          )
            throw new Error('Migration foreign key validation failed');
        }).immediate();
      } finally {
        if (rebuildReferencedTable) {
          db.pragma('foreign_keys = ON');
          if (db.pragma('foreign_keys', { simple: true }) !== 1)
            throw new Error('Database foreign key enforcement unavailable');
        }
      }
    }
    db.pragma('journal_mode = WAL');
    return db;
  } catch (error) {
    db.close();
    throw error;
  }
}
