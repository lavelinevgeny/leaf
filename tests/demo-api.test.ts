import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { buildApp, type LeafApp } from '../src/server/app.js';
import { openDatabase } from '../src/server/database.js';
import { Auth, SESSION_SECONDS } from '../src/server/auth.js';
import { DEMO_BUSY, DEMO_EXHAUSTED } from '../src/server/demo-limits.js';
const origin = 'https://demo.example.test';
let app: LeafApp;
let directory: string;
let now: number;
beforeEach(async () => {
  directory = mkdtempSync(join(tmpdir(), 'leaf-demo-api-'));
  now = Date.parse('2026-10-09T00:00:00Z');
  app = await buildApp({
    databasePath: join(directory, 'synthetic.sqlite'),
    publicOrigin: origin,
    demoMode: true,
    now: () => now,
  });
});
afterEach(async () => {
  vi.restoreAllMocks();
  await app?.close();
  rmSync(directory, { recursive: true, force: true });
});
async function enter(token?: string) {
  return app.inject({
    method: 'POST',
    url: '/api/auth/demo',
    headers: { origin, ...(token ? { cookie: `leaf_session=${token}` } : {}) },
    payload: {},
  });
}
function headers(token: string) {
  return {
    origin,
    cookie: `leaf_session=${token}`,
    'x-leaf-contract-version': '2',
  };
}
function count(table: string) {
  const db = openDatabase(join(directory, 'synthetic.sqlite'));
  try {
    return (
      db.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get() as { n: number }
    ).n;
  } finally {
    db.close();
  }
}
it('preserves normal fail-closed route and default Auth guard', async () => {
  await app.close();
  app = await buildApp({
    databasePath: join(directory, 'normal.sqlite'),
    publicOrigin: origin,
  });
  expect((await app.inject('/api/auth/session')).json()).toEqual({
    authenticated: false,
    setupRequired: true,
  });
  expect((await app.inject('/api/projects')).statusCode).toBe(401);
  expect((await enter()).statusCode).toBe(404);
  const db = openDatabase(join(directory, 'other.sqlite'));
  try {
    expect(() => new Auth(db).enterDemo()).toThrow();
  } finally {
    db.close();
  }
});
it('guards entry Origin, JSON, strict body and disabled password route', async () => {
  expect((await app.inject('/api/auth/session')).json()).toEqual({
    authenticated: false,
    setupRequired: false,
    demoMode: true,
  });
  expect((await app.inject('/api/projects')).statusCode).toBe(401);
  for (const supplied of [undefined, 'https://foreign.example.test'])
    expect(
      (
        await app.inject({
          method: 'POST',
          url: '/api/auth/demo',
          headers: {
            ...(supplied ? { origin: supplied } : {}),
            'x-forwarded-host': 'demo.example.test',
            'x-forwarded-proto': 'https',
          },
          payload: {},
        })
      ).statusCode,
    ).toBe(403);
  expect(
    (
      await app.inject({
        method: 'POST',
        url: '/api/auth/demo',
        headers: { origin, 'content-type': 'text/plain' },
        payload: '{}',
      })
    ).statusCode,
  ).toBe(415);
  expect(
    (
      await app.inject({
        method: 'POST',
        url: '/api/auth/demo',
        headers: { origin },
        payload: { extra: true },
      })
    ).statusCode,
  ).toBe(400);
  const spy = vi.spyOn(app.auth, 'login');
  const login = await app.inject({
    method: 'POST',
    url: '/api/auth/login',
    headers: { origin },
    payload: { password: 'Synthetic-unused-password' },
  });
  expect(login.statusCode).toBe(403);
  expect(login.json().code).toBe('DEMO_PASSWORD_DISABLED');
  expect(spy).not.toHaveBeenCalled();
  expect(count('sessions')).toBe(0);
});
it('issues hashed opaque HTTPS sessions, reuses cookie, shares seed and isolates logout/undo', async () => {
  const first = await enter();
  expect(first.json()).toEqual({
    authenticated: true,
    setupRequired: false,
    demoMode: true,
  });
  expect(first.headers['cache-control']).toBe('no-store');
  for (const attr of ['HttpOnly', 'SameSite=Strict', 'Secure'])
    expect(String(first.headers['set-cookie']).includes(attr)).toBe(true);
  const token = first.cookies[0]!.value;
  expect(token.length).toBe(43);
  const db = openDatabase(join(directory, 'synthetic.sqlite'));
  try {
    const row = db.prepare('SELECT id FROM sessions').get() as { id: string };
    expect(row.id === createHash('sha256').update(token).digest('hex')).toBe(
      true,
    );
    expect(row.id === token).toBe(false);
  } finally {
    db.close();
  }

  expect((await enter(token)).cookies[0]!.value === token).toBe(true);
  expect(count('sessions')).toBe(1);
  const second = (await enter()).cookies[0]!.value;
  expect(second === token).toBe(false);
  const project = app.repository.listProjects()[0]!;
  const before = app.repository.getTree(project.id, app.auth.session(token)!);
  const mutate = await app.inject({
    method: 'POST',
    url: `/api/projects/${project.id}/commands`,
    headers: headers(token),
    payload: {
      contractVersion: 2,
      operationId: randomUUID(),
      expectedRevision: before.project.revision,
      command: {
        type: 'task.create',
        title: 'Synthetic visitor task',
        parentId: null,
      },
    },
  });
  expect(mutate.statusCode).toBe(200);
  expect(
    app.repository.getTree(project.id, app.auth.session(token)!).canUndo,
  ).toBe(true);
  expect(
    app.repository.getTree(project.id, app.auth.session(second)!).canUndo,
  ).toBe(false);
  const out = await app.inject({
    method: 'POST',
    url: '/api/auth/logout',
    headers: headers(token),
    payload: {},
  });
  expect(out.json()).toEqual({
    authenticated: false,
    setupRequired: false,
    demoMode: true,
  });
  expect(app.auth.session(token)).toBeUndefined();
  expect(app.auth.session(second)).toBeDefined();
  expect(count('undo_snapshots')).toBe(0);
  now += SESSION_SECONDS * 1000;
  expect(app.auth.session(second)).toBeUndefined();
  expect((await enter()).statusCode).toBe(200);
  expect(count('sessions')).toBe(1);
});
it('bounds new entry process-wide, without charging cookie re-entry, and lazily resets windows', async () => {
  let token = '';
  for (let i = 0; i < 60; i++) {
    const response = await enter();
    expect(response.statusCode).toBe(200);
    token = response.cookies[0]!.value;
  }
  expect((await enter(token)).statusCode).toBe(200);
  const denied = await enter();
  expect(denied.statusCode).toBe(429);
  expect(denied.json()).toEqual({ code: 'DEMO_LIMIT', message: DEMO_BUSY });
  expect(count('sessions')).toBe(60);
  now += 60000;
  for (let i = 0; i < 40; i++) expect((await enter()).statusCode).toBe(200);
  expect((await enter()).statusCode).toBe(429);
  expect(count('sessions')).toBe(100);
  expect((await enter(token)).statusCode).toBe(200);
  now += SESSION_SECONDS * 1000;
  expect((await enter()).statusCode).toBe(200);
  expect(count('sessions')).toBe(1);
});
it('counts failed/cached mutations, rejects before Repository and persistent row growth, preserves reads/logout', async () => {
  const token = (await enter()).cookies[0]!.value;
  const project = app.repository.listProjects()[0]!;
  const payload = {
    contractVersion: 2,
    operationId: randomUUID(),
    expectedRevision: project.revision,
    command: {
      type: 'task.create',
      title: 'Synthetic mutation',
      parentId: null,
    },
  };
  for (let i = 0; i < 120; i++)
    expect(
      (
        await app.inject({
          method: 'POST',
          url: `/api/projects/${project.id}/commands`,
          headers: headers(token),
          payload,
        })
      ).statusCode,
    ).toBe(200);
  const spy = vi.spyOn(app.repository, 'applyCommand');
  const before = app.repository.getTree(project.id, app.auth.session(token)!);
  const operations = count('operations');
  const denied = await app.inject({
    method: 'POST',
    url: `/api/projects/${project.id}/commands`,
    headers: { ...headers(token), 'x-forwarded-for': '192.0.2.10' },
    payload,
  });
  expect(denied.statusCode).toBe(429);
  expect(spy).not.toHaveBeenCalled();
  expect(count('operations')).toBe(operations);
  expect(app.repository.getTree(project.id, app.auth.session(token)!)).toEqual(
    before,
  );
  now += 60000;
  payload.operationId = randomUUID();
  for (let i = 0; i < 80; i++)
    expect(
      (
        await app.inject({
          method: 'POST',
          url: `/api/projects/${project.id}/commands`,
          headers: headers(token),
          payload,
        })
      ).statusCode,
    ).toBe(409);
  const create = await app.inject({
    method: 'POST',
    url: '/api/projects',
    headers: headers(token),
    payload: { title: 'Rejected project' },
  });
  expect(create.statusCode).toBe(429);
  expect(create.json().message).toBe(DEMO_EXHAUSTED);
  expect(app.repository.listProjects()).toHaveLength(1);
  for (const url of [
    '/healthz',
    '/readyz',
    '/api/auth/session',
    '/api/projects',
    `/api/projects/${project.id}/tree`,
  ])
    expect(
      (await app.inject({ url, headers: headers(token) })).statusCode,
    ).toBe(200);
  expect(
    (
      await app.inject({
        method: 'POST',
        url: '/api/auth/logout',
        headers: headers(token),
        payload: {},
      })
    ).statusCode,
  ).toBe(200);
});
it('checks basic contracts before admission and charges every project mutation route', async () => {
  const token = (await enter()).cookies[0]!.value;
  for (let i = 0; i < 125; i++)
    expect(
      (
        await app.inject({
          method: 'POST',
          url: '/api/projects',
          headers: headers(token),
          payload: { extra: true },
        })
      ).statusCode,
    ).toBe(400);
  const created = await app.inject({
    method: 'POST',
    url: '/api/projects',
    headers: headers(token),
    payload: { title: 'Synthetic second project' },
  });
  expect(created.statusCode).toBe(201);
  const project = created.json();
  const rename = await app.inject({
    method: 'PATCH',
    url: `/api/projects/${project.id}`,
    headers: headers(token),
    payload: {
      contractVersion: 2,
      operationId: randomUUID(),
      expectedRevision: 0,
      title: 'Synthetic renamed',
    },
  });
  expect(rename.statusCode).toBe(200);
  const undo = await app.inject({
    method: 'POST',
    url: `/api/projects/${project.id}/commands`,
    headers: headers(token),
    payload: {
      contractVersion: 2,
      operationId: randomUUID(),
      expectedRevision: 1,
      command: { type: 'undo' },
    },
  });
  expect(undo.statusCode).toBe(200);
});

it('rejects JSON byte exhaustion before persistent writes, across real HTTP requests', async () => {
  const token = (await enter()).cookies[0]!.value;
  const project = app.repository.listProjects()[0]!;
  const task = app.repository
    .getTree(project.id, app.auth.session(token)!)
    .tasks.find((t) => t.title === 'План работ')!;
  const spy = vi.spyOn(app.repository, 'applyCommand');
  let admitted = 0;
  for (let i = 0; i < 20; i++) {
    const payload = {
      contractVersion: 2,
      operationId: randomUUID(),
      expectedRevision: project.revision + i,
      command: {
        type: 'task.update',
        taskId: task.id,
        changes: { description: 'я'.repeat(10000) },
      },
    };
    const baseline = app.repository.getTree(
      project.id,
      app.auth.session(token)!,
    );
    const rows = count('operations');
    spy.mockClear();
    const response = await app.inject({
      method: 'POST',
      url: `/api/projects/${project.id}/commands`,
      headers: headers(token),
      payload,
    });
    if (response.statusCode === 429) {
      expect(response.json().message).toBe(DEMO_EXHAUSTED);
      expect(spy).not.toHaveBeenCalled();
      expect(count('operations')).toBe(rows);
      expect(
        app.repository.getTree(project.id, app.auth.session(token)!),
      ).toEqual(baseline);
      break;
    }
    expect(response.statusCode).toBe(200);
    admitted++;
  }
  expect(admitted).toBe(12);
});
it('does not leak synthetic seed/undo across a fresh runtime restart', async () => {
  const cookie = (await enter()).cookies[0]!.value;
  const id = app.repository.listProjects()[0]!.id;
  await app.close();
  app = await buildApp({
    databasePath: join(directory, 'restart.sqlite'),
    publicOrigin: origin,
    demoMode: true,
    now: () => now,
  });
  expect(app.repository.listProjects()[0]!.id === id).toBe(false);
  expect(app.auth.session(cookie)).toBeUndefined();
  expect(
    (await app.inject({ url: '/api/projects', headers: headers(cookie) }))
      .statusCode,
  ).toBe(401);
  expect((await enter(cookie)).statusCode).toBe(200);
});

it('keeps ordinary password instances free of demo mutation budgets', async () => {
  await app.close();
  app = await buildApp({
    databasePath: join(directory, 'normal-limit.sqlite'),
    publicOrigin: origin,
    now: () => now,
  });
  await app.auth.setup('Synthetic-normal-mode-passphrase');
  const token = await app.auth.login(
    'Synthetic-normal-mode-passphrase',
    'synthetic',
  );
  for (let i = 0; i < 201; i++)
    expect(
      (
        await app.inject({
          method: 'POST',
          url: '/api/projects',
          headers: headers(token),
          payload: { title: 'Synthetic normal project' },
        })
      ).statusCode,
    ).toBe(201);
  expect(app.repository.listProjects()).toHaveLength(201);
});
it.each(['create', 'rename', 'command', 'undo', 'legacy'])(
  'charges the shared boundary for %s mutations',
  async (route) => {
    const token = (await enter()).cookies[0]!.value;
    const project = app.repository.listProjects()[0]!;
    const payload = {
      contractVersion: 2,
      operationId: randomUUID(),
      expectedRevision: project.revision,
      command: {
        type: 'task.create',
        title: 'Synthetic shared-budget task',
        parentId: null,
      },
    };
    for (let i = 0; i < 119; i++)
      expect(
        (
          await app.inject({
            method: 'POST',
            url: `/api/projects/${project.id}/commands`,
            headers: headers(token),
            payload,
          })
        ).statusCode,
      ).toBe(200);
    const revision = project.revision + 1;
    const request =
      route === 'create'
        ? {
            method: 'POST' as const,
            url: '/api/projects',
            headers: headers(token),
            payload: { title: 'Synthetic boundary project' },
          }
        : route === 'rename'
          ? {
              method: 'PATCH' as const,
              url: `/api/projects/${project.id}`,
              headers: headers(token),
              payload: {
                contractVersion: 2,
                operationId: randomUUID(),
                expectedRevision: revision,
                title: 'Synthetic boundary rename',
              },
            }
          : route === 'undo'
            ? {
                method: 'POST' as const,
                url: `/api/projects/${project.id}/commands`,
                headers: headers(token),
                payload: {
                  contractVersion: 2,
                  operationId: randomUUID(),
                  expectedRevision: revision,
                  command: { type: 'undo' },
                },
              }
            : route === 'legacy'
              ? {
                  method: 'POST' as const,
                  url: `/api/projects/${project.id}/commands`,
                  headers: { ...headers(token), 'x-leaf-legacy-replay': '1' },
                  payload: {},
                }
              : {
                  method: 'POST' as const,
                  url: `/api/projects/${project.id}/commands`,
                  headers: headers(token),
                  payload,
                };
    const atBoundary = await app.inject(request);
    expect(atBoundary.statusCode === 429).toBe(false);
    const spy = vi.spyOn(app.repository, 'createProject');
    const next = await app.inject({
      method: 'POST',
      url: '/api/projects',
      headers: headers(token),
      payload: { title: 'Rejected boundary project' },
    });
    expect(next.statusCode).toBe(429);
    expect(next.json().message).toBe(DEMO_BUSY);
    expect(spy).not.toHaveBeenCalled();
  },
);
