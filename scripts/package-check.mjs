import { readFileSync, readdirSync, lstatSync } from 'node:fs';
import { join } from 'node:path';

const expected = [
  '**',
  '!Dockerfile',
  '!.dockerignore',
  '!package.json',
  '!package-lock.json',
  '!tsconfig.json',
  '!tsconfig.server.json',
  '!vite.config.ts',
  '!index.html',
  '!src/',
  '!src/**/',
  '!src/**/*.ts',
  '!src/**/*.tsx',
  '!src/**/*.css',
  '!migrations/',
  '!migrations/001-initial.sql',
  '!migrations/002-scheduling.sql',
  '!migrations/003-optional-scheduling.sql',
];
const rules = readFileSync('.dockerignore', 'utf8')
  .split('\n')
  .map((line) => line.trim())
  .filter((line) => line && !line.startsWith('#'));
if (JSON.stringify(rules) !== JSON.stringify(expected))
  throw new Error('Docker build allowlist needs review');
function inspect(directory) {
  for (const entry of readdirSync(directory)) {
    const path = join(directory, entry);
    const stat = lstatSync(path);
    if (stat.isSymbolicLink())
      throw new Error('Source symlinks are not package inputs');
    if (stat.isDirectory()) inspect(path);
    else if (!/\.(ts|tsx|css)$/.test(path))
      throw new Error('Unexpected source package input');
  }
}
inspect('src');
const docker = readFileSync('Dockerfile', 'utf8');
if (
  /^COPY\s+\.\s/m.test(docker) ||
  !docker.includes('USER node') ||
  !docker.includes('HEALTHCHECK')
)
  throw new Error('Runtime package boundary failed');
console.log(
  'Package boundary passed: deny-default context, source-only inputs, non-root runtime and healthcheck.',
);
