import { beforeEach, afterEach, describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { buildApp, type LeafApp } from '../src/server/app.js';
import type { Command, Project, ProjectTree } from '../src/shared/contracts.js';

const origin = 'http://127.0.0.1:3000';
const syntheticPassword = ['Synthetic', 'test-only', 'passphrase'].join('-');
let app: LeafApp;
let dir: string;
let now: number;
beforeEach(async () => {
  dir = mkdtempSync(join(tmpdir(), 'leaf-api-'));
  now = Date.parse('2026-10-07T00:00:00Z');
  app = await buildApp({
    databasePath: join(dir, 'synthetic.sqlite'),
    publicOrigin: origin,
    now: () => now,
  });
});
afterEach(async () => {
  await app.close();
  rmSync(dir, { recursive: true, force: true });
});
async function login() {
  await app.auth.setup(syntheticPassword);
  const response = await app.inject({
    method: 'POST',
    url: '/api/auth/login',
    headers: { origin },
    payload: { password: syntheticPassword },
  });
  expect(response.statusCode).toBe(200);
  return response.cookies[0]!.value;
}
function headers(cookie: string) {
  return { origin, cookie: `leaf_session=${cookie}` };
}
async function project(cookie: string) {
  const response = await app.inject({
    method: 'POST',
    url: '/api/projects',
    headers: headers(cookie),
    payload: { title: 'Synthetic project' },
  });
  expect(response.statusCode).toBe(201);
  return response.json<Project>();
}
async function command(
  cookie: string,
  tree: ProjectTree,
  cmd: Command,
  operationId = randomUUID(),
  revision = tree.project.revision,
) {
  return app.inject({
    method: 'POST',
    url: `/api/projects/${tree.project.id}/commands`,
    headers: headers(cookie),
    payload: { expectedRevision: revision, operationId, command: cmd },
  });
}
describe('authenticated API boundary', () => {
  it('closes data when no account exists and exposes only health/session metadata', async () => {
    expect((await app.inject('/healthz')).json()).toEqual({ ok: true });
    expect((await app.inject('/readyz')).statusCode).toBe(200);
    expect((await app.inject('/api/auth/session')).json()).toEqual({
      authenticated: false,
      setupRequired: true,
    });
    expect((await app.inject('/api/projects')).statusCode).toBe(401);
    expect(
      (
        await app.inject({
          method: 'POST',
          url: '/api/auth/setup',
          headers: { origin },
          payload: { password: syntheticPassword },
        })
      ).statusCode,
    ).toBe(404);
  });
  it('logs in, uses opaque cookie, expires, and revokes logout', async () => {
    const cookie = await login();
    expect(
      (
        await app.inject({ url: '/api/auth/session', headers: headers(cookie) })
      ).json(),
    ).toEqual({ authenticated: true, setupRequired: false });
    const response = await app.inject({
      method: 'POST',
      url: '/api/auth/login',
      headers: { origin },
      payload: { password: syntheticPassword },
    });
    expect(String(response.headers['set-cookie']).includes('HttpOnly')).toBe(
      true,
    );
    expect(
      String(response.headers['set-cookie']).includes('SameSite=Strict'),
    ).toBe(true);
    expect(String(response.headers['set-cookie']).includes('Secure')).toBe(
      false,
    );
    expect(response.cookies[0]!.value === cookie).toBe(false);
    expect(response.cookies[0]!.value.length).toBeGreaterThan(40);
    expect(
      (
        await app.inject({
          method: 'POST',
          url: '/api/auth/logout',
          headers: headers(cookie),
          payload: {},
        })
      ).statusCode,
    ).toBe(200);
    expect(
      (await app.inject({ url: '/api/projects', headers: headers(cookie) }))
        .statusCode,
    ).toBe(401);
    now += 8 * 24 * 60 * 60 * 1000;
    expect(
      (
        await app.inject({
          url: '/api/projects',
          headers: headers(response.cookies[0]!.value),
        })
      ).statusCode,
    ).toBe(401);
  });
  it('requires exact origin and JSON for mutations, without logging sensitive values', async () => {
    const cookie = await login();
    for (const invalidOrigin of [
      undefined,
      'null',
      'http://127.0.0.1:3000.evil.test',
      'http://localhost:3000',
    ]) {
      const response = await app.inject({
        method: 'POST',
        url: '/api/projects',
        headers: {
          cookie: `leaf_session=${cookie}`,
          ...(invalidOrigin ? { origin: invalidOrigin } : {}),
        },
        payload: { title: 'A' },
      });
      expect(response.statusCode).toBe(403);
    }
    expect(
      (
        await app.inject({
          method: 'POST',
          url: '/api/projects',
          headers: { ...headers(cookie), 'content-type': 'text/plain' },
          payload: 'Synthetic',
        })
      ).statusCode,
    ).toBe(415);
    expect(
      (
        await app.inject({
          method: 'POST',
          url: '/api/projects',
          headers: headers(cookie),
          payload: { title: 'A', unknown: true },
        })
      ).statusCode,
    ).toBe(400);
    expect(
      (
        await app.inject({
          method: 'POST',
          url: '/api/projects',
          headers: headers(cookie),
          payload: { title: ' '.repeat(65537) },
        })
      ).statusCode,
    ).toBe(413);
  });
  it('rate limits uniform incorrect login responses', async () => {
    await app.auth.setup(syntheticPassword);
    for (let i = 0; i < 5; i++) {
      const response = await app.inject({
        method: 'POST',
        url: '/api/auth/login',
        headers: { origin },
        payload: { password: 'synthetic-invalid' },
      });
      expect(response.statusCode).toBe(401);
      expect(response.json()).toEqual({
        code: 'INVALID_LOGIN',
        message: 'Не удалось войти.',
      });
    }
    expect(
      (
        await app.inject({
          method: 'POST',
          url: '/api/auth/login',
          headers: { origin },
          payload: { password: syntheticPassword },
        })
      ).statusCode,
    ).toBe(429);
    now += 60001;
    expect(
      (
        await app.inject({
          method: 'POST',
          url: '/api/auth/login',
          headers: { origin },
          payload: { password: syntheticPassword },
        })
      ).statusCode,
    ).toBe(200);
  });
  it('returns complete snapshots, schema/revision conflicts and safe errors', async () => {
    const cookie = await login();
    const created = await project(cookie);
    let tree = (
      await app.inject({
        url: `/api/projects/${created.id}/tree`,
        headers: headers(cookie),
      })
    ).json<ProjectTree>();
    const operationId = randomUUID();
    const response = await command(
      cookie,
      tree,
      { type: 'task.create', title: 'A', parentId: null },
      operationId,
    );
    expect(response.statusCode).toBe(200);
    const first = response.json<ProjectTree>();
    expect(
      (
        await command(
          cookie,
          tree,
          { type: 'task.create', title: 'A', parentId: null },
          operationId,
        )
      ).json(),
    ).toEqual(first);
    expect(
      (
        await command(cookie, tree, {
          type: 'task.create',
          title: 'B',
          parentId: null,
        })
      ).statusCode,
    ).toBe(409);
    expect(
      (
        await command(
          cookie,
          tree,
          { type: 'task.create', title: 'B', parentId: null },
          operationId,
        )
      ).statusCode,
    ).toBe(409);
    tree = first;
    const taskId = tree.tasks[0]!.id;
    expect(
      (
        await command(cookie, tree, {
          type: 'task.update',
          taskId,
          changes: { inputStart: '2026-02-30' },
        })
      ).statusCode,
    ).toBe(400);
    const deleted = await command(cookie, tree, {
      type: 'task.delete',
      taskId,
    });
    expect(deleted.json<ProjectTree>().tasks).toHaveLength(0);
    const undone = await command(cookie, deleted.json<ProjectTree>(), {
      type: 'undo',
    });
    expect(undone.json<ProjectTree>().tasks[0]!.id).toBe(taskId);
    const renamed = await app.inject({
      method: 'PATCH',
      url: `/api/projects/${created.id}`,
      headers: headers(cookie),
      payload: {
        title: 'Renamed',
        expectedRevision: undone.json<ProjectTree>().project.revision,
        operationId: randomUUID(),
      },
    });
    expect(renamed.json<ProjectTree>().project.title).toBe('Renamed');
    const invalid = await app.inject({
      url: '/api/projects/invalid/tree',
      headers: headers(cookie),
    });
    expect(invalid.statusCode).toBe(400);
    expect(Object.keys(invalid.json())).toEqual(['code', 'message']);
  });
  it('marks session-scoped undo unavailable after another login mutation', async () => {
    const cookie = await login();
    const p = await project(cookie);
    let tree = app.repository.getTree(p.id, app.auth.session(cookie)!);
    tree = (
      await command(cookie, tree, {
        type: 'task.create',
        title: 'A',
        parentId: null,
      })
    ).json<ProjectTree>();
    const other = (
      await app.inject({
        method: 'POST',
        url: '/api/auth/login',
        headers: { origin },
        payload: { password: syntheticPassword },
      })
    ).cookies[0]!.value;
    const otherTree = (
      await command(other, tree, {
        type: 'task.create',
        title: 'B',
        parentId: null,
      })
    ).json<ProjectTree>();
    const refreshed = (
      await app.inject({
        url: `/api/projects/${p.id}/tree`,
        headers: headers(cookie),
      })
    ).json<ProjectTree>();
    expect(refreshed.canUndo).toBe(false);
    expect(
      (await command(cookie, otherTree, { type: 'undo' })).statusCode,
    ).toBe(409);
  });
  it('uses Secure cookies for HTTPS configured origin', async () => {
    await app.close();
    app = await buildApp({
      databasePath: join(dir, 'secure.sqlite'),
      publicOrigin: 'https://example.test',
    });
    await app.auth.setup(syntheticPassword);
    const response = await app.inject({
      method: 'POST',
      url: '/api/auth/login',
      headers: { origin: 'https://example.test' },
      payload: { password: syntheticPassword },
    });
    expect(String(response.headers['set-cookie']).includes('Secure')).toBe(
      true,
    );
  });
});
