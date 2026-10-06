#!/usr/bin/env node
/** Fail-closed wrapper. Gitleaks must be installed separately from official sources. */
import { spawnSync } from 'node:child_process';

const mode = process.argv[2];
if (!['--staged', '--history'].includes(mode) || process.argv.length > 3) {
  console.error('Usage: node scripts/run-gitleaks.mjs --staged|--history');
  process.exit(2);
}
const probe = spawnSync('gitleaks', ['version'], { encoding: 'utf8' });
if (probe.error || probe.status !== 0) {
  console.error('Gitleaks is unavailable. Publication blocked. Install the verified tool per docs/BOOTSTRAP.md; do not bypass the hook.');
  process.exit(2);
}
let input;
let args;
if (mode === '--staged') {
  const diff = spawnSync('git', ['diff', '--cached', '--no-ext-diff', '--no-textconv', '--no-color', '--unified=0'], { maxBuffer: 64 * 1024 * 1024 });
  if (diff.error || diff.status !== 0) {
    console.error('Unable to read staged diff; publication blocked.');
    process.exit(2);
  }
  input = diff.stdout;
  args = ['stdin', '--redact=100', '--no-banner', '--config=.gitleaks.toml'];
} else args = ['git', '--redact=100', '--no-banner', '--config=.gitleaks.toml', '--log-opts=--all', '.'];
// Only redacted scanner output is permitted. No raw patches are printed.
const result = spawnSync('gitleaks', args, { input, encoding: 'utf8', maxBuffer: 16 * 1024 * 1024 });
if (result.error) {
  console.error('Gitleaks execution failed; publication blocked.');
  process.exit(2);
}
if (result.stdout) process.stdout.write(result.stdout);
if (result.stderr) process.stderr.write(result.stderr);
process.exit(result.status ?? 2);
