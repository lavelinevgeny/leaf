import {
  test,
  expect,
  seedJournal,
  createJournalEntry,
  readJournalPage,
  openProjectJournal,
  projectFeed,
  entryCard,
  editEntry,
  chooseTask,
  journalGeometry,
  mutateJournal,
  planContent,
} from '../helpers/journal-e2e.js';
import { readTree, send } from '../helpers/optional-e2e.js';

test('real task create, project edit/date/delete, plain text, independent plan and reopen', async ({
  page,
  runtime,
}) => {
  const { tree, doneId, summaryId } = await seedJournal(page, runtime);
  const before = planContent(
    await readTree(page, runtime.origin, tree.project.id),
  );
  await page.goto(runtime.origin);
  await page.getByRole('treeitem', { name: /^Работа A,/ }).click();
  const panel = page.getByRole('complementary', {
    name: 'Задача',
    exact: true,
  });
  await panel.getByRole('tab', { name: 'Ход работы', exact: true }).click();
  await panel.getByLabel('Дата записи', { exact: true }).fill('2026-10-09');
  const body =
    '  Синтетическая работа\n<script>window.journalInjected = true</script>\nстрока %/_  ';
  await panel.getByLabel('Текст записи').fill(body);
  await panel.getByLabel('Текст записи').press('Control+Enter');
  await expect(panel.getByText(body, { exact: true })).toBeVisible();
  expect(await page.evaluate(() => 'journalInjected' in window)).toBe(false);
  await panel
    .getByRole('button', { name: 'Закрыть панель', exact: true })
    .click();
  await page
    .getByRole('tablist', { name: 'Представление проекта' })
    .getByRole('tab', { name: 'Журнал', exact: true })
    .click();
  let feed = await readJournalPage(page, runtime.origin, tree.project.id);
  expect(feed.entries).toHaveLength(1);
  expect(feed.entries[0]).toMatchObject({
    taskId: doneId,
    body,
    workDate: '2026-10-09',
  });
  const id = feed.entries[0]!.id;
  const editor = await editEntry(page, id);
  await editor.getByLabel('Дата записи', { exact: true }).fill('2026-10-11');
  await editor.getByLabel('Текст записи').fill('Изменённая запись');
  await editor
    .getByRole('button', { name: 'Сохранить запись', exact: true })
    .click();
  await expect(
    entryCard(page, id).getByText('Изменённая запись', { exact: true }),
  ).toBeVisible();
  await createJournalEntry(
    page,
    runtime.origin,
    tree.project.id,
    summaryId,
    2,
    'Родитель принимает записи',
    '2026-10-10',
  );
  await page.reload();
  await expect(
    entryCard(page, id).getByText('11.10.2026', { exact: true }),
  ).toBeVisible();
  await runtime.restart();
  await page.reload();
  feed = await readJournalPage(page, runtime.origin, tree.project.id);
  expect(feed.entries[0]).toMatchObject({
    id,
    body: 'Изменённая запись',
    workDate: '2026-10-11',
  });
  await entryCard(page, id)
    .getByRole('button', { name: /Действия записи/ })
    .click();
  await page.getByRole('menuitem', { name: 'Удалить запись' }).click();
  await entryCard(page, id)
    .getByRole('button', { name: 'Отмена удаления' })
    .click();
  expect(
    (await readJournalPage(page, runtime.origin, tree.project.id)).entries,
  ).toHaveLength(2);
  await entryCard(page, id)
    .getByRole('button', { name: /Действия записи/ })
    .click();
  await page.getByRole('menuitem', { name: 'Удалить запись' }).click();
  await entryCard(page, id)
    .getByRole('button', { name: 'Подтвердить удаление записи' })
    .click();
  await expect(entryCard(page, id)).toHaveCount(0);
  expect(
    planContent(await readTree(page, runtime.origin, tree.project.id)),
  ).toEqual(before);
  await page.reload();
  expect(
    (await readJournalPage(page, runtime.origin, tree.project.id)).entries.map(
      (e) => e.body,
    ),
  ).toEqual(['Родитель принимает записи']);
});

test('125 records, inclusive dates, Russian/title/literal search, boundary pagination and stale refresh', async ({
  page,
  runtime,
}) => {
  const { tree: initialTree, deepId } = await seedJournal(page, runtime);
  let tree = initialTree;
  const ids: string[] = [];
  for (let index = 0; index < 125; index++) {
    const result = await createJournalEntry(
      page,
      runtime.origin,
      tree.project.id,
      deepId,
      index,
      index === 124 ? 'Ёлка %/_ проверена' : `Запись ${index}`,
      index < 110 ? '2026-10-09' : '2026-10-10',
    );
    if (result.kind === 'saved') ids.push(result.entry.id);
  }
  await openProjectJournal(page, runtime.origin);
  await expect(
    projectFeed(page).locator('[data-journal-entry-id]'),
  ).toHaveCount(50);
  await projectFeed(page).getByRole('button', { name: 'Показать ещё' }).click();
  await expect(
    projectFeed(page).locator('[data-journal-entry-id]'),
  ).toHaveCount(100);
  await projectFeed(page).getByRole('button', { name: 'Показать ещё' }).click();
  await expect(
    projectFeed(page).locator('[data-journal-entry-id]'),
  ).toHaveCount(125);
  expect(
    await projectFeed(page)
      .locator('[data-journal-entry-id]')
      .evaluateAll((nodes) =>
        nodes.map((n) => n.getAttribute('data-journal-entry-id')),
      ),
  ).toEqual(expect.arrayContaining(ids));
  await expect(
    projectFeed(page).getByText('09.10.2026', { exact: true }),
  ).toHaveCount(1);
  await page.getByLabel('Поиск записей', { exact: true }).fill('ёлка');
  await expect(
    projectFeed(page).locator('[data-journal-entry-id]'),
  ).toHaveCount(1);
  await page.getByLabel('Поиск записей', { exact: true }).fill('%/_');
  await expect(
    projectFeed(page).locator('[data-journal-entry-id]'),
  ).toHaveCount(1);
  await page
    .getByLabel('Поиск записей', { exact: true })
    .fill('нет такого текста');
  await expect(
    projectFeed(page).getByText('Нет записей по выбранным условиям'),
  ).toBeVisible();
  await page.getByLabel('Поиск записей', { exact: true }).fill('');
  await projectFeed(page)
    .getByRole('button', { name: 'Период: Все даты', exact: true })
    .click();
  await page.getByLabel('С даты', { exact: true }).fill('2026-10-10');
  await page.getByLabel('По дату', { exact: true }).fill('2026-10-10');
  await page
    .getByRole('group', { name: 'Период журнала' })
    .getByRole('button', { name: 'Применить' })
    .click();
  await expect(
    projectFeed(page).locator('[data-journal-entry-id]'),
  ).toHaveCount(15);
  await projectFeed(page)
    .getByRole('button', { name: 'Сбросить', exact: true })
    .click();
  await expect(
    projectFeed(page).locator('[data-journal-entry-id]'),
  ).toHaveCount(50);
  tree = await send(page, runtime.origin, tree, {
    type: 'task.edit',
    taskId: deepId,
    changes: { title: 'Нынешнее название' },
  });
  await projectFeed(page).getByRole('button', { name: 'Показать ещё' }).click();
  await expect(projectFeed(page).getByRole('alert')).toBeVisible();
  await projectFeed(page)
    .getByRole('button', { name: 'Повторить загрузку' })
    .click();
  await expect(
    projectFeed(page)
      .getByRole('button', { name: 'Нынешнее название', exact: true })
      .first(),
  ).toBeVisible();
  await page.getByLabel('Поиск записей', { exact: true }).fill('НЫНЕШНЕЕ');
  await expect(
    projectFeed(page).locator('[data-journal-entry-id]'),
  ).toHaveCount(50);
  await send(page, runtime.origin, tree, {
    type: 'task.delete',
    taskId: deepId,
  });
  await page.reload();
  await expect(projectFeed(page).getByText('Записей пока нет')).toBeVisible();
});

test('inline composer on long scrolled feed preserves anchor geometry, focus and successful prepend anchor', async ({
  page,
  runtime,
}) => {
  const { tree, summaryId } = await seedJournal(page, runtime);
  for (let index = 0; index < 30; index++)
    await createJournalEntry(
      page,
      runtime.origin,
      tree.project.id,
      summaryId,
      index,
      `Работа ${index}\n${'ДлиннаяСтрока'.repeat(25)}`,
      '2026-10-09',
    );
  await openProjectJournal(page, runtime.origin);
  await projectFeed(page)
    .locator('[data-journal-scroll]')
    .evaluate((node) => {
      node.scrollTop = 720;
    });
  expect(
    await projectFeed(page)
      .locator('[data-journal-scroll]')
      .evaluate((node) => node.scrollTop),
  ).toBeGreaterThan(0);
  const before = await journalGeometry(page);
  expect(before.id).toBeTruthy();
  const pick = (g: Awaited<ReturnType<typeof journalGeometry>>) => ({
    id: g.id,
    offset: g.offset,
    left: g.left,
    cardX: g.cardX,
    cardWidth: g.cardWidth,
    controlsX: g.controlsX,
    controlsY: g.controlsY,
    controlsWidth: g.controlsWidth,
    headerY: g.headerY,
    headerHeight: g.headerHeight,
  });
  const add = projectFeed(page).getByRole('button', {
    name: 'Добавить запись',
    exact: true,
  });
  for (const close of ['Escape', 'cancel']) {
    await add.click();
    const dialog = page.getByRole('region', { name: 'Новая запись журнала' });
    await expect(dialog).toBeVisible();
    expect(pick(await journalGeometry(page))).toEqual(pick(before));
    if (close === 'Escape') await page.keyboard.press('Escape');
    else await dialog.getByRole('button', { name: 'Закрыть редактор' }).click();
    await expect(dialog).toBeHidden();
    await expect(add).toBeFocused();
    expect(await journalGeometry(page)).toEqual(before);
  }
  await add.click();
  const dialog = page.getByRole('region', { name: 'Новая запись журнала' });
  await expect(dialog).toBeVisible();
  expect(pick(await journalGeometry(page))).toEqual(pick(before));
  // With the task picker open the composer does not scroll inside itself:
  // the text field and the date stay visible next to the results list.
  await dialog
    .getByRole('button', { name: 'Выбрать задачу', exact: true })
    .click();
  await expect(dialog.getByRole('listbox')).toBeVisible();
  expect(
    await dialog.evaluate((node) => node.scrollHeight - node.clientHeight),
  ).toBeLessThanOrEqual(0);
  await expect(dialog.getByLabel('Текст записи')).toBeInViewport({ ratio: 1 });
  await expect(
    dialog.getByLabel('Дата записи', { exact: true }),
  ).toBeInViewport({ ratio: 1 });
  await dialog.getByRole('combobox', { name: 'Поиск задачи' }).fill('Этап P');
  await dialog.getByRole('option').last().click();
  await dialog.getByLabel('Дата записи', { exact: true }).fill('2026-10-12');
  await dialog.getByLabel('Текст записи').fill('Новая запись сверху');
  await dialog.getByRole('button', { name: 'Сохранить запись' }).click();
  await expect(dialog).toBeHidden();
  await expect(add).toBeFocused();
  await expect
    .poll(async () => (await journalGeometry(page)).id)
    .toBe(before.id);
  const after = await journalGeometry(page);
  expect(Math.abs(after.offset - before.offset)).toBeLessThan(0.1);
  expect({ ...after, offset: before.offset }).toEqual(before);
  const saved = await readJournalPage(page, runtime.origin, tree.project.id);
  expect(saved.entries[0]).toMatchObject({
    body: 'Новая запись сверху',
    workDate: '2026-10-12',
  });
});

test('open composer with task picker keeps the project feed on screen at 375x812 and 1280x800', async ({
  page,
  runtime,
}) => {
  const { tree, summaryId } = await seedJournal(page, runtime);
  for (let index = 0; index < 12; index++)
    await createJournalEntry(
      page,
      runtime.origin,
      tree.project.id,
      summaryId,
      index,
      `Запись ${index}`,
      '2026-10-09',
    );
  for (const viewport of [
    { width: 375, height: 812 },
    { width: 1280, height: 800 },
  ]) {
    await page.setViewportSize(viewport);
    await openProjectJournal(page, runtime.origin);
    await projectFeed(page)
      .getByRole('button', { name: 'Добавить запись', exact: true })
      .click();
    const composer = page.getByRole('region', {
      name: 'Новая запись журнала',
    });
    await composer
      .getByRole('button', { name: 'Выбрать задачу', exact: true })
      .click();
    await expect(composer.getByRole('listbox')).toBeVisible();
    // Spec §5.7: the feed never collapses under the open composer and the
    // journal pane itself does not overflow (no second outer scroll).
    const geometry = await projectFeed(page).evaluate((node) => {
      const journal = node.querySelector<HTMLElement>('.project-journal')!;
      const feed = node.querySelector<HTMLElement>('[data-journal-scroll]')!;
      return {
        feedHeight: feed.clientHeight,
        feedTop: feed.getBoundingClientRect().top,
        innerHeight,
        overflow: journal.scrollHeight - journal.clientHeight,
      };
    });
    expect(
      geometry.feedHeight,
      JSON.stringify(viewport),
    ).toBeGreaterThanOrEqual(96);
    expect(geometry.feedTop + 96).toBeLessThanOrEqual(geometry.innerHeight);
    expect(geometry.overflow).toBeLessThanOrEqual(1);
    await expect(
      composer.getByRole('combobox', { name: 'Поиск задачи' }),
    ).toBeInViewport({ ratio: 1 });
    // Desktop height fits both: the composer does not scroll inside itself.
    if (viewport.width === 1280)
      expect(
        await composer.evaluate(
          (node) => node.scrollHeight - node.clientHeight,
        ),
      ).toBeLessThanOrEqual(0);
  }
});

test('nested row menu, keyboard tabs and picker include done/summary/undated duplicate paths without plan actions', async ({
  page,
  runtime,
}) => {
  const {
    tree: initialTree,
    deepId,
    summaryId,
  } = await seedJournal(page, runtime);
  let tree = initialTree;
  for (const parentId of [summaryId, deepId])
    tree = await send(page, runtime.origin, tree, {
      type: 'task.create',
      parentId,
      title: 'Одинаковая задача',
    });
  await page.goto(runtime.origin);
  const row = page.locator(`[role="treeitem"][data-task-id="${deepId}"]`);
  const entry = row.getByRole('button', {
    name: 'Добавить запись: Уровень 5',
    exact: true,
  });
  await entry.focus();
  await page.keyboard.press('Enter');
  const panel = page.getByRole('complementary', {
    name: 'Задача',
    exact: true,
  });
  await expect(panel.getByLabel('Текст записи')).toBeFocused();
  await panel.getByLabel('Текст записи').fill('Запись глубокой задачи');
  await panel.getByLabel('Текст записи').press('Meta+Enter');
  await expect(
    panel.getByText('Запись глубокой задачи', { exact: true }),
  ).toBeVisible();
  await panel.getByRole('tab', { name: 'Ход работы', exact: true }).focus();
  await page.keyboard.press('ArrowRight');
  await expect(
    panel.getByRole('tab', { name: 'Задача', exact: true }),
  ).toBeFocused();
  await page.keyboard.press('End');
  await expect(
    panel.getByRole('tab', { name: 'Ход работы', exact: true }),
  ).toBeFocused();
  expect(
    await panel
      .locator('.panel-tabs')
      .evaluate((n) => n.scrollWidth <= n.clientWidth),
  ).toBe(true);
  await panel.getByRole('button', { name: 'Закрыть панель' }).click();
  const projectTabs = page.getByRole('tablist', {
    name: 'Представление проекта',
  });
  await projectTabs.getByRole('tab', { name: 'Задачи', exact: true }).focus();
  await page.keyboard.press('ArrowRight');
  await expect(
    projectTabs.getByRole('tab', { name: 'Журнал', exact: true }),
  ).toBeFocused();
  await projectFeed(page)
    .getByRole('button', { name: 'Добавить запись', exact: true })
    .click();
  const dialog = page.getByRole('region', { name: 'Новая запись журнала' });
  await dialog
    .getByRole('button', { name: 'Выбрать задачу', exact: true })
    .click();
  await expect(
    dialog.getByRole('option', { name: 'Этап P', exact: true }),
  ).toBeVisible();
  await expect(
    dialog.getByRole('option', { name: 'Этап P / Работа A', exact: true }),
  ).toBeVisible();
  await expect(
    dialog.getByRole('option', { name: 'Без дат', exact: true }),
  ).toBeVisible();
  const search = dialog.getByRole('combobox', { name: 'Поиск задачи' });
  await search.fill('Одинаковая задача');
  await expect(dialog.getByRole('option')).toHaveCount(2);
  const paths = await dialog.getByRole('option').allTextContents();
  expect(paths).toContain('Этап P / Одинаковая задача');
  expect(
    paths.some((path) => path.includes('Уровень 5 / Одинаковая задача')),
  ).toBe(true);
  await search.press('ArrowDown');
  await search.press('Enter');
  await expect(dialog.getByRole('combobox')).toHaveCount(0);
  await dialog.getByRole('button', { name: /Одинаковая задача/ }).click();
  await dialog.getByRole('combobox').press('Escape');
  await expect(dialog).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(dialog).toBeHidden();
  const current = await readJournalPage(page, runtime.origin, tree.project.id);
  expect(current.entries[0]?.taskId).toBe(deepId);
  expect(
    planContent(await readTree(page, runtime.origin, tree.project.id)),
  ).toEqual(planContent(tree));
});

test('branch deletion and plan undo restore exact journal rows while surviving later edits stay current', async ({
  page,
  runtime,
}) => {
  const { tree, summaryId, deepId } = await seedJournal(page, runtime);
  const branch = await createJournalEntry(
    page,
    runtime.origin,
    tree.project.id,
    deepId,
    0,
    'Удаляемая глубокая запись',
    '2026-10-09',
  );
  const survivor = await createJournalEntry(
    page,
    runtime.origin,
    tree.project.id,
    summaryId,
    1,
    'Сохраняемая запись',
    '2026-10-10',
  );
  if (branch.kind !== 'saved' || survivor.kind !== 'saved')
    throw new Error('Missing saved entries');
  await page.goto(runtime.origin);
  await page.locator(`[role="treeitem"][data-task-id="${deepId}"]`).click();
  const panel = page.getByRole('complementary', {
    name: 'Задача',
    exact: true,
  });
  page.once('dialog', async (dialog) => {
    expect(dialog.type()).toBe('confirm');
    expect(dialog.message()).toContain('журнал');
    await dialog.accept();
  });
  await panel.getByRole('button', { name: 'Действия задачи' }).click();
  await page.getByRole('menuitem', { name: 'Удалить задачу…' }).click();
  await expect(
    page.locator(`[role="treeitem"][data-task-id="${deepId}"]`),
  ).toHaveCount(0);
  let current = await readJournalPage(page, runtime.origin, tree.project.id);
  expect(current.entries.map((e) => e.id)).toEqual([survivor.entry.id]);
  await mutateJournal(
    page,
    runtime.origin,
    tree.project.id,
    survivor.entry.id,
    current.journalRevision,
    { body: 'Позднее изменение живой записи', workDate: '2026-10-11' },
  );
  await page
    .getByRole('button', { name: 'Отменить изменение плана', exact: true })
    .click();
  await expect(
    page.locator(`[role="treeitem"][data-task-id="${deepId}"]`),
  ).toBeVisible();
  current = await readJournalPage(page, runtime.origin, tree.project.id);
  expect(current.entries.find((e) => e.id === branch.entry.id)).toEqual(
    branch.entry,
  );
  expect(current.entries.find((e) => e.id === survivor.entry.id)).toMatchObject(
    { body: 'Позднее изменение живой записи', workDate: '2026-10-11' },
  );
  expect(current.journalRevision).toBe(5);
  await page
    .getByRole('tablist', { name: 'Представление проекта' })
    .getByRole('tab', { name: 'Журнал', exact: true })
    .click();
  await expect(entryCard(page, branch.entry.id)).toBeVisible();
});

test('row quick actions have their own pointer hit targets over the date', async ({
  page,
  runtime,
}) => {
  const { summaryId, deepId } = await seedJournal(page, runtime);
  await page.goto(runtime.origin);
  for (const view of ['Список', 'Гант']) {
    await page.getByRole('button', { name: view, exact: true }).click();
    for (const id of [summaryId, deepId]) {
      const row = page.locator(`[role="treeitem"][data-task-id="${id}"]`);
      await row.hover();
      const geometry = await row.evaluate((node) =>
        [...node.querySelectorAll('.task-row-actions-inner > button')].map(
          (button) => {
            const a = button.getBoundingClientRect();
            const hit = document.elementFromPoint(
              a.x + a.width / 2,
              a.y + a.height / 2,
            );
            return {
              hit: !!hit && button.contains(hit),
              size: a.width >= 28 && a.height >= 28,
              inRow: a.right <= node.getBoundingClientRect().right,
            };
          },
        ),
      );
      expect(geometry).toEqual([
        { hit: true, size: true, inRow: true },
        { hit: true, size: true, inRow: true },
      ]);
    }
  }
});

test('empty/loading/error/load-more retry and filtered success preserve long plain text in narrow task panel', async ({
  page,
  runtime,
}) => {
  const { tree, summaryId } = await seedJournal(page, runtime);
  await openProjectJournal(page, runtime.origin);
  await expect(projectFeed(page).getByText('Записей пока нет')).toBeVisible();
  await page.getByLabel('Поиск записей', { exact: true }).fill('совпадение');
  await projectFeed(page)
    .getByRole('button', { name: 'Добавить запись', exact: true })
    .click();
  const dialog = page.getByRole('region', { name: 'Новая запись журнала' });
  await chooseTask(dialog, 'Этап P');
  await dialog.getByLabel('Текст записи').fill('Сохранено вне поиска');
  await dialog.getByRole('button', { name: 'Сохранить запись' }).click();
  await expect(dialog).toBeHidden();
  await expect(
    projectFeed(page)
      .getByRole('status')
      .filter({ hasText: 'она не подходит под фильтр' }),
  ).toBeVisible();
  const longText = 'СинтетическаяСтрока'.repeat(400);
  for (let revision = 1; revision <= 51; revision++)
    await createJournalEntry(
      page,
      runtime.origin,
      tree.project.id,
      summaryId,
      revision,
      revision === 51 ? longText : `Синтетическая ${revision}`,
      '2026-10-10',
    );
  let blocked = true;
  await page.route(
    `**/api/projects/${tree.project.id}/journal**`,
    async (route) => {
      if (route.request().method() === 'GET' && blocked)
        await route.abort('failed');
      else await route.continue();
    },
  );
  await page.getByLabel('Поиск записей', { exact: true }).fill('');
  await expect(projectFeed(page).getByRole('alert')).toBeVisible();
  blocked = false;
  let release!: () => void;
  const delay = new Promise<void>((yes) => {
    release = yes;
  });
  await page.unroute(`**/api/projects/${tree.project.id}/journal**`);
  await page.route(
    `**/api/projects/${tree.project.id}/journal**`,
    async (route) => {
      const response = await route.fetch();
      await delay;
      await route.fulfill({ response });
    },
  );
  await projectFeed(page)
    .getByRole('button', { name: 'Повторить загрузку' })
    .click();
  await expect(
    projectFeed(page)
      .getByRole('status', { name: '' })
      .filter({ hasText: 'Загрузка журнала' }),
  ).toBeVisible();
  release();
  await expect(
    projectFeed(page).locator('[data-journal-entry-id]'),
  ).toHaveCount(50);
  await page.unroute(`**/api/projects/${tree.project.id}/journal**`);
  let failedMore = false;
  await page.route(
    `**/api/projects/${tree.project.id}/journal**`,
    async (route) => {
      if (
        new URL(route.request().url()).searchParams.has('cursor') &&
        !failedMore
      ) {
        failedMore = true;
        await route.abort('failed');
      } else await route.continue();
    },
  );
  await projectFeed(page).getByRole('button', { name: 'Показать ещё' }).click();
  await expect(projectFeed(page).getByRole('alert')).toBeVisible();
  await expect(
    projectFeed(page).locator('[data-journal-entry-id]'),
  ).toHaveCount(50);
  await projectFeed(page)
    .getByRole('button', { name: 'Повторить загрузку' })
    .click();
  await expect(
    projectFeed(page).locator('[data-journal-entry-id]'),
  ).toHaveCount(52);
  await projectFeed(page)
    .getByRole('button', { name: 'Этап P', exact: true })
    .first()
    .click();
  const panel = page.getByRole('complementary', {
    name: 'Задача',
    exact: true,
  });
  await expect(panel.getByText(longText, { exact: true })).toBeVisible();
  expect(
    await panel
      .locator('.journal-body')
      .first()
      .evaluate((n) => n.scrollWidth <= n.clientWidth),
  ).toBe(true);
  const box = await panel.boundingBox();
  expect(box!.width).toBeGreaterThanOrEqual(420);
  expect(box!.width).toBeLessThanOrEqual(520);
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
});

test('U08 compact composer: date and actions share a row; Ctrl+Enter save keeps focus in the empty field', async ({
  page,
  runtime,
}) => {
  await seedJournal(page, runtime);
  await page.goto(runtime.origin);
  await page.getByRole('treeitem', { name: /^Работа A,/ }).click();
  const panel = page.getByRole('complementary', {
    name: 'Задача',
    exact: true,
  });
  await panel.getByRole('tab', { name: 'Ход работы', exact: true }).click();
  const editor = panel.locator('[data-journal-editor]');
  const body = editor.getByLabel('Текст записи');
  const save = editor.getByRole('button', {
    name: 'Сохранить запись',
    exact: true,
  });
  await expect(body).toBeEnabled();
  await expect(save).toHaveCount(0);
  await body.fill('Синтетическая запись Ctrl+Enter');
  await expect(save).toBeVisible();
  const row = await editor.evaluate((form) => {
    const date = form
      .querySelector('.journal-editor-footer .calendar-field')!
      .getBoundingClientRect();
    const actions = form
      .querySelector('button[type="submit"]')!
      .getBoundingClientRect();
    const footer = form.querySelector<HTMLElement>('.journal-editor-footer')!;
    return {
      overlap:
        Math.min(date.bottom, actions.bottom) - Math.max(date.top, actions.top),
      overflow: footer.scrollWidth > footer.clientWidth,
    };
  });
  expect(row.overlap).toBeGreaterThan(0);
  expect(row.overflow).toBe(false);
  // Hold the save long enough for the field to be disabled across frames.
  await page.route('**/api/projects/*/journal', async (route) => {
    if (route.request().method() === 'POST')
      await new Promise((resolve) => setTimeout(resolve, 300));
    await route.continue();
  });
  await body.press('Control+Enter');
  await expect(
    panel.getByText('Синтетическая запись Ctrl+Enter', { exact: true }),
  ).toBeVisible();
  await expect(body).toBeEnabled();
  await expect(body).toHaveValue('');
  await expect(body).toBeFocused();
  await expect(save).toHaveCount(0);
  await page.unroute('**/api/projects/*/journal');
  await page.setViewportSize({ width: 375, height: 812 });
  await body.fill('Узкая панель');
  await expect(save).toBeVisible();
  expect(
    await editor.evaluate((form) => {
      const footer = form.querySelector<HTMLElement>('.journal-editor-footer')!;
      const right = form.getBoundingClientRect().right;
      return (
        footer.scrollWidth <= footer.clientWidth &&
        [...footer.querySelectorAll('button, input')].every(
          (node) => node.getBoundingClientRect().right <= right + 0.5,
        )
      );
    }),
  ).toBe(true);
});

test('task panel inline entry editor keeps footer labels on one line without overflow', async ({
  page,
  runtime,
}) => {
  const { tree, doneId } = await seedJournal(page, runtime);
  await createJournalEntry(
    page,
    runtime.origin,
    tree.project.id,
    doneId,
    0,
    'Синтетическая запись для редактора',
    '2026-10-10',
  );
  await page.goto(runtime.origin);
  await page.getByRole('treeitem', { name: /^Работа A,/ }).click();
  const panel = page.getByRole('complementary', {
    name: 'Задача',
    exact: true,
  });
  await panel.getByRole('tab', { name: 'Ход работы', exact: true }).click();
  const card = panel.locator('[data-journal-entry-id]').first();
  await card.getByRole('button', { name: /Действия записи/ }).click();
  await page.getByRole('menuitem', { name: 'Редактировать запись' }).click();
  const editor = card.locator('[data-journal-editor]');
  await expect(
    editor.getByRole('button', { name: 'Сохранить запись', exact: true }),
  ).toBeVisible();
  const measure = () =>
    editor.evaluate((form) => {
      const footer = form.querySelector<HTMLElement>('.journal-editor-footer')!;
      const right = form.getBoundingClientRect().right;
      const buttons = [...footer.querySelectorAll<HTMLElement>('button')]
        .filter((node) => !node.closest('.calendar-field'))
        .map((node) => {
          const range = document.createRange();
          range.selectNodeContents(node);
          const lines = new Set(
            [...range.getClientRects()].map((rect) => Math.round(rect.top)),
          ).size;
          return {
            label: node.textContent,
            lines,
            clipped: node.scrollWidth > node.clientWidth,
            outside: node.getBoundingClientRect().right > right + 0.5,
          };
        });
      return {
        footerOverflow: footer.scrollWidth > footer.clientWidth,
        footerOutside: footer.getBoundingClientRect().right > right + 0.5,
        buttons,
      };
    });
  for (const width of [0, 375]) {
    if (width) await page.setViewportSize({ width, height: 812 });
    const result = await measure();
    expect(result.buttons.length).toBeGreaterThanOrEqual(3);
    expect(result.footerOverflow).toBe(false);
    expect(result.footerOutside).toBe(false);
    for (const button of result.buttons)
      expect(button, String(button.label)).toEqual({
        label: button.label,
        lines: 1,
        clipped: false,
        outside: false,
      });
  }
});

test('acknowledged task write survives failed feed GET and retry reads without a second write', async ({
  page,
  runtime,
}) => {
  const { tree, doneId } = await seedJournal(page, runtime);
  await page.goto(runtime.origin);
  await page.getByRole('treeitem', { name: /^Работа A,/ }).click();
  const panel = page.getByRole('complementary', {
    name: 'Задача',
    exact: true,
  });
  await panel.getByRole('tab', { name: 'Ход работы', exact: true }).click();
  await expect(panel.getByText('Записей пока нет')).toBeVisible();
  let acknowledged = false;
  let writes = 0;
  const projectUrl = `${runtime.origin}/api/projects/${tree.project.id}/journal`;
  const taskUrl = `${runtime.origin}/api/projects/${tree.project.id}/tasks/${doneId}/journal`;
  await page.route(projectUrl, async (route) => {
    if (route.request().method() !== 'POST') return route.continue();
    writes++;
    const response = await route.fetch();
    expect(response.status()).toBe(201);
    acknowledged = true;
    await route.fulfill({ response });
  });
  await page.route(taskUrl, async (route) => {
    if (route.request().method() === 'GET' && acknowledged)
      await route.fulfill({
        status: 503,
        json: {
          error: {
            code: 'SYNTHETIC_UNAVAILABLE',
            message: 'Synthetic read failure',
          },
        },
      });
    else await route.continue();
  });
  await panel.getByLabel('Текст записи').fill('Подтверждённая запись');
  await panel
    .getByRole('button', { name: 'Сохранить запись', exact: true })
    .click();
  await expect(
    panel.getByText('Запись сохранена. Не удалось обновить историю', {
      exact: true,
    }),
  ).toBeVisible();
  await expect(panel.getByLabel('Текст записи')).toHaveValue('');
  await expect(
    panel.getByRole('button', { name: 'Повторить сохранение' }),
  ).toHaveCount(0);
  await page.unroute(taskUrl);
  await panel.getByRole('button', { name: 'Повторить загрузку' }).click();
  await expect(
    panel.getByText('Подтверждённая запись', { exact: true }),
  ).toBeVisible();
  expect(writes).toBe(1);
  const saved = await readJournalPage(page, runtime.origin, tree.project.id);
  expect(saved.journalRevision).toBe(1);
  expect(saved.entries).toHaveLength(1);
});

test('task journal autosizes and preserves anchors and pagination in the actual panel scroll owner', async ({
  page,
  runtime,
}) => {
  const { tree, doneId } = await seedJournal(page, runtime);
  for (let i = 0; i < 55; i++)
    await createJournalEntry(
      page,
      runtime.origin,
      tree.project.id,
      doneId,
      i,
      `Запись прокрутки ${i}\n${'строка\n'.repeat(3)}`,
      '2026-10-09',
    );
  await page.goto(runtime.origin);
  await page.getByRole('treeitem', { name: /^Работа A,/ }).click();
  const panel = page.getByRole('complementary', {
    name: 'Задача',
    exact: true,
  });
  await panel.getByRole('tab', { name: 'Ход работы', exact: true }).click();
  await expect(panel.locator('[data-journal-entry]')).toHaveCount(50);
  const editor = panel.getByLabel('Текст записи');
  await editor.fill('Большой черновик\n'.repeat(24));
  expect(
    await editor.evaluate((node) => ({
      height: node.clientHeight,
      overflow: node.scrollHeight - node.clientHeight,
    })),
  ).toMatchObject({ overflow: 0 });
  expect(await editor.evaluate((node) => node.clientHeight)).toBeGreaterThan(
    300,
  );
  await editor.fill('');
  for (const viewport of [
    { width: 1440, height: 900 },
    { width: 375, height: 812 },
    { width: 1440, height: 180 },
    { width: 1280, height: 800 },
  ]) {
    await page.setViewportSize(viewport);
    await expect
      .poll(() => panel.locator('[data-panel-scroll-owner]').count())
      .toBeLessThanOrEqual(1);
    await expect
      .poll(() =>
        panel.evaluate(
          (node) =>
            node.matches('[data-panel-scroll-owner]') ||
            !!node.querySelector('[data-panel-scroll-owner]'),
        ),
      )
      .toBe(true);
    const owner = () =>
      panel.evaluate((node) => {
        const scroll = node.matches('[data-panel-scroll-owner]')
          ? node
          : node.querySelector('[data-panel-scroll-owner]')!;
        const feed = node.querySelector<HTMLElement>(
          '[data-journal-feed="task"]',
        )!;
        return {
          shell: scroll === node,
          top: scroll.scrollTop,
          feedTop: feed.scrollTop,
          overflow: getComputedStyle(feed).overflowY,
        };
      });
    await expect
      .poll(async () => (await owner()).shell)
      .toBe(viewport.height === 180);
    await panel.evaluate((node) => {
      const scroll = node.matches('[data-panel-scroll-owner]')
        ? node
        : node.querySelector('[data-panel-scroll-owner]')!;
      scroll.dispatchEvent(new WheelEvent('wheel', { bubbles: true }));
      scroll.scrollTop = 900;
    });
    expect((await owner()).top).toBeGreaterThan(0);
    expect((await owner()).feedTop).toBe(0);
    expect((await owner()).overflow).toBe('visible');
    const anchor = await panel.evaluate((node) => {
      const scroll = node.matches('[data-panel-scroll-owner]')
        ? node
        : node.querySelector('[data-panel-scroll-owner]')!;
      const top = scroll.getBoundingClientRect().top;
      const entry = [
        ...node.querySelectorAll<HTMLElement>('[data-journal-entry]'),
      ].find((item) => item.getBoundingClientRect().bottom > top)!;
      return {
        id: entry.dataset.journalEntry!,
        offset: entry.getBoundingClientRect().top - top,
      };
    });
    await page.evaluate(() => window.dispatchEvent(new Event('focus')));
    await expect
      .poll(() =>
        panel.evaluate((node, id) => {
          const scroll = node.matches('[data-panel-scroll-owner]')
            ? node
            : node.querySelector('[data-panel-scroll-owner]')!;
          const entry = node.querySelector<HTMLElement>(
            `[data-journal-entry="${id}"]`,
          )!;
          return (
            entry.getBoundingClientRect().top -
            scroll.getBoundingClientRect().top
          );
        }, anchor.id),
      )
      .toBeCloseTo(anchor.offset, 0);
  }
  await panel.getByRole('button', { name: 'Показать ещё' }).click();
  await expect(panel.locator('[data-journal-entry]')).toHaveCount(55);
  const anchor = await panel.evaluate((node) => {
    const owner = node.querySelector<HTMLElement>('[data-panel-scroll-owner]')!;
    // Manual scrolling cancels a still-pending load-more restoration frame.
    owner.dispatchEvent(new WheelEvent('wheel', { bubbles: true }));
    owner.scrollTop = 900;
    const top = owner.getBoundingClientRect().top;
    const entry = [
      ...node.querySelectorAll<HTMLElement>('[data-journal-entry]'),
    ].find((item) => item.getBoundingClientRect().bottom > top)!;
    return {
      id: entry.dataset.journalEntry!,
      offset: entry.getBoundingClientRect().top - top,
    };
  });
  await createJournalEntry(
    page,
    runtime.origin,
    tree.project.id,
    doneId,
    55,
    'Новая запись перед якорем',
    '2026-10-11',
  );
  const offset = () =>
    panel.evaluate((node, id) => {
      const owner = node.querySelector<HTMLElement>(
        '[data-panel-scroll-owner]',
      )!;
      return (
        node
          .querySelector<HTMLElement>(`[data-journal-entry="${id}"]`)!
          .getBoundingClientRect().top - owner.getBoundingClientRect().top
      );
    }, anchor.id);
  await expect.poll(offset).toBeCloseTo(anchor.offset, 0);
  await page.evaluate(() => window.dispatchEvent(new Event('focus')));
  await expect(
    panel.getByText('Новая запись перед якорем', { exact: true }),
  ).toHaveCount(1);
  await expect.poll(offset).toBeCloseTo(anchor.offset, 0);
});
