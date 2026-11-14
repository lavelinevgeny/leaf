import {
  test,
  expect,
  seedJournal,
  readJournalPage,
  openProjectJournal,
  chooseTask,
  expectJournalText,
} from '../helpers/journal-e2e.js';
import sharp from 'sharp';

test('actual editor pasted PNG persists rich interleaving and media after save and reload', async ({
  page,
  runtime,
}) => {
  const { tree } = await seedJournal(page, runtime);
  const png = await sharp({
    create: {
      width: 24,
      height: 12,
      channels: 4,
      background: { r: 50, g: 120, b: 80, alpha: 1 },
    },
  })
    .png()
    .toBuffer();
  const external: string[] = [];
  page.on('request', (request) => {
    if (
      /^https?:/.test(request.url()) &&
      new URL(request.url()).origin !== runtime.origin
    )
      external.push(request.url());
  });
  await page.goto(runtime.origin);
  await page.getByRole('treeitem', { name: /^Работа A,/ }).click();
  const panel = page.getByRole('complementary', {
    name: 'Задача',
    exact: true,
  });
  await panel.getByRole('tab', { name: 'Ход работы', exact: true }).click();
  const editor = panel.getByRole('textbox', {
    name: 'Текст записи',
    exact: true,
  });
  await editor.fill('До изображения');
  await editor.press('End');
  await editor.press('Enter');
  await editor.evaluate((element, bytes) => {
    const transfer = new DataTransfer();
    transfer.items.add(
      new File([new Uint8Array(bytes)], 'synthetic.png', { type: 'image/png' }),
    );
    transfer.setData('text/plain', 'first line\nsecond line');
    transfer.setData(
      'text/html',
      '<img src="https://example.invalid/never-fetch.png">',
    );
    element.dispatchEvent(
      new ClipboardEvent('paste', {
        clipboardData: transfer,
        bubbles: true,
        cancelable: true,
      }),
    );
  }, Array.from(png));
  await expect(editor.locator('.journal-upload')).toHaveCount(1);
  await expect(editor.getByText('Загрузка…')).toHaveCount(0);
  await editor.press('End');
  await page.keyboard.type('После изображения');
  await expect(
    panel.getByRole('button', { name: 'Сохранить запись', exact: true }),
  ).toBeEnabled();
  await panel
    .getByRole('button', { name: 'Сохранить запись', exact: true })
    .click();
  await expect(panel.locator('[data-journal-entry-id] img')).toHaveCount(1);
  const saved = await readJournalPage(page, runtime.origin, tree.project.id);
  expect(saved.entries).toHaveLength(1);
  const entry = saved.entries[0]!;
  expect(entry.content.format).toBe('rich-text');
  expect(entry.media).toHaveLength(1);
  if (entry.content.format !== 'rich-text') throw Error('rich entry expected');
  expect(entry.content.doc.content.map((node) => node.type)).toEqual([
    'paragraph',
    'paragraph',
    'paragraph',
    'journalImage',
    'paragraph',
  ]);
  expect(entry.body).toBe(
    `До изображения\nfirst line\nsecond line\n[Изображение: ${entry.media[0]!.fileName}]\nПосле изображения`,
  );
  const openImage = panel.getByRole('button', { name: 'Открыть изображение' });
  await expect(openImage).toBeEnabled();
  await openImage.click();
  const viewer = page.getByRole('dialog', { name: 'Просмотр изображения' });
  await expect(viewer).toBeVisible();
  await viewer
    .getByRole('button', { name: 'Закрыть изображение' })
    .press('Escape');
  await expect(viewer).toHaveCount(0);
  await expect(openImage).toBeFocused();
  const clean = panel.getByRole('textbox', {
    name: 'Текст записи',
    exact: true,
  });
  await clean.focus();
  await clean.press('Control+z');
  await expect(clean).toHaveText('');
  await page.reload();
  const again = await readJournalPage(page, runtime.origin, tree.project.id);
  expect(again.entries[0]).toEqual(entry);
  await expect(panel.locator('[data-journal-entry-id] img')).toHaveCount(1);
  expect(external).toEqual([]);
  // Acknowledgement resets editor history; local Undo cannot revive the saved entry.
  const fresh = page.getByRole('textbox', {
    name: 'Текст записи',
    exact: true,
  });
  await fresh.focus();
  await fresh.press('Control+z');
  await expect(fresh).toHaveText('');
});

test('rich editor keeps Enter, Tab, IME and local formatting inside the composer at narrow width', async ({
  page,
  runtime,
}) => {
  const { tree } = await seedJournal(page, runtime);
  await page.goto(runtime.origin);
  await page.getByRole('treeitem', { name: /^Работа A,/ }).click();
  const panel = page.getByRole('complementary', {
    name: 'Задача',
    exact: true,
  });
  await panel.getByRole('tab', { name: 'Ход работы', exact: true }).click();
  const editor = panel.getByRole('textbox', {
    name: 'Текст записи',
    exact: true,
  });
  const idle = (await editor.boundingBox())!.height;
  expect(idle).toBeGreaterThanOrEqual(50);
  expect(idle).toBeLessThan(70);
  await editor.fill('Alpha');
  await editor.press('Control+a');
  await editor.press('Control+b');
  await expect(editor.locator('strong')).toHaveText('Alpha');
  await editor.press('Control+k');
  const popup = panel.getByRole('dialog', { name: 'Редактировать ссылку' });
  await popup.getByLabel('Название ссылки').fill('Named link');
  await popup
    .getByLabel('Адрес ссылки')
    .fill('https://example.invalid/document');
  await popup.getByLabel('Адрес ссылки').press('Enter');
  await expect(editor.locator('a')).toHaveText('Named link');
  await editor.press('End');
  await editor.press('Enter');
  await page.keyboard.type('Second paragraph');
  await editor.press('Shift+Enter');
  await page.keyboard.type('line break');
  await editor.press('Tab');
  await expect(editor).not.toBeFocused();
  await editor.focus();
  await editor.evaluate((element) =>
    element.dispatchEvent(
      new KeyboardEvent('keydown', {
        key: 'Enter',
        ctrlKey: true,
        isComposing: true,
        bubbles: true,
        cancelable: true,
      }),
    ),
  );
  expect(
    (await readJournalPage(page, runtime.origin, tree.project.id)).entries,
  ).toHaveLength(0);
  await editor.press('Control+Enter');
  await expect(panel.locator('[data-journal-entry-id]')).toHaveCount(1);
  const saved = (await readJournalPage(page, runtime.origin, tree.project.id))
    .entries[0]!;
  expect(saved.body).toBe('Named link\nSecond paragraph\nline break');
  await editor.press('Control+Shift+8');
  await page.keyboard.type('First item');
  await editor.press('Enter');
  await page.keyboard.type('Second item');
  await expect(editor.locator('li')).toHaveCount(2);
  await page.setViewportSize({ width: 375, height: 812 });
  const long = Array.from(
    { length: 12 },
    (_, index) => `Synthetic line ${index}`,
  ).join('\n');
  await editor.fill(long);
  const height = (await editor.boundingBox())!.height;
  expect(height).toBeGreaterThan(200);
  await panel.getByRole('tab', { name: 'Задача', exact: true }).click();
  await panel.getByRole('tab', { name: 'Ход работы', exact: true }).click();
  expect((await editor.boundingBox())!.height).toBe(height);
  const containment = await panel.evaluate((node) => ({
    width: node.clientWidth,
    scrollWidth: node.scrollWidth,
    editorRight: node
      .querySelector('[data-journal-body]')!
      .getBoundingClientRect().right,
    viewport: innerWidth,
  }));
  expect(containment.scrollWidth).toBeLessThanOrEqual(containment.width);
  expect(containment.editorRight).toBeLessThanOrEqual(containment.viewport);
  await expect(editor).toHaveAttribute('contenteditable', 'true');
});

test('Escape closes link popup then selected toolbar then composer without losing the draft', async ({
  page,
  runtime,
}) => {
  await seedJournal(page, runtime);
  await openProjectJournal(page, runtime.origin);
  await page
    .getByRole('button', { name: 'Добавить запись', exact: true })
    .click();
  const composer = page.getByRole('region', { name: 'Новая запись журнала' });
  await chooseTask(composer, 'Работа A');
  const editor = composer.getByRole('textbox', { name: 'Текст записи' });
  await editor.fill('Keep selected draft');
  await editor.press('Control+a');
  await editor.press('Control+k');
  const popup = composer.getByRole('dialog', { name: 'Редактировать ссылку' });
  await expect(popup).toBeVisible();
  await popup.getByLabel('Название ссылки').press('Escape');
  await expect(popup).toHaveCount(0);
  await expect(composer.getByRole('toolbar')).toBeVisible();
  await editor.press('Escape');
  await expect(composer.getByRole('toolbar')).toHaveCount(0);
  await expect(composer).toBeVisible();
  await expectJournalText(editor, 'Keep selected draft');
  await editor.press('Escape');
  await expect(composer).toHaveCount(0);
  await page
    .getByRole('button', { name: 'Добавить запись', exact: true })
    .click();
  await expectJournalText(
    page
      .getByRole('region', { name: 'Новая запись журнала' })
      .getByRole('textbox', { name: 'Текст записи' }),
    'Keep selected draft',
  );
});

test('an actual binary download401 clears authenticated UI and RAM attachments', async ({
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
  const composer = panel.locator('form[data-journal-editor]').first();
  await composer.getByLabel('Выбрать вложения').setInputFiles({
    name: 'saved-synthetic.txt',
    mimeType: 'text/plain',
    buffer: Buffer.from('synthetic saved bytes'),
  });
  await expect(composer.getByText('Загрузка…')).toHaveCount(0);
  await composer
    .getByRole('button', { name: 'Сохранить запись', exact: true })
    .click();
  const download = panel.locator('[data-journal-entry-id] .journal-file');
  await expect(download).toBeVisible();
  await composer
    .getByRole('textbox', { name: 'Текст записи' })
    .fill('Private unsaved draft');
  await composer.getByLabel('Выбрать вложения').setInputFiles({
    name: 'draft-synthetic.txt',
    mimeType: 'text/plain',
    buffer: Buffer.from('synthetic private bytes'),
  });
  await expect(composer.getByText('Загрузка…')).toHaveCount(0);
  await expect(
    composer.getByRole('button', { name: 'Сохранить запись', exact: true }),
  ).toBeEnabled();
  await page.context().clearCookies();
  await download.click();
  await expect(page.getByLabel('Пароль', { exact: true })).toBeVisible();
  await expect(page.locator('.journal-upload')).toHaveCount(0);
  await expect(page.locator('[data-journal-entry-id]')).toHaveCount(0);
  await page.getByLabel('Пароль', { exact: true }).fill(runtime.password);
  await page.getByRole('button', { name: 'Войти', exact: true }).click();
  await page.getByRole('treeitem', { name: /^Работа A,/ }).click();
  await page
    .getByRole('complementary', { name: 'Задача', exact: true })
    .getByRole('tab', { name: 'Ход работы', exact: true })
    .click();
  await expectJournalText(
    page.getByRole('textbox', { name: 'Текст записи' }),
    '',
  );
  await expect(page.locator('.journal-upload')).toHaveCount(0);
});
