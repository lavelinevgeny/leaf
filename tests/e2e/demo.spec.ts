import { test, expect, type Page } from '@playwright/test';
import { syntheticDemoRuntime } from '../../scripts/e2e-demo-server.js';
import { strings } from '../../src/client/strings.js';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

function row(page: Page, title: string) {
  return page
    .getByRole('tree', { name: 'Задачи', exact: true })
    .getByRole('treeitem', { name: new RegExp(`^${title},`) });
}
async function enter(page: Page, origin: string) {
  await page.goto(origin);
  await expect(page.getByText(strings.demoNotice)).toBeVisible();
  const button = page.getByRole('button', { name: strings.demoEntry });
  await button.focus();
  await page.keyboard.press('Enter');
  await expect(
    page.getByRole('heading', { name: 'Демо-проект' }),
  ).toBeVisible();
}
async function add(page: Page, title: string) {
  const input = page.getByLabel('Новая задача', { exact: true });
  await input.fill(title);
  await input.press('Enter');
}

test('demo uses shared real transactions, independent sessions and a fresh seed on restart', async ({
  page,
  browser,
}, testInfo) => {
  const runtime = await syntheticDemoRuntime();
  const other = await browser.newContext({
    viewport: testInfo.project.use.viewport ?? { width: 1440, height: 900 },
  });
  try {
    await enter(page, runtime.origin);
    await expect(row(page, 'Запуск примера')).toHaveAttribute(
      'aria-level',
      '1',
    );
    await expect(row(page, 'Подготовка')).toHaveAttribute('aria-level', '2');
    await expect(row(page, 'План работ')).toHaveAttribute('aria-level', '3');
    await page.getByRole('button', { name: 'Гант', exact: true }).click();
    await expect(page.locator('.gantt-work.conditional').first()).toBeVisible();
    await expect(page.locator('.gantt-edge')).toHaveCount(3);
    await expect(
      page.locator('.gantt-work.partial-critical').first(),
    ).toBeVisible();
    const dated = page.getByRole('button', { name: /^План работ, \d{4}-/ });
    await expect(dated).toBeVisible();
    const date = (await dated.getAttribute('aria-label'))!.match(
      /\d{4}-\d{2}-\d{2}/,
    )![0];
    expect(
      Math.abs(
        Date.parse(date) - Date.parse(new Date().toISOString().slice(0, 10)),
      ),
    ).toBeLessThanOrEqual(3 * 86400000);
    const screenshots = await mkdtemp(join(tmpdir(), 'leaf-demo-visual-'));
    await page.screenshot({
      path: join(screenshots, `${testInfo.project.name}.png`),
    });
    const second = await other.newPage();
    await enter(second, runtime.origin);
    await add(page, 'Синтетическая общая задача');
    await expect(row(page, 'Синтетическая общая задача')).toBeVisible();
    // The second visitor still has the old revision: this real command must fail.
    const conflictResponse = second.waitForResponse(
      (response) =>
        response.url().endsWith('/commands') && response.status() === 409,
    );
    await add(second, 'Синтетический конфликт');
    await conflictResponse;
    await expect(second.getByRole('alert')).toContainText(
      'Проект изменён в другой сессии',
    );
    await second.getByRole('button', { name: strings.reload }).click();
    await expect(row(second, 'Синтетическая общая задача')).toBeVisible();
    const draft = second.getByLabel('Новая задача', { exact: true });
    await draft.fill('');
    await second.getByRole('button', { name: 'Выйти', exact: true }).click();
    await expect(
      second.getByRole('button', { name: strings.demoEntry }),
    ).toBeVisible();
    await expect(
      page.getByRole('heading', { name: 'Демо-проект' }),
    ).toBeVisible();
    await page.reload();
    await expect(row(page, 'Синтетическая общая задача')).toBeVisible();
    await page
      .getByRole('button', { name: /Отменить последнее изменение/ })
      .click();
    await expect(row(page, 'Синтетическая общая задача')).toHaveCount(0);
    await add(page, 'Синтетическая перезагрузка');
    await expect(row(page, 'Синтетическая перезагрузка')).toBeVisible();
    await enter(second, runtime.origin);
    await expect(row(second, 'Синтетическая перезагрузка')).toBeVisible();
    await runtime.restart();
    await page.reload();
    await expect(
      page.getByRole('button', { name: strings.demoEntry }),
    ).toBeVisible();
    await page.getByRole('button', { name: strings.demoEntry }).click();
    await expect(row(page, 'Синтетическая перезагрузка')).toHaveCount(0);
    await expect(row(page, 'План работ')).toBeVisible();
    await expect(page.getByText(strings.demoNotice)).toBeVisible();
    await second.reload();
    await expect(
      second.getByRole('button', { name: strings.demoEntry }),
    ).toBeVisible();
  } finally {
    await other.close();
    await runtime.close();
  }
});
