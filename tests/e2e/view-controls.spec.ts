import { test, expect, type Locator, type Page } from '@playwright/test';
import { randomUUID } from 'node:crypto';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { syntheticRuntime } from '../../scripts/e2e-server.js';
import {
  readTree,
  seedOptionalRuntime,
  send,
} from '../helpers/optional-e2e.js';

const captures = mkdtempSync(join(tmpdir(), 'leaf-c22-views-'));

async function geometry(page: Page, row: Locator) {
  const boxes = await Promise.all([
    page.locator('.workspace-header').boundingBox(),
    page.locator('.gantt-toolbar').boundingBox(),
    page.locator('.timeline-heading').boundingBox(),
    page.locator('[data-plan-scroll]').boundingBox(),
    row.boundingBox(),
  ]);
  expect(boxes.every(Boolean)).toBe(true);
  return {
    boxes: boxes.map((box) => ({ y: box!.y, height: box!.height })),
    scrollTop: await page
      .locator('[data-plan-scroll]')
      .evaluate((node) => node.scrollTop),
  };
}

async function sameGeometry(
  page: Page,
  row: Locator,
  before: Awaited<ReturnType<typeof geometry>>,
) {
  const after = await geometry(page, row);
  for (let i = 0; i < before.boxes.length; i++) {
    expect(
      Math.abs(after.boxes[i]!.y - before.boxes[i]!.y),
    ).toBeLessThanOrEqual(1);
    expect(
      Math.abs(after.boxes[i]!.height - before.boxes[i]!.height),
    ).toBeLessThanOrEqual(1);
  }
  expect(Math.abs(after.scrollTop - before.scrollTop)).toBeLessThanOrEqual(1);
}

test('view controls retain scrolled geometry, selected panel, dirty editor, period and server snapshot', async ({
  page,
}, info) => {
  const runtime = await syntheticRuntime();
  try {
    let tree = await seedOptionalRuntime(page, runtime);
    const renamed = await page.request.patch(
      runtime.origin + '/api/projects/' + tree.project.id,
      {
        headers: { Origin: runtime.origin, 'X-Leaf-Contract-Version': '2' },
        data: {
          contractVersion: 2,
          expectedRevision: tree.project.revision,
          operationId: randomUUID(),
          title:
            'Synthetic stable views with a deliberately long project title for desktop acceptance',
        },
      },
    );
    expect(renamed.status()).toBe(200);
    tree = await renamed.json();
    tree = await send(page, runtime.origin, tree, {
      type: 'project.schedule',
      changes: { timezone: 'Asia/Tokyo' },
    });
    for (let n = 0; n < 34; n++)
      tree = await send(page, runtime.origin, tree, {
        type: 'task.create',
        title: `Synthetic row ${n}`,
        parentId: null,
      });
    await page.clock.install({ time: new Date('2026-10-08T23:30:00Z') });
    await page.goto(runtime.origin);
    await expect(
      page.getByRole('heading', { name: tree.project.title, exact: true }),
    ).toBeVisible();
    const writes: string[] = [];
    page.on('request', (request) => {
      if (!['GET', 'HEAD'].includes(request.method()))
        writes.push(request.method());
    });
    const list = page.getByRole('button', { name: 'Список', exact: true });
    const gantt = page.getByRole('button', { name: 'Гант', exact: true });
    await expect(
      page.getByRole('group', { name: 'Представление задач' }),
    ).toBeVisible();
    await expect(gantt).toHaveAttribute('aria-pressed', 'true');
    const rows = page
      .getByRole('tree', { name: 'Задачи', exact: true })
      .getByRole('treeitem');
    expect((await rows.first().boundingBox())!.y).toBeLessThanOrEqual(230);
    const today = page.getByRole('button', { name: 'Сегодня', exact: true });
    await today.hover();
    await expect(page.getByRole('tooltip')).toHaveText('09.10.2026');
    await expect(today).toHaveAccessibleDescription('09.10.2026');
    const todayCapture = join(captures, info.project.name + '-today.png');
    await page.screenshot({ path: todayCapture });
    await page.mouse.move(0, 0);
    await expect(page.getByRole('tooltip')).toHaveCount(0);
    await today.focus();
    await expect(page.getByRole('tooltip')).toHaveText('09.10.2026');
    await today.press('Enter');
    await expect(page.locator('.gantt-today')).toHaveAttribute(
      'aria-label',
      'Сегодня: 2026-10-09',
    );
    await expect(page.locator('.gantt-toolbar')).not.toContainText(
      /\d{4}-\d{2}-\d{2}/,
    );
    const parentRow = page.getByRole('treeitem', { name: /^Этап P,/ });
    await page
      .getByRole('button', { name: 'Свернуть Этап P', exact: true })
      .click();
    await expect(parentRow).toHaveAttribute('aria-expanded', 'false');
    await page
      .getByLabel('Масштаб Ганта', { exact: true })
      .selectOption('weeks');
    await page.getByRole('button', { name: 'Следующий период' }).click();
    const period = await page.locator('.gantt-month').allTextContents();
    const horizontal = page.locator('.timeline-time');
    await horizontal.evaluate((node) => {
      node.scrollLeft = 180;
    });
    await expect
      .poll(() => horizontal.evaluate((node) => node.scrollLeft))
      .toBe(180);
    await page.locator('[data-plan-scroll]').evaluate((node) => {
      node.scrollTop = 400;
    });
    const visibleId = await rows.evaluateAll((nodes) =>
      nodes
        .find((node) => {
          const box = node.getBoundingClientRect();
          const area = node
            .closest('[data-plan-scroll]')!
            .getBoundingClientRect();
          return box.y >= area.y && box.bottom <= area.bottom;
        })!
        .getAttribute('data-task-id'),
    );
    const row = page.locator(`[role="treeitem"][data-task-id="${visibleId}"]`);
    const rowHandle = await row.elementHandle();
    const before = await geometry(page, row);
    const controlX = (await page
      .getByRole('group', { name: 'Представление задач' })
      .boundingBox())!.x;
    expect(before.scrollTop).toBe(400);
    await list.focus();
    await list.press('Space');
    await expect(list).toHaveAttribute('aria-pressed', 'true');
    await expect(gantt).toHaveAttribute('aria-pressed', 'false');
    await expect(list).toBeFocused();
    await expect(page.getByLabel('Масштаб Ганта', { exact: true })).toHaveCount(
      0,
    );
    for (const name of ['Сегодня', 'Предыдущий период', 'Следующий период'])
      await expect(page.getByRole('button', { name, exact: true })).toHaveCount(
        0,
      );
    await sameGeometry(page, row, before);
    expect(
      (await page
        .getByRole('group', { name: 'Представление задач' })
        .boundingBox())!.x,
    ).toBe(controlX);
    const listCapture = join(
      captures,
      info.project.name + '-scrolled-list.png',
    );
    await page.screenshot({ path: listCapture });
    await gantt.focus();
    await gantt.press('Enter');
    await expect(gantt).toHaveAttribute('aria-pressed', 'true');
    await expect(gantt).toBeFocused();
    await sameGeometry(page, row, before);
    await expect(page.getByLabel('Масштаб Ганта', { exact: true })).toHaveValue(
      'weeks',
    );
    expect(await page.locator('.gantt-month').allTextContents()).toEqual(
      period,
    );
    expect(await horizontal.evaluate((node) => node.scrollLeft)).toBe(180);
    expect(await rowHandle!.evaluate((node) => node.isConnected)).toBe(true);
    await expect(parentRow).toHaveAttribute('aria-expanded', 'false');
    for (const child of tree.tasks.filter(
      (task) => task.parentId === tree.tasks[0]!.id,
    ))
      await expect(
        page.locator(`[role="treeitem"][data-task-id="${child.id}"]`),
      ).toHaveCount(0);
    const ganttCapture = join(
      captures,
      info.project.name + '-scrolled-gantt.png',
    );
    await page.screenshot({ path: ganttCapture });

    // The active draft initially reveals itself; subsequent view actions must keep the chosen period.
    await row.press('Shift+Enter');
    const editor = page.getByLabel('Новая задача', { exact: true });
    await editor.fill('Synthetic dirty quick draft');
    const editorHandle = await editor.elementHandle();
    await row.press('Enter');
    const panel = page.locator('.task-panel');
    await expect(panel).toBeVisible();
    await expect(row).toHaveAttribute('aria-selected', 'true');
    const withCleanPanel = await geometry(page, row);
    await editor.focus();
    await editor.evaluate((node: HTMLInputElement) =>
      node.setSelectionRange(2, 7),
    );
    await list.click();
    await expect(editor).toBeFocused();
    expect(
      await editor.evaluate((node: HTMLInputElement) => [
        node.selectionStart,
        node.selectionEnd,
      ]),
    ).toEqual([2, 7]);
    await sameGeometry(page, row, withCleanPanel);
    await gantt.click();
    await expect(editor).toBeFocused();
    expect(
      await editor.evaluate((node: HTMLInputElement) => [
        node.selectionStart,
        node.selectionEnd,
      ]),
    ).toEqual([2, 7]);
    await sameGeometry(page, row, withCleanPanel);
    await expect(editor).toHaveValue('Synthetic dirty quick draft');
    expect(await editorHandle!.evaluate((node) => node.isConnected)).toBe(true);
    const description = panel.getByLabel('Описание', { exact: true });
    await description.fill('Synthetic unsaved panel draft');
    const descriptionHandle = await description.elementHandle();
    await description.evaluate((node: HTMLTextAreaElement) =>
      node.setSelectionRange(3, 9),
    );
    await expect(editor).toBeDisabled();
    const withDraft = await geometry(page, row);
    const draftPeriod = await page.locator('.gantt-month').allTextContents();
    const draftOffset = await horizontal.evaluate((node) => node.scrollLeft);
    await list.click();
    await expect(description).toBeFocused();
    expect(
      await description.evaluate((node: HTMLTextAreaElement) => [
        node.selectionStart,
        node.selectionEnd,
      ]),
    ).toEqual([3, 9]);
    expect(await descriptionHandle!.evaluate((node) => node.isConnected)).toBe(
      true,
    );
    await sameGeometry(page, row, withDraft);
    await expect(description).toHaveValue('Synthetic unsaved panel draft');
    await expect(row).toHaveAttribute('aria-selected', 'true');
    const panelCapture = join(
      captures,
      info.project.name + '-panel-draft-list.png',
    );
    await page.screenshot({ path: panelCapture });
    await gantt.click();
    await expect(description).toBeFocused();
    expect(
      await description.evaluate((node: HTMLTextAreaElement) => [
        node.selectionStart,
        node.selectionEnd,
      ]),
    ).toEqual([3, 9]);
    expect(await descriptionHandle!.evaluate((node) => node.isConnected)).toBe(
      true,
    );
    await sameGeometry(page, row, withDraft);
    expect(await page.locator('.gantt-month').allTextContents()).toEqual(
      draftPeriod,
    );
    expect(await horizontal.evaluate((node) => node.scrollLeft)).toBe(
      draftOffset,
    );
    await list.click();
    await sameGeometry(page, row, withDraft);
    await gantt.click();
    await sameGeometry(page, row, withDraft);
    await expect(editor).toHaveValue('Synthetic dirty quick draft');
    const panelGanttCapture = join(
      captures,
      info.project.name + '-panel-draft-gantt.png',
    );
    await page.screenshot({ path: panelGanttCapture });
    const search = page.getByRole('searchbox', {
      name: 'Поиск задач',
      exact: true,
    });
    await search.fill('Synthetic row');
    const filteredGeometry = await geometry(page, row);
    const filteredIds = await rows.evaluateAll((nodes) =>
      nodes.map((node) => node.getAttribute('data-task-id')),
    );
    await list.click();
    await sameGeometry(page, row, filteredGeometry);
    await gantt.click();
    await sameGeometry(page, row, filteredGeometry);
    await expect(search).toHaveValue('Synthetic row');
    expect(
      await rows.evaluateAll((nodes) =>
        nodes.map((node) => node.getAttribute('data-task-id')),
      ),
    ).toEqual(filteredIds);
    await expect(editor).toHaveValue('Synthetic dirty quick draft');
    await expect(description).toHaveValue('Synthetic unsaved panel draft');
    expect(await readTree(page, runtime.origin, tree.project.id)).toEqual(tree);
    expect(writes).toEqual([]);
    console.log(
      'C22 view evidence',
      JSON.stringify({
        viewport: info.project.name,
        visibleId,
        geometry: before,
        panelGeometry: withDraft,
        writes: writes.length,
        captures: [
          todayCapture,
          listCapture,
          ganttCapture,
          panelCapture,
          panelGanttCapture,
        ],
      }),
    );
  } finally {
    await runtime.close();
  }
});
