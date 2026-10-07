import { textFindings } from './security-policy.mjs';

const identityLine = /^(author|committer)( [^\r\n]* <)([^\s<>]+@[^\s<>]+)(> -?\d+ [+-]\d{4})$/;
function exactKeys(value, keys) {
  return value && typeof value === 'object' && !Array.isArray(value) && Object.keys(value).every((key) => keys.includes(key)) && keys.every((key) => Object.hasOwn(value, key));
}

export function parseMetadataReviews(bytes) {
  let manifest;
  try { manifest = JSON.parse(bytes.toString('utf8')); }
  catch { throw new Error('Invalid metadata review JSON; details suppressed.'); }
  if (!exactKeys(manifest, ['version', 'commitEmailReviews']) || manifest.version !== 1 || !Array.isArray(manifest.commitEmailReviews)) throw new Error('Invalid metadata review manifest.');
  const seen = new Set();
  for (const review of manifest.commitEmailReviews) {
    if (!exactKeys(review, ['oid', 'fields', 'review']) || typeof review.oid !== 'string' || !/^(?:[a-f0-9]{40}|[a-f0-9]{64})$/.test(review.oid) || seen.has(review.oid) || !Array.isArray(review.fields) || !review.fields.length || review.fields.some((field) => !['author', 'committer'].includes(field)) || new Set(review.fields).size !== review.fields.length || typeof review.review !== 'string' || !review.review.trim()) throw new Error('Unsafe or invalid metadata review.');
    seen.add(review.oid);
  }
  return manifest.commitEmailReviews;
}

/** Approved addresses exist only in memory, sourced from immutable commits. */
export function reviewedCommitEmails(metadata, reviews) {
  const approved = { author: new Set(), committer: new Set() };
  const commits = new Map(metadata.filter((entry) => entry.kind === 'commit').map((entry) => [entry.oid, entry]));
  for (const review of reviews) {
    const entry = commits.get(review.oid);
    if (!entry) throw new Error('Metadata review source must be a reachable commit.');
    const text = entry.bytes.toString('utf8');
    const boundary = text.indexOf('\n\n');
    if (boundary < 0) throw new Error('Invalid reviewed commit header.');
    const identities = text.slice(0, boundary).split('\n').map((line) => identityLine.exec(line)).filter(Boolean);
    for (const field of review.fields) {
      const matching = identities.filter((match) => match[1] === field);
      if (matching.length !== 1) throw new Error('Reviewed commit identity must be unambiguous.');
      approved[field].add(matching[0][3]);
    }
  }
  return approved;
}

export function metadataFindings(entry, approved) {
  const text = entry.bytes.toString('utf8');
  const findings = textFindings(text);
  if (entry.kind !== 'commit' || !findings.includes('EMAIL_REVIEW_REQUIRED')) return findings;
  const boundary = text.indexOf('\n\n');
  if (boundary < 0) return findings;
  const header = text.slice(0, boundary).split('\n').map((line) => {
    const match = identityLine.exec(line);
    if (!match || !approved[match[1]].has(match[3])) return line;
    return `${match[1]}${match[2]}reviewed-email${match[4]}`;
  }).join('\n');
  // Retain every other rule from the original bytes, even inside approved fields.
  if (textFindings(header + text.slice(boundary)).includes('EMAIL_REVIEW_REQUIRED')) return findings;
  return findings.filter((rule) => rule !== 'EMAIL_REVIEW_REQUIRED');
}
