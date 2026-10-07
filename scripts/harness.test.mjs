import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { runGuard } from './security-check.mjs';
import { parseAssetManifest, validateCurrentAssets } from './public-assets.mjs';
import { inspectEnvironment } from './doctor.mjs';
import { codexConfigArgs } from './agent-profile.mjs';
import { checkCodexSandbox } from './agent-sandbox.mjs';
import { runPreflight } from './preflight.mjs';

const project = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const env = { ...process.env, GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: os.devNull };
const token = () => 'gh' + 'p_' + createHash('sha256').update('leaf synthetic invalid credential').digest('hex').slice(0, 36);
function git(dir, ...args) {
  const result = spawnSync('git', args, { cwd: dir, env, encoding: 'utf8' });
  assert.equal(result.status, 0, `Synthetic Git ${args[0]} failed; details suppressed.`);
  return result.stdout;
}
function write(dir, name, data) {
  fs.mkdirSync(path.dirname(path.join(dir, name)), { recursive: true });
  fs.writeFileSync(path.join(dir, name), data);
}
function repo(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'leaf-harness-test-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  git(dir, 'init', '-q');
  git(dir, 'config', '--local', 'user.name', 'Leaf Fixture');
  git(dir, 'config', '--local', 'user.email', 'fixture@example.test');
  for (const name of fs.readdirSync(path.join(project, 'scripts')).filter((name) => name.endsWith('.mjs') && !name.endsWith('.test.mjs'))) write(dir, `scripts/${name}`, fs.readFileSync(path.join(project, 'scripts', name)));
  for (const name of ['.gitleaks.toml', '.nvmrc', '.claude/settings.json', 'config/agents/codex-permissions.json', '.githooks/pre-commit', '.githooks/commit-msg', '.githooks/pre-push']) write(dir, name, fs.readFileSync(path.join(project, name)));
  git(dir, 'add', '--', '.gitleaks.toml');
  return dir;
}
function node(dir, script, args = [], overrides = {}) {
  return spawnSync(process.execPath, [`scripts/${script}`, ...args], { cwd: dir, env: { ...env, ...overrides }, encoding: 'utf8' });
}
function committed(dir, message = 'synthetic fixture') {
  git(dir, '-c', 'commit.gpgsign=false', 'commit', '-q', '-m', message);
}

test('current asset validation permits retained historical hashes', (t) => {
  const dir = repo(t);
  const oldBytes = Buffer.from([0, 1, 2]);
  const currentBytes = Buffer.from([0, 3, 4]);
  const approval = (bytes) => ({ path: 'design/demo.png', sha256: createHash('sha256').update(bytes).digest('hex') });
  write(dir, 'design/demo.png', oldBytes);
  write(dir, 'config/public-assets.json', JSON.stringify({ version: 2, assets: [approval(oldBytes)], historicalAssets: [] }));
  git(dir, 'add', '--', 'design/demo.png', 'config/public-assets.json');
  committed(dir);
  write(dir, 'design/demo.png', currentBytes);
  const data = { version: 2, assets: [approval(currentBytes)], historicalAssets: [approval(oldBytes)] };
  write(dir, 'config/public-assets.json', JSON.stringify(data));
  const manifest = parseAssetManifest(Buffer.from(JSON.stringify(data)));
  assert.doesNotThrow(() => validateCurrentAssets(dir, manifest));
  git(dir, 'add', '--', 'design/demo.png', 'config/public-assets.json');
  assert.deepEqual(runGuard(dir, '--staged').findings, []);
  assert.deepEqual(runGuard(dir, '--history').findings, []);
  committed(dir);
  write(dir, 'design/demo.png', oldBytes);
  git(dir, 'add', '--', 'design/demo.png');
  assert.ok(runGuard(dir, '--staged').findings.some((x) => x.rule === 'UNREVIEWED_ASSET'));
});

test('asset manifest refuses private paths, duplicate current entries and malformed JSON', () => {
  const sha256 = 'a'.repeat(64);
  for (const assets of [[{ path: '.env', sha256 }], [{ path: '../demo.png', sha256 }], [{ path: 'demo.png', sha256 }, { path: 'demo.png', sha256: 'b'.repeat(64) }]]) assert.throws(() => parseAssetManifest(Buffer.from(JSON.stringify({ assets }))));
  assert.throws(() => parseAssetManifest(Buffer.from('{ invalid synthetic input')), /details suppressed/);
});

test('nested annotated tag messages are included in the metadata scan', (t) => {
  const dir = repo(t);
  write(dir, 'demo.txt', 'Synthetic task A');
  git(dir, 'add', '--', 'demo.txt');
  committed(dir);
  git(dir, '-c', 'tag.gpgsign=false', 'tag', '-a', 'inner', '-m', `synthetic ${token()}`);
  git(dir, '-c', 'tag.gpgsign=false', 'tag', '-a', 'outer', 'inner', '-m', 'synthetic outer');
  git(dir, 'tag', '-d', 'inner');
  assert.ok(runGuard(dir, '--history').findings.some((x) => x.path.startsWith('git:tag:') && x.rule === 'GITHUB_TOKEN'));
});

test('missing Gitleaks blocks instead of silently skipping', (t) => {
  const dir = repo(t);
  const emptyPath = path.join(dir, 'empty-tools');
  fs.mkdirSync(emptyPath);
  assert.equal(node(dir, 'run-gitleaks.mjs', ['--history'], { PATH: emptyPath }).status, 2);
});

test('real Gitleaks blocks full staged blobs and suppresses values', (t) => {
  const dir = repo(t);
  write(dir, 'demo.txt', token());
  git(dir, 'add', '--', 'demo.txt');
  write(dir, 'demo.txt', 'Synthetic clean working copy');
  const result = node(dir, 'run-gitleaks.mjs', ['--staged']);
  assert.equal(result.status, 1, 'Real scanner must be installed and detect the synthetic positive control.');
  assert.equal((result.stdout + result.stderr).includes(token()), false);
});

test('preflight rejects scanner-only staged secrets after the working copy is cleaned', (t) => {
  const dir = repo(t);
  write(dir, 'demo.txt', 'Synthetic clean baseline');
  git(dir, 'add', '--', '.');
  committed(dir);
  const marker = 'xo' + 'xb-' + '123456789012-123456789012-' + createHash('sha256').update('synthetic preflight index fixture').digest('hex').slice(0, 24);
  write(dir, 'demo.txt', marker);
  git(dir, 'add', '--', 'demo.txt');
  write(dir, 'demo.txt', 'Synthetic clean working copy');
  assert.deepEqual(runGuard(dir, '--tracked').findings, [], 'Positive control must require the real scanner.');
  const tree = git(dir, 'write-tree');
  const outputs = [];
  const execute = () => runPreflight({ cwd: dir, log: (message) => outputs.push(message), run: (command, args, options) => {
    // Isolate publication checks from host setup and recursive suite execution.
    // All privacy/scanner subprocesses below use real Git inputs and Gitleaks.
    if (['scripts/doctor.mjs', 'scripts/check-kit.mjs', '--test'].includes(args[0])) return { status: 0 };
    const result = spawnSync(command, args, { ...options, env, stdio: 'pipe', encoding: 'utf8' });
    outputs.push(result.stdout + result.stderr);
    return result;
  } });
  assert.equal(execute(), 1, 'Preflight must reject a secret present only in the index.');
  assert.equal(git(dir, 'write-tree'), tree, 'Preflight must preserve the index.');
  git(dir, 'add', '--', 'demo.txt');
  assert.equal(execute(), 0, 'Clean working files, index and history must pass.');
  write(dir, 'draft.txt', marker);
  assert.equal(execute(), 1, 'Uncommitted workspace secrets must remain blocked.');
  assert.equal(outputs.join('\n').includes(marker), false, 'Neither positive control may print a value.');
});

test('publication scans use indexed scanner policy when the working configuration is invalid', (t) => {
  const dir = repo(t);
  write(dir, 'demo.txt', 'Synthetic task A');
  git(dir, 'add', '--', 'demo.txt');
  committed(dir);
  write(dir, '.gitleaks.toml', '[synthetic invalid TOML');
  assert.equal(node(dir, 'run-gitleaks.mjs', ['--history']).status, 0, 'Working configuration must not replace the indexed history policy.');
  write(dir, '.git/COMMIT_EDITMSG', 'Synthetic clean commit message');
  assert.equal(node(dir, 'run-gitleaks.mjs', ['--message', path.join(dir, '.git/COMMIT_EDITMSG')]).status, 0, 'Pending messages must use the indexed policy too.');
  write(dir, 'next.txt', token());
  git(dir, 'add', '--', 'next.txt');
  write(dir, 'next.txt', 'Synthetic clean working copy');
  const result = node(dir, 'run-gitleaks.mjs', ['--staged']);
  assert.equal(result.status, 1, 'Indexed rules must detect the staged positive control.');
  assert.equal((result.stdout + result.stderr).includes(token()), false);
  assert.equal(node(dir, 'run-gitleaks.mjs', ['--workspace']).status, 2, 'Workspace scanning must validate its own working configuration.');
});

test('publication scans refuse an absent or nonregular indexed scanner configuration', (t) => {
  const dir = repo(t);
  git(dir, 'reset', '-q', '--', '.gitleaks.toml');
  assert.equal(node(dir, 'run-gitleaks.mjs', ['--staged']).status, 2);
  fs.unlinkSync(path.join(dir, '.gitleaks.toml'));
  write(dir, 'scanner-policy.txt', fs.readFileSync(path.join(project, '.gitleaks.toml')));
  fs.symlinkSync('scanner-policy.txt', path.join(dir, '.gitleaks.toml'));
  git(dir, 'add', '--', '.gitleaks.toml');
  assert.equal(node(dir, 'run-gitleaks.mjs', ['--history']).status, 2);
});

test('scanner policy snapshots are removed after findings and scanner failures', (t) => {
  const dir = repo(t);
  const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'leaf-scanner-cleanup-test-'));
  t.after(() => fs.rmSync(scratch, { recursive: true, force: true }));
  write(dir, 'demo.txt', token());
  git(dir, 'add', '--', 'demo.txt');
  assert.equal(node(dir, 'run-gitleaks.mjs', ['--staged'], { TMPDIR: scratch }).status, 1);
  assert.deepEqual(fs.readdirSync(scratch), []);
  write(dir, '.git/COMMIT_EDITMSG', token());
  assert.equal(node(dir, 'run-gitleaks.mjs', ['--message', path.join(dir, '.git/COMMIT_EDITMSG')], { TMPDIR: scratch }).status, 1);
  assert.deepEqual(fs.readdirSync(scratch), []);
  write(dir, '.gitleaks.toml', '[synthetic invalid TOML');
  git(dir, 'add', '--', '.gitleaks.toml');
  assert.equal(node(dir, 'run-gitleaks.mjs', ['--staged'], { TMPDIR: scratch }).status, 2);
  assert.deepEqual(fs.readdirSync(scratch), []);
});

test('staged scanning validates indexed rules even when no blobs changed', (t) => {
  const dir = repo(t);
  committed(dir);
  assert.equal(node(dir, 'run-gitleaks.mjs', ['--staged']).status, 0);
  write(dir, '.gitleaks.toml', '[synthetic invalid TOML');
  git(dir, 'add', '--', '.gitleaks.toml');
  committed(dir, 'Synthetic invalid scanner configuration');
  assert.equal(node(dir, 'run-gitleaks.mjs', ['--staged']).status, 2, 'Empty staged diff must not hide a broken scanner configuration.');
});

test('preflight stops before downstream checks when the workspace privacy guard refuses input', (t) => {
  const dir = repo(t);
  write(dir, 'data/demo.txt', 'Synthetic private fixture');
  const calls = [];
  const result = runPreflight({ cwd: dir, log: () => {}, run: (command, args, options) => {
    calls.push(args);
    if (args[0] === 'scripts/doctor.mjs') return { status: 0 };
    return spawnSync(command, args, { ...options, env, stdio: 'pipe', encoding: 'utf8' });
  } });
  assert.equal(result, 1);
  assert.deepEqual(calls, [['scripts/doctor.mjs'], ['scripts/security-check.mjs', '--workspace']]);
});

test('real Gitleaks detects metadata secrets with clean file history', (t) => {
  const dir = repo(t);
  write(dir, 'demo.txt', 'Synthetic task A');
  git(dir, 'add', '--', 'demo.txt');
  committed(dir, `synthetic ${token()}`);
  const result = node(dir, 'run-gitleaks.mjs', ['--history']);
  assert.equal(result.status, 1);
  assert.equal((result.stdout + result.stderr).includes(token()), false);
});

test('real Gitleaks passes clean synthetic history', (t) => {
  const dir = repo(t);
  write(dir, 'demo.txt', 'Synthetic task A');
  git(dir, 'add', '--', 'demo.txt');
  committed(dir);
  assert.equal(node(dir, 'run-gitleaks.mjs', ['--history']).status, 0);
});

test('inline scanner suppression does not exempt a staged secret', (t) => {
  const dir = repo(t);
  write(dir, 'demo.txt', `${token()} #gitleaks:allow`);
  git(dir, 'add', '--', 'demo.txt');
  assert.equal(node(dir, 'run-gitleaks.mjs', ['--staged']).status, 1);
});

test('hook installer preserves a conflicting hooksPath', (t) => {
  const dir = repo(t);
  git(dir, 'config', '--local', 'core.hooksPath', 'other-hooks');
  assert.equal(node(dir, 'install-hooks.mjs').status, 1);
  assert.equal(git(dir, 'config', '--get', 'core.hooksPath').trim(), 'other-hooks');
});

test('hook installer preserves an existing commit-message hook', (t) => {
  const dir = repo(t);
  const hook = '#!/bin/sh\n# Synthetic existing hook\n';
  write(dir, '.git/hooks/commit-msg', hook);
  assert.equal(node(dir, 'install-hooks.mjs').status, 1);
  assert.equal(fs.readFileSync(path.join(dir, '.git/hooks/commit-msg'), 'utf8'), hook);
});

test('installed hooks block secret files and commit messages; allow synthetic work', (t) => {
  const dir = repo(t);
  assert.equal(node(dir, 'install-hooks.mjs').status, 0);
  for (const hook of ['pre-commit', 'commit-msg', 'pre-push']) assert.ok(fs.statSync(path.join(dir, '.githooks', hook)).mode & 0o111);
  write(dir, 'demo.txt', token());
  git(dir, 'add', '--', 'demo.txt');
  const blockedFile = spawnSync('git', ['-c', 'commit.gpgsign=false', 'commit', '-q', '-m', 'synthetic fixture'], { cwd: dir, env, encoding: 'utf8' });
  assert.notEqual(blockedFile.status, 0);
  assert.equal((blockedFile.stdout + blockedFile.stderr).includes(token()), false);
  write(dir, 'demo.txt', 'Synthetic task A');
  git(dir, 'add', '--', 'demo.txt');
  const blockedMessage = spawnSync('git', ['-c', 'commit.gpgsign=false', 'commit', '-q', '-m', `synthetic ${token()}`], { cwd: dir, env, encoding: 'utf8' });
  assert.notEqual(blockedMessage.status, 0);
  assert.equal((blockedMessage.stdout + blockedMessage.stderr).includes(token()), false);
  committed(dir);
  const pushHook = spawnSync('sh', ['.githooks/pre-push'], { cwd: dir, env, encoding: 'utf8' });
  assert.equal(pushHook.status, 0);
});

test('doctor distinguishes missing hooks from configured safety without changing Git', (t) => {
  const dir = repo(t);
  write(dir, '.nvmrc', process.versions.node.split('.')[0]);
  assert.ok(inspectEnvironment(dir).some((check) => check.id === 'hooks-path' && !check.ok));
  assert.equal(node(dir, 'install-hooks.mjs').status, 0);
  assert.equal(inspectEnvironment(dir).every((check) => check.ok), true);
  const settings = JSON.parse(fs.readFileSync(path.join(dir, '.claude/settings.json')));
  settings.sandbox.allowUnsandboxedCommands = true;
  write(dir, '.claude/settings.json', JSON.stringify(settings));
  assert.ok(inspectEnvironment(dir).some((check) => check.id === 'claude-safety-config' && !check.ok));
});

test('Codex profile arguments select a workspace boundary without legacy overrides', () => {
  const args = codexConfigArgs();
  assert.ok(args.includes('default_permissions="leaf"'));
  assert.ok(args.includes('approval_policy="on-request"'));
  assert.equal(args.some((arg) => arg.includes('sandbox_mode') || arg.includes('danger-full-access')), false);
  assert.ok(args.some((arg) => arg.includes('":root" = "deny"') && arg.includes('"enabled" = false')));
});

test('workspace scanner includes uncommitted text and refuses private paths', (t) => {
  const dir = repo(t);
  const workspaceToken = 'xo' + 'xb-' + '123456789012-123456789012-' + createHash('sha256').update('synthetic Slack audit fixture').digest('hex').slice(0, 24);
  write(dir, 'draft.txt', workspaceToken);
  const leaked = node(dir, 'run-gitleaks.mjs', ['--workspace']);
  assert.equal(leaked.status, 1);
  assert.equal((leaked.stdout + leaked.stderr).includes(workspaceToken), false);
  write(dir, 'draft.txt', 'Synthetic clean draft');
  write(dir, '.env.audit', 'SYNTHETIC=1');
  assert.equal(node(dir, 'run-gitleaks.mjs', ['--workspace']).status, 2);
});

test('an untracked scanner ignore file cannot exempt history', (t) => {
  const dir = repo(t);
  write(dir, 'demo.txt', 'Synthetic task A');
  git(dir, 'add', '--', 'demo.txt');
  committed(dir);
  write(dir, '.gitleaksignore', 'Synthetic unreviewed exception');
  assert.equal(node(dir, 'run-gitleaks.mjs', ['--history']).status, 2);
});

test('real Gitleaks detects annotated tag message secrets', (t) => {
  const dir = repo(t);
  write(dir, 'demo.txt', 'Synthetic task A');
  git(dir, 'add', '--', 'demo.txt');
  committed(dir);
  git(dir, '-c', 'tag.gpgsign=false', 'tag', '-a', 'demo', '-m', `synthetic ${token()}`);
  const result = node(dir, 'run-gitleaks.mjs', ['--history']);
  assert.equal(result.status, 1);
  assert.equal((result.stdout + result.stderr).includes(token()), false);
});

test('Codex adds read access to runtime files without granting their parent', () => {
  const runtimeFiles = ['/opt/leaf-fixture/node', '/opt/leaf-fixture/codex'];
  const args = codexConfigArgs({ runtimeFiles });
  const profile = args.find((arg) => arg.startsWith('permissions.leaf='));
  for (const name of runtimeFiles) assert.ok(profile.includes(`${JSON.stringify(name)} = "read"`));
  assert.equal(profile.includes('"/opt/leaf-fixture" = "read"'), false);
  assert.ok(profile.includes('":root" = "deny"'));
});

test('Codex resolver finds npm helper and supports native installs; unknown wrappers refuse', async (t) => {
  const { resolveCodexRuntime } = await import('./agent-runtime.mjs');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'leaf-runtime-test-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const packageRoot = path.join(dir, 'node_modules/@openai/codex');
  const wrapper = path.join(packageRoot, 'bin/codex.js');
  const helper = path.join(packageRoot, 'vendor/x86_64-unknown-linux-musl/bin/codex');
  write(dir, 'node_modules/@openai/codex/package.json', JSON.stringify({ name: '@openai/codex', version: '0.0.0' }));
  write(dir, 'node_modules/@openai/codex/bin/codex.js', '// Synthetic npm entry point');
  write(dir, path.relative(dir, helper), Buffer.from([0x7f, 0x45, 0x4c, 0x46]));
  fs.chmodSync(wrapper, 0o755);
  fs.chmodSync(helper, 0o755);
  fs.mkdirSync(path.join(dir, 'bin'));
  fs.symlinkSync(wrapper, path.join(dir, 'bin/codex'));
  const options = { searchPath: path.join(dir, 'bin'), platform: 'linux', arch: 'x64' };
  const npm = resolveCodexRuntime(options);
  assert.equal(npm.command, wrapper);
  assert.deepEqual(npm.runtimeFiles, [...new Set([fs.realpathSync(process.execPath), helper])]);
  fs.unlinkSync(path.join(dir, 'bin/codex'));
  fs.symlinkSync(helper, path.join(dir, 'bin/codex'));
  assert.equal(resolveCodexRuntime(options).command, helper);
  fs.unlinkSync(path.join(dir, 'bin/codex'));
  write(dir, 'bin/codex', '#!/bin/sh\n# Unsupported synthetic wrapper\n');
  fs.chmodSync(path.join(dir, 'bin/codex'), 0o755);
  assert.throws(() => resolveCodexRuntime(options));
});

test('Codex directory rules cover root directories and nested contents', () => {
  const rules = JSON.parse(fs.readFileSync(path.join(project, 'config/agents/codex-permissions.json'))).filesystem[':workspace_roots'];
  for (const name of ['data', '.data', 'secrets', '.private', '.local', 'backups', 'exports', 'uploads', 'logs', 'screenshots', 'artifacts', 'test-results', 'playwright-report']) {
    assert.equal(rules[name], 'deny', `Root private directory ${name} must stay closed.`);
    assert.equal(rules[`*/**/${name}/**`], 'deny', `Nested private contents ${name} must stay closed.`);
  }
  assert.equal(rules['**/.codex/**'], 'deny');
});

test('Codex resolver refuses credential-store symlinks before opening them', async (t) => {
  const { resolveCodexRuntime } = await import('./agent-runtime.mjs');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'leaf-runtime-private-test-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  write(dir, '.codex/auth.json', 'Synthetic credential fixture');
  write(dir, '.codex/codex', Buffer.from([0x7f, 0x45, 0x4c, 0x46]));
  fs.mkdirSync(path.join(dir, 'bin'));
  const open = fs.openSync;
  let privateOpens = 0;
  fs.openSync = (file, ...args) => {
    if (typeof file === 'string' && file.startsWith(path.join(dir, '.codex') + path.sep)) privateOpens++;
    return open(file, ...args);
  };
  try {
    for (const name of ['auth.json', 'codex']) {
      const target = path.join(dir, '.codex', name);
      fs.chmodSync(target, 0o755);
      fs.symlinkSync(target, path.join(dir, 'bin/codex'));
      assert.throws(() => resolveCodexRuntime({ searchPath: path.join(dir, 'bin') }));
      fs.unlinkSync(path.join(dir, 'bin/codex'));
    }
    assert.equal(privateOpens, 0);
  } finally { fs.openSync = open; }
});

test('sandbox exit zero and stdout marker cannot replace completed proof', async () => {
  let called = false;
  const ok = await checkCodexSandbox({ runtime: { command: 'synthetic-codex', runtimeFiles: [process.execPath] }, run: () => {
    called = true;
    return { status: 0, stdout: 'SANDBOX_SMOKE_PASS' };
  } });
  assert.equal(called, true);
  assert.equal(ok, false);
});

test('an unconfined Node child fails the private-read sandbox probe', async () => {
  let called = false;
  let status;
  const ok = await checkCodexSandbox({ runtime: { command: 'synthetic-codex', runtimeFiles: [process.execPath] }, run: (_command, args, options) => {
    called = true;
    const workspace = args[args.indexOf('--cd') + 1];
    const result = spawnSync(process.execPath, ['--input-type=module', '-e', args.at(-1)], { ...options, cwd: workspace });
    status = result.status;
    return result;
  } });
  assert.equal(called, true);
  assert.notEqual(status, 0);
  assert.equal(ok, false);
});

const reviewedIdentity = () => 'fixture' + '@' + 'identity.test';
function emailReview(dir, oid, fields = ['author', 'committer']) {
  write(dir, 'config/public-git-metadata.json', JSON.stringify({ version: 1, commitEmailReviews: [{ oid, fields, review: 'Owner approved synthetic commit identity.' }] }));
}
function identitySource(dir) {
  git(dir, 'config', '--local', 'user.email', reviewedIdentity());
  write(dir, 'demo.txt', 'Synthetic task A');
  git(dir, 'add', '--', 'demo.txt');
  committed(dir);
  return git(dir, 'rev-parse', 'HEAD').trim();
}

test('public Git email review uses indexed sources and stays scoped to commit identity fields', (t) => {
  const dir = repo(t);
  const oid = identitySource(dir);
  emailReview(dir, oid, ['author']);
  assert.ok(runGuard(dir, '--history').findings.some((finding) => finding.rule === 'EMAIL_REVIEW_REQUIRED'));
  git(dir, 'add', '--', 'config/public-git-metadata.json');
  assert.ok(runGuard(dir, '--history').findings.some((finding) => finding.rule === 'EMAIL_REVIEW_REQUIRED'));
  emailReview(dir, oid);
  // An unstaged change cannot widen a staged single-field review.
  assert.ok(runGuard(dir, '--history').findings.some((finding) => finding.rule === 'EMAIL_REVIEW_REQUIRED'));
  git(dir, 'add', '--', 'config/public-git-metadata.json');
  assert.deepEqual(runGuard(dir, '--history').findings, []);
  committed(dir, 'Synthetic policy review');
  assert.deepEqual(runGuard(dir, '--history').findings, []);
  git(dir, '-c', 'tag.gpgsign=false', 'tag', '-a', 'identity-tag', '-m', 'Synthetic annotated tag');
  assert.ok(runGuard(dir, '--history').findings.some((finding) => finding.path.startsWith('git:tag:') && finding.rule === 'EMAIL_REVIEW_REQUIRED'));
  git(dir, 'config', '--local', 'user.email', 'other' + '@' + 'identity.test');
  write(dir, 'next.txt', 'Synthetic task B');
  git(dir, 'add', '--', 'next.txt');
  committed(dir);
  assert.ok(runGuard(dir, '--history').findings.some((finding) => finding.path.startsWith('git:commit:') && finding.rule === 'EMAIL_REVIEW_REQUIRED'));
});

test('reviewed identity never exempts message or name emails, file content or secrets', (t) => {
  for (const scenario of ['message-email', 'name-email', 'message-token']) {
    const dir = repo(t);
    const oid = identitySource(dir);
    emailReview(dir, oid);
    git(dir, 'add', '--', 'config/public-git-metadata.json');
    assert.deepEqual(runGuard(dir, '--history').findings, []);
    write(dir, 'next.txt', 'Synthetic task B');
    git(dir, 'add', '--', 'next.txt');
    if (scenario === 'name-email') git(dir, 'config', '--local', 'user.name', `Leaf Fixture ${reviewedIdentity()}`);
    committed(dir, scenario === 'message-email' ? `Synthetic contact ${reviewedIdentity()}` : scenario === 'message-token' ? `Synthetic ${token()}` : 'Synthetic fixture');
    const rule = scenario === 'message-token' ? 'GITHUB_TOKEN' : 'EMAIL_REVIEW_REQUIRED';
    assert.ok(runGuard(dir, '--history').findings.some((finding) => finding.path.startsWith('git:commit:') && finding.rule === rule), scenario);
    if (scenario === 'message-token') {
      const result = node(dir, 'run-gitleaks.mjs', ['--history']);
      assert.equal(result.status, 1);
      assert.equal((result.stdout + result.stderr).includes(token()), false);
    }
    write(dir, 'contact.txt', reviewedIdentity());
    git(dir, 'add', '--', 'contact.txt');
    assert.ok(runGuard(dir, '--staged').findings.some((finding) => finding.path === 'contact.txt' && finding.rule === 'EMAIL_REVIEW_REQUIRED'));
  }
});

test('public metadata review manifest rejects wildcards, extra scopes and duplicate sources', async () => {
  const { parseMetadataReviews } = await import('./git-metadata-reviews.mjs');
  const review = { oid: 'a'.repeat(40), fields: ['author', 'committer'], review: 'Synthetic owner review.' };
  assert.deepEqual(parseMetadataReviews(Buffer.from(JSON.stringify({ version: 1, commitEmailReviews: [review] }))), [review]);
  for (const data of [
    { version: 2, commitEmailReviews: [review] },
    { version: 1, commitEmailReviews: [{ ...review, oid: '*' }] },
    { version: 1, commitEmailReviews: [{ ...review, fields: ['message'] }] },
    { version: 1, commitEmailReviews: [{ ...review, fields: ['author', 'author'] }] },
    { version: 1, commitEmailReviews: [{ ...review, email: 'fixture@example.test' }] },
    { version: 1, commitEmailReviews: [review, review] },
  ]) assert.throws(() => parseMetadataReviews(Buffer.from(JSON.stringify(data))));
  assert.throws(() => parseMetadataReviews(Buffer.from('{ invalid synthetic input')), /details suppressed/);
});

test('public email reviews refuse unreachable source commits', (t) => {
  const dir = repo(t);
  identitySource(dir);
  emailReview(dir, 'a'.repeat(40));
  git(dir, 'add', '--', 'config/public-git-metadata.json');
  assert.throws(() => runGuard(dir, '--history'), /reachable/);
});

test('doctor accepts major or exact Node pins and rejects a different patch or malformed pin', (t) => {
  const dir = repo(t);
  write(dir, '.nvmrc', process.versions.node);
  assert.ok(inspectEnvironment(dir).some((check) => check.id === 'node-version' && check.ok));
  const [major, minor, patch] = process.versions.node.split('.').map(Number);
  write(dir, '.nvmrc', `${major}.${minor}.${patch + 1}`);
  assert.ok(inspectEnvironment(dir).some((check) => check.id === 'node-version' && !check.ok));
  write(dir, '.nvmrc', String(major));
  assert.ok(inspectEnvironment(dir).some((check) => check.id === 'node-version' && check.ok));
  write(dir, '.nvmrc', 'synthetic-invalid-version');
  assert.ok(inspectEnvironment(dir).some((check) => check.id === 'node-version' && !check.ok));
});
