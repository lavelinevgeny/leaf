#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';
import { readWorkspaceFile } from './repository-files.mjs';
import { codexProfile } from './agent-profile.mjs';

export function inspectEnvironment(root) {
  const checks = [];
  const check = (id, ok) => checks.push({ id, ok: Boolean(ok) });
  const command = (cmd, args) => spawnSync(cmd, args, { cwd: root, encoding: 'utf8' });
  const target = command('git', ['rev-parse', '--show-toplevel']);
  check('git-root', target.status === 0 && path.resolve(target.stdout.trim()) === path.resolve(root));
  const nodePin = readWorkspaceFile(root, '.nvmrc').toString('utf8').trim();
  const validPin = /^\d+(?:\.\d+\.\d+)?$/.test(nodePin);
  const major = Number(nodePin.split('.')[0]);
  check('node-major', validPin && Number(process.versions.node.split('.')[0]) === major);
  check('node-version', validPin && (nodePin.includes('.') ? process.versions.node === nodePin : Number(process.versions.node.split('.')[0]) === major));
  check('npm', command('npm', ['--version']).status === 0);
  const leaks = command('gitleaks', ['version']);
  const version = /\b(\d+)\.(\d+)\.(\d+)\b/.exec(leaks.stdout ?? '');
  check('gitleaks-version', leaks.status === 0 && version && Number(version[1]) === 8 && (Number(version[2]) > 30 || Number(version[2]) === 30 && Number(version[3]) >= 1));
  const hooks = command('git', ['config', '--get', 'core.hooksPath']);
  check('hooks-path', hooks.status === 0 && path.resolve(root, hooks.stdout.trim()) === path.join(root, '.githooks'));
  for (const hook of ['pre-commit', 'commit-msg', 'pre-push']) {
    const file = path.join(root, '.githooks', hook);
    check(`hook-${hook}`, fs.existsSync(file) && !fs.lstatSync(file).isSymbolicLink() && fs.statSync(file).isFile() && (process.platform === 'win32' || fs.statSync(file).mode & 0o111));
  }
  const claude = JSON.parse(readWorkspaceFile(root, '.claude/settings.json'));
  const privateReadRules = ['Read(/**/.env)', 'Read(/**/.env.*)', 'Read(/**/data/**)', 'Read(/**/uploads/**)', 'Read(/**/logs/**)', 'Read(~/.codex/**)'];
  check('claude-safety-config', claude.permissions?.blockReadsOutsideWorkingDirectories === true && privateReadRules.every((rule) => claude.permissions.deny?.includes(rule)) && claude.sandbox?.enabled === true && claude.sandbox.failIfUnavailable === true && claude.sandbox.allowUnsandboxedCommands === false && claude.sandbox.excludedCommands?.length === 0 && claude.sandbox.filesystem?.denyRead?.includes('~/') && claude.sandbox.filesystem.allowRead?.includes('.') && claude.sandbox.network?.allowedDomains?.length === 0);
  const codex = codexProfile(root);
  const privateGlobs = ['**/.env', '**/.env.*', 'data', '*/**/data/**', 'uploads', '*/**/uploads/**', 'logs', '*/**/logs/**', '**/.codex/**'];
  check('codex-safety-config', codex.extends === ':workspace' && codex.filesystem?.[':root'] === 'deny' && codex.filesystem?.[':minimal'] === 'read' && privateGlobs.every((glob) => codex.filesystem[':workspace_roots']?.[glob] === 'deny') && codex.network?.enabled === false);
  return checks;
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  try {
    if (process.argv.length !== 2) throw new Error('Unexpected arguments.');
    const checks = inspectEnvironment(process.cwd());
    for (const check of checks) console.log(`${check.ok ? 'PASS' : 'FAIL'} ${check.id}`);
    console.log('Configuration checks do not verify an active agent sandbox or remote repository settings.');
    if (checks.some((check) => !check.ok)) process.exitCode = 1;
  } catch {
    console.error('Doctor failed closed; inspect public configuration and tools locally. Details suppressed.');
    process.exitCode = 2;
  }
}
