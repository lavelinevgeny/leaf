#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';
import { checkFixtures } from './check-fixtures.mjs';
import { parseAssetManifest, validateCurrentAssets } from './public-assets.mjs';
import { readWorkspaceFile } from './repository-files.mjs';
import { parseMetadataReviews } from './git-metadata-reviews.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
function walk(dir) {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((de) => de.isDirectory() ? walk(path.join(dir, de.name)) : [path.join(dir, de.name)]);
}
try {
  for (const name of ['START_HERE.md', 'AGENTS.md', 'CLAUDE.md', 'README.md', 'SECURITY.md', 'docs/PROJECT.md', 'docs/DECISIONS.md', 'docs/SCHEDULING.md', 'docs/UI.md', 'docs/BOOTSTRAP.md', 'docs/PRIVACY.md', 'docs/VALIDATION.md', '.gitignore', '.dockerignore', '.githooks/pre-commit', '.githooks/pre-push']) assert.ok(fs.existsSync(path.join(root, name)), `Missing ${name}`);
  const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
  assert.equal(pkg.name, 'leaf');
  assert.equal(pkg.private, true, 'Prevent accidental npm publication');
  assert.ok(fs.readFileSync(path.join(root, 'CLAUDE.md'), 'utf8').includes('@AGENTS.md'));
  const manifest = parseAssetManifest(readWorkspaceFile(root, 'config/public-assets.json'));
  validateCurrentAssets(root, manifest);
  parseMetadataReviews(readWorkspaceFile(root, 'config/public-git-metadata.json'));
  const references = fs.readdirSync(path.join(root, 'design/references')).sort();
  assert.deepEqual(references, ['01-main-screen.png', '02-task-panel.png', '03-dependencies.png']);
  const markdown = [
    ...fs.readdirSync(root).filter((f) => f.endsWith('.md')).map((f) => path.join(root, f)),
    ...['docs', 'design', 'fixtures'].flatMap((dir) => walk(path.join(root, dir)).filter((f) => f.endsWith('.md'))),
  ];
  let links = 0;
  for (const filename of markdown) {
    const text = fs.readFileSync(filename, 'utf8');
    for (const match of text.matchAll(/\[[^\]]*\]\(([^)]+)\)/g)) {
      const target = match[1].split('#')[0];
      if (!target || /^(?:https?:|mailto:)/.test(target)) continue;
      const absolute = path.resolve(path.dirname(filename), decodeURIComponent(target));
      assert.ok(absolute.startsWith(`${root}${path.sep}`), 'Document link outside root');
      assert.ok(fs.existsSync(absolute), `Broken local link in ${path.relative(root, filename)}: ${target}`);
      links++;
    }
  }
  const fixtures = checkFixtures(root);
  const agentScenarios = JSON.parse(readWorkspaceFile(root, 'fixtures/agents/scenarios.json'));
  assert.equal(agentScenarios.syntheticOnly, true);
  assert.ok(Array.isArray(agentScenarios.scenarios) && agentScenarios.scenarios.length === 5);
  assert.equal(new Set(agentScenarios.scenarios.map((scenario) => scenario.id)).size, 5);
  for (const scenario of agentScenarios.scenarios) assert.ok(typeof scenario.id === 'string' && typeof scenario.prompt === 'string' && scenario.prompt.length && Array.isArray(scenario.acceptance) && scenario.acceptance.length && scenario.acceptance.every((criterion) => typeof criterion === 'string' && criterion.length));
  console.log(`Kit checked: ${markdown.length} Markdown files, ${links} local links, 3 approved references, ${fixtures.cpm} CPM and ${fixtures.calendar} calendar examples.`);
  console.log('This checks the repository kit, not an implemented leaf application.');
  console.log('Five model smoke scenarios validated as data, not executed against a model.');
} catch (error) {
  console.error(`Kit check failed: ${error.message}`);
  process.exitCode = 1;
}
