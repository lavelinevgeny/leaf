import { spawn } from 'node:child_process';
if (!process.env.LEAF_DATA_DIR) {
  console.error(
    'Set LEAF_DATA_DIR to an absolute synthetic runtime directory outside checkout.',
  );
  process.exit(1);
}
const frontendPort = process.env.LEAF_DEV_PORT ?? '5173';
if (
  !/^\d+$/.test(frontendPort) ||
  Number(frontendPort) < 1 ||
  Number(frontendPort) > 65535
) {
  console.error('LEAF_DEV_PORT must be an integer between 1 and 65535.');
  process.exit(1);
}
const children = [
  spawn(
    process.execPath,
    ['--import', 'tsx', '--watch', 'src/server/main.ts'],
    {
      stdio: 'inherit',
      env: {
        ...process.env,
        LEAF_PUBLIC_ORIGIN:
          process.env.LEAF_PUBLIC_ORIGIN ?? `http://127.0.0.1:${frontendPort}`,
      },
    },
  ),
  spawn(process.execPath, ['node_modules/vite/bin/vite.js'], {
    stdio: 'inherit',
  }),
];
let stopping = false;
function stop(code = 0) {
  if (stopping) return;
  stopping = true;
  process.exitCode = code;
  for (const child of children) child.kill('SIGTERM');
}
for (const child of children) {
  child.once('error', () => stop(1));
  child.once('exit', (code) => stop(code ?? 1));
}
process.once('SIGINT', () => stop());
process.once('SIGTERM', () => stop());
