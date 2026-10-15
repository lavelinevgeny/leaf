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
  runtime: async ({ context }, use) => {
    const runtime = await syntheticRuntime();
    try {
      await use(runtime);
    } finally {
      try {
        await context.close();
      } finally {
        await runtime.close();
      }
    }
  },
});
const panel = (page: Page) =>
  page.getByRole('complementary', { name: 'Задача' });
const main = (page: Page) =>
  page.getByRole('tree', { name: 'Задачи', exact: true });

for (const viewport of [
  { width: 375, height: 400 },
  { width: 720, height: 450 },
  { width: 1440, height: 400 },
])
  test(`a full 288-character title keeps Save reachable at ${viewport.width}x${viewport.height}`, async ({
    page,
    runtime,
  }) => {
    await page.setViewportSize(viewport);
    let tree = await seedOptionalRuntime(page, runtime);
    const taskId = tree.tasks.find((task) => task.title === 'Работа A')!.id;
    const title = 'Длинное название задачи '.repeat(12).trimEnd() + '.';
    expect(title).toHaveLength(288);
    tree = await send(page, runtime.origin, tree, {
      type: 'task.edit',
      taskId,
      changes: { title },
    });
    await page.goto(
      `${runtime.origin}/?project=${tree.project.id}&task=${taskId}&panel=details`,
    );
    const card = panel(page);
    await expect(
      card.getByRole('heading', { name: title, exact: true }),
    ).toHaveText(title);
    const initialOwner = page.locator('[data-panel-scroll-owner]');
    await expect(initialOwner).toHaveCount(1);
    await initialOwner.evaluate((node) => {
      node.scrollTop = 0;
    });
    const fullTitle = card.getByRole('button', {
      name: 'Изменить название',
      exact: true,
    });
    await expect(fullTitle).toBeInViewport({ ratio: 1 });
    expect(
      await fullTitle.evaluate(
        (node) => node.scrollHeight <= node.clientHeight + 1,
      ),
    ).toBe(true);
    await card
      .getByRole('button', { name: 'Изменить название', exact: true })
      .click();
    await expect(
      card.getByLabel('Название задачи', { exact: true }),
    ).toHaveValue(title);
    await card.getByLabel('Статус', { exact: true }).selectOption('doing');
    await card.getByLabel('Название задачи', { exact: true }).press('Enter');
    const save = card.getByRole('button', { name: 'Сохранить', exact: true });
    await expect(save).toBeEnabled();
    await save.click({ timeout: 3000 });
    await expect(card.getByText('Сохранено', { exact: true })).toBeVisible();
    const current = await readTree(page, runtime.origin, tree.project.id);
    expect(current.project.revision).toBe(tree.project.revision + 1);
    expect(current.tasks.find((task) => task.id === taskId)).toMatchObject({
      title,
      status: 'doing',
    });
    const owner = page.locator('[data-panel-scroll-owner]');
    await expect(owner).toHaveCount(1);
    expect(
      await owner.evaluate((node) => node.classList.contains('task-panel')),
    ).toBe(true);
    expect(await owner.evaluate((node) => node.scrollTop)).toBeGreaterThan(0);
    expect(
      await card
        .locator('.panel-content')
        .evaluate((node) => getComputedStyle(node).overflowY),
    ).toBe('visible');
    // The full title remains available; changing editor/viewport must retain focus.
    await card
      .getByRole('button', { name: 'Изменить название', exact: true })
      .click();
    const editor = card.getByLabel('Название задачи', { exact: true });
    await expect(editor).toHaveValue(title);
    await expect(editor).toBeFocused();
    await expect(
      page.locator('.panel-content[data-panel-scroll-owner]'),
    ).toHaveCount(1);
    await page.setViewportSize({ width: viewport.width, height: 200 });
    await expect(
      page.locator('.task-panel[data-panel-scroll-owner]'),
    ).toHaveCount(1);
    await expect(editor).toBeFocused();
    await expect(editor).toBeInViewport({ ratio: 1 });
    await page.setViewportSize({ width: 1440, height: 900 });
    await expect(editor).toBeFocused();
    await expect(
      page.locator('.panel-content[data-panel-scroll-owner]'),
    ).toHaveCount(1);
  });

for (const fixture of [
  { title: 'Этап P', count: 2 },
  { title: 'Работа C', count: 0 },
])
  test(`the old subtasks URL reveals ${fixture.title} with saved description and preserves later focus`, async ({
    page,
    runtime,
  }) => {
    await page.setViewportSize({ width: 375, height: 812 });
    let tree = await seedOptionalRuntime(page, runtime);
    const taskId = tree.tasks.find((task) => task.title === fixture.title)!.id;
    tree = await send(page, runtime.origin, tree, {
      type: 'task.edit',
      taskId,
      changes: {
        description: 'Описание 1\nОписание 2\nОписание 3\nОписание 4',
      },
    });
    let writes = 0;
    page.on('request', (request) => {
      if (!['GET', 'HEAD'].includes(request.method())) writes++;
    });
    await page.goto(
      `${runtime.origin}/?project=${tree.project.id}&task=${taskId}&panel=subtasks`,
    );
    await expect(
      panel(page).getByRole('heading', {
        name: `Подзадачи (${fixture.count})`,
        exact: true,
      }),
    ).toBeInViewport({ ratio: 1 });
    expect(await panel(page).getByRole('tab').allTextContents()).toEqual([
      'Задача',
      'Зависимости',
      'Журнал',
    ]);
    await expect(
      panel(page).getByRole('tab', { name: 'Задача', exact: true }),
    ).toHaveAttribute('aria-selected', 'true');
    await expect(page).toHaveURL(/panel=subtasks/);
    const title = panel(page).getByRole('button', {
      name: 'Изменить название',
      exact: true,
    });
    await title.focus();
    await page.evaluate(
      () =>
        new Promise<void>((done) =>
          requestAnimationFrame(() => requestAnimationFrame(() => done())),
        ),
    );
    await expect(title).toBeFocused();
    expect(writes).toBe(0);
    expect(await readTree(page, runtime.origin, tree.project.id)).toEqual(tree);
  });

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
  await panel(page).getByRole('tab', { name: 'Задача' }).click();
  if (
    await panel(page)
      .getByRole('button', { name: 'Добавить подзадачу', exact: true })
      .count()
  )
    await panel(page)
      .getByRole('button', { name: 'Добавить подзадачу', exact: true })
      .click();
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
  await panel(page).getByRole('tab', { name: 'Задача' }).click();
  if (
    await panel(page)
      .getByRole('button', { name: 'Добавить подзадачу', exact: true })
      .count()
  )
    await panel(page)
      .getByRole('button', { name: 'Добавить подзадачу', exact: true })
      .click();
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
  await panel(page).getByRole('tab', { name: 'Задача' }).click();
  if (
    await panel(page)
      .getByRole('button', { name: 'Добавить подзадачу', exact: true })
      .count()
  )
    await panel(page)
      .getByRole('button', { name: 'Добавить подзадачу', exact: true })
      .click();
  page.once('dialog', (dialog) => dialog.accept());
  await panel(page)
    .getByRole('treeitem', { name: /^Глубокая работа,/ })
    .press('Delete');
  await expect(panel(page).getByText('Подзадач пока нет.')).toBeVisible();
  const input = panel(page).getByLabel('Новая задача', { exact: true });
  await expect(input).toBeFocused();
  await input.fill('Черновик удаляемой группы');
  await panel(page).getByRole('tab', { name: 'Задача' }).click();
  if (
    await panel(page)
      .getByRole('button', { name: 'Добавить подзадачу', exact: true })
      .count()
  )
    await panel(page)
      .getByRole('button', { name: 'Добавить подзадачу', exact: true })
      .click();
  await panel(page)
    .getByRole('button', { name: /Добавить описание|Изменить описание/ })
    .click();
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
  await panel(page).getByRole('tab', { name: 'Задача' }).click();
  if (
    await panel(page)
      .getByRole('button', { name: 'Добавить подзадачу', exact: true })
      .count()
  )
    await panel(page)
      .getByRole('button', { name: 'Добавить подзадачу', exact: true })
      .click();
  await expect(panel(page).getByRole('tree')).toHaveCount(0);
  await expect(input).toHaveValue('Черновик удаляемой группы');
  await expect(input).toBeDisabled();
  expect((await readTree(page, runtime.origin, tree.project.id)).tasks).toEqual(
    tree.tasks,
  );
});
