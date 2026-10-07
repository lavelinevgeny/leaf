import { createHash } from 'node:crypto';
import { pathFindings } from './security-policy.mjs';
import { readWorkspaceFile } from './repository-files.mjs';

export function parseAssetManifest(bytes) {
  let manifest;
  try { manifest = JSON.parse(bytes.toString('utf8')); }
  catch { throw new Error('Invalid public-assets JSON; details suppressed.'); }
  if (!manifest || ![undefined, 1, 2].includes(manifest.version) || !Array.isArray(manifest.assets) || (manifest.version === 2 && !Array.isArray(manifest.historicalAssets))) throw new Error('Invalid public-assets manifest.');
  const historicalAssets = manifest.historicalAssets ?? [];
  if (!Array.isArray(historicalAssets)) throw new Error('Invalid historical asset approvals.');
  const seenPaths = new Set();
  const seenPairs = new Set();
  for (const [list, current] of [[manifest.assets, true], [historicalAssets, false]]) {
    for (const asset of list) {
      if (!asset || typeof asset.path !== 'string' || !asset.path || asset.path.includes('\\') || asset.path.split('/').some((p) => !p || p === '.') || pathFindings(asset.path).length || typeof asset.sha256 !== 'string' || !/^[a-f0-9]{64}$/.test(asset.sha256)) throw new Error('Unsafe or invalid public asset approval.');
      const key = `${asset.path}\0${asset.sha256}`;
      if (seenPairs.has(key) || (current && seenPaths.has(asset.path))) throw new Error('Duplicate public asset approval.');
      seenPairs.add(key);
      if (current) seenPaths.add(asset.path);
    }
  }
  return { assets: manifest.assets, historicalAssets };
}

export function validateCurrentAssets(root, manifest) {
  for (const asset of manifest.assets) {
    const bytes = readWorkspaceFile(root, asset.path);
    if (createHash('sha256').update(bytes).digest('hex') !== asset.sha256) throw new Error('Current public asset hash does not match its approval.');
  }
}
