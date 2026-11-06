import { test, expect, type Page } from '@playwright/test';
import { syntheticRuntime } from '../../scripts/e2e-server.js';
import {
  seedOptionalRuntime,
  readTree,
  send,
} from '../helpers/optional-e2e.js';

async function geometry(page: Page) {
  const panel = (await page
    .getByRole('complementary', { name: 'Задача', exact: true })
    .boundingBox())!;
  for (const control of await page
    .locator('.gantt-toolbar, .workspace-heading')
    .locator('button:visible, select:visible, input:visible')
    .all()) {
    const box = (await control.boundingBox())!;
    expect(box.x).toBeGreaterThanOrEqual(0);
    expect(box.x + box.width).toBeLessThanOrEqual(panel.x + 1);
    expect(
      await control.evaluate((node) => {
        const r = node.getBoundingClientRect();
        const hit = document.elementFromPoint(
          r.x + r.width / 2,
          r.y + r.height / 2,
        );
        return hit !== null && (hit === node || node.contains(hit));
      }),
      (await control.getAttribute('aria-label')) ??
        (await control.textContent()) ??
        undefined,
    ).toBe(true);
  }
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  const tree = (await page.locator('.timeline-tree').boundingBox())!;
  const time = (await page.locator('.timeline-time').boundingBox())!;
  if (page.viewportSize()!.width >= 1280)
    expect(tree.width).toBeGreaterThanOrEqual(300);
  expect(time.width).toBeGreaterThanOrEqual(160);
  expect(time.x + time.width).toBeLessThanOrEqual(panel.x + 1);
}

test('desktop controls stay before the panel through layout changes without writes', async ({
  page,
}) => {
  const runtime = await syntheticRuntime();
  try {
    const before = await seedOptionalRuntime(page, runtime);
    const writes: string[] = [];
    page.on('request', (request) => {
      if (!['GET', 'HEAD'].includes(request.method()))
        writes.push(request.method());
    });
    await page.goto(runtime.origin);
    await page.getByRole('button', { name: 'Новый проект' }).click();
    await page
      .getByLabel('Название проекта', { exact: true })
      .fill('Synthetic project draft');
    await page.getByRole('treeitem', { name: /^Этап P,/ }).press('Enter');
    await page.screenshot({
      path: `/tmp/leaf-ui1-${page.viewportSize()!.width}.png`,
    });
    await geometry(page);
    await page
      .getByRole('searchbox', { name: 'Поиск задач', exact: true })
      .fill('Работа');
    await geometry(page);
    const toggle = page.locator('.project-sidebar-toggle');
    const actions = page.getByRole('button', {
      name: 'Действия проекта',
      exact: true,
    });
    await actions.focus();
    await actions.press('Enter');
    await expect(
      page.getByRole('button', { name: 'Настройки проекта' }),
    ).toBeVisible();
    await toggle.focus();
    await toggle.press('Enter');
    await expect(toggle).toBeFocused();
    await expect(toggle).toHaveAttribute('aria-expanded', 'false');
    await expect(page.getByRole('navigation', { name: 'Проекты' })).toHaveCount(
      0,
    );
    await expect(
      page.getByRole('button', { name: 'Настройки проекта' }),
    ).toHaveCount(0);
    await toggle.press('Tab');
    expect(
      await page.evaluate(
        () =>
          document.activeElement?.closest('.project-sidebar-content') !== null,
      ),
    ).toBe(false);
    await toggle.focus();
    await geometry(page);
    await toggle.press('Space');
    await expect(
      page.getByLabel('Название проекта', { exact: true }),
    ).toHaveValue('Synthetic project draft');
    await geometry(page);
    await page.setViewportSize({ width: 1200, height: 800 });
    await geometry(page);
    await toggle.click();
    for (const name of ['Актуальное', 'Журнал', 'Задачи']) {
      await page.getByRole('tab', { name, exact: true }).click();
      await expect(toggle).toHaveAttribute('aria-expanded', 'false');
      const main = (await page.locator('.workspace').boundingBox())!;
      const panel = (await page.locator('.task-panel').boundingBox())!;
      const sidebar = (await page.locator('.project-sidebar').boundingBox())!;
      expect(Math.abs(main.x + main.width - panel.x)).toBeLessThanOrEqual(1);
      expect(
        Math.abs(
          main.width - (page.viewportSize()!.width - sidebar.width - 480),
        ),
      ).toBeLessThanOrEqual(1);
      if (name === 'Актуальное')
        await expect(page.locator('.project-current-container')).toHaveCSS(
          'margin-inline-end',
          '0px',
        );
    }
    await page.reload();
    await expect(toggle).toHaveAttribute('aria-expanded', 'true');
    expect(writes).toEqual([]);
    expect(await readTree(page, runtime.origin, before.project.id)).toEqual(
      before,
    );
  } finally {
    try {
      await page.context().close();
    } finally {
      await runtime.close();
    }
  }
});

test('keyboard controls, draft state and responsive boundaries retain the synthetic plan', async ({
  page,
}) => {
  const runtime = await syntheticRuntime();
  try {
    let before = await seedOptionalRuntime(page, runtime);
    for (let n = 0; n < 30; n++)
      before = await send(page, runtime.origin, before, {
        type: 'task.create',
        title: `Synthetic long row ${n} with deliberately long title`,
        parentId: null,
      });
    let parentId = before.tasks[0]!.id;
    for (let n = 0; n < 6; n++) {
      before = await send(page, runtime.origin, before, {
        type: 'task.create',
        title: `Synthetic level ${n}`,
        parentId,
      });
      parentId = before.tasks.find(
        (task) => task.title === `Synthetic level ${n}`,
      )!.id;
    }
    const writes: string[] = [];
    page.on('request', (request) => {
      if (!['GET', 'HEAD'].includes(request.method()))
        writes.push(request.method());
    });
    await page.goto(runtime.origin);
    const row = page.getByRole('treeitem', { name: /^Этап P,/ });
    await row.press('Enter');
    const panel = page.getByRole('complementary', {
      name: 'Задача',
      exact: true,
    });
    const scale = page.getByLabel('Масштаб Ганта', { exact: true });
    expect(
      await scale
        .locator('option')
        .evaluateAll((nodes) =>
          nodes.map((node) => (node as HTMLOptionElement).value),
        ),
    ).toEqual(['days', 'weeks', 'months']);
    for (const value of ['months', 'weeks', 'days']) {
      await scale.selectOption(value);
      await geometry(page);
    }
    await scale.focus();
    await scale.press('ArrowDown');
    await scale.press('Enter');
    await expect(scale).toHaveValue('weeks');
    const initialPeriod = await page.locator('.gantt-month').allTextContents();
    const next = page.getByRole('button', { name: 'Следующий период' });
    await next.click();
    expect(await page.locator('.gantt-month').allTextContents()).not.toEqual(
      initialPeriod,
    );
    const previous = page.getByRole('button', { name: 'Предыдущий период' });
    await previous.focus();
    await previous.press('Space');
    expect(await page.locator('.gantt-month').allTextContents()).toEqual(
      initialPeriod,
    );
    await next.focus();
    await next.press('Enter');
    await page.getByRole('button', { name: 'Сегодня', exact: true }).click();

    const toolbar = page.locator('.gantt-toolbar');
    const box = (await toolbar.boundingBox())!;
    await page.getByRole('button', { name: 'Список', exact: true }).click();
    expect((await toolbar.boundingBox())!.height).toBe(44);
    expect((await toolbar.boundingBox())!.y).toBe(box.y);
    await page.getByRole('button', { name: 'Гант', exact: true }).click();
    expect((await toolbar.boundingBox())!.height).toBe(44);
    const divider = page.getByRole('separator');
    await divider.focus();
    for (let n = 0; n < 20; n++) await divider.press('ArrowRight');
    const chosenWidth = await page
      .locator('.task-timeline')
      .evaluate((node) =>
        (node as HTMLElement).style.getPropertyValue('--tree-width'),
      );
    expect(chosenWidth).toBe('620px');
    await geometry(page);
    const handle = (await divider.boundingBox())!;
    await page.mouse.move(handle.x + handle.width / 2, handle.y + 20);
    await page.mouse.down();
    await page.mouse.move(0, handle.y + 20);
    await page.mouse.up();
    await expect(divider).toHaveAttribute('aria-valuenow', '300');
    await geometry(page);
    const narrowHandle = (await divider.boundingBox())!;
    await page.mouse.move(
      narrowHandle.x + narrowHandle.width / 2,
      narrowHandle.y + 20,
    );
    await page.mouse.down();
    await page.mouse.move(page.viewportSize()!.width - 1, narrowHandle.y + 20);
    await page.mouse.up();
    await expect(divider).toHaveAttribute('aria-valuenow', '620');
    await geometry(page);
    const rowBox = (await row.boundingBox())!;
    const svgBox = (await page
      .locator(`[data-gantt-row="${before.tasks[0]!.id}"]`)
      .boundingBox())!;
    expect(Math.abs(svgBox.y - rowBox.y)).toBeLessThanOrEqual(1);
    await row.press('Shift+Enter');
    const quick = page.getByLabel('Новая задача', { exact: true });
    await quick.fill('Synthetic quick draft');
    await row.press('Enter');
    await panel
      .getByRole('button', { name: 'Добавить описание', exact: true })
      .click();
    const description = panel.getByLabel('Описание', { exact: true });
    await description.fill('Synthetic panel draft');
    const period = await page.locator('.gantt-month').first().textContent();
    const toggle = page.locator('.project-sidebar-toggle');
    const scrollAreas = [
      page.locator('[data-plan-scroll]'),
      page.locator('.timeline-time'),
    ];
    await scrollAreas[0]!.evaluate((node) => {
      node.scrollTop = 400;
    });
    await scrollAreas[1]!.evaluate((node) => {
      node.scrollLeft = 40;
    });
    async function retainScroll(action: () => Promise<void>) {
      const offsets = await Promise.all(
        scrollAreas.map((area) =>
          area.evaluate((node) => ({
            top: node.scrollTop,
            left: node.scrollLeft,
          })),
        ),
      );
      await action();
      for (let index = 0; index < scrollAreas.length; index++) {
        const area = scrollAreas[index]!;
        const expected = offsets[index]!;
        await expect
          .poll(() =>
            area.evaluate((node) => ({
              top: node.scrollTop,
              left: node.scrollLeft,
            })),
          )
          .toEqual(
            await area.evaluate(
              (node, offset) => ({
                top: Math.min(
                  offset.top,
                  node.scrollHeight - node.clientHeight,
                ),
                left: Math.min(
                  offset.left,
                  node.scrollWidth - node.clientWidth,
                ),
              }),
              expected,
            ),
          );
      }
    }
    await retainScroll(() => toggle.click());
    await retainScroll(() => toggle.click());
    await retainScroll(() =>
      page.setViewportSize({ width: 1200, height: 800 }),
    );
    await geometry(page);
    expect(
      await page
        .locator('.task-timeline')
        .evaluate((node) =>
          (node as HTMLElement).style.getPropertyValue('--tree-width'),
        ),
    ).toBe(chosenWidth);
    await expect(quick).toHaveValue('Synthetic quick draft');
    await expect(description).toHaveValue('Synthetic panel draft');
    await expect(row).toHaveAttribute('aria-selected', 'true');
    await expect(row).toHaveAttribute('aria-expanded', 'true');
    await expect(scale).toHaveValue('weeks');
    expect(await page.locator('.gantt-month').first().textContent()).toEqual(
      period,
    );
    for (const [width, position] of [
      [1199, 'absolute'],
      [1200, 'static'],
      [899, 'fixed'],
      [900, 'absolute'],
    ] as const) {
      await page.setViewportSize({ width, height: 800 });
      await expect(panel).toHaveCSS('position', position);
      if (width === 899) expect((await panel.boundingBox())!.width).toBe(899);
    }
    // Responsive focus uses real media-query change events; viewport resizing is not browser zoom.
    await page.setViewportSize({ width: 1200, height: 800 });
    await panel
      .getByRole('button', { name: 'Сбросить изменения', exact: true })
      .click();
    await panel
      .getByRole('button', { name: 'Закрыть панель', exact: true })
      .click();
    expect((await page.locator('.timeline-tree').boundingBox())!.width).toBe(
      620,
    );
    await toggle.click();
    await page.setViewportSize({ width: 601, height: 800 });
    await toggle.focus();
    await page.setViewportSize({ width: 600, height: 800 });
    await expect(toggle).toBeHidden();
    await expect(
      page.getByRole('button', { name: 'Новый проект' }),
    ).toBeFocused();
    await page.setViewportSize({ width: 601, height: 800 });
    await expect(toggle).toBeVisible();
    await expect(toggle).toBeFocused();
    await expect(toggle).toHaveAttribute('aria-expanded', 'false');
    expect(writes).toEqual([]);
    expect(await readTree(page, runtime.origin, before.project.id)).toEqual(
      before,
    );
  } finally {
    try {
      await page.context().close();
    } finally {
      await runtime.close();
    }
  }
});

test('sidebar remains available during loading, failed reads, retry and no-match results', async ({
  page,
}) => {
  const runtime = await syntheticRuntime();
  try {
    await seedOptionalRuntime(page, runtime);
    const empty = await page.request.post(runtime.origin + '/api/projects', {
      headers: { Origin: runtime.origin, 'X-Leaf-Contract-Version': '2' },
      data: { title: 'Synthetic empty project' },
    });
    expect(empty.status()).toBe(201);
    let release!: () => void;
    const pending = new Promise<void>((resolve) => {
      release = resolve;
    });
    let first = true;
    await page.route('**/api/projects/*/tree', async (route) => {
      if (first) {
        first = false;
        await pending;
        await route.fulfill({
          status: 503,
          contentType: 'application/json',
          body: JSON.stringify({
            code: 'unavailable',
            message: 'Synthetic read failure',
          }),
        });
      } else await route.continue();
    });
    await page.goto(runtime.origin);
    const toggle = page.locator('.project-sidebar-toggle');
    await expect(toggle).toBeVisible();
    await toggle.click();
    await expect(toggle).toHaveAttribute('aria-expanded', 'false');
    release();
    const retry = page.getByRole('button', { name: 'Повторить', exact: true });
    await expect(retry).toBeVisible();
    await retry.click();
    await page.getByRole('treeitem', { name: /^Этап P,/ }).press('Enter');
    await page
      .getByRole('searchbox', { name: 'Поиск задач', exact: true })
      .fill('Synthetic no matching task');
    await expect(
      page.getByText('Ничего не найдено. Измените поиск или статус.'),
    ).toBeVisible();
    await geometry(page);
    await toggle.click();
    await page
      .getByRole('button', { name: 'Synthetic empty project', exact: true })
      .click();
    await expect(
      page.getByText('В проекте пока нет задач.', { exact: true }),
    ).toBeVisible();
    await expect(page.locator('.gantt-toolbar')).toBeVisible();
    await expect(
      page.getByRole('button', { name: 'Следующий период' }),
    ).toBeVisible();
    await expect(toggle).toBeVisible();
  } finally {
    try {
      await page.context().close();
    } finally {
      await runtime.close();
    }
  }
});
