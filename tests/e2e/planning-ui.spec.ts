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
    const initial = await seedOptionalRuntime(page, runtime);
    expect(initial.project.timezone).toBe('UTC');
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
    expect(
      (await readTree(page, runtime.origin, initial.project.id)).project
        .revision,
    ).toBe(initial.project.revision);
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
    await page.getByRole('navigation', { name: 'Проекты' }).hover();
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
    await page.getByRole('navigation', { name: 'Проекты' }).hover();
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
      page.getByRole('button', { name: /^Фильтры/ }),
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
    await page.getByRole('navigation', { name: 'Проекты' }).hover();
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

test('C27 left keyboard and pointer persist fixed finish, nullable undo and focus across reload', async ({
  page,
}) => {
  const runtime = await syntheticRuntime();
  try {
    const initial = await seedOptionalRuntime(page, runtime);
    const a = initial.tasks.find((t) => t.title === 'Работа A')!.id;
    await page.goto(runtime.origin);
    const left = page.getByRole('button', {
      name: 'Изменить начало: Работа A',
      exact: true,
    });
    const bar = page.locator(`[data-gantt-bar="${a}"]`);
    const before = await bar.boundingBox();
    await left.focus();
    await page.keyboard.press('ArrowLeft');
    await expect(
      page.getByRole('button', { name: /Работа A, 2026/ }),
    ).toHaveAttribute('aria-label', /2026-10-02 – 2026-10-06/);
    await expect(left).toBeFocused();
    let changed = await readTree(page, runtime.origin, initial.project.id);
    expect(changed.tasks.find((t) => t.id === a)).toMatchObject({
      inputStart: '2026-10-02',
      inputFinish: '2026-10-06',
      durationDays: 3,
    });
    expect(changed.project.revision).toBe(initial.project.revision + 1);
    expect(
      page.getByRole('dialog', { name: 'Длительность не совпадает' }),
    ).toBeHidden();
    const after = await bar.boundingBox();
    expect(after!.x + after!.width).toBeCloseTo(before!.x + before!.width, 5);
    await page.reload();
    await expect(
      page.getByRole('button', { name: /Работа A, 2026/ }),
    ).toHaveAttribute('aria-label', /2026-10-02 – 2026-10-06/);
    await page
      .getByRole('button', { name: 'Отменить последнее изменение' })
      .click();
    await expect(
      page.getByRole('button', { name: /Работа A, 2026/ }),
    ).toHaveAttribute('aria-label', /2026-10-05 – 2026-10-06/);
    const undone = await readTree(page, runtime.origin, initial.project.id);
    expect(undone.tasks.find((t) => t.id === a)).toMatchObject({
      inputStart: '2026-10-05',
      inputFinish: '2026-10-06',
      durationDays: null,
    });
    const box = await left.boundingBox(),
      original = await bar.boundingBox();
    await page.mouse.move(box!.x + box!.width / 2, box!.y + 10);
    await page.mouse.down();
    await page.mouse.move(box!.x + box!.width / 2 - 90, box!.y + 10);
    const preview = await bar.boundingBox();
    expect(preview!.x).toBeCloseTo(original!.x - 90, 5);
    expect(preview!.x + preview!.width).toBeCloseTo(
      original!.x + original!.width,
      5,
    );
    await page.mouse.up();
    await expect(
      page.getByRole('button', { name: /Работа A, 2026/ }),
    ).toHaveAttribute('aria-label', /2026-10-02 – 2026-10-06/);
    changed = await readTree(page, runtime.origin, initial.project.id);
    expect(changed.project.revision).toBe(undone.project.revision + 1);
    expect(changed.tasks.find((t) => t.id === a)).toMatchObject({
      inputStart: '2026-10-02',
      inputFinish: '2026-10-06',
      durationDays: 3,
    });
    await expect(
      page.getByRole('complementary', { name: 'Задача', exact: true }),
    ).toHaveCount(0);
    await runtime.restart();
    await page.reload();
    expect(await readTree(page, runtime.origin, initial.project.id)).toEqual(
      changed,
    );
  } finally {
    await runtime.close();
  }
});

test('C27 rejects weekend and cancels left gestures on Escape, lost capture, scale and filter', async ({
  page,
}) => {
  const runtime = await syntheticRuntime();
  try {
    const initial = await seedOptionalRuntime(page, runtime);
    const a = initial.tasks.find((t) => t.title === 'Работа A')!.id;
    await page.goto(runtime.origin);
    const left = page.locator(`[data-gantt-resize-start="${a}"]`);
    for (const reason of [
      'weekend',
      'Escape',
      'capture',
      'scale',
      'filter',
      'noop',
    ]) {
      const box = await left.boundingBox();
      await page.mouse.move(box!.x + box!.width / 2, box!.y + 10);
      await page.mouse.down();
      await page.mouse.move(
        box!.x +
          box!.width / 2 +
          (reason === 'weekend' ? -60 : reason === 'noop' ? 0 : -90),
        box!.y + 10,
      );
      if (reason === 'Escape') await page.keyboard.press('Escape');
      if (reason === 'capture')
        await left.dispatchEvent('lostpointercapture', { pointerId: 1 });
      if (reason === 'scale')
        await page
          .getByRole('combobox', { name: 'Масштаб Ганта' })
          .selectOption('weeks');
      if (reason === 'filter')
        await page
          .getByRole('searchbox', { name: 'Поиск задач' })
          .fill('Работа C');
      await page.mouse.up();
      if (reason === 'weekend')
        await expect(page.getByRole('status')).toContainText(
          'Недопустимая дата',
        );
      expect(await readTree(page, runtime.origin, initial.project.id)).toEqual(
        initial,
      );
      if (reason === 'scale')
        await page
          .getByRole('combobox', { name: 'Масштаб Ганта' })
          .selectOption('days');
      if (reason === 'filter')
        await page.getByRole('searchbox', { name: 'Поиск задач' }).fill('');
    }
  } finally {
    await runtime.close();
  }
});

test('C27 FS rollback keeps source and focus; later start preserves successor and edges', async ({
  page,
}) => {
  const runtime = await syntheticRuntime();
  try {
    let tree = await seedOptionalRuntime(page, runtime);
    const a = tree.tasks.find((t) => t.title === 'Работа A')!.id,
      c = tree.tasks.find((t) => t.title === 'Работа C')!.id;
    tree = await send(page, runtime.origin, tree, {
      type: 'task.edit',
      taskId: c,
      changes: {
        inputStart: '2026-10-07',
        inputFinish: '2026-10-09',
        durationDays: 3,
        predecessorIds: [a],
      },
    });
    tree = await send(page, runtime.origin, tree, {
      type: 'task.create',
      parentId: null,
      title: 'Работа D',
      inputStart: '2026-10-12',
      inputFinish: '2026-10-13',
      durationDays: 2,
      predecessorIds: [c],
    });
    const d = tree.tasks.find((t) => t.title === 'Работа D')!.id;
    await page.goto(runtime.origin);
    const left = page.getByRole('button', {
      name: 'Изменить начало: Работа C',
      exact: true,
    });
    await left.focus();
    await page.keyboard.press('ArrowLeft');
    await expect(
      page.getByText(/после окончания|нарушает FS/i).first(),
    ).toBeVisible();
    await expect(left).toBeFocused();
    expect(await readTree(page, runtime.origin, tree.project.id)).toEqual(tree);
    await page.keyboard.press('ArrowRight');
    await expect(
      page.getByRole('button', { name: /Работа C, 2026/ }),
    ).toHaveAttribute('aria-label', /2026-10-08 – 2026-10-09/);
    await expect(left).toBeFocused();
    const changed = await readTree(page, runtime.origin, tree.project.id);
    expect(changed.tasks.find((t) => t.id === c)).toMatchObject({
      inputStart: '2026-10-08',
      inputFinish: '2026-10-09',
      durationDays: 2,
    });
    expect(changed.tasks.find((t) => t.id === a)).toEqual(
      tree.tasks.find((t) => t.id === a),
    );
    expect(changed.tasks.find((t) => t.id === d)).toEqual(
      tree.tasks.find((t) => t.id === d),
    );
    expect(changed.dependencies).toEqual(tree.dependencies);
    expect(changed.project.revision).toBe(tree.project.revision + 1);
    await page.getByRole('treeitem', { name: /Работа C,/ }).click();
    await page
      .getByLabel('Описание', { exact: true })
      .fill('Синтетический черновик');
    await expect(left).toHaveCount(0);
    const guardedBody = page.getByRole('button', { name: /Работа C, 2026/ });
    await guardedBody.focus();
    await page.keyboard.press('ArrowLeft');
    expect(await readTree(page, runtime.origin, tree.project.id)).toEqual(
      changed,
    );
  } finally {
    await runtime.close();
  }
});

test('C27 uncertain response retries exact operation and renders canonical source only after ack', async ({
  page,
}) => {
  const runtime = await syntheticRuntime();
  try {
    const initial = await seedOptionalRuntime(page, runtime),
      a = initial.tasks.find((t) => t.title === 'Работа A')!.id;
    await page.goto(runtime.origin);
    const envelopes: unknown[] = [];
    await page.route('**/api/projects/*/commands', async (route) => {
      envelopes.push(route.request().postDataJSON());
      if (envelopes.length === 1) {
        const applied = await route.fetch();
        expect(applied.status()).toBe(200);
        await route.abort('failed');
      } else await route.continue();
    });
    const left = page.getByRole('button', {
      name: 'Изменить начало: Работа A',
      exact: true,
    });
    await left.focus();
    await page.keyboard.press('ArrowLeft');
    await expect(
      page.getByRole('button', { name: 'Повторить', exact: true }),
    ).toBeVisible();
    await expect(left).toHaveCount(0);
    await expect(
      page.getByRole('button', { name: /Работа A, 2026/ }),
    ).toHaveAttribute('aria-label', /2026-10-05 – 2026-10-06/);
    const applied = await readTree(page, runtime.origin, initial.project.id);
    expect(applied.project.revision).toBe(initial.project.revision + 1);
    expect(applied.tasks.find((t) => t.id === a)).toMatchObject({
      inputStart: '2026-10-02',
      inputFinish: '2026-10-06',
      durationDays: 3,
    });
    await page.getByRole('button', { name: 'Повторить', exact: true }).click();
    await expect(left).toBeFocused();
    await expect(
      page.getByRole('button', { name: /Работа A, 2026/ }),
    ).toHaveAttribute('aria-label', /2026-10-02 – 2026-10-06/);
    expect(envelopes).toHaveLength(2);
    expect(envelopes[1]).toEqual(envelopes[0]);
    expect(await readTree(page, runtime.origin, initial.project.id)).toEqual(
      applied,
    );
  } finally {
    await runtime.close();
  }
});

test('C27 competing real write yields 409, preserves source and resumes focus after reload', async ({
  page,
}) => {
  const runtime = await syntheticRuntime();
  let release!: () => void;
  try {
    let tree = await seedOptionalRuntime(page, runtime);
    const a = tree.tasks.find((t) => t.title === 'Работа A')!.id;
    await page.goto(runtime.origin);
    let reached!: () => void;
    const arrived = new Promise<void>((r) => {
        reached = r;
      }),
      held = new Promise<void>((r) => {
        release = r;
      });
    await page.route(
      '**/api/projects/*/commands',
      async (route) => {
        reached();
        await held;
        await route.continue();
      },
      { times: 1 },
    );
    const left = page.getByRole('button', {
      name: 'Изменить начало: Работа A',
      exact: true,
    });
    await left.focus();
    await page.keyboard.press('ArrowLeft');
    await arrived;
    tree = await send(page, runtime.origin, tree, {
      type: 'task.edit',
      taskId: a,
      changes: { description: 'Синтетическая конкурирующая запись' },
    });
    const response = page.waitForResponse(
      (r) => r.url().endsWith('/commands') && r.status() === 409,
    );
    release();
    await response;
    await expect(
      page.getByText(/Проект изменён в другой сессии/),
    ).toBeVisible();
    expect(await readTree(page, runtime.origin, tree.project.id)).toEqual(tree);
    await expect(left).toHaveCount(0);
    await page
      .getByRole('button', { name: 'Загрузить актуальный проект', exact: true })
      .click();
    await expect(left).toBeFocused();
    await expect(
      page.getByRole('button', { name: /Работа A, 2026/ }),
    ).toHaveAttribute('aria-label', /2026-10-05 – 2026-10-06/);
    await page.keyboard.press('ArrowRight');
    await expect(
      page.getByRole('button', { name: /Работа A, 2026/ }),
    ).toHaveAttribute('aria-label', /2026-10-06 – 2026-10-06/);
    const changed = await readTree(page, runtime.origin, tree.project.id);
    expect(changed.tasks.find((t) => t.id === a)).toMatchObject({
      inputStart: '2026-10-06',
      inputFinish: '2026-10-06',
      durationDays: 1,
    });
    expect(changed.project.revision).toBe(tree.project.revision + 1);
  } finally {
    release?.();
    await runtime.close();
  }
});

test('C27 one-day edges/body remain separate at each scale and cannot cross finish', async ({
  page,
}) => {
  const runtime = await syntheticRuntime();
  try {
    let tree = await seedOptionalRuntime(page, runtime);
    const a = tree.tasks.find((t) => t.title === 'Работа A')!.id;
    tree = await send(page, runtime.origin, tree, {
      type: 'task.edit',
      taskId: a,
      changes: {
        inputStart: '2026-10-06',
        inputFinish: '2026-10-06',
        durationDays: 1,
      },
    });
    await page.goto(runtime.origin);
    const left = page.locator(`[data-gantt-resize-start="${a}"]`),
      right = page.locator(`[data-gantt-resize="${a}"]`),
      bar = page.locator(`[data-gantt-bar="${a}"]`);
    for (const scale of ['days', 'weeks', 'months']) {
      await page
        .getByRole('combobox', { name: 'Масштаб Ганта' })
        .selectOption(scale);
      const l = await left.boundingBox(),
        r = await right.boundingBox(),
        b = await bar.boundingBox();
      expect(l!.x + l!.width).toBeLessThan(r!.x);
      // The bar bounding box includes its 1px stroke; handles have no stroke.
      expect(b!.x + b!.width - r!.x - r!.width).toBeCloseTo(0.5, 5);
      for (const node of [left]) {
        const box = await node.boundingBox();
        await page.mouse.move(box!.x + box!.width / 2, box!.y + 10);
        await page.mouse.down();
        await page.mouse.up();
      }
      await left.focus();
      await page.keyboard.press('Shift+ArrowRight');
      await expect(page.getByRole('status')).toContainText('Недопустимая дата');
      await expect(left).toBeFocused();
      expect(await readTree(page, runtime.origin, tree.project.id)).toEqual(
        tree,
      );
      await expect(
        page.getByRole('complementary', { name: 'Задача', exact: true }),
      ).toHaveCount(0);
      const dayWidth = { days: 30, weeks: 14, months: 6 }[
        scale as 'days' | 'weeks' | 'months'
      ];
      // Hit the body between the two edges, including the 2px month-scale body.
      await page.mouse.move(b!.x + b!.width / 2, b!.y + b!.height / 2);
      await page.mouse.down();
      await page.mouse.move(
        b!.x + b!.width / 2 - dayWidth,
        b!.y + b!.height / 2,
      );
      await page.mouse.up();
      await expect(
        page.getByRole('button', { name: /Работа A, 2026/ }),
      ).toHaveAttribute('aria-label', /2026-10-05 – 2026-10-05/);
      const moved = await readTree(page, runtime.origin, tree.project.id);
      expect(moved.tasks.find((t) => t.id === a)).toMatchObject({
        inputStart: '2026-10-05',
        inputFinish: '2026-10-05',
        durationDays: 1,
      });
      expect(moved.project.revision).toBe(tree.project.revision + 1);
      await page
        .getByRole('button', { name: 'Отменить последнее изменение' })
        .click();
      await expect(
        page.getByRole('button', { name: /Работа A, 2026/ }),
      ).toHaveAttribute('aria-label', /2026-10-06 – 2026-10-06/);
      tree = await readTree(page, runtime.origin, tree.project.id);
    }
  } finally {
    await runtime.close();
  }
});

test('C27 empty/loading/error and done/summary/conditional states never expose left actions', async ({
  page,
}) => {
  const runtime = await syntheticRuntime();
  let release!: () => void;
  try {
    expect(
      (
        await page.request.post(`${runtime.origin}/api/auth/login`, {
          headers: { Origin: runtime.origin },
          data: { password: runtime.password },
        })
      ).status(),
    ).toBe(200);
    const created = await page.request.post(`${runtime.origin}/api/projects`, {
      headers: { Origin: runtime.origin, 'X-Leaf-Contract-Version': '2' },
      data: { title: 'Синтетическое пустое состояние' },
    });
    expect(created.status()).toBe(201);
    const projectId = (await created.json()).id;
    let reached!: () => void;
    const arrived = new Promise<void>((r) => {
        reached = r;
      }),
      held = new Promise<void>((r) => {
        release = r;
      });
    await page.route(
      '**/api/projects/*/tree',
      async (route) => {
        reached();
        await held;
        await route.fulfill({
          status: 503,
          contentType: 'application/json',
          body: JSON.stringify({
            code: 'SYNTHETIC_FAILURE',
            message: 'Синтетическая ошибка загрузки',
          }),
        });
      },
      { times: 1 },
    );
    await page.goto(runtime.origin);
    await arrived;
    await expect(page.getByText('Загрузка…', { exact: true })).toBeVisible();
    await expect(page.locator('[data-gantt-resize-start]')).toHaveCount(0);
    release();
    await expect(page.getByText('Синтетическая ошибка загрузки')).toBeVisible();
    await expect(page.locator('[data-gantt-resize-start]')).toHaveCount(0);
    await page.reload();
    await expect(page.getByText('В проекте пока нет задач.')).toBeVisible();
    let tree = await readTree(page, runtime.origin, projectId);
    tree = await send(page, runtime.origin, tree, {
      type: 'task.create',
      parentId: null,
      title: 'Группа',
    });
    const parent = tree.tasks[0]!.id;
    tree = await send(page, runtime.origin, tree, {
      type: 'task.create',
      parentId: parent,
      title: 'Завершённая работа',
      inputStart: '2026-10-05',
      inputFinish: '2026-10-06',
      durationDays: 2,
    });
    const done = tree.tasks.find((t) => t.title === 'Завершённая работа')!.id;
    tree = await send(page, runtime.origin, tree, {
      type: 'task.edit',
      taskId: done,
      changes: { status: 'done' },
    });
    tree = await send(page, runtime.origin, tree, {
      type: 'task.create',
      parentId: null,
      title: 'Условная работа',
      durationDays: 1,
    });
    await page.reload();
    await expect(
      page.getByRole('treeitem', { name: /Завершённая работа,/ }),
    ).toBeVisible();
    await expect(page.locator('[data-gantt-resize-start]')).toHaveCount(0);
    const conditional = page.getByRole('button', {
      name: /Условная работа, 2026/,
    });
    await conditional.focus();
    await page.keyboard.press('ArrowLeft');
    expect(await readTree(page, runtime.origin, projectId)).toEqual(tree);
  } finally {
    release?.();
    await runtime.close();
  }
});

test('C27 uses changed all-days calendar while panel C18 and right duration choice keep their semantics', async ({
  page,
}) => {
  const runtime = await syntheticRuntime();
  try {
    let tree = await seedOptionalRuntime(page, runtime);
    const a = tree.tasks.find((t) => t.title === 'Работа A')!.id;
    tree = await send(page, runtime.origin, tree, {
      type: 'project.schedule',
      changes: { calendarType: 'all-days' },
    });
    await page.goto(runtime.origin);
    const left = page.getByRole('button', {
        name: 'Изменить начало: Работа A',
        exact: true,
      }),
      body = page.getByRole('button', { name: /Работа A, 2026/ });
    await left.focus();
    await page.keyboard.press('ArrowLeft');
    await expect(body).toHaveAttribute('aria-label', /2026-10-04 – 2026-10-06/);
    const changed = await readTree(page, runtime.origin, tree.project.id);
    expect(changed.tasks.find((t) => t.id === a)).toMatchObject({
      inputStart: '2026-10-04',
      inputFinish: '2026-10-06',
      durationDays: 3,
    });
    await page.getByRole('treeitem', { name: /Работа A,/ }).click();
    await page.getByLabel('Начало', { exact: true }).fill('2026-10-05');
    await page.getByLabel('Начало', { exact: true }).press('Tab');
    await expect(page.getByLabel('Окончание', { exact: true })).toHaveValue(
      '07.10.2026',
    );
    await page.getByRole('button', { name: 'Сохранить', exact: true }).click();
    await expect(page.getByText('Сохранено', { exact: true })).toBeVisible();
    await page.keyboard.press('Escape');
    await body.focus();
    await page.keyboard.press('Shift+ArrowRight');
    await expect(
      page.getByRole('dialog', { name: 'Длительность не совпадает' }),
    ).toBeVisible();
    await page.getByRole('button', { name: 'Отмена', exact: true }).click();
    const final = await readTree(page, runtime.origin, tree.project.id);
    expect(final.tasks.find((t) => t.id === a)).toMatchObject({
      inputStart: '2026-10-05',
      inputFinish: '2026-10-07',
      durationDays: 3,
    });
    expect(final.project.revision).toBe(changed.project.revision + 1);
  } finally {
    await runtime.close();
  }
});

test('C27 boundary keyboard ack reveals real start and keeps focus for a further edit', async ({
  page,
}) => {
  const runtime = await syntheticRuntime();
  try {
    const initial = await seedOptionalRuntime(page, runtime);
    const a = initial.tasks.find((t) => t.title === 'Работа A')!.id;
    await page.goto(runtime.origin);
    const left = page.getByRole('button', {
      name: 'Изменить начало: Работа A',
      exact: true,
    });
    await left.focus();
    await page.keyboard.press('ArrowLeft');
    await expect(left).toBeFocused();
    await expect(
      page.getByRole('button', { name: /Работа A, 2026/ }),
    ).toHaveAttribute('aria-label', /2026-10-02 – 2026-10-06/);
    await page.keyboard.press('ArrowLeft');
    await expect(
      page.getByRole('button', { name: /Работа A, 2026/ }),
    ).toHaveAttribute('aria-label', /2026-10-01 – 2026-10-06/);
    await expect(left).toBeVisible();
    await expect(left).toBeFocused();
    let changed = await readTree(page, runtime.origin, initial.project.id);
    expect(changed.tasks.find((t) => t.id === a)).toMatchObject({
      inputStart: '2026-10-01',
      inputFinish: '2026-10-06',
      durationDays: 4,
    });
    expect(changed.project.revision).toBe(initial.project.revision + 2);
    await page.keyboard.press('ArrowLeft');
    await expect(left).toBeFocused();
    await expect(
      page.getByRole('button', { name: /Работа A, 2026/ }),
    ).toHaveAttribute('aria-label', /2026-09-30 – 2026-10-06/);
    changed = await readTree(page, runtime.origin, initial.project.id);
    expect(changed.tasks.find((t) => t.id === a)).toMatchObject({
      inputStart: '2026-09-30',
      inputFinish: '2026-10-06',
      durationDays: 5,
    });
    expect(changed.project.revision).toBe(initial.project.revision + 3);
  } finally {
    await runtime.close();
  }
});

test('C27 boundary exact retry reveals acknowledged start; incoming FS refusal keeps repeat focus', async ({
  page,
}) => {
  const runtime = await syntheticRuntime();
  try {
    let tree = await seedOptionalRuntime(page, runtime);
    const a = tree.tasks.find((t) => t.title === 'Работа A')!.id;
    tree = await send(page, runtime.origin, tree, {
      type: 'task.create',
      parentId: null,
      title: 'Ранний предшественник',
      inputStart: '2026-09-30',
      inputFinish: '2026-09-30',
      durationDays: 1,
    });
    const predecessor = tree.tasks.find(
      (t) => t.title === 'Ранний предшественник',
    )!.id;
    tree = await send(page, runtime.origin, tree, {
      type: 'task.edit',
      taskId: a,
      changes: { predecessorIds: [predecessor] },
    });
    // Reveal A explicitly: its left boundary is 02 despite an earlier separate predecessor.
    await page.goto(runtime.origin);
    await page.getByRole('treeitem', { name: /Работа A,/ }).click();
    await page.getByRole('tab', { name: 'Зависимости', exact: true }).click();
    await page
      .getByRole('button', { name: 'Показать на Ганте', exact: true })
      .click();
    await page.keyboard.press('Escape');
    const left = page.getByRole('button', {
      name: 'Изменить начало: Работа A',
      exact: true,
    });
    await left.focus();
    await page.keyboard.press('ArrowLeft');
    await expect(left).toBeFocused();
    await expect(
      page.getByRole('button', { name: /Работа A, 2026/ }),
    ).toHaveAttribute('aria-label', /2026-10-02 – 2026-10-06/);
    const envelopes: unknown[] = [];
    await page.route('**/api/projects/*/commands', async (route) => {
      envelopes.push(route.request().postDataJSON());
      if (envelopes.length === 1) {
        const response = await route.fetch();
        expect(response.status()).toBe(200);
        await route.abort('failed');
      } else await route.continue();
    });
    await page.keyboard.press('ArrowLeft');
    await expect(
      page.getByRole('button', { name: 'Повторить', exact: true }),
    ).toBeVisible();
    await expect(
      page.getByRole('button', { name: /Работа A, 2026/ }),
    ).toHaveAttribute('aria-label', /2026-10-02 – 2026-10-06/);
    await page.getByRole('button', { name: 'Повторить', exact: true }).click();
    await expect(left).toBeFocused();
    const accepted = await readTree(page, runtime.origin, tree.project.id);
    expect(accepted.tasks.find((t) => t.id === a)).toMatchObject({
      inputStart: '2026-10-01',
      inputFinish: '2026-10-06',
      durationDays: 4,
    });
    expect(accepted.project.revision).toBe(tree.project.revision + 2);
    expect(envelopes).toHaveLength(2);
    expect(envelopes[1]).toEqual(envelopes[0]);
    await page.keyboard.press('ArrowLeft');
    await expect(
      page.getByText(
        'Начало работы должно быть после окончания предшественника.',
      ),
    ).toBeVisible();
    await expect(left).toBeFocused();
    expect(await readTree(page, runtime.origin, tree.project.id)).toEqual(
      accepted,
    );
    await page.keyboard.press('ArrowRight');
    await expect(left).toBeFocused();
    const repeated = await readTree(page, runtime.origin, tree.project.id);
    expect(repeated.tasks.find((t) => t.id === a)).toMatchObject({
      inputStart: '2026-10-02',
      inputFinish: '2026-10-06',
      durationDays: 3,
    });
    expect(repeated.project.revision).toBe(accepted.project.revision + 1);
  } finally {
    await runtime.close();
  }
});

for (const transition of ['list', 'period', 'scale', 'filter'] as const) {
  test(`C27 boundary pending ${transition} transition cancels reveal/focus without stealing project focus`, async ({
    page,
  }) => {
    const runtime = await syntheticRuntime();
    let release!: () => void;
    try {
      const initial = await seedOptionalRuntime(page, runtime);
      const second = await page.request.post(`${runtime.origin}/api/projects`, {
        headers: { Origin: runtime.origin, 'X-Leaf-Contract-Version': '2' },
        data: { title: 'Второй синтетический проект' },
      });
      expect(second.status()).toBe(201);
      await page.goto(runtime.origin);
      const left = page.getByRole('button', {
        name: 'Изменить начало: Работа A',
        exact: true,
      });
      await left.focus();
      await page.keyboard.press('ArrowLeft');
      await expect(left).toBeFocused();
      await expect(
        page.getByRole('button', { name: /Работа A, 2026/ }),
      ).toHaveAttribute('aria-label', /2026-10-02 – 2026-10-06/);
      let reached!: () => void;
      const arrived = new Promise<void>((r) => {
          reached = r;
        }),
        held = new Promise<void>((r) => {
          release = r;
        });
      await page.route(
        '**/api/projects/*/commands',
        async (route) => {
          const response = await route.fetch();
          expect(response.status()).toBe(200);
          reached();
          await held;
          await route.fulfill({ response });
        },
        { times: 1 },
      );
      await page.keyboard.press('ArrowLeft');
      await arrived;
      const control =
        transition === 'list'
          ? page.getByRole('button', { name: 'Список', exact: true })
          : transition === 'period'
            ? page.getByRole('button', {
                name: 'Следующий период',
                exact: true,
              })
            : transition === 'filter'
              ? page.getByRole('searchbox', { name: 'Поиск задач' })
              : page.getByRole('combobox', { name: 'Масштаб Ганта' });
      if (transition === 'filter') await control.fill('Работа C');
      else if (transition === 'scale') {
        await control.focus();
        await control.selectOption('weeks');
      } else await control.click();
      release();
      await expect(
        page.getByRole('button', { name: 'Отменить последнее изменение' }),
      ).toBeEnabled();
      await expect(control).toBeFocused();
      if (transition === 'list') {
        await expect(control).toHaveAttribute('aria-pressed', 'true');
        await page.getByRole('button', { name: 'Гант', exact: true }).click();
        await expect(left).toHaveCount(0);
      } else await expect(left).toHaveCount(0);
      if (transition === 'filter') await control.fill('');
      const changed = await readTree(page, runtime.origin, initial.project.id);
      expect(changed.project.revision).toBe(initial.project.revision + 2);
      expect(changed.tasks.find((t) => t.title === 'Работа A')).toMatchObject({
        inputStart: '2026-10-01',
        inputFinish: '2026-10-06',
        durationDays: 4,
      });
      const other = page.getByRole('button', {
        name: 'Второй синтетический проект',
        exact: true,
      });
      await other.click();
      await expect(
        page.getByRole('heading', {
          name: 'Второй синтетический проект',
          exact: true,
        }),
      ).toBeVisible();
      await expect(left).toHaveCount(0);
      const original = page.getByRole('button', {
        name: 'Демо-проект',
        exact: true,
      });
      await original.click();
      await expect(
        page.getByRole('heading', { name: 'Демо-проект', exact: true }),
      ).toBeVisible();
      await page.evaluate(
        () =>
          new Promise<void>((resolve) =>
            requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
          ),
      );
      await expect(left).toBeVisible();
      await expect(left).not.toBeFocused();
    } finally {
      release?.();
      await runtime.close();
    }
  });
}

for (const takeover of ['focus', 'click', 'tab'] as const) {
  test(`C27 held ack preserves explicit ${takeover} focus takeover without changing filters or view`, async ({
    page,
  }) => {
    const runtime = await syntheticRuntime();
    let release!: () => void;
    try {
      const initial = await seedOptionalRuntime(page, runtime);
      await page.goto(runtime.origin);
      let reached!: () => void;
      const arrived = new Promise<void>((r) => {
          reached = r;
        }),
        held = new Promise<void>((r) => {
          release = r;
        });
      await page.route(
        '**/api/projects/*/commands',
        async (route) => {
          const response = await route.fetch();
          expect(response.status()).toBe(200);
          reached();
          await held;
          await route.fulfill({ response });
        },
        { times: 1 },
      );
      const left = page.getByRole('button', {
        name: 'Изменить начало: Работа A',
        exact: true,
      });
      await left.focus();
      await page.keyboard.press('ArrowLeft');
      await arrived;
      const search = page.getByRole('searchbox', { name: 'Поиск задач' });
      if (takeover === 'focus') await search.focus();
      else if (takeover === 'click') await search.click();
      else await page.keyboard.press('Tab');
      const focused = await page.locator(':focus').elementHandle();
      expect(focused).not.toBeNull();
      expect(
        await focused!.evaluate(
          (element) =>
            element !== document.body &&
            !element.hasAttribute('data-gantt-resize-start'),
        ),
      ).toBe(true);
      await expect(search).toHaveValue('');
      if (takeover !== 'tab') await expect(search).toBeFocused();
      release();
      await expect(
        page.getByRole('button', { name: /Работа A, 2026/ }),
      ).toHaveAttribute('aria-label', /2026-10-02 – 2026-10-06/);
      expect(
        await focused!.evaluate(
          (element) => document.activeElement === element,
        ),
      ).toBe(true);
      await expect(left).not.toBeFocused();
      await expect(search).toHaveValue('');
      await expect(
        page.getByRole('button', { name: 'Гант', exact: true }),
      ).toHaveAttribute('aria-pressed', 'true');
      const changed = await readTree(page, runtime.origin, initial.project.id);
      expect(changed.project.revision).toBe(initial.project.revision + 1);
      expect(changed.tasks.find((t) => t.title === 'Работа A')).toMatchObject({
        inputStart: '2026-10-02',
        inputFinish: '2026-10-06',
        durationDays: 3,
      });
    } finally {
      release?.();
      await runtime.close();
    }
  });
}
