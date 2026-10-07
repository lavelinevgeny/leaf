import Database from 'better-sqlite3';
import { loadConfig, validateDatabasePath } from './config.js';
import { openDatabase } from './database.js';
import { previewOptionalUpgrade } from './optional-upgrade.js';
try {
  const config = loadConfig();
  const args = process.argv.slice(2);
  if (args.length === 1 && args[0] === '--preview') {
    const db = new Database(validateDatabasePath(config.databasePath), {
      readonly: true,
      fileMustExist: true,
    });
    try {
      process.stdout.write(`${JSON.stringify(previewOptionalUpgrade(db))}\n`);
    } finally {
      db.close();
    }
  } else {
    const confirm = args[0]?.match(/^--confirm-preview=([a-f0-9]{64})$/);
    if (args.length && (args.length !== 1 || !confirm))
      throw new Error('Invalid migration options');
    const db = openDatabase(
      config.databasePath,
      confirm
        ? { policyId: 'legacy-scheduling-v1', previewDigest: confirm[1]! }
        : undefined,
    );
    db.close();
    process.stdout.write('Database migrations complete.\n');
  }
} catch {
  process.stderr.write(
    'Database migration failed. Check runtime configuration, preview approval and storage.\n',
  );
  process.exitCode = 1;
}
