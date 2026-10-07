import { existsSync, lstatSync, mkdirSync, realpathSync } from 'node:fs';
import {
  basename,
  dirname,
  isAbsolute,
  join,
  relative,
  resolve,
  sep,
} from 'node:path';
import { fileURLToPath } from 'node:url';

const sourceRoot = fileURLToPath(new URL('../../', import.meta.url));
export const applicationRoot = existsSync(join(sourceRoot, 'package.json'))
  ? sourceRoot
  : fileURLToPath(new URL('../../../', import.meta.url));
export interface RuntimeConfig {
  host: string;
  port: number;
  publicOrigin: string;
  databasePath: string;
  staticRoot: string;
}
function entryStat(path: string) {
  try {
    return lstatSync(path);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined;
    throw error;
  }
}
function resolvedDestination(path: string): string {
  const tail: string[] = [];
  let parent = resolve(path);
  while (!entryStat(parent)) {
    tail.unshift(basename(parent));
    const next = dirname(parent);
    if (next === parent)
      throw new Error('Runtime directory cannot be resolved');
    parent = next;
  }
  return resolve(realpathSync(parent), ...tail);
}
function inside(path: string, root: string): boolean {
  const part = relative(root, path);
  return (
    part === '' ||
    (!part.startsWith(`..${sep}`) && part !== '..' && !isAbsolute(part))
  );
}
export function validateDatabasePath(databasePath: string): string {
  if (!isAbsolute(databasePath))
    throw new Error('Database path must be absolute');
  const directory = resolvedDestination(dirname(databasePath));
  if (inside(directory, realpathSync(applicationRoot)))
    throw new Error('Database path must be outside the application checkout');
  const destination = join(directory, basename(databasePath));
  // lstat also sees dangling links. Never let SQLite or chmod follow a file
  // link; WAL, shared-memory and rollback journals use the same boundary.
  for (const suffix of ['', '-wal', '-shm', '-journal']) {
    const stat = entryStat(destination + suffix);
    if (stat && (!stat.isFile() || stat.isSymbolicLink()))
      throw new Error('Database and companion paths must be regular files');
  }
  return destination;
}
export function loadConfig(
  environment: Record<string, string | undefined> = process.env,
): RuntimeConfig {
  const dataDirectory = environment.LEAF_DATA_DIR;
  if (!dataDirectory || !isAbsolute(dataDirectory))
    throw new Error(
      'LEAF_DATA_DIR must be an absolute directory outside the application checkout',
    );
  const destination = resolvedDestination(dataDirectory);
  if (inside(destination, realpathSync(applicationRoot)))
    throw new Error('LEAF_DATA_DIR must be outside the application checkout');
  const portString = environment.LEAF_PORT ?? '3000';
  const port = Number(portString);
  if (
    !/^\d+$/.test(portString) ||
    !Number.isInteger(port) ||
    port < 1 ||
    port > 65535
  )
    throw new Error('LEAF_PORT must be a valid port');
  const host = environment.LEAF_HOST ?? '127.0.0.1';
  if (!host || host.includes('/')) throw new Error('Invalid LEAF_HOST');
  const publicOrigin =
    environment.LEAF_PUBLIC_ORIGIN ?? `http://127.0.0.1:${port}`;
  const parsed = new URL(publicOrigin);
  if (
    parsed.origin !== publicOrigin ||
    !['http:', 'https:'].includes(parsed.protocol)
  )
    throw new Error('LEAF_PUBLIC_ORIGIN must be an exact HTTP origin');
  const databasePath = validateDatabasePath(join(destination, 'leaf.sqlite'));
  mkdirSync(destination, { recursive: true, mode: 0o700 });
  return {
    host,
    port,
    publicOrigin,
    databasePath,
    staticRoot: join(applicationRoot, 'dist/client'),
  };
}
