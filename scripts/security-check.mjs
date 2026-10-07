#!/usr/bin/env node
/** Lightweight public-repo guard. Complement with Gitleaks and human PII review. */
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { spawnSync } from 'node:child_process';

import { MAX_BYTES, pathFindings, scanBytes } from './security-policy.mjs';
import { readWorkspaceFile } from './repository-files.mjs';
import { parseAssetManifest } from './public-assets.mjs';
import { readGitMetadata } from './git-metadata.mjs';
import { parseMetadataReviews, reviewedCommitEmails, metadataFindings } from './git-metadata-reviews.mjs';
export { pathFindings, textFindings, scanBytes } from './security-policy.mjs';

function git(cwd, args, optional = false) {
  const r = spawnSync('git', args, { cwd, maxBuffer: 64 * 1024 * 1024, env: { ...process.env, GIT_OPTIONAL_LOCKS: '0' } });
  if (r.error || r.status !== 0) {
    if (optional) return null;
    // Deliberately do not print captured stderr or blob contents.
    throw new Error(`Git command failed (${args[0]}). Check repository state locally.`);
  }
  return r.stdout;
}

function indexEntries(root) {
  return git(root, ['ls-files', '--stage', '-z']).toString('utf8').split('\0').filter(Boolean).map((line) => {
    const tab = line.indexOf('\t');
    const [mode, oid, stage] = line.slice(0, tab).split(' ');
    if (stage !== '0') throw new Error('Unmerged index entries: resolve conflicts before publication.');
    return { mode, oid, name: line.slice(tab + 1) };
  });
}

export function workspaceFiles(root, relative = '') {
  const entries = [];
  const skip = new Set(['.git', 'node_modules', 'dist', 'build', 'coverage', '.cache', '.tools']);
  for (const de of fs.readdirSync(path.join(root, relative), { withFileTypes: true })) {
    const name = relative ? `${relative}/${de.name}` : de.name;
    if (de.isDirectory()) {
      if (skip.has(de.name)) continue;
      // The only public Claude subtree is the root settings file; inspect its
      // entries individually rather than rejecting the whole parent directory.
      const errors = name === '.claude' ? [] : pathFindings(`${name}/`);
      if (errors.length) entries.push({ name: `${name}/`, mode: 'directory', errors });
      else entries.push(...workspaceFiles(root, name));
    } else if (de.isSymbolicLink()) entries.push({ name, mode: '120000' });
    else entries.push({ name, mode: '100644' });
  }
  return entries;
}

export function runGuard(cwd, mode) {
  const isWorkspace = mode === '--workspace';
  const root = isWorkspace ? path.resolve(cwd) : git(cwd, ['rev-parse', '--show-toplevel']).toString('utf8').trim();
  let manifestBytes;
  if (isWorkspace) {
    const p = path.join(root, 'config/public-assets.json');
    manifestBytes = fs.existsSync(p) ? readWorkspaceFile(root, 'config/public-assets.json') : null;
  } else manifestBytes = git(root, ['show', ':config/public-assets.json'], true);
  const manifest = manifestBytes ? parseAssetManifest(manifestBytes) : { assets: [], historicalAssets: [] };
  const assets = mode === '--history' ? [...manifest.assets, ...manifest.historicalAssets] : manifest.assets;
  let reviewBytes;
  if (isWorkspace) {
    const file = 'config/public-git-metadata.json';
    reviewBytes = fs.existsSync(path.join(root, file)) ? readWorkspaceFile(root, file) : null;
  } else reviewBytes = git(root, ['show', ':config/public-git-metadata.json'], true);
  const reviews = reviewBytes ? parseMetadataReviews(reviewBytes) : [];
  let entries = [];
  if (isWorkspace) entries = workspaceFiles(root);
  else if (mode === '--staged' || mode === '--tracked') {
    entries = indexEntries(root);
    if (mode === '--staged') {
      const changed = new Set(git(root, ['diff', '--cached', '--name-only', '--diff-filter=ACMR', '-z']).toString('utf8').split('\0'));
      entries = entries.filter((entry) => changed.has(entry.name));
    }
  } else if (mode === '--history') {
    const commits = git(root, ['rev-list', '--all']).toString('utf8').trim().split('\n').filter(Boolean);
    const seen = new Set();
    for (const commit of commits) {
      for (const line of git(root, ['ls-tree', '-r', '-z', '--full-tree', commit]).toString('utf8').split('\0').filter(Boolean)) {
        const tab = line.indexOf('\t');
        const [m, type, oid] = line.slice(0, tab).split(' ');
        const name = line.slice(tab + 1);
        const key = `${name}\0${oid}\0${m}`;
        if (!seen.has(key)) { seen.add(key); entries.push({ name, oid, mode: m, type }); }
      }
    }
  } else throw new Error('Expected --workspace, --staged, --tracked, or --history.');
  const findings = [];
  for (const entry of entries) {
    let errors = entry.errors ?? pathFindings(entry.name);
    if (errors.length) {
      // Private paths are rejected before stat, blob reads or directory traversal.
    } else if (!['100644', '100755'].includes(entry.mode)) errors = [...pathFindings(entry.name), 'NON_REGULAR_GIT_ENTRY'];
    else {
      const size = isWorkspace ? fs.statSync(path.join(root, entry.name)).size : Number(git(root, ['cat-file', '-s', entry.oid]).toString());
      if (size > MAX_BYTES) errors = [...pathFindings(entry.name), 'FILE_TOO_LARGE_FOR_GUARD'];
      else {
        const bytes = isWorkspace ? readWorkspaceFile(root, entry.name) : git(root, ['cat-file', 'blob', entry.oid]);
        errors = scanBytes(entry.name, bytes, assets, entry.mode);
      }
    }
    for (const rule of errors) findings.push({ path: entry.name, rule });
  }
  let metadata = [];
  if (mode === '--history') {
    metadata = readGitMetadata(root);
    const approvedEmails = reviewedCommitEmails(metadata, reviews);
    for (const entry of metadata) {
      for (const rule of metadataFindings(entry, approvedEmails)) findings.push({ path: `git:${entry.kind}:${entry.oid}`, rule });
    }
  }
  return { scanned: entries.length, metadataScanned: metadata.length, findings };
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  try {
    const mode = process.argv[2] ?? '--staged';
    if (process.argv.length > 3) throw new Error('Unexpected arguments.');
    const result = runGuard(process.cwd(), mode);
    if (result.findings.length) {
      for (const finding of result.findings) console.error(`${finding.rule}: ${JSON.stringify(finding.path)}`);
      console.error('Publication blocked. Review locally; never paste sensitive values into a public issue.');
      process.exitCode = 1;
    } else console.log(`Privacy guard: ${result.scanned} entries and ${result.metadataScanned} metadata objects checked (${mode}); no covered findings. This is not a complete PII audit.`);
  } catch {
    console.error('Privacy guard failed closed. Check the mode, public manifest and repository state locally; details suppressed.');
    process.exitCode = 2;
  }
}
