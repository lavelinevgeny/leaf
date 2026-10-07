// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest';
import { api } from '../../src/client/api.js';
import { optionalTreeFixture } from './fixtures.js';
afterEach(() => vi.unstubAllGlobals());
it('versions every project transport and preserves original legacy bodies independently of new envelopes', async () => {
  const tree = optionalTreeFixture();
  const fetch = vi.fn<(path: string, init?: RequestInit) => Promise<Response>>(
    async (path: string) =>
      new Response(
        JSON.stringify(
          path.endsWith('/projects')
            ? [tree.project]
            : path.endsWith('/session')
              ? { authenticated: true, setupRequired: false }
              : tree,
        ),
        { status: 200 },
      ),
  );
  vi.stubGlobal('fetch', fetch);
  await api.projects();
  await api.tree(tree.project.id);
  const original = {
    operationId: '33333333-3333-4333-8333-333333333333',
    expectedRevision: 8,
    command: { type: 'task.create', title: 'Synthetic', parentId: null },
  };
  await api.replayLegacy(tree.project.id, original, 'command');
  expect(JSON.parse(fetch.mock.calls[2]![1]!.body as string)).toEqual(original);
  expect(fetch.mock.calls[2]![1]!.headers).toMatchObject({
    'X-Leaf-Contract-Version': '2',
    'X-Leaf-Legacy-Replay': '1',
  });
  await api.session();
  expect(fetch.mock.calls[3]![1]!.headers).not.toHaveProperty(
    'X-Leaf-Contract-Version',
  );
  for (const call of fetch.mock.calls.slice(0, 3))
    expect(call[1]!.headers).toHaveProperty('X-Leaf-Contract-Version', '2');
});
it('treats426 as a known rejection and validates version before accepting a stale response', async () => {
  const message =
    'Версия приложения устарела. Обновите страницу для продолжения. Этот запрос не изменил данные.';
  vi.stubGlobal(
    'fetch',
    vi.fn(
      async () =>
        new Response(
          JSON.stringify({ code: 'CONTRACT_VERSION_CONFLICT', message }),
          { status: 426 },
        ),
    ),
  );
  await expect(api.tree('synthetic')).rejects.toMatchObject({
    status: 426,
    uncertain: false,
    message,
  });
  vi.stubGlobal(
    'fetch',
    vi.fn(
      async () =>
        new Response(
          JSON.stringify({ ...optionalTreeFixture(), contractVersion: 1 }),
          { status: 200 },
        ),
    ),
  );
  await expect(api.tree('synthetic')).rejects.toMatchObject({
    code: 'INVALID_RESPONSE',
  });
});

it('sends version2 command and rename bodies unchanged with project transport headers', async () => {
  const tree = optionalTreeFixture();
  const fetch = vi.fn<(path: string, init?: RequestInit) => Promise<Response>>(
    async () => new Response(JSON.stringify(tree), { status: 200 }),
  );
  vi.stubGlobal('fetch', fetch);
  const envelope = {
    contractVersion: 2 as const,
    expectedRevision: 0,
    operationId: '33333333-3333-4333-8333-333333333333',
    command: {
      type: 'task.edit' as const,
      taskId: tree.tasks[1]!.id,
      changes: { inputFinish: null },
    },
  };
  await api.command(tree.project.id, envelope);
  const rename = {
    contractVersion: 2 as const,
    expectedRevision: 0,
    operationId: '44444444-4444-4444-8444-444444444444',
    title: 'Synthetic renamed',
  };
  await api.rename(tree.project.id, rename);
  expect(JSON.parse(fetch.mock.calls[0]![1]!.body as string)).toEqual(envelope);
  expect(JSON.parse(fetch.mock.calls[1]![1]!.body as string)).toEqual(rename);
  for (const [, init] of fetch.mock.calls)
    expect(init!.headers).toMatchObject({ 'X-Leaf-Contract-Version': '2' });
});
