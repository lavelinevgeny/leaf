import {
  test,
  expect,
  seedJournal,
  createJournalEntry,
  readJournalPage,
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
