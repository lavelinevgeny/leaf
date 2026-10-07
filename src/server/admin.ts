import { pathToFileURL } from 'node:url';
import { timingSafeEqual } from 'node:crypto';
import { createInterface } from 'node:readline/promises';
import { Writable } from 'node:stream';
import { openDatabase } from './database.js';
import { loadConfig } from './config.js';
import { Auth } from './auth.js';
import { DomainError } from '../domain/tree.js';
class SetupError extends Error {}

export function readPassword(
  prompt: string,
  input: NodeJS.ReadStream = process.stdin,
  output: NodeJS.WriteStream = process.stdout,
): Promise<string> {
  if (!input.isTTY || !output.isTTY)
    throw new SetupError('Admin setup requires an interactive TTY');
  return new Promise((resolve, reject) => {
    // The promises Interface keeps editing enabled even under TERM=dumb.
    // Let Node handle cursor keys, editing and bracketed paste, but discard
    // all readline output so neither password characters nor history echo.
    const silent = new Writable({
      write(_chunk, _encoding, callback) {
        callback();
      },
    });
    const reader = createInterface({
      input,
      output: silent,
      terminal: true,
      historySize: 0,
      crlfDelay: Infinity,
    });
    let settled = false;
    const finish = (error?: Error, value = '') => {
      if (settled) return;
      settled = true;
      input.off('data', checkLength);
      input.off('error', onError);
      reader.close();
      input.pause();
      silent.destroy();
      output.write('\n');
      if (error) reject(error);
      else resolve(value);
    };
    const checkLength = () => {
      if (reader.line.length > 1024)
        finish(new SetupError('Password is too long'));
    };
    const onError = () => finish(new SetupError('Password input failed'));
    reader.once('line', (value: string) => {
      if (value.length > 1024) finish(new SetupError('Password is too long'));
      else finish(undefined, value);
    });
    reader.once('SIGINT', () => finish(new SetupError('Setup cancelled')));
    reader.once('close', () => finish(new SetupError('Setup cancelled')));
    reader.once('error', onError);
    input.on('data', checkLength);
    input.once('error', onError);
    output.write(prompt);
  });
}
export async function adminSetup(): Promise<void> {
  const reset =
    process.argv.length === 3 && process.argv[2] === '--reset-password';
  if (process.argv.length !== 2 && !reset)
    throw new SetupError('Admin setup does not accept arguments');
  if (!process.stdin.isTTY || !process.stdout.isTTY)
    throw new SetupError('Admin setup requires an interactive TTY');
  const config = loadConfig();
  const db = openDatabase(config.databasePath);
  try {
    const auth = new Auth(db);
    if (reset && !auth.hasAccount())
      throw new SetupError(
        'Local account does not exist. Run admin:setup first.',
      );
    if (!reset && auth.hasAccount())
      throw new SetupError('Local account already exists');
    if (reset)
      process.stdout.write(
        'Смена пароля завершит все сеансы и очистит историю отмены. Проекты и задачи сохранятся.\n',
      );
    const first = await readPassword('Новый пароль (не менее 12 символов): ');
    const second = await readPassword('Повторите пароль: ');
    const firstBytes = Buffer.from(first);
    const secondBytes = Buffer.from(second);
    if (
      firstBytes.length !== secondBytes.length ||
      !timingSafeEqual(firstBytes, secondBytes)
    )
      throw new SetupError('Passwords do not match');
    if (reset) await auth.resetPassword(first);
    else await auth.setup(first);
    process.stdout.write(
      reset
        ? 'Пароль изменён. Войдите с новым паролем.\n'
        : 'Локальная учётная запись создана.\n',
    );
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
