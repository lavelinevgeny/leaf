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
    await duration.fill('3');
    await expect(finish).toHaveValue('06.10.2026');
    await duration.press('Enter');
    await expect(finish).toHaveValue('07.10.2026');
    await start.fill('09.10.2026');
    await start.press('Tab');
    await expect(finish).toHaveValue('13.10.2026');
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
      .getByRole('button', { name: 'Отменить последнее изменение' })
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
    await runtime.close();
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
    await duration.fill('6');
    await duration.press('Enter');
    await expect(start).toHaveValue('');
    await expect(finish).toHaveValue('');
    await finish.fill('12.10.2026');
    await finish.press('Enter');
    await expect(start).toHaveValue('05.10.2026');
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
    await finish.fill('');
    await finish.press('Enter');
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
    await runtime.close();
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
      .getByRole('button', { name: 'Отбросить изменения', exact: true })
      .click();
    await expect(finish).toHaveValue('06.10.2026');
    await expect(page.getByRole('alert')).toHaveCount(0);
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
    await runtime.close();
  }
});
