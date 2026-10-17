import { openTaskDates } from '../helpers/task-panel.js';
import { test, expect } from '@playwright/test';
import Database from 'better-sqlite3';
import { syntheticRuntime } from '../../scripts/e2e-server.js';
import {
  seedOptionalRuntime,
  readTree,
  send,
} from '../helpers/optional-e2e.js';

function counts(databasePath: string, projectId: string) {
  const db = new Database(databasePath, { readonly: true });
  try {
    return {
      operations: (
        db
          .prepare('SELECT COUNT(*) AS n FROM operations WHERE projectId=?')
          .get(projectId) as { n: number }
      ).n,
      undo: (
        db
          .prepare('SELECT COUNT(*) AS n FROM undo_snapshots WHERE projectId=?')
          .get(projectId) as { n: number }
      ).n,
    };
  } finally {
    db.close();
  }
}

test('linked edits stay local until one atomic save, then undo and restart restore the original source', async ({
  page,
}, info) => {
  const runtime = await syntheticRuntime();
  try {
    let before = await seedOptionalRuntime(page, runtime);
    const id = before.tasks.find((task) => task.title === 'Работа A')!.id;
    before = await send(page, runtime.origin, before, {
      type: 'task.edit',
      taskId: id,
      changes: { durationDays: 2 },
    });
    const initialCounts = counts(runtime.databasePath, before.project.id);
    let mutations = 0;
    page.on('request', (request) => {
      if (request.method() === 'POST' && request.url().endsWith('/commands'))
        mutations++;
    });
    await page.goto(runtime.origin);
    await page.getByRole('treeitem', { name: /Работа A,/ }).click();
    const start = page.getByLabel('Начало', { exact: true });
    const finish = page.getByLabel('Окончание', { exact: true });
    const duration = page.getByLabel('Длительность, рабочих дней', {
      exact: true,
    });
    await expect(start).toHaveValue('05.10.2026');
    await openTaskDates(page);
    await duration.fill('3');
    await expect(finish).toHaveValue('06.10.2026');
    await duration.press('Enter');
    await expect(finish).toHaveValue('07.10.2026');
    await openTaskDates(page);
    await start.fill('09.10.2026');
    await start.press('Tab');
    await expect(finish).toHaveValue('13.10.2026');
    await openTaskDates(page);
    await finish.fill('14.10.2026');
    await finish.press('Enter');
    await expect(duration).toHaveValue('4');
    await expect(start).toHaveValue('09.10.2026');
    await expect(duration).toHaveClass('plan-recalculated');
    expect(mutations).toBe(0);
    expect(await readTree(page, runtime.origin, before.project.id)).toEqual(
      before,
    );
    expect(counts(runtime.databasePath, before.project.id)).toEqual(
      initialCounts,
    );
    await page.screenshot({
      path: `/tmp/leaf-linked-fields-${info.project.name}.png`,
    });
    await page.getByRole('button', { name: 'Сохранить', exact: true }).click();
    await expect(page.getByText('Сохранено', { exact: true })).toBeVisible();
    const saved = await readTree(page, runtime.origin, before.project.id);
    expect(saved.project.revision).toBe(before.project.revision + 1);
    expect(saved.tasks.find((task) => task.id === id)).toMatchObject({
      inputStart: '2026-10-09',
      inputFinish: '2026-10-14',
      durationDays: 4,
    });
    expect(saved.schedule.tasks[id]).toMatchObject({
      startDate: '2026-10-09',
      finishDate: '2026-10-14',
      calendarSpanDays: 4,
    });
    expect(saved.tasks.filter((task) => task.id !== id)).toEqual(
      before.tasks.filter((task) => task.id !== id),
    );
    expect(counts(runtime.databasePath, before.project.id)).toEqual({
      operations: initialCounts.operations + 1,
      undo: initialCounts.undo + 1,
    });
    expect(mutations).toBe(1);
    await page.keyboard.press('Escape');
    await page
      .getByRole('button', { name: 'Отменить изменение плана' })
      .click();
    await expect(
      page.getByRole('button', { name: /Работа A, 2026-10-05 – 2026-10-06/ }),
    ).toBeVisible();
    await runtime.restart();
    await page.reload();
    const restored = await readTree(page, runtime.origin, before.project.id);
    expect(restored.tasks).toEqual(before.tasks);
    expect(restored.schedule).toEqual(before.schedule);
  } finally {
    try {
      await page.context().close();
    } finally {
      await runtime.close();
    }
  }
});

test('duration-only stays undated, finish anchors the start, and clearing remains optional', async ({
  page,
}) => {
  const runtime = await syntheticRuntime();
  try {
    const before = await seedOptionalRuntime(page, runtime);
    const id = before.tasks.find((task) => task.title === 'Работа C')!.id;
    await page.goto(runtime.origin);
    await page.getByRole('treeitem', { name: /Работа C,/ }).click();
    const start = page.getByLabel('Начало', { exact: true });
    const finish = page.getByLabel('Окончание', { exact: true });
    const duration = page.getByLabel('Длительность, рабочих дней', {
      exact: true,
    });
    await openTaskDates(page);
    await duration.fill('6');
    await duration.press('Enter');
    await expect(start).toHaveValue('');
    await expect(finish).toHaveValue('');
    await openTaskDates(page);
    await finish.fill('12.10.2026');
    await finish.press('Enter');
    await expect(start).toHaveValue('05.10.2026');
    await openTaskDates(page);
    await start.fill('');
    await start.press('Enter');
    await expect(start).toHaveValue('');
    await expect(finish).toHaveValue('12.10.2026');
    await page.getByRole('button', { name: 'Сохранить', exact: true }).click();
    await expect(page.getByText('Сохранено', { exact: true })).toBeVisible();
    const saved = await readTree(page, runtime.origin, before.project.id);
    expect(saved.tasks.find((task) => task.id === id)).toMatchObject({
      inputStart: null,
      inputFinish: '2026-10-12',
      durationDays: 6,
    });
    expect(saved.schedule.tasks[id]!.startDate).toBeNull();
    await openTaskDates(page);
    await finish.fill('');
    await finish.press('Enter');
    await openTaskDates(page);
    await duration.fill('');
    await duration.press('Enter');
    await page.getByRole('button', { name: 'Сохранить', exact: true }).click();
    await expect(page.getByText('Сохранено', { exact: true })).toBeVisible();
    expect(
      (await readTree(page, runtime.origin, before.project.id)).tasks.find(
        (task) => task.id === id,
      ),
    ).toMatchObject({
      inputStart: null,
      inputFinish: null,
      durationDays: null,
    });
  } finally {
    try {
      await page.context().close();
    } finally {
      await runtime.close();
    }
  }
});

test('invalid edits block save until discard; native calendar and all-days use the same linked policy', async ({
  page,
}) => {
  const runtime = await syntheticRuntime();
  try {
    let before = await seedOptionalRuntime(page, runtime);
    await page.goto(runtime.origin);
    await page.getByRole('treeitem', { name: /Работа A,/ }).click();
    const start = page.getByLabel('Начало', { exact: true });
    const finish = page.getByLabel('Окончание', { exact: true });
    await openTaskDates(page);
    await finish.fill('03.10.2026');
    await finish.press('Tab');
    await expect(page.getByRole('alert')).toBeVisible();
    await expect(
      page.getByRole('button', { name: 'Сохранить', exact: true }),
    ).toBeDisabled();
    await expect(start).toHaveValue('05.10.2026');
    expect(await readTree(page, runtime.origin, before.project.id)).toEqual(
      before,
    );
    await page
      .getByRole('button', { name: 'Сбросить изменения', exact: true })
      .click();
    await expect(finish).toHaveValue('06.10.2026');
    await expect(page.getByRole('alert')).toHaveCount(0);
    await openTaskDates(page);
    await page
      .getByLabel('Календарь: Окончание', { exact: true })
      .fill('2026-10-09');
    await expect(
      page.getByLabel('Длительность, рабочих дней', { exact: true }),
    ).toHaveValue('5');
    await page.getByRole('button', { name: 'Сохранить', exact: true }).click();
    await expect(page.getByText('Сохранено', { exact: true })).toBeVisible();
    before = await readTree(page, runtime.origin, before.project.id);
    before = await send(page, runtime.origin, before, {
      type: 'project.schedule',
      changes: { calendarType: 'all-days' },
    });
    await page.reload();
    await page.getByRole('treeitem', { name: /Работа A,/ }).click();
    const duration = page.getByLabel('Длительность, дней', { exact: true });
    await openTaskDates(page);
    await duration.fill('6');
    await duration.press('Enter');
    await expect(finish).toHaveValue('10.10.2026');
    await page.getByRole('button', { name: 'Сохранить', exact: true }).click();
    await expect(page.getByText('Сохранено', { exact: true })).toBeVisible();
    const saved = await readTree(page, runtime.origin, before.project.id);
    expect(saved.project.revision).toBe(before.project.revision + 1);
    expect(saved.tasks.find((task) => task.title === 'Работа A')).toMatchObject(
      { inputStart: '2026-10-05', inputFinish: '2026-10-10', durationDays: 6 },
    );
  } finally {
    try {
      await page.context().close();
    } finally {
      await runtime.close();
    }
  }
});

test('persistent editor keeps invalid raw across tabs and layout changes, native calendar Escape closes its own layer, and retry stays exact', async ({
  page,
}) => {
  const runtime = await syntheticRuntime();
  try {
    const before = await seedOptionalRuntime(page, runtime);
    await page.goto(runtime.origin);
    await page.getByRole('treeitem', { name: /Работа A,/ }).click();
    await openTaskDates(page);
    const popup = page.getByRole('dialog', {
      name: 'Сроки задачи',
      exact: true,
    });
    const start = page.getByLabel('Начало', { exact: true });
    const finish = page.getByLabel('Окончание', { exact: true });
    await start.fill('31.02.2026');
    await start.press('Escape');
    await expect(popup).toBeHidden();
    await expect(
      page.getByRole('complementary', { name: 'Задача', exact: true }),
    ).toBeVisible();
    await page
      .getByRole('tablist', { name: 'Задача', exact: true })
      .getByRole('tab', { name: 'Ход работы', exact: true })
      .click();
    await page
      .getByRole('button', { name: 'Исправить сроки', exact: true })
      .click();
    await expect(start).toBeFocused();
    await expect(start).toHaveValue('31.02.2026');
    await expect(start).toHaveAttribute('aria-invalid', 'true');
    const originalInput = await start.elementHandle();
    await page.setViewportSize({ width: 375, height: 200 });
    await expect(page.locator('.task-panel')).toHaveAttribute(
      'data-panel-scroll-owner',
      '',
    );
    expect(
      await start.evaluate(
        (node, original) => node === original,
        originalInput,
      ),
    ).toBe(true);
    await expect(start).toHaveValue('31.02.2026');
    await expect(popup).toBeVisible();
    await page.setViewportSize({ width: 1280, height: 800 });
    await expect(page.locator('.task-panel')).not.toHaveAttribute(
      'data-panel-scroll-owner',
    );
    await expect(
      page.locator('.task-panel [data-panel-scroll-owner]'),
    ).toHaveCount(1);
    expect(
      await start.evaluate(
        (node, original) => node === original,
        originalInput,
      ),
    ).toBe(true);
    await page
      .getByRole('button', { name: 'Очистить все сроки', exact: true })
      .click();
    await expect(start).toHaveValue('');
    await expect(finish).toHaveValue('');
    await expect(page.getByRole('alert')).toHaveCount(0);
    const picker = page.getByLabel('Календарь: Начало', { exact: true });
    await picker.click();
    await page.keyboard.press('Escape');
    await expect(popup).toBeVisible();
    await expect(
      page.getByRole('complementary', { name: 'Задача', exact: true }),
    ).toBeVisible();
    await start.fill('09.10.2026');
    const duration = page.getByLabel('Длительность, рабочих дней', {
      exact: true,
    });
    await duration.fill('2');
    await duration.press('Enter');
    await expect(finish).toHaveValue('12.10.2026');
    const envelopes: unknown[] = [];
    await page.route('**/api/projects/*/commands', async (route) => {
      envelopes.push(route.request().postDataJSON());
      if (envelopes.length === 1) {
        const response = await route.fetch();
        expect(response.status()).toBe(200);
        await route.abort('failed');
      } else await route.continue();
    });
    await page.getByRole('button', { name: 'Сохранить', exact: true }).click();
    await expect(
      page.getByRole('button', { name: 'Повторить сохранение', exact: true }),
    ).toBeVisible();
    await expect(duration).toBeDisabled();
    await page
      .getByRole('button', { name: 'Повторить сохранение', exact: true })
      .click();
    await expect(page.getByText('Сохранено', { exact: true })).toBeVisible();
    expect(envelopes).toHaveLength(2);
    expect(envelopes[1]).toEqual(envelopes[0]);
    const after = await readTree(page, runtime.origin, before.project.id);
    expect(after.project.revision).toBe(before.project.revision + 1);
    expect(after.tasks.find((t) => t.title === 'Работа A')).toMatchObject({
      inputStart: '2026-10-09',
      inputFinish: '2026-10-12',
      durationDays: 2,
    });
  } finally {
    try {
      await page.context().close();
    } finally {
      await runtime.close();
    }
  }
});

test('unfinished duration keyboard buffer survives Done, Escape, tabs and repair without saving null', async ({
  page,
}) => {
  // Repairing only the raw duration needs a working-day start after Today.
  // Keep Date fixed while real timers and animation frames continue to run.
  await page.clock.setFixedTime(new Date('2026-10-09T12:00:00Z'));
  const runtime = await syntheticRuntime();
  try {
    let before = await seedOptionalRuntime(page, runtime);
    const id = before.tasks.find((t) => t.title === 'Работа A')!.id;
    before = await send(page, runtime.origin, before, {
      type: 'task.edit',
      taskId: id,
      changes: {
        inputStart: '2026-10-09',
        inputFinish: '2026-10-12',
        durationDays: 2,
      },
    });
    await page.goto(runtime.origin);
    await page.getByRole('treeitem', { name: /Работа A,/ }).click();
    await openTaskDates(page);
    const duration = page.getByLabel('Длительность, рабочих дней', {
      exact: true,
    });
    await duration.fill('');
    await duration.pressSequentially('1e');
    await page.getByRole('button', { name: 'Готово', exact: true }).click();
    await expect(
      page.getByRole('dialog', { name: 'Сроки задачи', exact: true }),
    ).toBeVisible();
    await expect(duration).toHaveValue('1e');
    await expect(duration).toHaveAttribute('aria-invalid', 'true');
    await expect(
      page.getByRole('button', { name: 'Сохранить', exact: true }),
    ).toBeDisabled();
    expect(await readTree(page, runtime.origin, before.project.id)).toEqual(
      before,
    );
    await duration.focus();
    await page.keyboard.press('Escape');
    await page
      .getByRole('tablist', { name: 'Задача', exact: true })
      .getByRole('tab', { name: 'Ход работы', exact: true })
      .click();
    await page
      .getByRole('button', { name: 'Исправить сроки', exact: true })
      .click();
    await expect(duration).toBeFocused();
    await expect(duration).toHaveValue('1e');
    await duration.press('Backspace');
    await expect(duration).toHaveValue('1');
    await duration.pressSequentially('e');
    await expect(duration).toHaveValue('1e');
    await page
      .getByRole('dialog', { name: 'Сроки задачи', exact: true })
      .getByRole('button', { name: 'Сегодня', exact: true })
      .click();
    await expect(page.getByLabel('Начало', { exact: true })).toHaveValue(
      '09.10.2026',
    );
    await expect(duration).toHaveValue('1e');
    await expect(duration).toHaveAttribute('aria-invalid', 'true');
    await duration.fill('3');
    await duration.press('Enter');
    await expect(
      page.getByRole('button', { name: 'Сохранить', exact: true }),
    ).toBeEnabled();
    await duration.fill('-');
    await page.getByRole('button', { name: 'Готово', exact: true }).click();
    await expect(duration).toHaveValue('-');
    await expect(duration).toHaveAttribute('aria-invalid', 'true');
    await duration.fill('');
    await page.getByRole('button', { name: 'Готово', exact: true }).click();
    await expect(
      page.getByRole('dialog', { name: 'Сроки задачи', exact: true }),
    ).toBeHidden();
    await expect(page.getByText('Сохранено', { exact: true })).toBeVisible();
    expect(
      (await readTree(page, runtime.origin, before.project.id)).tasks.find(
        (t) => t.id === id,
      )!.durationDays,
    ).toBeNull();
  } finally {
    try {
      await page.context().close();
    } finally {
      await runtime.close();
    }
  }
});

test('cleared duration keeps an inverted finish invalid and presets repair the actual finish or duration', async ({
  page,
}) => {
  const runtime = await syntheticRuntime();
  try {
    let before = await seedOptionalRuntime(page, runtime);
    const id = before.tasks.find((t) => t.title === 'Работа A')!.id;
    before = await send(page, runtime.origin, before, {
      type: 'task.edit',
      taskId: id,
      changes: {
        inputStart: '2026-10-09',
        inputFinish: '2026-10-12',
        durationDays: 2,
      },
    });
    await page.goto(runtime.origin);
    await page.getByRole('treeitem', { name: /Работа A,/ }).click();
    await openTaskDates(page);
    const finish = page.getByLabel('Окончание', { exact: true }),
      duration = page.getByLabel('Длительность, рабочих дней', { exact: true });
    await finish.fill('08.10.2026');
    await finish.press('Tab');
    await duration.fill('');
    await page.getByRole('button', { name: 'Готово', exact: true }).click();
    await expect(finish).toHaveValue('08.10.2026');
    await expect(duration).toHaveValue('');
    await expect(finish).toHaveAttribute('aria-invalid', 'true');
    await expect(
      page.getByRole('dialog', { name: 'Сроки задачи', exact: true }),
    ).toBeVisible();
    await expect(
      page.getByRole('button', { name: 'Сохранить', exact: true }),
    ).toBeDisabled();
    await finish.fill('31.02.2026');
    await finish.press('Tab');
    await page
      .getByRole('dialog', { name: 'Сроки задачи', exact: true })
      .getByRole('button', { name: 'Сегодня', exact: true })
      .click();
    await expect(finish).toHaveAttribute('aria-invalid', 'true');
    await expect(page.getByRole('alert')).toContainText('Окончание:');
    await finish.focus();
    await page.keyboard.press('Escape');
    await page
      .getByRole('button', { name: 'Исправить сроки', exact: true })
      .click();
    await expect(finish).toBeFocused();
    await page
      .getByRole('button', { name: 'Очистить все сроки', exact: true })
      .click();
    await duration.fill('0');
    await duration.press('Tab');
    await page
      .getByRole('dialog', { name: 'Сроки задачи', exact: true })
      .getByRole('button', { name: 'Завтра', exact: true })
      .click();
    await expect(duration).toHaveAttribute('aria-invalid', 'true');
    await expect(page.getByRole('alert')).toContainText('Длительность:');
    await duration.focus();
    await page.keyboard.press('Escape');
    await page
      .getByRole('button', { name: 'Исправить сроки', exact: true })
      .click();
    await expect(duration).toBeFocused();
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
