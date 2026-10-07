import Database from 'better-sqlite3';
import { chmodSync, mkdirSync, readFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { validateDatabasePath } from './config.js';

export function openDatabase(databasePath: string): Database.Database {
  let safePath = validateDatabasePath(databasePath);
  mkdirSync(dirname(safePath), { recursive: true, mode: 0o700 });
  // Recheck after mkdir and immediately before the driver can open any file.
  safePath = validateDatabasePath(safePath);
  const db = new Database(safePath);
  try {
    chmodSync(safePath, 0o600);
    db.pragma('foreign_keys = ON');
    db.pragma('busy_timeout = 5000');
    db.pragma('journal_mode = WAL');
    db.exec(
      'CREATE TABLE IF NOT EXISTS migrations (version INTEGER PRIMARY KEY) STRICT',
    );
    const versions = db
      .prepare('SELECT version FROM migrations ORDER BY version')
      .all() as { version: number }[];
    const migrations = ['001-initial.sql', '002-scheduling.sql'];
    if (
      versions.some((row, index) => row.version !== index + 1) ||
      versions.length > migrations.length
    )
      throw new Error('Unsupported database schema');
    for (let index = versions.length; index < migrations.length; index++) {
      // Only reviewed application build inputs are valid migration sources.
      const name = migrations[index]!;
      const migrationPath = fileURLToPath(
        new URL(`../../migrations/${name}`, import.meta.url),
      );
      const fallbackPath = fileURLToPath(
        new URL(`../../../migrations/${name}`, import.meta.url),
      );
      let migration: string;
      try {
        migration = readFileSync(migrationPath, 'utf8');
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
        migration = readFileSync(fallbackPath, 'utf8');
      }
      db.transaction(() => {
        db.exec(migration);
        db.prepare('INSERT INTO migrations(version) VALUES (?)').run(index + 1);
      }).immediate();
    }
    return db;
  } catch (error) {
    db.close();
    throw error;
  }
}
