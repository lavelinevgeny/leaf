import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { readWorkspaceFile } from './repository-files.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export function codexProfile(workspace = root) {
  return JSON.parse(readWorkspaceFile(workspace, 'config/agents/codex-permissions.json'));
}
function toml(value) {
  if (value && typeof value === 'object' && !Array.isArray(value)) return `{ ${Object.entries(value).map(([key, val]) => `${JSON.stringify(key)} = ${toml(val)}`).join(', ')} }`;
  return JSON.stringify(value);
}
export function codexConfigArgs({ runtimeFiles = [] } = {}) {
  const profile = codexProfile();
  for (const file of runtimeFiles) {
    if (!path.isAbsolute(file)) throw new Error('Runtime file must be absolute.');
    profile.filesystem[file] = 'read';
  }
  return ['-c', 'default_permissions="leaf"', '-c', `permissions.leaf=${toml(profile)}`, '-c', 'approval_policy="on-request"', '-c', 'shell_environment_policy.inherit="core"'];
}
