import { textFindings } from './security-policy.mjs';

// Public GitHub service addresses, enabled only by indexed owner review.
const serviceEmails = new Map([
  ['github-dependabot', '49699333+dependabot[bot]' + '@' + 'users.noreply.github.com'],
  ['github-web-flow', 'noreply' + '@' + 'github.com'],
]);
const validFields = (fields) => Array.isArray(fields) && fields.length > 0 && fields.every((field) => ['author', 'committer'].includes(field)) && new Set(fields).size === fields.length;

const identityLine = /^(author|committer)( [^\r\n]* <)([^\s<>]+@[^\s<>]+)(> -?\d+ [+-]\d{4})$/;
function exactKeys(value, keys) {
  return value && typeof value === 'object' && !Array.isArray(value) && Object.keys(value).every((key) => keys.includes(key)) && keys.every((key) => Object.hasOwn(value, key));
}

export function parseMetadataReviews(bytes) {
  let manifest;
  try { manifest = JSON.parse(bytes.toString('utf8')); }
  catch { throw new Error('Invalid metadata review JSON; details suppressed.'); }
  const keys = manifest?.version === 2 ? ['version', 'commitEmailReviews', 'serviceEmailReviews'] : ['version', 'commitEmailReviews'];
  if (!exactKeys(manifest, keys) || ![1, 2].includes(manifest.version) || !Array.isArray(manifest.commitEmailReviews) || (manifest.version === 2 && !Array.isArray(manifest.serviceEmailReviews))) throw new Error('Invalid metadata review manifest.');
  const seen = new Set();
  for (const review of manifest.commitEmailReviews) {
    if (!exactKeys(review, ['oid', 'fields', 'review']) || typeof review.oid !== 'string' || !/^(?:[a-f0-9]{40}|[a-f0-9]{64})$/.test(review.oid) || seen.has(review.oid) || !Array.isArray(review.fields) || !review.fields.length || review.fields.some((field) => !['author', 'committer'].includes(field)) || new Set(review.fields).size !== review.fields.length || typeof review.review !== 'string' || !review.review.trim()) throw new Error('Unsafe or invalid metadata review.');
    seen.add(review.oid);
  }
  const services = manifest.serviceEmailReviews ?? [];
  const seenServices = new Set();
  for (const review of services) {
    const keys = Object.hasOwn(review ?? {}, 'allowSignedOffBy') ? ['service', 'fields', 'review', 'allowSignedOffBy'] : ['service', 'fields', 'review'];
    if (!exactKeys(review, keys) || (keys.length === 4 && (review.service !== 'github-dependabot' || review.allowSignedOffBy !== true || !review.fields.includes('author'))) || !serviceEmails.has(review.service) || seenServices.has(review.service) || !validFields(review.fields) || typeof review.review !== 'string' || !review.review.trim()) throw new Error('Unsafe or invalid service metadata review.');
    seenServices.add(review.service);
  }
  return [...manifest.commitEmailReviews, ...services];
}

/** Owner identity addresses come from immutable commits; services are fixed in code. */
export function reviewedCommitEmails(metadata, reviews) {
  const approved = { author: new Set(), committer: new Set(), dependabotSignedOffBy: false };
  const commits = new Map(metadata.filter((entry) => entry.kind === 'commit').map((entry) => [entry.oid, entry]));
  for (const review of reviews) {
    if (Object.hasOwn(review, 'service')) {
      const email = serviceEmails.get(review.service);
      if (!email || !validFields(review.fields)) throw new Error('Invalid service metadata review.');
      for (const field of review.fields) approved[field].add(email);
      if (review.service === 'github-dependabot' && review.allowSignedOffBy === true && review.fields.includes('author')) approved.dependabotSignedOffBy = true;
      continue;
    }
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
  let body = text.slice(boundary);
  const author = text.slice(0, boundary).split('\n').map((line) => identityLine.exec(line)).find((match) => match?.[1] === 'author');
  if (approved.dependabotSignedOffBy && author?.[2] === ' dependabot[bot] <' && author[3] === serviceEmails.get('github-dependabot')) {
    const lines = body.split('\n');
    let last = lines.length - 1;
    while (last >= 0 && lines[last] === '') last--;
    const trailer = 'Signed-off-by: dependabot[bot] <support' + '@' + 'github.com>';
    if (lines[last] === trailer) lines[last] = 'Signed-off-by: reviewed-public-service';
    body = lines.join('\n');
  }
  // Retain every other rule from the original bytes, even inside approved fields.
  if (textFindings(header + body).includes('EMAIL_REVIEW_REQUIRED')) return findings;
  return findings.filter((rule) => rule !== 'EMAIL_REVIEW_REQUIRED');
}
