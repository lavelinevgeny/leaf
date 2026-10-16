import { test, expect } from '../helpers/journal-e2e.js';
import {
  seedOptionalRuntime,
  send,
  readTree,
} from '../helpers/optional-e2e.js';
import { openTaskDates } from '../helpers/task-panel.js';
import type { Page, TestInfo } from '@playwright/test';

async function shot(page: Page, info: TestInfo, name: string) {
  const path = info.outputPath(`${name}.png`);
  await page.screenshot({ path });
  console.log(`Card screenshot: ${path}`);
}
const card = (page: Page) =>
  page.getByRole('complementary', { name: 'Задача', exact: true });

test('journal uses the task heading to rename without an extra row', async ({
  page,
  runtime,
}) => {
  const tree = await seedOptionalRuntime(page, runtime);
  const task = tree.tasks.find((item) => item.title === 'Работа C')!;
  await page.goto(runtime.origin);
  await page
    .getByRole('tree', { name: 'Задачи', exact: true })
    .locator(`[data-task-id="${task.id}"]`)
    .click();
  const panel = card(page);
  const header = panel.locator('.panel-header');
  const initialHeight = (await header.boundingBox())!.height;
  await panel.getByRole('tab', { name: 'Журнал', exact: true }).click();
  const heading = header.getByRole('heading', {
    name: task.title,
    exact: true,
  });
  await expect(heading).toBeVisible();
  const trigger = heading.getByRole('button', { name: 'Изменить название' });
  await expect(trigger).toHaveText(task.title);
  await expect(
    header.getByText('Изменить название', { exact: true }),
  ).toHaveCount(0);
  expect((await header.boundingBox())!.height).toBe(initialHeight);
  await trigger.focus();
  await page.keyboard.press('Enter');
  const editor = header.getByRole('textbox', { name: 'Название задачи' });
  await expect(editor).toBeFocused();
  await editor.fill('Несохранённое название');
  await page.keyboard.press('Escape');
  await expect(trigger).toBeFocused();
  await expect(trigger).toHaveText(task.title);
  await expect(editor).toHaveCount(0);
  expect((await header.boundingBox())!.height).toBe(initialHeight);
  expect(
    (await readTree(page, runtime.origin, tree.project.id)).project.revision,
  ).toBe(tree.project.revision);
});

test('compact card independently saves status, dates and description with cancel and failed-save recovery', async ({
  page,
  runtime,
}, info) => {
  let tree = await seedOptionalRuntime(page, runtime);
  const task = tree.tasks.find((t) => t.title === 'Работа C')!;
  tree = await send(page, runtime.origin, tree, {
    type: 'task.edit',
    taskId: task.id,
    changes: {
      description: 'Синтетическое описание\nВторая строка\nТретья строка',
    },
  });
  await page.goto(runtime.origin);
  await page
    .getByRole('tree', { name: 'Задачи', exact: true })
    .locator(`[data-task-id="${task.id}"]`)
    .click();
  const panel = card(page);
  await expect(
    panel.getByRole('button', { name: 'Показать ещё', exact: true }),
  ).toHaveCount(0);
  await expect(panel.locator('.panel-footer')).toBeHidden();
  const status = panel.getByRole('button', { name: /^Статус:/ });
  const dates = panel.getByRole('button', { name: /^Сроки задачи:/ });
  expect((await status.boundingBox())!.y).toBe((await dates.boundingBox())!.y);
  await shot(page, info, '01-compact');
  await status.click();
  await shot(page, info, '02-status-menu');
  await page.keyboard.press('Escape');
  expect(
    (await readTree(page, runtime.origin, tree.project.id)).project.revision,
  ).toBe(tree.project.revision);
  await status.click();
  await page.getByRole('menuitem', { name: 'В работе', exact: true }).click();
  await expect(status).toHaveAccessibleName('Статус: В работе');
  await openTaskDates(page);
  const dialog = page.getByRole('dialog', {
    name: 'Сроки задачи',
    exact: true,
  });
  await dialog.getByLabel('Начало', { exact: true }).fill('09.10.2026');
  await dialog
    .getByLabel('Длительность, рабочих дней', { exact: true })
    .fill('1');
  await dialog
    .getByLabel('Длительность, рабочих дней', { exact: true })
    .press('Tab');
  await shot(page, info, '03-dates');
  await dialog.getByRole('button', { name: 'Отмена', exact: true }).click();
  await openTaskDates(page);
  await expect(dialog.getByLabel('Начало', { exact: true })).toHaveValue('');
  await dialog.getByLabel('Начало', { exact: true }).fill('09.10.2026');
  await dialog
    .getByLabel('Длительность, рабочих дней', { exact: true })
    .fill('1');
  await dialog.getByRole('button', { name: 'Готово', exact: true }).click();
  await expect(dialog).toBeHidden();
  let saved = await readTree(page, runtime.origin, tree.project.id);
  expect(saved.tasks.find((t) => t.id === task.id)).toMatchObject({
    inputStart: '2026-10-09',
    inputFinish: '2026-10-09',
    durationDays: 1,
  });
  await panel
    .getByRole('button', { name: 'Изменить описание', exact: true })
    .click();
  const editor = panel.getByRole('textbox', { name: 'Описание', exact: true });
  await editor.fill('Отменённый текст');
  await editor.press('Escape');
  await expect(editor).toHaveCount(0);
  await expect(
    panel.getByText('Синтетическое описание', { exact: false }),
  ).toBeVisible();
  await panel
    .getByRole('button', { name: 'Изменить описание', exact: true })
    .click();
  await editor.fill('  Первая строка\n\nСинтетический сохранённый текст  ');
  await shot(page, info, '04-description-editor');
  await page.route('**/commands', (route) =>
    route.fulfill({
      status: 400,
      contentType: 'application/json',
      body: JSON.stringify({
        code: 'INVALID_COMMAND',
        message: 'Синтетический отказ сохранения.',
      }),
    }),
  );
  await editor.press('Control+Enter');
  await expect(
    panel.locator('.panel-description-section').getByRole('alert'),
  ).toBeVisible();
  await expect(editor).toHaveValue(
    '  Первая строка\n\nСинтетический сохранённый текст  ',
  );
  await page.unroute('**/commands');
  await editor.press('Control+Enter');
  await expect(editor).toHaveCount(0);
  saved = await readTree(page, runtime.origin, tree.project.id);
  expect(saved.tasks.find((t) => t.id === task.id)!.description).toBe(
    '  Первая строка\n\nСинтетический сохранённый текст  ',
  );
  await panel.getByRole('tab', { name: 'Зависимости', exact: true }).click();
  await expect(
    panel.getByRole('button', {
      name: 'Добавить предшественника',
      exact: true,
    }),
  ).toBeVisible();
  await panel.getByRole('tab', { name: 'Журнал', exact: true }).click();
  await expect(
    panel.getByText('Записей пока нет', { exact: true }),
  ).toBeVisible();
});

test('description measures four actual lines and reacts to wrapping, mobile width and editing guards', async ({
  page,
  runtime,
}, info) => {
  let tree = await seedOptionalRuntime(page, runtime);
  const task = tree.tasks.find((t) => t.title === 'Работа C')!;
  tree = await send(page, runtime.origin, tree, {
    type: 'task.edit',
    taskId: task.id,
    changes: {
      description:
        'Первая синтетическая строка\nВторая синтетическая строка\nТретья синтетическая строка\nЧетвёртая синтетическая строка\nПятая синтетическая строка',
    },
  });
  await page.goto(runtime.origin);
  await page
    .getByRole('tree', { name: 'Задачи', exact: true })
    .locator(`[data-task-id="${task.id}"]`)
    .click();
  const panel = card(page);
  const more = panel.getByRole('button', { name: 'Показать ещё', exact: true });
  await expect(more).toBeVisible();
  await shot(page, info, '05-long-description');
  await more.click();
  await panel.getByRole('button', { name: 'Свернуть', exact: true }).click();
  await panel
    .getByRole('button', { name: 'Изменить описание', exact: true })
    .click();
  await panel
    .getByRole('textbox', { name: 'Описание', exact: true })
    .fill('Новый текст');
  await panel.getByRole('tab', { name: 'Зависимости', exact: true }).click();
  const leave = page.getByRole('dialog', {
    name: 'Несохранённые изменения задачи',
    exact: true,
  });
  await leave
    .getByRole('button', { name: 'Продолжить редактирование', exact: true })
    .click();
  await expect(
    panel.getByRole('textbox', { name: 'Описание', exact: true }),
  ).toHaveValue('Новый текст');
  await panel.getByRole('tab', { name: 'Зависимости', exact: true }).click();
  await leave
    .getByRole('button', { name: 'Не сохранять', exact: true })
    .click();
  await panel.getByRole('tab', { name: 'Задача', exact: true }).click();
  await panel
    .getByRole('button', { name: 'Изменить описание', exact: true })
    .click();
  await panel.getByRole('textbox', { name: 'Описание', exact: true }).fill('');
  await panel.getByRole('button', { name: 'Сохранить', exact: true }).click();
  await expect(
    panel.getByRole('textbox', { name: 'Описание', exact: true }),
  ).toHaveCount(0);
  await shot(page, info, '06-empty-description');
  await page.setViewportSize({ width: 375, height: 812 });
  await expect(
    panel.getByRole('button', { name: 'Добавить описание', exact: true }),
  ).toBeVisible();
  await openTaskDates(page);
  const dialog = page.getByRole('dialog', {
    name: 'Сроки задачи',
    exact: true,
  });
  const box = (await dialog.boundingBox())!;
  expect(box.x).toBeGreaterThanOrEqual(0);
  expect(box.x + box.width).toBeLessThanOrEqual(375);
  await shot(page, info, '07-mobile-dates');
  await dialog
    .getByRole('button', { name: 'Закрыть сроки', exact: true })
    .click();
  await panel
    .getByRole('button', { name: 'Добавить описание', exact: true })
    .click();
  await panel
    .getByRole('textbox', { name: 'Описание', exact: true })
    .fill('Мобильное синтетическое описание');
  await shot(page, info, '08-mobile-editor');
  const width = await panel.evaluate((node) => ({
    content: node.scrollWidth,
    viewport: node.clientWidth,
  }));
  expect(width.content).toBeLessThanOrEqual(width.viewport);
});

test('description overflow and editor height follow width and font changes without scrolling the workspace', async ({
  page,
  runtime,
}) => {
  let tree = await seedOptionalRuntime(page, runtime);
  const task = tree.tasks.find((t) => t.title === 'Работа C')!;
  tree = await send(page, runtime.origin, tree, {
    type: 'task.edit',
    taskId: task.id,
    changes: { description: 'Проверка переноса строк. '.repeat(7).trim() },
  });
  await page.goto(runtime.origin);
  await page
    .getByRole('tree', { name: 'Задачи', exact: true })
    .locator(`[data-task-id="${task.id}"]`)
    .click();
  const panel = card(page);
  await expect(
    panel.getByRole('button', { name: 'Показать ещё', exact: true }),
  ).toHaveCount(0);
  const scroll = await page.evaluate(() => ({ x: scrollX, y: scrollY }));
  await panel.locator('.panel-description').evaluate((node) => {
    node.style.fontSize = '24px';
  });
  await expect(
    panel.getByRole('button', { name: 'Показать ещё', exact: true }),
  ).toBeVisible();
  await panel
    .getByRole('button', { name: 'Изменить описание', exact: true })
    .click();
  const editor = panel.getByRole('textbox', { name: 'Описание', exact: true });
  await editor.fill(
    'Синтетическое описание с переносом по ширине. '.repeat(14),
  );
  await page.setViewportSize({ width: 375, height: 812 });
  await expect
    .poll(() =>
      editor.evaluate((node) => node.scrollHeight - node.clientHeight),
    )
    .toBeLessThanOrEqual(1);
  expect(await page.evaluate(() => ({ x: scrollX, y: scrollY }))).toEqual(
    scroll,
  );
});

test('lost description response retries the exact command once and closes only after acknowledgement', async ({
  page,
  runtime,
}) => {
  const tree = await seedOptionalRuntime(page, runtime);
  const task = tree.tasks.find((t) => t.title === 'Работа C')!;
  await page.goto(runtime.origin);
  await page
    .getByRole('tree', { name: 'Задачи', exact: true })
    .locator(`[data-task-id="${task.id}"]`)
    .click();
  const panel = card(page);
  await panel
    .getByRole('button', { name: 'Добавить описание', exact: true })
    .click();
  const editor = panel.getByRole('textbox', { name: 'Описание', exact: true });
  await editor.fill('Описание с синтетической потерей ответа');
  const envelopes: unknown[] = [];
  page.on('request', (request) => {
    if (request.url().endsWith('/commands'))
      envelopes.push(request.postDataJSON());
  });
  await page.route('**/commands', async (route) => {
    const response = await route.fetch();
    expect(response.status()).toBe(200);
    await route.abort('failed');
  });
  await panel.getByRole('button', { name: 'Сохранить', exact: true }).click();
  const retry = panel.getByRole('button', {
    name: 'Повторить сохранение',
    exact: true,
  });
  await expect(retry).toBeEnabled();
  await expect(editor).toHaveValue('Описание с синтетической потерей ответа');
  await expect(
    panel.getByRole('button', { name: 'Отмена', exact: true }),
  ).toBeDisabled();
  await page.unroute('**/commands');
  await retry.click();
  await expect(editor).toHaveCount(0);
  const saved = await readTree(page, runtime.origin, tree.project.id);
  expect(saved.project.revision).toBe(tree.project.revision + 1);
  expect(saved.tasks.find((t) => t.id === task.id)!.description).toBe(
    'Описание с синтетической потерей ответа',
  );
  expect(envelopes).toHaveLength(2);
  expect(envelopes[1]).toEqual(envelopes[0]);
});
