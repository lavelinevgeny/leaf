import { test, expect } from '@playwright/test';
import { syntheticRuntime } from '../../scripts/e2e-server.js';
import {
  seedOptionalRuntime,
  readTree,
  send,
} from '../helpers/optional-e2e.js';
test('Gantt keyboard move, resize choice cancellation, explicit clearing and undo match persisted source', async ({
  page,
}) => {
  const runtime = await syntheticRuntime();
  try {
    let tree = await seedOptionalRuntime(page, runtime);
    const a = tree.tasks.find((t) => t.title === 'Работа A')!.id;
    tree = await send(page, runtime.origin, tree, {
      type: 'task.edit',
      taskId: a,
      changes: { durationDays: 2 },
    });
    await page.goto(runtime.origin);
    const bar = page.getByRole('button', { name: /Работа A, 2026/ });
    await bar.focus();
    await page.keyboard.press('ArrowRight');
    await expect(bar).toHaveAttribute('aria-label', /2026-10-06 – 2026-10-07/);
    tree = await readTree(page, runtime.origin, tree.project.id);
    expect(tree.tasks.find((t) => t.id === a)).toMatchObject({
      inputStart: '2026-10-06',
      inputFinish: '2026-10-07',
      durationDays: 2,
    });
    await bar.focus();
    await page.keyboard.press('Shift+ArrowRight');
    await expect(
      page.getByRole('dialog', { name: 'Длительность не совпадает' }),
    ).toBeVisible();
    await page.getByRole('button', { name: 'Отмена', exact: true }).click();
    expect(
      (await readTree(page, runtime.origin, tree.project.id)).project.revision,
    ).toBe(tree.project.revision);
    await bar.focus();
    await page.keyboard.press('Shift+ArrowRight');
    await page
      .getByRole('button', { name: 'Очистить длительность', exact: true })
      .click();
    await expect(bar).toHaveAttribute('aria-label', /2026-10-08/);
    expect(
      (await readTree(page, runtime.origin, tree.project.id)).tasks.find(
        (t) => t.id === a,
      )!.durationDays,
    ).toBeNull();
    await page
      .getByRole('button', { name: 'Отменить последнее изменение' })
      .click();
    await expect(bar).toHaveAttribute('aria-label', /2026-10-06 – 2026-10-07/);
    const box = await page.locator(`[data-gantt-bar="${a}"]`).boundingBox();
    expect(box).not.toBeNull();
    await page.mouse.move(box!.x + 10, box!.y + 10);
    await page.mouse.down();
    await page.mouse.move(box!.x + 70, box!.y + 10);
    await page.keyboard.press('Escape');
    await page.mouse.up();
    expect(
      (await readTree(page, runtime.origin, tree.project.id)).tasks.find(
        (t) => t.id === a,
      )!.inputStart,
    ).toBe('2026-10-06');
  } finally {
    await runtime.close();
  }
});
test('project settings preserve dirty calendar draft, done requires return and panel keyboard focus survives close', async ({
  page,
}) => {
  const runtime = await syntheticRuntime();
  try {
    await seedOptionalRuntime(page, runtime);
    await page.goto(runtime.origin);
    await page.getByText('Настройки проекта', { exact: true }).click();
    await page
      .getByLabel('Часовой пояс проекта', { exact: true })
      .fill('Europe/Moscow');
    await page.getByRole('treeitem', { name: /Работа A,/ }).click();
    await expect(
      page.getByRole('complementary', { name: 'Задача', exact: true }),
    ).toHaveCount(0);
    await page
      .getByRole('button', { name: 'Сохранить настройки проекта', exact: true })
      .click();
    await expect(
      page.getByRole('button', {
        name: 'Сохранить настройки проекта',
        exact: true,
      }),
    ).toBeDisabled();
    await page.getByRole('treeitem', { name: /Работа A,/ }).click();
    await page.getByLabel('Статус', { exact: true }).selectOption('done');
    await page.getByRole('button', { name: 'Сохранить', exact: true }).click();
    await expect(page.getByLabel('Начало', { exact: true })).toBeDisabled();
    await page.getByLabel('Статус', { exact: true }).selectOption('doing');
    await expect(page.getByLabel('Начало', { exact: true })).toBeEnabled();
    await page.getByLabel('Начало', { exact: true }).fill('2026-10-06');
    await page.getByRole('button', { name: 'Сохранить', exact: true }).click();
    await expect(page.getByText('Сохранено', { exact: true })).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(
      page.getByRole('treeitem', { name: /Работа A,/ }),
    ).toBeFocused();
    await page.keyboard.press('Enter');
    await expect(
      page.getByRole('complementary', { name: 'Задача', exact: true }),
    ).toBeVisible();
    await page.keyboard.press('Tab');
  } finally {
    await runtime.close();
  }
});
