import { spawn, type ChildProcess } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { createServer, type Server } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Auth } from '../src/server/auth.js';
import { openDatabase } from '../src/server/database.js';

export async function syntheticRuntime() {
  const directory = await mkdtemp(join(tmpdir(), 'leaf-e2e-'));
  let socket: Server | undefined;
  let child: ChildProcess | undefined;
  let childClosed: Promise<number | null> | undefined;
  async function stop() {
    if (!child || !childClosed) return;
    const current = child;
    let timedOut = false;
    const timeout = setTimeout(() => {
      timedOut = true;
      current.kill('SIGKILL');
    }, 5000);
    if (current.exitCode === null && current.signalCode === null)
      current.kill('SIGTERM');
    try {
      // Even forced shutdown must finish before removing this process's DB.
      const code = await childClosed;
      if (timedOut) throw new Error('Test server shutdown timed out');
      if (code !== 0) throw new Error('Test server shutdown was not graceful');
    } finally {
      clearTimeout(timeout);
      child = undefined;
      childClosed = undefined;
    }
  }
  async function close() {
    try {
      if (socket?.listening)
        await new Promise<void>((resolve, reject) =>
          socket!.close((error) => (error ? reject(error) : resolve())),
        );
    } finally {
      try {
        await stop();
      } finally {
        await rm(directory, { recursive: true, force: true });
      }
    }
  }
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
    const port = address.port;
    await new Promise<void>((resolve, reject) =>
      socket!.close((error) => (error ? reject(error) : resolve())),
    );
    const origin = `http://127.0.0.1:${port}`;
    async function start() {
      const current = spawn(process.execPath, ['dist/server/server/main.js'], {
        stdio: 'ignore',
        env: {
          ...process.env,
          LEAF_DATA_DIR: directory,
          LEAF_HOST: '127.0.0.1',
          LEAF_PORT: String(port),
          LEAF_PUBLIC_ORIGIN: origin,
        },
      });
      child = current;
      let failed = false;
      childClosed = new Promise((resolve) => {
        current.once('error', () => {
          failed = true;
        });
        current.once('close', resolve);
      });
      for (let attempt = 0; attempt < 100; attempt++) {
        if (failed || current.exitCode !== null || current.signalCode !== null)
          throw new Error('Test server exited');
        try {
          if (
            (
              await fetch(`${origin}/readyz`, {
                signal: AbortSignal.timeout(200),
              })
            ).ok
          )
            return;
        } catch {
          // Wait for the real process, never replace it with an HTTP mock.
        }
        await new Promise((resolve) => setTimeout(resolve, 50));
      }
      throw new Error('Test server did not become ready');
    }
    await start();
    return {
      origin,
      password,
      async restart() {
        await stop();
        await start();
      },
      close,
    };
  } catch (error) {
    await close();
    throw error;
  }
}
