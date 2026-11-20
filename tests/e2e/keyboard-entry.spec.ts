import { test, expect } from '@playwright/test';
import { syntheticRuntime } from '../../scripts/e2e-server.js';
import { readTree, seedOptionalRuntime } from '../helpers/optional-e2e.js';

test('keyboard entry keeps context, defaults, hints and compact geometry', async ({
  page,
}, info) => {
  const runtime = await syntheticRuntime();
  try {
    const before = await seedOptionalRuntime(page, runtime);
    await page.goto(runtime.origin);
    const input = page.locator('#quick-task');
    const plus = page.locator('.inline-quick-add .quick-focus');
    await plus.click();
    await expect(input).toBeFocused();
    await plus.focus();
    await plus.press('Space');
    await expect(input).toBeFocused();
    const box = await plus.boundingBox();
    expect(box!.width).toBeGreaterThanOrEqual(28);
    expect(box!.height).toBeGreaterThanOrEqual(28);
    const row = page.getByRole('treeitem', { name: /^Этап P,/ });
    const initialY = (await row.boundingBox())!.y;
    for (const width of [266, 346]) {
      await page.locator('.timeline-tree').evaluate((node, width) => {
        const element = node as HTMLElement;
        element.style.width = `${width}px`;
        element.style.maxWidth = 'none';
      }, width);
      for (const target of [row, input]) {
        await target.focus();
        const hint = page.locator('.timeline-heading .tree-keyboard-hint');
        await expect(hint).not.toBeEmpty();
        expect(
          await hint.evaluate((n) => n.scrollHeight <= n.clientHeight),
        ).toBe(true);
        const labels = await page
            .locator('.timeline-heading-labels')
            .boundingBox(),
          text = await hint.boundingBox();
        expect(labels!.y + labels!.height).toBeLessThanOrEqual(text!.y);
        for (const label of await page
          .locator('.timeline-heading-labels > span')
          .all())
          expect(
            await label.evaluate(
              (node) => node.scrollHeight <= node.clientHeight,
            ),
          ).toBe(true);
        expect(
          (await page.locator('.timeline-heading').boundingBox())!.height,
        ).toBe(58);
        expect(
          (await page.locator('.gantt-toolbar').boundingBox())!.height,
        ).toBe(44);
        expect((await row.boundingBox())!.height).toBe(38);
        expect((await row.boundingBox())!.y).toBe(initialY);
        if (width === 266)
          await page.screenshot({
            path: `/tmp/leaf-keyboard-${target === row ? 'row' : 'input'}-${info.project.name}.png`,
          });
      }
      if (width === 266)
        await page.screenshot({
          path: `/tmp/leaf-keyboard-hints-${info.project.name}.png`,
        });
      await page
        .locator('.timeline-tree')
        .evaluate((node) => node.removeAttribute('style'));
    }
    let tree = before;
    for (const title of ['Корень один', 'Корень два']) {
      await input.fill(title);
      if (title === 'Корень один') {
        await input.press('Alt+d');
        await page.getByLabel('Начало', { exact: true }).fill('08.10.2026');
        await page.getByLabel('Начало', { exact: true }).press('Tab');
        await page.getByRole('button', { name: 'Готово', exact: true }).click();
        await input.press('Alt+l');
        await page
          .getByRole('searchbox', { name: 'Поиск предшественника' })
          .fill('Работа A');
        await page
          .getByRole('searchbox', { name: 'Поиск предшественника' })
          .press('ArrowDown');
        await page
          .getByRole('searchbox', { name: 'Поиск предшественника' })
          .press('Enter');
        await page
          .getByRole('button', { name: 'Закрыть выбор предшественников' })
          .click();
        const chip = await page
          .getByRole('button', { name: 'Сроки новой задачи', exact: true })
          .textContent();
        await plus.click();
        await expect(input).toHaveValue(title);
        await expect(
          page.getByRole('button', { name: 'Сроки новой задачи', exact: true }),
        ).toHaveText(chip!);
      }
      await input.press('Enter');
      await expect(input).toHaveValue('');
      await expect(input).toBeFocused();
      tree = await readTree(page, runtime.origin, before.project.id);
      expect(tree.tasks.find((t) => t.title === title)).toMatchObject({
        parentId: null,
        inputStart: title === 'Корень один' ? '2026-10-08' : null,
        inputFinish: title === 'Корень один' ? '2026-10-08' : null,
        durationDays: 1,
      });
      if (title === 'Корень один')
        expect(
          tree.dependencies.some(
            (d) =>
              d.successorId === tree.tasks.find((t) => t.title === title)!.id,
          ),
        ).toBe(true);
      else
        expect(
          tree.dependencies.filter(
            (d) =>
              d.successorId === tree.tasks.find((t) => t.title === title)!.id,
          ),
        ).toEqual([]);
    }
    const roots = tree.tasks
      .filter((t) => t.title.startsWith('Корень'))
      .sort((a, b) => a.sortOrder - b.sortOrder);
    expect(roots.map((t) => t.title)).toEqual(['Корень один', 'Корень два']);
    await row.focus();
    await row.press('Shift+Enter');
    for (const title of ['Ребёнок один', 'Ребёнок два']) {
      await input.fill(title);
      await plus.click();
      await expect(input).toHaveValue(title);
      await input.press('Enter');
      await expect(input).toHaveValue('');
      await expect(input).toBeFocused();
    }
    tree = await readTree(page, runtime.origin, before.project.id);
    const children = tree.tasks
      .filter((t) => t.title.startsWith('Ребёнок'))
      .sort((a, b) => a.sortOrder - b.sortOrder);
    expect(children.map((t) => t.title)).toEqual([
      'Ребёнок один',
      'Ребёнок два',
    ]);
    for (const child of children)
      expect(child).toMatchObject({
        parentId: before.tasks[0]!.id,
        inputStart: null,
        inputFinish: null,
        durationDays: 1,
      });
    await input.fill('Исправленная');
    await input.press('Alt+d');
    await expect(
      page.locator('.timeline-heading .tree-keyboard-hint'),
    ).toBeEmpty();
    expect((await row.boundingBox())!.y).toBe(initialY);
    expect(
      (await page.locator('.timeline-heading').boundingBox())!.height,
    ).toBe(58);
    const duration = page.getByLabel('Длительность, рабочих дней', {
      exact: true,
    });
    await duration.fill('1e');
    await duration.press('Enter');
    await page.getByRole('button', { name: 'Готово', exact: true }).click();
    await input.press('Enter');
    expect(
      (await readTree(page, runtime.origin, before.project.id)).tasks,
    ).toHaveLength(before.tasks.length + 4);
    await page
      .getByRole('button', { name: 'Сроки новой задачи', exact: true })
      .click();
    await duration.fill('1');
    await duration.press('Enter');
    await page.getByRole('button', { name: 'Готово', exact: true }).click();
    await input.press('Enter');
    await expect(input).toHaveValue('');
    await expect(input).toBeFocused();
    await input.fill('Составленный текст');
    await input.dispatchEvent('compositionstart');
    expect(
      await input.evaluate((n) =>
        n.dispatchEvent(
          new KeyboardEvent('keydown', {
            key: 'Enter',
            code: 'Enter',
            isComposing: true,
            cancelable: true,
            bubbles: true,
          }),
        ),
      ),
    ).toBe(false);
    expect(
      (await readTree(page, runtime.origin, before.project.id)).tasks,
    ).toHaveLength(before.tasks.length + 5);
    await input.dispatchEvent('compositionend');
    await input.press('Enter');
    await expect(input).toHaveValue('');
    await expect(input).toBeFocused();
    const count = (await readTree(page, runtime.origin, before.project.id))
      .tasks.length;
    await row.focus();
    await row.press('Enter');
    const panel = page.getByRole('complementary', { name: 'Задача' });
    await expect(panel).toBeVisible();
    expect(
      (await readTree(page, runtime.origin, before.project.id)).tasks,
    ).toHaveLength(count);
    await panel
      .getByRole('button', { name: 'Добавить подзадачу', exact: true })
      .click();
    await panel.getByRole('button', { name: 'Перейти к вводу задачи' }).click();
    await expect(page.locator('#quick-subtask')).toBeFocused();
    await panel.getByRole('button', { name: 'Закрыть панель' }).click();
    for (const name of ['Список', 'Гант']) {
      await page.getByRole('button', { name, exact: true }).click();
      await plus.click();
      await expect(input).toBeFocused();
    }
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
  } finally {
    try {
      await page.context().close();
    } finally {
      await runtime.close();
    }
  }
});
