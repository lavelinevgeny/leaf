import { test, expect } from '../helpers/journal-e2e.js';
import {
  seedOptionalRuntime,
  send,
  readTree,
} from '../helpers/optional-e2e.js';

test('current search reveals matches, supports keyboard clearing and preserves independent Gantt context', async ({
  page,
  runtime,
}) => {
  await page.clock.setFixedTime(new Date('2026-11-06T12:00:00Z'));
  let tree = await seedOptionalRuntime(page, runtime);
  tree = await send(page, runtime.origin, tree, {
    type: 'task.create',
    parentId: null,
    title: 'Будущая работа',
    inputFinish: '2026-12-01',
  });
  tree = await send(page, runtime.origin, tree, {
    type: 'task.create',
    parentId: null,
    title: 'Работа без даты',
  });
  await page.goto(`${runtime.origin}/?project=${tree.project.id}&view=current`);
  const current = page.locator('#project-view-current');
  const search = page.getByRole('searchbox', {
    name: 'Поиск задач',
    exact: true,
  });
  await expect(search).toHaveAttribute('placeholder', 'Поиск задач');
  await expect(
    page.getByRole('button', { name: 'Фильтры', exact: true }),
  ).toHaveCount(0);
  await search.focus();
  await page.keyboard.insertText('  РАБОТА  ');
  await expect(
    current.getByRole('button', { name: /Будущая работа/ }),
  ).toBeVisible();
  await expect(
    current.getByRole('button', { name: /Работа без даты/ }),
  ).toBeVisible();
  await expect(current.locator('.current-row')).toHaveCount(4);
  await search.fill('Ничего такого');
  await expect(current.getByRole('status')).toHaveText('Нет совпадений');
  await search.press('Escape');
  await expect(search).toHaveValue('');
  await expect(search).toBeFocused();
  await expect(
    current.getByRole('button', { name: 'Позже 1', exact: true }),
  ).toHaveAttribute('aria-expanded', 'false');

  await search.fill('Будущая');
  const row = current.getByRole('button', { name: /Будущая работа/ });
  await row.focus();
  await row.press('Enter');
  const panel = page.getByRole('complementary', {
    name: 'Задача',
    exact: true,
  });
  await expect(panel).toBeVisible();
  await panel.getByRole('button', { name: 'Закрыть панель' }).click();
  await expect(row).toBeFocused();
  await page.getByRole('tab', { name: 'Задачи', exact: true }).click();
  await expect(search).toHaveValue('');
  await search.fill('Работа A');
  await page.getByRole('tab', { name: 'Актуальное', exact: true }).click();
  await expect(search).toHaveValue('Будущая');
  await expect(row).toBeVisible();
  await page.goBack();
  await expect(search).toHaveValue('Работа A');
  await page.goForward();
  await expect(search).toHaveValue('Будущая');
  await search.focus();
  await search.press('Tab');
  await expect(
    page.getByRole('button', { name: 'Очистить поиск' }),
  ).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(search).toHaveValue('');
  await expect(search).toBeFocused();
  expect(await readTree(page, runtime.origin, tree.project.id)).toEqual(tree);
});
