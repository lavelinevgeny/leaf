import { test, expect } from '@playwright/test';
import { syntheticRuntime } from '../../scripts/e2e-server.js';
import {
  seedOptionalRuntime,
  readTree,
  send,
} from '../helpers/optional-e2e.js';

test('cancels duration choice before navigating through a held real project GET', async ({
  page,
}) => {
  const runtime = await syntheticRuntime();
  let release = () => {};
  try {
    let tree = await seedOptionalRuntime(page, runtime);
    const taskId = tree.tasks.find((task) => task.title === 'Работа A')!.id;
    tree = await send(page, runtime.origin, tree, {
      type: 'task.edit',
      taskId,
      changes: { durationDays: 2 },
    });
    let mutations = 0;
    page.on('request', (request) => {
      if (request.method() === 'POST' && request.url().endsWith('/commands'))
        mutations++;
    });
    await page.goto(runtime.origin);
    await page
      .getByRole('button', { name: /Работа A, 2026/ })
      .press('Shift+ArrowRight');
    const dialog = page.getByRole('dialog', {
      name: 'Длительность не совпадает',
    });
    await expect(dialog).toBeVisible();
    await dialog.getByRole('button', { name: 'Отмена', exact: true }).click();
    expect(mutations).toBe(0);
    expect(await readTree(page, runtime.origin, tree.project.id)).toEqual(tree);
    const created = await page.request.post(`${runtime.origin}/api/projects`, {
      headers: { Origin: runtime.origin, 'X-Leaf-Contract-Version': '2' },
      data: { title: 'Другой проект' },
    });
    expect(created.status()).toBe(201);
    const otherId = (await created.json()).id as string;
    await page.reload();
    await page
      .getByRole('button', { name: 'Демо-проект', exact: true })
      .click();
    await page
      .getByRole('button', { name: /Работа A, 2026/ })
      .press('Shift+ArrowRight');
    await expect(dialog).toBeVisible();
    let held = false;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    await page.route(`**/api/projects/${otherId}/tree`, async (route) => {
      const response = await route.fetch();
      held = true;
      await gate;
      await route.fulfill({ response });
    });
    const errors: string[] = [];
    page.on('pageerror', (error) => errors.push(error.name));
    await page
      .getByRole('button', { name: 'Другой проект', exact: true })
      .click();
    await expect.poll(() => held).toBe(true);
    await expect(dialog).toHaveCount(0);
    expect(mutations).toBe(0);
    expect(errors).toEqual([]);
    release();
    await expect(
      page.getByRole('heading', { name: 'Другой проект', exact: true }),
    ).toBeVisible();
    expect(await readTree(page, runtime.origin, tree.project.id)).toEqual(tree);
    expect((await readTree(page, runtime.origin, otherId)).tasks).toEqual([]);
  } finally {
    release();
    await runtime.close();
  }
});

test('cancels stale duration choice when a background command changes the revision', async ({
  page,
}) => {
  const runtime = await syntheticRuntime();
  try {
    let tree = await seedOptionalRuntime(page, runtime);
    const taskId = tree.tasks.find((task) => task.title === 'Работа A')!.id;
    tree = await send(page, runtime.origin, tree, {
      type: 'task.edit',
      taskId,
      changes: { durationDays: 2 },
    });
    await page.goto(runtime.origin);
    await page
      .getByRole('button', { name: /Работа A, 2026/ })
      .press('Shift+ArrowRight');
    const dialog = page.getByRole('dialog', {
      name: 'Длительность не совпадает',
    });
    await expect(dialog).toBeVisible();
    let mutations = 0;
    page.on('request', (request) => {
      if (request.method() === 'POST' && request.url().endsWith('/commands'))
        mutations++;
    });
    const quick = page.getByLabel('Новая задача', { exact: true });
    await quick.fill('Фоновая работа');
    await quick.press('Enter');
    await expect(
      page.getByRole('treeitem', { name: /Фоновая работа,/ }),
    ).toBeVisible();
    await expect(dialog).toHaveCount(0);
    const next = await readTree(page, runtime.origin, tree.project.id);
    expect(next.project.revision).toBe(tree.project.revision + 1);
    expect(next.tasks.find((task) => task.id === taskId)).toEqual(
      tree.tasks.find((task) => task.id === taskId),
    );
    expect(mutations).toBe(1);
    await page
      .getByRole('button', { name: /Работа A, 2026/ })
      .press('Shift+ArrowRight');
    await expect(dialog).toBeVisible();
    await dialog
      .getByRole('button', { name: 'Синхронно изменить длительность' })
      .click();
    await expect(dialog).toHaveCount(0);
    await expect(
      page.getByRole('button', { name: /Работа A, 2026-10-05 – 2026-10-07/ }),
    ).toBeVisible();
    const synced = await readTree(page, runtime.origin, tree.project.id);
    expect(synced.project.revision).toBe(tree.project.revision + 2);
    expect(synced.tasks.find((task) => task.id === taskId)).toMatchObject({
      inputStart: '2026-10-05',
      inputFinish: '2026-10-07',
      durationDays: 3,
    });
    expect(mutations).toBe(2);
  } finally {
    await runtime.close();
  }
});
