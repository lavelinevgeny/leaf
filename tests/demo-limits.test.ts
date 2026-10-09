import { expect, it } from 'vitest';
import {
  DemoLimits,
  DEMO_BUSY,
  DEMO_EXHAUSTED,
} from '../src/server/demo-limits.js';
it('enforces exact parsed JSON UTF-8 byte boundary atomically, including non-ASCII', () => {
  let now = 0;
  const limits = new DemoLimits(() => now);
  const body = { title: 'я'.repeat(65530) };
  const bytes = Buffer.byteLength(JSON.stringify(body), 'utf8');
  expect(bytes).toBe(131072);
  limits.admitMutation(body);
  limits.admitMutation(body);
  expect(() => limits.admitMutation({})).toThrow(DEMO_EXHAUSTED);
  const short = new DemoLimits(() => now);
  for (let i = 0; i < 120; i++) short.admitMutation({});
  expect(() => short.admitMutation({})).toThrow(DEMO_BUSY);
  now += 60000;
  for (let i = 0; i < 80; i++) short.admitMutation({});
  expect(() => short.admitMutation({})).toThrow(DEMO_EXHAUSTED);
});
