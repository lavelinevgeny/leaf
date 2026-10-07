import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdtemp, rm, readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { tmpdir } from 'node:os';
import { join, resolve, sep } from 'node:path';
import { pathToFileURL } from 'node:url';
import type { Page } from '@playwright/test';
const execFileAsync = promisify(execFile);
export const PINNED_S3_SHA = '6317791dff9dc944de3a1676effebcf1322b2ff6';
export async function buildPinnedS3() {
  const root = await mkdtemp(join(tmpdir(), 'leaf-pinned-s3-'));
  // Build subprocesses inherit only the pinned tool PATH, never account env.
  const buildEnvironment = { PATH: process.env.PATH };
  try {
    const archive = join(root, 'source.tar');
    await execFileAsync(
      'git',
      [
        'archive',
        '--format=tar',
        `--output=${archive}`,
        PINNED_S3_SHA,
        '--',
        'package.json',
        'package-lock.json',
        'tsconfig.json',
        'tsconfig.server.json',
        'vite.config.ts',
        'index.html',
        'src',
        'migrations',
      ],
      { cwd: process.cwd() },
    );
    await execFileAsync('tar', ['-xf', archive, '-C', root]);
    for (const path of ['src/client/api.ts', 'src/client/App.tsx']) {
      const original = (
        await execFileAsync('git', ['show', `${PINNED_S3_SHA}:${path}`], {
          cwd: process.cwd(),
        })
      ).stdout;
      const extracted = await readFile(join(root, path));
      if (
        createHash('sha256').update(original).digest('hex') !==
        createHash('sha256').update(extracted).digest('hex')
      )
        throw new Error('Pinned source provenance mismatch');
    }
    const userConfig = join(root, 'npm-user.conf');
    const globalConfig = join(root, 'npm-global.conf');
    await writeFile(userConfig, '');
    await writeFile(globalConfig, '');
    const configArgs = [
      `--userconfig=${userConfig}`,
      `--globalconfig=${globalConfig}`,
    ];
    await execFileAsync(
      'npm',
      [
        ...configArgs,
        'ci',
        '--offline',
        '--ignore-scripts',
        '--strict-allow-scripts',
        '--no-audit',
        '--no-fund',
      ],
      { cwd: root, env: buildEnvironment, maxBuffer: 4 * 1024 * 1024 },
    );
    await execFileAsync('npm', [...configArgs, 'run', 'build'], {
      cwd: root,
      env: buildEnvironment,
      maxBuffer: 4 * 1024 * 1024,
    });
    await execFileAsync(
      process.execPath,
      [
        '--input-type=module',
        '-e',
        "import {build} from 'vite'; await build({configFile:false,build:{outDir:'probe',lib:{entry:'src/client/api.ts',formats:['es'],fileName:()=> 'old-api-probe.mjs'}}});",
      ],
      { cwd: root, env: buildEnvironment, maxBuffer: 4 * 1024 * 1024 },
    );
    return {
      root,
      clientRoot: join(root, 'dist/client'),
      apiProbeUrl: pathToFileURL(join(root, 'probe/old-api-probe.mjs')).href,
      close: () => rm(root, { recursive: true, force: true }),
    };
  } catch (error) {
    await rm(root, { recursive: true, force: true });
    throw error;
  }
}
export async function mountPinnedS3(
  page: Page,
  origin: string,
  clientRoot: string,
) {
  await page.route('**/*', async (route) => {
    const url = new URL(route.request().url());
    if (url.origin !== origin) return route.abort();
    if (
      url.pathname.startsWith('/api/') ||
      ['/healthz', '/readyz'].includes(url.pathname)
    )
      return route.continue(); // настоящий upgraded server, API не mocked
    if (url.pathname !== '/' && !url.pathname.startsWith('/assets/'))
      return route.abort();
    const file = resolve(
      clientRoot,
      url.pathname === '/'
        ? 'index.html'
        : `.${decodeURIComponent(url.pathname)}`,
    );
    if (!file.startsWith(resolve(clientRoot) + sep)) return route.abort();
    await route.fulfill({ path: file }); // только реально собранный pinned HTML/JS/CSS
  });
}
