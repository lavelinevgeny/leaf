import { test, expect } from '@playwright/test';
import { syntheticRuntime } from '../../scripts/e2e-server.js';
import {
  readTree,
  seedOptionalRuntime,
  send,
} from '../helpers/optional-e2e.js';

test('inline child draft, schedule presets, keyboard, conditional bars and atomic save/undo', async ({
  page,
}, info) => {
  const runtime = await syntheticRuntime();
  try {
    let tree = await seedOptionalRuntime(page, runtime);
    tree = await send(page, runtime.origin, tree, {
      type: 'task.edit',
      taskId: tree.tasks.find((task) => task.title === 'Работа C')!.id,
      changes: { inputStart: '2026-10-07', inputFinish: '2026-10-09' },
    });
    const before = tree;
    await page.clock.install({ time: new Date('2026-10-08T09:00:00Z') });
    await page.goto(runtime.origin);
    await page.getByRole('button', { name: 'Следующий период' }).click();
    const parent = page.getByRole('treeitem', { name: /^Этап P,/ });
    await parent.focus();
    await parent.press('Shift+Enter');
    const input = page.getByLabel('Новая задача', { exact: true });
    await expect(input).toBeFocused();
    const quick = page.locator('form.inline-quick-add');
    await input.fill('Новая подзадача');
    const draft = page.locator('[data-gantt-bar="quick-add-draft"]');
    await expect(draft).toBeVisible();
    await expect(draft).toHaveAttribute('x', '90');
    expect(
      await draft.evaluate(
        (node) => getComputedStyle(node.parentElement!).strokeDasharray,
      ),
    ).toBe('4px, 3px');
    await input.press('Alt+d');
    const popup = page.getByRole('dialog', { name: 'Сроки задачи' });
    await expect(popup).toBeVisible();
    await popup.getByRole('button', { name: /^Как у родителя/ }).click();
    await expect(popup.getByLabel('Начало', { exact: true })).toHaveValue(
      '05.10.2026',
    );
    await expect(popup.getByLabel('Окончание', { exact: true })).toHaveValue(
      '09.10.2026',
    );
    await popup.getByRole('button', { name: 'Сбросить' }).click();
    await expect(popup.getByLabel('Начало', { exact: true })).toHaveValue('');
    await expect(popup.getByLabel('Длительность, рабочих дней')).toHaveValue(
      '',
    );
    await popup.getByRole('button', { name: 'До пятницы' }).click();
    await expect(popup.getByLabel('Длительность, рабочих дней')).toHaveValue(
      '2',
    );
    await popup.getByLabel('Длительность, рабочих дней').fill('3');
    await popup.getByLabel('Длительность, рабочих дней').press('Tab');
    await expect(popup.getByLabel('Окончание', { exact: true })).toHaveValue(
      '12.10.2026',
    );
    await page.screenshot({
      path: `/tmp/leaf-inline-add-${info.project.name}.png`,
    });
    await popup.getByRole('button', { name: 'Готово', exact: true }).click();
    await expect(popup).toHaveCount(0);
    await expect(
      quick.getByRole('button', { name: 'Сроки новой задачи' }),
    ).toContainText('8–12 окт · 3 р.д.');
    expect(await readTree(page, runtime.origin, tree.project.id)).toEqual(
      before,
    );
    await input.focus();
    await input.press('Tab');
    await expect(input).toBeFocused();
    await input.press('Shift+Tab');
    await expect(input).toBeFocused();
    await input.press('Enter');
    await expect(input).toHaveValue('');
    const saved = await readTree(page, runtime.origin, tree.project.id);
    const child = saved.tasks.find((task) => task.title === 'Новая подзадача')!;
    expect(child).toMatchObject({
      parentId: tree.tasks[0]!.id,
      inputStart: '2026-10-08',
      inputFinish: '2026-10-12',
      durationDays: 3,
    });
    expect(saved.project.revision).toBe(before.project.revision + 1);
    await expect(
      page.locator(`[data-gantt-bar="${child.id}"]`).locator('..'),
    ).not.toHaveClass(/conditional/);
    await page
      .getByRole('button', { name: 'Отменить последнее изменение' })
      .click();
    await expect(
      page.getByRole('treeitem', { name: /^Новая подзадача,/ }),
    ).toHaveCount(0);
    await parent.hover();
    await parent
      .getByRole('button', { name: 'Добавить подзадачу: Этап P' })
      .click();
    await input.fill('Отменённый черновик');
    await quick.getByRole('button', { name: 'Отменить ввод задачи' }).click();
    await expect(parent).toBeFocused();
    await expect(
      page.locator('[data-gantt-bar="quick-add-draft"]'),
    ).toHaveCount(0);
    expect(
      (await readTree(page, runtime.origin, tree.project.id)).tasks,
    ).toEqual(before.tasks);
    await runtime.restart();
    await page.reload();
    expect(
      (await readTree(page, runtime.origin, tree.project.id)).tasks,
    ).toEqual(before.tasks);
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
  } finally {
    await runtime.close();
  }
});
