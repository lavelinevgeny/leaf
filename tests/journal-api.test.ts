import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { randomUUID } from 'node:crypto';
import { buildApp, type LeafApp } from '../src/server/app.js';
import { openDatabase } from '../src/server/database.js';
import {
  createInputV2 as createInput,
  createInput as createLegacyInput,
  rawTables,
} from './helpers/journal-fixture.js';
import type { JournalMutationV2 as JournalMutation } from '../src/shared/journal-contracts-v2.js';
import { JournalRepository } from '../src/server/journal-repository.js';
const origin = 'http://127.0.0.1:3000';
let app: LeafApp;
let dir: string;
let projectId: string;
let taskId: string;
let cookie: string;
const tables = [
  'projects',
  'tasks',
  'undo_snapshots',
  'operations',
  'journal_entries',
  'journal_state',
  'journal_operations',
];
function headers() {
  return {
    origin,
    cookie,
    'x-leaf-contract-version': '2',
    'x-leaf-journal-contract-version': '2',
  };
}
function snapshot() {
  const db = openDatabase(join(dir, 'synthetic.sqlite'));
  try {
    return rawTables(db, tables);
  } finally {
    db.close();
  }
}
beforeEach(async () => {
  dir = mkdtempSync(join(tmpdir(), 'leaf-journal-api-synthetic-'));
  app = await buildApp({
    databasePath: join(dir, 'synthetic.sqlite'),
    publicOrigin: origin,
  });
  const password = ['Synthetic', 'journal', 'passphrase'].join('-');
  await app.auth.setup(password);
  const login = await app.inject({
    method: 'POST',
    url: '/api/auth/login',
    headers: { origin },
    payload: { password },
  });
  cookie = `leaf_session=${login.cookies[0]!.value}`;
  const p = app.repository.createProject('Synthetic journal API');
  projectId = p.id;
  const tree = app.repository.applyCommand(
    p.id,
    {
      contractVersion: 2,
      operationId: randomUUID(),
      expectedRevision: 0,
      command: { type: 'task.create', title: 'Synthetic', parentId: null },
    },
    'synthetic-planning-session',
  );
  taskId = tree.tasks[0]!.id;
});
afterEach(async () => {
  vi.restoreAllMocks();
  await app.close();
  rmSync(dir, { recursive: true, force: true });
});
it('serves six authenticated no-store strict routes and frozen status-specific acknowledgements', async () => {
  const url = `/api/projects/${projectId}/journal`;
  const input = createInput(taskId);
  const before = app.repository.getTree(
    projectId,
    'synthetic-planning-session',
  );
  const response = await app.inject({
    method: 'POST',
    url,
    headers: headers(),
    payload: input,
  });
  expect(response.statusCode).toBe(201);
  expect(response.headers['cache-control']).toBe('no-store');
  const ack = response.json<JournalMutation>();
  if (ack.kind !== 'saved') throw Error('Fixture');
  expect(Object.keys(ack).sort()).toEqual([
    'entry',
    'journalContractVersion',
    'journalRevision',
    'kind',
    'projectId',
  ]);
  expect(
    app.repository.getTree(projectId, 'synthetic-planning-session'),
  ).toEqual(before);
  for (const route of [
    url,
    `${url}/${ack.entry.id}`,
    `/api/projects/${projectId}/tasks/${taskId}/journal`,
  ]) {
    const read = await app.inject({ url: route, headers: headers() });
    expect(read.statusCode).toBe(200);
    expect(read.headers['cache-control']).toBe('no-store');
  }
  const update = {
    journalContractVersion: 2,
    operationId: randomUUID(),
    expectedJournalRevision: 1,
    workDate: '0001-01-01',
    content: { format: 'plain-text', text: 'Synthetic changed' },
  };
  expect(
    (
      await app.inject({
        method: 'PATCH',
        url: `${url}/${ack.entry.id}`,
        headers: headers(),
        payload: update,
      })
    ).statusCode,
  ).toBe(200);
  const remove = {
    journalContractVersion: 2,
    operationId: randomUUID(),
    expectedJournalRevision: 2,
  };
  const deleted = await app.inject({
    method: 'DELETE',
    url: `${url}/${ack.entry.id}`,
    headers: headers(),
    payload: remove,
  });
  expect(deleted.statusCode).toBe(200);
  expect(deleted.json()).toEqual({
    journalContractVersion: 2,
    kind: 'deleted',
    projectId,
    journalRevision: 3,
    deletedEntryId: ack.entry.id,
  });
  const retry = await app.inject({
    method: 'POST',
    url,
    headers: headers(),
    payload: input,
  });
  expect(retry.statusCode).toBe(201);
  expect(retry.json()).toEqual(ack);
  const stale = await app.inject({
    method: 'POST',
    url,
    headers: headers(),
    payload: createInput(taskId),
  });
  expect(stale.statusCode).toBe(409);
  expect(stale.json().code).toBe('JOURNAL_REVISION_CONFLICT');
});
it('rejects auth/origin/type/version/query/foreign/size errors without state or history changes', async () => {
  const url = `/api/projects/${projectId}/journal`;
  const input = createInput(taskId);
  const missing = randomUUID();
  const before = snapshot();
  for (const [method, route] of [
    ['GET', url],
    ['GET', `${url}/${missing}`],
    ['GET', `/api/projects/${projectId}/tasks/${taskId}/journal`],
    ['POST', url],
    ['PATCH', `${url}/${missing}`],
    ['DELETE', `${url}/${missing}`],
  ] as const) {
    const response = await app.inject({
      method,
      url: route,
      headers: { origin, 'x-leaf-contract-version': '2' },
      ...(method === 'GET' ? {} : { payload: input }),
    });
    expect(response.statusCode).toBe(401);
    expect(response.headers['cache-control']).toBe('no-store');
  }
  const cases = [
    {
      headers: { ...headers(), origin: 'http://foreign.example.test' },
      payload: input,
      status: 403,
    },
    {
      headers: { cookie, 'x-leaf-contract-version': '2' },
      payload: input,
      status: 403,
    },
    {
      headers: { ...headers(), 'content-type': 'text/plain' },
      payload: 'Synthetic',
      status: 415,
    },
    {
      headers: { ...headers(), 'x-leaf-contract-version': '1' },
      payload: input,
      status: 426,
    },
    {
      headers: { ...headers(), 'x-leaf-legacy-replay': '1' },
      payload: input,
      status: 400,
    },
    {
      headers: headers(),
      payload: { ...input, content: { format: 'plain-text', text: ' \n ' } },
      status: 400,
    },
    {
      headers: headers(),
      payload: { ...input, createdAt: '2026-10-10T00:00:00.000Z' },
      status: 400,
    },
    { headers: headers(), payload: { ...input, taskId: missing }, status: 404 },
    {
      headers: headers(),
      payload: {
        ...input,
        content: { format: 'plain-text', text: 'x'.repeat(70000) },
      },
      status: 413,
    },
  ];
  for (const c of cases) {
    const response = await app.inject({
      method: 'POST',
      url,
      headers: c.headers,
      payload: c.payload,
    });
    expect(response.statusCode).toBe(c.status);
    expect(response.headers['cache-control']).toBe('no-store');
  }
  for (const route of [
    `${url}?unknown=x`,
    `${url}?limit=1e1`,
    `${url}/${missing}?q=x`,
    `/api/projects/${projectId}/tasks/${taskId}/journal?from=2024-01-01`,
  ])
    expect(
      (await app.inject({ url: route, headers: headers() })).statusCode,
    ).toBe(400);
  expect(snapshot()).toEqual(before);
  const foreign = app.repository.createProject('Synthetic other');
  const foreignBefore = snapshot();
  for (const route of [
    `/api/projects/${foreign.id}/tasks/${taskId}/journal`,
    `/api/projects/${missing}/journal`,
  ])
    expect(
      (await app.inject({ url: route, headers: headers() })).statusCode,
    ).toBe(404);
  expect(snapshot()).toEqual(foreignBefore);
});
it('never logs synthetic journal content and returns safe500 on corrupt rows/replay', async () => {
  const stdout = vi
    .spyOn(process.stdout, 'write')
    .mockImplementation(() => true);
  const stderr = vi
    .spyOn(process.stderr, 'write')
    .mockImplementation(() => true);
  const log = vi.spyOn(console, 'log').mockImplementation(() => {});
  const error = vi.spyOn(console, 'error').mockImplementation(() => {});
  const marker = 'Synthetic-private-journal-sentinel';
  const url = `/api/projects/${projectId}/journal`;
  const input = createInput(taskId, 0, marker);
  await app.inject({ method: 'POST', url, headers: headers(), payload: input });
  await app.inject({
    url: `${url}?q=${marker}&from=2024-02-29`,
    headers: headers(),
  });
  const db = openDatabase(join(dir, 'synthetic.sqlite'));
  try {
    db.exec("UPDATE journal_operations SET responseSha256='corrupt'");
  } finally {
    db.close();
  }
  const before = snapshot();
  const response = await app.inject({
    method: 'POST',
    url,
    headers: headers(),
    payload: input,
  });
  expect(response.statusCode).toBe(500);
  expect(response.json()).toEqual({
    code: 'INTERNAL_ERROR',
    message: 'Не удалось выполнить запрос.',
  });
  expect(snapshot()).toEqual(before);
  const captured = JSON.stringify([
    stdout.mock.calls,
    stderr.mock.calls,
    log.mock.calls,
    error.mock.calls,
  ]);
  expect(captured).not.toContain(marker);
  expect(captured).not.toContain('2024-02-29');
});
it('keeps foreign entries scoped404 and reports corrupt lifecycle as safe500 without changing tables', async () => {
  const url = `/api/projects/${projectId}/journal`;
  const saved = await app.inject({
    method: 'POST',
    url,
    headers: headers(),
    payload: createInput(taskId),
  });
  const entryId = saved.json().entry.id;
  const other = app.repository.createProject('Synthetic foreign');
  const before = snapshot();
  for (const method of ['GET', 'PATCH', 'DELETE'] as const) {
    const payload =
      method === 'GET'
        ? undefined
        : method === 'PATCH'
          ? {
              journalContractVersion: 2,
              operationId: randomUUID(),
              expectedJournalRevision: 1,
              workDate: '2024-02-29',
              content: { format: 'plain-text', text: 'Synthetic' },
            }
          : {
              journalContractVersion: 2,
              operationId: randomUUID(),
              expectedJournalRevision: 1,
            };
    const response = await app.inject({
      method,
      url: `/api/projects/${other.id}/journal/${entryId}`,
      headers: headers(),
      ...(payload ? { payload } : {}),
    });
    expect(response.statusCode).toBe(404);
    expect(response.headers['cache-control']).toBe('no-store');
  }
  expect(snapshot()).toEqual(before);
  // Use authenticated planning session so its Undo is the exposed route's Undo.
  const token = cookie.slice('leaf_session='.length);
  const session = app.auth.session(token)!;
  const tree = app.repository.getTree(projectId, session);
  app.repository.applyCommand(
    projectId,
    {
      contractVersion: 2,
      operationId: randomUUID(),
      expectedRevision: tree.project.revision,
      command: { type: 'task.delete', taskId },
    },
    session,
  );
  const db = openDatabase(join(dir, 'synthetic.sqlite'));
  try {
    db.exec(
      'DELETE FROM undo_journal_manifest WHERE undoSequence=(SELECT MAX(sequence) FROM undo_snapshots)',
    );
    const names = [...tables, 'undo_journal_entries', 'undo_journal_manifest'];
    const corrupted = rawTables(db, names);
    const undo = await app.inject({
      method: 'POST',
      url: `/api/projects/${projectId}/commands`,
      headers: headers(),
      payload: {
        contractVersion: 2,
        operationId: randomUUID(),
        expectedRevision: tree.project.revision + 1,
        command: { type: 'undo' },
      },
    });
    expect(undo.statusCode).toBe(500);
    expect(undo.json()).toEqual({
      code: 'INTERNAL_ERROR',
      message: 'Не удалось выполнить запрос.',
    });
    expect(rawTables(db, names)).toEqual(corrupted);
  } finally {
    db.close();
  }
});
it('serves escaped-query pagination and exact NUL Unicode CRUD through authenticated routes', async () => {
  const url = `/api/projects/${projectId}/journal`;
  const q = '\u0001'.repeat(300);
  for (let n = 0; n < 2; n++) {
    const response = await app.inject({
      method: 'POST',
      url,
      headers: headers(),
      payload: createInput(taskId, n, q),
    });
    expect(response.statusCode).toBe(201);
  }
  const first = await app.inject({
    url: `${url}?q=${encodeURIComponent(q)}&limit=1`,
    headers: headers(),
  });
  expect(first.statusCode).toBe(200);
  expect(first.json().nextCursor.length).toBeGreaterThan(2048);
  expect(first.json().nextCursor.length).toBeLessThanOrEqual(4096);
  const second = await app.inject({
    url: `${url}?q=${encodeURIComponent(q)}&limit=1&cursor=${first.json().nextCursor}`,
    headers: headers(),
  });
  expect(second.statusCode).toBe(200);
  expect(second.json().entries).toHaveLength(1);
  expect(second.json().nextCursor).toBeNull();
  const body = '\0Synthetic valid pair😀\0';
  const input = createInput(taskId, 2, body);
  const created = await app.inject({
    method: 'POST',
    url,
    headers: headers(),
    payload: input,
  });
  expect(created.statusCode).toBe(201);
  const id = created.json().entry.id;
  expect(created.json().entry.body).toBe(body);
  const read = await app.inject({ url: `${url}/${id}`, headers: headers() });
  expect(read.statusCode).toBe(200);
  expect(read.json().entry.body).toBe(body);
  const update = {
    journalContractVersion: 2,
    operationId: randomUUID(),
    expectedJournalRevision: 3,
    content: { format: 'plain-text', text: '\0Updated😀\n' },
    workDate: '2024-02-28',
  };
  const patched = await app.inject({
    method: 'PATCH',
    url: `${url}/${id}`,
    headers: headers(),
    payload: update,
  });
  expect(patched.statusCode).toBe(200);
  expect(patched.json().entry.body).toBe(update.content.text);
  expect(
    (await app.inject({ url: `${url}/${id}`, headers: headers() })).json().entry
      .body,
  ).toBe(update.content.text);
  expect(
    (
      await app.inject({
        method: 'POST',
        url,
        headers: headers(),
        payload: input,
      })
    ).json(),
  ).toEqual(created.json());
  expect(
    (
      await app.inject({
        method: 'PATCH',
        url: `${url}/${id}`,
        headers: headers(),
        payload: update,
      })
    ).json(),
  ).toEqual(patched.json());
  const removed = await app.inject({
    method: 'DELETE',
    url: `${url}/${id}`,
    headers: headers(),
    payload: {
      journalContractVersion: 2,
      operationId: randomUUID(),
      expectedJournalRevision: 4,
    },
  });
  expect(removed.statusCode).toBe(200);
  const retained = await app.inject({
    method: 'POST',
    url,
    headers: headers(),
    payload: createInput(taskId, 5, body),
  });
  expect(retained.statusCode).toBe(201);
  const retainedId = retained.json().entry.id;
  const revision = app.repository.getTree(
    projectId,
    'synthetic-planning-session',
  ).project.revision;
  const deletedBranch = await app.inject({
    method: 'POST',
    url: `/api/projects/${projectId}/commands`,
    headers: headers(),
    payload: {
      contractVersion: 2,
      operationId: randomUUID(),
      expectedRevision: revision,
      command: { type: 'task.delete', taskId },
    },
  });
  expect(deletedBranch.statusCode).toBe(200);
  const undone = await app.inject({
    method: 'POST',
    url: `/api/projects/${projectId}/commands`,
    headers: headers(),
    payload: {
      contractVersion: 2,
      operationId: randomUUID(),
      expectedRevision: revision + 1,
      command: { type: 'undo' },
    },
  });
  expect(undone.statusCode).toBe(200);
  const restored = await app.inject({
    url: `${url}/${retainedId}`,
    headers: headers(),
  });
  expect(restored.statusCode).toBe(200);
  expect(restored.json().entry).toEqual(retained.json().entry);
});
it('rejects malformed high/low surrogates with safe400 and no journal or planning writes', async () => {
  const url = `/api/projects/${projectId}/journal`;
  const created = await app.inject({
    method: 'POST',
    url,
    headers: headers(),
    payload: createInput(taskId, 0, 'Synthetic valid😀'),
  });
  const id = created.json().entry.id;
  const before = snapshot();
  for (const malformed of [
    '\ud800',
    '\udfff',
    'Synthetic\ud800text',
    '\udc00\ud800',
  ]) {
    for (const [method, target, payload] of [
      ['POST', url, createInput(taskId, 1, malformed)],
      [
        'PATCH',
        `${url}/${id}`,
        {
          journalContractVersion: 2,
          operationId: randomUUID(),
          expectedJournalRevision: 1,
          workDate: '2024-02-29',
          content: { format: 'plain-text', text: malformed },
        },
      ],
    ] as const) {
      const response = await app.inject({
        method,
        url: target,
        headers: headers(),
        payload,
      });
      expect(response.statusCode).toBe(400);
      expect(response.json()).toEqual({
        code: 'INVALID_REQUEST',
        message: 'Проверьте поля запроса.',
      });
    }
  }
  expect(snapshot()).toEqual(before);
  expect(
    (await app.inject({ url: `${url}/${id}`, headers: headers() })).json().entry
      .body,
  ).toBe('Synthetic valid😀');
});

it('rejects old live reads/new effects, but returns exact validated frozen v1 retries after deletion', async () => {
  const url = `/api/projects/${projectId}/journal`;
  const oldHeaders = { origin, cookie, 'x-leaf-contract-version': '2' };
  const input = createLegacyInput(taskId);
  const session = app.auth.session(cookie.slice('leaf_session='.length))!;
  const db = openDatabase(join(dir, 'synthetic.sqlite'));
  let ack;
  try {
    const legacy = new JournalRepository(db);
    ack = legacy.create(projectId, input, session);
    if (ack.kind !== 'saved') throw Error('fixture');
    legacy.delete(
      projectId,
      ack.entry.id,
      {
        journalContractVersion: 1,
        operationId: randomUUID(),
        expectedJournalRevision: 1,
      },
      session,
    );
  } finally {
    db.close();
  }
  const before = snapshot();
  for (const route of [
    url,
    `${url}/${randomUUID()}`,
    `/api/projects/${projectId}/tasks/${taskId}/journal`,
  ])
    expect(
      (await app.inject({ url: route, headers: oldHeaders })).statusCode,
    ).toBe(426);
  expect(
    (
      await app.inject({
        method: 'POST',
        url,
        headers: oldHeaders,
        payload: createLegacyInput(taskId, 2),
      })
    ).statusCode,
  ).toBe(426);
  const retried = await app.inject({
    method: 'POST',
    url,
    headers: oldHeaders,
    payload: input,
  });
  expect(retried.statusCode).toBe(201);
  expect(retried.json()).toEqual(ack);
  expect(
    (
      await app.inject({
        method: 'POST',
        url,
        headers: oldHeaders,
        payload: { ...input, body: 'changed' },
      })
    ).statusCode,
  ).toBe(409);
  expect(
    (
      await app.inject({
        method: 'POST',
        url,
        headers: headers(),
        payload: input,
      })
    ).statusCode,
  ).toBe(400);
  expect(snapshot()).toEqual(before);
  const damaged = openDatabase(join(dir, 'synthetic.sqlite'));
  try {
    damaged
      .prepare(
        'UPDATE journal_operations SET responseSha256=? WHERE operationId=?',
      )
      .run('bad', input.operationId);
  } finally {
    damaged.close();
  }
  expect(
    (
      await app.inject({
        method: 'POST',
        url,
        headers: oldHeaders,
        payload: input,
      })
    ).statusCode,
  ).toBe(500);
});
it('publishes media-only v2 over HTTP and fails closed on corrupt stored content and frozen metadata', async () => {
  const session = app.auth.session(cookie.slice('leaf_session='.length))!;
  const media = await app.journalMediaRepository.stage({
    projectId,
    taskId,
    sessionId: session,
    uploadId: randomUUID(),
    kind: 'file',
    fileName: 'report.txt',
    bytes: Buffer.from('synthetic bytes'),
  });
  const url = `/api/projects/${projectId}/journal`;
  const input = {
    journalContractVersion: 2,
    operationId: randomUUID(),
    expectedJournalRevision: 0,
    taskId,
    workDate: '2024-02-29',
    content: {
      format: 'rich-text',
      documentVersion: 1,
      doc: {
        type: 'doc',
        content: [{ type: 'journalFile', attrs: { mediaId: media.id } }],
      },
    },
  };
  const saved = await app.inject({
    method: 'POST',
    url,
    headers: headers(),
    payload: input,
  });
  expect(saved.statusCode).toBe(201);
  expect(saved.json().entry.body).toBe('[Файл: report.txt]');
  const id = saved.json().entry.id;
  const db = openDatabase(join(dir, 'synthetic.sqlite'));
  try {
    db.prepare('UPDATE journal_entries SET contentJson=? WHERE id=?').run(
      '{"format":"unsupported"}',
      id,
    );
    expect(
      (await app.inject({ url: `${url}/${id}`, headers: headers() }))
        .statusCode,
    ).toBe(500);
    const { createHash } = await import('node:crypto');
    const corrupted = saved.json();
    corrupted.entry.media[0].byteLength = -1;
    const response = JSON.stringify(corrupted);
    db.prepare(
      'UPDATE journal_operations SET response=?,responseSha256=? WHERE operationId=?',
    ).run(
      response,
      createHash('sha256').update(response).digest('hex'),
      input.operationId,
    );
    const before = rawTables(db, [
      ...tables,
      'journal_media',
      'journal_entry_media',
    ]);
    expect(
      (
        await app.inject({
          method: 'POST',
          url,
          headers: headers(),
          payload: input,
        })
      ).statusCode,
    ).toBe(500);
    expect(
      rawTables(db, [...tables, 'journal_media', 'journal_entry_media']),
    ).toEqual(before);
  } finally {
    db.close();
  }
});
