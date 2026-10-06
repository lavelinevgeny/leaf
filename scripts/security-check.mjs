#!/usr/bin/env node
/** Lightweight public-repo guard. Complement with Gitleaks and human PII review. */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';

const MAX_BYTES = 8 * 1024 * 1024;
const BLOCKED_DIRS = new Set(['.data', 'data', 'secrets', '.private', '.local', 'backups', 'exports', 'uploads', 'logs', '.codex', '.ssh', '.aws', '.tools', '.worktrees', 'worktrees', 'artifacts', 'screenshots', 'test-results', 'playwright-report', 'blob-report', 'node_modules']);
const TEXT_DECODER = new TextDecoder('utf-8', { fatal: true });

export function pathFindings(name) {
  const p = name.replaceAll('\\', '/');
  const lower = p.toLowerCase();
  const parts = lower.split('/');
  const base = parts.at(-1);
  const errors = [];
  if (/\p{Cc}/u.test(p) || p.startsWith('/') || parts.includes('..')) errors.push('UNSAFE_PATH');
  if (parts.slice(0, -1).some((x) => BLOCKED_DIRS.has(x))) errors.push('PRIVATE_DIRECTORY');
  if (/^\.env(?:\.|$)/.test(base) && base !== '.env.example') errors.push('ENV_FILE');
  if (/\.(?:db|sqlite|sqlite3)(?:[-.].*)?$/.test(base)) errors.push('DATABASE_FILE');
  if (/\.(?:pem|key|p12|pfx|keystore|har|log)$/.test(base)) errors.push('SENSITIVE_FILE_TYPE');
  if (/^(?:id_rsa|id_ed25519|id_ecdsa|credentials(?:\..*)?|auth\.json|\.netrc|\.npmrc|\.pypirc)$/.test(base)) errors.push('CREDENTIAL_FILE');
  if (/^(?:claude\.local\.md|agents\.local\.md|agents\.override\.md|\.mcp\.json)$/.test(base)) errors.push('LOCAL_AGENT_FILE');
  if (parts.includes('.claude') && lower !== '.claude/settings.json') errors.push('LOCAL_AGENT_FILE');
  if (/(?:gitleaks-report|secret-scan-report)/.test(base)) errors.push('PRIVATE_SCAN_REPORT');
  return [...new Set(errors)];
}

export function textFindings(text) {
  const errors = [];
  const rules = [
    ['PRIVATE_KEY', /-----BEGIN (?:RSA |EC |OPENSSH |DSA |ENCRYPTED )?PRIVATE KEY-----/],
    ['GITHUB_TOKEN', /\b(?:gh[pousr]_[A-Za-z0-9]{30,}|github_pat_[A-Za-z0-9_]{35,})\b/],
    ['PROVIDER_TOKEN', /\bsk-(?:proj-|ant-[A-Za-z0-9]+-)?[A-Za-z0-9_-]{32,}\b/],
    ['AWS_ACCESS_KEY', /\b(?:AKIA|ASIA)[A-Z0-9]{16}\b/],
    ['CREDENTIAL_URI', /\b[a-z][a-z0-9+.-]*:\/\/[^\s/:]+:[^\s/@]+@/i],
    ['PRIVATE_IPV4', /\b(?:10\.\d{1,3}\.\d{1,3}\.\d{1,3}|192\.168\.\d{1,3}\.\d{1,3}|172\.(?:1[6-9]|2\d|3[01])\.\d{1,3}\.\d{1,3})\b/],
    ['PERSONAL_HOME_PATH', /(?:\/Users\/[A-Za-z0-9_.-]+|C:\\Users\\[A-Za-z0-9_.-]+|\/home\/(?!node(?:\/|\b))[A-Za-z0-9_.-]+)\//],
  ];
  for (const [id, re] of rules) if (re.test(text)) errors.push(id);
  const emails = text.match(/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g) ?? [];
  if (emails.some((email) => !/(?:@(?:[^@.]+\.)*example\.(?:com|org|net|test)|@users\.noreply\.github\.com)$/i.test(email))) errors.push('EMAIL_REVIEW_REQUIRED');
  return [...new Set(errors)];
}

export function scanBytes(name, bytes, approvedAssets = [], mode = '100644') {
  const errors = pathFindings(name);
  if (!['100644', '100755'].includes(mode)) return [...errors, 'NON_REGULAR_GIT_ENTRY'];
  if (bytes.length > MAX_BYTES) return [...errors, 'FILE_TOO_LARGE_FOR_GUARD'];
  const digest = createHash('sha256').update(bytes).digest('hex');
  const approved = approvedAssets.some((x) => x.path === name && x.sha256 === digest);
  let text;
  try {
    if (bytes.includes(0)) throw new Error('binary');
    text = TEXT_DECODER.decode(bytes);
  } catch {
    if (!approved) errors.push('UNREVIEWED_BINARY');
    return errors;
  }
  return [...errors, ...textFindings(text)];
}

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

function workspaceFiles(root, relative = '') {
  const entries = [];
  const skip = new Set(['.git', 'node_modules', 'dist', 'build', 'coverage', '.cache', '.tools']);
  for (const de of fs.readdirSync(path.join(root, relative), { withFileTypes: true })) {
    const name = relative ? `${relative}/${de.name}` : de.name;
    if (de.isDirectory()) {
      if (!skip.has(de.name)) entries.push(...workspaceFiles(root, name));
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
    manifestBytes = fs.existsSync(p) ? fs.readFileSync(p) : null;
  } else manifestBytes = git(root, ['show', ':config/public-assets.json'], true);
  const assets = manifestBytes ? JSON.parse(manifestBytes.toString('utf8')).assets : [];
  if (!Array.isArray(assets)) throw new Error('Invalid public-assets manifest.');
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
    let errors;
    if (!['100644', '100755'].includes(entry.mode)) errors = [...pathFindings(entry.name), 'NON_REGULAR_GIT_ENTRY'];
    else {
      const size = isWorkspace ? fs.statSync(path.join(root, entry.name)).size : Number(git(root, ['cat-file', '-s', entry.oid]).toString());
      if (size > MAX_BYTES) errors = [...pathFindings(entry.name), 'FILE_TOO_LARGE_FOR_GUARD'];
      else {
        const bytes = isWorkspace ? fs.readFileSync(path.join(root, entry.name)) : git(root, ['cat-file', 'blob', entry.oid]);
        errors = scanBytes(entry.name, bytes, assets, entry.mode);
      }
    }
    for (const rule of errors) findings.push({ path: entry.name, rule });
  }
  return { scanned: entries.length, findings };
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
    } else console.log(`Privacy guard: ${result.scanned} entries checked (${mode}); no covered findings. This is not a complete PII audit.`);
  } catch (error) {
    console.error(`Privacy guard failed closed: ${error.message}`);
    process.exitCode = 2;
  }
}
