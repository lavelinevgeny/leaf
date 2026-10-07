#!/usr/bin/env node
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
const tasks = [
  ['doctor', ['scripts/doctor.mjs']],
  ['workspace privacy', ['scripts/security-check.mjs', '--workspace']],
  ['kit validation', ['scripts/check-kit.mjs']],
  ['harness tests', ['--test', 'scripts/security.test.mjs', 'scripts/harness.test.mjs']],
  ['uncommitted workspace secrets', ['scripts/run-gitleaks.mjs', '--workspace']],
  ['index privacy', ['scripts/security-check.mjs', '--tracked']],
  ['staged secrets', ['scripts/run-gitleaks.mjs', '--staged']],
  ['history and metadata privacy', ['scripts/security-check.mjs', '--history']],
  ['history and metadata secrets', ['scripts/run-gitleaks.mjs', '--history']],
];
export function runPreflight({ cwd = process.cwd(), run = spawnSync, log = console.log } = {}) {
  let failed = false;
  for (const [name, args] of tasks) {
    log(`Checking ${name}`);
    const result = run(process.execPath, args, { cwd, stdio: 'inherit' });
    if (result.error || result.status !== 0) {
      failed = true;
      // Never let kit checks or test runs read a workspace refused by the guard.
      if (name === 'doctor' || name === 'workspace privacy') break;
    }
  }
  log(failed ? 'Preflight refused publication; resolve the failed checks.' : 'Local preflight passed. Owner review and remote protection are still required before publication.');
  return failed ? 1 : 0;
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  if (process.argv.length !== 2) {
    console.error('Usage: npm run preflight');
    process.exitCode = 2;
  } else process.exitCode = runPreflight();
}
