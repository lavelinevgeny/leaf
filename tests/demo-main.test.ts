import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { existsSync } from 'node:fs';
import { dirname } from 'node:path';
const signals = new Map<string, () => void>();
beforeEach(() => {
  signals.clear();
  state.setupGate = undefined;
  state.buildGate = undefined;
  state.setupPending = false;
  state.buildPending = false;
  state.listenCalls = 0;
  state.cleanupCalls = 0;
  vi.spyOn(process, 'on').mockImplementation(((
    event: string,
    callback: () => void,
  ) => {
    signals.set(event, callback);
    return process;
  }) as typeof process.on);
});
const state = vi.hoisted(() => ({
  failure: '' as string,
  setupGate: undefined as Promise<void> | undefined,
  buildGate: undefined as Promise<void> | undefined,
  setupPending: false,
  buildPending: false,
  listenCalls: 0,
  cleanupCalls: 0,
  path: '',
  closed: false,
  databaseOpened: false,
  databaseClosed: false,
  app: undefined as import('../src/server/app.js').LeafApp | undefined,
}));
vi.mock('../src/server/database.js', async (original) => {
  const actual = await original<typeof import('../src/server/database.js')>();
  return {
    ...actual,
    openDatabase: (...args: Parameters<typeof actual.openDatabase>) => {
      if (state.failure === 'database')
        throw new Error('Synthetic migration failure');
      const db = actual.openDatabase(...args);
      state.databaseOpened = true;
      const close = db.close.bind(db);
      vi.spyOn(db, 'close').mockImplementation(() => {
        const result = close();
        state.databaseClosed = true;
        return result;
      });
      return db;
    },
  };
});
vi.mock('../src/server/auth.js', async (original) => {
  const actual = await original<typeof import('../src/server/auth.js')>();
  return {
    ...actual,
    Auth: class extends actual.Auth {
      override async setup(password: string): Promise<void> {
        if (state.setupGate) {
          state.setupPending = true;
          await state.setupGate;
        }
        if (state.failure === 'setup')
          throw new Error('Synthetic account failure');
        return super.setup(password);
      }
    },
  };
});
vi.mock('../src/server/demo-runtime.js', async (original) => {
  const actual =
    await original<typeof import('../src/server/demo-runtime.js')>();
  return {
    ...actual,
    prepareServerRuntime: () => {
      const runtime = actual.prepareServerRuntime({ LEAF_DEMO_MODE: '1' });
      state.path = dirname(runtime.databasePath);
      return {
        ...runtime,
        cleanup: () => {
          state.cleanupCalls++;
          if (state.databaseOpened) expect(state.databaseClosed).toBe(true);
          runtime.cleanup();
        },
      };
    },
  };
});
vi.mock('../src/server/demo-seed.js', async (original) => {
  const actual = await original<typeof import('../src/server/demo-seed.js')>();
  return {
    seedDemo: (...args: Parameters<typeof actual.seedDemo>) => {
      if (state.failure === 'seed')
        throw new Error('Synthetic startup seed failure');
      return actual.seedDemo(...args);
    },
  };
});
vi.mock('../src/server/app.js', async (original) => {
  const actual = await original<typeof import('../src/server/app.js')>();
  return {
    ...actual,
    buildApp: async (
      options: import('../src/server/app.js').BuildAppOptions,
    ) => {
      if (state.failure === 'build')
        throw new Error('Synthetic startup build failure');
      const app = await actual.buildApp({
        ...options,
        ...(state.failure === 'static'
          ? { staticRoot: 'synthetic-relative-root' }
          : {}),
      });
      state.app = app;
      app.addHook('onClose', async () => {
        state.closed = true;
        expect(existsSync(state.path)).toBe(true);
      });
      vi.spyOn(app, 'listen').mockImplementation(async () => {
        state.listenCalls++;
        if (state.failure === 'listen')
          throw new Error('Synthetic listen failure');
        return 'synthetic';
      });
      if (state.buildGate) {
        state.buildPending = true;
        await state.buildGate;
      }
      return app;
    },
  };
});
afterEach(async () => {
  await state.app?.close();
  state.app = undefined;
  process.exitCode = 0;
  vi.restoreAllMocks();
  vi.resetModules();
});
it.each(['build', 'database', 'setup', 'seed', 'static', 'listen'])(
  'cleans its runtime after actual startup %s failure',
  async (failure) => {
    state.failure = failure;
    state.closed = false;
    state.databaseOpened = false;
    state.databaseClosed = false;
    const stderr = vi
      .spyOn(process.stderr, 'write')
      .mockImplementation(() => true);
    await import('../src/server/main.js');
    expect(process.exitCode).toBe(1);
    expect(existsSync(state.path)).toBe(false);
    if (failure === 'listen') expect(state.closed).toBe(true);
    expect(stderr).toHaveBeenCalled();
  },
);
it.each(['SIGINT', 'SIGTERM'])(
  'closes SQLite before cleanup on graceful %s',
  async (signal) => {
    state.failure = '';
    state.closed = false;
    state.databaseOpened = false;
    state.databaseClosed = false;
    vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
    await import('../src/server/main.js');
    expect(existsSync(state.path)).toBe(true);
    signals.get(signal)!();
    await state.app!.close();
    expect(state.closed).toBe(true);
    await vi.waitFor(() => expect(existsSync(state.path)).toBe(false));
  },
);

it.each(['SIGINT', 'SIGTERM'])(
  'serializes %s with pending setup and duplicate signals',
  async (signal) => {
    state.failure = '';
    state.closed = false;
    state.databaseOpened = false;
    state.databaseClosed = false;
    let release!: () => void;
    state.setupGate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const pending = import('../src/server/main.js');
    await vi.waitFor(() => expect(state.setupPending).toBe(true));
    const handler = signals.get(signal);
    expect(Boolean(handler)).toBe(true);
    handler!();
    handler!();
    signals.get(signal === 'SIGINT' ? 'SIGTERM' : 'SIGINT')!();
    expect(state.databaseClosed).toBe(false);
    expect(existsSync(state.path)).toBe(true);
    expect(state.cleanupCalls).toBe(0);
    release();
    await pending;
    expect(state.listenCalls).toBe(0);
    expect(state.databaseClosed).toBe(true);
    expect(state.cleanupCalls).toBe(1);
    expect(existsSync(state.path)).toBe(false);
  },
);
it.each(['SIGINT', 'SIGTERM'])(
  'serializes %s with pending completed-app build',
  async (signal) => {
    state.failure = '';
    state.closed = false;
    state.databaseOpened = false;
    state.databaseClosed = false;
    let release!: () => void;
    state.buildGate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const pending = import('../src/server/main.js');
    await vi.waitFor(() => expect(state.buildPending).toBe(true));
    const handler = signals.get(signal);
    expect(Boolean(handler)).toBe(true);
    handler!();
    handler!();
    expect(state.databaseClosed).toBe(false);
    expect(state.cleanupCalls).toBe(0);
    release();
    await pending;
    expect(state.listenCalls).toBe(0);
    expect(state.databaseClosed).toBe(true);
    expect(state.cleanupCalls).toBe(1);
    expect(existsSync(state.path)).toBe(false);
  },
);
it.each(['SIGINT', 'SIGTERM'])(
  'cleans rejected pending setup after %s without listening',
  async (signal) => {
    state.failure = 'setup';
    state.closed = false;
    state.databaseOpened = false;
    state.databaseClosed = false;
    let release!: () => void;
    state.setupGate = new Promise<void>((resolve) => {
      release = resolve;
    });
    vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
    const pending = import('../src/server/main.js');
    await vi.waitFor(() => expect(state.setupPending).toBe(true));
    const handler = signals.get(signal);
    expect(Boolean(handler)).toBe(true);
    handler!();
    handler!();
    expect(state.cleanupCalls).toBe(0);
    release();
    await pending;
    expect(state.listenCalls).toBe(0);
    expect(state.databaseClosed).toBe(true);
    expect(state.cleanupCalls).toBe(1);
    expect(existsSync(state.path)).toBe(false);
    expect(process.exitCode).toBe(1);
  },
);
