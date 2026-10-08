import { test as base, expect, type Page } from '@playwright/test';
import { randomUUID } from 'node:crypto';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { syntheticRuntime } from '../../scripts/e2e-server.js';
import {
  readTree,
  seedOptionalRuntime,
  send,
} from '../helpers/optional-e2e.js';
const captures = mkdtempSync(join(tmpdir(), 'leaf-c20-captures-'));
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
async function seed(
  page: Page,
  runtime: Awaited<ReturnType<typeof syntheticRuntime>>,
) {
  let tree = await seedOptionalRuntime(page, runtime);
  const renamed = await page.request.patch(
    runtime.origin + '/api/projects/' + tree.project.id,
    {
      headers: { Origin: runtime.origin, 'X-Leaf-Contract-Version': '2' },
      data: {
        contractVersion: 2,
        expectedRevision: tree.project.revision,
        operationId: randomUUID(),
        title:
          'Synthetic compact workspace with a deliberately long project title for browser acceptance',
      },
    },
  );
  expect(renamed.status()).toBe(200);
  tree = await renamed.json();
  for (let n = 0; n < 24; n++)
    tree = await send(page, runtime.origin, tree, {
      type: 'task.create',
      title: `Synthetic row ${n}`,
      parentId: null,
    });
  for (const title of ['Conflict A', 'Conflict B'])
    tree = await send(page, runtime.origin, tree, {
      type: 'task.create',
      title,
      parentId: null,
    });
  const a = tree.tasks.find((t) => t.title === 'Conflict A')!.id;
  const b = tree.tasks.find((t) => t.title === 'Conflict B')!.id;
  for (const id of [a, b])
    tree = await send(page, runtime.origin, tree, {
      type: 'task.edit',
      taskId: id,
      changes: { inputStart: '2026-10-05', inputFinish: '2026-10-06' },
    });
  tree = await send(page, runtime.origin, tree, {
    type: 'dependency.create',
    predecessorId: a,
    successorId: b,
  });
  await page.goto(runtime.origin);
  await expect(
    page.getByRole('heading', { name: tree.project.title, exact: true }),
  ).toBeVisible();
  return { tree, a, b };
}
async function open(page: Page, action = 'Настройки проекта') {
  const opener = page.getByRole('button', {
    name: 'Действия проекта',
    exact: true,
  });
  await expect(
    page
      .getByRole('complementary', { name: 'Проекты', exact: true })
      .getByRole('button', {
        name: 'Действия проекта',
        exact: true,
      }),
  ).toBeVisible();
  const undo = page.locator('.workspace-header').getByRole('button', {
    name: 'Отменить последнее изменение',
    exact: true,
  });
  await expect(undo).toHaveText('↶');
  await expect(undo).toHaveAttribute('title', 'Отменить последнее изменение');
  await expect(page.getByText('Задачи', { exact: true })).toHaveCount(1);
  await opener.focus();
  await page.keyboard.press('Enter');
  const settings = page.getByRole('button', {
    name: 'Настройки проекта',
    exact: true,
  });
  await expect(settings).toBeFocused();
  if (action === 'Переименовать проект') await page.keyboard.press('ArrowDown');
  await expect(
    page.getByRole('button', { name: action, exact: true }),
  ).toBeFocused();
  await page.keyboard.press(action === 'Настройки проекта' ? 'Enter' : 'Space');
  const dialog = page.getByRole('dialog', { name: action, exact: true });
  await expect(
    action === 'Настройки проекта'
      ? dialog.getByLabel('Календарь', { exact: true })
      : dialog.getByLabel('Название проекта', { exact: true }),
  ).toBeFocused();
  return dialog;
}
function reply(page: Page) {
  return page.waitForResponse(
    (r) => r.url().endsWith('/commands') && r.request().method() === 'POST',
  );
}

test('compact geometry, local diagnostics and view actions preserve the authoritative tree', async ({
  page,
  runtime,
}, info) => {
  const { tree, a, b } = await seed(page, runtime);
  const writes: string[] = [];
  page.on('request', (r) => {
    if (!['GET', 'HEAD'].includes(r.method())) writes.push(r.method());
  });
  const rows = page
    .getByRole('tree', { name: 'Задачи', exact: true })
    .getByRole('treeitem');
  const first = (await rows.first().boundingBox())!;
  const tenth = (await rows.nth(9).boundingBox())!;
  const scroll = (await page.locator('[data-plan-scroll]').boundingBox())!;
  const capture = join(captures, info.project.name + '-main.png');
  await page.screenshot({ path: capture });
  console.log(
    'C20 evidence',
    JSON.stringify({ capture, first, tenth, scroll }),
  );
  expect(first.y).toBeLessThanOrEqual(230);
  expect(tenth.y + tenth.height).toBeLessThanOrEqual(scroll.y + scroll.height);
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  await expect(
    page.getByText(/Запланировано|Неполные сроки|Полная пара дат не задана/),
  ).toHaveCount(0);
  for (const id of [a, b])
    await expect(
      page.locator(`[role="treeitem"][data-task-id="${id}"]`),
    ).toHaveAttribute('aria-description', /Предшественник/);
  await expect(
    rows.filter({ hasText: /^Synthetic row 0/ }),
  ).not.toHaveAttribute('aria-description', /Предшественник/);
  const opener = page.getByRole('button', {
    name: 'Действия проекта',
    exact: true,
  });
  await opener.focus();
  await page.keyboard.press('Space');
  await expect(
    page.getByRole('button', { name: 'Настройки проекта', exact: true }),
  ).toBeFocused();
  const sidebar = (await page.locator('.project-sidebar').boundingBox())!;
  const projectItem = (await page
    .locator('.project-item.active')
    .boundingBox())!;
  const menu = (await page.locator('.project-menu').boundingBox())!;
  expect(projectItem.height).toBeLessThanOrEqual(60);
  expect(menu.x).toBeGreaterThanOrEqual(sidebar.x);
  expect(menu.x + menu.width).toBeLessThanOrEqual(sidebar.x + sidebar.width);
  const menuCapture = join(captures, info.project.name + '-menu.png');
  await page.screenshot({ path: menuCapture });
  console.log('C20 menu capture', menuCapture);
  await page.keyboard.press('Escape');
  await expect(opener).toBeFocused();
  const dialog = await open(page);
  expect((await rows.first().boundingBox())!.y).toBe(first.y);
  const calendar = dialog.getByLabel('Календарь', { exact: true });
  const close = dialog.getByRole('button', { name: 'Закрыть', exact: true });
  await close.focus();
  await page.keyboard.press('Tab');
  await expect(calendar).toBeFocused();
  await calendar.focus();
  await page.keyboard.press('Shift+Tab');
  await expect(close).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(opener).toBeFocused();
  const help = page.getByRole('button', { name: 'Помощь Ганта', exact: true });
  await expect(help).toHaveCount(0);
  await expect(page.getByText(/Перенос — обе даты/)).toHaveCount(0);
  await expect(
    page
      .locator('.gantt-toolbar')
      .getByRole('button', { name: 'Гант', exact: true }),
  ).toBeVisible();
  const toggle = page.getByRole('button', { name: 'Гант', exact: true });
  const list = page.getByRole('button', { name: 'Список', exact: true });
  await list.focus();
  await page.keyboard.press('Space');
  await expect(toggle).toHaveAttribute('aria-pressed', 'false');
  await expect(list).toBeFocused();
  await expect(help).toHaveCount(0);
  await expect(page.getByLabel('Масштаб Ганта', { exact: true })).toHaveCount(
    0,
  );
  await toggle.focus();
  await page.keyboard.press('Enter');
  await expect(toggle).toHaveAttribute('aria-pressed', 'true');
  await expect(toggle).toBeFocused();
  const search = page.getByRole('searchbox', {
    name: 'Поиск задач',
    exact: true,
  });
  await expect(
    page.getByRole('button', { name: 'Сбросить поиск и фильтры', exact: true }),
  ).toHaveCount(0);
  await search.fill('Работа');
  const ids = await rows.evaluateAll((ns) =>
    ns.map((n) => n.getAttribute('data-task-id')),
  );
  expect(
    await page
      .locator('[data-gantt-row]')
      .evaluateAll((ns) => ns.map((n) => n.getAttribute('data-gantt-row'))),
  ).toEqual(ids);
  for (let i = 0; i < ids.length; i++) {
    const row = (await rows.nth(i).boundingBox())!;
    const gantt = (await page
      .locator(`[data-gantt-row="${ids[i]}"]`)
      .boundingBox())!;
    expect(Math.abs(row.y - gantt.y)).toBeLessThanOrEqual(2);
  }
  await page.getByRole('button', { name: 'Фильтры' }).click();
  await page
    .getByRole('button', { name: 'Сбросить поиск и фильтры', exact: true })
    .click();
  await expect(search).toBeFocused();
  await page
    .getByRole('button', { name: 'Свернуть Этап P', exact: true })
    .click();
  const collapsedIds = await rows.evaluateAll((ns) =>
    ns.map((n) => n.getAttribute('data-task-id')),
  );
  expect(collapsedIds.length).toBeGreaterThan(0);
  const descendants = tree.tasks.filter(
    (task) =>
      task.parentId ===
      tree.tasks.find((parent) => parent.title === 'Этап P')!.id,
  );
  expect(descendants.length).toBeGreaterThan(0);
  for (const task of descendants) {
    expect(collapsedIds).not.toContain(task.id);
    await expect(page.locator(`[data-gantt-row="${task.id}"]`)).toHaveCount(0);
  }
  expect(
    await page
      .locator('[data-gantt-row]')
      .evaluateAll((ns) => ns.map((n) => n.getAttribute('data-gantt-row'))),
  ).toEqual(collapsedIds);
  for (let i = 0; i < collapsedIds.length; i++) {
    const row = (await rows.nth(i).boundingBox())!;
    const gantt = (await page
      .locator(`[data-gantt-row="${collapsedIds[i]}"]`)
      .boundingBox())!;
    expect(Math.abs(row.y - gantt.y)).toBeLessThanOrEqual(2);
  }
  await search.fill('No synthetic match');
  await expect(
    page.getByText('Ничего не найдено. Измените поиск или статус.'),
  ).toBeVisible();
  await search.press('Escape');
  await page.locator(`[role="treeitem"][data-task-id="${a}"]`).press('Enter');
  await expect(
    page.getByText(/Предшественник заканчивается после явного начала/).first(),
  ).toBeVisible();
  await expect(
    page.getByText(/Полная пара дат не задана|Неполные сроки/),
  ).toHaveCount(0);
  await page.keyboard.press('Escape');
  expect(await readTree(page, runtime.origin, tree.project.id)).toEqual(tree);
  expect(writes).toEqual([]);
  console.log('C20 view mutation count', info.project.name, writes.length);
});

test('settings drafts survive discard, uncertain response, exact retry and real 409 recovery; rename and undo persist', async ({
  page,
  runtime,
}, info) => {
  const { tree } = await seed(page, runtime);
  const writes: string[] = [];
  page.on('request', (request) => {
    if (!['GET', 'HEAD'].includes(request.method()))
      writes.push(request.method());
  });
  const dialog = await open(page);
  const capture = join(captures, info.project.name + '-settings.png');
  await page.screenshot({ path: capture });
  console.log('C20 settings capture', capture);
  const timezone = dialog.getByLabel('Часовой пояс проекта', { exact: true });
  await timezone.fill('Asia/Tokyo');
  await expect(
    dialog.getByRole('button', { name: 'Отбросить изменения', exact: true }),
  ).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(dialog).toBeVisible();
  await expect(timezone).toHaveValue('Asia/Tokyo');
  await dialog
    .getByRole('button', { name: 'Отбросить изменения', exact: true })
    .click();
  await expect(timezone).toHaveValue(tree.project.timezone);
  await timezone.fill('Asia/Tokyo');
  await dialog
    .getByLabel('Календарь', { exact: true })
    .selectOption('all-days');
  let envelope: unknown;
  await page.route(
    '**/api/projects/' + tree.project.id + '/commands',
    async (route) => {
      envelope = route.request().postDataJSON();
      const committed = await route.fetch();
      expect(committed.status()).toBe(200);
      await route.abort('failed');
    },
    { times: 1 },
  );
  await dialog
    .getByRole('button', { name: 'Сохранить настройки проекта', exact: true })
    .click();
  await expect(
    dialog.getByRole('button', { name: 'Повторить', exact: true }),
  ).toBeVisible();
  await expect(timezone).toHaveValue('Asia/Tokyo');
  const committed = await readTree(page, runtime.origin, tree.project.id);
  expect(committed.project.revision).toBe(tree.project.revision + 1);
  expect(committed.project.calendarType).toBe('all-days');
  expect(committed.project.timezone).toBe('Asia/Tokyo');
  const retried = reply(page);
  await dialog.getByRole('button', { name: 'Повторить', exact: true }).click();
  const response = await retried;
  expect(response.status()).toBe(200);
  expect(response.request().postDataJSON()).toEqual(envelope);
  expect(await readTree(page, runtime.origin, tree.project.id)).toEqual(
    committed,
  );
  await timezone.fill('Europe/London');
  const external = await send(page, runtime.origin, committed, {
    type: 'task.edit',
    taskId: committed.tasks[1]!.id,
    changes: { description: 'Synthetic concurrent edit' },
  });
  const conflict = reply(page);
  await dialog
    .getByRole('button', { name: 'Сохранить настройки проекта', exact: true })
    .click();
  expect((await conflict).status()).toBe(409);
  await dialog
    .getByRole('button', { name: 'Загрузить актуальный проект', exact: true })
    .click();
  await expect(timezone).toBeEnabled();
  await expect(timezone).toHaveValue('Europe/London');
  const saved = reply(page);
  await dialog
    .getByRole('button', { name: 'Сохранить настройки проекта', exact: true })
    .click();
  expect((await saved).status()).toBe(200);
  const latest = await readTree(page, runtime.origin, tree.project.id);
  expect(latest.project.revision).toBe(external.project.revision + 1);
  expect(latest.project.timezone).toBe('Europe/London');
  expect(latest.project.calendarType).toBe('all-days');
  expect(latest.tasks).toEqual(external.tasks);
  await page.keyboard.press('Escape');
  const rename = await open(page, 'Переименовать проект');
  await rename
    .getByLabel('Название проекта', { exact: true })
    .fill('Synthetic renamed workspace');
  const renamed = page.waitForResponse((r) => r.request().method() === 'PATCH');
  await rename
    .getByRole('button', { name: 'Переименовать проект', exact: true })
    .click();
  expect((await renamed).status()).toBe(200);
  await expect(rename).toHaveCount(0);
  await page.reload();
  await expect(
    page.getByRole('heading', {
      name: 'Synthetic renamed workspace',
      exact: true,
    }),
  ).toBeVisible();
  const undone = reply(page);
  await page
    .getByRole('button', { name: 'Отменить последнее изменение', exact: true })
    .click();
  expect((await undone).status()).toBe(200);
  const restored = await readTree(page, runtime.origin, tree.project.id);
  expect(restored.project.title).toBe(latest.project.title);
  expect(restored.project.calendarType).toBe('all-days');
  expect(restored.project.timezone).toBe('Europe/London');
  expect(restored.tasks).toEqual(latest.tasks);
  expect(restored.schedule).toEqual(latest.schedule);
  expect(writes).toEqual(['POST', 'POST', 'POST', 'POST', 'PATCH', 'POST']);
  console.log(
    'C20 mutation evidence',
    JSON.stringify({
      viewport: info.project.name,
      viewWrites: 0,
      browserWrites: writes,
      settingsRevisionDelta: latest.project.revision - tree.project.revision,
    }),
  );
  await runtime.restart();
  await page.reload();
  expect(await readTree(page, runtime.origin, tree.project.id)).toEqual(
    restored,
  );
});
