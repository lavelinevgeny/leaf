import type { Locator, Page } from '@playwright/test';
import { test, expect } from '../helpers/journal-e2e.js';
import {
  readTree,
  send,
  seedOptionalRuntime,
} from '../helpers/optional-e2e.js';

async function openQuick(page: Page, scope: 'main' | 'subtask') {
  const main = page.locator('#quick-task');
  if (scope === 'subtask') {
    await main.fill('Основной черновик');
    await page.getByRole('treeitem', { name: /^Этап P,/ }).click();
    const panel = page.getByRole('complementary', { name: 'Задача' });
    await panel.getByRole('tab', { name: 'Задача', exact: true }).click();
    const add = panel.getByRole('button', {
      name: 'Добавить подзадачу',
      exact: true,
    });
    if (await add.count()) await add.click();
    return panel.locator('form.quick-add');
  }
  return main.locator('..').locator('..');
}
async function selectMixed(page: Page, form: Locator) {
  await form.getByRole('button', { name: /^Связи новой задачи:/ }).click();
  const picker = page.getByRole('dialog', { name: 'Зависимости', exact: true });
  const search = picker.getByRole('searchbox');
  await search.fill('Работа A');
  await search.press('ArrowDown');
  await search.press('Enter');
  await picker.getByRole('button', { name: 'Перед', exact: true }).click();
  await expect(search).toHaveValue('Работа A');
  await search.fill('Работа C');
  await search.press('ArrowDown');
  await search.press('Enter');
  await search.press('Escape');
  await expect(
    form.getByRole('button', { name: 'Связи новой задачи: 2, не сохранено' }),
  ).toBeFocused();
}
async function datePlan(page: Page, form: Locator) {
  await form
    .getByRole('button', { name: 'Сроки новой задачи', exact: true })
    .click();
  const popup = page.getByRole('dialog', { name: 'Сроки задачи', exact: true });
  await popup
    .getByLabel('Длительность, рабочих дней', { exact: true })
    .fill('2');
  await popup
    .getByLabel('Длительность, рабочих дней', { exact: true })
    .press('Tab');
  await popup.getByLabel('Начало', { exact: true }).fill('05.10.2026');
  await popup.getByLabel('Начало', { exact: true }).press('Tab');
  await popup.getByRole('button', { name: 'Готово', exact: true }).click();
}

for (const scope of ['main', 'subtask'] as const) {
  test(`DUX03/07 ${scope}: mixed create is one revision, causal pass and Undo`, async ({
    page,
    runtime,
  }) => {
    let before = await seedOptionalRuntime(page, runtime);
    const a = before.tasks.find((t) => t.title === 'Работа A')!;
    const b = before.tasks.find((t) => t.title === 'Работа C')!;
    before = await send(page, runtime.origin, before, {
      type: 'task.edit',
      taskId: b.id,
      changes: { inputStart: '2026-10-05', inputFinish: '2026-10-07' },
    });
    await page.goto(runtime.origin);
    const form = await openQuick(page, scope),
      input = form.getByLabel('Новая задача', { exact: true });
    await input.fill('T');
    await datePlan(page, form);
    await selectMixed(page, form);
    await expect(input).toHaveValue('T');
    if (scope === 'subtask')
      await expect(
        page.getByRole('complementary', { name: 'Задача' }),
      ).toBeVisible();
    const bodies: unknown[] = [];
    page.on('request', (request) => {
      if (request.method() === 'POST' && request.url().endsWith('/commands'))
        bodies.push(request.postDataJSON());
    });
    await input.press('Enter');
    await expect(input).toHaveValue('');
    await expect(input).toBeFocused();
    expect(bodies).toHaveLength(1);
    expect(bodies[0]).toMatchObject({
      expectedRevision: before.project.revision,
      command: {
        type: 'task.create',
        title: 'T',
        predecessorIds: [a.id],
        successorIds: [b.id],
        inputStart: '2026-10-05',
        inputFinish: '2026-10-06',
        durationDays: 2,
      },
    });
    const saved = await readTree(page, runtime.origin, before.project.id),
      t = saved.tasks.find((t) => t.title === 'T')!;
    expect(saved.project.revision).toBe(before.project.revision + 1);
    expect(t).toMatchObject({
      parentId: scope === 'main' ? null : a.parentId,
      inputStart: '2026-10-07',
      inputFinish: '2026-10-08',
      durationDays: 2,
    });
    expect(saved.tasks.find((t) => t.id === b.id)).toMatchObject({
      inputStart: '2026-10-09',
      inputFinish: '2026-10-13',
    });
    expect(saved.dependencies).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ predecessorId: a.id, successorId: t.id }),
        expect.objectContaining({ predecessorId: t.id, successorId: b.id }),
      ]),
    );
    if (scope === 'subtask')
      await expect(page.locator('#quick-task')).toHaveValue(
        'Основной черновик',
      );
    await page
      .getByRole('button', { name: 'Отменить изменение плана' })
      .click();
    await expect(page.getByRole('treeitem', { name: /^T,/ })).toHaveCount(0);
    const undone = await readTree(page, runtime.origin, before.project.id);
    expect(undone.project.revision).toBe(saved.project.revision + 1);
    expect(undone.tasks).toEqual(before.tasks);
    expect(undone.dependencies).toEqual(before.dependencies);
    expect(undone.schedule).toEqual(before.schedule);
  });

  test(`DUX07/09 ${scope}: outgoing-only nullable source and rejected mixed draft survive a real 409 refresh`, async ({
    page,
    runtime,
  }) => {
    let tree = await seedOptionalRuntime(page, runtime);
    const b = tree.tasks.find((t) => t.title === 'Работа C')!;
    tree = await send(page, runtime.origin, tree, {
      type: 'task.edit',
      taskId: b.id,
      changes: {
        inputStart: '2026-10-05',
        inputFinish: '2026-10-07',
        status: 'done',
      },
    });
    await page.goto(runtime.origin);
    const form = await openQuick(page, scope),
      input = form.getByLabel('Новая задача', { exact: true });
    await input.fill('T');
    await datePlan(page, form);
    await selectMixed(page, form);
    await input.press('Enter');
    await expect(input).toBeEnabled();
    await expect(input).toHaveValue('T');
    expect(
      (await readTree(page, runtime.origin, tree.project.id)).project.revision,
    ).toBe(tree.project.revision);
    await form.getByRole('button', { name: /^Связи новой задачи:/ }).click();
    await expect(
      page.getByRole('button', { name: 'Убрать предшественника: Работа A' }),
    ).toBeVisible();
    await expect(
      page.getByRole('button', { name: 'Убрать последователя: Работа C' }),
    ).toBeVisible();
    await page
      .getByRole('searchbox', { name: 'Поиск предшественника' })
      .press('Escape');
    tree = await send(page, runtime.origin, tree, {
      type: 'task.edit',
      taskId: b.id,
      changes: { status: 'todo' },
    });
    await input.press('Enter');
    await page
      .getByRole('button', { name: 'Загрузить актуальный проект', exact: true })
      .click();
    await expect(input).toBeEnabled();
    await expect(input).toHaveValue('T');
    expect(
      (await readTree(page, runtime.origin, tree.project.id)).project.revision,
    ).toBe(tree.project.revision);
    await form.getByRole('button', { name: /^Связи новой задачи:/ }).click();
    await page
      .getByRole('button', { name: 'Убрать предшественника: Работа A' })
      .click();
    await page
      .getByRole('searchbox', { name: 'Поиск предшественника' })
      .press('Escape');
    await form
      .getByRole('button', { name: 'Сроки новой задачи', exact: true })
      .click();
    await page
      .getByRole('dialog', { name: 'Сроки задачи' })
      .getByRole('button', { name: 'Сбросить', exact: true })
      .click();
    await page.getByRole('button', { name: 'Готово', exact: true }).click();
    await input.press('Enter');
    await expect(input).toHaveValue('');
    const saved = await readTree(page, runtime.origin, tree.project.id),
      t = saved.tasks.find((t) => t.title === 'T')!;
    expect(saved.project.revision).toBe(tree.project.revision + 1);
    expect(t).toMatchObject({
      inputStart: null,
      inputFinish: null,
      durationDays: null,
    });
    expect(saved.dependencies).toEqual([
      expect.objectContaining({ predecessorId: t.id, successorId: b.id }),
    ]);
  });
}

test('DUX01/04 shared rows keep saved counts, directional routing, Undo and compact geometry', async ({
  page,
  runtime,
}) => {
  let tree = await seedOptionalRuntime(page, runtime);
  const a = tree.tasks.find((t) => t.title === 'Работа A')!;
  const c = tree.tasks.find((t) => t.title === 'Работа C')!;
  tree = await send(page, runtime.origin, tree, {
    type: 'task.edit',
    taskId: c.id,
    changes: { inputStart: '2026-10-07', inputFinish: '2026-10-09' },
  });
  tree = await send(page, runtime.origin, tree, {
    type: 'dependency.create',
    predecessorId: a.id,
    successorId: c.id,
  });
  await page.goto(runtime.origin);
  const row = page
    .getByRole('tree', { name: 'Задачи', exact: true })
    .locator(`[data-task-id="${c.id}"]`);
  const trigger = row.getByRole('button', {
    name: 'Зависимости: Работа C',
    exact: true,
  });
  await expect(trigger).toHaveText('1');
  const originalControl = await trigger.elementHandle();
  for (const view of ['Список', 'Гант']) {
    await page.getByRole('button', { name: view, exact: true }).click();
    if (view === 'Гант') {
      await page.getByRole('separator', { name: 'Ширина дерева' }).focus();
      await page
        .getByRole('separator', { name: 'Ширина дерева' })
        .press('ArrowLeft');
      await page
        .getByRole('separator', { name: 'Ширина дерева' })
        .press('ArrowLeft');
      await page
        .getByRole('separator', { name: 'Ширина дерева' })
        .press('ArrowLeft');
      await page
        .getByRole('separator', { name: 'Ширина дерева' })
        .press('ArrowLeft');
      await page
        .getByRole('separator', { name: 'Ширина дерева' })
        .press('ArrowLeft');
      await page
        .getByRole('separator', { name: 'Ширина дерева' })
        .press('ArrowLeft');
    }
    await page.getByRole('searchbox', { name: 'Поиск задач' }).focus();
    await page.mouse.move(0, 0);
    const before = await row.evaluate((node) => {
      const rect = (selector: string) => {
        const r = node.querySelector(selector)!.getBoundingClientRect();
        return {
          x: r.x,
          y: r.y,
          width: r.width,
          height: r.height,
          right: r.right,
        };
      };
      return {
        title: rect('.task-title'),
        date: rect('.task-date'),
        chain: rect('.task-row-dependency'),
        height: node.getBoundingClientRect().height,
      };
    });
    await expect(trigger).toBeVisible();
    await expect(row.locator('.task-date')).toBeVisible();
    await expect(row.locator('.task-date')).toHaveText('7–9 окт.');
    await expect(trigger).toBeEnabled();
    expect(
      await trigger.evaluate(
        (node, original) => node === original,
        originalControl,
      ),
    ).toBe(true);
    expect(before.height).toBe(38);
    expect(before.chain.width).toBeGreaterThanOrEqual(28);
    expect(before.chain.height).toBeGreaterThanOrEqual(28);
    expect(before.date.right).toBeLessThanOrEqual(before.chain.x);
    const header = await page
      .locator('.timeline-heading-labels > span')
      .last()
      .boundingBox();
    expect(
      Math.abs(header!.x + header!.width - before.date.right),
    ).toBeLessThanOrEqual(1);
    await row.hover();
    expect(
      await trigger.evaluate(
        (node, original) => node === original,
        originalControl,
      ),
    ).toBe(true);
    expect(await row.locator('.task-title').boundingBox()).toEqual({
      x: before.title.x,
      y: before.title.y,
      width: before.title.width,
      height: before.title.height,
    });
    for (const name of [
      'Добавить подзадачу: Работа C',
      'Добавить запись: Работа C',
      'Зависимости: Работа C',
    ]) {
      const control = row.getByRole('button', { name, exact: true });
      const bounds = await control.boundingBox();
      const visibleColumn = await row.locator('..').boundingBox();
      expect(bounds!.width).toBeGreaterThanOrEqual(28);
      expect(bounds!.height).toBeGreaterThanOrEqual(28);
      expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(
        visibleColumn!.x + visibleColumn!.width + 1,
      );
    }
    await trigger.focus();
    expect(await row.locator('.task-title').boundingBox()).toEqual({
      x: before.title.x,
      y: before.title.y,
      width: before.title.width,
      height: before.title.height,
    });
    await row.focus();
    await page.keyboard.press('Tab');
    await expect(
      row.getByRole('button', {
        name: 'Добавить подзадачу: Работа C',
        exact: true,
      }),
    ).toBeFocused();
    await page.keyboard.press('Tab');
    await expect(
      row.getByRole('button', {
        name: 'Добавить запись: Работа C',
        exact: true,
      }),
    ).toBeFocused();
    await page.keyboard.press('Tab');
    await expect(trigger).toBeFocused();
    await trigger.press('Enter');
    const picker = page.getByRole('dialog', {
      name: 'Зависимости',
      exact: true,
    });
    await expect(
      picker.getByRole('button', { name: 'После', exact: true }),
    ).toHaveAttribute('aria-pressed', 'true');
    await expect(
      page.getByRole('complementary', { name: 'Задача' }),
    ).toHaveCount(0);
    await picker.getByRole('searchbox').press('Escape');
    await expect(trigger).toBeFocused();
  }
  await trigger.click();
  const picker = page.getByRole('dialog', { name: 'Зависимости', exact: true });
  await picker.getByRole('button', { name: 'Перед', exact: true }).click();
  // Remove the incoming group while the opposite direction is selected.
  await picker
    .getByRole('button', {
      name: 'Убрать предшественника: Работа A',
      exact: true,
    })
    .click();
  await expect(picker).toHaveCount(0);
  await expect(trigger).toBeFocused();
  await expect(trigger).toHaveText('');
  let saved = await readTree(page, runtime.origin, tree.project.id);
  expect(saved.dependencies).toEqual([]);
  await page.getByRole('button', { name: 'Отменить изменение плана' }).click();
  await expect(trigger).toHaveText('1');
  saved = await readTree(page, runtime.origin, tree.project.id);
  expect(saved.dependencies).toEqual(tree.dependencies);
  expect(saved.tasks).toEqual(tree.tasks);
  await page.getByRole('treeitem', { name: /^Этап P,/ }).click();
  const subtask = page
    .getByRole('tree', { name: 'Подзадачи', exact: true })
    .getByRole('button', { name: 'Зависимости: Работа C', exact: true });
  await subtask.click();
  await picker.getByRole('searchbox').press('Escape');
  await expect(subtask).toBeFocused();
});

test('DUX04 compact slot stays shared across hidden neighbors and deep horizontal scroll', async ({
  page,
  runtime,
}) => {
  let tree = await seedOptionalRuntime(page, runtime);
  let parentId = tree.tasks.find((t) => t.title === 'Этап P')!.id;
  for (let level = 0; level < 8; ++level) {
    const title =
      level === 7
        ? 'Глубокая задача с длинным названием '.repeat(4).trim()
        : `Уровень ${level}`;
    tree = await send(page, runtime.origin, tree, {
      type: 'task.create',
      parentId,
      title,
    });
    parentId = tree.tasks.find((t) => t.title === title)!.id;
  }
  for (let index = 0; index < 12; ++index) {
    const title = `Сосед ${index}`;
    tree = await send(page, runtime.origin, tree, {
      type: 'task.create',
      parentId: null,
      title,
      successorIds: [parentId],
    });
  }
  tree = await send(page, runtime.origin, tree, {
    type: 'task.create',
    parentId: null,
    title: 'Другой скрытый сосед',
  });
  await page.goto(runtime.origin);
  const separator = page.getByRole('separator', { name: 'Ширина дерева' });
  await separator.focus();
  for (let index = 0; index < 6; ++index) await separator.press('ArrowLeft');
  await expect(separator).toHaveAttribute('aria-valuenow', '300');
  const scope = page.locator('.timeline-tree');
  const row = scope.locator(`[data-task-id="${parentId}"]`);
  const chain = row.getByRole('button', { name: /^Зависимости:/ });
  await expect(chain).toHaveText('12');
  const width = await scope.evaluate((node) =>
    getComputedStyle(node).getPropertyValue('--leaf-dependency-slot-width'),
  );
  expect(width).toBe('calc(28px + 4px + 2ch)');
  await scope.evaluate((node) => {
    node.scrollLeft = node.scrollWidth;
  });
  const edge = await scope.boundingBox(),
    button = await chain.boundingBox();
  expect(button!.x).toBeGreaterThanOrEqual(edge!.x);
  expect(button!.x + button!.width).toBeLessThanOrEqual(edge!.x + edge!.width);
  expect(button!.width).toBeGreaterThanOrEqual(28);
  expect(button!.height).toBeGreaterThanOrEqual(28);
  await chain.click();
  const picker = page.getByRole('dialog', { name: 'Зависимости', exact: true });
  await expect(
    picker.getByRole('button', { name: /^Убрать предшественника:/ }),
  ).toHaveCount(12);
  await picker.getByRole('searchbox').press('Escape');
  await expect(chain).toBeFocused();
  await page
    .getByRole('searchbox', { name: 'Поиск задач' })
    .fill('Глубокая задача');
  await expect(chain).toHaveText('12');
  expect(
    await scope.evaluate((node) =>
      getComputedStyle(node).getPropertyValue('--leaf-dependency-slot-width'),
    ),
  ).toBe(width);
  await chain.click();
  await expect(
    picker.getByRole('button', {
      name: 'Убрать предшественника: Сосед 11',
      exact: true,
    }),
  ).toBeVisible();
  await picker.getByRole('searchbox').fill('Другой скрытый сосед');
  await expect(
    picker.getByRole('option', { name: /Другой скрытый сосед/ }),
  ).toBeVisible();
});

for (const host of ['row', 'gantt'] as const) {
  for (const key of ['Enter', 'Space']) {
    test(`DUX06 ${host}: focused candidate ${key} keeps Escape available during pending write`, async ({
      page,
      runtime,
    }) => {
      const tree = await seedOptionalRuntime(page, runtime);
      const target = tree.tasks.find((task) => task.title === 'Работа C')!;
      await page.goto(runtime.origin);
      const trigger =
        host === 'row'
          ? page
              .getByRole('tree', { name: 'Задачи', exact: true })
              .getByRole('button', {
                name: 'Зависимости: Работа C',
                exact: true,
              })
          : page
              .locator(`[data-gantt-row="${target.id}"]`)
              .getByRole('button', {
                name: 'После окончания: Работа C',
                exact: true,
              });
      await trigger.focus();
      await trigger.press('Enter');
      const picker = page.getByRole('dialog', {
        name: 'Зависимости',
        exact: true,
      });
      const candidate = picker.getByRole('option', { name: /^Работа A/ });
      let release!: () => void;
      const gate = new Promise<void>((done) => {
        release = done;
      });
      let accepted = false;
      await page.route('**/commands', async (route) => {
        const response = await route.fetch();
        accepted = true;
        await gate;
        await route.fulfill({ response });
      });
      try {
        await candidate.focus();
        await candidate.press(key);
        await expect.poll(() => accepted).toBe(true);
        await expect(candidate).toBeDisabled();
        await page.keyboard.press('Escape');
        await expect(picker).toHaveCount(0);
        await expect(trigger).toBeDisabled();
        release();
        await expect(trigger).toBeFocused();
        expect(
          (await readTree(page, runtime.origin, tree.project.id)).dependencies,
        ).toHaveLength(1);
      } finally {
        release();
        await page.unrouteAll({ behavior: 'wait' });
      }
    });
  }
}

async function expectPopupWithinViewport(popup: Locator) {
  await expect
    .poll(() =>
      popup.evaluate((node) => {
        const r = node.getBoundingClientRect();
        const v = window.visualViewport!;
        return (
          r.left >= v.offsetLeft - 1 &&
          r.top >= v.offsetTop - 1 &&
          r.right <= v.offsetLeft + v.width + 1 &&
          r.bottom <= v.offsetTop + v.height + 1
        );
      }),
    )
    .toBe(true);
}

test('DUX01/05 graph headers, directed arrows, five neighbors and last-page removal use real snapshots', async ({
  page,
  runtime,
}) => {
  let tree = await seedOptionalRuntime(page, runtime);
  const target = tree.tasks.find((t) => t.title === 'Работа C')!;
  for (const direction of ['incoming', 'outgoing'] as const) {
    for (let index = 0; index < 5; ++index) {
      tree = await send(page, runtime.origin, tree, {
        type: 'task.create',
        parentId: null,
        title: `${direction} ${index}`,
        ...(direction === 'incoming'
          ? { successorIds: [target.id] }
          : { predecessorIds: [target.id] }),
      });
    }
  }
  await page.goto(runtime.origin);
  const row = page
    .getByRole('tree', { name: 'Задачи', exact: true })
    .locator(`[data-task-id="${target.id}"]`);
  await expect(
    row.getByRole('button', { name: 'Зависимости: Работа C', exact: true }),
  ).toHaveText('10');
  await row.click();
  const panel = page.getByRole('complementary', { name: 'Задача' });
  await panel.getByRole('tab', { name: 'Зависимости', exact: true }).click();
  const graph = panel.locator('.dependency-graph');
  const headers = graph.locator('.dependency-section-header');
  await expect(headers.nth(0)).toContainText('(5)');
  await expect(headers.nth(1)).toContainText('(5)');
  for (const name of ['Добавить предшественника', 'Добавить последователя']) {
    const button = graph.getByRole('button', { name, exact: true });
    await expect(button).toHaveText('+ Добавить');
    await expect(button).toBeEnabled();
  }
  expect(
    await graph
      .getByRole('button', { name: 'Добавить предшественника', exact: true })
      .evaluate((n) => n.getBoundingClientRect().width),
  ).toBe(
    await graph
      .getByRole('button', { name: 'Добавить последователя', exact: true })
      .evaluate((n) => n.getBoundingClientRect().width),
  );
  await expect(
    graph.locator('[data-dependency-direction="incoming"]'),
  ).toHaveCount(4);
  await expect(
    graph.locator('[data-dependency-direction="outgoing"]'),
  ).toHaveCount(4);
  const arrows = await graph
    .locator('[data-dependency-edge]')
    .evaluateAll((nodes) =>
      nodes.map((n) => {
        const p = n as SVGPathElement;
        const start = p.getPointAtLength(0),
          end = p.getPointAtLength(p.getTotalLength());
        return {
          start: start.y,
          end: end.y,
          marker: p.getAttribute('marker-end'),
          title: p.textContent,
        };
      }),
    );
  expect(arrows).toHaveLength(8);
  for (const arrow of arrows) {
    expect(arrow.end).toBeGreaterThan(arrow.start);
    expect(arrow.marker).toMatch(/^url\(#.+-dep\)$/);
    expect(arrow.title).toContain('→');
  }
  await headers
    .nth(0)
    .getByRole('button', { name: 'Показать ещё', exact: true })
    .click();
  await expect(
    graph.locator('[data-dependency-direction="incoming"]'),
  ).toHaveCount(1);
  await graph
    .locator('[data-dependency-direction="incoming"]')
    .getByRole('button', { name: /^Удалить связь:/ })
    .click();
  await expect(headers.nth(0)).toContainText('(4)');
  await expect(headers.nth(0)).toContainText('Не сохранено');
  await expect(
    headers
      .nth(1)
      .getByRole('button', { name: 'Добавить последователя', exact: true }),
  ).toBeDisabled();
  expect(await readTree(page, runtime.origin, tree.project.id)).toEqual(tree);
  await panel.getByRole('button', { name: 'Сохранить', exact: true }).click();
  await expect(
    headers.nth(0).getByText('Не сохранено', { exact: true }),
  ).toHaveCount(0);
  await expect(
    graph.locator('[data-dependency-direction="incoming"]'),
  ).toHaveCount(4);
  const incomingSaved = await readTree(page, runtime.origin, tree.project.id);
  expect(incomingSaved.dependencies).toHaveLength(9);
  await headers
    .nth(1)
    .getByRole('button', { name: 'Показать ещё', exact: true })
    .click();
  await expect(
    graph.locator('[data-dependency-direction="outgoing"]'),
  ).toHaveCount(1);
  await graph
    .locator('[data-dependency-direction="outgoing"]')
    .getByRole('button', { name: /^Удалить связь:/ })
    .click();
  await expect(
    graph.locator('[data-dependency-direction="outgoing"]'),
  ).toHaveCount(4);
  const outgoingSaved = await readTree(page, runtime.origin, tree.project.id);
  expect(outgoingSaved.dependencies).toHaveLength(8);
  expect(
    outgoingSaved.dependencies.every((edge) =>
      incomingSaved.dependencies.some((previous) => previous.id === edge.id),
    ),
  ).toBe(true);
  await page
    .getByRole('button', { name: 'Отменить изменение плана', exact: true })
    .click();
  await expect(headers.nth(1)).toContainText('(5)');
  expect(
    (await readTree(page, runtime.origin, tree.project.id)).dependencies,
  ).toEqual(incomingSaved.dependencies);
  const openedTitle = await graph
    .locator('[data-dependency-direction="outgoing"] strong')
    .first()
    .textContent();
  await graph
    .locator('[data-dependency-direction="outgoing"]')
    .getByRole('button', { name: /^Открыть:/ })
    .first()
    .click();
  await expect(
    panel.getByRole('heading', { name: openedTitle!, exact: true }),
  ).toBeVisible();
  await expect(
    panel.locator('.dependency-section-header').nth(0),
  ).toContainText('(1)');
  await expect(
    panel.locator('.dependency-section-header').nth(1),
  ).toContainText('(0)');
});

for (const scope of ['main', 'subtask'] as const) {
  test(`DUX09 ${scope}: mixed lost-success response freezes exact envelope until single replay`, async ({
    page,
    runtime,
  }) => {
    const tree = await seedOptionalRuntime(page, runtime);
    await page.goto(runtime.origin);
    const form = await openQuick(page, scope);
    const title = form.getByLabel('Новая задача', { exact: true });
    await title.fill('Lost mixed T');
    await selectMixed(page, form);
    const envelopes: unknown[] = [];
    let frozen: unknown;
    await page.route('**/api/projects/*/commands', async (route) => {
      envelopes.push(route.request().postDataJSON());
      if (envelopes.length === 1) {
        const response = await route.fetch();
        expect(response.status()).toBe(200);
        frozen = await response.json();
        await route.abort('failed');
      } else await route.continue();
    });
    await title.press('Enter');
    await expect(
      page.getByRole('button', { name: 'Повторить', exact: true }),
    ).toBeVisible();
    await expect(title).toBeDisabled();
    await expect(
      form.getByRole('button', { name: /^Связи новой задачи:/ }),
    ).toBeDisabled();
    await page.keyboard.press('Escape');
    await expect(title).toBeDisabled();
    const applied = await readTree(page, runtime.origin, tree.project.id);
    expect(applied).toEqual(frozen);
    expect(applied.project.revision).toBe(tree.project.revision + 1);
    expect(applied.dependencies).toHaveLength(2);
    expect(
      applied.tasks.filter((t) => t.title === 'Lost mixed T'),
    ).toHaveLength(1);
    const reply = page.waitForResponse((r) => r.url().endsWith('/commands'));
    await page.getByRole('button', { name: 'Повторить', exact: true }).click();
    const response = await reply;
    expect(response.status()).toBe(200);
    expect(await response.json()).toEqual(frozen);
    await expect(title).toHaveValue('');
    expect(envelopes).toHaveLength(2);
    expect(envelopes[1]).toEqual(envelopes[0]);
    expect(await readTree(page, runtime.origin, tree.project.id)).toEqual(
      applied,
    );
    if (scope === 'subtask')
      await expect(page.locator('#quick-task')).toHaveValue(
        'Основной черновик',
      );
  });
}

test('DUX03/04/10/11 popup preserves groups, IME, duplicate paths and active scroll through resize', async ({
  page,
  runtime,
}) => {
  let tree = await seedOptionalRuntime(page, runtime);
  for (let branch = 0; branch < 2; ++branch) {
    tree = await send(page, runtime.origin, tree, {
      type: 'task.create',
      parentId: null,
      title: `Ветка ${branch}`,
    });
    const parentId = tree.tasks.find((t) => t.title === `Ветка ${branch}`)!.id;
    tree = await send(page, runtime.origin, tree, {
      type: 'task.create',
      parentId,
      title: 'Одинаковая',
    });
  }
  for (let index = 0; index < 12; ++index)
    tree = await send(page, runtime.origin, tree, {
      type: 'task.create',
      parentId: null,
      title: `Длинное название кандидата ${index} `.repeat(3).trim(),
    });
  await page.goto(runtime.origin);
  const form = await openQuick(page, 'main');
  await form.getByLabel('Новая задача', { exact: true }).fill('Черновик');
  const chain = form.getByRole('button', { name: /^Связи новой задачи:/ });
  await chain.click();
  const popup = page.getByRole('dialog', { name: 'Зависимости', exact: true });
  const search = popup.getByRole('searchbox');
  await search.fill('Одинаковая');
  await expect(popup.getByRole('option')).toHaveCount(2);
  await expect(popup.getByRole('option').nth(0)).toContainText('Ветка 0');
  await expect(popup.getByRole('option').nth(1)).toContainText('Ветка 1');
  await search.dispatchEvent('compositionstart');
  await search.press('Enter');
  await expect(popup.locator('.predecessor-chip')).toHaveCount(0);
  await search.dispatchEvent('compositionend');
  await search.press('Enter');
  await popup.getByRole('button', { name: 'Перед', exact: true }).click();
  await expect(search).toHaveValue('Одинаковая');
  await search.press('Enter');
  await expect(popup.locator('.predecessor-chip')).toHaveCount(2);
  await expect(
    popup.getByRole('button', {
      name: 'Убрать предшественника: Одинаковая · Ветка 0',
      exact: true,
    }),
  ).toBeVisible();
  await expect(
    popup.getByRole('button', {
      name: 'Убрать последователя: Одинаковая · Ветка 1',
      exact: true,
    }),
  ).toBeVisible();
  await search.fill('Нет такого имени');
  await expect(popup.getByRole('status')).toContainText('Ничего не найдено');
  await expectPopupWithinViewport(popup);
  await page.setViewportSize({ width: 850, height: 650 });
  await expectPopupWithinViewport(popup);
  await search.fill('Длинное название');
  for (let index = 0; index < 12; ++index) await search.press('ArrowDown');
  const active = popup.getByRole('option', { selected: true });
  await expect(active).toHaveCount(1);
  const activeBox = await active.boundingBox(),
    listBox = await popup.getByRole('listbox').boundingBox();
  expect(activeBox!.y).toBeGreaterThanOrEqual(listBox!.y - 1);
  expect(activeBox!.y + activeBox!.height).toBeLessThanOrEqual(
    listBox!.y + listBox!.height + 1,
  );
  await expect(popup.locator('.dependency-preview')).toContainText(
    'Черновик →',
  );
  await search.press('Escape');
  await expect(chain).toBeFocused();
  await chain.press('Space');
  await expect(
    popup.getByRole('button', { name: 'После', exact: true }),
  ).toHaveAttribute('aria-pressed', 'true');
  await expect(popup.locator('.predecessor-chip')).toHaveCount(2);
  await search.press('Escape');
  expect(await readTree(page, runtime.origin, tree.project.id)).toEqual(tree);
});

test('DUX02/12 touch without hover opens an empty row chain independently of task panel', async ({
  browser,
  runtime,
}) => {
  const context = await browser.newContext({
    viewport: { width: 900, height: 800 },
    hasTouch: true,
    isMobile: true,
  });
  try {
    const page = await context.newPage();
    const tree = await seedOptionalRuntime(page, runtime);
    await page.goto(runtime.origin);
    expect(await page.evaluate(() => matchMedia('(hover: none)').matches)).toBe(
      true,
    );
    const target = tree.tasks.find((t) => t.title === 'Работа C')!;
    const chain = page
      .getByRole('tree', { name: 'Задачи', exact: true })
      .locator(`[data-task-id="${target.id}"]`)
      .getByRole('button', { name: 'Зависимости: Работа C', exact: true });
    await expect(chain).toHaveText('');
    await chain.tap();
    const popup = page.getByRole('dialog', {
      name: 'Зависимости',
      exact: true,
    });
    await expect(popup).toBeVisible();
    await expect(
      page.getByRole('complementary', { name: 'Задача' }),
    ).toHaveCount(0);
    await popup.getByRole('button', { name: 'Перед', exact: true }).tap();
    await expect(
      popup.getByRole('button', { name: 'Перед', exact: true }),
    ).toHaveAttribute('aria-pressed', 'true');
    await expectPopupWithinViewport(popup);
    expect(await readTree(page, runtime.origin, tree.project.id)).toEqual(tree);
  } finally {
    await context.close();
  }
});

test('DUX06/10 row pending ack preserves outside focus after blur to body and keeps saved count', async ({
  page,
  runtime,
}) => {
  const tree = await seedOptionalRuntime(page, runtime);
  await page.goto(runtime.origin);
  const chain = page
    .getByRole('tree', { name: 'Задачи', exact: true })
    .getByRole('button', { name: 'Зависимости: Работа C', exact: true });
  await chain.focus();
  await chain.press('Space');
  const popup = page.getByRole('dialog', { name: 'Зависимости', exact: true });
  let release!: () => void;
  const gate = new Promise<void>((done) => {
    release = done;
  });
  let accepted = false;
  await page.route('**/commands', async (route) => {
    const response = await route.fetch();
    expect(response.status()).toBe(200);
    accepted = true;
    await gate;
    await route.fulfill({ response });
  });
  try {
    await popup.getByRole('option', { name: /^Работа A/ }).click();
    await expect.poll(() => accepted).toBe(true);
    await expect(chain).toHaveText('');
    await expect(chain).toBeDisabled();
    await page.keyboard.press('Escape');
    await expect(popup).toHaveCount(0);
    const outside = page.getByRole('searchbox', {
      name: 'Поиск задач',
      exact: true,
    });
    await outside.focus();
    await outside.evaluate((node) => (node as HTMLElement).blur());
    release();
    await expect(chain).toHaveText('1');
    expect(
      await page.evaluate(() => document.activeElement === document.body),
    ).toBe(true);
    expect(
      (await readTree(page, runtime.origin, tree.project.id)).project.revision,
    ).toBe(tree.project.revision + 1);
  } finally {
    release();
    await page.unrouteAll({ behavior: 'wait' });
  }
});
