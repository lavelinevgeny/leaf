import { test as base, expect, type Page } from '@playwright/test';
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
const panel = (page: Page) =>
  page.getByRole('complementary', { name: 'Задача' });
const main = (page: Page) =>
  page.getByRole('tree', { name: 'Задачи', exact: true });
async function seed(
  page: Page,
  runtime: Awaited<ReturnType<typeof syntheticRuntime>>,
) {
  let tree = await seedOptionalRuntime(page, runtime);
  const root = tree.tasks.find((task) => task.title === 'Этап P')!.id;
  let parentId = root;
  for (let i = 1; i <= 4; i++) {
    tree = await send(page, runtime.origin, tree, {
      type: 'task.create',
      title: `Группа ${i}`,
      parentId,
    });
    parentId = tree.tasks.find((task) => task.title === `Группа ${i}`)!.id;
  }
  tree = await send(page, runtime.origin, tree, {
    type: 'task.create',
    title: 'Глубокая работа',
    parentId,
  });
  await page.goto(runtime.origin);
  await expect(
    page.getByRole('heading', { name: 'Демо-проект', exact: true }),
  ).toBeVisible();
  await main(page)
    .getByRole('treeitem', { name: /^Этап P,/ })
    .click();
  await panel(page).getByRole('tab', { name: 'Подзадачи' }).click();
  return { tree, root };
}

test('subtasks keep full depth under a main filter and return focus through nested navigation', async ({
  page,
  runtime,
}, info) => {
  const { tree } = await seed(page, runtime);
  const requests: string[] = [];
  page.on('request', (request) => {
    if (request.method() !== 'GET') requests.push(request.method());
  });
  await page.getByRole('searchbox', { name: 'Поиск задач' }).fill('Этап P');
  await expect(main(page).getByRole('treeitem')).toHaveCount(1);
  const subtree = panel(page).getByRole('tree', { name: 'Подзадачи' });
  await expect(
    subtree.getByRole('treeitem', { name: /^Глубокая работа,/ }),
  ).toHaveAttribute('aria-level', '5');
  await panel(page)
    .getByLabel('Новая задача', { exact: true })
    .fill('Черновик этапа');
  await subtree.getByRole('treeitem', { name: /^Группа 1,/ }).press('Enter');
  await panel(page).getByRole('tab', { name: 'Подзадачи' }).click();
  await panel(page)
    .getByRole('treeitem', { name: /^Группа 2,/ })
    .press('Enter');
  await panel(page).getByRole('button', { name: 'Назад: Группа 1' }).click();
  await expect(
    panel(page).getByRole('treeitem', { name: /^Группа 2,/ }),
  ).toBeFocused();
  await panel(page).getByRole('button', { name: 'Назад: Этап P' }).click();
  await expect(
    subtree.getByRole('treeitem', { name: /^Группа 1,/ }),
  ).toBeFocused();
  await expect(
    panel(page).getByLabel('Новая задача', { exact: true }),
  ).toHaveValue('Черновик этапа');
  await page.screenshot({
    path: info.outputPath(`synthetic-subtasks-${info.project.name}.png`),
  });
  await subtree.getByRole('treeitem', { name: /^Группа 1,/ }).press('Escape');
  await expect(
    main(page).getByRole('treeitem', { name: /^Этап P,/ }),
  ).toBeFocused();
  expect(requests).toHaveLength(0);
  expect(await readTree(page, runtime.origin, tree.project.id)).toEqual(tree);
});

test('scoped keyboard creation preserves main draft, real dates and dependencies, and supports undo', async ({
  page,
  runtime,
}) => {
  let { tree } = await seed(page, runtime);
  const root = tree.tasks.find((task) => task.title === 'Этап P')!.id;
  const moved = panel(page).getByRole('treeitem', { name: /^Группа 4,/ });
  await moved.press('Alt+ArrowLeft');
  await expect(moved).toHaveAttribute('aria-level', '3');
  await expect(moved).toBeFocused();
  tree = await readTree(page, runtime.origin, tree.project.id);
  const mainInput = page.locator('#quick-task');
  await mainInput.fill('Главный черновик');
  const input = panel(page).getByLabel('Новая задача', { exact: true });
  await input.fill('Новая работа');
  await input.press('Shift+Tab');
  await expect(
    panel(page).getByText('Родитель: Этап P', { exact: true }),
  ).toBeVisible();
  const row = panel(page).getByRole('treeitem', { name: /^Группа 4,/ });
  await row.press('Shift+Insert');
  await expect(input).toBeFocused();
  await expect(
    panel(page).getByText('Родитель: Группа 4', { exact: true }),
  ).toBeVisible();
  await input.press('Enter');
  await expect(input).toHaveValue('');
  await expect(input).toBeFocused();
  await expect(mainInput).toHaveValue('Главный черновик');
  await expect(
    panel(page).getByRole('heading', { name: 'Этап P' }),
  ).toBeVisible();
  const added = await readTree(page, runtime.origin, tree.project.id);
  const created = added.tasks.find((task) => task.title === 'Новая работа')!;
  expect(created.parentId).toBe(
    tree.tasks.find((task) => task.title === 'Группа 4')!.id,
  );
  expect(added.tasks.filter((task) => task.id !== created.id)).toEqual(
    tree.tasks,
  );
  expect(added.dependencies).toEqual(tree.dependencies);
  expect(created.inputStart).toBeNull();
  expect(created.inputFinish).toBeNull();
  expect(created.durationDays).toBe(1);
  expect(added.project.revision).toBe(tree.project.revision + 1);
  // The compact panel overlays the right side of the toolbar. Undo remains
  // available from the task tree with the application's keyboard command.
  await panel(page)
    .getByRole('treeitem', { name: /^Новая работа,/ })
    .focus();
  await page.keyboard.press('Control+z');
  await expect(
    panel(page).getByRole('treeitem', { name: /^Новая работа,/ }),
  ).toHaveCount(0);
  const undone = await readTree(page, runtime.origin, tree.project.id);
  expect(undone.tasks).toEqual(tree.tasks);
  expect(undone.schedule).toEqual(tree.schedule);
  expect(undone.dependencies).toEqual(tree.dependencies);
  expect(undone.tasks.find((task) => task.id === root)?.parentId).toBeNull();
});

test('lost subtask response keeps the draft and exact retry creates only one task', async ({
  page,
  runtime,
}) => {
  const { tree, root } = await seed(page, runtime);
  const input = panel(page).getByLabel('Новая задача', { exact: true });
  await page.route(
    '**/commands',
    async (route) => {
      await route.abort();
    },
    { times: 1 },
  );
  const envelopes: string[] = [];
  page.on('request', (request) => {
    if (request.url().endsWith('/commands'))
      envelopes.push(request.postData()!);
  });
  await input.fill('Работа после повтора');
  await input.press('Enter');
  await expect(panel(page).getByRole('alert')).toContainText(
    'Нет связи с сервером',
  );
  await expect(input).toHaveValue('Работа после повтора');
  await expect(input).toBeDisabled();
  await panel(page)
    .getByRole('button', { name: 'Повторить', exact: true })
    .click();
  await expect(input).toHaveValue('');
  expect(envelopes).toHaveLength(2);
  expect(envelopes[0] === envelopes[1]).toBe(true);
  const next = await readTree(page, runtime.origin, tree.project.id);
  expect(
    next.tasks
      .filter((task) => task.title === 'Работа после повтора')
      .map((task) => task.parentId),
  ).toEqual([root]);
  expect(next.project.revision).toBe(tree.project.revision + 1);
});

test('last-row deletion focuses scoped input and a removed selected task keeps drafts without rendering a stale tree', async ({
  page,
  runtime,
}) => {
  let { tree } = await seed(page, runtime);
  await panel(page)
    .getByRole('treeitem', { name: /^Группа 4,/ })
    .press('Enter');
  await panel(page).getByRole('tab', { name: 'Подзадачи' }).click();
  page.once('dialog', (dialog) => dialog.accept());
  await panel(page)
    .getByRole('treeitem', { name: /^Глубокая работа,/ })
    .press('Delete');
  await expect(panel(page).getByText('Подзадач пока нет.')).toBeVisible();
  const input = panel(page).getByLabel('Новая задача', { exact: true });
  await expect(input).toBeFocused();
  await input.fill('Черновик удаляемой группы');
  await panel(page).getByRole('tab', { name: 'Детали' }).click();
  await panel(page)
    .getByLabel('Описание', { exact: true })
    .fill('Черновик деталей');
  tree = await readTree(page, runtime.origin, tree.project.id);
  tree = await send(page, runtime.origin, tree, {
    type: 'task.delete',
    taskId: tree.tasks.find((task) => task.title === 'Группа 4')!.id,
  });
  await panel(page)
    .getByRole('button', { name: 'Сохранить', exact: true })
    .click();
  await panel(page)
    .getByRole('button', { name: 'Загрузить актуальный проект' })
    .click();
  await expect(panel(page).getByText(/Выбранная задача удалена/)).toBeVisible();
  await expect(panel(page).getByLabel('Описание', { exact: true })).toHaveValue(
    'Черновик деталей',
  );
  await panel(page).getByRole('tab', { name: 'Подзадачи' }).click();
  await expect(panel(page).getByRole('tree')).toHaveCount(0);
  await expect(input).toHaveValue('Черновик удаляемой группы');
  await expect(input).toBeDisabled();
  expect((await readTree(page, runtime.origin, tree.project.id)).tasks).toEqual(
    tree.tasks,
  );
});
