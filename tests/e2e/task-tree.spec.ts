import { openTaskDates, setTaskStatus } from '../helpers/task-panel.js';
import {
  test as base,
  expect,
  type Page,
  type Locator,
} from '@playwright/test';
import { syntheticRuntime } from '../../scripts/e2e-server.js';

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
async function login(page: Page, origin: string, password: string) {
  await page.goto(origin);
  await page.getByLabel('Пароль', { exact: true }).fill(password);
  await page.getByRole('button', { name: 'Войти', exact: true }).click();
  await expect(
    page.getByRole('button', { name: 'Новый проект' }),
  ).toBeVisible();
}
async function project(page: Page) {
  await page.getByRole('button', { name: 'Новый проект' }).click();
  await page.getByLabel('Название проекта').fill('Демо-проект');
  await page.getByRole('button', { name: 'Создать проект' }).click();
  await expect(
    page.getByRole('heading', { name: 'Демо-проект' }),
  ).toBeVisible();
}
function row(page: Page, title: string) {
  return page
    .getByRole('tree', { name: 'Задачи', exact: true })
    .getByRole('treeitem', { name: new RegExp(`^${title},`) });
}
async function add(page: Page, title: string, scope: Page | Locator = page) {
  // These are hierarchy-only fixtures; C19 defaults are covered separately.
  const quick = scope.locator('form.quick-add');
  await quick.getByRole('button', { name: 'Сроки новой задачи' }).click();
  await quick.getByLabel('Длительность, рабочих дней').fill('');
  await quick.getByRole('button', { name: 'Готово', exact: true }).click();
  const input = scope.getByLabel('Новая задача', { exact: true });
  await input.fill(title);
  await input.press('Enter');
  await expect(row(page, title)).toBeVisible();
  await expect(input).toHaveValue('');
}

test('creates a root immediately after confirmed deletion of the only task', async ({
  page,
  runtime,
}) => {
  await login(page, runtime.origin, runtime.password);
  await project(page);
  await add(page, 'Задача A');
  await row(page, 'Задача A').click();
  page.once('dialog', (dialog) => dialog.accept());
  await page.getByRole('button', { name: 'Действия задачи' }).click();
  await page.getByRole('menuitem', { name: 'Удалить задачу…' }).click();
  await expect(page.getByText('В проекте пока нет задач.')).toBeVisible();
  await add(page, 'Задача B');
  await expect(row(page, 'Задача B')).toHaveAttribute('aria-level', '1');
  await expect(page.getByRole('alert')).toHaveCount(0);
  await page.reload();
  await expect(row(page, 'Задача B')).toBeVisible();
  await expect(row(page, 'Задача A')).toHaveCount(0);
});

test('real CRUD, tree keyboard, moves, branch undo and restart persistence', async ({
  page,
  runtime,
}, testInfo) => {
  await login(page, runtime.origin, runtime.password);
  await expect(page.getByText('Создайте первый проект.')).toBeVisible();
  await project(page);
  await expect(page.getByText('В проекте пока нет задач.')).toBeVisible();
  await add(page, 'Задача A');
  await page.getByLabel('Новая задача').press('Tab');
  await add(page, 'Ребёнок A');
  await page.getByLabel('Новая задача').press('Tab');
  await add(page, 'Внук A');
  await expect(row(page, 'Внук A')).toHaveAttribute('aria-level', '3');
  await page.getByLabel('Новая задача').press('Shift+Tab');
  await page.getByLabel('Новая задача').press('Shift+Tab');
  await add(page, 'Задача B');
  await row(page, 'Задача B').click();
  const card = page.getByRole('complementary', { name: 'Задача', exact: true });
  await page
    .getByRole('button', { name: 'Изменить название', exact: true })
    .click();
  await page.getByLabel('Название задачи').fill('Задача B1');
  await page
    .getByRole('button', { name: 'Добавить описание', exact: true })
    .click();
  await page
    .getByRole('textbox', { name: 'Описание', exact: true })
    .fill('Синтетическое описание');
  await setTaskStatus(page, 'В работе');
  await openTaskDates(page);
  await card.getByLabel('Начало', { exact: true }).fill('2026-10-07');
  await openTaskDates(page);
  await card.getByLabel('Окончание', { exact: true }).fill('2026-10-09');
  await page
    .getByRole('button', { name: 'Сохранить все изменения', exact: true })
    .click();
  await expect(page.getByText('Сохранено', { exact: true })).toBeVisible();
  await expect(row(page, 'Задача B1')).toHaveAccessibleName(/В работе/);
  await openTaskDates(page);
  await card.getByLabel('Начало', { exact: true }).fill('');
  await openTaskDates(page);
  await card.getByLabel('Окончание', { exact: true }).fill('');
  await page.getByRole('button', { name: 'Сохранить', exact: true }).click();
  await expect(page.getByText('Сохранено', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Закрыть панель' }).click();
  await expect(row(page, 'Задача B1')).toBeFocused();
  await row(page, 'Задача A').focus();
  await page.keyboard.press('ArrowLeft');
  await expect(row(page, 'Ребёнок A')).toHaveCount(0);
  await page.keyboard.press('ArrowRight');
  await page.keyboard.press('ArrowRight');
  await expect(row(page, 'Ребёнок A')).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(
    page.getByRole('heading', { name: 'Ребёнок A', exact: true }),
  ).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(row(page, 'Ребёнок A')).toBeFocused();
  await row(page, 'Задача B1').focus();
  await page.keyboard.press('Alt+ArrowRight');
  await expect(row(page, 'Задача B1')).toHaveAttribute('aria-level', '2');
  await page.keyboard.press('Alt+ArrowLeft');
  await expect(row(page, 'Задача B1')).toHaveAttribute('aria-level', '1');
  // The move restores keyboard focus on the next frame after its DOM update.
  await page.evaluate(
    () =>
      new Promise<void>((resolve) => requestAnimationFrame(() => resolve())),
  );
  page.once('dialog', (dialog) => dialog.accept());
  await row(page, 'Задача A').press('Delete');
  await expect(row(page, 'Задача A')).toHaveCount(0);
  await expect(row(page, 'Внук A')).toHaveCount(0);
  await page.getByRole('button', { name: 'Отменить изменение плана' }).click();
  await expect(row(page, 'Внук A')).toHaveAttribute('aria-level', '3');
  await page.reload();
  await expect(row(page, 'Внук A')).toBeVisible();
  await runtime.restart();
  await page.reload();
  await expect(row(page, 'Внук A')).toBeVisible();
  await row(page, 'Задача B1').click();
  await page
    .getByRole('button', { name: 'Изменить описание', exact: true })
    .click();
  await expect(
    page.getByRole('textbox', { name: 'Описание', exact: true }),
  ).toHaveValue('Синтетическое описание');
  await expect(card.getByLabel('Начало', { exact: true })).toHaveValue('');
  await expect(card.getByLabel('Окончание', { exact: true })).toHaveValue('');
  await expect(
    page.getByRole('button', { name: 'Статус: В работе', exact: true }),
  ).toBeVisible();
  const header = page.locator('.panel-header');
  await expect(header).toBeInViewport();
  const bounds = await header.boundingBox();
  expect(bounds).not.toBeNull();
  expect(bounds!.y).toBeGreaterThanOrEqual(0);
  expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(
    page.viewportSize()!.width,
  );
  const screenshotPath = testInfo.outputPath(
    `synthetic-${testInfo.project.name}.png`,
  );
  await page.screenshot({ path: screenshotPath });
  console.log(`Synthetic screenshot: ${screenshotPath}`);
  await page.getByRole('button', { name: 'Закрыть панель' }).click();
  await page.getByRole('button', { name: 'Выйти', exact: true }).click();
  await expect(page.getByLabel('Пароль', { exact: true })).toBeVisible();
});

test('rejects foreign origin and keeps a failed save visible until exact retry', async ({
  page,
  runtime,
}) => {
  await login(page, runtime.origin, runtime.password);
  const rejected = await page.request.post(`${runtime.origin}/api/projects`, {
    headers: { Origin: 'http://example.test' },
    data: { title: 'Отклонённый проект' },
  });
  expect(rejected.status()).toBe(403);
  const missing = await page.request.post(`${runtime.origin}/api/projects`, {
    data: { title: 'Отклонённый проект' },
  });
  expect(missing.status()).toBe(403);
  expect(
    await (
      await page.request.get(`${runtime.origin}/api/projects`, {
        headers: { 'X-Leaf-Contract-Version': '2' },
      })
    ).json(),
  ).toEqual([]);
  await project(page);
  await add(page, 'Задача A');
  await row(page, 'Задача A').click();
  await page
    .getByRole('button', { name: 'Добавить описание', exact: true })
    .click();
  await page
    .getByRole('textbox', { name: 'Описание', exact: true })
    .fill('Черновик при сбое');
  let dropped = false;
  let original: unknown;
  await page.route('**/api/projects/*/commands', async (route) => {
    const envelope: unknown = route.request().postDataJSON();
    if (!dropped) {
      dropped = true;
      original = envelope;
      await route.fetch(); // The real write succeeds; only its response is lost.
      await route.abort('failed');
    } else {
      expect(envelope).toEqual(original);
      await route.continue();
    }
  });
  await page.getByRole('button', { name: 'Сохранить', exact: true }).click();
  const panel = page.getByRole('complementary', {
    name: 'Задача',
    exact: true,
  });
  await expect(panel.locator('.panel-footer').getByRole('alert')).toContainText(
    'Нет связи с сервером',
  );
  await expect(
    page.getByRole('textbox', { name: 'Описание', exact: true }),
  ).toHaveValue('Черновик при сбое');
  await panel.getByRole('button', { name: 'Повторить сохранение' }).click();
  await expect(panel.getByText('Сохранено', { exact: true })).toBeVisible();
  await page.reload();
  await row(page, 'Задача A').click();
  await page
    .getByRole('button', { name: 'Изменить описание', exact: true })
    .click();
  await expect(
    page.getByRole('textbox', { name: 'Описание', exact: true }),
  ).toHaveValue('Черновик при сбое');
  const projects = (await (
    await page.request.get(`${runtime.origin}/api/projects`, {
      headers: { 'X-Leaf-Contract-Version': '2' },
    })
  ).json()) as { id: string }[];
  const tree = (await (
    await page.request.get(
      `${runtime.origin}/api/projects/${projects[0]!.id}/tree`,
      { headers: { 'X-Leaf-Contract-Version': '2' } },
    )
  ).json()) as { project: { revision: number } };
  expect(tree.project.revision).toBe(2);
});

test('child and sibling controls expose an accessible quick editor at narrow width', async ({
  page,
  runtime,
}) => {
  await login(page, runtime.origin, runtime.password);
  await project(page);
  await add(page, 'Задача A');
  for (const width of [1024, 990]) {
    await page.setViewportSize({ width, height: 800 });
    for (const action of ['Добавить подзадачу', 'Добавить соседнюю задачу']) {
      await row(page, 'Задача A').click();
      if (action === 'Добавить соседнюю задачу') {
        await page.getByRole('button', { name: 'Действия задачи' }).click();
        await page.getByRole('menuitem', { name: action, exact: true }).click();
      } else
        await page.getByRole('button', { name: action, exact: true }).click();
      const child = action === 'Добавить подзадачу';
      const scope = child
        ? page.getByRole('complementary', { name: 'Задача', exact: true })
        : page;
      const quick = scope.getByLabel('Новая задача', { exact: true });
      await expect(quick).toBeFocused();
      const accessible = await quick.evaluate((input) => {
        const rect = input.getBoundingClientRect();
        return (
          document.elementFromPoint(
            rect.right - 4,
            rect.y + rect.height / 2,
          ) === input
        );
      });
      expect(accessible).toBe(true);
      await add(
        page,
        `${action === 'Добавить подзадачу' ? 'Ребёнок A' : 'Сосед A'} ${width}`,
        scope,
      );
      if (child)
        await page
          .getByRole('button', { name: 'Закрыть панель', exact: true })
          .click();
    }
  }
});
