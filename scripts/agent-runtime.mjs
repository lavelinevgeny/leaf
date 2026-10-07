import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';

function executableOnPath(searchPath, platform) {
  for (const directory of (searchPath ?? '').split(path.delimiter)) {
    if (!path.isAbsolute(directory)) continue;
    for (const name of platform === 'win32' ? ['codex.exe', 'codex.cmd', 'codex'] : ['codex']) {
      const candidate = path.join(directory, name);
      try {
        fs.accessSync(candidate, platform === 'win32' ? fs.constants.F_OK : fs.constants.X_OK);
        if (fs.statSync(candidate).isFile()) return fs.realpathSync(candidate);
      } catch { /* Try the next installed executable without inspecting its contents. */ }
    }
  }
  throw new Error('Codex executable unavailable.');
}

function isNative(file) {
  const privateDirectories = new Set(['.codex', '.claude', '.ssh', '.aws', 'secrets', '.private']);
  if (file.replaceAll('\\', '/').split('/').some((part) => privateDirectories.has(part.toLowerCase())) || !/^(?:node(?:\.exe)?|codex(?:\.js|\.exe|-[A-Za-z0-9_-]+)?)$/.test(path.basename(file))) throw new Error('Private or unsupported runtime path.');
  const fd = fs.openSync(file, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW);
  try {
    const magic = Buffer.alloc(4);
    const length = fs.readSync(fd, magic, 0, magic.length, 0);
    return length >= 2 && (magic.subarray(0, 2).toString('ascii') === 'MZ' || ['7f454c46', 'feedface', 'feedfacf', 'cefaedfe', 'cffaedfe', 'cafebabe', 'bebafeca'].includes(magic.toString('hex')));
  } finally { fs.closeSync(fd); }
}

/** Resolve public installed code only. Auth/config directories are never opened. */
export function resolveCodexRuntime({ searchPath = process.env.PATH, nodeExecutable = process.execPath, platform = process.platform, arch = process.arch } = {}) {
  const command = executableOnPath(searchPath, platform);
  let helper = command;
  if (!isNative(command)) {
    if (path.basename(command) !== 'codex.js') throw new Error('Unsupported Codex wrapper.');
    const packageRoot = path.resolve(path.dirname(command), '..');
    const packageFile = path.join(packageRoot, 'package.json');
    if (JSON.parse(fs.readFileSync(packageFile, 'utf8')).name !== '@openai/codex') throw new Error('Unknown Codex package.');
    const targets = {
      'linux:x64': ['codex-linux-x64', 'x86_64-unknown-linux-musl'],
      'linux:arm64': ['codex-linux-arm64', 'aarch64-unknown-linux-musl'],
      'darwin:x64': ['codex-darwin-x64', 'x86_64-apple-darwin'],
      'darwin:arm64': ['codex-darwin-arm64', 'aarch64-apple-darwin'],
      'win32:x64': ['codex-win32-x64', 'x86_64-pc-windows-msvc'],
      'win32:arm64': ['codex-win32-arm64', 'aarch64-pc-windows-msvc'],
    };
    const target = targets[`${platform}:${arch}`];
    if (!target) throw new Error('Unsupported Codex platform.');
    let vendor = path.join(packageRoot, 'vendor');
    try { vendor = path.join(path.dirname(createRequire(packageFile).resolve(`@openai/${target[0]}/package.json`)), 'vendor'); }
    catch { /* Older npm packages keep the vendor directory in the main package. */ }
    helper = fs.realpathSync(path.join(vendor, target[1], 'bin', platform === 'win32' ? 'codex.exe' : 'codex'));
    if (!fs.statSync(helper).isFile() || !isNative(helper)) throw new Error('Codex native helper unavailable.');
  }
  const node = fs.realpathSync(nodeExecutable);
  if (!fs.statSync(node).isFile() || !isNative(node)) throw new Error('Node runtime unavailable.');
  return { command, runtimeFiles: [...new Set([node, helper])] };
}
