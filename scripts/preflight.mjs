#!/usr/bin/env node
import { spawnSync } from 'node:child_process';

if (process.argv.length !== 2) {
  console.error('Usage: npm run preflight');
  process.exit(2);
}
const tasks = [
  ['doctor', ['scripts/doctor.mjs']],
  ['workspace privacy', ['scripts/security-check.mjs', '--workspace']],
  ['kit validation', ['scripts/check-kit.mjs']],
  ['harness tests', ['--test', 'scripts/security.test.mjs', 'scripts/harness.test.mjs']],
  ['uncommitted workspace secrets', ['scripts/run-gitleaks.mjs', '--workspace']],
  ['index privacy', ['scripts/security-check.mjs', '--tracked']],
  ['history and metadata privacy', ['scripts/security-check.mjs', '--history']],
  ['history and metadata secrets', ['scripts/run-gitleaks.mjs', '--history']],
];
let failed = false;
for (const [name, args] of tasks) {
  console.log(`Checking ${name}`);
  const result = spawnSync(process.execPath, args, { stdio: 'inherit' });
  if (result.error || result.status !== 0) {
    failed = true;
    // Never let kit checks or test runs read a workspace refused by the guard.
    if (name === 'doctor' || name === 'workspace privacy') break;
  }
}
console.log(failed ? 'Preflight refused publication; resolve the failed checks.' : 'Local preflight passed. Owner review and remote protection are still required before publication.');
process.exitCode = failed ? 1 : 0;
