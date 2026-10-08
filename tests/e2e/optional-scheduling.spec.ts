import { test as base, expect } from '@playwright/test';
import { randomUUID } from 'node:crypto';
import Database from 'better-sqlite3';
import { syntheticRuntime } from '../../scripts/e2e-server.js';
import {
  seedOptionalRuntime,
  readTree,
  send,
} from '../helpers/optional-e2e.js';
const test = base.extend<{
  runtime: Awaited<ReturnType<typeof syntheticRuntime>>;
}>({
  runtime: async ({}, use) => {
    const runtime = await syntheticRuntime();
    try {
      await use(runtime);
    } finally {
      await runtime.close();
    }
  },
});
test('optional source, linked input, API mismatch rollback, FS conflict, undo and restart', async ({
  page,
  runtime,
}, info) => {
  let tree = await seedOptionalRuntime(page, runtime);
  const a = tree.tasks.find((t) => t.title === 'Работа A')!.id,
    c = tree.tasks.find((t) => t.title === 'Работа C')!.id;
  await page.goto(runtime.origin);
  await expect(
    page.getByText(
      'Анализ датированной части; полный критический путь неизвестен',
      {
        exact: true,
      },
    ),
  ).toBeVisible();
  await expect(
    page.getByRole('button', { name: /Работа C.*Условное размещение/ }),
  ).toBeVisible();
  await page.getByRole('treeitem', { name: /Работа C,/ }).click();
  await expect(page.getByLabel('Начало', { exact: true })).toHaveValue('');
  await expect(page.getByLabel('Окончание', { exact: true })).toHaveValue('');
  await page.getByLabel('Начало', { exact: true }).fill('2026-10-05');
  await page.getByLabel('Окончание', { exact: true }).fill('2026-10-06');
  await page
    .getByLabel('Описание', { exact: true })
    .fill('Синтетический черновик');
  await expect(
    page.getByLabel('Длительность, рабочих дней', { exact: true }),
  ).toHaveValue('2');
  const mismatch = await page.request.post(
    `${runtime.origin}/api/projects/${tree.project.id}/commands`,
    {
      headers: { Origin: runtime.origin, 'X-Leaf-Contract-Version': '2' },
      data: {
        contractVersion: 2,
        expectedRevision: tree.project.revision,
        operationId: randomUUID(),
        command: {
          type: 'task.edit',
          taskId: c,
          changes: {
            inputStart: '2026-10-05',
            inputFinish: '2026-10-06',
            durationDays: 3,
          },
        },
      },
    },
  );
  expect(mismatch.status()).toBe(400);
  expect((await mismatch.json()).code).toBe('DURATION_MISMATCH');
  await expect(page.getByLabel('Описание', { exact: true })).toHaveValue(
    'Синтетический черновик',
  );
  expect(
    (await readTree(page, runtime.origin, tree.project.id)).project.revision,
  ).toBe(tree.project.revision);
  await page.getByLabel('Длительность, рабочих дней', { exact: true }).fill('');
  await page.getByRole('button', { name: 'Сохранить', exact: true }).click();
  await expect(page.getByText('Сохранено', { exact: true })).toBeVisible();
  tree = await readTree(page, runtime.origin, tree.project.id);
  expect(tree.tasks.find((t) => t.id === c)).toMatchObject({
    inputStart: '2026-10-05',
    inputFinish: '2026-10-06',
    durationDays: null,
  });
  tree = await send(page, runtime.origin, tree, {
    type: 'dependency.create',
    predecessorId: a,
    successorId: c,
  });
  expect(tree.schedule.feasibility).toBe('infeasible');
  await page.reload();
  await page.getByRole('treeitem', { name: /Работа C,/ }).click();
  await page.getByRole('tab', { name: 'Зависимости', exact: true }).click();
  await expect(
    page.getByText('Предшественник заканчивается после явного начала.').first(),
  ).toBeVisible();
  await page.screenshot({
    path: `/tmp/leaf-task5-${info.project.name}-dependencies.png`,
  });
  await page.keyboard.press('Escape');
  await page
    .getByRole('button', { name: 'Отменить последнее изменение' })
    .click();
  await expect(page.locator('[data-gantt-edge]')).toHaveCount(0);
  await page.reload();
  await runtime.restart();
  await page.reload();
  const after = await readTree(page, runtime.origin, tree.project.id);
  expect(after.dependencies).toEqual([]);
  expect(after.tasks.find((t) => t.id === c)!.inputFinish).toBe('2026-10-06');
  await page.screenshot({
    path: `/tmp/leaf-task5-${info.project.name}-main.png`,
  });
  await page.getByRole('treeitem', { name: /Работа C,/ }).click();
  await page.screenshot({
    path: `/tmp/leaf-task5-${info.project.name}-panel.png`,
  });
});
test('dirty selected deletion retains readable tombstone then discards and restores focus', async ({
  page,
  runtime,
}) => {
  const tree = await seedOptionalRuntime(page, runtime);
  await page.goto(runtime.origin);
  const selectedId = tree.tasks.find((t) => t.title === 'Работа C')!.id;
  await page.getByRole('treeitem', { name: /Работа C,/ }).click();
  await page
    .getByLabel('Описание', { exact: true })
    .fill('Синтетический черновик');
  const deleted = await page.request.post(
    `${runtime.origin}/api/projects/${tree.project.id}/commands`,
    {
      headers: { Origin: runtime.origin, 'X-Leaf-Contract-Version': '2' },
      data: {
        contractVersion: 2,
        expectedRevision: tree.project.revision,
        operationId: randomUUID(),
        command: { type: 'task.delete', taskId: selectedId },
      },
    },
  );
  expect(deleted.status()).toBe(200);
  await page.getByRole('button', { name: 'Сохранить', exact: true }).click();
  await page
    .getByRole('button', { name: 'Загрузить актуальный проект', exact: true })
    .click();
  await expect(page.getByText(/Выбранная задача удалена/)).toBeVisible();
  await expect(page.getByLabel('Описание', { exact: true })).toHaveValue(
    'Синтетический черновик',
  );
  await expect(
    page.getByRole('button', { name: 'Сохранить', exact: true }),
  ).toBeDisabled();
  await expect(page.locator(`[data-gantt-row="${selectedId}"]`)).toHaveCount(0);
  await page
    .getByRole('button', { name: 'Отбросить изменения', exact: true })
    .click();
  await page.keyboard.press('Escape');
  await expect(
    page.getByRole('complementary', { name: 'Задача', exact: true }),
  ).toHaveCount(0);
  await expect(page.getByLabel('Новая задача', { exact: true })).toBeFocused();
  await page.reload();
  await runtime.restart();
  await page.reload();
  expect(
    (await readTree(page, runtime.origin, tree.project.id)).tasks.some(
      (t) => t.id === selectedId,
    ),
  ).toBe(false);
  await page
    .getByRole('button', { name: 'Отменить последнее изменение' })
    .click();
  await expect(page.getByRole('treeitem', { name: /Работа C,/ })).toBeVisible();
  expect(
    (await readTree(page, runtime.origin, tree.project.id)).tasks.find(
      (t) => t.id === selectedId,
    )!.durationDays,
  ).toBe(3);
});
test('unavailable original done must reopen, explicitly adopts equal source, undo and restart retain marker', async ({
  page,
  runtime,
}) => {
  let tree = await seedOptionalRuntime(page, runtime);
  const id = tree.tasks.find((t) => t.title === 'Работа A')!.id;
  const db = new Database(runtime.databasePath);
  try {
    db.prepare("UPDATE tasks SET status='done' WHERE id=?").run(id);
    db.prepare(
      "INSERT INTO task_schedule_provenance VALUES (?, 'legacy-interval-unavailable')",
    ).run(id);
  } finally {
    db.close();
  }
  await page.goto(runtime.origin);
  await page.getByRole('treeitem', { name: /Работа A,/ }).click();
  await expect(
    page
      .getByText(/Прежний интервал недоступен; полный расчёт неизвестен/)
      .last(),
  ).toBeVisible();
  await expect(page.getByLabel('Начало', { exact: true })).toBeDisabled();
  await page.getByLabel('Статус', { exact: true }).selectOption('doing');
  await page.getByRole('button', { name: 'Сохранить', exact: true }).click();
  await expect(page.getByText('Сохранено', { exact: true })).toBeVisible();
  tree = await readTree(page, runtime.origin, tree.project.id);
  expect(tree.schedule.tasks[id]!.startDate).toBeNull();
  await page.getByRole('button', { name: 'Сохранить', exact: true }).click();
  await expect(page.locator(`[data-gantt-bar="${id}"]`)).toBeVisible();
  tree = await readTree(page, runtime.origin, tree.project.id);
  expect(tree.schedule.tasks[id]!.startDate).toBe('2026-10-05');
  await page.keyboard.press('Escape');
  await page
    .getByRole('button', { name: 'Отменить последнее изменение' })
    .click();
  await runtime.restart();
  await page.reload();
  tree = await readTree(page, runtime.origin, tree.project.id);
  expect(tree.schedule.tasks[id]!.startDate).toBeNull();
  expect(tree.tasks.find((t) => t.id === id)!.status).toBe('doing');
});

test('actual delayed tree read exposes loading then the empty project with keyboard quick input', async ({
  page,
  runtime,
}) => {
  const login = await page.request.post(`${runtime.origin}/api/auth/login`, {
    headers: { Origin: runtime.origin },
    data: { password: runtime.password },
  });
  expect(login.status()).toBe(200);
  const created = await page.request.post(`${runtime.origin}/api/projects`, {
    headers: { Origin: runtime.origin, 'X-Leaf-Contract-Version': '2' },
    data: { title: 'Пустой демо-проект' },
  });
  expect(created.status()).toBe(201);
  let release!: () => void;
  let reached!: () => void;
  const held = new Promise<void>((resolve) => {
    release = resolve;
  });
  const requested = new Promise<void>((resolve) => {
    reached = resolve;
  });
  await page.route('**/api/projects/*/tree', async (route) => {
    reached();
    await held;
    await route.continue();
  });
  try {
    await page.goto(runtime.origin);
    await requested;
    await expect(page.getByText('Загрузка…', { exact: true })).toBeVisible();
    release();
    await expect(
      page.getByText('В проекте пока нет задач.', { exact: true }),
    ).toBeVisible();
    await expect(page.locator('[data-gantt-row]')).toHaveCount(0);
    const quick = page.getByLabel('Новая задача', { exact: true });
    await quick.focus();
    await page.keyboard.type('Новая работа');
    await page.keyboard.press('Enter');
    await expect(
      page.getByRole('treeitem', { name: /Новая работа,/ }),
    ).toBeVisible();
  } finally {
    release();
  }
});
