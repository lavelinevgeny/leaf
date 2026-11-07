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
