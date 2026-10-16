import {
  test,
  expect,
  seedJournal,
  createJournalEntry,
  readJournalPage,
  mutateJournal,
  openProjectJournal,
  projectFeed,
} from '../helpers/journal-e2e.js';
import { readTree } from '../helpers/optional-e2e.js';

test('composer autogrow follows inherited font changes without editing the draft', async ({
  page,
  runtime,
}) => {
  const observerErrors: string[] = [];
  page.on('pageerror', (error) => {
    if (error.message.includes('ResizeObserver'))
      observerErrors.push(error.message);
  });
  page.on('console', (message) => {
    if (message.type() === 'error' && message.text().includes('ResizeObserver'))
      observerErrors.push(message.text());
  });
  await seedJournal(page, runtime);
  await page.goto(runtime.origin);
  await page.getByRole('treeitem', { name: /^Работа A,/ }).click();
  const panel = page.getByRole('complementary', {
    name: 'Задача',
    exact: true,
  });
  await panel.getByRole('tab', { name: 'Ход работы', exact: true }).click();
  const body = panel.getByLabel('Текст записи');
  const original = 'Синтетический текст для переноса. '.repeat(12);
  await body.fill(original);
  const before = await body.evaluate((node) => node.clientHeight);
  await body.evaluate((node) => {
    node.parentElement!.style.fontSize = '22px';
  });
  await expect
    .poll(() => body.evaluate((node) => node.scrollHeight - node.clientHeight))
    .toBe(0);
  expect(await body.evaluate((node) => node.clientHeight)).toBeGreaterThan(
    before,
  );
  await expect(body).toHaveValue(original);
  await body.evaluate((node) => {
    node.parentElement!.style.fontSize = '';
  });
  await expect
    .poll(() => body.evaluate((node) => node.clientHeight))
    .toBe(before);
  expect(observerErrors).toEqual([]);
});

test('work progress keeps Enter local, saves the exact backdated body once and preserves plan revision', async ({
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
    'Более свежая запись',
    '2026-10-10',
  );
  await page.goto(runtime.origin);
  await page.getByRole('treeitem', { name: /^Работа A,/ }).click();
  const panel = page.getByRole('complementary', {
    name: 'Задача',
    exact: true,
  });
  await panel.getByRole('tab', { name: 'Ход работы', exact: true }).click();
  await expect(
    page
      .getByRole('tablist', { name: 'Представление проекта' })
      .getByRole('tab', { name: 'Журнал', exact: true }),
  ).toBeVisible();
  const editor = panel.locator('form[data-journal-editor]');
  const body = editor.getByLabel('Текст записи');
  const date = editor.getByLabel('Дата записи', { exact: true });
  await date.fill('29.02.2024');
  const original = '  Синтетический отчёт\n\n  Работа и сведения  \n';
  await body.fill(original.slice(0, -1));
  await body.press('End');
  await body.press('Enter');
  await expect(body).toHaveValue(original);
  expect(
    (await readJournalPage(page, runtime.origin, tree.project.id)).entries,
  ).toHaveLength(1);
  await date.fill('31.02.2024');
  await body.press('Control+Enter');
  await expect(body).toHaveValue(original);
  await expect(date).toHaveAttribute('aria-invalid', 'true');
  await expect(editor.getByText(/Нужны дата и непустой текст/)).toBeVisible();
  expect(
    (await readJournalPage(page, runtime.origin, tree.project.id)).entries,
  ).toHaveLength(1);
  await date.fill('29.02.2024');
  await body.press('Control+Enter');
  await expect(body).toHaveValue('');
  await expect(body).toBeFocused();
  await expect(
    panel.getByRole('heading', { name: '29.02.2024', exact: true }),
  ).toBeVisible();
  const saved = await readJournalPage(page, runtime.origin, tree.project.id);
  expect(
    saved.entries.map(({ body, workDate }) => ({ body, workDate })),
  ).toEqual([
    { body: 'Более свежая запись', workDate: '2026-10-10' },
    { body: original, workDate: '2024-02-29' },
  ]);
  expect(saved.journalRevision).toBe(2);
  expect(
    (await readTree(page, runtime.origin, tree.project.id)).project.revision,
  ).toBe(tree.project.revision);
  await page.reload();
  await expect(
    panel.getByRole('tab', { name: 'Ход работы', exact: true }),
  ).toHaveAttribute('aria-selected', 'true');
  expect(
    (await readJournalPage(page, runtime.origin, tree.project.id)).entries[1]!
      .body,
  ).toBe(original);
});

test('two-row task composer grows for pasted text, reflows at narrow width and keeps actions reachable at low height', async ({
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
  const editor = panel.locator('form[data-journal-editor]');
  const body = editor.getByLabel('Текст записи');
  const date = editor.getByLabel('Дата записи', { exact: true });
  const save = editor.getByRole('button', {
    name: 'Сохранить запись',
    exact: true,
  });
  const clear = editor.getByRole('button', {
    name: 'Очистить черновик',
    exact: true,
  });
  await expect(body).toHaveAttribute('rows', '2');
  await expect(date).toBeVisible();
  await expect(save).toHaveCount(0);
  const measure = () =>
    body.evaluate((node) => {
      const style = getComputedStyle(node);
      return {
        height: node.clientHeight,
        overflow: node.scrollHeight - node.clientHeight,
        lineHeight: parseFloat(style.lineHeight),
        padding: parseFloat(style.paddingTop) + parseFloat(style.paddingBottom),
      };
    });
  const idle = await measure();
  expect(idle.height).toBeCloseTo(2 * idle.lineHeight + idle.padding, 0);
  await panel.screenshot({
    path: test.info().outputPath('synthetic-composer-idle-desktop.png'),
  });
  await body.fill('Вставленный текст\n'.repeat(24));
  const multiline = await measure();
  expect(multiline.height).toBeGreaterThan(400);
  expect(multiline.overflow).toBe(0);
  await body.fill('Длинная строка для переноса. '.repeat(8));
  const wide = await measure();
  // The standard panel preserves useful text width and places controls below.
  const standardLayout = await editor.evaluate((form) => {
    const text = form.querySelector('textarea')!.getBoundingClientRect();
    const date = form.querySelector('.calendar-field')!.getBoundingClientRect();
    return {
      textWidth: text.width,
      formWidth: form.clientWidth,
      textBottom: text.bottom,
      dateTop: date.top,
    };
  });
  expect(standardLayout.textWidth).toBeCloseTo(standardLayout.formWidth, 0);
  expect(standardLayout.dateTop).toBeGreaterThan(standardLayout.textBottom);
  await panel.screenshot({
    path: test.info().outputPath('synthetic-composer-desktop.png'),
  });
  // A wider container can put controls beside a still-useful text area.
  await panel.evaluate((node) =>
    node.style.setProperty('--leaf-task-panel-width', '620px'),
  );
  await expect
    .poll(() =>
      editor.evaluate((form) => {
        const text = form.querySelector('textarea')!.getBoundingClientRect();
        const date = form
          .querySelector('.calendar-field')!
          .getBoundingClientRect();
        return (
          text.width >= 260 &&
          date.left > text.right &&
          Math.abs(text.top - date.top) < 1
        );
      }),
    )
    .toBe(true);
  await expect.poll(async () => (await measure()).overflow).toBe(0);
  await panel.evaluate((node) =>
    node.style.removeProperty('--leaf-task-panel-width'),
  );
  await expect.poll(async () => (await measure()).height).toBe(wide.height);
  for (const viewport of [
    { width: 375, height: 812 },
    { width: 375, height: 240 },
    { width: 1440, height: 180 },
  ]) {
    await page.setViewportSize(viewport);
    await expect(save).toBeVisible();
    await expect(clear).toBeVisible();
    for (const control of [body, date, save, clear]) {
      await control.focus();
      await expect(control).toBeFocused();
      if (control !== body) await expect(control).toBeInViewport();
      const box = await control.boundingBox();
      expect(box!.x).toBeGreaterThanOrEqual(0);
      expect(box!.x + box!.width).toBeLessThanOrEqual(viewport.width);
    }
    expect(
      await panel.evaluate((node) => node.scrollWidth <= node.clientWidth),
    ).toBe(true);
    expect((await measure()).overflow).toBe(0);
    if (viewport.width === 375) {
      if (viewport.height === 812)
        await panel.screenshot({
          path: test.info().outputPath('synthetic-composer-mobile.png'),
        });
      const narrowLayout = await editor.evaluate((form) => ({
        textBottom: form.querySelector('textarea')!.getBoundingClientRect()
          .bottom,
        dateTop: form.querySelector('.calendar-field')!.getBoundingClientRect()
          .top,
      }));
      expect(narrowLayout.dateTop).toBeGreaterThan(narrowLayout.textBottom);
    }
  }
  await page.setViewportSize({ width: 1440, height: 900 });
  await expect.poll(async () => (await measure()).height).toBe(wide.height);
  page.once('dialog', (dialog) => dialog.accept());
  await clear.click();
  await expect(body).toHaveValue('');
  await expect(body).toBeFocused();
  await expect(save).toHaveCount(0);
  expect((await measure()).height).toBe(idle.height);
  await page.setViewportSize({ width: 375, height: 812 });
  await panel.screenshot({
    path: test.info().outputPath('synthetic-composer-idle-mobile.png'),
  });
});

test('task and project previews disclose independently and retain the original text and editor', async ({
  page,
  runtime,
}) => {
  const { tree, doneId, summaryId } = await seedJournal(page, runtime);
  const originals = [
    'Короткая запись',
    'Первая\nВторая\nТретья\nЧетвёртая\nПятая',
    'Длинный текст без явных переносов. '.repeat(35),
    '\r\n\r\n  Абзац A \r\n  \r\n\t\r\nАбзац B\r\n\r\n',
    'https://synthetic.invalid/' + 'long'.repeat(200),
  ];
  const ids: string[] = [];
  for (const [revision, original] of originals.entries()) {
    const result = await createJournalEntry(
      page,
      runtime.origin,
      tree.project.id,
      doneId,
      revision,
      original,
      `2026-10-${String(10 - revision).padStart(2, '0')}`,
    );
    if (result.kind === 'deleted') throw new Error('Unexpected delete');
    ids.push(result.entry.id);
  }
  await page.goto(runtime.origin);
  await page.getByRole('treeitem', { name: /^Работа A,/ }).click();
  const panel = page.getByRole('complementary', {
    name: 'Задача',
    exact: true,
  });
  await panel.getByRole('tab', { name: 'Ход работы', exact: true }).click();
  const card = (index: number) =>
    panel.locator(`[data-journal-entry-id="${ids[index]}"]`);
  await expect(
    card(0).getByRole('button', { name: 'Показать полностью' }),
  ).toHaveCount(0);
  for (const index of [1, 2, 4]) {
    await expect(
      card(index).getByRole('button', { name: 'Показать полностью' }),
    ).toBeVisible();
    const geometry = await card(index)
      .locator('.journal-body')
      .evaluate((node) => ({
        height: node.clientHeight,
        full: node.scrollHeight,
        line: parseFloat(getComputedStyle(node).lineHeight),
      }));
    expect(geometry.height).toBeLessThanOrEqual(4 * geometry.line);
    expect(geometry.full).toBeGreaterThan(geometry.height);
  }
  await expect(card(3).locator('.journal-body')).toHaveText(
    '  Абзац A \r\n\r\nАбзац B',
    { useInnerText: false },
  );
  const toggle = card(1).locator('.journal-body-toggle');
  await toggle.focus();
  await expect(toggle).toBeInViewport();
  await toggle.press('Enter');
  await expect(toggle).toHaveAttribute('aria-expanded', 'true');
  await expect(
    card(2).getByRole('button', { name: 'Показать полностью' }),
  ).toHaveAttribute('aria-expanded', 'false');
  originals[1] = 'Изменённая первая\nВторая\nТретья\nЧетвёртая\nПятая\nШестая';
  await mutateJournal(page, runtime.origin, tree.project.id, ids[1]!, 5, {
    body: originals[1],
    workDate: '2026-10-09',
  });
  const refreshed = page.waitForResponse(
    (response) =>
      response.request().method() === 'GET' &&
      response.url().includes(`/tasks/${doneId}/journal`),
  );
  await page.evaluate(() => window.dispatchEvent(new Event('focus')));
  expect((await refreshed).status()).toBe(200);
  await expect(toggle).toHaveAttribute('aria-expanded', 'true');
  expect(await card(1).locator('.journal-body').textContent()).toBe(
    originals[1],
  );
  await panel.getByRole('tab', { name: 'Задача', exact: true }).click();
  await panel.getByRole('tab', { name: 'Ход работы', exact: true }).click();
  await expect(toggle).toHaveAttribute('aria-expanded', 'true');
  await card(3).getByRole('button', { name: 'Показать полностью' }).click();
  expect(await card(3).locator('.journal-body').textContent()).toBe(
    originals[3],
  );
  const menu = card(3).getByRole('button', { name: /Действия записи/ });
  await menu.focus();
  await expect(menu).toBeInViewport();
  await menu.press('Enter');
  await page.getByRole('menuitem', { name: 'Редактировать запись' }).click();
  // Textarea values use browser LF line endings; the stored text keeps CRLF.
  await expect(card(3).getByLabel('Текст записи')).toHaveValue(
    originals[3]!.replaceAll('\r\n', '\n'),
  );
  await card(3)
    .getByRole('button', { name: 'Закрыть редактор', exact: true })
    .click();
  await expect(card(3).locator('.journal-body-toggle')).toHaveAttribute(
    'aria-expanded',
    'true',
  );
  expect(await card(3).locator('.journal-body').textContent()).toBe(
    originals[3],
  );
  const stored = await readJournalPage(page, runtime.origin, tree.project.id);
  expect(stored.entries.map((entry) => entry.body)).toEqual(originals);
  await panel.screenshot({
    path: test.info().outputPath('synthetic-preview-desktop.png'),
  });
  await test.info().attach('synthetic-preview-desktop', {
    path: test.info().outputPath('synthetic-preview-desktop.png'),
    contentType: 'image/png',
  });
  await page.setViewportSize({ width: 375, height: 812 });
  await card(4).getByRole('button', { name: 'Показать полностью' }).focus();
  await expect(
    card(4).getByRole('button', { name: 'Показать полностью' }),
  ).toBeInViewport();
  expect(
    await panel.evaluate((node) => node.scrollWidth <= node.clientWidth),
  ).toBe(true);
  await panel.screenshot({
    path: test.info().outputPath('synthetic-preview-mobile.png'),
  });
  await test.info().attach('synthetic-preview-mobile', {
    path: test.info().outputPath('synthetic-preview-mobile.png'),
    contentType: 'image/png',
  });
  await page.setViewportSize({ width: 1440, height: 900 });
  await panel
    .getByRole('button', { name: 'Закрыть панель', exact: true })
    .click();
  await page.locator(`[data-task-id="${summaryId}"]`).first().click();
  await panel
    .getByRole('button', { name: 'Закрыть панель', exact: true })
    .click();
  await page.getByRole('treeitem', { name: /^Работа A,/ }).click();
  await panel.getByRole('tab', { name: 'Ход работы', exact: true }).click();
  await expect(
    card(1).getByRole('button', { name: 'Показать полностью' }),
  ).toHaveAttribute('aria-expanded', 'false');
  await panel
    .getByRole('button', { name: 'Закрыть панель', exact: true })
    .click();
  await page
    .getByRole('tablist', { name: 'Представление проекта' })
    .getByRole('tab', { name: 'Журнал', exact: true })
    .click();
  const feed = page.locator('#project-view-journal');
  await expect(feed.locator('[data-journal-entry-id]')).toHaveCount(5);
  await expect(
    feed.getByRole('button', { name: 'Показать полностью' }),
  ).toHaveCount(4);
  const projectPreview = test
    .info()
    .outputPath('synthetic-project-preview.png');
  await feed.screenshot({ path: projectPreview });
  console.log(`Synthetic project preview: ${projectPreview}`);
  for (const [index, original] of originals.entries()) {
    const entry = feed.locator(`[data-journal-entry-id="${ids[index]}"]`);
    if (index !== 0) {
      if (index !== 3) {
        const geometry = await entry
          .locator('.journal-body')
          .evaluate((node) => ({
            height: node.clientHeight,
            full: node.scrollHeight,
            limit: 4 * parseFloat(getComputedStyle(node).lineHeight),
          }));
        expect(geometry.height).toBeLessThanOrEqual(geometry.limit);
        expect(geometry.full).toBeGreaterThan(geometry.height);
      }
      const show = entry.getByRole('button', { name: 'Показать полностью' });
      await show.focus();
      await expect(show).toBeInViewport();
      await show.press('Enter');
      await expect(entry.locator('.journal-body-toggle')).toHaveAttribute(
        'aria-expanded',
        'true',
      );
    }
    expect(await entry.locator('.journal-body').textContent()).toBe(original);
  }
  const projectEntry = feed.locator(`[data-journal-entry-id="${ids[3]}"]`);
  await projectEntry.getByRole('button', { name: /Действия записи/ }).click();
  await page.getByRole('menuitem', { name: 'Редактировать запись' }).click();
  await expect(projectEntry.getByLabel('Текст записи')).toHaveValue(
    originals[3]!.replaceAll('\r\n', '\n'),
  );
  await projectEntry.getByRole('button', { name: 'Закрыть редактор' }).click();
  expect(await projectEntry.locator('.journal-body').textContent()).toBe(
    originals[3],
  );
});

test('project previews preserve independent disclosure and scroll through pagination, refresh and project tabs', async ({
  page,
  runtime,
}) => {
  const { tree, doneId } = await seedJournal(page, runtime);
  for (let revision = 0; revision < 55; revision++)
    await createJournalEntry(
      page,
      runtime.origin,
      tree.project.id,
      doneId,
      revision,
      `Синтетическая запись ${revision}\nВторая строка\nТретья строка\nЧетвёртая строка\nСкрытый маркер ${revision}`,
      '2026-10-10',
    );
  await openProjectJournal(page, runtime.origin);
  const feed = projectFeed(page);
  const entries = feed.locator('[data-journal-entry-id]');
  await expect(entries).toHaveCount(50);
  const firstId = await entries.first().getAttribute('data-journal-entry-id');
  await entries
    .first()
    .getByRole('button', { name: 'Показать полностью' })
    .click();
  await expect(entries.nth(1).locator('.journal-body-toggle')).toHaveAttribute(
    'aria-expanded',
    'false',
  );
  await feed.getByRole('button', { name: 'Показать ещё', exact: true }).click();
  await expect(entries).toHaveCount(55);
  const lastId = await entries.last().getAttribute('data-journal-entry-id');
  await entries
    .last()
    .getByRole('button', { name: 'Показать полностью' })
    .click();
  const scroll = feed.locator('[data-journal-scroll]');
  await scroll.evaluate((node) => {
    node.scrollTop = 900;
  });
  const position = () =>
    scroll.evaluate((node) => {
      const top = node.getBoundingClientRect().top;
      const entry = [
        ...node.querySelectorAll<HTMLElement>('[data-journal-entry-id]'),
      ].find((item) => item.getBoundingClientRect().bottom > top)!;
      return {
        id: entry.dataset.journalEntryId,
        offset: entry.getBoundingClientRect().top - top,
      };
    });
  const before = await position();
  const refreshed = page.waitForResponse(
    (response) =>
      response.request().method() === 'GET' &&
      response.url().endsWith(`/api/projects/${tree.project.id}/journal`),
  );
  await page.evaluate(() => window.dispatchEvent(new Event('focus')));
  expect((await refreshed).status()).toBe(200);
  await expect.poll(position).toEqual(before);
  await expect(
    feed.locator(`[data-journal-entry-id="${firstId}"] .journal-body-toggle`),
  ).toHaveAttribute('aria-expanded', 'true');
  await expect(entries).toHaveCount(50);
  await feed.getByRole('button', { name: 'Показать ещё', exact: true }).click();
  await expect(entries).toHaveCount(55);
  await expect(
    feed.locator(`[data-journal-entry-id="${lastId}"] .journal-body-toggle`),
  ).toHaveAttribute('aria-expanded', 'true');
  const tabs = page.getByRole('tablist', { name: 'Представление проекта' });
  await tabs.getByRole('tab', { name: 'Задачи', exact: true }).click();
  await tabs.getByRole('tab', { name: 'Журнал', exact: true }).click();
  await expect(
    feed.locator(`[data-journal-entry-id="${firstId}"] .journal-body-toggle`),
  ).toHaveAttribute('aria-expanded', 'true');
  await page
    .getByLabel('Поиск записей', { exact: true })
    .fill('Скрытый маркер 53');
  await expect(entries).toHaveCount(1);
  const filteredToggle = entries.first().locator('.journal-body-toggle');
  if ((await filteredToggle.getAttribute('aria-expanded')) !== 'true')
    await filteredToggle.click();
  await expect(filteredToggle).toHaveAttribute('aria-expanded', 'true');
  await expect(entries.first().locator('.journal-body')).toContainText(
    'Скрытый маркер 53',
  );
  expect(
    (await readTree(page, runtime.origin, tree.project.id)).project.revision,
  ).toBe(tree.project.revision);
});

test('four visual lines remeasure wrapping and font metrics while clamped', async ({
  page,
  runtime,
}) => {
  const { tree, doneId } = await seedJournal(page, runtime);
  const body = 'Ширина и метрики шрифта. '.repeat(6);
  await createJournalEntry(
    page,
    runtime.origin,
    tree.project.id,
    doneId,
    0,
    body,
    '2026-10-10',
  );
  await page.goto(runtime.origin);
  await page.getByRole('treeitem', { name: /^Работа A,/ }).click();
  const panel = page.getByRole('complementary', {
    name: 'Задача',
    exact: true,
  });
  await panel.getByRole('tab', { name: 'Ход работы', exact: true }).click();
  const text = panel.locator('.journal-body');
  const toggle = panel.getByRole('button', { name: 'Показать полностью' });
  await text.evaluate((node) => {
    node.style.fontSize = '10px';
    node.style.lineHeight = '20px';
  });
  await expect(toggle).toHaveCount(0);
  await text.evaluate((node) => {
    node.style.fontSize = '28px';
  });
  await expect(toggle).toBeVisible();
  expect(await text.evaluate((node) => node.clientHeight)).toBe(80);
  await text.evaluate((node) => {
    node.style.lineHeight = '30px';
  });
  await expect.poll(() => text.evaluate((node) => node.clientHeight)).toBe(120);
  await text.evaluate((node) => {
    node.style.fontSize = '10px';
  });
  await expect(toggle).toHaveCount(0);
  await text.evaluate((node) => {
    node.style.fontSize = '14px';
    node.style.lineHeight = '20px';
  });
  await expect(toggle).toHaveCount(0);
  await panel.evaluate((node) =>
    node.style.setProperty('--leaf-task-panel-width', '280px'),
  );
  await expect(toggle).toBeVisible();
  await panel.evaluate((node) =>
    node.style.setProperty('--leaf-task-panel-width', '620px'),
  );
  await expect(toggle).toHaveCount(0);
  expect(await text.textContent()).toBe(body);
});

test('task preview pagination keeps expanded entries and restores the deep scroll anchor on refresh', async ({
  page,
  runtime,
}) => {
  const { tree, doneId } = await seedJournal(page, runtime);
  for (let revision = 0; revision < 55; revision++)
    await createJournalEntry(
      page,
      runtime.origin,
      tree.project.id,
      doneId,
      revision,
      `Синтетическая запись ${revision}\nВторая\nТретья\nЧетвёртая\nПятая`,
      '2026-10-10',
    );
  await page.goto(runtime.origin);
  await page.getByRole('treeitem', { name: /^Работа A,/ }).click();
  const panel = page.getByRole('complementary', {
    name: 'Задача',
    exact: true,
  });
  await panel.getByRole('tab', { name: 'Ход работы', exact: true }).click();
  const cards = panel.locator('[data-journal-entry-id]');
  await expect(cards).toHaveCount(50);
  await cards
    .first()
    .getByRole('button', { name: 'Показать полностью' })
    .click();
  await panel
    .getByRole('button', { name: 'Показать ещё', exact: true })
    .click();
  await expect(cards).toHaveCount(55);
  const deep = cards.nth(52);
  await deep.getByRole('button', { name: 'Показать полностью' }).click();
  const id = await deep.getAttribute('data-journal-entry-id');
  await deep.locator('.journal-body-toggle').focus();
  await expect(deep.locator('.journal-body-toggle')).toBeInViewport();
  const position = () =>
    panel.locator('.panel-content').evaluate((node) => {
      const top = node.getBoundingClientRect().top;
      const entry = [
        ...node.querySelectorAll<HTMLElement>('[data-journal-entry-id]'),
      ].find((item) => item.getBoundingClientRect().bottom > top)!;
      return {
        id: entry.dataset.journalEntryId,
        offset: entry.getBoundingClientRect().top - top,
      };
    });
  const before = await position();
  await panel.getByRole('tab', { name: 'Задача', exact: true }).click();
  const refreshed = page.waitForResponse(
    (response) =>
      response.request().method() === 'GET' &&
      response.url().includes(`/tasks/${doneId}/journal`),
  );
  await page.evaluate(() => window.dispatchEvent(new Event('focus')));
  expect((await refreshed).status()).toBe(200);
  await panel.getByRole('tab', { name: 'Ход работы', exact: true }).click();
  await expect.poll(position).toEqual(before);
  // A refresh reloads the first page when its visible anchor is there. A tail
  // entry can be temporarily absent until the user loads that page again.
  if (
    await panel
      .getByRole('button', { name: 'Показать ещё', exact: true })
      .count()
  )
    await panel
      .getByRole('button', { name: 'Показать ещё', exact: true })
      .click();
  await expect(cards).toHaveCount(55);
  await expect(
    panel.locator(`[data-journal-entry-id="${id}"] .journal-body-toggle`),
  ).toHaveAttribute('aria-expanded', 'true');
  const ids = await cards.evaluateAll((nodes) =>
    nodes.map((node) => node.getAttribute('data-journal-entry-id')),
  );
  expect(new Set(ids).size).toBe(55);
  // With a first-page anchor that fits, refresh must not fetch the tail.
  await panel.locator('.panel-content').evaluate((node) => {
    node.scrollTop = 0;
  });
  const firstPageRefresh = page.waitForResponse(
    (response) =>
      response.request().method() === 'GET' &&
      response.url().includes(`/tasks/${doneId}/journal`),
  );
  await page.evaluate(() => window.dispatchEvent(new Event('focus')));
  expect((await firstPageRefresh).status()).toBe(200);
  await expect(cards).toHaveCount(50);
  await expect(
    panel.getByText('Загрузка журнала…', { exact: true }),
  ).toHaveCount(0);
  await expect(cards.first().locator('.journal-body-toggle')).toHaveAttribute(
    'aria-expanded',
    'true',
  );
  await panel
    .getByRole('button', { name: 'Показать ещё', exact: true })
    .click();
  await expect(cards).toHaveCount(55);
  await expect(
    panel.locator(`[data-journal-entry-id="${id}"] .journal-body-toggle`),
  ).toHaveAttribute('aria-expanded', 'true');
});

test('hidden short-to-long body changes measure all disclosures before restoring the revealed anchor', async ({
  page,
  runtime,
}) => {
  const { tree, doneId } = await seedJournal(page, runtime);
  for (let revision = 0; revision < 25; revision++)
    await createJournalEntry(
      page,
      runtime.origin,
      tree.project.id,
      doneId,
      revision,
      `Короткая синтетическая запись ${revision}`,
      '2026-10-10',
    );
  await page.goto(runtime.origin);
  await page.getByRole('treeitem', { name: /^Работа A,/ }).click();
  const panel = page.getByRole('complementary', {
    name: 'Задача',
    exact: true,
  });
  await panel.getByRole('tab', { name: 'Ход работы', exact: true }).click();
  const cards = panel.locator('[data-journal-entry-id]');
  await expect(cards).toHaveCount(25);
  await expect(panel.locator('.journal-body-toggle')).toHaveCount(0);
  const owner = panel.locator('.panel-content');
  await owner.evaluate((node) => {
    const anchor = node.querySelectorAll<HTMLElement>(
      '[data-journal-entry-id]',
    )[8]!;
    node.scrollTop +=
      anchor.getBoundingClientRect().top -
      node.getBoundingClientRect().top +
      17;
  });
  const position = () =>
    owner.evaluate((node) => {
      const top = node.getBoundingClientRect().top;
      const anchor = [
        ...node.querySelectorAll<HTMLElement>('[data-journal-entry-id]'),
      ].find((entry) => entry.getBoundingClientRect().bottom > top)!;
      return {
        id: anchor.dataset.journalEntryId,
        offset: anchor.getBoundingClientRect().top - top,
      };
    });
  const before = await position();
  expect(before.offset).toBe(-17);
  await panel.getByRole('tab', { name: 'Задача', exact: true }).click();
  const entries = (await readJournalPage(page, runtime.origin, tree.project.id))
    .entries;
  for (let index = 0; index < 5; index++)
    await mutateJournal(
      page,
      runtime.origin,
      tree.project.id,
      entries[index]!.id,
      25 + index,
      {
        body: `Длинная синтетическая запись ${index}\nВторая\nТретья\nЧетвёртая\nПятая`,
        workDate: '2026-10-10',
      },
    );
  const refreshed = page.waitForResponse(
    (response) =>
      response.request().method() === 'GET' &&
      response.url().includes(`/tasks/${doneId}/journal`),
  );
  await page.evaluate(() => window.dispatchEvent(new Event('focus')));
  expect((await refreshed).status()).toBe(200);
  await expect(cards.first().locator('.journal-body')).toContainText(
    'Длинная синтетическая запись',
  );
  await expect(panel.locator('.journal-loading')).toHaveCount(0);
  await panel.getByRole('tab', { name: 'Ход работы', exact: true }).click();
  await expect(panel.locator('.journal-body-toggle')).toHaveCount(5);
  await expect.poll(position).toEqual(before);
  for (const card of await cards.all()) {
    const text = card.locator('.journal-body');
    expect(
      await text.evaluate((node) => node.clientHeight),
    ).toBeLessThanOrEqual(80);
  }
});
