import { defineConfig } from '@playwright/test';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

export default defineConfig({
  testDir: './tests/e2e',
  outputDir: mkdtempSync(join(tmpdir(), 'leaf-playwright-')),
  fullyParallel: false,
  workers: 1,
  retries: 0,
  timeout: 45_000,
  reporter: 'list',
  use: { trace: 'off', video: 'off', screenshot: 'off' },
  projects: [
    { name: '1440x900', use: { viewport: { width: 1440, height: 900 } } },
    { name: '1280x800', use: { viewport: { width: 1280, height: 800 } } },
  ],
});
