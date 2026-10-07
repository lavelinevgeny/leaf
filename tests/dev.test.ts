import { spawn } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, it } from 'vitest';
import { Auth } from '../src/server/auth.js';
import { openDatabase } from '../src/server/database.js';

it('dev proxies a custom server port, enforces browser origin and stops both children gracefully', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'leaf-dev-test-'));
  const password = randomBytes(24).toString('base64url');
  const db = openDatabase(join(directory, 'leaf.sqlite'));
  try {
    await new Auth(db).setup(password);
  } finally {
    db.close();
  }
  const socket = createServer();
  await new Promise<void>((resolve) => socket.listen(0, '127.0.0.1', resolve));
  const address = socket.address();
  if (!address || typeof address === 'string') throw new Error('No test port');
  const port = address.port;
  await new Promise<void>((resolve) => socket.close(() => resolve()));
  const child = spawn(process.execPath, ['scripts/dev.mjs'], {
    stdio: 'ignore',
    env: { ...process.env, LEAF_DATA_DIR: directory, LEAF_PORT: String(port) },
  });
  const exit = new Promise<number | null>((resolve) =>
    child.once('exit', resolve),
  );
  const devOrigin = 'http://127.0.0.1:5173';
  try {
    let ready = false;
    for (let attempt = 0; attempt < 30; attempt++) {
      if (child.exitCode !== null) throw new Error('Dev process exited early');
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
    child.kill('SIGTERM');
    let timeout: ReturnType<typeof setTimeout> | undefined;
    const code = await Promise.race([
      exit,
      new Promise<never>((_, reject) => {
        timeout = setTimeout(() => {
          child.kill('SIGKILL');
          reject(new Error('Dev shutdown timed out'));
        }, 5000);
      }),
    ]);
    clearTimeout(timeout);
    await rm(directory, { recursive: true, force: true });
    expect(code).toBe(0);
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
