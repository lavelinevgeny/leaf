import Database from 'better-sqlite3';
import { chmodSync, mkdirSync, readFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

export function openDatabase(databasePath: string): Database.Database {
  mkdirSync(dirname(databasePath), { recursive: true, mode: 0o700 });
  const db = new Database(databasePath);
  try {
    chmodSync(databasePath, 0o600);
    db.pragma('foreign_keys = ON');
    db.pragma('busy_timeout = 5000');
    db.pragma('journal_mode = WAL');
    db.exec(
      'CREATE TABLE IF NOT EXISTS migrations (version INTEGER PRIMARY KEY) STRICT',
    );
    const version = db
      .prepare('SELECT MAX(version) AS version FROM migrations')
      .get() as { version: number | null };
    if ((version.version ?? 0) > 1)
      throw new Error('Unsupported database schema');
    if (version.version === null) {
      // Migration is an application build input; never accept a runtime SQL path.
      const migrationPath = fileURLToPath(
        new URL('../../migrations/001-initial.sql', import.meta.url),
      );
      const fallbackPath = fileURLToPath(
        new URL('../../../migrations/001-initial.sql', import.meta.url),
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
        db.prepare('INSERT INTO migrations(version) VALUES (?)').run(1);
      }).immediate();
    }
    return db;
  } catch (error) {
    db.close();
    throw error;
  }
}
