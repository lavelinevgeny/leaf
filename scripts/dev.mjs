import { spawn } from 'node:child_process';
if (!process.env.LEAF_DATA_DIR) {
  console.error(
    'Set LEAF_DATA_DIR to an absolute synthetic runtime directory outside checkout.',
  );
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
          process.env.LEAF_PUBLIC_ORIGIN ?? 'http://127.0.0.1:5173',
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
