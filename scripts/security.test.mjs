import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { pathFindings, textFindings, scanBytes, runGuard } from './security-check.mjs';

// Synthetic secrets are assembled only in temporary test repositories, never stored as literals.
const sampleToken = () => 'gh' + 'p_' + 'A'.repeat(36);
const gitEnv = { ...process.env, GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: os.devNull };
function git(cwd, ...args) {
  const r = spawnSync('git', args, { cwd, env: gitEnv, encoding: 'utf8' });
  assert.equal(r.status, 0, `Synthetic Git test failed (${args[0]}); details omitted.`);
  return r.stdout;
}
function tempRepo(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'leaf-guard-test-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  git(dir, 'init', '-q');
  git(dir, 'config', '--local', 'user.name', 'Leaf Fixture');
  git(dir, 'config', '--local', 'user.email', 'fixture@example.test');
  return dir;
}
function write(root, name, data) {
  fs.mkdirSync(path.dirname(path.join(root, name)), { recursive: true });
  fs.writeFileSync(path.join(root, name), data);
}
function commit(dir) { git(dir, '-c', 'commit.gpgsign=false', 'commit', '-q', '-m', 'synthetic fixture'); }

test('env secrets blocked but public example allowed', () => {
  assert.ok(pathFindings('.env').includes('ENV_FILE'));
  assert.ok(pathFindings('nested/.env.production').includes('ENV_FILE'));
  assert.deepEqual(pathFindings('.env.example'), []);
});
test('private storage, database sidecars and agent files blocked', () => {
  for (const name of ['data/project.json', '.private/snapshot.json', 'x.db-wal', 'nested/x.sqlite3-shm', '.claude/settings.local.json', '.codex/auth.json', 'secrets/key.txt']) assert.ok(pathFindings(name).length, name);
  assert.deepEqual(pathFindings('.claude/settings.json'), []);
  assert.deepEqual(pathFindings('migrations/001-schema.sql'), []);
});
test('known token and private key patterns detected', () => {
  assert.ok(textFindings(sampleToken()).includes('GITHUB_TOKEN'));
  assert.ok(textFindings('-----BEGIN ' + 'OPENSSH PRIVATE KEY-----').includes('PRIVATE_KEY'));
});
test('email examples allowed; arbitrary identity requires review', () => {
  assert.deepEqual(textFindings('fixture@example.test'), []);
  assert.ok(textFindings('person@' + 'mail.invalid').includes('EMAIL_REVIEW_REQUIRED'));
});
test('binary data fails closed', () => {
  assert.ok(scanBytes('notes.txt', Buffer.from([0, 1, 2])).includes('UNREVIEWED_BINARY'));
});
test('reviewed binary requires exact path and hash', () => {
  const data = Buffer.from([0, 1, 2]);
  const assets = [{ path: 'design/reference.png', sha256: createHash('sha256').update(data).digest('hex') }];
  assert.deepEqual(scanBytes('design/reference.png', data, assets), []);
  assert.ok(scanBytes('other.png', data, assets).includes('UNREVIEWED_BINARY'));
  assert.ok(scanBytes('design/reference.png', Buffer.from([0, 2]), assets).includes('UNREVIEWED_BINARY'));
});
test('approved hash cannot permit a prohibited database path', () => {
  const data = Buffer.from([0, 1]);
  const assets = [{ path: 'x.db', sha256: createHash('sha256').update(data).digest('hex') }];
  assert.ok(scanBytes('x.db', data, assets).includes('DATABASE_FILE'));
});
test('symlinks are not silently dereferenced', () => {
  assert.ok(scanBytes('link', Buffer.from('target'), [], '120000').includes('NON_REGULAR_GIT_ENTRY'));
});
test('staged blob is scanned even after working copy is cleaned', (t) => {
  const dir = tempRepo(t);
  write(dir, 'sample.txt', sampleToken());
  git(dir, 'add', '--', 'sample.txt');
  write(dir, 'sample.txt', 'clean working file');
  assert.ok(runGuard(dir, '--staged').findings.some((x) => x.rule === 'GITHUB_TOKEN'));
});
test('all tracked blobs are checked, including unchanged sensitive paths', (t) => {
  const dir = tempRepo(t);
  write(dir, '.env', 'SYNTHETIC=1');
  git(dir, 'add', '--', '.env');
  commit(dir);
  assert.ok(runGuard(dir, '--tracked').findings.some((x) => x.rule === 'ENV_FILE'));
});
test('history detects a secret removed by a later commit', (t) => {
  const dir = tempRepo(t);
  write(dir, 'sample.txt', sampleToken());
  git(dir, 'add', '--', 'sample.txt');
  commit(dir);
  write(dir, 'sample.txt', 'synthetic clean replacement');
  git(dir, 'add', '--', 'sample.txt');
  commit(dir);
  assert.deepEqual(runGuard(dir, '--tracked').findings, []);
  assert.ok(runGuard(dir, '--history').findings.some((x) => x.rule === 'GITHUB_TOKEN'));
});
test('local unstaged manifest cannot authorize staged binary', (t) => {
  const dir = tempRepo(t);
  const data = Buffer.from([0, 1, 2]);
  write(dir, 'asset.png', data);
  write(dir, 'config/public-assets.json', JSON.stringify({ assets: [] }));
  git(dir, 'add', '--', 'asset.png', 'config/public-assets.json');
  write(dir, 'config/public-assets.json', JSON.stringify({ assets: [{ path: 'asset.png', sha256: createHash('sha256').update(data).digest('hex') }] }));
  assert.ok(runGuard(dir, '--staged').findings.some((x) => x.rule === 'UNREVIEWED_BINARY'));
});
test('clean synthetic repository passes index and history', (t) => {
  const dir = tempRepo(t);
  write(dir, 'demo.txt', 'Synthetic task A, no personal data.');
  git(dir, 'add', '--', 'demo.txt');
  assert.deepEqual(runGuard(dir, '--staged').findings, []);
  commit(dir);
  assert.deepEqual(runGuard(dir, '--history').findings, []);
});
test('workspace scanner detects ignored-name files before first git init', (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'leaf-workspace-test-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  write(dir, '.env', 'SYNTHETIC=1');
  assert.ok(runGuard(dir, '--workspace').findings.some((x) => x.rule === 'ENV_FILE'));
});

test('ASCII PDF and disguised PDF require exact asset approval', () => {
  const data = Buffer.from('%PDF-1.4\n% Synthetic document\n%%EOF\n');
  for (const name of ['design/demo.pdf', 'notes.txt']) {
    assert.ok(scanBytes(name, data).includes('UNREVIEWED_ASSET'));
    const assets = [{ path: name, sha256: createHash('sha256').update(data).digest('hex') }];
    assert.deepEqual(scanBytes(name, data, assets), []);
  }
  assert.ok(scanBytes('design/demo.pdf', Buffer.from('Synthetic text')).includes('UNREVIEWED_ASSET'));
});

test('workspace private files and directories are rejected without reading', (t) => {
  const dir = tempRepo(t);
  write(dir, '.env.audit', 'SYNTHETIC=1');
  write(dir, 'data/private.txt', 'Synthetic task A');
  const originalRead = fs.readFileSync;
  const originalList = fs.readdirSync;
  let privateReads = 0;
  fs.readFileSync = function (name, ...args) {
    if (String(name) === path.join(dir, '.env.audit')) privateReads++;
    return originalRead.call(this, name, ...args);
  };
  fs.readdirSync = function (name, ...args) {
    if (String(name) === path.join(dir, 'data')) privateReads++;
    return originalList.call(this, name, ...args);
  };
  let result;
  try { result = runGuard(dir, '--workspace'); }
  finally { fs.readFileSync = originalRead; fs.readdirSync = originalList; }
  assert.equal(privateReads, 0);
  assert.ok(result.findings.some((x) => x.rule === 'ENV_FILE'));
  assert.ok(result.findings.some((x) => x.rule === 'PRIVATE_DIRECTORY'));
});

test('commit and annotated tag metadata are scanned without returning values', (t) => {
  const dir = tempRepo(t);
  write(dir, 'demo.txt', 'Synthetic task A');
  git(dir, 'add', '--', 'demo.txt');
  git(dir, '-c', 'commit.gpgsign=false', 'commit', '-q', '-m', `synthetic ${sampleToken()}`);
  git(dir, '-c', 'tag.gpgsign=false', 'tag', '-a', 'demo', '-m', `synthetic ${sampleToken()}`);
  const result = runGuard(dir, '--history');
  assert.ok(result.findings.some((x) => x.path.startsWith('git:commit:') && x.rule === 'GITHUB_TOKEN'));
  assert.ok(result.findings.some((x) => x.path.startsWith('git:tag:') && x.rule === 'GITHUB_TOKEN'));
  assert.equal(JSON.stringify(result).includes(sampleToken()), false);
});

test('private author email requires review even when file content is clean', (t) => {
  const dir = tempRepo(t);
  git(dir, 'config', '--local', 'user.email', 'fixture@' + 'mail.invalid');
  write(dir, 'demo.txt', 'Synthetic task A');
  git(dir, 'add', '--', 'demo.txt');
  commit(dir);
  assert.ok(runGuard(dir, '--history').findings.some((x) => x.rule === 'EMAIL_REVIEW_REQUIRED'));
});

test('workspace manifest symlink is rejected before dereferencing', (t) => {
  const dir = tempRepo(t);
  write(dir, 'private-manifest.json', JSON.stringify({ assets: [] }));
  fs.mkdirSync(path.join(dir, 'config'));
  fs.symlinkSync('../private-manifest.json', path.join(dir, 'config/public-assets.json'));
  assert.throws(() => runGuard(dir, '--workspace'), /regular|symlink/i);
});
