import { test, expect } from '@playwright/test';
import { syntheticRuntime } from '../../scripts/e2e-server.js';
import {
  seedOptionalRuntime,
  readTree,
  send,
} from '../helpers/optional-e2e.js';
import { openTaskDates } from '../helpers/task-panel.js';

test('short dates stay local, validate and save; real partial dates are explicit in every tree', async ({
  page,
}) => {
  const runtime = await syntheticRuntime();
  try {
    await page.clock.setFixedTime(new Date('2026-11-06T12:00:00Z'));
    let before = await seedOptionalRuntime(page, runtime);
    const taskId = before.tasks.find((task) => task.title === 'Работа A')!.id;
    const parentId = before.tasks.find((task) => task.title === 'Этап P')!.id;
    before = await send(page, runtime.origin, before, {
      type: 'task.edit',
      taskId,
      changes: { durationDays: 2 },
    });
    await page.goto(runtime.origin);
    await page.getByRole('treeitem', { name: /Работа A,/ }).click();
    await openTaskDates(page);
    const start = page.getByLabel('Начало', { exact: true });
    const finish = page.getByLabel('Окончание', { exact: true });
    await expect(
      page.getByText('Без года — 2026', { exact: true }),
    ).toHaveCount(2);
    await expect(start).toHaveAccessibleDescription(/Без года — 2026/);
    await expect(finish).toHaveAccessibleDescription(/Без года — 2026/);
    await start.fill('9.11');
    await start.press('Tab');
    await expect(start).toHaveValue('09.11.2026');
    await expect(finish).toHaveValue('10.11.2026');
    expect(await readTree(page, runtime.origin, before.project.id)).toEqual(
      before,
    );
    await start.fill('31.2');
    await start.press('Tab');
    await expect(start).toHaveValue('31.2');
    await expect(start).toHaveAttribute('aria-invalid', 'true');
    await expect(
      page.getByRole('button', { name: 'Сохранить', exact: true }),
    ).toBeDisabled();
    expect(await readTree(page, runtime.origin, before.project.id)).toEqual(
      before,
    );
    await start.fill('9.11');
    await start.press('Enter');
    await page.getByRole('button', { name: 'Сохранить', exact: true }).click();
    await expect(page.getByText('Сохранено', { exact: true })).toBeVisible();
    let tree = await readTree(page, runtime.origin, before.project.id);
    expect(tree.project.revision).toBe(before.project.revision + 1);
    expect(tree.tasks.find((task) => task.id === taskId)).toMatchObject({
      inputStart: '2026-11-09',
      inputFinish: '2026-11-10',
      durationDays: 2,
    });
    for (const [title, changes] of [
      [
        'Только начало',
        { inputStart: '2026-11-07', inputFinish: null, durationDays: null },
      ],
      [
        'Только окончание',
        { inputStart: null, inputFinish: '2026-11-07', durationDays: null },
      ],
    ] as const) {
      tree = await send(page, runtime.origin, tree, {
        type: 'task.create',
        title,
        parentId,
      });
      tree = await send(page, runtime.origin, tree, {
        type: 'task.edit',
        taskId: tree.tasks.find((task) => task.title === title)!.id,
        changes,
      });
    }
    await page.reload();
    async function checkLabels() {
      await page.mouse.move(10, 10);
      for (const [title, label] of [
        ['Только начало', 'Начало: 7 нояб.'],
        ['Только окончание', 'Окончание: 7 нояб.'],
      ]) {
        const row = page
          .getByRole('treeitem', { name: new RegExp(title + ',') })
          .last();
        const date = row.locator('.task-date');
        await expect(date).toHaveText(label!);
        await expect(date).toBeVisible();
        await expect(row).toHaveAttribute('aria-label', /2026-11-07/);
        await expect(date).toHaveAttribute('title', /2026-11-07/);
        expect(
          await date.evaluate((el) => el.scrollWidth <= el.clientWidth),
        ).toBe(true);
        const ordinary = page
          .getByRole('treeitem', { name: /Работа C,/ })
          .last();
        expect((await row.boundingBox())!.height).toBe(
          (await ordinary.boundingBox())!.height,
        );
        const bounds = await date.boundingBox();
        expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(
          page.viewportSize()!.width,
        );
      }
    }
    await checkLabels();
    await page.getByRole('button', { name: 'Гант', exact: true }).click();
    await checkLabels();
    await page.getByRole('treeitem', { name: /Этап P,/ }).click();
    await checkLabels();
  } finally {
    try {
      await page.context().close();
    } finally {
      await runtime.close();
    }
  }
});
