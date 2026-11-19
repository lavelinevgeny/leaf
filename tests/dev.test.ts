import { spawn, type ChildProcess } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { createServer, type Server } from 'node:net';
import { tmpdir } from 'node:os';
import { join, sep } from 'node:path';
import { expect, it } from 'vitest';
import { createServer as createViteServer } from 'vite';
import viteConfig from '../vite.config.js';
import { Auth } from '../src/server/auth.js';
import { openDatabase } from '../src/server/database.js';

it('dev watches source changes without traversing generated or private directories', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'leaf-dev-watch-'));
  const ignoredDirectories = [
    '.tmp',
    '.superpowers',
    '.worktrees',
    'worktrees',
    '.codex',
    '.claude',
    '.tools',
    '.data',
    'data',
    'secrets',
    '.private',
    '.local',
    'backups',
    'exports',
    'uploads',
    'logs',
    'dist',
    'build',
    'coverage',
    'artifacts',
    'screenshots',
    'playwright-report',
    'blob-report',
  ];
  let server: Awaited<ReturnType<typeof createViteServer>> | undefined;
  try {
    const sourceDirectory = join(directory, 'src');
    const source = join(sourceDirectory, 'watched.ts');
    await mkdir(sourceDirectory);
    await writeFile(source, 'export const value = 1;');
    for (const name of ignoredDirectories) {
      const nested = join(directory, name, 'synthetic', 'nested');
      await mkdir(nested, { recursive: true });
      await writeFile(join(nested, 'ignored.ts'), 'export const value = 1;');
    }
    server = await createViteServer({
      ...viteConfig,
      configFile: false,
      envFile: false,
      root: directory,
      plugins: [],
      publicDir: false,
      cacheDir: join(directory, 'node_modules', '.vite'),
      appType: 'custom',
      logLevel: 'silent',
      optimizeDeps: { noDiscovery: true, include: [] },
      server: {
        ...viteConfig.server,
        middlewareMode: true,
        ws: false,
        // Exercise traversal and change events without the host's inotify quota.
        watch: { ...viteConfig.server?.watch, usePolling: true },
      },
    });
    const watcher = server.watcher;
    const changes: string[] = [];
    const errors: Error[] = [];
    watcher.on('change', (path) => changes.push(path));
    watcher.on('error', (error) => errors.push(error));
    await expect
      .poll(() => watcher.getWatched()[sourceDirectory])
      .toContain('watched.ts');
    let revision = 1;
    await expect
      .poll(async () => {
        // Initial directory discovery can precede file watcher registration.
        await writeFile(source, `export const value = ${++revision};`);
        return { changes, errors };
      })
      .toEqual({ changes: expect.arrayContaining([source]), errors: [] });
    const watchedDirectories = Object.keys(watcher.getWatched());
    for (const name of ignoredDirectories)
      expect(
        watchedDirectories.some(
          (path) =>
            path === join(directory, name) ||
            path.startsWith(`${join(directory, name)}${sep}`),
        ),
        `${name} must not consume recursive watchers`,
      ).toBe(false);
  } finally {
    try {
      await server?.close();
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  }
});

it('dev proxies a custom server port, enforces browser origin and stops both children gracefully', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'leaf-dev-test-'));
  let socket: Server | undefined;
  let frontendSocket: Server | undefined;
  let child: ChildProcess | undefined;
  let exit: Promise<number | null> | undefined;
  let port = 0;
  let devOrigin = '';
  try {
    const password = randomBytes(24).toString('base64url');
    const db = openDatabase(join(directory, 'leaf.sqlite'));
    try {
      await new Auth(db).setup(password);
    } finally {
      db.close();
    }
    socket = createServer();
    await new Promise<void>((resolve, reject) => {
      socket!.once('error', reject);
      socket!.listen(0, '127.0.0.1', resolve);
    });
    const address = socket.address();
    if (!address || typeof address === 'string')
      throw new Error('No test port');
    port = address.port;
    frontendSocket = createServer();
    await new Promise<void>((resolve, reject) => {
      frontendSocket!.once('error', reject);
      frontendSocket!.listen(0, '127.0.0.1', resolve);
    });
    const frontendAddress = frontendSocket.address();
    if (!frontendAddress || typeof frontendAddress === 'string')
      throw new Error('No frontend test port');
    const frontendPort = frontendAddress.port;
    devOrigin = `http://127.0.0.1:${frontendPort}`;
    await new Promise<void>((resolve, reject) =>
      frontendSocket!.close((error) => (error ? reject(error) : resolve())),
    );
    await new Promise<void>((resolve, reject) =>
      socket!.close((error) => (error ? reject(error) : resolve())),
    );
    const environment: NodeJS.ProcessEnv = {
      ...process.env,
      LEAF_DATA_DIR: directory,
      LEAF_PORT: String(port),
      LEAF_DEV_PORT: String(frontendPort),
    };
    // Exercise the launcher's default origin for this disposable frontend port.
    delete environment.LEAF_PUBLIC_ORIGIN;
    const current = spawn(process.execPath, ['scripts/dev.mjs'], {
      stdio: 'ignore',
      env: environment,
    });
    child = current;
    let failed = false;
    exit = new Promise((resolve) => {
      current.once('error', () => {
        failed = true;
      });
      current.once('close', resolve);
    });
    // Wait for actual readiness; cold CI startup can exceed the old 1.5s budget.
    await expect
      .poll(
        async () => {
          if (
            failed ||
            current.exitCode !== null ||
            current.signalCode !== null
          )
            throw new Error('Dev process exited early');
          try {
            return (
              await fetch(`${devOrigin}/readyz`, {
                signal: AbortSignal.timeout(200),
              })
            ).ok;
          } catch {
            return false;
          }
        },
        { timeout: 10_000, interval: 50 },
      )
      .toBe(true);
    expect((await fetch(devOrigin)).status).toBe(200);
    expect((await fetch(`${devOrigin}/api/projects`)).status).toBe(401);
    expect(
      (
        await fetch(`${devOrigin}/api/auth/login`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Origin: devOrigin },
          body: JSON.stringify({ password }),
        })
      ).status,
    ).toBe(200);
    expect(
      (
        await fetch(`${devOrigin}/api/auth/login`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Origin: `http://127.0.0.1:${port}`,
          },
          body: JSON.stringify({ password }),
        })
      ).status,
    ).toBe(403);
  } finally {
    try {
      if (frontendSocket?.listening)
        await new Promise<void>((resolve, reject) =>
          frontendSocket!.close((error) => (error ? reject(error) : resolve())),
        );
      if (socket?.listening)
        await new Promise<void>((resolve, reject) =>
          socket!.close((error) => (error ? reject(error) : resolve())),
        );
    } finally {
      try {
        if (child && exit) {
          const current = child;
          let timedOut = false;
          const timeout = setTimeout(() => {
            timedOut = true;
            current.kill('SIGKILL');
          }, 5000);
          try {
            if (current.exitCode === null && current.signalCode === null)
              current.kill('SIGTERM');
            // Wait for closure even after SIGKILL before deleting the owned DB.
            const code = await exit;
            expect(timedOut).toBe(false);
            expect(code).toBe(0);
          } finally {
            clearTimeout(timeout);
          }
        }
      } finally {
        await rm(directory, { recursive: true, force: true });
      }
    }
  }
  await expect(
    fetch(`${devOrigin}/healthz`, { signal: AbortSignal.timeout(500) }),
  ).rejects.toThrow();
  await expect(
    fetch(`http://127.0.0.1:${port}/healthz`, {
      signal: AbortSignal.timeout(500),
    }),
  ).rejects.toThrow();
});
