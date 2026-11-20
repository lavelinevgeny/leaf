import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { afterEach, expect, it, vi } from 'vitest';
import { installPinnedS3Dependencies } from './helpers/pinned-s3.js';

const execFileAsync = promisify(execFile);
afterEach(() => vi.unstubAllEnvs());

it('installs a historical lockfile from a cold cache without account config or lifecycle scripts', async () => {
  const root = await mkdtemp(join(tmpdir(), 'leaf-pinned-install-test-'));
  const server = createServer();
  try {
    const packageRoot = join(root, 'fixture', 'package');
    await mkdir(packageRoot, { recursive: true });
    await writeFile(
      join(packageRoot, 'package.json'),
      JSON.stringify({
        name: 'synthetic-pinned',
        version: '1.0.0',
        scripts: { install: 'node -e "process.exit(99)"' },
      }),
    );
    await writeFile(join(packageRoot, 'index.js'), 'export const value = 1;\n');
    const archive = join(root, 'synthetic-pinned.tgz');
    await execFileAsync('tar', [
      '-czf',
      archive,
      '-C',
      join(root, 'fixture'),
      'package',
    ]);
    const bytes = await readFile(archive);
    const requests: string[] = [];
    server.on('request', (request, response) => {
      requests.push(request.url ?? '');
      if (request.url !== '/synthetic-pinned-1.0.0.tgz') {
        response.writeHead(404).end();
        return;
      }
      response.writeHead(200, { 'Content-Type': 'application/octet-stream' });
      response.end(bytes);
    });
    await new Promise<void>((resolve, reject) => {
      server.once('error', reject);
      server.listen(0, '127.0.0.1', resolve);
    });
    const address = server.address();
    if (!address || typeof address === 'string')
      throw new Error('No test port');
    const resolved = `http://127.0.0.1:${address.port}/synthetic-pinned-1.0.0.tgz`;
    await writeFile(
      join(root, 'package.json'),
      JSON.stringify({
        name: 'synthetic-historical-client',
        version: '1.0.0',
        dependencies: { 'synthetic-pinned': '1.0.0' },
        scripts: { preinstall: 'node -e "process.exit(99)"' },
      }),
    );
    const lockfile = JSON.stringify({
      name: 'synthetic-historical-client',
      version: '1.0.0',
      lockfileVersion: 3,
      packages: {
        '': {
          name: 'synthetic-historical-client',
          version: '1.0.0',
          dependencies: { 'synthetic-pinned': '1.0.0' },
        },
        'node_modules/synthetic-pinned': {
          version: '1.0.0',
          resolved,
          integrity: `sha512-${createHash('sha512').update(bytes).digest('base64')}`,
          hasInstallScript: true,
        },
      },
    });
    await writeFile(join(root, 'package-lock.json'), lockfile);
    const accountConfig = join(root, 'synthetic-account.conf');
    await writeFile(accountConfig, 'offline=true\nignore-scripts=false\n');
    vi.stubEnv('NPM_CONFIG_USERCONFIG', accountConfig);
    vi.stubEnv('npm_config_offline', 'true');
    vi.stubEnv('npm_config_ignore_scripts', 'false');

    // The old offline-only installation cannot obtain this unique tarball.
    const emptyUserConfig = join(root, 'empty-user.conf');
    const emptyGlobalConfig = join(root, 'empty-global.conf');
    await writeFile(emptyUserConfig, '');
    await writeFile(emptyGlobalConfig, '');
    await expect(
      execFileAsync(
        'npm',
        [
          `--userconfig=${emptyUserConfig}`,
          `--globalconfig=${emptyGlobalConfig}`,
          `--cache=${join(root, 'npm-cache')}`,
          'ci',
          '--offline',
          '--ignore-scripts',
          '--strict-allow-scripts',
          '--no-audit',
          '--no-fund',
        ],
        { cwd: root, env: { PATH: process.env.PATH } },
      ),
    ).rejects.toMatchObject({ stderr: expect.stringContaining('ENOTCACHED') });
    expect(requests).toEqual([]);

    await installPinnedS3Dependencies(root);
    expect(
      JSON.parse(
        await readFile(
          join(root, 'node_modules/synthetic-pinned/package.json'),
          'utf8',
        ),
      ).version,
    ).toBe('1.0.0');
    expect(await readFile(join(root, 'package-lock.json'), 'utf8')).toBe(
      lockfile,
    );
    expect(requests).toEqual(['/synthetic-pinned-1.0.0.tgz']);

    // A second installation works from the prepared cache with no registry.
    await new Promise<void>((resolve, reject) =>
      server.close((error) => (error ? reject(error) : resolve())),
    );
    await installPinnedS3Dependencies(root);
    expect(requests).toHaveLength(1);
  } finally {
    try {
      if (server.listening)
        await new Promise<void>((resolve, reject) =>
          server.close((error) => (error ? reject(error) : resolve())),
        );
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  }
});
