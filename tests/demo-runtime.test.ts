import { afterEach, expect, it, vi } from 'vitest';
import * as fs from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { applicationRoot } from '../src/server/config.js';
import { prepareServerRuntime } from '../src/server/demo-runtime.js';
vi.mock('node:fs', async (original) => {
  const fs = await original<typeof import('node:fs')>();
  return {
    ...fs,
    lstatSync: vi.fn(fs.lstatSync),
    mkdtempSync: vi.fn(fs.mkdtempSync),
  };
});
const owned: string[] = [];
afterEach(() => {
  vi.clearAllMocks();
  vi.unstubAllEnvs();
  for (const path of owned.splice(0))
    fs.rmSync(path, { recursive: true, force: true });
});
function scratch() {
  const path = fs.mkdtempSync(join(tmpdir(), 'leaf-demo-test-'));
  owned.push(path);
  return path;
}
it('never reads or changes the original synthetic directory, even via symlink', () => {
  const sentinel = scratch();
  const file = join(sentinel, 'sentinel.txt');
  fs.writeFileSync(file, 'synthetic untouched', { mode: 0o640 });
  const mode = fs.statSync(file).mode;
  const link = join(scratch(), 'link');
  fs.symlinkSync(sentinel, link);
  for (const original of [sentinel, link]) {
    const spy = vi.mocked(fs.lstatSync);
    const runtime = prepareServerRuntime({
      LEAF_DEMO_MODE: '1',
      LEAF_DATA_DIR: original,
    });
    expect(
      spy.mock.calls.some(([path]) => String(path).startsWith(original)),
    ).toBe(false);
    spy.mockClear();
    expect(runtime.databasePath.startsWith(original + '/')).toBe(false);
    expect(fs.statSync(dirname(runtime.databasePath)).mode & 0o777).toBe(0o700);
    runtime.cleanup();
    runtime.cleanup();
    expect(fs.existsSync(dirname(runtime.databasePath))).toBe(false);
    expect(fs.readFileSync(file, 'utf8')).toBe('synthetic untouched');
    expect(fs.statSync(file).mode).toBe(mode);
  }
});
it('ignores unsafe TMPDIR and gives every restart a fresh path', () => {
  vi.stubEnv('TMPDIR', applicationRoot);
  const first = prepareServerRuntime({
    LEAF_DEMO_MODE: '1',
    TMPDIR: applicationRoot,
  });
  const second = prepareServerRuntime({
    LEAF_DEMO_MODE: '1',
    TMPDIR: applicationRoot,
  });
  try {
    expect(first.databasePath).not.toBe(second.databasePath);
    expect(first.databasePath.startsWith(applicationRoot)).toBe(false);
  } finally {
    first.cleanup();
    second.cleanup();
  }
});
it('preserves normal defaults and no-op cleanup', () => {
  const dir = scratch();
  const runtime = prepareServerRuntime({ LEAF_DATA_DIR: dir });
  expect(runtime.demoMode).toBe(false);
  expect(runtime.publicOrigin).toBe('http://127.0.0.1:3000');
  runtime.cleanup();
  expect(fs.existsSync(dir)).toBe(true);
  expect(() => prepareServerRuntime({})).toThrow();
});
it.each(['', 'true', '2'])('rejects invalid mode %s', (LEAF_DEMO_MODE) =>
  expect(() => prepareServerRuntime({ LEAF_DEMO_MODE })).toThrow(),
);
it.each([
  'x.y.onrender.com',
  '-x.onrender.com',
  'x-.onrender.com',
  'x.onrender.com:443',
  'x.onrender.com/',
  'https://x.onrender.com',
  'x.onrender.com.',
  'x'.repeat(64) + '.onrender.com',
  undefined,
])('rejects unsafe Render hostname %s', (RENDER_EXTERNAL_HOSTNAME) =>
  expect(() =>
    prepareServerRuntime({
      LEAF_DEMO_MODE: '1',
      RENDER: 'true',
      RENDER_EXTERNAL_HOSTNAME,
    }),
  ).toThrow(),
);
it('resolves Render HTTPS with explicit exact origin precedence', () => {
  for (const env of [
    { RENDER_EXTERNAL_HOSTNAME: 'synthetic-demo.onrender.com' },
    {
      LEAF_PUBLIC_ORIGIN: 'https://demo.example.test',
      RENDER_EXTERNAL_HOSTNAME: 'bad',
    },
  ]) {
    const runtime = prepareServerRuntime({
      LEAF_DEMO_MODE: '1',
      RENDER: 'true',
      ...env,
    });
    expect(runtime.publicOrigin).toBe(
      env.LEAF_PUBLIC_ORIGIN ?? 'https://synthetic-demo.onrender.com',
    );
    runtime.cleanup();
  }
  expect(() =>
    prepareServerRuntime({
      LEAF_DEMO_MODE: '1',
      RENDER: 'true',
      LEAF_PUBLIC_ORIGIN: 'http://demo.example.test',
    }),
  ).toThrow();
});
it.each([
  { LEAF_PORT: 'bad' },
  { LEAF_HOST: 'bad/host' },
  { LEAF_PUBLIC_ORIGIN: 'https://demo.example.test/path' },
])('fails before temp creation on invalid config', (env) => {
  const spy = vi.mocked(fs.mkdtempSync).mockClear();
  expect(() => prepareServerRuntime({ LEAF_DEMO_MODE: '1', ...env })).toThrow();
  expect(spy).not.toHaveBeenCalled();
});

it('cleans only owned temp when storage validation fails after allocation', () => {
  const sentinel = scratch();
  const target = join(sentinel, 'synthetic-target');
  fs.writeFileSync(target, 'synthetic protected');
  const make = vi.mocked(fs.mkdtempSync).getMockImplementation()!;
  let allocated = '';
  vi.mocked(fs.mkdtempSync).mockImplementationOnce((...args) => {
    const path = make(...args);
    allocated = String(path);
    fs.symlinkSync(target, join(allocated, 'leaf.sqlite'));
    return path;
  });
  expect(() =>
    prepareServerRuntime({ LEAF_DEMO_MODE: '1', LEAF_DATA_DIR: sentinel }),
  ).toThrow();
  expect(fs.existsSync(allocated)).toBe(false);
  expect(fs.readFileSync(target, 'utf8')).toBe('synthetic protected');
});
