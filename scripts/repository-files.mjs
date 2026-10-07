import fs from 'node:fs';
import path from 'node:path';
import { MAX_BYTES, pathFindings } from './security-policy.mjs';

/** Only regular public workspace inputs; never follow a symlink in the path. */
export function readWorkspaceFile(root, name) {
  if (pathFindings(name).length) throw new Error('Private workspace input rejected before reading.');
  let current = path.resolve(root);
  const parts = name.split('/');
  for (let i = 0; i < parts.length; i++) {
    current = path.join(current, parts[i]);
    const stat = fs.lstatSync(current);
    if (stat.isSymbolicLink() || (i < parts.length - 1 ? !stat.isDirectory() : !stat.isFile())) throw new Error('Workspace input must be regular; symlinks are forbidden.');
    if (i === parts.length - 1 && stat.size > MAX_BYTES) throw new Error('Workspace input exceeds the guard size limit.');
  }
  const fd = fs.openSync(current, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW);
  try {
    if (fs.fstatSync(fd).size > MAX_BYTES) throw new Error('Workspace input exceeds the guard size limit.');
    return fs.readFileSync(fd);
  } finally { fs.closeSync(fd); }
}
