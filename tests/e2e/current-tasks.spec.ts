import { test, expect } from '../helpers/journal-e2e.js';
import {
  seedOptionalRuntime,
  send,
  readTree,
} from '../helpers/optional-e2e.js';
import type { Page } from '@playwright/test';
import type { ProjectTree } from '../../src/shared/contracts.js';
import { mkdir } from 'node:fs/promises';

const screenshots = '/tmp/leaf-current-screenshots';
async function seed(
  page: Page,
  runtime: Parameters<typeof seedOptionalRuntime>[1],
) {
  await page.clock.setFixedTime(new Date('2026-11-06T12:00:00Z'));
  let tree = await seedOptionalRuntime(page, runtime);
  tree = await send(page, runtime.origin, tree, {
    type: 'project.schedule',
    changes: { calendarType: 'weekdays', timezone: 'UTC' },
  });
  const a = tree.tasks.find((task) => task.title === 'Работа A')!;
  tree = await send(page, runtime.origin, tree, {
    type: 'task.edit',
    taskId: a.id,
    changes: {
      inputStart: null,
      inputFinish: '2026-11-05',
      durationDays: null,
    },
  });
  const c = tree.tasks.find((task) => task.title === 'Работа C')!;
  tree = await send(page, runtime.origin, tree, {
    type: 'task.edit',
    taskId: c.id,
    changes: { inputFinish: '2026-11-06' },
  });
  for (const [title, finish] of [
    ['Скоро начало', '2026-11-09'],
    ['Скоро граница', '2026-11-11'],
    ['Позже', '2026-11-12'],
    ['Без даты', null],
  ] as const)
    tree = await send(page, runtime.origin, tree, {
      type: 'task.create',
      parentId: null,
      title,
      inputFinish: finish,
    });
  return { tree, aId: a.id, cId: c.id };
}
const current = (page: Page) => page.locator('#project-view-current');
const panel = (page: Page) =>
  page.getByRole('complementary', { name: 'Задача', exact: true });
async function open(page: Page, origin: string, tree: ProjectTree) {
  await page.goto(`${origin}/?project=${tree.project.id}&view=current`);
  await expect(
    page.getByRole('tab', { name: 'Актуальное', exact: true }),
  ).toHaveAttribute('aria-selected', 'true');
}

test('five compact groups, complete deep paths, 80 leaves, keyboard and desktop/narrow geometry', async ({
  page,
  runtime,
}, testInfo) => {
  let { tree } = await seed(page, runtime);
  let parentId = tree.tasks.find((task) => task.title === 'Этап P')!.id;
  const ancestors = ['Этап P'];
  for (let i = 1; i <= 4; i++) {
    const title = `Глубокий уровень ${i}`;
    tree = await send(page, runtime.origin, tree, {
      type: 'task.create',
      parentId,
      title,
    });
    parentId = tree.tasks.find((task) => task.title === title)!.id;
    ancestors.push(title);
  }
  const longTitle = 'Полное длинное название синтетической работы '.repeat(5);
  tree = await send(page, runtime.origin, tree, {
    type: 'task.create',
    parentId,
    title: longTitle,
    inputFinish: '2026-11-06',
  });
  for (let i = 1; i <= 80; i++)
    tree = await send(page, runtime.origin, tree, {
      type: 'task.create',
      parentId: null,
      title: `Строка ${i}`,
      inputFinish: '2026-11-06',
    });
  await open(page, runtime.origin, tree);
  await expect(
    current(page).getByRole('button', { name: 'Скоро 2', exact: true }),
  ).toHaveAttribute('aria-expanded', 'true');
  await expect(
    current(page).getByRole('button', { name: 'Позже 1', exact: true }),
  ).toHaveAttribute('aria-expanded', 'false');
  await expect(
    current(page).getByRole('button', { name: 'Без окончания 1', exact: true }),
  ).toHaveAttribute('aria-expanded', 'false');
  await expect(
    current(page).getByRole('button', { name: 'Сегодня 82', exact: true }),
  ).toBeVisible();
  await expect(
    current(page).getByText(ancestors.join(' / '), { exact: true }),
  ).toBeVisible();
  const soonNames = await current(page)
    .locator('#current-region-soon .current-title')
    .allTextContents();
  expect(soonNames).toEqual(['Скоро начало', 'Скоро граница']);
  await expect(
    current(page).getByText('Окончание: 11.11.2026', { exact: true }),
  ).toBeVisible();
  await current(page)
    .getByRole('button', { name: /Строка 80 Корень проекта/ })
    .scrollIntoViewIfNeeded();
  await expect(
    current(page).getByRole('button', { name: /Строка 80 Корень проекта/ }),
  ).toBeInViewport();
  await mkdir(screenshots, { recursive: true });
  await current(page).evaluate((node) => {
    node.scrollTop = node.scrollHeight;
  });
  await page.screenshot({
    path: `${screenshots}/${testInfo.project.name}-list-bottom.png`,
  });
  await page.getByRole('tab', { name: 'Задачи', exact: true }).focus();
  await page.keyboard.press('ArrowRight');
  await expect(
    page.getByRole('tab', { name: 'Актуальное', exact: true }),
  ).toBeFocused();
  await page.keyboard.press('Tab');
  await expect(
    current(page).getByRole('button', { name: 'Просрочено 1', exact: true }),
  ).toBeFocused();
  await page.keyboard.press('Space');
  await expect(
    current(page).getByRole('button', { name: 'Просрочено 1', exact: true }),
  ).toHaveAttribute('aria-expanded', 'false');
  await page.keyboard.press('Enter');
  await page.keyboard.press('Tab');
  await page.keyboard.press('Enter');
  await expect(panel(page)).toBeVisible();
  await panel(page).getByRole('button', { name: 'Закрыть панель' }).focus();
  await page.keyboard.press('Enter');
  await expect(
    current(page).getByRole('button', { name: /Работа A/ }),
  ).toBeFocused();
  await mkdir(screenshots, { recursive: true });
  await page.screenshot({
    path: `${screenshots}/${testInfo.project.name}-list.png`,
  });
  await current(page)
    .getByRole('button', { name: /Работа C/ })
    .click();
  const dateBox = await current(page)
    .getByRole('button', { name: /Работа C/ })
    .locator('.current-date')
    .boundingBox();
  const panelBox = await panel(page).boundingBox();
  expect(dateBox!.x + dateBox!.width).toBeLessThanOrEqual(panelBox!.x);
  await page.screenshot({
    path: `${screenshots}/${testInfo.project.name}-panel.png`,
  });
  await panel(page).getByRole('button', { name: 'Закрыть панель' }).click();
  await page.setViewportSize({ width: 390, height: 844 });
  const longRow = current(page).getByRole('button', {
    name: new RegExp(longTitle.trim()),
  });
  await longRow.focus();
  await expect(longRow).toBeInViewport();
  await expect(longRow.locator('.current-title')).toHaveText(longTitle.trim());
  expect(
    await current(page).evaluate(
      (node) => node.scrollWidth <= node.clientWidth,
    ),
  ).toBe(true);
  const documentWidth = await page.evaluate(() => ({
    scroll: document.documentElement.scrollWidth,
    client: document.documentElement.clientWidth,
  }));
  await page.screenshot({
    path: `${screenshots}/${testInfo.project.name}-narrow-list.png`,
  });
  await longRow.press('Enter');
  await expect(panel(page)).toBeInViewport();
  await panel(page).getByRole('button', { name: 'Закрыть панель' }).focus();
  await expect(
    panel(page).getByRole('button', { name: 'Закрыть панель' }),
  ).toBeInViewport();
  await page.screenshot({
    path: `${screenshots}/${testInfo.project.name}-narrow-panel.png`,
  });
  await page.keyboard.press('Enter');
  await expect(longRow).toBeFocused();
  // Compare inherited narrow header overflow with tasks; the current list must not add any.
  await page.getByRole('tab', { name: 'Задачи', exact: true }).click();
  const tasksWidth = await page.evaluate(
    () => document.documentElement.scrollWidth,
  );
  expect(documentWidth.scroll).toBeLessThanOrEqual(
    Math.max(documentWidth.client, tasksWidth),
  );
});

test('real status ack/Undo, finish move and first child update the list while keeping the panel', async ({
  page,
  runtime,
}) => {
  const { tree, cId } = await seed(page, runtime);
  await open(page, runtime.origin, tree);
  await current(page)
    .getByRole('button', { name: /Работа C/ })
    .click();
  await panel(page)
    .getByRole('button', { name: /^Статус:/ })
    .click();
  await page.getByRole('menuitem', { name: 'Готово', exact: true }).click();
  await expect(
    current(page).getByRole('button', { name: 'Сегодня 0', exact: true }),
  ).toBeVisible();
  await expect(panel(page)).toBeVisible();
  await page.getByRole('button', { name: 'Отменить изменение плана' }).click();
  await expect(
    current(page).getByRole('button', { name: /Работа C/ }),
  ).toBeVisible();
  await expect(
    page.getByRole('button', { name: 'Отменить изменение плана' }),
  ).toBeFocused();
  await panel(page)
    .getByRole('button', { name: /Сроки задачи:/ })
    .click();
  await panel(page).getByLabel('Окончание', { exact: true }).fill('2026-11-12');
  await panel(page).getByLabel('Окончание', { exact: true }).press('Tab');
  await panel(page)
    .getByRole('button', { name: 'Сохранить', exact: true })
    .click();
  await expect(
    current(page).getByRole('button', { name: 'Сегодня 0', exact: true }),
  ).toBeVisible();
  await current(page)
    .getByRole('button', { name: 'Позже 2', exact: true })
    .click();
  await expect(
    current(page).getByRole('button', { name: /Работа C/ }),
  ).toBeVisible();
  let saved = await readTree(page, runtime.origin, tree.project.id);
  expect(saved.tasks.find((task) => task.id === cId)?.inputFinish).toBe(
    '2026-11-12',
  );
  page.on('dialog', (dialog) => dialog.accept());
  saved = await send(page, runtime.origin, saved, {
    type: 'task.create',
    parentId: cId,
    title: 'Первый ребёнок',
    preserveWork: true,
  });
  await page.evaluate(() => window.dispatchEvent(new Event('focus')));
  await expect(current(page).locator(`#current-task-${cId}`)).toHaveCount(0);
  await expect(panel(page)).toBeVisible();
  expect(saved.tasks.some((task) => task.parentId === cId)).toBe(true);
});

test('tree filters/ancestry, mounted dirty draft, protected contexts and explicit Gantt navigation', async ({
  page,
  runtime,
}) => {
  const { tree } = await seed(page, runtime);
  await page.goto(runtime.origin);
  await page
    .getByRole('button', { name: 'Свернуть Этап P', exact: true })
    .click();
  await page.getByRole('button', { name: 'Фильтры', exact: true }).click();
  await page.getByRole('checkbox', { name: /К выполнению/ }).uncheck();
  await page.getByRole('checkbox', { name: /В работе/ }).uncheck();
  await page.getByRole('button', { name: /^Применить/ }).click();
  await page.getByRole('tab', { name: 'Актуальное', exact: true }).click();
  await current(page)
    .getByRole('button', { name: /Работа A/ })
    .click();
  await panel(page).getByRole('button', { name: 'Изменить название' }).click();
  await panel(page)
    .getByLabel('Название задачи', { exact: true })
    .fill('Черновик текущей работы');
  for (const name of ['Журнал', 'Задачи', 'Актуальное'])
    await page
      .getByRole('tablist', { name: 'Представление проекта' })
      .getByRole('tab', { name, exact: true })
      .click();
  await expect(
    panel(page).getByLabel('Название задачи', { exact: true }),
  ).toHaveValue('Черновик текущей работы');
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await current(page)
    .getByRole('button', { name: /Работа C/ })
    .click();
  const leave = page.getByRole('dialog', {
    name: 'Несохранённые изменения задачи',
  });
  await leave
    .getByRole('button', { name: 'Продолжить редактирование' })
    .click();
  await expect(
    panel(page).getByLabel('Название задачи', { exact: true }),
  ).toHaveValue('Черновик текущей работы');
  await current(page)
    .getByRole('button', { name: /Работа C/ })
    .click();
  await leave.getByRole('button', { name: 'Сохранить', exact: true }).click();
  await expect(
    panel(page).getByRole('heading', { name: 'Работа C' }),
  ).toBeVisible();
  await panel(page).getByRole('button', { name: 'Изменить название' }).click();
  await panel(page)
    .getByLabel('Название задачи', { exact: true })
    .fill('Отброшенный черновик');
  await panel(page).getByRole('button', { name: 'Закрыть панель' }).click();
  await leave
    .getByRole('button', { name: 'Не сохранять', exact: true })
    .click();
  await expect(panel(page)).toHaveCount(0);
  await page.getByRole('tab', { name: 'Задачи', exact: true }).click();
  await expect(
    page.getByText('Ничего не найдено. Измените поиск или статус.', {
      exact: true,
    }),
  ).toBeVisible();
  await page.getByRole('tab', { name: 'Актуальное', exact: true }).click();
  await current(page)
    .getByRole('button', { name: /Работа C/ })
    .click();
  await panel(page).getByRole('button', { name: 'Действия задачи' }).click();
  await page.getByRole('menuitem', { name: 'Показать на Ганте' }).click();
  await expect(page.locator('#project-view-tasks')).toBeVisible();
  await expect(
    page.getByRole('treeitem', { name: /Работа C/ }).first(),
  ).toBeVisible();
  await expect(
    page.getByRole('button', { name: 'Свернуть Этап P', exact: true }).first(),
  ).toBeVisible();
  expect(
    (await readTree(page, runtime.origin, tree.project.id)).tasks.find(
      (task) => task.title === 'Отброшенный черновик',
    ),
  ).toBeUndefined();
});

test('direct link/reload/history preserve current context and RAM disclosure/scroll; reload resets defaults', async ({
  page,
  runtime,
}) => {
  const seeded = await seed(page, runtime);
  let tree = seeded.tree;
  const cId = seeded.cId;
  for (let i = 0; i < 35; i++)
    tree = await send(page, runtime.origin, tree, {
      type: 'task.create',
      parentId: null,
      title: `История ${i}`,
      inputFinish: '2026-11-06',
    });
  await open(page, runtime.origin, tree);
  await current(page)
    .getByRole('button', { name: 'Позже 1', exact: true })
    .click();
  await current(page).evaluate((node) => {
    node.scrollTop = 450;
  });
  await expect
    .poll(() => current(page).evaluate((node) => node.scrollTop))
    .toBe(450);
  await page.getByRole('tab', { name: 'Журнал', exact: true }).click();
  await page.goBack();
  await expect(current(page)).toBeVisible();
  await expect(
    current(page).getByRole('button', { name: 'Позже 1', exact: true }),
  ).toHaveAttribute('aria-expanded', 'true');
  await expect
    .poll(() => current(page).evaluate((node) => node.scrollTop))
    .toBe(450);
  await page.goForward();
  await expect(page.locator('#project-view-journal')).toBeVisible();
  await page.goto(
    `${runtime.origin}/?project=${tree.project.id}&view=current&task=${cId}&panel=dependencies`,
  );
  await expect(
    panel(page).getByRole('tab', { name: 'Зависимости', exact: true }),
  ).toHaveAttribute('aria-selected', 'true');
  await page.reload();
  await expect(panel(page)).toBeVisible();
  await expect(
    current(page).getByRole('button', { name: 'Позже 1', exact: true }),
  ).toHaveAttribute('aria-expanded', 'false');
  await panel(page).getByRole('button', { name: 'Закрыть панель' }).click();
  await expect(
    page.getByRole('tab', { name: 'Актуальное', exact: true }),
  ).toBeFocused();
});

test('closing a moved or removed current source reveals the focused row or group after a long section', async ({
  page,
  runtime,
}) => {
  const seeded = await seed(page, runtime);
  let tree = seeded.tree;
  const cId = seeded.cId;
  for (let i = 0; i < 30; i++)
    tree = await send(page, runtime.origin, tree, {
      type: 'task.create',
      parentId: null,
      title: `Работа для прокрутки ${i}`,
      inputFinish: '2026-11-06',
    });
  await open(page, runtime.origin, tree);
  const row = current(page).locator(`#current-task-${cId}`);
  await row.click();
  await panel(page)
    .getByRole('button', { name: /Сроки задачи:/ })
    .click();
  await panel(page).getByLabel('Окончание', { exact: true }).fill('2026-11-11');
  await panel(page).getByLabel('Окончание', { exact: true }).press('Tab');
  await panel(page)
    .getByRole('button', { name: 'Сохранить', exact: true })
    .click();
  await expect(
    current(page).getByRole('button', { name: 'Скоро 3', exact: true }),
  ).toBeAttached();
  await panel(page).getByRole('button', { name: 'Закрыть панель' }).click();
  await expect(row).toBeFocused();
  await expect(row).toBeInViewport();
  await row.press('Enter');
  await panel(page)
    .getByRole('button', { name: /^Статус:/ })
    .click();
  await page.getByRole('menuitem', { name: 'Готово', exact: true }).click();
  await expect(row).toHaveCount(0);
  await current(page).evaluate((node) => {
    node.scrollTop = 0;
  });
  await panel(page).getByRole('button', { name: 'Закрыть панель' }).click();
  const sourceGroup = current(page).getByRole('button', {
    name: 'Скоро 2',
    exact: true,
  });
  await expect(sourceGroup).toBeFocused();
  await expect(sourceGroup).toBeInViewport();
});

test('current card sibling action opens a visible focused editor with expanded ancestry and exact sibling position', async ({
  page,
  runtime,
}) => {
  const seeded = await seed(page, runtime);
  let tree = seeded.tree;
  const parentId = tree.tasks.find((task) => task.title === 'Этап P')!.id;
  tree = await send(page, runtime.origin, tree, {
    type: 'task.create',
    parentId,
    title: 'Вложенный этап',
  });
  const nestedId = tree.tasks.find(
    (task) => task.title === 'Вложенный этап',
  )!.id;
  tree = await send(page, runtime.origin, tree, {
    type: 'task.move',
    taskId: seeded.cId,
    parentId: nestedId,
    position: 0,
  });
  tree = await send(page, runtime.origin, tree, {
    type: 'task.create',
    parentId: nestedId,
    title: 'Следующий сосед',
  });
  await page.goto(runtime.origin);
  await page
    .getByRole('button', { name: 'Свернуть Вложенный этап', exact: true })
    .click();
  await page
    .getByRole('button', { name: 'Свернуть Этап P', exact: true })
    .click();
  await page.getByLabel('Поиск задач', { exact: true }).fill('Нет совпадений');
  await page.getByRole('tab', { name: 'Актуальное', exact: true }).click();
  await current(page)
    .getByRole('button', { name: 'Позже 1', exact: true })
    .click();
  await current(page).locator(`#current-task-${seeded.cId}`).click();
  await panel(page).getByRole('button', { name: 'Действия задачи' }).click();
  await page
    .getByRole('menuitem', { name: 'Добавить соседнюю задачу', exact: true })
    .click();
  const input = page.locator('#quick-task');
  await expect(page.locator('#project-view-tasks')).toBeVisible();
  await expect(input).toBeVisible();
  await expect(input).toBeFocused();
  await expect(input).toBeInViewport();
  await expect(
    page.getByRole('button', { name: 'Свернуть Этап P', exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole('button', { name: 'Свернуть Вложенный этап', exact: true }),
  ).toBeVisible();
  await expect(
    page.getByText('Родитель: Вложенный этап', { exact: true }),
  ).toBeVisible();
  await expect(page.getByLabel('Поиск задач', { exact: true })).toHaveValue('');
  await input.fill('Созданный сосед');
  await input.press('Enter');
  await expect(
    page.getByRole('treeitem', { name: /^Созданный сосед,/ }).first(),
  ).toBeVisible();
  const saved = await readTree(page, runtime.origin, tree.project.id);
  const siblings = saved.tasks
    .filter((task) => task.parentId === nestedId)
    .sort((a, b) => a.sortOrder - b.sortOrder);
  expect(siblings.map((task) => task.title)).toEqual([
    'Работа C',
    'Созданный сосед',
    'Следующий сосед',
  ]);
  await page.goBack();
  await expect(current(page)).toBeVisible();
  await expect(panel(page)).toBeVisible();
  await expect(
    current(page).getByRole('button', { name: 'Позже 1', exact: true }),
  ).toHaveAttribute('aria-expanded', 'true');
});
