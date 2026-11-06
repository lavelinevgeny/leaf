import { test, expect } from '../helpers/journal-e2e.js';
import { seedOptionalRuntime, send } from '../helpers/optional-e2e.js';

test('current rows use the space before the card and keep narrow titles readable', async ({
  page,
  runtime,
}) => {
  let tree = await seedOptionalRuntime(page, runtime);
  const task = tree.tasks.find((item) => item.title === 'Работа A')!;
  tree = await send(page, runtime.origin, tree, {
    type: 'task.edit',
    taskId: task.id,
    changes: { title: 'Подготовить материалы для синтетического проекта' },
  });
  await page.goto(`${runtime.origin}/?project=${tree.project.id}&view=current`);
  const list = page.locator('#project-view-current');
  const row = list.locator(`#current-task-${task.id}`);
  await row.focus();
  await row.press('Enter');
  const panel = page.getByRole('complementary', {
    name: 'Задача',
    exact: true,
  });
  await expect(panel).toBeVisible();

  for (const width of [1000, 900, 1100, 1199, 1200, 1280, 1440]) {
    await page.setViewportSize({ width, height: 900 });
    const listBox = (await list.boundingBox())!;
    const panelBox = (await panel.boundingBox())!;
    const rowBox = (await row.boundingBox())!;
    const text = (await row.locator('.current-task-text').boundingBox())!;
    const date = (await row.locator('.current-date').boundingBox())!;
    // The list fills the available workspace, without reserving the card twice.
    expect(panelBox.x - (listBox.x + listBox.width)).toBeGreaterThanOrEqual(0);
    expect(panelBox.x - (listBox.x + listBox.width)).toBeLessThanOrEqual(24);
    expect(date.x + date.width).toBeLessThanOrEqual(panelBox.x);
    expect(
      await list.evaluate((node) => node.scrollWidth <= node.clientWidth),
    ).toBe(true);
    if (width <= 1280) {
      expect(text.width).toBeGreaterThan(rowBox.width * 0.7);
      expect(date.y).toBeGreaterThanOrEqual(text.y + text.height);
      expect(Math.abs(date.x - text.x)).toBeLessThanOrEqual(1);
    } else {
      expect(date.x).toBeGreaterThanOrEqual(text.x + text.width);
    }
  }

  // The same viewport changes row layout when the projects sidebar collapses.
  await page.setViewportSize({ width: 1280, height: 900 });
  await page
    .getByRole('button', { name: 'Свернуть проекты', exact: true })
    .click();
  const wideText = (await row.locator('.current-task-text').boundingBox())!;
  const wideDate = (await row.locator('.current-date').boundingBox())!;
  expect(wideDate.x).toBeGreaterThanOrEqual(wideText.x + wideText.width);
  for (const name of ['Журнал', 'Задачи', 'Актуальное'])
    await page.getByRole('tab', { name, exact: true }).click();
  await expect(row).toBeVisible();
  await expect(panel).toBeVisible();
  await panel.getByRole('button', { name: 'Закрыть панель' }).focus();
  await page.keyboard.press('Enter');
  await expect(row).toBeFocused();
  await expect(panel).toHaveCount(0);
});

test('current project heading uses the free header width with an open card', async ({
  page,
  runtime,
}) => {
  const tree = await seedOptionalRuntime(page, runtime);
  const task = tree.tasks.find((item) => item.title === 'Работа A')!;
  await page.goto(
    `${runtime.origin}/?project=${tree.project.id}&view=current&task=${task.id}`,
  );
  await expect(page.locator('.task-panel')).toBeVisible();
  for (const width of [1200, 1280, 1440]) {
    await page.setViewportSize({ width, height: 900 });
    const heading = (await page.locator('.workspace-heading').boundingBox())!;
    const title = (await page.locator('.project-title-line').boundingBox())!;
    const undo = (await page
      .getByRole('button', { name: 'Отменить изменение плана' })
      .boundingBox())!;
    expect(title.width).toBeGreaterThan(heading.width * 0.75);
    expect(title.x + title.width).toBeLessThanOrEqual(undo.x);
    expect(undo.x + undo.width).toBeLessThanOrEqual(heading.x + heading.width);
  }
});
