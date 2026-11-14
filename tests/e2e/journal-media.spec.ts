import {
  test,
  expect,
  seedJournal,
  readJournalPage,
  openProjectJournal,
  chooseTask,
  expectJournalText,
  createJournalEntry,
  projectFeed,
  planContent,
} from '../helpers/journal-e2e.js';
import sharp from 'sharp';
import { readFile } from 'node:fs/promises';
import { readTree } from '../helpers/optional-e2e.js';

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

test('a rejected empty file preserves multiline clipboard text and its visible error before exact save', async ({
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
  const editor = panel.getByRole('textbox', { name: 'Текст записи' });
  await editor.fill('Existing text');
  await editor.press('Control+End');
  const uploads: string[] = [];
  page.on('request', (request) => {
    if (request.method() === 'POST' && request.url().endsWith('/journal-media'))
      uploads.push(request.url());
  });
  await editor.evaluate((element) => {
    const clipboard = new DataTransfer();
    clipboard.items.add(
      new File([], 'empty-synthetic.txt', { type: 'text/plain' }),
    );
    clipboard.setData('text/plain', 'first pasted line\nsecond pasted line');
    element.dispatchEvent(
      new ClipboardEvent('paste', {
        clipboardData: clipboard,
        bubbles: true,
        cancelable: true,
      }),
    );
  });
  await expect(panel.getByRole('alert')).toContainText(
    'Файл пуст или превышает предел',
  );
  await expect(editor.locator('.journal-upload')).toHaveCount(0);
  await expectJournalText(
    editor,
    'Existing text\nfirst pasted line\nsecond pasted line',
  );
  await panel
    .getByRole('button', { name: 'Сохранить запись', exact: true })
    .click();
  const saved = (await readJournalPage(page, runtime.origin, tree.project.id))
    .entries;
  expect(saved).toHaveLength(1);
  expect(saved[0]!.body).toBe(
    'Existing text\nfirst pasted line\nsecond pasted line',
  );
  expect(saved[0]!.media).toEqual([]);
  expect(uploads).toEqual([]);
  await page.reload();
  expect(
    (await readJournalPage(page, runtime.origin, tree.project.id)).entries[0],
  ).toEqual(saved[0]);
});

test('picker keeps order across reversed responses, drop uses the middle, and downloads exact file bytes', async ({
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
  const form = panel.locator('form[data-journal-editor]').first();
  const editor = form.getByRole('textbox', { name: 'Текст записи' });
  const payloads = [
    Buffer.from([0, 1, 255, 10, 13, 65]),
    Buffer.from('second synthetic file'),
  ];
  let releaseFirst!: () => void;
  const firstGate = new Promise<void>((resolve) => {
    releaseFirst = resolve;
  });
  const completed: string[] = [];
  await page.route('**/journal-media', async (route) => {
    const response = await route.fetch();
    const dto = await response.json();
    if (dto.media.fileName === 'first.bin') await firstGate;
    else releaseFirst();
    completed.push(dto.media.fileName);
    await route.fulfill({ response });
  });
  await editor.fill('Before');
  await editor.press('End');
  await editor.press('Enter');
  await form.getByLabel('Выбрать вложения').setInputFiles([
    {
      name: 'first.bin',
      mimeType: 'application/octet-stream',
      buffer: payloads[0]!,
    },
    { name: 'second.txt', mimeType: 'text/plain', buffer: payloads[1]! },
  ]);
  await expect(form.getByText('Загрузка…')).toHaveCount(0);
  expect(completed).toEqual(['second.txt', 'first.bin']);
  await expect(editor.locator('.journal-upload')).toHaveCount(2);
  await editor.press('Control+End');
  await page.keyboard.type('After');
  // Drop at a real caret coordinate in the first paragraph, between "Be" and "fore".
  await editor.evaluate((node) => {
    const text = node.querySelector('p')!.firstChild!;
    const range = document.createRange();
    range.setStart(text, 2);
    range.collapse(true);
    const rect = range.getBoundingClientRect();
    const transfer = new DataTransfer();
    transfer.items.add(
      new File(['middle bytes'], 'middle.txt', { type: 'text/plain' }),
    );
    node.dispatchEvent(
      new DragEvent('drop', {
        dataTransfer: transfer,
        clientX: rect.x,
        clientY: rect.y + rect.height / 2,
        bubbles: true,
        cancelable: true,
      }),
    );
  });
  await expect(editor.locator('.journal-upload')).toHaveCount(3);
  await expect(form.getByText('Загрузка…')).toHaveCount(0);
  await form
    .getByRole('button', { name: 'Сохранить запись', exact: true })
    .click();
  const saved = (await readJournalPage(page, runtime.origin, tree.project.id))
    .entries[0]!;
  expect(saved.body).toBe(
    'Be\n[Файл: middle.txt]\nfore\n[Файл: first.bin]\n[Файл: second.txt]\nAfter',
  );
  expect(saved.media.map((media) => media.fileName).sort()).toEqual([
    'first.bin',
    'middle.txt',
    'second.txt',
  ]);
  const card = panel.locator('[data-journal-entry-id]');
  await card.getByRole('button', { name: 'Показать полностью' }).click();
  const files = card.locator('.journal-file');
  await expect(files).toHaveCount(3);
  await expect(files.nth(0)).toContainText('middle.txt');
  await expect(files.nth(1)).toContainText('first.bin');
  const downloadEvent = page.waitForEvent('download');
  await files.nth(1).click();
  const download = await downloadEvent;
  expect(download.suggestedFilename()).toBe('first.bin');
  expect(await readFile((await download.path())!)).toEqual(payloads[0]);
  await page.reload();
  expect(
    (await readJournalPage(page, runtime.origin, tree.project.id)).entries[0],
  ).toEqual(saved);
  expect(
    planContent(await readTree(page, runtime.origin, tree.project.id)),
  ).toEqual(planContent(tree));
});

test('image-only entry renders in both feeds and task delete Undo restores exact media and download access', async ({
  page,
  runtime,
}) => {
  const { tree, doneId } = await seedJournal(page, runtime);
  const png = await sharp({
    create: { width: 17, height: 9, channels: 4, background: '#345678' },
  })
    .png()
    .toBuffer();
  await page.goto(runtime.origin);
  await page.getByRole('treeitem', { name: /^Работа A,/ }).click();
  const panel = page.getByRole('complementary', {
    name: 'Задача',
    exact: true,
  });
  await panel.getByRole('tab', { name: 'Ход работы', exact: true }).click();
  const form = panel.locator('form[data-journal-editor]').first();
  await expect(
    form.getByRole('button', { name: 'Сохранить запись', exact: true }),
  ).toHaveCount(0);
  await form
    .getByLabel('Выбрать вложения')
    .setInputFiles({ name: 'only.png', mimeType: 'image/png', buffer: png });
  await expect(form.getByText('Загрузка…')).toHaveCount(0);
  await form
    .getByRole('button', { name: 'Сохранить запись', exact: true })
    .click();
  const saved = (await readJournalPage(page, runtime.origin, tree.project.id))
    .entries[0]!;
  expect(saved.body).toBe('[Изображение: only.webp]\n');
  expect(saved.media[0]).toMatchObject({
    kind: 'image',
    width: 17,
    height: 9,
    mediaType: 'image/webp',
  });
  const url = `${runtime.origin}/api/projects/${tree.project.id}/tasks/${doneId}/journal-media/${saved.media[0]!.id}`;
  const bytes = await page.request.get(url);
  expect(bytes.status()).toBe(200);
  const original = await bytes.body();
  expect((await sharp(original).metadata()).format).toBe('webp');
  await expect(panel.locator('[data-journal-entry-id] img')).toHaveCount(1);
  await panel.getByRole('button', { name: 'Закрыть панель' }).click();
  await page
    .getByRole('tablist', { name: 'Представление проекта' })
    .getByRole('tab', { name: 'Журнал', exact: true })
    .click();
  await expect(
    projectFeed(page).locator('[data-journal-entry-id] img'),
  ).toHaveCount(1);
  await page.reload();
  await expect(
    projectFeed(page).locator('[data-journal-entry-id] img'),
  ).toHaveCount(1);
  await page
    .getByRole('tablist', { name: 'Представление проекта' })
    .getByRole('tab', { name: 'Задачи', exact: true })
    .click();
  await page.getByRole('treeitem', { name: /^Работа A,/ }).click();
  page.once('dialog', (dialog) => dialog.accept());
  await panel.getByRole('button', { name: 'Действия задачи' }).click();
  await page.getByRole('menuitem', { name: 'Удалить задачу…' }).click();
  await expect(
    page.locator(`[role="treeitem"][data-task-id="${doneId}"]`),
  ).toHaveCount(0);
  expect(
    (await readJournalPage(page, runtime.origin, tree.project.id)).entries,
  ).toEqual([]);
  expect((await page.request.get(url)).status()).toBe(404);
  await page
    .getByRole('button', { name: 'Отменить изменение плана', exact: true })
    .click();
  await expect(
    page.locator(`[role="treeitem"][data-task-id="${doneId}"]`),
  ).toBeVisible();
  expect(
    (await readJournalPage(page, runtime.origin, tree.project.id)).entries,
  ).toEqual([saved]);
  expect(await (await page.request.get(url)).body()).toEqual(original);
});

test('lost upload and Save acknowledgements keep exact identities and one effect while rich draft survives409', async ({
  page,
  runtime,
}) => {
  const { tree, summaryId } = await seedJournal(page, runtime);
  await page.goto(runtime.origin);
  await page.getByRole('treeitem', { name: /^Работа A,/ }).click();
  const panel = page.getByRole('complementary', {
    name: 'Задача',
    exact: true,
  });
  await panel.getByRole('tab', { name: 'Ход работы', exact: true }).click();
  const form = panel.locator('form[data-journal-editor]').first();
  const editor = form.getByRole('textbox', { name: 'Текст записи' });
  const uploadBodies: Buffer[] = [];
  const uploadIds: string[] = [];
  await page.route('**/journal-media', async (route) => {
    uploadBodies.push(route.request().postDataBuffer()!);
    const response = await route.fetch();
    expect(response.status()).toBe(201);
    uploadIds.push((await response.json()).media.id);
    if (uploadBodies.length === 1) await route.abort('failed');
    else await route.fulfill({ response });
  });
  await editor.fill('Retained rich draft');
  await editor.press('End');
  await form.getByLabel('Выбрать вложения').setInputFiles({
    name: 'retry.txt',
    mimeType: 'text/plain',
    buffer: Buffer.from('exact retry bytes'),
  });
  await expect(
    form.getByRole('button', { name: 'Повторить загрузку' }),
  ).toBeVisible();
  await expect(
    form.getByRole('button', { name: 'Сохранить запись', exact: true }),
  ).toBeDisabled();
  await form.getByRole('button', { name: 'Повторить загрузку' }).click();
  await expect(form.getByText('Загрузка…')).toHaveCount(0);
  expect(uploadIds).toHaveLength(2);
  expect(uploadIds[1]).toBe(uploadIds[0]);
  const uploadIdentity = (body: Buffer) =>
    body.toString().match(/name="uploadId"\r\n\r\n([^\r]+)/)![1];
  expect(uploadIdentity(uploadBodies[1]!)).toBe(
    uploadIdentity(uploadBodies[0]!),
  );
  await createJournalEntry(
    page,
    runtime.origin,
    tree.project.id,
    summaryId,
    0,
    'Concurrent plain entry',
    '2026-11-14',
  );
  await form
    .getByRole('button', { name: 'Сохранить запись', exact: true })
    .click();
  await expect(
    panel.getByRole('button', { name: 'Принять текущую версию журнала' }),
  ).toBeVisible();
  await expect(editor).toContainText('Retained rich draft');
  await expect(editor.locator('.journal-upload')).toHaveCount(1);
  expect(
    (await readJournalPage(page, runtime.origin, tree.project.id)).entries,
  ).toHaveLength(1);
  await panel
    .getByRole('button', { name: 'Принять текущую версию журнала' })
    .click();
  const envelopes: unknown[] = [];
  await page.route(
    `**/api/projects/${tree.project.id}/journal`,
    async (route) => {
      if (route.request().method() !== 'POST') return route.continue();
      envelopes.push(route.request().postDataJSON());
      const response = await route.fetch();
      expect(response.status()).toBe(201);
      if (envelopes.length === 1) await route.abort('failed');
      else await route.fulfill({ response });
    },
  );
  await form
    .getByRole('button', { name: 'Сохранить запись', exact: true })
    .click();
  await expect(
    form.getByRole('button', { name: 'Повторить сохранение' }),
  ).toBeVisible();
  await expect(editor).toHaveAttribute('contenteditable', 'false');
  expect(
    (await readJournalPage(page, runtime.origin, tree.project.id))
      .journalRevision,
  ).toBe(2);
  await form.getByRole('button', { name: 'Повторить сохранение' }).click();
  await expect(editor).toHaveAttribute('contenteditable', 'true');
  await expectJournalText(editor, '');
  expect(envelopes).toHaveLength(2);
  expect(envelopes[1]).toEqual(envelopes[0]);
  const saved = await readJournalPage(page, runtime.origin, tree.project.id);
  expect(saved.entries).toHaveLength(2);
  expect(saved.journalRevision).toBe(2);
  expect(
    saved.entries.find((entry) => entry.taskId !== summaryId)?.media[0]!.id,
  ).toBe(uploadIds[0]);
  expect(
    planContent(await readTree(page, runtime.origin, tree.project.id)),
  ).toEqual(planContent(tree));
});

test('upload429 and pending removal Undo retain File and independent task drafts through navigation', async ({
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
  const editor = panel.getByRole('textbox', { name: 'Текст записи' });
  let release!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  let ready!: () => void;
  const stored = new Promise<void>((resolve) => {
    ready = resolve;
  });
  const identities: string[] = [];
  await page.route('**/journal-media', async (route) => {
    identities.push(
      route
        .request()
        .postDataBuffer()!
        .toString()
        .match(/name="uploadId"\r\n\r\n([^\r]+)/)![1]!,
    );
    if (identities.length === 1)
      return route.fulfill({
        status: 429,
        contentType: 'application/json',
        body: JSON.stringify({
          code: 'MEDIA_RATE_LIMIT',
          message: 'Synthetic upload admission limit',
        }),
      });
    const response = await route.fetch();
    expect(response.status()).toBe(201);
    ready();
    await gate;
    await route.fulfill({ response });
  });
  try {
    await editor.fill('Task A independent');
    await editor.press('End');
    await panel.getByLabel('Выбрать вложения').setInputFiles({
      name: 'retained.txt',
      mimeType: 'text/plain',
      buffer: Buffer.from('source kept after429'),
    });
    await expect(editor).toContainText(
      'Не удалось загрузить вложение. Файл сохранён в черновике; повторите загрузку.',
    );
    await expect(
      panel.getByRole('button', { name: 'Сохранить запись', exact: true }),
    ).toBeDisabled();
    await editor.getByRole('button', { name: 'Повторить загрузку' }).click();
    await stored;
    await expect(
      panel.getByRole('button', { name: 'Сохранить запись', exact: true }),
    ).toBeDisabled();
    await editor.getByRole('button', { name: 'Удалить вложение' }).click();
    await expect(editor.locator('.journal-upload')).toHaveCount(0);
    await editor.focus();
    await editor.press('Control+z');
    await expect(editor.locator('.journal-upload')).toHaveCount(1);
    await page.getByRole('treeitem', { name: /^Работа C,/ }).click();
    await panel.getByRole('tab', { name: 'Ход работы', exact: true }).click();
    await expectJournalText(editor, '');
    await editor.fill('Task C independent');
    release();
    await expectJournalText(editor, 'Task C independent');
    await expect(editor).toBeFocused();
    await expect(editor.locator('.journal-upload')).toHaveCount(0);
    await page.getByRole('treeitem', { name: /^Работа A,/ }).click();
    await panel.getByRole('tab', { name: 'Ход работы', exact: true }).click();
    await expect(editor).toContainText('Task A independent');
    await expect(editor.locator('.journal-upload')).toHaveCount(1);
    await expect(editor.getByText('Загрузка…')).toHaveCount(0);
    expect(identities).toHaveLength(2);
    expect(identities[1]).toBe(identities[0]);
    await panel
      .getByRole('button', { name: 'Сохранить запись', exact: true })
      .click();
    const saved = await readJournalPage(page, runtime.origin, tree.project.id);
    expect(saved.entries).toHaveLength(1);
    expect(saved.entries[0]!.body).toBe(
      'Task A independent\n[Файл: retained.txt]\n',
    );
    await page.getByRole('treeitem', { name: /^Работа C,/ }).click();
    await panel.getByRole('tab', { name: 'Ход работы', exact: true }).click();
    await expectJournalText(editor, 'Task C independent');
  } finally {
    release();
  }
});
