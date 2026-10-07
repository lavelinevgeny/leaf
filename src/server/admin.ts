import { pathToFileURL } from 'node:url';
import { timingSafeEqual } from 'node:crypto';
import { openDatabase } from './database.js';
import { loadConfig } from './config.js';
import { Auth } from './auth.js';
import { DomainError } from '../domain/tree.js';
class SetupError extends Error {}

export function readPassword(prompt: string): Promise<string> {
  if (!process.stdin.isTTY || !process.stdout.isTTY)
    throw new SetupError('Admin setup requires an interactive TTY');
  process.stdout.write(prompt);
  return new Promise((resolve, reject) => {
    let value = '';
    process.stdin.setEncoding('utf8');
    process.stdin.setRawMode(true);
    process.stdin.resume();
    const finish = (error?: Error) => {
      process.stdin.setRawMode(false);
      process.stdin.pause();
      process.stdin.off('data', onData);
      process.stdout.write('\n');
      if (error) reject(error);
      else resolve(value);
    };
    const onData = (chunk: string) => {
      for (const character of chunk) {
        if (character === '\u0003') {
          finish(new SetupError('Setup cancelled'));
          return;
        }
        if (character === '\r' || character === '\n') {
          finish();
          return;
        }
        if (character === '\u007f' || character === '\b') {
          value = Array.from(value).slice(0, -1).join('');
          continue;
        }
        if (character >= ' ' && character !== '\u007f') {
          value += character;
          if (value.length > 1024) {
            finish(new SetupError('Password is too long'));
            return;
          }
        }
      }
    };
    process.stdin.on('data', onData);
  });
}
export async function adminSetup(): Promise<void> {
  if (process.argv.length !== 2)
    throw new SetupError('Admin setup does not accept arguments');
  if (!process.stdin.isTTY || !process.stdout.isTTY)
    throw new SetupError('Admin setup requires an interactive TTY');
  const config = loadConfig();
  const db = openDatabase(config.databasePath);
  try {
    const auth = new Auth(db);
    if (auth.hasAccount()) throw new SetupError('Local account already exists');
    const first = await readPassword('Новый пароль (не менее 12 символов): ');
    const second = await readPassword('Повторите пароль: ');
    const firstBytes = Buffer.from(first);
    const secondBytes = Buffer.from(second);
    if (
      firstBytes.length !== secondBytes.length ||
      !timingSafeEqual(firstBytes, secondBytes)
    )
      throw new SetupError('Passwords do not match');
    await auth.setup(first);
    process.stdout.write('Локальная учётная запись создана.\n');
  } finally {
    db.close();
  }
}
if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  adminSetup().catch((error) => {
    process.stderr.write(
      `${error instanceof SetupError || error instanceof DomainError ? error.message : 'Admin setup failed. Check runtime configuration and storage.'}\n`,
    );
    process.exitCode = 1;
  });
}
