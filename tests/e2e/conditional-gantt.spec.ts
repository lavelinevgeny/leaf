import { test, expect } from '@playwright/test';
import { syntheticRuntime } from '../../scripts/e2e-server.js';
import {
  readTree,
  seedOptionalRuntime,
  send,
} from '../helpers/optional-e2e.js';

test('own/group/today geometry refreshes across midnight without source writes or fake critical edges', async ({
  page,
}, info) => {
  const runtime = await syntheticRuntime();
  try {
    let tree = await seedOptionalRuntime(page, runtime);
    tree = await send(page, runtime.origin, tree, {
      type: 'project.schedule',
      changes: { timezone: 'Europe/Moscow' },
    });
    for (const command of [
      { type: 'task.create', title: 'Без дат', parentId: null },
      {
        type: 'task.create',
        title: 'Только окончание',
        parentId: tree.tasks[0]!.id,
        inputFinish: '2026-10-12',
        durationDays: 2,
      },
      {
        type: 'task.create',
        title: 'Только начало',
        parentId: null,
        inputStart: '2026-10-09',
      },
    ] as const)
      tree = await send(page, runtime.origin, tree, command);
    const root = tree.tasks.find((task) => task.title === 'Без дат')!.id;
    const c = tree.tasks.find((task) => task.title === 'Работа C')!.id;
    const finish = tree.tasks.find(
      (task) => task.title === 'Только окончание',
    )!.id;
    tree = await send(page, runtime.origin, tree, {
      type: 'dependency.create',
      predecessorId: finish,
      successorId: root,
    });
    const before = tree;
    let writes = 0;
    page.on('request', (request) => {
      if (request.method() === 'POST' && request.url().endsWith('/commands'))
        writes++;
    });
    await page.clock.install({ time: new Date('2026-10-08T20:59:30Z') });
    await page.goto(runtime.origin);
    const rootBar = page.getByRole('button', {
      name: /^Без дат, 2026-10-13 – 2026-10-13, Условное размещение/,
    });
    await expect(rootBar).toBeVisible();
    await expect(page.locator(`[data-gantt-bar="${root}"]`)).toHaveAttribute(
      'x',
      '330',
    );
    await expect(page.locator(`[data-gantt-bar="${c}"]`)).toHaveAttribute(
      'x',
      '90',
    );
    await expect(page.locator(`[data-gantt-bar="${finish}"]`)).toHaveAttribute(
      'x',
      '210',
    );
    await expect(
      page.getByRole('button', {
        name: /^Только окончание, 2026-10-09 – 2026-10-12, Условное размещение/,
      }),
    ).toBeVisible();
    await expect(page.locator('.gantt-edge.conditional')).toHaveCount(1);
    await expect(
      page.locator(
        `[data-gantt-row="${root}"] .critical, [data-gantt-row="${root}"] .partial-critical`,
      ),
    ).toHaveCount(0);
    await rootBar.focus();
    await page.keyboard.press('ArrowRight');
    await page.keyboard.press('Shift+ArrowRight');
    await page.keyboard.press('Enter');
    await expect(page.getByLabel('Начало', { exact: true })).toHaveValue('');
    await expect(
      page.getByLabel('Длительность, рабочих дней', { exact: true }),
    ).toHaveValue('');
    await page.keyboard.press('Escape');
    await page.clock.runFor(61000);
    await expect(
      page.getByRole('button', {
        name: /^Без дат, 2026-10-13 – 2026-10-13, Условное размещение/,
      }),
    ).toBeVisible();
    await expect(page.locator(`[data-gantt-bar="${root}"]`)).toHaveAttribute(
      'x',
      '330',
    );
    await expect(page.locator(`[data-gantt-bar="${c}"]`)).toHaveAttribute(
      'x',
      '90',
    );
    await page.getByRole('searchbox', { name: 'Поиск задач' }).fill('Работа C');
    await expect(page.locator(`[data-gantt-bar="${c}"]`)).toHaveAttribute(
      'x',
      '90',
    );
    await page.getByRole('searchbox', { name: 'Поиск задач' }).fill('');
    await page.getByRole('button', { name: 'Следующий период' }).click();
    await expect(page.locator(`[data-gantt-bar="${root}"]`)).toHaveCount(0);
    await page.getByRole('treeitem', { name: /^Без дат,/ }).click();
    await page.getByRole('tab', { name: 'Зависимости', exact: true }).click();
    await page
      .getByRole('button', { name: 'Показать на Ганте', exact: true })
      .click();
    await page.keyboard.press('Escape');
    await expect(
      page.getByRole('button', {
        name: /^Без дат, 2026-10-13 – 2026-10-13, Условное размещение/,
      }),
    ).toBeVisible();
    expect(writes).toBe(0);
    expect(await readTree(page, runtime.origin, tree.project.id)).toEqual(
      before,
    );
    await page.screenshot({
      path: `/tmp/leaf-c19-gantt-${info.project.name}.png`,
    });
  } finally {
    await runtime.close();
  }
});

test('creation defaults and explicit Today persist atomically through lost response, exact retry, undo and restart', async ({
  page,
}, info) => {
  const runtime = await syntheticRuntime();
  try {
    let tree = await seedOptionalRuntime(page, runtime);
    await page.clock.install({ time: new Date('2026-10-09T09:00:00Z') });
    await page.goto(runtime.origin);
    const quick = page.locator('form.quick-add');
    await quick.getByRole('button', { name: 'Сроки новой задачи' }).click();
    await expect(quick.getByLabel('Длительность, рабочих дней')).toHaveValue(
      '1',
    );
    await expect(quick.getByLabel('Начало', { exact: true })).toHaveValue('');
    await quick.getByLabel('Новая задача').fill('Создана без дат');
    await quick.getByLabel('Новая задача').press('Enter');
    await expect(quick.getByLabel('Новая задача')).toHaveValue('');
    tree = await readTree(page, runtime.origin, tree.project.id);
    expect(
      tree.tasks.find((task) => task.title === 'Создана без дат'),
    ).toMatchObject({ durationDays: 1, inputStart: null, inputFinish: null });
    await quick.getByLabel('Длительность, рабочих дней').fill('');
    await quick.getByLabel('Новая задача').fill('Очищенная длительность');
    await quick.getByLabel('Новая задача').press('Enter');
    await expect(quick.getByLabel('Новая задача')).toHaveValue('');
    tree = await readTree(page, runtime.origin, tree.project.id);
    expect(
      tree.tasks.find((task) => task.title === 'Очищенная длительность'),
    ).toMatchObject({
      durationDays: null,
      inputStart: null,
      inputFinish: null,
    });
    const before = tree;
    await quick.getByLabel('Новая задача').fill('Явно сегодня');
    await quick.getByRole('button', { name: 'Сегодня: Начало' }).click();
    await expect(quick.getByLabel('Окончание', { exact: true })).toHaveValue(
      '09.10.2026',
    );
    expect(await readTree(page, runtime.origin, tree.project.id)).toEqual(
      before,
    );
    await page.screenshot({
      path: `/tmp/leaf-c19-create-${info.project.name}.png`,
    });
    const bodies: string[] = [];
    await page.route('**/api/projects/*/commands', async (route) => {
      bodies.push(route.request().postData()!);
      if (bodies.length === 1) {
        await route.fetch();
        await route.abort('failed');
      } else await route.continue();
    });
    await quick.getByLabel('Новая задача').press('Enter');
    await expect(quick.getByLabel('Новая задача')).toHaveValue('Явно сегодня');
    await expect(quick.getByLabel('Новая задача')).toBeDisabled();
    await page.getByRole('button', { name: 'Повторить', exact: true }).click();
    await expect(quick.getByLabel('Новая задача')).toHaveValue('');
    expect(bodies).toHaveLength(2);
    expect(bodies[1]).toBe(bodies[0]);
    await page.unroute('**/api/projects/*/commands');
    const saved = await readTree(page, runtime.origin, tree.project.id);
    expect(saved.project.revision).toBe(before.project.revision + 1);
    expect(
      saved.tasks.filter((task) => task.title === 'Явно сегодня'),
    ).toHaveLength(1);
    expect(
      saved.tasks.find((task) => task.title === 'Явно сегодня'),
    ).toMatchObject({
      inputStart: '2026-10-09',
      inputFinish: '2026-10-09',
      durationDays: 1,
    });
    await quick.getByRole('button', { name: 'Сроки новой задачи' }).click();
    await expect(quick.getByLabel('Начало', { exact: true })).toHaveValue('');
    await page
      .getByRole('button', { name: 'Отменить последнее изменение' })
      .click();
    await expect(
      page.getByRole('treeitem', { name: /^Явно сегодня,/ }),
    ).toHaveCount(0);
    await runtime.restart();
    await page.reload();
    expect(
      (await readTree(page, runtime.origin, tree.project.id)).tasks,
    ).toEqual(before.tasks);
  } finally {
    await runtime.close();
  }
});
