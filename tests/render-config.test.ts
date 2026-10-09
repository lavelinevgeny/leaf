import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { expect, it } from 'vitest';

const root = new URL('..', import.meta.url).pathname;

it('declares exactly one manual free Docker web service with matching ports', () => {
  const blueprint = readFileSync(join(root, 'render.yaml'), 'utf8');
  expect(blueprint.match(/^  - type:.*$/gm)).toEqual(['  - type: web']);
  for (const line of [
    '    name: leaf-demo',
    '    runtime: docker',
    '    plan: free',
    '    dockerfilePath: ./Dockerfile',
    '    dockerContext: .',
    '    healthCheckPath: /readyz',
    '    autoDeployTrigger: off',
    '      - key: LEAF_DEMO_MODE\n        value: "1"',
    '      - key: LEAF_HOST\n        value: 0.0.0.0',
    '      - key: LEAF_PORT\n        value: "3000"',
    '      - key: PORT\n        value: "3000"',
  ])
    expect(blueprint).toContain(line);
  expect(blueprint).not.toMatch(
    /(?:repo|disk|preDeploy|releaseCommand|secret|sync):/i,
  );
  expect(blueprint.match(/^      - key:/gm)).toHaveLength(4);
});

it('does not bake a public origin into the runtime image', () => {
  const dockerfile = readFileSync(join(root, 'Dockerfile'), 'utf8');
  expect(dockerfile).not.toMatch(/^ENV .*LEAF_PUBLIC_ORIGIN/m);
  expect(dockerfile).toContain('USER node');
  expect(dockerfile).toContain('EXPOSE 3000');
  expect(dockerfile).toContain("+'/readyz'");
});
