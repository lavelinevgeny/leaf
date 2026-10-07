import { test, expect } from '@playwright/test';
import { syntheticRuntime } from '../../scripts/e2e-server.js';
import {
  seedOptionalRuntime,
  readTree,
  send,
} from '../helpers/optional-e2e.js';
test('preserves duration-only work and dependencies on explicit child conversion and complete undo', async ({
  page,
}) => {
  const runtime = await syntheticRuntime();
  try {
    let tree = await seedOptionalRuntime(page, runtime);
    const c = tree.tasks.find((t) => t.title === 'Работа C')!.id,
      a = tree.tasks.find((t) => t.title === 'Работа A')!.id;
    tree = await send(page, runtime.origin, tree, {
      type: 'dependency.create',
      predecessorId: a,
      successorId: c,
    });
    await page.goto(runtime.origin);
    await page.getByRole('treeitem', { name: /Работа C,/ }).click();
    await page
      .getByRole('button', { name: 'Добавить подзадачу', exact: true })
      .click();
    page.once('dialog', (dialog) => dialog.accept());
    await page
      .getByLabel('Новая задача', { exact: true })
      .fill('Новый ребёнок');
    await page.getByLabel('Новая задача', { exact: true }).press('Enter');
    await expect(
      page.getByRole('treeitem', { name: /Новый ребёнок,/ }),
    ).toBeVisible();
    const changed = await readTree(page, runtime.origin, tree.project.id);
    const own = changed.tasks.find(
      (t) => t.parentId === c && t.title === 'Работа C',
    )!;
    expect(own.durationDays).toBe(3);
    expect(changed.tasks.find((t) => t.id === c)).toMatchObject({
      inputStart: null,
      inputFinish: null,
      durationDays: null,
    });
    expect(changed.dependencies[0]!.successorId).toBe(own.id);
    await page.keyboard.press('Escape');
    await page
      .getByRole('button', { name: 'Отменить последнее изменение' })
      .click();
    await expect(
      page.getByRole('treeitem', { name: /Новый ребёнок,/ }),
    ).toHaveCount(0);
    await runtime.restart();
    const restored = await readTree(page, runtime.origin, tree.project.id);
    expect(restored.tasks).toEqual(tree.tasks);
    expect(restored.dependencies).toEqual(tree.dependencies);
  } finally {
    await runtime.close();
  }
});
test('unversioned real request cannot mutate an existing project and retry remains exact after lost committed response', async ({
  page,
}) => {
  const runtime = await syntheticRuntime();
  try {
    const tree = await seedOptionalRuntime(page, runtime);
    await page.goto(runtime.origin);
    const old = await page.request.post(
      `${runtime.origin}/api/projects/${tree.project.id}/commands`,
      {
        headers: { Origin: runtime.origin },
        data: {
          expectedRevision: tree.project.revision,
          operationId: '44444444-4444-4444-8444-444444444444',
          command: { type: 'task.create', title: 'Old', parentId: null },
        },
      },
    );
    expect(old.status()).toBe(426);
    await page.getByRole('treeitem', { name: /Работа C,/ }).click();
    await page
      .getByLabel('Описание', { exact: true })
      .fill('Синтетический ответ потерян');
    let original: string | undefined;
    let requests = 0;
    await page.route('**/commands', async (route) => {
      requests++;
      if (requests === 1) {
        original = route.request().postData()!;
        const committed = await route.fetch();
        expect(committed.status()).toBe(200);
        await route.abort('failed');
      } else {
        expect(route.request().postData()).toBe(original);
        await route.continue();
      }
    });
    await page.getByRole('button', { name: 'Сохранить', exact: true }).click();
    await expect(page.getByText(/Нет связи с сервером/)).toBeVisible();
    await expect(page.getByLabel('Описание', { exact: true })).toHaveValue(
      'Синтетический ответ потерян',
    );
    await page
      .getByRole('button', { name: 'Повторить сохранение', exact: true })
      .click();
    await expect(page.getByText('Сохранено', { exact: true })).toBeVisible();
    expect(requests).toBe(2);
    expect(
      (await readTree(page, runtime.origin, tree.project.id)).project.revision,
    ).toBe(tree.project.revision + 1);
  } finally {
    await runtime.close();
  }
});
