import { existsSync } from 'node:fs';
import { buildApp } from './app.js';
import { loadConfig } from './config.js';

try {
  const config = loadConfig();
  const app = await buildApp({
    databasePath: config.databasePath,
    publicOrigin: config.publicOrigin,
    ...(existsSync(config.staticRoot) ? { staticRoot: config.staticRoot } : {}),
  });
  for (const signal of ['SIGINT', 'SIGTERM'] as const)
    process.once(signal, () => {
      void app.close().catch(() => {
        process.exitCode = 1;
      });
    });
  try {
    await app.listen({ host: config.host, port: config.port });
    process.stdout.write('leaf server is ready.\n');
  } catch {
    await app.close();
    throw new Error('Server could not listen');
  }
} catch {
  process.stderr.write(
    'leaf could not start. Check runtime configuration and storage.\n',
  );
  process.exitCode = 1;
}
