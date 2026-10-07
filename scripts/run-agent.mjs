#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { inspectEnvironment } from './doctor.mjs';
import { runGuard } from './security-check.mjs';
import { codexConfigArgs } from './agent-profile.mjs';
import { checkCodexSandbox } from './agent-sandbox.mjs';
import { resolveCodexRuntime } from './agent-runtime.mjs';

try {
  if (process.argv.length > 3 || process.argv[2]?.startsWith('-')) throw new Error('Only a task prompt is accepted.');
  const root = process.cwd();
  const runtime = resolveCodexRuntime();
  if (inspectEnvironment(root).some((check) => !check.ok) || runGuard(root, '--workspace').findings.length || !await checkCodexSandbox({ runtime })) throw new Error('Agent safety preflight refused the runtime.');
  const scratch = path.join(root, '.cache', 'leaf-agent-tmp');
  fs.mkdirSync(scratch, { recursive: true });
  const args = ['exec', '--ignore-user-config', '--strict-config', '--ephemeral', '--cd', root, ...codexConfigArgs({ runtimeFiles: runtime.runtimeFiles })];
  if (process.argv[2]) args.push(process.argv[2]);
  const result = spawnSync(runtime.command, args, { stdio: 'inherit', env: { ...process.env, TMPDIR: scratch } });
  process.exitCode = result.status ?? 2;
} catch {
  console.error('Agent launch refused. Run doctor and agent:sandbox; no unsafe fallback was enabled.');
  process.exitCode = 2;
}
