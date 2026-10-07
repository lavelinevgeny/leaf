import { loadConfig } from './config.js';
import { openDatabase } from './database.js';
try {
  const config = loadConfig();
  const db = openDatabase(config.databasePath);
  db.close();
  process.stdout.write('Database migrations complete.\n');
} catch {
  process.stderr.write(
    'Database migration failed. Check runtime configuration and storage.\n',
  );
  process.exitCode = 1;
}
