import { afterEach, beforeEach, expect, it } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { randomUUID } from 'node:crypto';
import { buildApp, type LeafApp } from '../src/server/app.js';
const origin = 'http://127.0.0.1:3000';
let app: LeafApp;
let dir: string;
let cookie: string;
let url: string;
function form(
  uploadId = randomUUID(),
  kind = 'file',
  file = Buffer.from('synthetic'),
  fileName = 'example.txt',
) {
  const boundary = 'synthetic-boundary';
  return {
    type: `multipart/form-data; boundary=${boundary}`,
    bytes: Buffer.concat([
      Buffer.from(
        `--${boundary}\r\nContent-Disposition: form-data; name="uploadId"\r\n\r\n${uploadId}\r\n--${boundary}\r\nContent-Disposition: form-data; name="kind"\r\n\r\n${kind}\r\n--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="${fileName}"\r\nContent-Type: text/html\r\n\r\n`,
      ),
      file,
      Buffer.from(`\r\n--${boundary}--\r\n`),
    ]),
  };
}
beforeEach(async () => {
  dir = mkdtempSync(join(tmpdir(), 'leaf-media-api-synthetic-'));
  app = await buildApp({
    databasePath: join(dir, 'synthetic.sqlite'),
    publicOrigin: origin,
  });
  const password = ['Synthetic', 'media', 'passphrase'].join('-');
  await app.auth.setup(password);
  const login = await app.inject({
    method: 'POST',
    url: '/api/auth/login',
    headers: { origin },
    payload: { password },
  });
  cookie = `leaf_session=${login.cookies[0]!.value}`;
  const p = app.repository.createProject('Synthetic media');
  const tree = app.repository.applyCommand(
    p.id,
    {
      contractVersion: 2,
      operationId: randomUUID(),
      expectedRevision: 0,
      command: { type: 'task.create', title: 'Synthetic', parentId: null },
    },
    'synthetic-session',
  );
  url = `/api/projects/${p.id}/tasks/${tree.tasks[0]!.id}/journal-media`;
});
afterEach(async () => {
  await app.close();
  rmSync(dir, { recursive: true, force: true });
});
it('serves private cookie-auth binary GET without contract header and forces generic files to attachment', async () => {
  const f = form();
  const headers = {
    origin,
    cookie,
    'x-leaf-contract-version': '2',
    'content-type': f.type,
  };
  const res = await app.inject({
    method: 'POST',
    url,
    headers,
    payload: f.bytes,
  });
  expect(res.statusCode).toBe(201);
  const a = res.json();
  expect(a).toMatchObject({
    mediaContractVersion: 1,
    media: {
      fileName: 'example.txt',
      kind: 'file',
      mediaType: 'application/octet-stream',
    },
  });
  expect(
    (
      await app.inject({ method: 'POST', url, headers, payload: f.bytes })
    ).json(),
  ).toEqual(a);
  const get = await app.inject({
    url: `${url}/${a.media.id}`,
    headers: { cookie },
  });
  expect(get.statusCode).toBe(200);
  expect(get.rawPayload).toEqual(Buffer.from('synthetic'));
  expect(get.headers).toMatchObject({
    'cache-control': 'no-store',
    'content-type': 'application/octet-stream',
    'x-content-type-options': 'nosniff',
    'referrer-policy': 'no-referrer',
    'content-length': '9',
  });
  expect(get.headers['content-disposition']).toMatch(/^attachment;/);
  expect((await app.inject({ url: `${url}/${a.media.id}` })).statusCode).toBe(
    401,
  );
  expect(
    (await app.inject({ url: `${url}/${randomUUID()}`, headers: { cookie } }))
      .statusCode,
  ).toBe(404);
});
it('rejects auth/origin/contract and other JSON routes before malformed multipart parsing', async () => {
  const f = form();
  for (const [headers, status] of [
    [{ origin }, 401],
    [{ origin: 'http://invalid.example', cookie }, 403],
    [{ origin, cookie }, 426],
  ] as const) {
    const r = await app.inject({
      method: 'POST',
      url,
      headers: { ...headers, 'content-type': f.type },
      payload: Buffer.from('malformed'),
    });
    expect(r.statusCode).toBe(status);
  }
  expect(
    (
      await app.inject({
        method: 'POST',
        url: '/api/projects',
        headers: { origin, cookie, 'content-type': f.type },
        payload: f.bytes,
      })
    ).statusCode,
  ).toBe(415);
  const r = await app.inject({
    url: `${url}/${randomUUID()}/unknown`,
    headers: { cookie },
  });
  expect(r.statusCode).toBe(404);
});
import { request as httpRequest } from 'node:http';
import { Readable } from 'node:stream';
import { once } from 'node:events';
import sharp from 'sharp';
import { JOURNAL_MEDIA_LIMITS as L } from '../src/shared/journal-media-contracts.js';
function uploadHeaders(type: string) {
  return {
    origin,
    cookie,
    'x-leaf-contract-version': '2',
    'content-type': type,
  };
}
function rawForm(parts: string[]) {
  return {
    type: 'multipart/form-data; boundary=synthetic-boundary',
    bytes: Buffer.from(
      parts.map((p) => `--synthetic-boundary\r\n${p}\r\n`).join('') +
        '--synthetic-boundary--\r\n',
    ),
  };
}
const field = (name: string, value: string) =>
  `Content-Disposition: form-data; name="${name}"\r\n\r\n${value}`;
const filePart = (headers = '') =>
  `Content-Disposition: form-data; name="file"; filename="synthetic.txt"\r\n${headers}\r\nsynthetic`;
it('accepts arbitrary part order, rejects duplicate/unknown fields, duplicate files and excessive fields/headers/names', async () => {
  const id = randomUUID();
  const good = [filePart(), field('kind', 'file'), field('uploadId', id)];
  const valid = rawForm(good);
  expect(
    (
      await app.inject({
        method: 'POST',
        url,
        headers: uploadHeaders(valid.type),
        payload: valid.bytes,
      })
    ).statusCode,
  ).toBe(201);
  const invalids = [
    [field('kind', 'file'), field('kind', 'file'), filePart()],
    [field('uploadId', randomUUID()), field('unknown', 'file'), filePart()],
    [...good, field('extra', 'x')],
    [filePart(), filePart(), field('kind', 'file')],
    [
      field('kind', 'x'.repeat(65)),
      field('uploadId', randomUUID()),
      filePart(),
    ],
    [
      field('x'.repeat(33), 'file'),
      field('uploadId', randomUUID()),
      filePart(),
    ],
    [
      field('kind', 'file'),
      field('uploadId', randomUUID()),
      filePart(
        Array.from({ length: 33 }, (_, i) => `X-Synthetic-${i}: x\r\n`).join(
          '',
        ),
      ),
    ],
  ];
  for (const parts of invalids) {
    const f = rawForm(parts);
    const r = await app.inject({
      method: 'POST',
      url,
      headers: uploadHeaders(f.type),
      payload: f.bytes,
    });
    expect([400, 413]).toContain(r.statusCode);
  }
  const after = form();
  expect(
    (
      await app.inject({
        method: 'POST',
        url,
        headers: uploadHeaders(after.type),
        payload: after.bytes,
      })
    ).statusCode,
  ).toBe(201);
});
it('normalizes image bytes and supplies inline/download headers with safe Unicode filenames', async () => {
  const bytes = await sharp({
    create: { width: 3, height: 2, channels: 3, background: '#aabbcc' },
  })
    .png()
    .toBuffer();
  const f = form(randomUUID(), 'image', bytes, 'Снимок%22.png');
  const res = await app.inject({
    method: 'POST',
    url,
    headers: uploadHeaders(f.type),
    payload: f.bytes,
  });
  expect(res.statusCode).toBe(201);
  const id = res.json().media.id;
  for (const suffix of ['', '/download']) {
    const r = await app.inject({
      url: `${url}/${id}${suffix}`,
      headers: { cookie },
    });
    expect(r.statusCode).toBe(200);
    expect(r.headers['content-type']).toBe('image/webp');
    expect(r.headers['content-disposition']).toMatch(
      suffix ? /^attachment;/ : /^inline;/,
    );
    expect(r.headers['content-disposition']).toContain(
      "filename*=UTF-8''%D0%A1%D0%BD%D0%B8%D0%BC%D0%BE%D0%BA%2522.webp",
    );
    expect(r.headers['content-security-policy']).toContain(
      "img-src 'self' blob:",
    );
    expect(r.headers['content-security-policy']).not.toContain('data:');
    expect((await sharp(r.rawPayload).metadata()).format).toBe('webp');
  }
});
it('bounds aggregate chunked bytes including preamble/fields and leaves no partial upload', async () => {
  const f = form();
  async function* chunks() {
    yield Buffer.alloc(L.requestBytes, 32);
    yield f.bytes;
  }
  const r = await app.inject({
    method: 'POST',
    url,
    headers: uploadHeaders(f.type),
    payload: Readable.from(chunks()),
  });
  expect(r.statusCode).toBe(413);
  const ok = form();
  expect(
    (
      await app.inject({
        method: 'POST',
        url,
        headers: uploadHeaders(ok.type),
        payload: ok.bytes,
      })
    ).statusCode,
  ).toBe(201);
});
it('rejects auth/origin/contract on real sockets before sending any body; admission rejects third upload before body', async () => {
  const address = await app.listen({ port: 0, host: '127.0.0.1' });
  async function early(headers: Record<string, string>) {
    return await new Promise<number>((resolve, reject) => {
      const req = httpRequest(
        address + url,
        {
          method: 'POST',
          headers: {
            'content-type': form().type,
            'transfer-encoding': 'chunked',
            ...headers,
          },
        },
        (res) => {
          res.resume();
          resolve(res.statusCode!);
          req.destroy();
        },
      );
      req.on('error', reject);
      req.flushHeaders();
    });
  }
  expect(await early({ origin })).toBe(401);
  expect(await early({ origin: 'http://invalid.example', cookie })).toBe(403);
  expect(await early({ origin, cookie })).toBe(426);
  const held: ReturnType<typeof httpRequest>[] = [];
  try {
    // A tiny partial first part ensures two handlers have started reading.
    for (let i = 0; i < 2; i++) {
      const received = once(app.server, 'request');
      const req = httpRequest(address + url, {
        method: 'POST',
        headers: {
          ...uploadHeaders(form().type),
          'transfer-encoding': 'chunked',
        },
      });
      req.on('error', () => {});
      req.write('--synthetic-boundary\r\n');
      held.push(req);
      await received;
      await new Promise<void>((resolve) => setImmediate(resolve));
    }
    // A health check orders this behind both accepted requests on the event loop.
    await app.inject({ url: '/healthz' });
    expect(await early(uploadHeaders(form().type))).toBe(429);
  } finally {
    for (const req of held) req.destroy();
  }
});
it('limits a session to60 attempts per minute while retaining successful retry identity', async () => {
  const f = form();
  const headers = uploadHeaders(f.type);
  for (let i = 0; i < L.attemptsPerMinute; i++)
    expect(
      (await app.inject({ method: 'POST', url, headers, payload: f.bytes }))
        .statusCode,
    ).toBe(201);
  const denied = await app.inject({
    method: 'POST',
    url,
    headers,
    payload: f.bytes,
  });
  expect(denied.statusCode).toBe(429);
});
it('disables demo upload before multipart bytes and keeps demo JSON budgets', async () => {
  await app.close();
  app = await buildApp({
    databasePath: join(dir, 'demo-synthetic.sqlite'),
    publicOrigin: origin,
    demoMode: true,
  });
  const login = await app.inject({
    method: 'POST',
    url: '/api/auth/demo',
    headers: { origin },
    payload: {},
  });
  const demoCookie = `leaf_session=${login.cookies[0]!.value}`;
  const r = await app.inject({
    method: 'POST',
    url,
    headers: {
      origin,
      cookie: demoCookie,
      'x-leaf-contract-version': '2',
      'content-type': form().type,
    },
    payload: Buffer.from('malformed'),
  });
  expect(r.statusCode).toBe(403);
  expect(r.json().code).toBe('DEMO_MEDIA_DISABLED');
});
import { vi } from 'vitest';
it('times out a stalled upload at30seconds and releases admission for a new request', async () => {
  const address = await app.listen({ port: 0, host: '127.0.0.1' });
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
  const received = once(app.server, 'request');
  let held: ReturnType<typeof httpRequest> | undefined;
  try {
    const response = new Promise<number>((resolve, reject) => {
      held = httpRequest(
        address + url,
        {
          method: 'POST',
          headers: {
            ...uploadHeaders(form().type),
            'transfer-encoding': 'chunked',
          },
        },
        (res) => {
          res.resume();
          resolve(res.statusCode!);
        },
      );
      held.on('error', reject);
      held.write('--synthetic-boundary\r\n');
    });
    await received;
    await new Promise<void>((resolve) => setImmediate(resolve));
    await vi.advanceTimersByTimeAsync(L.readTimeoutMilliseconds);
    expect(await response).toBe(408);
  } finally {
    held?.destroy();
    vi.useRealTimers();
  }
  const f = form();
  expect(
    (
      await app.inject({
        method: 'POST',
        url,
        headers: uploadHeaders(f.type),
        payload: f.bytes,
      })
    ).statusCode,
  ).toBe(201);
});
import { openDatabase } from '../src/server/database.js';
it('rejects ambiguous boundary declarations without BLOBs and preserves single quoted/unquoted header limits and admission', async () => {
  const oversized = rawForm([
    field('kind', 'file'),
    field('uploadId', randomUUID()),
    filePart(
      Array.from({ length: 40 }, (_, i) => `X-Synthetic-${i}: x\r\n`).join(''),
    ),
  ])
    .bytes.toString()
    .replaceAll('synthetic-boundary', 'actual');
  for (const type of [
    "multipart/form-data; boundary*=UTF-8''actual; boundary=dummy",
    'multipart/form-data; boundary=actual; boundary=dummy',
    'multipart/form-data; boundary=actual; boundary=actual',
    'multipart/form-data; boundary*0=actual; boundary=dummy',
    'multipart/form-data; boundary="actual"; boundary="dummy"',
  ]) {
    const response = await app.inject({
      method: 'POST',
      url,
      headers: uploadHeaders(type),
      payload: oversized,
    });
    expect(response.statusCode).toBe(400);
  }
  for (const type of [
    'multipart/form-data; boundary=actual',
    'multipart/form-data; boundary="actual"',
  ]) {
    const response = await app.inject({
      method: 'POST',
      url,
      headers: uploadHeaders(type),
      payload: oversized,
    });
    expect(response.statusCode).toBe(413);
  }
  const db = openDatabase(join(dir, 'synthetic.sqlite'));
  try {
    expect(db.prepare('SELECT count(*) AS n FROM journal_media').get()).toEqual(
      { n: 0 },
    );
  } finally {
    db.close();
  }
  for (const quoted of [false, true]) {
    const f = form();
    const type = quoted
      ? 'multipart/form-data; boundary="synthetic-boundary"'
      : f.type;
    expect(
      (
        await app.inject({
          method: 'POST',
          url,
          headers: uploadHeaders(type),
          payload: f.bytes,
        })
      ).statusCode,
    ).toBe(201);
  }
  const browserForm = new FormData();
  browserForm.set('uploadId', randomUUID());
  browserForm.set('kind', 'file');
  browserForm.set('file', new Blob(['synthetic']), 'example.txt');
  const browserRequest = new Request(origin + url, {
    method: 'POST',
    body: browserForm,
  });
  expect(
    (
      await app.inject({
        method: 'POST',
        url,
        headers: uploadHeaders(browserRequest.headers.get('content-type')!),
        payload: Buffer.from(await browserRequest.arrayBuffer()),
      })
    ).statusCode,
  ).toBe(201);
});
it('rejects extended and duplicate boundaries on real sockets before receiving body bytes', async () => {
  const address = await app.listen({ port: 0, host: '127.0.0.1' });
  for (const type of [
    "multipart/form-data; boundary*=UTF-8''actual; boundary=dummy",
    'multipart/form-data; boundary="actual"; boundary=dummy',
  ]) {
    const status = await new Promise<number>((resolve, reject) => {
      const req = httpRequest(
        address + url,
        {
          method: 'POST',
          headers: { ...uploadHeaders(type), 'transfer-encoding': 'chunked' },
        },
        (res) => {
          res.resume();
          resolve(res.statusCode!);
          req.destroy();
        },
      );
      req.on('error', reject);
      req.setTimeout(1500, () => {
        req.destroy();
        reject(Error('Boundary was not rejected before body'));
      });
      req.flushHeaders();
    });
    expect(status).toBe(400);
  }
});
