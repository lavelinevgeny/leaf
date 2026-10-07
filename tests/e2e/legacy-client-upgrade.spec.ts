import { test, expect } from '@playwright/test';
import Database from 'better-sqlite3';
import { syntheticRuntime } from '../../scripts/e2e-server.js';
import { buildPinnedS3, mountPinnedS3 } from '../helpers/pinned-s3.js';
import { rawSyntheticCountsAndRevision } from '../helpers/optional-api-fixtures.js';
test('unchanged S3 shows the upgrade refusal without uncertain mutation', async ({
  page,
}) => {
  test.setTimeout(120000);
  const pinned = await buildPinnedS3();
  const runtime = await syntheticRuntime().catch(async (error) => {
    await pinned.close();
    throw error;
  });
  try {
    const login = await page.request.post(`${runtime.origin}/api/auth/login`, {
      headers: { Origin: runtime.origin },
      data: { password: runtime.password },
    });
    expect(login.ok()).toBe(true); // cookies только своего synthetic browser context
    const created = await page.request.post(`${runtime.origin}/api/projects`, {
      headers: { Origin: runtime.origin, 'X-Leaf-Contract-Version': '2' },
      data: { title: 'Synthetic upgrade' },
    });
    expect(created.status()).toBe(201);
    const projectId = (await created.json()).id as string;
    const inspect = () => {
      const db = new Database(runtime.databasePath, { readonly: true });
      try {
        return rawSyntheticCountsAndRevision(db, projectId);
      } finally {
        db.close();
      }
    };
    const before = inspect();
    await mountPinnedS3(page, runtime.origin, pinned.clientRoot);
    const refused = page.waitForResponse(
      (response) =>
        response.url() === `${runtime.origin}/api/projects` &&
        response.status() === 426,
    );
    await page.goto(runtime.origin);
    const response = await refused;
    expect(
      response.request().headers()['x-leaf-contract-version'],
    ).toBeUndefined();
    const message =
      'Версия приложения устарела. Обновите страницу для продолжения. Этот запрос не изменил данные.';
    await expect(page.getByText(message, { exact: true })).toBeVisible();
    await expect(
      page.getByText('INVALID_RESPONSE', { exact: true }),
    ).toHaveCount(0);
    await expect(
      page.getByText(
        'Проект изменён в другой сессии. Загрузите актуальный проект; черновик останется в панели.',
        { exact: true },
      ),
    ).toHaveCount(0);
    const old = await import(pinned.apiProbeUrl); // Vite output старого неизменённого api.ts
    const cookies = await page.context().cookies(runtime.origin);
    const cookie = cookies
      .map((item) => `${item.name}=${item.value}`)
      .join(';');
    const savedFetch = globalThis.fetch;
    globalThis.fetch = (input, init) => {
      const headers = new Headers(init?.headers);
      headers.set('Cookie', cookie);
      return savedFetch(new URL(String(input), runtime.origin), {
        ...init,
        headers,
      });
    };
    try {
      await expect(old.api.projects()).rejects.toMatchObject({
        code: 'CONTRACT_VERSION_CONFLICT',
        status: 426,
        uncertain: false,
        message,
      });
    } finally {
      globalThis.fetch = savedFetch;
    }
    expect(inspect()).toEqual(before); // revision + ops + undo + tasks unchanged
  } finally {
    try {
      await runtime.close();
    } finally {
      await pinned.close();
    }
  }
});
