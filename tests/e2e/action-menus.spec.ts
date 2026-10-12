import type { Locator, Page } from '@playwright/test';
import {
  test,
  expect,
  seedJournal,
  createJournalEntry,
  openProjectJournal,
  projectFeed,
  entryCard,
} from '../helpers/journal-e2e.js';

async function rects(locator: Locator) {
  return locator.evaluateAll((nodes) =>
    nodes.map((node) => {
      const r = node.getBoundingClientRect();
      return [r.x, r.y, r.width, r.height];
    }),
  );
}
async function menuInViewport(page: Page) {
  return page.getByRole('menu').evaluate((node) => {
    const r = node.getBoundingClientRect();
    const hit = document.elementFromPoint(r.left + r.width / 2, r.bottom - 6);
    return {
      inside:
        r.top >= 0 &&
        r.left >= 0 &&
        r.bottom <= window.innerHeight &&
        r.right <= document.documentElement.clientWidth,
      onTop: !!hit && node.contains(hit),
      side: (node as HTMLElement).dataset.side,
    };
  });
}
// Spec §6: menus must not *add* horizontal scroll. The workspace header already
// overflows below ~900px independently of menus (tracked separately in STATUS).
async function documentWidth(page: Page) {
  return page.evaluate(() => document.documentElement.scrollWidth);
}

test('U03/U04 row menu floats above rows without shifting them and stays in viewport', async ({
  page,
  runtime,
}) => {
  await seedJournal(page, runtime);
  await page.setViewportSize({ width: 1280, height: 420 });
  await page.goto(runtime.origin);
  const rows = page.locator('[role="treeitem"][data-task-id]');
  const last = rows.last();
  await last.scrollIntoViewIfNeeded();
  const title = last.locator('.task-title');
  const date = last.locator('.task-date');
  const beforeHover = await rects(title.or(date));
  await last.hover();
  expect(await rects(title.or(date))).toEqual(beforeHover);
  const trigger = last.getByRole('button', { name: /^Действия задачи: / });
  await trigger.focus();
  expect(await rects(title.or(date))).toEqual(beforeHover);
  const scroller = page.locator('[data-plan-scroll]');
  const scrollTop = () => scroller.evaluate((node) => node.scrollTop);
  const beforeScroll = await scrollTop();
  const before = await rects(rows);
  await trigger.click();
  await expect(page.getByRole('menu')).toBeVisible();
  expect(await rects(rows)).toEqual(before);
  expect(await scrollTop()).toBe(beforeScroll);
  expect(await menuInViewport(page)).toEqual({
    inside: true,
    onTop: true,
    side: 'above',
  });
  await page.keyboard.press('Escape');
  await expect(page.getByRole('menu')).toBeHidden();
  await expect(trigger).toBeFocused();
  expect(await rects(rows)).toEqual(before);
  expect(await scrollTop()).toBe(beforeScroll);
});

test('U03 visible row trigger keeps rows exactly 38px in the main and subtask trees', async ({
  page,
  runtime,
}) => {
  await seedJournal(page, runtime);
  await page.goto(runtime.origin);
  async function expectRowHeights(rows: Locator) {
    const row = rows.first();
    await row.hover();
    await expect(
      row.getByRole('button', { name: /^Действия задачи: / }),
    ).toHaveCSS('opacity', '1');
    const heights = (await rects(rows)).map(([, , , height]) => height);
    expect(heights.length).toBeGreaterThan(1);
    expect(heights).toEqual(heights.map(() => 38));
  }
  const main = page.getByRole('tree', { name: 'Задачи', exact: true });
  await expectRowHeights(main.locator('[role="treeitem"][data-task-id]'));
  await main.getByRole('treeitem', { name: /^Этап P,/ }).click();
  const panel = page.getByRole('complementary', { name: 'Задача' });
  await panel.getByRole('tab', { name: 'Подзадачи' }).click();
  await expectRowHeights(page.locator('#panel-subtasks [role="treeitem"]'));
});

test('U11/U12 row trigger is at least 28px; its menu fits 375px and 200% zoom without adding horizontal scroll', async ({
  page,
  runtime,
}) => {
  await seedJournal(page, runtime);
  for (const size of [
    { width: 375, height: 812 },
    { width: 720, height: 450 },
  ]) {
    await page.setViewportSize(size);
    await page.goto(runtime.origin);
    const row = page.locator('[role="treeitem"][data-task-id]').first();
    const trigger = row.getByRole('button', { name: /^Действия задачи: / });
    await row.hover();
    const box = (await trigger.boundingBox())!;
    expect(box.width).toBeGreaterThanOrEqual(28);
    expect(box.height).toBeGreaterThanOrEqual(28);
    const width = await documentWidth(page);
    await trigger.click();
    expect((await menuInViewport(page)).inside).toBe(true);
    expect(await documentWidth(page)).toBe(width);
    await page.keyboard.press('Escape');
  }
});

async function seedEntries(
  page: Page,
  runtime: Parameters<typeof seedJournal>[1],
) {
  const { tree, summaryId, deepId } = await seedJournal(page, runtime);
  let revision = 0;
  const ids: string[] = [];
  for (const [day, taskId] of [
    ['2026-10-07', summaryId],
    ['2026-10-08', deepId],
    ['2026-10-10', summaryId],
    ['2026-10-10', deepId],
  ] as const) {
    const result = await createJournalEntry(
      page,
      runtime.origin,
      tree.project.id,
      taskId,
      revision,
      `Синтетическая запись ${day} ${'длинный текст '.repeat(12)}`,
      day,
    );
    if (result.kind !== 'saved') throw new Error('Missing saved entry');
    revision = result.journalRevision;
    ids.push(result.entry.id);
  }
  return { tree, ids };
}

test('U03/U04 entry menu floats without resizing entries and flips at the bottom edge', async ({
  page,
  runtime,
}) => {
  const { ids } = await seedEntries(page, runtime);
  await page.setViewportSize({ width: 1280, height: 520 });
  await openProjectJournal(page, runtime.origin);
  const entries = projectFeed(page).locator('[data-journal-entry-id]');
  await expect(entries).toHaveCount(4);
  const oldest = entryCard(page, ids[0]!);
  await oldest.scrollIntoViewIfNeeded();
  const before = await rects(entries);
  const scrollTop = () =>
    projectFeed(page)
      .locator('[data-journal-scroll]')
      .evaluate((node) => node.scrollTop);
  const top = await scrollTop();
  const trigger = oldest.getByRole('button', { name: /^Действия записи / });
  await trigger.click();
  await expect(
    page.getByRole('menuitem', { name: 'Удалить запись' }),
  ).toBeVisible();
  expect(await rects(entries)).toEqual(before);
  expect(await scrollTop()).toBe(top);
  expect(await menuInViewport(page)).toEqual({
    inside: true,
    onTop: true,
    side: 'above',
  });
  await page.keyboard.press('Escape');
  await expect(trigger).toBeFocused();
  expect(await rects(entries)).toEqual(before);
  expect(await scrollTop()).toBe(top);
});

test('U11/U12 entry trigger is at least 28px; its menu fits 375px and 200% zoom without adding horizontal scroll', async ({
  page,
  runtime,
}) => {
  const { ids } = await seedEntries(page, runtime);
  for (const size of [
    { width: 375, height: 812 },
    { width: 720, height: 450 },
  ]) {
    await page.setViewportSize(size);
    await openProjectJournal(page, runtime.origin);
    const trigger = entryCard(page, ids[3]!).getByRole('button', {
      name: /^Действия записи /,
    });
    await trigger.hover();
    const box = (await trigger.boundingBox())!;
    expect(box.width).toBeGreaterThanOrEqual(28);
    expect(box.height).toBeGreaterThanOrEqual(28);
    const width = await documentWidth(page);
    await trigger.click();
    await expect(page.getByRole('menu')).toBeVisible();
    expect((await menuInViewport(page)).inside).toBe(true);
    expect(await documentWidth(page)).toBe(width);
    await page.keyboard.press('Escape');
  }
});

test('U07 feed dates align with the first toolbar action', async ({
  page,
  runtime,
}) => {
  await seedEntries(page, runtime);
  await openProjectJournal(page, runtime.origin);
  const align = await projectFeed(page).evaluate((node) => {
    const add = node
      .querySelector('[data-journal-add]')!
      .getBoundingClientRect();
    const date = node
      .querySelector('[data-journal-date]')!
      .getBoundingClientRect();
    return { add: Math.round(add.x), date: Math.round(date.x) };
  });
  expect(Math.abs(align.add - align.date)).toBeLessThanOrEqual(1);
});
