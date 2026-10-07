import { spawn, type ChildProcess } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Auth } from '../src/server/auth.js';
import { openDatabase } from '../src/server/database.js';

export async function syntheticRuntime() {
  const directory = await mkdtemp(join(tmpdir(), 'leaf-e2e-'));
  const password = randomBytes(24).toString('base64url');
  const db = openDatabase(join(directory, 'leaf.sqlite'));
  try {
    await new Auth(db).setup(password);
  } finally {
    db.close();
  }
  const socket = createServer();
  await new Promise<void>((resolve, reject) => {
    socket.once('error', reject);
    socket.listen(0, '127.0.0.1', resolve);
  });
  const address = socket.address();
  if (!address || typeof address === 'string') throw new Error('No test port');
  const port = address.port;
  await new Promise<void>((resolve) => socket.close(() => resolve()));
  const origin = `http://127.0.0.1:${port}`;
  let child: ChildProcess | undefined;
  async function start() {
    child = spawn(process.execPath, ['dist/server/server/main.js'], {
      stdio: 'ignore',
      env: {
        ...process.env,
        LEAF_DATA_DIR: directory,
        LEAF_HOST: '127.0.0.1',
        LEAF_PORT: String(port),
        LEAF_PUBLIC_ORIGIN: origin,
      },
    });
    for (let attempt = 0; attempt < 100; attempt++) {
      if (child.exitCode !== null) throw new Error('Test server exited');
      try {
        if ((await fetch(`${origin}/readyz`)).ok) return;
      } catch {
        // Wait for the real process, never replace it with an HTTP mock.
      }
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
    throw new Error('Test server did not become ready');
  }
  async function stop() {
    if (!child || child.exitCode !== null) return;
    const current = child;
    const closed = new Promise<void>((resolve, reject) => {
      current.once('exit', (code) => {
        clearTimeout(timeout);
        if (code === 0) resolve();
        else reject(new Error('Test server shutdown was not graceful'));
      });
      const timeout = setTimeout(() => {
        current.kill('SIGKILL');
        reject(new Error('Test server shutdown timed out'));
      }, 5000);
    });
    current.kill('SIGTERM');
    await closed;
    child = undefined;
  }
  try {
    await start();
  } catch (error) {
    await stop();
    await rm(directory, { recursive: true, force: true });
    throw error;
  }
  return {
    origin,
    password,
    async restart() {
      await stop();
      await start();
    },
    async close() {
      try {
        await stop();
      } finally {
        await rm(directory, { recursive: true, force: true });
      }
    },
  };
}
