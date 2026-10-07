import { createHash } from 'node:crypto';

export const MAX_BYTES = 8 * 1024 * 1024;
export const BLOCKED_DIRS = new Set(['.data', 'data', 'secrets', '.private', '.local', 'backups', 'exports', 'uploads', 'logs', '.codex', '.ssh', '.aws', '.tools', '.worktrees', 'worktrees', 'artifacts', 'screenshots', 'test-results', 'playwright-report', 'blob-report', 'node_modules']);
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
  if (base === '.gitleaksignore') errors.push('UNREVIEWED_SCAN_EXCEPTION');
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
  if (errors.length) return errors;
  if (!['100644', '100755'].includes(mode)) return [...errors, 'NON_REGULAR_GIT_ENTRY'];
  if (bytes.length > MAX_BYTES) return [...errors, 'FILE_TOO_LARGE_FOR_GUARD'];
  const digest = createHash('sha256').update(bytes).digest('hex');
  const approved = approvedAssets.some((x) => x.path === name && x.sha256 === digest);
  const assetType = /\.(?:pdf|svg|png|jpe?g|gif|webp|avif|ico|bmp|tiff?|zip|tar|tgz|gz|bz2|xz|7z|rar|docx|xlsx|pptx|mp[34]|mov|webm|wav|woff2?|ttf|otf)$/i.test(name) || bytes.subarray(0, 1024).includes(Buffer.from('%PDF-')) || bytes.subarray(0, 4).equals(Buffer.from([80, 75, 3, 4]));
  if (assetType && !approved) errors.push('UNREVIEWED_ASSET');
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
