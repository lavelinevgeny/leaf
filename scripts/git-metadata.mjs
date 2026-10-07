import { spawnSync } from 'node:child_process';
import { MAX_BYTES } from './security-policy.mjs';

function git(cwd, args) {
  const result = spawnSync('git', args, { cwd, maxBuffer: 64 * 1024 * 1024 });
  if (result.error || result.status !== 0) throw new Error('Cannot inspect Git metadata; details suppressed.');
  return result.stdout;
}

/** Raw metadata stays in memory. Callers may expose only object IDs and rules. */
export function readGitMetadata(cwd) {
  const commits = git(cwd, ['rev-list', '--all']).toString('utf8').trim().split('\n').filter(Boolean);
  const tags = git(cwd, ['for-each-ref', '--format=%(objecttype) %(objectname)', 'refs/tags']).toString('utf8').trim().split('\n').filter((line) => line.startsWith('tag ')).map((line) => line.slice(4));
  const entries = [];
  const seen = new Set();
  for (const [kind, ids] of [['commit', commits], ['tag', tags]]) {
    for (let i = 0; i < ids.length; i++) {
      const oid = ids[i];
      if (!/^[a-f0-9]{40,64}$/.test(oid)) throw new Error('Invalid Git object ID.');
      if (seen.has(oid)) continue;
      seen.add(oid);
      const size = Number(git(cwd, ['cat-file', '-s', oid]).toString('utf8'));
      if (!Number.isSafeInteger(size) || size > MAX_BYTES) throw new Error('Git metadata exceeds the guard size limit.');
      const bytes = git(cwd, ['cat-file', kind, oid]);
      entries.push({ oid, kind, bytes });
      if (kind === 'tag') {
        const header = bytes.toString('utf8').split('\n\n')[0];
        if (/^type tag$/m.test(header)) {
          const target = /^object ([a-f0-9]{40,64})$/m.exec(header)?.[1];
          if (!target) throw new Error('Invalid nested tag metadata.');
          ids.push(target);
        }
      }
    }
  }
  return entries;
}
