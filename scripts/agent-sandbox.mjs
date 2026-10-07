#!/usr/bin/env node
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import net from 'node:net';
import { randomBytes } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';
import { codexConfigArgs } from './agent-profile.mjs';
import { resolveCodexRuntime } from './agent-runtime.mjs';

/** No model calls and no credential inspection; all probe data is disposable. */
export async function checkCodexSandbox({ runtime = resolveCodexRuntime(), run = spawnSync } = {}) {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), 'leaf-sandbox-smoke-'));
  const workspace = path.join(base, 'workspace');
  fs.mkdirSync(path.join(workspace, 'scratch'), { recursive: true });
  const privateFiles = ['.env', 'nested/.env.audit', 'data/demo.txt', 'nested/data/demo.txt', '.hidden/data/demo.txt', 'nested/deeper/data/demo.txt', 'secrets/demo.txt', 'nested/secrets/demo.txt', '.codex/demo.txt', 'nested/.codex/demo.txt'];
  for (const name of ['public.txt', ...privateFiles]) {
    fs.mkdirSync(path.dirname(path.join(workspace, name)), { recursive: true });
    fs.writeFileSync(path.join(workspace, name), 'Synthetic fixture');
  }
  const outside = path.join(base, 'outside.txt');
  fs.writeFileSync(outside, 'Synthetic outside fixture');
  const proof = `SANDBOX_SMOKE_PASS:${randomBytes(16).toString('hex')}`;
  const proofFile = path.join(workspace, 'scratch', 'proof.txt');
  const server = net.createServer((socket) => socket.destroy());
  try {
    await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
    const port = server.address().port;
    const probe = `
      import fs from 'node:fs';
      import net from 'node:net';
      fs.readFileSync('public.txt');
      fs.writeFileSync('scratch/result.txt', 'Synthetic result');
      for (const name of ${JSON.stringify([...privateFiles, outside])}) {
        let refused = false;
        try { fs.readFileSync(name); } catch (error) { refused = ['EACCES', 'EPERM', 'ENOENT'].includes(error.code); }
        if (!refused) process.exit(1);
      }
      const blocked = await new Promise((resolve) => {
        const socket = net.connect(${port}, '127.0.0.1');
        socket.on('connect', () => { socket.destroy(); resolve(false); });
        socket.on('error', (error) => resolve(['EACCES', 'EPERM', 'ENETUNREACH'].includes(error.code)));
        socket.setTimeout(2000, () => { socket.destroy(); resolve(false); });
      });
      if (!blocked) process.exit(1);
      // CLI versions can suppress stdout. Only all completed checks create proof.
      fs.writeFileSync('scratch/proof.txt', ${JSON.stringify(proof)}, { flag: 'wx' });
    `;
    const result = run(runtime.command, ['sandbox', '--permission-profile', 'leaf', ...codexConfigArgs({ runtimeFiles: runtime.runtimeFiles }), '--cd', workspace, '--', process.execPath, '--input-type=module', '-e', probe], { encoding: 'utf8', timeout: 15000, env: { ...process.env, TMPDIR: path.join(workspace, 'scratch') }, maxBuffer: 1024 * 1024 });
    if (result.status !== 0 || result.error || !fs.existsSync(proofFile)) return false;
    const stat = fs.lstatSync(proofFile);
    return stat.isFile() && !stat.isSymbolicLink() && stat.size === Buffer.byteLength(proof) && fs.readFileSync(proofFile, 'utf8') === proof && fs.existsSync(path.join(workspace, 'scratch/result.txt'));
  } finally {
    server.close();
    fs.rmSync(base, { recursive: true, force: true });
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  try {
    if (process.argv.length !== 2) throw new Error('Unexpected arguments.');
    const ok = await checkCodexSandbox();
    console.log(ok ? 'PASS Codex OS sandbox: public read/write, private/outside read denial and network denial.' : 'FAIL Codex OS sandbox or profile support. No fallback; inspect runtime dependencies locally.');
    process.exitCode = ok ? 0 : 1;
  } catch {
    console.error('Sandbox smoke failed closed; details suppressed.');
    process.exitCode = 2;
  }
}
