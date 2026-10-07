import Database from 'better-sqlite3';
import { mkdir, open, unlink } from 'node:fs/promises';
import { dirname } from 'node:path';
import { pathToFileURL } from 'node:url';
import { loadConfig, validateDatabasePath } from './config.js';

export async function backupDatabase(source: string, destination: string) {
  const safeSource = validateDatabasePath(source);
  let safeDestination = validateDatabasePath(destination);
  if (safeSource === safeDestination)
    throw new Error('Backup must be separate');
  await mkdir(dirname(safeDestination), { recursive: true, mode: 0o700 });
  safeDestination = validateDatabasePath(safeDestination);
  const db = new Database(safeSource, { readonly: true, fileMustExist: true });
  let created = false;
  try {
    // Never overwrite an existing backup or follow an existing link.
    const file = await open(safeDestination, 'wx', 0o600);
    created = true;
    await file.close();
    await db.backup(safeDestination);
  } catch (error) {
    if (created) await unlink(safeDestination);
    throw error;
  } finally {
    db.close();
  }
}
if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  if (process.argv.length !== 3) {
    process.stderr.write(
      'Usage: npm run db:backup -- /absolute/external/backup.sqlite\n',
    );
    process.exitCode = 1;
  } else {
    try {
      await backupDatabase(loadConfig().databasePath, process.argv[2]!);
      process.stdout.write('Consistent SQLite backup created.\n');
    } catch {
      process.stderr.write(
        'Backup failed. Check storage and use a new external destination.\n',
      );
      process.exitCode = 1;
    }
  }
}
