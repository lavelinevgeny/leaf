#!/usr/bin/env node
/** Fail closed and print summaries only, even if a scanner diagnostic is unsafe. */
import fs from 'node:fs';
import path from 'node:path';
import { isUtf8 } from 'node:buffer';
import { spawnSync } from 'node:child_process';
import { readGitMetadata } from './git-metadata.mjs';
import { runGuard, workspaceFiles } from './security-check.mjs';
import { MAX_BYTES, pathFindings, textFindings } from './security-policy.mjs';
import { readWorkspaceFile } from './repository-files.mjs';

const mode = process.argv[2];
const messageFile = process.argv[3];
const valid = ['--staged', '--history', '--workspace'].includes(mode) ? process.argv.length === 3 : mode === '--message' && process.argv.length === 4;
if (!valid) {
  console.error('Usage: node scripts/run-gitleaks.mjs --staged|--history|--workspace|--message <Git commit message file>');
  process.exit(2);
}
function git(args) {
  const result = spawnSync('git', args, { maxBuffer: 64 * 1024 * 1024 });
  if (result.error || result.status !== 0) throw new Error('Git input unavailable.');
  return result.stdout;
}
function combine(chunks) {
  const size = chunks.reduce((sum, chunk) => sum + chunk.length + 1, 0);
  if (size > 64 * 1024 * 1024) throw new Error('Scan input exceeds its size limit.');
  return Buffer.concat(chunks.flatMap((chunk) => [chunk, Buffer.from('\n')]));
}
function scan(command, input) {
  const args = [...command, '--redact=100', '--no-banner', '--no-color', '--ignore-gitleaks-allow', '--config=.gitleaks.toml'];
  const result = spawnSync('gitleaks', args, { input, encoding: 'utf8', maxBuffer: 16 * 1024 * 1024 });
  // Neither stdout nor stderr is forwarded: even redacted findings can carry PII.
  if (result.error || ![0, 1].includes(result.status)) throw new Error('Scanner execution failed.');
  if (result.status === 1) {
    console.error('Gitleaks found covered secrets. Publication blocked; values and scanner details suppressed.');
    process.exit(1);
  }
}
try {
  const probe = spawnSync('gitleaks', ['version'], { encoding: 'utf8' });
  if (probe.error || probe.status !== 0) throw new Error('Scanner unavailable.');
  const root = git(['rev-parse', '--show-toplevel']).toString('utf8').trim();
  if (process.cwd() !== root) throw new Error('Run at the repository root.');
  // Gitleaks also reads a working-tree ignore file, even when it is untracked.
  // Refuse it without opening it so an unstaged exception cannot hide history.
  if (fs.existsSync(path.join(root, '.gitleaksignore'))) throw new Error('Unreviewed scanner exception file.');
  readWorkspaceFile(root, '.gitleaks.toml');
  if (mode === '--history') {
    scan(['git', '--log-opts=--all', '.']);
    const metadata = readGitMetadata(root);
    if (metadata.length) scan(['stdin'], combine(metadata.map((entry) => entry.bytes)));
    console.log(`Gitleaks passed: file history and ${metadata.length} Git metadata objects; no covered secrets.`);
  } else if (mode === '--message') {
    const expected = path.resolve(root, git(['rev-parse', '--git-path', 'COMMIT_EDITMSG']).toString('utf8').trim());
    if (path.resolve(messageFile) !== expected) throw new Error('Only the pending Git commit message is accepted.');
    const stat = fs.lstatSync(expected);
    if (!stat.isFile() || stat.isSymbolicLink() || stat.size > MAX_BYTES) throw new Error('Invalid Git commit message input.');
    const bytes = fs.readFileSync(expected);
    if (textFindings(bytes.toString('utf8')).length) {
      console.error('Commit message requires privacy review. Commit blocked; values suppressed.');
      process.exit(1);
    }
    scan(['stdin'], bytes);
    console.log('Commit message privacy checks passed.');
  } else if (mode === '--workspace') {
    if (runGuard(root, '--workspace').findings.length) throw new Error('Workspace privacy guard refused the input.');
    const chunks = [];
    for (const entry of workspaceFiles(root)) {
      if (entry.mode !== '100644' || pathFindings(entry.name).length) throw new Error('Nonpublic workspace input.');
      const bytes = readWorkspaceFile(root, entry.name);
      if (!bytes.includes(0) && isUtf8(bytes)) chunks.push(Buffer.concat([Buffer.from(`${entry.name}\n`), bytes]));
    }
    scan(['stdin'], combine(chunks));
    console.log('Gitleaks passed: public workspace text, including uncommitted files; no covered secrets.');
  } else {
    // Scan full changed index blobs, so context or partial staging cannot hide a token.
    const names = git(['diff', '--cached', '--name-only', '--diff-filter=ACMR', '-z']).toString('utf8').split('\0').filter(Boolean);
    const chunks = [];
    for (const name of names) {
      if (pathFindings(name).length) throw new Error('Private staged input.');
      const bytes = git(['show', `:${name}`]);
      if (bytes.length > MAX_BYTES) throw new Error('Staged input too large.');
      chunks.push(Buffer.concat([Buffer.from(`${name}\n`), bytes]));
    }
    if (chunks.length) scan(['stdin'], combine(chunks));
    console.log(`Gitleaks passed: ${names.length} changed index blobs; no covered secrets.`);
  }
} catch {
  console.error('Gitleaks check failed closed. Check the tool, public configuration and Git inputs locally; publication blocked.');
  process.exitCode = 2;
}
