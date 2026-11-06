import { test, expect } from '../helpers/journal-e2e.js';
import { seedOptionalRuntime, readTree } from '../helpers/optional-e2e.js';

test('collapsed project shortcuts expose names and preserve guarded navigation', async ({
  page,
  runtime,
}) => {
  const tree = await seedOptionalRuntime(page, runtime);
  const response = await page.request.post(`${runtime.origin}/api/projects`, {
    headers: { Origin: runtime.origin, 'X-Leaf-Contract-Version': '2' },
    data: { title: 'Другой пример' },
  });
  expect(response.status()).toBe(201);
  const other = (await response.json()) as { id: string };
  const writes: string[] = [];
  page.on('request', (request) => {
    if (!['GET', 'HEAD'].includes(request.method()))
      writes.push(request.method());
  });
  await page.goto(`${runtime.origin}/?project=${tree.project.id}`);
  const sidebar = page.getByRole('complementary', {
    name: 'Проекты',
    exact: true,
  });
  const toggle = sidebar.locator('.project-sidebar-toggle');
  await toggle.click();
  const current = sidebar.getByRole('button', {
    name: tree.project.title,
    exact: true,
  });
  const next = sidebar.getByRole('button', {
    name: 'Другой пример',
    exact: true,
  });
  await expect(current).toHaveText('♧ДПДемо-проект');
  await expect(current.locator('.project-initials')).toBeVisible();
  await expect(current.locator('.project-name')).toBeHidden();
  await expect(current).toHaveAttribute('aria-current', 'page');
  await expect(
    sidebar.getByRole('button', { name: 'Действия проекта' }),
  ).toHaveCount(0);
  await expect(sidebar).toHaveCSS('width', '64px');
  await toggle.press('Tab');
  await expect(
    sidebar.getByRole('button', { name: 'Новый проект' }),
  ).toBeFocused();
  await page.keyboard.press('Tab');
  await expect(current).toBeFocused();
  const tooltip = page.getByRole('tooltip');
  await expect(tooltip).toHaveText(tree.project.title);
  const tooltipBox = (await tooltip.boundingBox())!;
  expect(tooltipBox.x).toBeGreaterThanOrEqual(64);
  expect(tooltipBox.x + tooltipBox.width).toBeLessThan(
    page.viewportSize()!.width,
  );
  await page.keyboard.press('Escape');
  await expect(tooltip).toHaveCount(0);
  await next.hover();
  await expect(tooltip).toHaveText('Другой пример');
  await tooltip.hover();
  await expect(tooltip).toBeVisible();
  await page.mouse.move(200, 400);
  await expect(tooltip).toHaveCount(0);
  await next.focus();
  await next.press('Enter');
  await expect(
    page.getByRole('heading', { name: 'Другой пример', exact: true }),
  ).toBeVisible();
  await expect(next).toHaveAttribute('aria-current', 'page');
  await expect(current).not.toHaveAttribute('aria-current');
  await expect(toggle).toHaveAttribute('aria-expanded', 'false');
  await current.click();
  await page.getByRole('treeitem', { name: /^Этап P,/ }).press('Enter');
  const panel = page.getByRole('complementary', {
    name: 'Задача',
    exact: true,
  });
  await panel
    .getByRole('button', { name: 'Добавить описание', exact: true })
    .click();
  await panel
    .getByLabel('Описание', { exact: true })
    .fill('Synthetic panel draft');
  await next.click();
  const guard = page.getByRole('dialog', {
    name: 'Несохранённые изменения задачи',
  });
  await expect(guard).toBeVisible();
  await guard
    .getByRole('button', { name: 'Продолжить редактирование', exact: true })
    .click();
  await expect(panel.getByLabel('Описание', { exact: true })).toHaveValue(
    'Synthetic panel draft',
  );
  await expect(current).toHaveAttribute('aria-current', 'page');
  await expect(toggle).toHaveAttribute('aria-expanded', 'false');
  expect(writes).toEqual([]);
  expect(await readTree(page, runtime.origin, tree.project.id)).toEqual(tree);
  expect((await readTree(page, runtime.origin, other.id)).tasks).toEqual([]);
});

test('long project rails scroll without losing controls and creation retains its draft', async ({
  page,
  runtime,
}) => {
  const tree = await seedOptionalRuntime(page, runtime);
  for (let n = 1; n <= 22; n++) {
    const response = await page.request.post(`${runtime.origin}/api/projects`, {
      headers: { Origin: runtime.origin, 'X-Leaf-Contract-Version': '2' },
      data: { title: `Пример ${n}` },
    });
    expect(response.status()).toBe(201);
  }
  await page.goto(`${runtime.origin}/?project=${tree.project.id}`);
  const sidebar = page.getByRole('complementary', {
    name: 'Проекты',
    exact: true,
  });
  const plus = sidebar.getByRole('button', { name: 'Новый проект' });
  await plus.click();
  await sidebar
    .getByLabel('Название проекта', { exact: true })
    .fill('Synthetic new draft');
  const toggle = sidebar.locator('.project-sidebar-toggle');
  await toggle.click();
  const nav = sidebar.getByRole('navigation', { name: 'Проекты' });
  expect(
    await nav.evaluate((node) => node.scrollHeight > node.clientHeight),
  ).toBe(true);
  await sidebar.getByRole('button', { name: 'Пример 22', exact: true }).focus();
  const last = (await sidebar
    .getByRole('button', { name: 'Пример 22', exact: true })
    .boundingBox())!;
  const navBox = (await nav.boundingBox())!;
  expect(last.y + last.height).toBeLessThanOrEqual(navBox.y + navBox.height);
  await expect(toggle).toBeInViewport();
  const logout = sidebar.getByRole('button', { name: 'Выйти', exact: true });
  await expect(logout).toBeInViewport();
  await page.screenshot({
    path: `/tmp/leaf-project-shortcuts-${page.viewportSize()!.width}.png`,
  });
  await plus.click();
  const input = sidebar.getByLabel('Название проекта', { exact: true });
  await expect(input).toHaveValue('Synthetic new draft');
  await expect(input).toBeFocused();
  await toggle.click();
  await page.setViewportSize({ width: 600, height: 800 });
  const current = sidebar.getByRole('button', {
    name: tree.project.title,
    exact: true,
  });
  await expect(current.locator('.project-name')).toBeVisible();
  await expect(current.locator('.project-initials')).toBeHidden();
  await input.focus();
  await page.setViewportSize({ width: 601, height: 800 });
  await expect(toggle).toBeFocused();
  await expect(input).toBeHidden();
  await logout.click();
  await expect(
    page.getByRole('button', { name: 'Войти', exact: true }),
  ).toBeVisible();
});
