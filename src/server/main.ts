import { existsSync } from 'node:fs';
import { buildApp } from './app.js';
import { prepareServerRuntime, type ServerRuntime } from './demo-runtime.js';
import type { LeafApp } from './app.js';

let config: ServerRuntime | undefined;
let app: LeafApp | undefined;
let initialization: Promise<LeafApp> | undefined;
let shutdownRequested = false;
let closing: Promise<void> | undefined;
function shutdown(): Promise<void> {
  shutdownRequested = true;
  closing ??= (async () => {
    try {
      // buildApp owns SQLite until it either returns an app or closes on error.
      // Never remove its directory while async account setup is still pending.
      if (!app && initialization) {
        try {
          app = await initialization;
        } catch {
          // A rejected build has already closed its database.
        }
      }
      await app?.close();
    } finally {
      config?.cleanup();
    }
  })();
  return closing;
}
try {
  config = prepareServerRuntime();
  for (const signal of ['SIGINT', 'SIGTERM'] as const)
    process.on(signal, () => {
      void shutdown().catch(() => {
        process.exitCode = 1;
      });
    });
  initialization = buildApp({
    demoMode: config.demoMode,
    databasePath: config.databasePath,
    publicOrigin: config.publicOrigin,
    ...(existsSync(config.staticRoot) ? { staticRoot: config.staticRoot } : {}),
  });
  app = await initialization;
  if (shutdownRequested) {
    await shutdown();
  } else {
    await app.listen({ host: config.host, port: config.port });
    if (shutdownRequested) await shutdown();
    else process.stdout.write('leaf server is ready.\n');
  }
} catch {
  await shutdown().catch(() => {
    process.exitCode = 1;
  });
  process.stderr.write(
    'leaf could not start. Check runtime configuration and storage.\n',
  );
  process.exitCode = 1;
}
