import { setTaskStatus } from '../helpers/task-panel.js';
import { type Locator, type Page } from '@playwright/test';
import { test, expect, createJournalEntry } from '../helpers/journal-e2e.js';
import {
  readTree,
  seedOptionalRuntime,
  send,
} from '../helpers/optional-e2e.js';
import type { syntheticRuntime } from '../../scripts/e2e-server.js';

const panel = (page: Page) =>
  page.getByRole('complementary', { name: 'Задача', exact: true });
const row = (page: Page, id: string) =>
  page
    .getByRole('tree', { name: 'Задачи', exact: true })
    .locator(`[data-task-id="${id}"]`);
async function seed(
  page: Page,
  runtime: Awaited<ReturnType<typeof syntheticRuntime>>,
  journal = false,
) {
  let tree = await seedOptionalRuntime(page, runtime);
  const group = tree.tasks.find((task) => task.title === 'Этап P')!;
  const current = tree.tasks.find((task) => task.title === 'Работа C')!;
  const title =
    'Синтетическая длинная задача: ' + 'понятное название '.repeat(6);
  tree = await send(page, runtime.origin, tree, {
    type: 'task.edit',
    taskId: group.id,
    changes: { title, description: 'Синтетическое описание\n'.repeat(130) },
  });
  let parentId = group.id;
  for (let index = 0; index < 30; index++) {
    tree = await send(page, runtime.origin, tree, {
      type: 'task.create',
      parentId: index < 6 ? parentId : group.id,
      title: `Синтетическая подзадача ${index}`,
    });
    if (index < 6)
      parentId = tree.tasks.find(
        (task) => task.title === `Синтетическая подзадача ${index}`,
      )!.id;
  }
  const neighbors: string[] = [];
  for (let index = 0; index < 4; index++) {
    tree = await send(page, runtime.origin, tree, {
      type: 'task.create',
      parentId: null,
      title: `Сосед ${index}`,
    });
    neighbors.push(
      tree.tasks.find((task) => task.title === `Сосед ${index}`)!.id,
    );
    tree = await send(page, runtime.origin, tree, {
      type: 'dependency.create',
      predecessorId: index < 2 ? neighbors[index]! : current.id,
      successorId: index < 2 ? current.id : neighbors[index]!,
    });
  }
  if (journal)
    for (let index = 0; index < 55; index++) {
      await createJournalEntry(
        page,
        runtime.origin,
        tree.project.id,
        current.id,
        index,
        `Синтетическая запись ${index}\nВторая строка`,
        '2026-10-07',
      );
    }
  await page.goto(runtime.origin);
  await expect(row(page, group.id)).toBeVisible();
  return { tree, group, current, neighbors };
}
async function insideViewport(locator: Locator, page: Page) {
  const box = await locator.boundingBox();
  expect(box).not.toBeNull();
  const viewport = await page.evaluate(() => ({
    width: innerWidth,
    height: innerHeight,
  }));
  expect(box!.x).toBeGreaterThanOrEqual(-1);
  expect(box!.y).toBeGreaterThanOrEqual(-1);
  expect(box!.x + box!.width).toBeLessThanOrEqual(viewport.width + 1);
  expect(box!.y + box!.height).toBeLessThanOrEqual(viewport.height + 1);
}
async function onlyMainScroller(page: Page) {
  expect(
    (await panel(page).locator('[data-panel-scroll-owner]').count()) +
      (await panel(page).evaluate((node) =>
        Number(node.hasAttribute('data-panel-scroll-owner')),
      )),
  ).toBe(1);
  const scrollers = await panel(page).evaluate((root) =>
    [root, ...root.querySelectorAll('*')]
      .filter((node) => {
        const style = getComputedStyle(node);
        return (
          node.getClientRects().length &&
          ['auto', 'scroll'].includes(style.overflowY) &&
          node.scrollHeight > node.clientHeight + 1
        );
      })
      .map((node) => node.className),
  );
  expect(scrollers).toHaveLength(1);
}

test('desktop geometry keeps one title, fixed chrome, one scroll and mounted workspace through all tabs', async ({
  page,
  runtime,
}) => {
  const { group, current } = await seed(page, runtime, true);
  await row(page, group.id).click();
  const box = await panel(page).boundingBox();
  expect(box!.width).toBeGreaterThanOrEqual(420);
  expect(box!.width).toBeLessThanOrEqual(520);
  const workspace = page.locator('.workspace');
  expect((await workspace.boundingBox())!.width).toBeGreaterThan(300);
  const treeBox = await page.locator('.timeline-tree').boundingBox();
  const ganttBox = await page.locator('.timeline-time').boundingBox();
  expect(
    Math.min(treeBox!.x + treeBox!.width, box!.x) - treeBox!.x,
  ).toBeGreaterThan(250);
  expect(
    Math.min(ganttBox!.x + ganttBox!.width, box!.x) - ganttBox!.x,
  ).toBeGreaterThan(80);
  const footer = panel(page).locator('.panel-footer');
  const fixed = await footer.boundingBox();
  await panel(page)
    .locator('.panel-content')
    .evaluate((node) => {
      node.scrollTop = node.scrollHeight;
    });
  expect(await footer.boundingBox()).toEqual(fixed);
  await expect(
    panel(page).getByRole('tab', { name: 'Задача', exact: true }),
  ).toBeVisible();
  await onlyMainScroller(page);
  await panel(page)
    .getByRole('button', { name: 'Действия задачи', exact: true })
    .click();
  await insideViewport(
    page.getByRole('menu', { name: 'Действия задачи', exact: true }),
    page,
  );
  expect(await footer.boundingBox()).toEqual(fixed);
  await page.keyboard.press('Escape');
  await panel(page)
    .getByRole('button', { name: 'Закрыть панель', exact: true })
    .click();
  await row(page, current.id).click();
  for (const name of ['Задача', 'Зависимости', 'Журнал']) {
    await panel(page).getByRole('tab', { name, exact: true }).click();
    await expect(panel(page).getByRole('heading', { level: 2 })).toHaveCount(1);
  }
  await expect(panel(page).locator('[data-journal-entry-id]')).toHaveCount(50);
  await onlyMainScroller(page);
  await panel(page)
    .getByRole('button', { name: 'Показать ещё', exact: true })
    .click();
  await expect(panel(page).locator('[data-journal-entry-id]')).toHaveCount(55);
  await panel(page)
    .getByRole('tab', { name: 'Зависимости', exact: true })
    .click();
  await expect(panel(page).locator('[data-dependency-edge]')).toHaveCount(4);
  const headerBefore = await panel(page).locator('.panel-header').boundingBox();
  const tabsBefore = await panel(page).locator('.panel-tabs').boundingBox();
  const panelBefore = await panel(page).boundingBox();
  await panel(page)
    .getByRole('button', { name: /^Сроки задачи:/ })
    .click();
  await insideViewport(
    page.getByRole('dialog', { name: 'Сроки задачи', exact: true }),
    page,
  );
  expect(await panel(page).locator('.panel-header').boundingBox()).toEqual(
    headerBefore,
  );
  expect(await panel(page).locator('.panel-tabs').boundingBox()).toEqual(
    tabsBefore,
  );
  expect(await panel(page).boundingBox()).toEqual(panelBefore);
  await page.keyboard.press('Escape');
  await expect(
    panel(page).getByRole('button', { name: /^Сроки задачи:/ }),
  ).toBeFocused();
  await expect(panel(page)).toBeVisible();
});

test('whole task draft survives tabs, repairs raw error, saves one revision and undoes all fields', async ({
  page,
  runtime,
}) => {
  const { tree, current } = await seed(page, runtime);
  await row(page, current.id).click();
  await expect(panel(page).locator('.panel-footer')).toBeHidden();
  const headerBefore = await panel(page).locator('.panel-header').boundingBox();
  await panel(page)
    .getByRole('button', { name: 'Изменить название', exact: true })
    .click();
  await panel(page)
    .getByLabel('Название задачи', { exact: true })
    .fill('Общий синтетический черновик');
  await panel(page)
    .getByLabel('Название задачи', { exact: true })
    .press('Enter');
  await setTaskStatus(page, 'В работе');
  const afterStatus = await readTree(page, runtime.origin, tree.project.id);
  await expect(panel(page).locator('.panel-footer')).toBeVisible();
  await panel(page)
    .getByRole('button', { name: /^Сроки задачи:/ })
    .click();
  const dates = page.getByRole('dialog', { name: 'Сроки задачи', exact: true });
  await dates
    .getByLabel('Длительность, рабочих дней', { exact: true })
    .fill('bad');
  await dates
    .getByLabel('Длительность, рабочих дней', { exact: true })
    .press('Tab');
  await page.keyboard.press('Escape');
  await panel(page).getByRole('tab', { name: 'Журнал', exact: true }).click();
  await expect(
    panel(page).getByRole('button', { name: 'Сохранить', exact: true }),
  ).toBeDisabled();
  await panel(page)
    .getByRole('button', { name: 'Исправить сроки', exact: true })
    .click();
  const duration = dates.getByLabel('Длительность, рабочих дней', {
    exact: true,
  });
  await expect(duration).toBeFocused();
  await duration.fill('2');
  await duration.press('Tab');
  await dates.getByLabel('Начало', { exact: true }).fill('2026-10-05');
  await dates.getByLabel('Начало', { exact: true }).press('Tab');
  await page.keyboard.press('Escape');
  await panel(page)
    .getByRole('tab', { name: 'Зависимости', exact: true })
    .click();
  await panel(page)
    .getByRole('button', { name: 'Удалить связь: Сосед 0', exact: true })
    .click();
  const before = tree.project.revision;
  const response = page.waitForResponse(
    (response) =>
      response.url().endsWith('/commands') &&
      response.request().method() === 'POST',
  );
  await panel(page)
    .getByRole('button', { name: 'Сохранить', exact: true })
    .click();
  expect((await response).status()).toBe(200);
  await expect(
    panel(page).getByRole('button', { name: 'Сохранить', exact: true }),
  ).toHaveCount(0);
  const saved = await readTree(page, runtime.origin, tree.project.id);
  expect(saved.project.revision).toBe(before + 2);
  expect(await panel(page).locator('.panel-header').boundingBox()).toEqual(
    headerBefore,
  );
  expect(saved.tasks.find((task) => task.id === current.id)).toMatchObject({
    title: 'Общий синтетический черновик',
    status: 'doing',
    description: '',
    inputStart: '2026-10-05',
    inputFinish: '2026-10-06',
    durationDays: 2,
  });
  expect(saved.dependencies).toHaveLength(tree.dependencies.length - 1);
  await page
    .getByRole('button', { name: 'Отменить изменение плана', exact: true })
    .click();
  await expect(panel(page).getByRole('heading', { level: 2 })).toHaveText(
    current.title,
  );
  const restored = await readTree(page, runtime.origin, tree.project.id);
  expect(restored.tasks).toEqual(afterStatus.tasks);
  expect(restored.dependencies).toEqual(tree.dependencies);
});

test('outgoing success restores enabled trigger focus after actual server acknowledgement', async ({
  page,
  runtime,
}) => {
  const { current } = await seed(page, runtime);
  await row(page, current.id).click();
  await panel(page)
    .getByRole('tab', { name: 'Зависимости', exact: true })
    .click();
  const trigger = panel(page).getByRole('button', {
    name: 'Добавить последователя',
    exact: true,
  });
  await trigger.click();
  const picker = page.getByRole('dialog', {
    name: 'Добавить последователя',
    exact: true,
  });
  await picker.getByRole('searchbox').fill('Работа A');
  await picker.getByRole('searchbox').press('Enter');
  await expect(picker).toBeHidden();
  await expect(trigger).toBeEnabled();
  await expect(trigger).toBeFocused();
});

for (const viewport of [
  { width: 375, height: 812 },
  { width: 375, height: 420 },
  { width: 850, height: 650 },
]) {
  test(`overlay ${viewport.width}x${viewport.height} contains controls and keeps underlying workspace mounted`, async ({
    page,
    runtime,
  }) => {
    await page.setViewportSize(viewport);
    const { current } = await seed(page, runtime, true);
    const before = await page.evaluate(
      () => document.documentElement.scrollWidth,
    );
    await row(page, current.id).click();
    const box = await panel(page).boundingBox();
    expect(box).toEqual({
      x: 0,
      y: 0,
      width: viewport.width,
      height: viewport.height,
    });
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth),
    ).toBe(before);
    await panel(page)
      .getByRole('button', { name: 'Действия задачи', exact: true })
      .click();
    await insideViewport(
      page.getByRole('menu', { name: 'Действия задачи', exact: true }),
      page,
    );
    await page.keyboard.press('Escape');
    await panel(page)
      .getByRole('button', { name: /^Сроки задачи:/ })
      .click();
    const dates = page.getByRole('dialog', {
      name: 'Сроки задачи',
      exact: true,
    });
    await insideViewport(dates, page);
    for (const label of ['Начало', 'Окончание', 'Длительность, рабочих дней']) {
      const input = dates.getByLabel(label, { exact: true });
      await input.scrollIntoViewIfNeeded();
      await input.focus();
      await expect(input).toBeFocused();
      await insideViewport(input, page);
    }
    await page.keyboard.press('Escape');
    await panel(page).getByRole('tab', { name: 'Журнал', exact: true }).click();
    await expect(panel(page).locator('[data-journal-entry-id]')).toHaveCount(
      50,
    );
    await onlyMainScroller(page);
    await expect(panel(page).locator('.panel-footer')).toBeHidden();
    await panel(page)
      .getByRole('button', { name: 'Закрыть панель', exact: true })
      .scrollIntoViewIfNeeded();
    await panel(page)
      .getByRole('button', { name: 'Закрыть панель', exact: true })
      .click();
    await expect(row(page, current.id)).toBeFocused();
  });
}

test('journal header ancestor follows actual feed error and coherent refresh while keeping saved context', async ({
  page,
  runtime,
}) => {
  const { current, tree, group } = await seed(page, runtime, true);
  await row(page, current.id).click();
  await panel(page).getByRole('tab', { name: 'Журнал', exact: true }).click();
  const path = panel(page).getByRole('navigation', { name: 'Путь задачи' });
  const ancestor = path.getByRole('button', {
    name: tree.tasks.find((task) => task.id === group.id)!.title,
    exact: true,
  });
  await expect(ancestor).toBeEnabled();
  await expect(panel(page).locator('[data-journal-entry-id]')).toHaveCount(50);
  const url = `**/api/projects/${tree.project.id}/tasks/${current.id}/journal*`;
  await page.route(url, (route) => route.abort('failed'));
  await page.evaluate(() => window.dispatchEvent(new Event('focus')));
  await expect(panel(page).getByRole('alert')).toBeVisible();
  await expect(ancestor).toBeVisible();
  await expect(ancestor).toBeDisabled();
  await expect(panel(page).getByRole('heading', { level: 2 })).toHaveText(
    current.title,
  );
  await page.unroute(url);
  await panel(page)
    .getByRole('button', { name: 'Повторить загрузку', exact: true })
    .click();
  await expect(ancestor).toBeEnabled();
  await ancestor.click();
  await expect(panel(page).getByRole('heading', { level: 2 })).toHaveText(
    tree.tasks.find((task) => task.id === group.id)!.title,
  );
  await expect(
    panel(page).getByRole('tab', { name: 'Журнал', exact: true }),
  ).toHaveAttribute('aria-selected', 'true');
});

test('extreme title uses one shell scroll and keyboard text undo and journal submit stay local', async ({
  page,
  runtime,
}) => {
  await page.setViewportSize({ width: 375, height: 420 });
  const { current, tree } = await seed(page, runtime);
  const longTitle = 'Синтетическое название '.repeat(20).slice(0, 300);
  await send(page, runtime.origin, tree, {
    type: 'task.edit',
    taskId: current.id,
    changes: { title: longTitle },
  });
  const before = await readTree(page, runtime.origin, tree.project.id);
  await page.reload();
  await row(page, current.id).click();
  await expect(panel(page)).toHaveClass(/task-panel--scroll-shell/);
  await expect(panel(page).getByRole('heading', { level: 2 })).toHaveText(
    longTitle,
  );
  await onlyMainScroller(page);
  await panel(page)
    .getByRole('button', { name: 'Добавить описание', exact: true })
    .click();
  const description = panel(page).getByLabel('Описание', { exact: true });
  await description.fill('Локальный текст');
  await description.press('End');
  await description.press('x');
  await expect(description).toHaveValue('Локальный текстx');
  await description.press('Control+z');
  await expect(description).toHaveValue('Локальный текст');
  expect(
    (await readTree(page, runtime.origin, tree.project.id)).project.revision,
  ).toBe(before.project.revision);
  await panel(page).getByRole('tab', { name: 'Журнал', exact: true }).click();
  await page
    .getByRole('dialog', { name: 'Несохранённые изменения задачи' })
    .getByRole('button', { name: 'Не сохранять', exact: true })
    .click();
  const editor = panel(page).getByLabel('Текст записи');
  await editor.fill('Первая строка');
  await editor.press('End');
  await editor.press('Enter');
  await editor.pressSequentially('Вторая строка');
  await expect(editor).toHaveValue('Первая строка\nВторая строка');
  await editor.press('Control+Enter');
  await expect(editor).toHaveValue('');
  await expect(panel(page).locator('[data-journal-entry-id]')).toHaveCount(1);
  await onlyMainScroller(page);
  await expect(panel(page).locator('.panel-footer')).toBeHidden();
  expect(
    (await readTree(page, runtime.origin, tree.project.id)).project.revision,
  ).toBe(before.project.revision);
});
