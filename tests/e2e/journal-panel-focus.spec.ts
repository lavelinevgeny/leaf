import {
  test,
  expect,
  seedJournal,
  createJournalEntry,
  openProjectJournal,
  entryCard,
} from '../helpers/journal-e2e.js';

for (const intent of [
  'stay',
  'focus',
  'pointer',
  'navigate',
  'history',
] as const) {
  test(`journal panel return survives close-triggered feed reload and respects ${intent} intent`, async ({
    page,
    runtime,
  }) => {
    const { tree, summaryId } = await seedJournal(page, runtime);
    const saved = await createJournalEntry(
      page,
      runtime.origin,
      tree.project.id,
      summaryId,
      0,
      'Синтетический возврат',
      '2026-10-10',
    );
    if (saved.kind !== 'saved') throw new Error('Missing saved entry');
    await openProjectJournal(page, runtime.origin);
    const origin = entryCard(page, saved.entry.id).getByRole('button', {
      name: 'Этап P',
      exact: true,
    });
    const originNode = await origin.elementHandle();
    if (!originNode) throw new Error('Missing origin');
    await origin.click();
    const panel = page.getByRole('complementary', {
      name: 'Задача',
      exact: true,
    });
    await expect(panel.getByLabel('Текст записи')).toBeVisible();
    await expect(origin).toBeEnabled();
    let release!: () => void;
    const gate = new Promise<void>((done) => {
      release = done;
    });
    let held = false;
    await page.route(
      new RegExp(`/api/projects/${tree.project.id}/journal(?:\\?|$)`),
      async (route) => {
        const response = await route.fetch();
        held = true;
        await gate;
        await route.fulfill({ response });
      },
    );
    try {
      await panel.getByRole('button', { name: 'Закрыть панель' }).click();
      await expect.poll(() => held).toBe(true);
      await expect(origin).toBeDisabled();
      // Disabling the synchronously focused link blurs it in the real browser.
      await expect(origin).not.toBeFocused();
      if (intent === 'focus') {
        const search = page.getByLabel('Поиск записей', { exact: true });
        await search.focus();
        await search.evaluate((node) => (node as HTMLElement).blur());
      } else if (intent === 'pointer')
        await page.dispatchEvent('body', 'pointerdown');
      else if (intent === 'navigate')
        await page.getByRole('tab', { name: 'Задачи', exact: true }).click();
      if (intent === 'history') await page.goBack();
      release();
      await expect
        .poll(() =>
          originNode.evaluate((node) => (node as HTMLButtonElement).disabled),
        )
        .toBe(false);
      expect(await originNode.evaluate((node) => node.isConnected)).toBe(true);
      if (intent === 'stay') await expect(origin).toBeFocused();
      else {
        expect(
          await originNode.evaluate((node) => document.activeElement === node),
        ).toBe(false);
        if (intent !== 'navigate' && intent !== 'history')
          expect(
            await page.evaluate(() => document.activeElement === document.body),
          ).toBe(true);
      }
    } finally {
      release();
      await page.unrouteAll({ behavior: 'wait' });
    }
  });
}
