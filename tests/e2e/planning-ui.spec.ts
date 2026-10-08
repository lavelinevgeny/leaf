import { test, expect } from '@playwright/test';
import { syntheticRuntime } from '../../scripts/e2e-server.js';
import {
  seedOptionalRuntime,
  readTree,
  send,
} from '../helpers/optional-e2e.js';
test('Gantt keyboard move, resize choice cancellation, explicit clearing and undo match persisted source', async ({
  page,
}) => {
  const runtime = await syntheticRuntime();
  try {
    let tree = await seedOptionalRuntime(page, runtime);
    const a = tree.tasks.find((t) => t.title === 'Работа A')!.id;
    tree = await send(page, runtime.origin, tree, {
      type: 'task.edit',
      taskId: a,
      changes: { durationDays: 2 },
    });
    await page.goto(runtime.origin);
    const bar = page.getByRole('button', { name: /Работа A, 2026/ });
    await bar.focus();
    await page.keyboard.press('ArrowRight');
    await expect(bar).toHaveAttribute('aria-label', /2026-10-06 – 2026-10-07/);
    tree = await readTree(page, runtime.origin, tree.project.id);
    expect(tree.tasks.find((t) => t.id === a)).toMatchObject({
      inputStart: '2026-10-06',
      inputFinish: '2026-10-07',
      durationDays: 2,
    });
    await bar.focus();
    await page.keyboard.press('Shift+ArrowRight');
    await expect(
      page.getByRole('dialog', { name: 'Длительность не совпадает' }),
    ).toBeVisible();
    await page.getByRole('button', { name: 'Отмена', exact: true }).click();
    expect(
      (await readTree(page, runtime.origin, tree.project.id)).project.revision,
    ).toBe(tree.project.revision);
    await bar.focus();
    await page.keyboard.press('Shift+ArrowRight');
    await page
      .getByRole('button', { name: 'Очистить длительность', exact: true })
      .click();
    await expect(bar).toHaveAttribute('aria-label', /2026-10-08/);
    expect(
      (await readTree(page, runtime.origin, tree.project.id)).tasks.find(
        (t) => t.id === a,
      )!.durationDays,
    ).toBeNull();
    await page
      .getByRole('button', { name: 'Отменить последнее изменение' })
      .click();
    await expect(bar).toHaveAttribute('aria-label', /2026-10-06 – 2026-10-07/);
    const box = await page.locator(`[data-gantt-bar="${a}"]`).boundingBox();
    expect(box).not.toBeNull();
    await page.mouse.move(box!.x + 10, box!.y + 10);
    await page.mouse.down();
    await page.mouse.move(box!.x + 70, box!.y + 10);
    await page.keyboard.press('Escape');
    await page.mouse.up();
    expect(
      (await readTree(page, runtime.origin, tree.project.id)).tasks.find(
        (t) => t.id === a,
      )!.inputStart,
    ).toBe('2026-10-06');
  } finally {
    await runtime.close();
  }
});
test('project settings preserve dirty calendar draft, done requires return and panel keyboard focus survives close', async ({
  page,
}) => {
  const runtime = await syntheticRuntime();
  try {
    await seedOptionalRuntime(page, runtime);
    await page.goto(runtime.origin);
    const projectActions = page.getByRole('button', {
      name: 'Действия проекта',
    });
    await projectActions.focus();
    await page.keyboard.press('Enter');
    await expect(
      page.getByRole('button', { name: 'Настройки проекта', exact: true }),
    ).toBeFocused();
    await page.keyboard.press('Escape');
    await expect(projectActions).toBeFocused();
    await page.keyboard.press('Space');
    await page
      .getByRole('button', { name: 'Настройки проекта', exact: true })
      .click();
    await page
      .getByLabel('Часовой пояс проекта', { exact: true })
      .fill('Europe/Moscow');
    await expect(
      page.getByRole('button', {
        name: 'Сохранить настройки проекта',
        exact: true,
      }),
    ).toBeEnabled();
    await page.keyboard.press('Escape');
    await expect(
      page.getByLabel('Часовой пояс проекта', { exact: true }),
    ).toHaveValue('Europe/Moscow');
    await expect(
      page.getByRole('complementary', { name: 'Задача', exact: true }),
    ).toHaveCount(0);
    await page
      .getByRole('button', { name: 'Сохранить настройки проекта', exact: true })
      .click();
    await expect(
      page.getByRole('button', {
        name: 'Сохранить настройки проекта',
        exact: true,
      }),
    ).toBeDisabled();
    await expect(
      page.getByRole('button', { name: 'Закрыть', exact: true }),
    ).toBeEnabled();
    await page.keyboard.press('Escape');
    await expect(projectActions).toBeFocused();
    await page.getByRole('treeitem', { name: /Работа A,/ }).click();
    await page.getByLabel('Статус', { exact: true }).selectOption('done');
    await page.getByRole('button', { name: 'Сохранить', exact: true }).click();
    await expect(page.getByText('Сохранено', { exact: true })).toBeVisible();
    await expect(page.getByLabel('Начало', { exact: true })).toBeDisabled();
    await page.getByLabel('Статус', { exact: true }).selectOption('doing');
    await expect(page.getByLabel('Начало', { exact: true })).toBeEnabled();
    await page.getByLabel('Начало', { exact: true }).fill('2026-10-06');
    await page.getByRole('button', { name: 'Сохранить', exact: true }).click();
    await expect(page.getByText('Сохранено', { exact: true })).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(
      page.getByRole('treeitem', { name: /Работа A,/ }),
    ).toBeFocused();
    await page.keyboard.press('Enter');
    await expect(
      page.getByRole('complementary', { name: 'Задача', exact: true }),
    ).toBeVisible();
    await page.keyboard.press('Tab');
  } finally {
    await runtime.close();
  }
});
test('project rename preserves dirty Escape and returns focus after save and clean close', async ({
  page,
}) => {
  const runtime = await syntheticRuntime();
  try {
    const initial = await seedOptionalRuntime(page, runtime);
    await page.goto(runtime.origin);
    const opener = page.getByRole('button', { name: 'Действия проекта' });
    await opener.click();
    await page
      .getByRole('button', { name: 'Переименовать проект', exact: true })
      .click();
    const dialog = page.getByRole('dialog', {
      name: 'Переименовать проект',
      exact: true,
    });
    const title = dialog.getByLabel('Название проекта', { exact: true });
    await title.fill('Переименованный демо-проект');
    await page.keyboard.press('Escape');
    await expect(title).toHaveValue('Переименованный демо-проект');
    expect(
      (await readTree(page, runtime.origin, initial.project.id)).project
        .revision,
    ).toBe(initial.project.revision);
    await dialog
      .getByRole('button', { name: 'Переименовать проект', exact: true })
      .click();
    await expect(
      page.getByRole('heading', { name: 'Переименованный демо-проект' }),
    ).toBeVisible();
    await expect(dialog).toHaveCount(0);
    await expect(opener).toBeFocused();
    const renamed = await readTree(page, runtime.origin, initial.project.id);
    expect(renamed.project.revision).toBe(initial.project.revision + 1);
    expect(renamed.tasks).toEqual(initial.tasks);
    await opener.click();
    await page
      .getByRole('button', { name: 'Настройки проекта', exact: true })
      .click();
    await page.getByRole('button', { name: 'Закрыть', exact: true }).click();
    await expect(opener).toBeFocused();
  } finally {
    await runtime.close();
  }
});
test('long project title keeps the first task within the compact header limit', async ({
  page,
}) => {
  const runtime = await syntheticRuntime();
  try {
    let tree = await seedOptionalRuntime(page, runtime);
    for (let index = 0; index < 12; index++)
      tree = await send(page, runtime.origin, tree, {
        type: 'task.create',
        title: `Дополнительная работа ${index + 1}`,
        parentId: null,
      });
    const title =
      'Демонстрационный проект с длинным названием для проверки компактной шапки рабочего пространства'.slice(
        0,
        90,
      );
    expect(title).toHaveLength(90);
    const renamed = await page.request.patch(
      `${runtime.origin}/api/projects/${tree.project.id}`,
      {
        headers: { Origin: runtime.origin, 'X-Leaf-Contract-Version': '2' },
        data: {
          contractVersion: 2,
          expectedRevision: tree.project.revision,
          operationId: crypto.randomUUID(),
          title,
        },
      },
    );
    expect(renamed.status()).toBe(200);
    await page.goto(runtime.origin);
    const heading = page.getByRole('heading', { name: title, exact: true });
    await expect(heading).toBeVisible();
    const first = await page.getByRole('treeitem').first().boundingBox();
    expect(first).not.toBeNull();
    expect(first!.y).toBeLessThanOrEqual(230);
    const rows = await page.getByRole('treeitem').evaluateAll(
      (elements) =>
        elements.filter((element) => {
          const box = element.getBoundingClientRect();
          return (
            box.top >= 0 &&
            box.bottom <=
              Math.min(
                window.innerHeight,
                element.closest('.plan-scroll')!.getBoundingClientRect().bottom,
              )
          );
        }).length,
    );
    expect(rows).toBeGreaterThanOrEqual(10);
    const overflow = await page
      .locator('.workspace')
      .evaluate((element) => element.scrollWidth > element.clientWidth);
    expect(overflow).toBe(false);
    for (const control of [
      page.getByRole('button', { name: 'Действия проекта' }),
      page.getByRole('searchbox', { name: 'Поиск задач' }),
      page.getByRole('combobox', { name: 'Фильтр по статусу' }),
    ]) {
      const box = await control.boundingBox();
      expect(box).not.toBeNull();
      expect(box!.x + box!.width).toBeLessThanOrEqual(
        page.viewportSize()!.width,
      );
    }
    console.log(
      `CW01 ${page.viewportSize()!.width}x${page.viewportSize()!.height}: first row y=${first!.y}, fully visible rows=${rows}, overflow=${overflow}`,
    );
    await page.getByRole('treeitem').first().click();
    await expect(
      page.getByRole('complementary', { name: 'Задача', exact: true }),
    ).toBeVisible();
    const panelFirst = await page.getByRole('treeitem').first().boundingBox();
    expect(panelFirst!.y).toBeLessThanOrEqual(230);
    await expect(heading).toBeVisible();
    const actions = page.getByRole('button', { name: 'Действия проекта' });
    await actions.click();
    await expect(
      page.getByRole('button', { name: 'Настройки проекта', exact: true }),
    ).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(actions).toBeFocused();
    await expect(
      page.getByRole('complementary', { name: 'Задача', exact: true }),
    ).toBeVisible();
  } finally {
    await runtime.close();
  }
});
