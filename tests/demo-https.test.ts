import { randomUUID } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import {
  createServer as createHttpServer,
  request as httpRequest,
} from 'node:http';
import {
  createServer as createHttpsServer,
  request as httpsRequest,
} from 'node:https';
import { join } from 'node:path';
import { afterEach, expect, it } from 'vitest';
import { buildApp, type LeafApp } from '../src/server/app.js';

let app: LeafApp | undefined;
let proxy: ReturnType<typeof createHttpsServer> | undefined;
let directory: string | undefined;
afterEach(async () => {
  if (proxy)
    await new Promise<void>((resolve) => proxy!.close(() => resolve()));
  await app?.close();
  if (directory) rmSync(directory, { recursive: true, force: true });
  proxy = undefined;
  app = undefined;
  directory = undefined;
});

it('keeps Secure sessions and exact Origin through a real local TLS proxy', async () => {
  directory = mkdtempSync(join('/tmp', 'leaf-demo-tls-'));
  const key = join(directory, 'key.pem');
  const cert = join(directory, 'cert.pem');
  execFileSync(
    'openssl',
    [
      'req',
      '-x509',
      '-newkey',
      'rsa:2048',
      '-nodes',
      '-keyout',
      key,
      '-out',
      cert,
      '-days',
      '1',
      '-subj',
      '/CN=127.0.0.1',
      '-addext',
      'subjectAltName=IP:127.0.0.1',
    ],
    { stdio: 'ignore' },
  );
  const portHolder = createHttpServer();
  await new Promise<void>((resolve) =>
    portHolder.listen(0, '127.0.0.1', resolve),
  );
  const reservedPort = (portHolder.address() as { port: number }).port;
  await new Promise<void>((resolve) => portHolder.close(() => resolve()));
  const origin = `https://127.0.0.1:${reservedPort}`;
  app = await buildApp({
    databasePath: join(directory, 'synthetic.sqlite'),
    publicOrigin: origin,
    demoMode: true,
  });
  await app.listen({ host: '127.0.0.1', port: 0 });
  const backend = app.server.address();
  if (!backend || typeof backend === 'string')
    throw new Error('No backend port');
  proxy = createHttpsServer(
    { key: readFileSync(key), cert: readFileSync(cert) },
    (incoming, outgoing) => {
      const forwarded = httpRequest(
        {
          host: '127.0.0.1',
          port: backend.port,
          method: incoming.method,
          path: incoming.url,
          headers: incoming.headers,
        },
        (response) => {
          outgoing.writeHead(response.statusCode ?? 502, response.headers);
          response.pipe(outgoing);
        },
      );
      forwarded.on('error', () => outgoing.writeHead(502).end());
      incoming.pipe(forwarded);
    },
  );
  await new Promise<void>((resolve) =>
    proxy!.listen(reservedPort, '127.0.0.1', resolve),
  );
  type Result = {
    status: number;
    headers: Record<string, string | string[] | undefined>;
    body: string;
  };
  const send = (
    method: string,
    path: string,
    options: {
      origin?: string;
      cookie?: string;
      payload?: object;
      forwarded?: boolean;
    } = {},
  ) =>
    new Promise<Result>((resolve, reject) => {
      const body =
        options.payload === undefined
          ? undefined
          : JSON.stringify(options.payload);
      const request = httpsRequest(
        `${origin}${path}`,
        {
          method,
          ca: readFileSync(cert),
          headers: {
            ...(options.origin ? { origin: options.origin } : {}),
            ...(options.cookie ? { cookie: options.cookie } : {}),
            ...(body === undefined
              ? {}
              : {
                  'content-type': 'application/json',
                  'content-length': Buffer.byteLength(body),
                }),
            ...(options.forwarded
              ? {
                  forwarded: 'host=evil.example.test;proto=http',
                  'x-forwarded-host': 'evil.example.test',
                }
              : {}),
            'x-leaf-contract-version': '2',
          },
        },
        (response) => {
          const chunks: Buffer[] = [];
          response.on('data', (chunk: Buffer) => chunks.push(chunk));
          response.on('end', () =>
            resolve({
              status: response.statusCode ?? 0,
              headers: response.headers,
              body: Buffer.concat(chunks).toString(),
            }),
          );
        },
      );
      request.on('error', reject);
      request.end(body);
    });
  expect((await send('GET', '/readyz')).status).toBe(200);
  expect((await send('POST', '/api/auth/demo', { payload: {} })).status).toBe(
    403,
  );
  expect(
    (
      await send('POST', '/api/auth/demo', {
        origin: 'https://foreign.example.test',
        payload: {},
      })
    ).status,
  ).toBe(403);
  expect(
    (
      await send('POST', '/api/auth/demo', {
        origin,
        payload: {},
        forwarded: true,
      })
    ).status,
  ).toBe(200);
  const entry = await send('POST', '/api/auth/demo', { origin, payload: {} });
  expect(entry.status).toBe(200);
  const setCookie = entry.headers['set-cookie']?.[0];
  expect(Boolean(setCookie && /; Secure(?:;|$)/i.test(setCookie))).toBe(true);
  expect(Boolean(setCookie && /; HttpOnly(?:;|$)/i.test(setCookie))).toBe(true);
  expect(
    Boolean(setCookie && /; SameSite=Strict(?:;|$)/i.test(setCookie)),
  ).toBe(true);
  const cookie = setCookie?.split(';')[0];
  if (!cookie) throw new Error('Missing session cookie');
  const list = await send('GET', '/api/projects', { cookie });
  expect(list.status).toBe(200);
  const projects = JSON.parse(list.body) as { id: string; revision: number }[];
  expect(projects).toHaveLength(1);
  const project = projects[0]!;
  const edit = await send('PATCH', `/api/projects/${project.id}`, {
    origin,
    cookie,
    forwarded: true,
    payload: {
      contractVersion: 2,
      operationId: randomUUID(),
      expectedRevision: project.revision,
      title: 'Synthetic TLS edit',
    },
  });
  expect(edit.status).toBe(200);
  const after = await send('GET', '/api/projects', { cookie });
  expect(after.status).toBe(200);
  const persisted = JSON.parse(after.body) as {
    revision: number;
    title: string;
  }[];
  expect(persisted[0]?.revision).toBe(project.revision + 1);
  expect(persisted[0]?.title).toBe('Synthetic TLS edit');
  expect(
    (
      await send('POST', '/api/auth/logout', {
        origin: 'https://foreign.example.test',
        cookie,
        payload: {},
      })
    ).status,
  ).toBe(403);
  expect(
    (await send('POST', '/api/auth/logout', { origin, cookie, payload: {} }))
      .status,
  ).toBe(200);
  expect((await send('GET', '/api/projects', { cookie })).status).toBe(401);
});
