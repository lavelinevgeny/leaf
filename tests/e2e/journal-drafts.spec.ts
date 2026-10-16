import {
  test,
  expect,
  seedJournal,
  createJournalEntry,
  readJournalPage,
  mutateJournal,
  openProjectJournal,
  projectFeed,
  entryCard,
  editEntry,
  chooseTask,
  assertPrivateBrowserState,
  planContent,
} from '../helpers/journal-e2e.js';
import { readTree, send } from '../helpers/optional-e2e.js';

test('pinned revision5 editor survives refresh6, close/reopen and Back; explicit rebase alone authorizes overwrite', async ({
  page,
  browser,
  runtime,
}) => {
  const { tree, summaryId } = await seedJournal(page, runtime);
  let entryId = '';
  for (let revision = 0; revision < 5; revision++) {
    const result = await createJournalEntry(
      page,
      runtime.origin,
      tree.project.id,
      summaryId,
      revision,
      `Запись ${revision}`,
      '2026-10-10',
    );
    if (result.kind === 'saved') entryId = result.entry.id;
  }
  await openProjectJournal(page, runtime.origin);
  let editor = await editEntry(page, entryId);
  await editor.getByLabel('Текст записи').fill('Мой закреплённый черновик');
  await editor.getByLabel('Дата записи', { exact: true }).fill('2026-10-12');
  const context = await browser.newContext();
  try {
    const remote = await context.newPage();
    expect(
      (
        await remote.request.post(`${runtime.origin}/api/auth/login`, {
          headers: { Origin: runtime.origin },
          data: { password: runtime.password },
        })
      ).status(),
    ).toBe(200);
    await mutateJournal(remote, runtime.origin, tree.project.id, entryId, 5, {
      body: 'Чужая версия6',
      workDate: '2026-10-11',
    });
    await page.evaluate(() => window.dispatchEvent(new Event('focus')));
    await expect(editor.getByLabel('Текст записи')).toHaveValue(
      'Мой закреплённый черновик',
    );
    await editor.getByRole('button', { name: 'Закрыть редактор' }).click();
    editor = await editEntry(page, entryId);
    await expect(editor.getByLabel('Дата записи', { exact: true })).toHaveValue(
      '12.10.2026',
    );
    await page
      .getByRole('tablist', { name: 'Представление проекта' })
      .getByRole('tab', { name: 'Задачи', exact: true })
      .click();
    await page.goBack();
    await expect(projectFeed(page)).toBeVisible();
    editor = entryCard(page, entryId).locator('[data-journal-editor]');
    await expect(editor.getByLabel('Текст записи')).toHaveValue(
      'Мой закреплённый черновик',
    );
    let sentRevision: number | undefined;
    await page.route(
      `**/api/projects/${tree.project.id}/journal/${entryId}`,
      async (route) => {
        if (route.request().method() === 'PATCH')
          sentRevision = route.request().postDataJSON().expectedJournalRevision;
        await route.continue();
      },
    );
    await editor
      .getByRole('button', { name: 'Сохранить запись', exact: true })
      .click();
    await expect(
      editor.getByRole('button', { name: 'Показать текущую запись' }),
    ).toBeVisible();
    expect(sentRevision).toBe(5);
    expect(
      (
        await readJournalPage(remote, runtime.origin, tree.project.id)
      ).entries.find((e) => e.id === entryId)?.body,
    ).toBe('Чужая версия6');
    await editor
      .getByRole('button', { name: 'Показать текущую запись' })
      .click();
    await expect(
      editor.getByText('Чужая версия6', { exact: true }),
    ).toBeVisible();
    await editor
      .getByRole('button', {
        name: 'Оставить мой текст и принять текущую версию',
      })
      .click();
    await editor
      .getByRole('button', { name: 'Сохранить запись', exact: true })
      .click();
    await expect(
      entryCard(page, entryId).getByText('Мой закреплённый черновик', {
        exact: true,
      }),
    ).toBeVisible();
    expect(sentRevision).toBe(6);
    expect(
      (await readJournalPage(remote, runtime.origin, tree.project.id))
        .journalRevision,
    ).toBe(7);
  } finally {
    await context.close();
  }
});

test('delete confirmation5 remains pinned after background6; fresh confirmation deletes once', async ({
  page,
  browser,
  runtime,
}) => {
  const { tree, summaryId } = await seedJournal(page, runtime);
  let entryId = '';
  for (let revision = 0; revision < 5; revision++) {
    const result = await createJournalEntry(
      page,
      runtime.origin,
      tree.project.id,
      summaryId,
      revision,
      `Запись ${revision}`,
      '2026-10-10',
    );
    if (result.kind === 'saved') entryId = result.entry.id;
  }
  await openProjectJournal(page, runtime.origin);
  const card = entryCard(page, entryId);
  await card.getByRole('button', { name: /Действия записи/ }).click();
  await page.getByRole('menuitem', { name: 'Удалить запись' }).click();
  const context = await browser.newContext();
  try {
    const remote = await context.newPage();
    expect(
      (
        await remote.request.post(`${runtime.origin}/api/auth/login`, {
          headers: { Origin: runtime.origin },
          data: { password: runtime.password },
        })
      ).status(),
    ).toBe(200);
    await mutateJournal(remote, runtime.origin, tree.project.id, entryId, 5, {
      body: 'Сохранено другой сессией',
      workDate: '2026-10-10',
    });
    await page.evaluate(() => window.dispatchEvent(new Event('focus')));
    let sentRevision: number | undefined;
    await page.route(
      `**/api/projects/${tree.project.id}/journal/${entryId}`,
      async (route) => {
        if (route.request().method() === 'DELETE')
          sentRevision = route.request().postDataJSON().expectedJournalRevision;
        await route.continue();
      },
    );
    await card
      .getByRole('button', { name: 'Подтвердить удаление записи' })
      .click();
    await expect(card.getByRole('alert')).toBeVisible();
    expect(sentRevision).toBe(5);
    expect(
      (
        await readJournalPage(remote, runtime.origin, tree.project.id)
      ).entries.some((e) => e.id === entryId),
    ).toBe(true);
    await card.getByRole('button', { name: 'Отмена удаления' }).click();
    await card.getByRole('button', { name: /Действия записи/ }).click();
    await page.getByRole('menuitem', { name: 'Удалить запись' }).click();
    await card
      .getByRole('button', { name: 'Подтвердить удаление записи' })
      .click();
    await expect(card).toHaveCount(0);
    expect(sentRevision).toBe(6);
    expect(
      (await readJournalPage(remote, runtime.origin, tree.project.id))
        .journalRevision,
    ).toBe(7);
  } finally {
    await context.close();
  }
});

for (const method of ['POST', 'PATCH', 'DELETE'] as const) {
  test(`lost ${method} response retains exact retry through admission429 and frozen remote deletion`, async ({
    page,
    runtime,
  }) => {
    const { tree, summaryId } = await seedJournal(page, runtime);
    const created = await createJournalEntry(
      page,
      runtime.origin,
      tree.project.id,
      summaryId,
      0,
      'Исходная запись',
      '2026-10-10',
    );
    if (created.kind !== 'saved') throw new Error('Missing saved entry');
    let entryId = created.entry.id;
    await openProjectJournal(page, runtime.origin);
    const envelopes: unknown[] = [];
    let dropped = false;
    await page.route(
      `**/api/projects/${tree.project.id}/journal**`,
      async (route) => {
        if (route.request().method() !== method) return route.continue();
        envelopes.push(route.request().postDataJSON());
        if (!dropped) {
          dropped = true;
          const response = await route.fetch();
          expect(response.status()).toBe(method === 'POST' ? 201 : 200);
          if (method !== 'DELETE') {
            const dto = await response.json();
            entryId = dto.entry.id;
          }
          await route.abort('failed');
        } else if (envelopes.length === 2) {
          await route.fulfill({
            status: 429,
            contentType: 'application/json',
            body: JSON.stringify({
              code: 'DEMO_LIMIT',
              message: 'Synthetic admission limit',
            }),
          });
        } else await route.continue();
      },
    );
    if (method === 'POST') {
      await projectFeed(page)
        .getByRole('button', { name: 'Добавить запись', exact: true })
        .click();
      const dialog = page.getByRole('region', { name: 'Новая запись журнала' });
      await chooseTask(dialog, 'Этап P');
      await dialog.getByLabel('Текст записи').fill('Точный потерянный ответ');
      await dialog.getByRole('button', { name: 'Сохранить запись' }).click();
    } else if (method === 'PATCH') {
      const editor = await editEntry(page, entryId);
      await editor.getByLabel('Текст записи').fill('Точный потерянный ответ');
      await editor.getByRole('button', { name: 'Сохранить запись' }).click();
    } else {
      await entryCard(page, entryId)
        .getByRole('button', { name: /Действия записи/ })
        .click();
      await page.getByRole('menuitem', { name: 'Удалить запись' }).click();
      await entryCard(page, entryId)
        .getByRole('button', { name: 'Подтвердить удаление записи' })
        .click();
    }
    const retry = page.getByRole('button', {
      name: 'Повторить сохранение',
      exact: true,
    });
    await expect(retry).toBeVisible();
    await expect(
      page.getByRole('button', { name: 'Отменить изменение плана' }),
    ).toBeDisabled();
    const currentUrl = page.url();
    await page
      .getByRole('tablist', { name: 'Представление проекта' })
      .getByRole('tab', { name: 'Задачи', exact: true })
      .click({ force: true });
    expect(page.url()).toBe(currentUrl);
    if (method !== 'DELETE') {
      // The server already committed; a later deletion precedes the frozen retry ACK.
      const now = await readJournalPage(page, runtime.origin, tree.project.id);
      await mutateJournal(
        page,
        runtime.origin,
        tree.project.id,
        entryId,
        now.journalRevision,
      );
      await page.evaluate(() => window.dispatchEvent(new Event('focus')));
    }
    const admission = page.waitForResponse(
      (response) =>
        response.request().method() === method && response.status() === 429,
    );
    await retry.click();
    expect((await admission).status()).toBe(429);
    await expect(retry).toBeVisible();
    await expect(retry).toBeEnabled();
    await expect(
      page.getByRole('button', { name: 'Отменить изменение плана' }),
    ).toBeDisabled();
    expect(envelopes).toHaveLength(2);
    expect(envelopes[1]).toEqual(envelopes[0]);
    await retry.click();
    await expect(
      page.getByRole('button', { name: 'Повторить сохранение', exact: true }),
    ).toHaveCount(0);
    expect(envelopes).toHaveLength(3);
    expect(envelopes[1]).toEqual(envelopes[0]);
    expect(envelopes[2]).toEqual(envelopes[0]);
    const final = await readJournalPage(page, runtime.origin, tree.project.id);
    expect(final.journalRevision).toBe(method === 'DELETE' ? 2 : 3);
    expect(final.entries.some((e) => e.id === entryId)).toBe(false);
    await expect(entryCard(page, entryId)).toHaveCount(0);
    expect(
      (await readTree(page, runtime.origin, tree.project.id)).project.revision,
    ).toBe(tree.project.revision);
  });
}

test('RAM task/modal/project isolation, newline/clear/logout/beforeunload and browser private state', async ({
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
  await panel.getByRole('tab', { name: 'Журнал', exact: true }).click();
  await panel.getByLabel('Текст записи').fill('Отдельный task черновик');
  await panel.getByLabel('Текст записи').press('Enter');
  await panel.getByLabel('Текст записи').press('End');
  await expect(panel.getByLabel('Текст записи')).toHaveValue(
    'Отдельный task черновик\n',
  );
  await panel.getByRole('tab', { name: 'Задача', exact: true }).click();
  await panel.getByRole('tab', { name: 'Журнал', exact: true }).click();
  await expect(panel.getByLabel('Текст записи')).toHaveValue(
    'Отдельный task черновик\n',
  );
  await panel.getByRole('button', { name: 'Закрыть панель' }).click();
  await page
    .getByRole('tablist', { name: 'Представление проекта' })
    .getByRole('tab', { name: 'Журнал', exact: true })
    .click();
  await projectFeed(page)
    .getByRole('button', { name: 'Добавить запись', exact: true })
    .click();
  const dialog = page.getByRole('region', { name: 'Новая запись журнала' });
  await expect(dialog.getByLabel('Текст записи')).toHaveValue('');
  await chooseTask(dialog, 'Работа A');
  await dialog.getByLabel('Текст записи').fill('Отдельный modal черновик');
  await dialog.getByLabel('Дата записи', { exact: true }).fill('2026-10-13');
  await page.keyboard.press('Escape');
  await page
    .getByLabel('Поиск записей', { exact: true })
    .fill('Приватный поиск');
  await assertPrivateBrowserState(page, [
    'Отдельный task черновик',
    'Отдельный modal черновик',
    '2026-10-13',
    'Приватный поиск',
  ]);
  await projectFeed(page)
    .getByRole('button', { name: 'Добавить запись', exact: true })
    .click();
  await expect(dialog.getByLabel('Текст записи')).toHaveValue(
    'Отдельный modal черновик',
  );
  page.once('dialog', async (d) => {
    expect(d.type()).toBe('confirm');
    await d.dismiss();
  });
  await dialog.getByRole('button', { name: 'Очистить черновик' }).click();
  await expect(dialog.getByLabel('Текст записи')).toHaveValue(
    'Отдельный modal черновик',
  );
  page.once('dialog', async (d) => {
    expect(d.type()).toBe('confirm');
    await d.accept();
  });
  await dialog.getByRole('button', { name: 'Очистить черновик' }).click();
  await expect(dialog).toBeHidden();
  page.once('dialog', async (d) => {
    expect(d.type()).toBe('beforeunload');
    await d.dismiss();
  });
  const unloading = page.waitForEvent('dialog');
  const navigation = page.reload({ timeout: 1500 }).catch((error) => {
    expect(error.name).toBe('TimeoutError');
  });
  const beforeUnload = await unloading;
  expect(beforeUnload.type()).toBe('beforeunload');
  await navigation;
  await expect(projectFeed(page)).toBeVisible();
  page.once('dialog', async (d) => {
    expect(d.type()).toBe('confirm');
    await d.dismiss();
  });
  await page.getByRole('button', { name: 'Выйти', exact: true }).click();
  await expect(projectFeed(page)).toBeVisible();
  page.once('dialog', async (d) => {
    expect(d.type()).toBe('confirm');
    await d.accept();
  });
  await page.getByRole('button', { name: 'Выйти', exact: true }).click();
  await expect(page.getByLabel('Пароль', { exact: true })).toBeVisible();
  expect(
    (
      await page.request.get(
        `${runtime.origin}/api/projects/${tree.project.id}/tasks/${doneId}/journal`,
        { headers: { 'X-Leaf-Contract-Version': '2' } },
      )
    ).status(),
  ).toBe(401);
  await page.getByLabel('Пароль', { exact: true }).fill(runtime.password);
  await page.getByRole('button', { name: 'Войти', exact: true }).click();
  await page.getByRole('treeitem', { name: /^Работа A,/ }).click();
  await panel.getByRole('tab', { name: 'Журнал', exact: true }).click();
  await expect(panel.getByLabel('Текст записи')).toHaveValue('');
});

test('literal Moscow day across UTC/browser timezone boundaries keeps touched/dirty/cleared drafts', async ({
  browser,
  runtime,
}, info) => {
  const context = await browser.newContext({
    viewport: info.project.use.viewport!,
    timezoneId: 'America/Los_Angeles',
  });
  try {
    const page = await context.newPage();
    let { tree } = await seedJournal(page, runtime);
    tree = await send(page, runtime.origin, tree, {
      type: 'project.schedule',
      changes: { timezone: 'Europe/Moscow' },
    });
    await page.clock.install({ time: new Date('2026-10-08T22:30:00Z') });
    await openProjectJournal(page, runtime.origin);
    await projectFeed(page)
      .getByRole('button', { name: 'Добавить запись', exact: true })
      .click();
    const dialog = page.getByRole('region', { name: 'Новая запись журнала' });
    await expect(dialog.getByLabel('Дата записи', { exact: true })).toHaveValue(
      '09.10.2026',
    );
    expect(
      await page.evaluate(() => new Date().toISOString().slice(0, 10)),
    ).toBe('2026-10-08');
    expect(
      await page.evaluate(
        () => Intl.DateTimeFormat().resolvedOptions().timeZone,
      ),
    ).toBe('America/Los_Angeles');
    await page.clock.setSystemTime(new Date('2026-10-09T22:30:00Z'));
    await page.evaluate(() => window.dispatchEvent(new Event('focus')));
    await expect(dialog.getByLabel('Дата записи', { exact: true })).toHaveValue(
      '10.10.2026',
    );
    await dialog.getByLabel('Дата записи', { exact: true }).fill('2024-02-29');
    await dialog.getByLabel('Текст записи').fill('День сохранён буквально');
    await chooseTask(dialog, 'Работа A');
    await page.clock.setSystemTime(new Date('2026-10-10T22:30:00Z'));
    await page.evaluate(() => window.dispatchEvent(new Event('focus')));
    await expect(dialog.getByLabel('Дата записи', { exact: true })).toHaveValue(
      '29.02.2024',
    );
    await dialog.getByLabel('Дата записи', { exact: true }).blur();
    await expect(dialog.getByLabel('Дата записи', { exact: true })).toHaveValue(
      '29.02.2024',
    );
    await dialog.getByRole('button', { name: 'Сохранить запись' }).click();
    await expect(dialog).toBeHidden();
    expect(
      (await readJournalPage(page, runtime.origin, tree.project.id)).entries[0]
        ?.workDate,
    ).toBe('2024-02-29');
    await projectFeed(page)
      .getByRole('button', { name: 'Добавить запись', exact: true })
      .click();
    await dialog.getByLabel('Текст записи').fill('Дата грязного черновика');
    await page.clock.setSystemTime(new Date('2026-10-11T22:30:00Z'));
    await page.evaluate(() => window.dispatchEvent(new Event('focus')));
    await expect(dialog.getByLabel('Дата записи', { exact: true })).toHaveValue(
      '11.10.2026',
    );
    await dialog.getByLabel('Дата записи', { exact: true }).fill('');
    await dialog.getByLabel('Дата записи', { exact: true }).blur();
    await page.clock.setSystemTime(new Date('2026-10-12T22:30:00Z'));
    await page.evaluate(() => window.dispatchEvent(new Event('focus')));
    await expect(dialog.getByLabel('Дата записи', { exact: true })).toHaveValue(
      '',
    );
    await expect(
      dialog.getByRole('button', { name: 'Сохранить запись' }),
    ).toBeDisabled();
    await page.keyboard.press('Escape');
  } finally {
    await context.close();
  }
});

test('expired real session clears private RAM and denies journal URL before reauthentication', async ({
  page,
  runtime,
}) => {
  const { tree } = await seedJournal(page, runtime);
  await openProjectJournal(page, runtime.origin);
  await projectFeed(page)
    .getByRole('button', { name: 'Добавить запись', exact: true })
    .click();
  await page
    .getByRole('region', { name: 'Новая запись журнала' })
    .getByLabel('Текст записи')
    .fill('Удаляемый приватный черновик');
  await page.keyboard.press('Escape');
  expect(
    (
      await page.request.post(`${runtime.origin}/api/auth/logout`, {
        headers: { Origin: runtime.origin },
        data: {},
      })
    ).status(),
  ).toBe(200);
  await page.evaluate(() => window.dispatchEvent(new Event('focus')));
  await expect(page.getByLabel('Пароль', { exact: true })).toBeVisible();
  await assertPrivateBrowserState(page, ['Удаляемый приватный черновик']);
  expect(
    (
      await page.request.get(
        `${runtime.origin}/api/projects/${tree.project.id}/journal`,
        { headers: { 'X-Leaf-Contract-Version': '2' } },
      )
    ).status(),
  ).toBe(401);
  await page.getByLabel('Пароль', { exact: true }).fill(runtime.password);
  await page.getByRole('button', { name: 'Войти', exact: true }).click();
  await page
    .getByRole('tablist', { name: 'Представление проекта' })
    .getByRole('tab', { name: 'Журнал', exact: true })
    .click();
  await projectFeed(page)
    .getByRole('button', { name: 'Добавить запись', exact: true })
    .click();
  await expect(
    page
      .getByRole('region', { name: 'Новая запись журнала' })
      .getByLabel('Текст записи'),
  ).toHaveValue('');
});

test('deleted task keeps own RAM draft unavailable; separate project create draft stays isolated on Back', async ({
  page,
  runtime,
}) => {
  const { tree: initialTree, deepId } = await seedJournal(page, runtime);
  let tree = initialTree;
  const created = await page.request.post(`${runtime.origin}/api/projects`, {
    headers: { Origin: runtime.origin, 'X-Leaf-Contract-Version': '2' },
    data: { title: 'Второй проект черновиков' },
  });
  expect(created.status()).toBe(201);
  await page.goto(runtime.origin);
  const row = page.locator(`[role="treeitem"][data-task-id="${deepId}"]`);
  await row
    .getByRole('button', { name: 'Добавить запись: Уровень 5', exact: true })
    .focus();
  await row
    .getByRole('button', { name: 'Добавить запись: Уровень 5', exact: true })
    .press('Enter');
  const panel = page.getByRole('complementary', {
    name: 'Задача',
    exact: true,
  });
  await panel.getByLabel('Текст записи').fill('Черновик удалённой задачи');
  tree = await send(page, runtime.origin, tree, {
    type: 'task.delete',
    taskId: deepId,
  });
  await page.evaluate(() => window.dispatchEvent(new Event('focus')));
  await expect(
    panel.getByRole('alert').filter({ hasText: 'Задача удалена' }),
  ).toBeVisible();
  await expect(panel.getByLabel('Текст записи')).toHaveValue(
    'Черновик удалённой задачи',
  );
  await expect(
    panel.getByRole('button', { name: 'Сохранить запись', exact: true }),
  ).toBeDisabled();
  await panel.getByRole('button', { name: 'Закрыть панель' }).click();
  await page
    .getByRole('tablist', { name: 'Представление проекта' })
    .getByRole('tab', { name: 'Журнал', exact: true })
    .click();
  await projectFeed(page)
    .getByRole('button', { name: 'Добавить запись', exact: true })
    .click();
  const dialog = page.getByRole('region', { name: 'Новая запись журнала' });
  await dialog.getByLabel('Текст записи').fill('Только первый проект');
  await page.keyboard.press('Escape');
  await page
    .getByRole('button', { name: 'Второй проект черновиков', exact: true })
    .click();
  await expect(page.locator('#project-view-tasks')).toBeVisible();
  await page.goBack();
  await expect(projectFeed(page)).toBeVisible();
  await projectFeed(page)
    .getByRole('button', { name: 'Добавить запись', exact: true })
    .click();
  await expect(dialog.getByLabel('Текст записи')).toHaveValue(
    'Только первый проект',
  );
  await page.keyboard.press('Escape');
  expect(
    (await readJournalPage(page, runtime.origin, tree.project.id)).entries,
  ).toHaveLength(0);
  await assertPrivateBrowserState(page, [
    'Черновик удалённой задачи',
    'Только первый проект',
  ]);
});

test('native conflict replacement protects own body/date until confirmation and saves only by a new explicit submit', async ({
  page,
  browser,
  runtime,
}) => {
  const { tree, summaryId } = await seedJournal(page, runtime);
  const added = await createJournalEntry(
    page,
    runtime.origin,
    tree.project.id,
    summaryId,
    0,
    'Исходная запись',
    '2026-10-10',
  );
  if (added.kind !== 'saved') throw new Error('Missing entry');
  await openProjectJournal(page, runtime.origin);
  const editor = await editEntry(page, added.entry.id);
  await editor
    .getByLabel('Текст записи')
    .fill('Собственный несохранённый текст');
  await editor.getByLabel('Дата записи', { exact: true }).fill('2026-10-12');
  const context = await browser.newContext();
  try {
    const remote = await context.newPage();
    expect(
      (
        await remote.request.post(`${runtime.origin}/api/auth/login`, {
          headers: { Origin: runtime.origin },
          data: { password: runtime.password },
        })
      ).status(),
    ).toBe(200);
    await mutateJournal(
      remote,
      runtime.origin,
      tree.project.id,
      added.entry.id,
      1,
      { body: 'Текущая чужая запись', workDate: '2026-10-11' },
    );
    const writes: { operationId: string; expectedJournalRevision: number }[] =
      [];
    page.on('request', (request) => {
      if (
        request.method() === 'PATCH' &&
        request.url().endsWith(`/journal/${added.entry.id}`)
      )
        writes.push(request.postDataJSON());
    });
    await editor
      .getByRole('button', { name: 'Сохранить запись', exact: true })
      .click();
    await editor
      .getByRole('button', { name: 'Показать текущую запись' })
      .click();
    await expect(
      editor.getByText('Текущая чужая запись', { exact: true }),
    ).toBeVisible();
    const replace = editor.getByRole('button', {
      name: 'Заменить черновик текущей записью',
    });
    let confirmations = 0;
    page.on('dialog', async (dialog) => {
      expect(dialog.type()).toBe('confirm');
      confirmations++;
      if (confirmations <= 2) await dialog.dismiss();
      else await dialog.accept();
    });
    for (let attempt = 1; attempt <= 2; attempt++) {
      await replace.click();
      expect(confirmations).toBe(attempt);
      await expect(editor.getByLabel('Текст записи')).toHaveValue(
        'Собственный несохранённый текст',
      );
      await expect(
        editor.getByLabel('Дата записи', { exact: true }),
      ).toHaveValue('12.10.2026');
      await expect(replace).toBeVisible();
      expect(writes).toHaveLength(1);
      expect(writes[0]!.expectedJournalRevision).toBe(1);
    }
    await replace.click();
    expect(confirmations).toBe(3);
    await expect(editor.getByLabel('Текст записи')).toHaveValue(
      'Текущая чужая запись',
    );
    await expect(editor.getByLabel('Дата записи', { exact: true })).toHaveValue(
      '11.10.2026',
    );
    await expect(replace).toHaveCount(0);
    expect(writes).toHaveLength(1);
    expect(
      (await readJournalPage(remote, runtime.origin, tree.project.id))
        .journalRevision,
    ).toBe(2);
    await editor.getByLabel('Текст записи').fill('После явного принятия');
    await editor
      .getByRole('button', { name: 'Сохранить запись', exact: true })
      .click();
    await expect(
      entryCard(page, added.entry.id).getByText('После явного принятия', {
        exact: true,
      }),
    ).toBeVisible();
    expect(writes).toHaveLength(2);
    expect(writes[1]!.expectedJournalRevision).toBe(2);
    expect(writes[1]!.operationId).not.toBe(writes[0]!.operationId);
    expect(
      (await readJournalPage(remote, runtime.origin, tree.project.id))
        .journalRevision,
    ).toBe(3);
  } finally {
    await context.close();
  }
});

test('saved breadcrumb and journal metadata navigation guard dirty task title without saving independent drafts', async ({
  page,
  runtime,
}) => {
  let { tree } = await seedJournal(page, runtime);
  const child = tree.tasks.find((task) => task.title === 'Уровень 1')!;
  await page.goto(runtime.origin);
  await page.locator(`[role="treeitem"][data-task-id="${child.id}"]`).click();
  const panel = page.getByRole('complementary', {
    name: 'Задача',
    exact: true,
  });
  const path = panel.getByRole('navigation', { name: 'Путь задачи' });
  await expect(
    path.getByRole('button', { name: 'Без дат', exact: true }),
  ).toBeVisible();
  await panel.getByRole('button', { name: 'Изменить название' }).click();
  await panel
    .getByLabel('Название задачи', { exact: true })
    .fill('Локальный заголовок');
  await panel.getByLabel('Название задачи', { exact: true }).press('Enter');
  await path.getByRole('button', { name: 'Без дат', exact: true }).click();
  const leave = page.getByRole('dialog', {
    name: 'Несохранённые изменения задачи',
  });
  await expect(leave).toBeVisible();
  await leave
    .getByRole('button', { name: 'Продолжить редактирование' })
    .click();
  await panel.getByRole('tab', { name: 'Журнал', exact: true }).click();
  await panel.getByLabel('Текст записи').fill('Независимый RAM черновик');
  tree = await send(page, runtime.origin, tree, {
    type: 'task.create',
    parentId: null,
    title: 'Новый сохранённый родитель',
  });
  const remoteParent = tree.tasks.find(
    (task) => task.title === 'Новый сохранённый родитель',
  )!;
  tree = await send(page, runtime.origin, tree, {
    type: 'task.move',
    taskId: child.id,
    parentId: remoteParent.id,
    position: 0,
  });
  tree = await send(page, runtime.origin, tree, {
    type: 'task.edit',
    taskId: child.id,
    changes: { title: 'Сохранённое удалённое название' },
  });
  await page.evaluate(() => window.dispatchEvent(new Event('focus')));
  await expect(panel.getByRole('heading', { level: 2 })).toHaveText(
    'Сохранённое удалённое название',
  );
  await expect(
    panel.getByText('Несохранённое название: Локальный заголовок', {
      exact: true,
    }),
  ).toBeVisible();
  await expect(
    path.getByRole('button', { name: 'Без дат', exact: true }),
  ).toHaveCount(0);
  await expect(
    path.getByRole('button', {
      name: 'Новый сохранённый родитель',
      exact: true,
    }),
  ).toBeVisible();
  await expect(panel.getByLabel('Текст записи')).toHaveValue(
    'Независимый RAM черновик',
  );
  await path
    .getByRole('button', { name: 'Новый сохранённый родитель', exact: true })
    .click();
  await expect(leave).toBeVisible();
  await leave
    .getByRole('button', { name: 'Продолжить редактирование' })
    .click();
  await expect(panel.getByRole('heading', { level: 2 })).toHaveText(
    'Сохранённое удалённое название',
  );
  await path
    .getByRole('button', { name: 'Новый сохранённый родитель', exact: true })
    .click();
  await leave.getByRole('button', { name: 'Не сохранять' }).click();
  await expect(panel.getByRole('heading', { level: 2 })).toHaveText(
    'Новый сохранённый родитель',
  );
  await expect(
    panel.getByRole('tab', { name: 'Журнал', exact: true }),
  ).toHaveAttribute('aria-selected', 'true');
  expect(
    planContent(await readTree(page, runtime.origin, tree.project.id)),
  ).toEqual(planContent(tree));
  expect(
    (await readJournalPage(page, runtime.origin, tree.project.id)).entries,
  ).toHaveLength(0);
});

test('late read A cannot hide uncertain write B and its real exact replay', async ({
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
  await panel.getByRole('tab', { name: 'Журнал', exact: true }).click();
  await expect(panel.getByText('Записей пока нет')).toBeVisible();
  const projectUrl = `${runtime.origin}/api/projects/${tree.project.id}/journal`;
  const taskUrl = `${runtime.origin}/api/projects/${tree.project.id}/tasks/${doneId}/journal`;
  let releaseReadA!: () => void;
  let loseResponseB!: () => void;
  const readGate = new Promise<void>((resolve) => {
    releaseReadA = resolve;
  });
  const writeGate = new Promise<void>((resolve) => {
    loseResponseB = resolve;
  });
  let acknowledgedA = false;
  let heldReadA = false;
  let committedB = false;
  const writes: { operationId: string; expectedJournalRevision: number }[] = [];
  await page.route(taskUrl, async (route) => {
    if (route.request().method() === 'GET' && acknowledgedA && !heldReadA) {
      heldReadA = true;
      await readGate;
    }
    await route.continue();
  });
  await page.route(projectUrl, async (route) => {
    if (route.request().method() !== 'POST') return route.continue();
    writes.push(route.request().postDataJSON());
    if (writes.length === 1) {
      const response = await route.fetch();
      expect(response.status()).toBe(201);
      acknowledgedA = true;
      return route.fulfill({ response });
    }
    if (writes.length === 2) {
      const response = await route.fetch();
      expect(response.status()).toBe(201);
      committedB = true;
      await writeGate;
      return route.abort('failed');
    }
    await route.continue();
  });
  try {
    await panel.getByLabel('Текст записи').fill('Подтверждённая операция A');
    await panel
      .getByRole('button', { name: 'Сохранить запись', exact: true })
      .click();
    await expect.poll(() => heldReadA).toBe(true);
    await expect(
      projectFeed(page).getByText('Подтверждённая операция A', { exact: true }),
    ).toHaveCount(1);
    // These are normal enabled controls: no imperative unlock or hook state edits.
    const add = panel.getByRole('button', {
      name: 'Добавить запись',
      exact: true,
    });
    if (await add.isVisible()) await add.click();
    await panel
      .getByLabel('Текст записи')
      .fill('Сохранённая один раз операция B');
    await expect(
      panel.getByRole('button', { name: 'Сохранить запись', exact: true }),
    ).toBeEnabled();
    await panel
      .getByRole('button', { name: 'Сохранить запись', exact: true })
      .click();
    await expect.poll(() => committedB).toBe(true);
    const readFinished = page.waitForResponse(
      (response) =>
        response.url() === taskUrl && response.request().method() === 'GET',
    );
    releaseReadA();
    await readFinished;
    loseResponseB();
    await expect(
      panel.getByRole('button', { name: 'Повторить сохранение', exact: true }),
    ).toBeVisible();
    await expect(panel.getByLabel('Текст записи')).toHaveValue(
      'Сохранённая один раз операция B',
    );
    await expect(panel.getByLabel('Текст записи')).toBeDisabled();
    expect(writes).toHaveLength(2);
    await panel
      .getByRole('button', { name: 'Повторить сохранение', exact: true })
      .click();
    await expect(panel.getByLabel('Текст записи')).toHaveValue('');
    await expect(panel.getByLabel('Текст записи')).toBeEnabled();
    expect(writes).toHaveLength(3);
    expect(JSON.stringify(writes[2]) === JSON.stringify(writes[1])).toBe(true);
    expect(writes[1]!.operationId).not.toBe(writes[0]!.operationId);
    expect(writes[1]!.expectedJournalRevision).toBe(1);
    const stored = await readJournalPage(page, runtime.origin, tree.project.id);
    expect(stored.journalRevision).toBe(2);
    expect(
      stored.entries.filter(
        (entry) => entry.body === 'Сохранённая один раз операция B',
      ),
    ).toHaveLength(1);
    await expect(
      panel.getByText('Сохранённая один раз операция B', { exact: true }),
    ).toBeVisible();
  } finally {
    releaseReadA();
    loseResponseB();
    await page.unroute(taskUrl);
    await page.unroute(projectUrl);
  }
});
