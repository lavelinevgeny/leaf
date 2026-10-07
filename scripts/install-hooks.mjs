#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

function git(args, optional = false) {
  const r = spawnSync('git', args, { encoding: 'utf8' });
  if (r.error || r.status !== 0) {
    if (optional) return null;
    throw new Error('Cannot access the local Git repository. No hooks were installed.');
  }
  return r.stdout.trim();
}
try {
  const kitRoot = fs.realpathSync(path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..'));
  const gitRoot = fs.realpathSync(git(['rev-parse', '--show-toplevel']));
  if (kitRoot !== gitRoot) throw new Error('Kit is not at the Git root. Merge it safely into the root; do not create a nested .git.');
  const existing = git(['config', '--get', 'core.hooksPath'], true);
  if (existing && path.resolve(gitRoot, existing) !== path.join(gitRoot, '.githooks')) throw new Error('An existing hooksPath is configured. Integrate manually; it was not overwritten.');
  if (!existing) {
    for (const hook of ['pre-commit', 'commit-msg', 'pre-push']) {
      const defaultPath = git(['rev-parse', '--git-path', `hooks/${hook}`]);
      if (fs.existsSync(defaultPath)) throw new Error(`An existing ${hook} hook is present. Integrate manually; it was not overwritten.`);
    }
  }
  for (const hook of ['pre-commit', 'commit-msg', 'pre-push']) fs.chmodSync(path.join(gitRoot, '.githooks', hook), 0o755);
  git(['config', '--local', 'core.hooksPath', '.githooks']);
  console.log('Local hooks installed. Gitleaks is required. No remote, credentials, identity or global Git settings were changed.');
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
}
