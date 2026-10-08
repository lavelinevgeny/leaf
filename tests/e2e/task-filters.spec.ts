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
  await page
    .getByRole('combobox', { name: 'Фильтр по статусу', exact: true })
    .selectOption('doing');
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
  await page
    .getByRole('combobox', { name: 'Фильтр по статусу', exact: true })
    .selectOption('all');
  expect(await rowIds(page)).toEqual([root, group]);
  await search.fill('Монтаж A');
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
  await page
    .getByRole('combobox', { name: 'Фильтр по статусу', exact: true })
    .selectOption('doing');
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
  await expect(
    page.getByRole('combobox', { name: 'Фильтр по статусу', exact: true }),
  ).toHaveValue('all');
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
