import { test as base, expect, type Page } from '@playwright/test';
import Database from 'better-sqlite3';
import { syntheticRuntime } from '../../scripts/e2e-server.js';
import {
  readTree,
  seedOptionalRuntime,
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

async function seed(
  page: Page,
  runtime: Awaited<ReturnType<typeof syntheticRuntime>>,
) {
  let tree = await seedOptionalRuntime(page, runtime);
  const root = tree.tasks.find((task) => task.title === 'Этап P')!.id;
  const a = tree.tasks.find((task) => task.title === 'Работа A')!.id;
  const b = tree.tasks.find((task) => task.title === 'Работа C')!.id;
  tree = await send(page, runtime.origin, tree, {
    type: 'task.create',
    title: 'Группа',
    parentId: root,
  });
  const group = tree.tasks.find((task) => task.title === 'Группа')!.id;
  tree = await send(page, runtime.origin, tree, {
    type: 'task.move',
    taskId: group,
    parentId: root,
    position: 0,
  });
  tree = await send(page, runtime.origin, tree, {
    type: 'task.move',
    taskId: a,
    parentId: group,
    position: 0,
  });
  tree = await send(page, runtime.origin, tree, {
    type: 'task.edit',
    taskId: a,
    changes: { title: 'Монтаж A', status: 'doing' },
  });
  tree = await send(page, runtime.origin, tree, {
    type: 'task.edit',
    taskId: b,
    changes: {
      title: 'Монтаж B',
      inputStart: '2026-10-07',
      inputFinish: '2026-10-09',
    },
  });
  tree = await send(page, runtime.origin, tree, {
    type: 'dependency.create',
    predecessorId: a,
    successorId: b,
  });
  tree = await send(page, runtime.origin, tree, {
    type: 'task.create',
    title: 'Готовая работа',
    parentId: null,
  });
  const done = tree.tasks.find((task) => task.title === 'Готовая работа')!.id;
  tree = await send(page, runtime.origin, tree, {
    type: 'task.edit',
    taskId: done,
    changes: {
      status: 'done',
      inputStart: '2026-10-05',
      inputFinish: '2026-10-05',
    },
  });
  expect(tree.schedule.analysisStatus).toBe('ready');
  expect(tree.schedule.criticalTaskIds).toEqual([a, b].sort());
  await page.goto(runtime.origin);
  await expect(
    page.getByRole('heading', { name: 'Демо-проект', exact: true }),
  ).toBeVisible();
  return { tree, root, group, a, b, done };
}
function taskTree(page: Page) {
  return page.getByRole('tree', { name: 'Задачи', exact: true });
}
async function rowIds(page: Page) {
  return taskTree(page)
    .getByRole('treeitem')
    .evaluateAll((nodes) =>
      nodes.map((node) => node.getAttribute('data-task-id')),
    );
}
async function chooseStatus(page: Page, value: string) {
  const opener = page.getByRole('button', { name: /^Фильтры/ });
  if ((await opener.getAttribute('aria-expanded')) !== 'true')
    await opener.click();
  const all = page.getByRole('checkbox', { name: 'Все статусы', exact: true });
  if (value === 'all') await all.check();
  else {
    await all.check();
    await all.uncheck();
    const labels: Record<string, string> = {
      todo: 'К выполнению',
      doing: 'В работе',
      done: 'Готово',
    };
    await page
      .getByRole('checkbox', { name: labels[value]!, exact: true })
      .check();
  }
  await page.getByRole('button', { name: /^Применить/ }).click();
}
function counts(path: string, projectId: string) {
  const db = new Database(path, { readonly: true });
  try {
    return {
      operations: db
        .prepare('SELECT COUNT(*) AS n FROM operations WHERE projectId=?')
        .get(projectId),
      undo: db
        .prepare('SELECT COUNT(*) AS n FROM undo_snapshots WHERE projectId=?')
        .get(projectId),
    };
  } finally {
    db.close();
  }
}

test('multiple status draft applies atomically, overlays Gantt and keeps the server snapshot', async ({
  page,
  runtime,
}, info) => {
  const { tree, root, group, a, b, done } = await seed(page, runtime);
  const mutations: string[] = [];
  page.on('request', (request) => {
    if (!['GET', 'HEAD'].includes(request.method()))
      mutations.push(request.method());
  });
  const header = page.locator('.workspace-header');
  const toolbar = page.locator('.gantt-toolbar');
  const beforeHeader = (await header.boundingBox())!;
  const beforeToolbar = (await toolbar.boundingBox())!;
  const opener = page.getByRole('button', { name: /^Фильтры/ });
  await opener.click();
  const all = page.getByRole('checkbox', { name: 'Все статусы', exact: true });
  await expect(all).toBeFocused();
  await page
    .getByRole('checkbox', { name: 'К выполнению', exact: true })
    .uncheck();
  expect(await rowIds(page)).toEqual([root, group, a, b, done]);
  await expect(opener).toHaveAccessibleName('Фильтры');
  await page
    .getByRole('button', { name: 'Применить (2)', exact: true })
    .click();
  expect(await rowIds(page)).toEqual([root, group, a, done]);
  await expect(opener).toHaveAccessibleName('Фильтры · 2');
  await expect(opener).toBeFocused();
  await opener.click();
  const popover = page.locator('.task-filter-popover');
  const popoverBox = (await popover.boundingBox())!;
  const openerBox = (await opener.boundingBox())!;
  expect(
    Math.abs(popoverBox.x + popoverBox.width - openerBox.x - openerBox.width),
  ).toBeLessThanOrEqual(1);
  expect(popoverBox.y).toBeGreaterThanOrEqual(openerBox.y + openerBox.height);
  expect(popoverBox.x).toBeGreaterThanOrEqual(0);
  expect(popoverBox.x + popoverBox.width).toBeLessThanOrEqual(
    page.viewportSize()!.width,
  );
  expect((await header.boundingBox())!.height).toBe(beforeHeader.height);
  expect((await toolbar.boundingBox())!.y).toBe(beforeToolbar.y);
  await page.screenshot({
    path: `/tmp/leaf-multi-status-${info.project.name}.png`,
  });
  await page.getByRole('checkbox', { name: 'Готово', exact: true }).uncheck();
  await all.press('Escape');
  await expect(opener).toBeFocused();
  await opener.click();
  await expect(
    page.getByRole('checkbox', { name: 'Готово', exact: true }),
  ).toBeChecked();
  await page
    .getByRole('button', { name: 'Сбросить поиск и фильтры', exact: true })
    .click();
  await expect(page.getByRole('searchbox')).toBeFocused();
  await expect(opener).toHaveAccessibleName('Фильтры');
  await opener.click();
  await all.uncheck();
  await page
    .getByRole('button', { name: 'Применить (0)', exact: true })
    .click();
  await expect(taskTree(page).getByRole('treeitem')).toHaveCount(0);
  await expect(
    page.getByText('Ничего не найдено. Измените поиск или статус.'),
  ).toBeVisible();
  expect(mutations).toEqual([]);
  expect(await readTree(page, runtime.origin, tree.project.id)).toEqual(tree);
});

test('search and status reveal parent context, share Gantt rows and leave the real plan untouched', async ({
  page,
  runtime,
}, info) => {
  const { tree, root, group, a, b, done } = await seed(page, runtime);
  const beforeCounts = counts(runtime.databasePath, tree.project.id);
  const mutations: string[] = [];
  page.on('request', (request) => {
    if (!['GET', 'HEAD'].includes(request.method()))
      mutations.push(request.method());
  });
  await page
    .getByRole('button', { name: 'Свернуть Этап P', exact: true })
    .click();
  expect(await rowIds(page)).toEqual([root, done]);
  const search = page.getByRole('searchbox', {
    name: 'Поиск задач',
    exact: true,
  });
  await search.fill(' МОНТАЖ ');
  expect(await rowIds(page)).toEqual([root, group, a, b]);
  await chooseStatus(page, 'doing');
  expect(await rowIds(page)).toEqual([root, group, a]);
  expect(
    await page
      .locator('[data-gantt-row]')
      .evaluateAll((nodes) =>
        nodes.map((node) => node.getAttribute('data-gantt-row')),
      ),
  ).toEqual([root, group, a]);
  await expect(
    page.getByText('Найдено задач: 1', { exact: true }),
  ).toBeVisible();
  await expect(
    taskTree(page).getByRole('treeitem', { name: /^Этап P,/ }),
  ).toHaveAttribute('aria-description', 'Родительский контекст');
  await expect(page.locator('.gantt-work.critical')).toHaveCount(1);
  await page.screenshot({
    path: `/tmp/leaf-s4-${info.project.name}-filters.png`,
  });
  for (const scale of ['weeks', 'months', 'days']) {
    await page
      .getByRole('combobox', { name: 'Масштаб Ганта', exact: true })
      .selectOption(scale);
    expect(await rowIds(page)).toEqual([root, group, a]);
  }
  await page
    .getByRole('button', { name: 'Свернуть Группа', exact: true })
    .click();
  expect(await rowIds(page)).toEqual([root, group]);
  await search.fill('Группа');
  await chooseStatus(page, 'all');
  expect(await rowIds(page)).toEqual([root, group]);
  await search.fill('Монтаж A');
  const filters = page.getByRole('button', { name: 'Фильтры', exact: true });
  if ((await filters.getAttribute('aria-expanded')) !== 'true')
    await filters.click();
  expect(await rowIds(page)).toEqual([root, group, a]);
  await page
    .getByRole('button', { name: 'Сбросить поиск и фильтры', exact: true })
    .click();
  await expect(search).toBeFocused();
  expect(await rowIds(page)).toEqual([root, done]);
  await page
    .getByRole('button', { name: 'Раскрыть Этап P', exact: true })
    .click();
  await search.fill('Нет совпадений');
  await expect(
    page.getByText('Ничего не найдено. Измените поиск или статус.'),
  ).toBeVisible();
  await search.press('Escape');
  await expect(search).toHaveValue('');
  await expect(search).toBeFocused();
  await page.screenshot({ path: `/tmp/leaf-s4-${info.project.name}-main.png` });
  expect(await readTree(page, runtime.origin, tree.project.id)).toEqual(tree);
  expect(counts(runtime.databasePath, tree.project.id)).toEqual(beforeCounts);
  expect(mutations).toEqual([]);
});

test('Shift+Tab leaves the popover and pointer toggling still closes it', async ({
  page,
  runtime,
}) => {
  const { tree } = await seed(page, runtime);
  const writes: string[] = [];
  page.on('request', (request) => {
    if (!['GET', 'HEAD'].includes(request.method()))
      writes.push(request.method());
  });
  const filters = page.getByRole('button', { name: 'Фильтры', exact: true });
  await filters.focus();
  await filters.press('Enter');
  const status = page.getByRole('checkbox', {
    name: 'Все статусы',
    exact: true,
  });
  await expect(status).toBeFocused();
  await status.press('Shift+Tab');
  await expect(filters).toBeFocused();
  await expect(filters).toHaveAttribute('aria-expanded', 'false');
  await filters.click();
  await expect(status).toBeFocused();
  await filters.click();
  await expect(filters).toHaveAttribute('aria-expanded', 'false');
  await expect(filters).toBeFocused();
  await filters.click();
  await expect(status).toBeFocused();
  const box = (await filters.boundingBox())!;
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(0, 0);
  await page.mouse.up();
  await expect(filters).toHaveAttribute('aria-expanded', 'true');
  await filters.press('Tab');
  await expect(status).toBeFocused();
  await status.press('Shift+Tab');
  await expect(filters).toBeFocused();
  await expect(filters).toHaveAttribute('aria-expanded', 'false');
  expect(writes).toEqual([]);
  expect(await readTree(page, runtime.origin, tree.project.id)).toEqual(tree);
});

test('keyboard, dirty drafts, Show on Gantt and edit/undo work under a filter', async ({
  page,
  runtime,
}, info) => {
  const { tree, root, group, a, b, done } = await seed(page, runtime);
  const search = page.getByRole('searchbox', {
    name: 'Поиск задач',
    exact: true,
  });
  await search.fill('Монтаж');
  await chooseStatus(page, 'doing');
  const first = taskTree(page).getByRole('treeitem', { name: /^Этап P,/ });
  await first.focus();
  await first.press('ArrowDown');
  await page.keyboard.press('ArrowDown');
  await expect(
    taskTree(page).getByRole('treeitem', { name: /^Монтаж A,/ }),
  ).toBeFocused();
  await page.keyboard.press('Enter');
  await page
    .getByLabel('Описание', { exact: true })
    .fill('Синтетический черновик');
  await search.fill('Готовая');
  await expect(page.getByLabel('Описание', { exact: true })).toHaveValue(
    'Синтетический черновик',
  );
  await expect(taskTree(page).getByRole('treeitem')).toHaveCount(0);
  await search.press('Escape');
  await expect(page.getByLabel('Описание', { exact: true })).toHaveValue(
    'Синтетический черновик',
  );
  await page
    .getByRole('button', { name: 'Отбросить изменения', exact: true })
    .click();
  await page.getByRole('tab', { name: 'Зависимости', exact: true }).click();
  await search.fill('Готовая');
  await page
    .getByRole('button', { name: 'Показать на Ганте', exact: true })
    .click();
  await expect(search).toHaveValue('');
  await expect(page.getByRole('button', { name: 'Фильтры' })).toHaveAttribute(
    'aria-expanded',
    'false',
  );
  expect(await rowIds(page)).toEqual([root, group, a, b, done]);
  await page.screenshot({
    path: `/tmp/leaf-s4-${info.project.name}-panel.png`,
  });
  await page.getByRole('tab', { name: 'Детали', exact: true }).click();
  await search.fill('Монтаж A');
  await page.getByLabel('Статус', { exact: true }).selectOption('todo');
  const saved = page.waitForResponse(
    (response) =>
      response.url().endsWith('/commands') &&
      response.request().method() === 'POST',
  );
  await page.getByRole('button', { name: 'Сохранить', exact: true }).click();
  expect((await saved).status()).toBe(200);
  await expect(page.getByText('Сохранено', { exact: true })).toBeVisible();
  const after = await readTree(page, runtime.origin, tree.project.id);
  expect(after.project.revision).toBe(tree.project.revision + 1);
  expect(after.tasks.find((task) => task.id === a)!.status).toBe('todo');
  expect(after.dependencies).toEqual(tree.dependencies);
  expect(after.schedule).toEqual(tree.schedule);
  await page.keyboard.press('Escape');
  const undone = page.waitForResponse(
    (response) =>
      response.url().endsWith('/commands') &&
      response.request().method() === 'POST',
  );
  await page
    .getByRole('button', { name: 'Отменить последнее изменение', exact: true })
    .click();
  expect((await undone).status()).toBe(200);
  const restored = await readTree(page, runtime.origin, tree.project.id);
  expect(restored.tasks).toEqual(tree.tasks);
  expect(restored.dependencies).toEqual(tree.dependencies);
  expect(restored.schedule).toEqual(tree.schedule);
});
