import { beforeEach, afterEach, expect, it, vi } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import Database from 'better-sqlite3';
import { buildApp, type LeafApp } from '../src/server/app.js';
import {
  rawSyntheticCountsAndRevision,
  validLegacyBodyForRoute,
} from './helpers/optional-api-fixtures.js';
let app: LeafApp;
let db: Database.Database;
let dir: string;
let projectId: string;
let cookie: string;
const origin = 'http://127.0.0.1:3000';
beforeEach(async () => {
  dir = mkdtempSync(join(tmpdir(), 'leaf-optional-api-'));
  app = await buildApp({
    databasePath: join(dir, 'synthetic.sqlite'),
    publicOrigin: origin,
  });
  await app.auth.setup('Synthetic-test-only-passphrase');
  const login = await app.inject({
    method: 'POST',
    url: '/api/auth/login',
    headers: { origin },
    payload: { password: 'Synthetic-test-only-passphrase' },
  });
  cookie = `leaf_session=${login.cookies[0]!.value}`;
  projectId = app.repository.createProject('Synthetic').id;
  db = new Database(join(dir, 'synthetic.sqlite'));
});
afterEach(async () => {
  db.close();
  await app.close();
  rmSync(dir, { recursive: true, force: true });
});
it.each([
  'GET list',
  'POST list',
  'PATCH project',
  'GET tree',
  'GET schedule',
  'POST commands',
])('rejects legacy route %s before repository access', async (key) => {
  const [method, kind] = key.split(' ');
  const url =
    kind === 'list'
      ? '/api/projects'
      : `/api/projects/${projectId}${kind === 'project' ? '' : `/${kind}`}`;
  const before = rawSyntheticCountsAndRevision(db, projectId);
  const spies = [
    'getTree',
    'getSchedule',
    'listProjects',
    'createProject',
    'renameProject',
    'applyCommand',
    'replayLegacy',
  ].map((name) => vi.spyOn(app.repository, name as 'getTree'));
  for (const version of [undefined, '1', '3']) {
    const response = await app.inject({
      method: method as 'GET' | 'POST' | 'PATCH',
      url,
      headers: {
        origin,
        cookie,
        'content-type': 'application/json',
        ...(version ? { 'x-leaf-contract-version': version } : {}),
      },
      ...(method === 'GET'
        ? {}
        : { payload: validLegacyBodyForRoute(method!, url) }),
    });
    expect(response.statusCode).toBe(426);
    expect(response.json()).toEqual({
      code: 'CONTRACT_VERSION_CONFLICT',
      message:
        'Версия приложения устарела. Обновите страницу для продолжения. Этот запрос не изменил данные.',
    });
    expect(rawSyntheticCountsAndRevision(db, projectId)).toEqual(before);
  }
  for (const spy of spies) expect(spy).not.toHaveBeenCalled();
});
