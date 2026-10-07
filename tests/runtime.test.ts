import { afterEach, describe, expect, it } from 'vitest';
import {
  mkdtempSync,
  rmSync,
  mkdirSync,
  writeFileSync,
  symlinkSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { loadConfig } from '../src/server/config.js';
import { buildApp } from '../src/server/app.js';

const dirs: string[] = [];
const scratch = () => {
  const path = mkdtempSync(join(tmpdir(), 'leaf-runtime-'));
  dirs.push(path);
  return path;
};
afterEach(() => {
  for (const dir of dirs.splice(0))
    rmSync(dir, { recursive: true, force: true });
});
describe('safe runtime configuration', () => {
  it('defaults to loopback and requires external data directory', () => {
    const dir = scratch();
    expect(loadConfig({ LEAF_DATA_DIR: dir })).toMatchObject({
      host: '127.0.0.1',
      port: 3000,
      publicOrigin: 'http://127.0.0.1:3000',
      databasePath: join(dir, 'leaf.sqlite'),
    });
    expect(() => loadConfig({})).toThrow();
    expect(() => loadConfig({ LEAF_DATA_DIR: resolve('.data') })).toThrow();
    expect(() =>
      loadConfig({ LEAF_DATA_DIR: dir, LEAF_PORT: 'bad' }),
    ).toThrow();
    expect(() =>
      loadConfig({
        LEAF_DATA_DIR: dir,
        LEAF_PUBLIC_ORIGIN: 'http://127.0.0.1:3000/path',
      }),
    ).toThrow();
  });
  it('rejects a symlink into checkout before creating runtime files', () => {
    const dir = scratch();
    symlinkSync(resolve('.'), join(dir, 'checkout'), 'dir');
    expect(() =>
      loadConfig({ LEAF_DATA_DIR: join(dir, 'checkout', 'synthetic-data') }),
    ).toThrow();
  });
  it('refuses noninteractive account setup and password arguments without creating a DB', () => {
    const dir = scratch();
    const result = spawnSync(
      process.execPath,
      ['--import', 'tsx', 'src/server/admin.ts'],
      {
        encoding: 'utf8',
        env: { PATH: process.env.PATH, LEAF_DATA_DIR: dir },
        stdio: ['pipe', 'pipe', 'pipe'],
      },
    );
    expect(result.status).toBe(1);
    expect(result.stderr).toContain('TTY');
    const args = spawnSync(
      process.execPath,
      ['--import', 'tsx', 'src/server/admin.ts', 'synthetic-argument'],
      { encoding: 'utf8', env: { PATH: process.env.PATH, LEAF_DATA_DIR: dir } },
    );
    expect(args.status).toBe(1);
    expect(args.stderr).not.toContain('synthetic-argument');
  });
  it('serves only static allowlist root and SPA routes; never API fallback', async () => {
    const dir = scratch();
    const staticRoot = join(dir, 'public');
    mkdirSync(staticRoot);
    writeFileSync(
      join(staticRoot, 'index.html'),
      '<!doctype html><title>Synthetic leaf</title>',
    );
    writeFileSync(join(staticRoot, 'app.js'), 'console.log("synthetic")');
    const app = await buildApp({
      databasePath: join(dir, 'synthetic.sqlite'),
      publicOrigin: 'http://127.0.0.1:3000',
      staticRoot,
    });
    try {
      expect((await app.inject('/')).body).toContain('Synthetic leaf');
      expect((await app.inject('/projects/example')).statusCode).toBe(200);
      expect((await app.inject('/app.js')).body).toContain('synthetic');
      expect((await app.inject('/api/missing')).statusCode).toBe(404);
      expect((await app.inject('/missing.js')).statusCode).toBe(404);
      expect((await app.inject('/synthetic.sqlite')).statusCode).toBe(404);
      expect((await app.inject('/../synthetic.sqlite')).statusCode).toBe(404);
    } finally {
      await app.close();
    }
  });
});
