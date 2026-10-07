import { spawn, type ChildProcess } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { createServer, type Server } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, it } from 'vitest';
import { Auth } from '../src/server/auth.js';
import { openDatabase } from '../src/server/database.js';

it('dev proxies a custom server port, enforces browser origin and stops both children gracefully', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'leaf-dev-test-'));
  let socket: Server | undefined;
  let child: ChildProcess | undefined;
  let exit: Promise<number | null> | undefined;
  let port = 0;
  const devOrigin = 'http://127.0.0.1:5173';
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
    await new Promise<void>((resolve, reject) =>
      socket!.close((error) => (error ? reject(error) : resolve())),
    );
    const current = spawn(process.execPath, ['scripts/dev.mjs'], {
      stdio: 'ignore',
      env: {
        ...process.env,
        LEAF_DATA_DIR: directory,
        LEAF_PORT: String(port),
      },
    });
    child = current;
    let failed = false;
    exit = new Promise((resolve) => {
      current.once('error', () => {
        failed = true;
      });
      current.once('close', resolve);
    });
    let ready = false;
    for (let attempt = 0; attempt < 30; attempt++) {
      if (failed || current.exitCode !== null || current.signalCode !== null)
        throw new Error('Dev process exited early');
      try {
        if (
          (
            await fetch(`${devOrigin}/readyz`, {
              signal: AbortSignal.timeout(200),
            })
          ).ok
        ) {
          ready = true;
          break;
        }
      } catch {
        /* Real process startup. */
      }
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
    expect(ready).toBe(true);
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
