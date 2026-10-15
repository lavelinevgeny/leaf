import {
  test,
  expect,
  seedJournal,
  createJournalEntry,
  openProjectJournal,
  projectFeed,
  entryCard,
  journalGeometry,
  readJournalPage,
  planContent,
} from '../helpers/journal-e2e.js';
import { readTree, send } from '../helpers/optional-e2e.js';

test('project visits preserve Gantt/filter/scale/collapse/two-axis scroll, stable header and task panel origin', async ({
  page,
  runtime,
}) => {
  const { tree: initialTree, summaryId } = await seedJournal(page, runtime);
  let tree = initialTree;
  for (let index = 0; index < 35; index++)
    tree = await send(page, runtime.origin, tree, {
      type: 'task.create',
      parentId: null,
      title: `Строка ${index}`,
    });
  const result = await createJournalEntry(
    page,
    runtime.origin,
    tree.project.id,
    summaryId,
    0,
    'Переход в задачу',
    '2026-10-10',
  );
  if (result.kind !== 'saved') throw new Error('Missing saved entry');
  await page.goto(runtime.origin);
  const tabs = page.getByRole('tablist', { name: 'Представление проекта' });
  await page.getByLabel('Масштаб Ганта', { exact: true }).selectOption('weeks');
  const period = () =>
    page.locator('.gantt-svg').evaluate((svg) => ({
      months: [...svg.querySelectorAll('.gantt-month')].map((label) => ({
        text: label.textContent,
        x: label.getAttribute('x'),
      })),
      days: [...svg.querySelectorAll('.gantt-day')].map((label) => ({
        text: label.textContent,
        x: label.getAttribute('x'),
      })),
      width: svg.getAttribute('width'),
    }));
  await expect(page.locator('.gantt-month').first()).toBeInViewport();
  await expect(page.locator('.gantt-day').first()).toBeInViewport();
  const defaultPeriod = await period();
  await page.getByRole('button', { name: 'Следующий период' }).click();
  await expect.poll(period).not.toEqual(defaultPeriod);
  const selectedPeriod = await period();
  await expect(page.locator('.gantt-month').first()).toBeInViewport();
  await expect(page.locator('.gantt-day').first()).toBeInViewport();
  expect(
    Date.parse(
      `${selectedPeriod.months[0]!.text}-${selectedPeriod.days[0]!.text}`,
    ),
  ).toBeGreaterThan(
    Date.parse(
      `${defaultPeriod.months[0]!.text}-${defaultPeriod.days[0]!.text}`,
    ),
  );
  await page
    .getByRole('button', { name: 'Свернуть Без дат', exact: true })
    .click();
  await page.getByLabel('Поиск задач', { exact: true }).fill('Строка');
  await expect(page.getByRole('treeitem', { name: /^Строка / })).toHaveCount(
    35,
  );
  await page.locator('[data-plan-scroll]').evaluate((n) => {
    n.scrollTop = 350;
  });
  await page.locator('.timeline-time').evaluate((n) => {
    n.scrollLeft = 180;
  });
  const before = await page.evaluate(() => ({
    header: document
      .querySelector('.workspace-header')!
      .getBoundingClientRect()
      .toJSON(),
    top: document.querySelector('[data-plan-scroll]')!.scrollTop,
    left: document.querySelector('.timeline-time')!.scrollLeft,
  }));
  expect(before.top).toBeGreaterThan(0);
  expect(before.left).toBeGreaterThan(0);
  expect(await period()).toEqual(selectedPeriod);
  const restoredTimeline = async () => {
    await expect.poll(period).toEqual(selectedPeriod);
    await expect
      .poll(() =>
        page.locator('[data-plan-scroll]').evaluate((n) => n.scrollTop),
      )
      .toBe(before.top);
    await expect
      .poll(() => page.locator('.timeline-time').evaluate((n) => n.scrollLeft))
      .toBe(before.left);
  };
  await tabs.getByRole('tab', { name: 'Журнал', exact: true }).click();
  await expect(entryCard(page, result.entry.id)).toBeVisible();
  const header = await page.locator('.workspace-header').boundingBox();
  expect(header!.y).toBe(before.header.y);
  expect(header!.height).toBe(before.header.height);
  const geometry = await journalGeometry(page);
  await entryCard(page, result.entry.id)
    .getByRole('button', { name: 'Этап P', exact: true })
    .click();
  const panel = page.getByRole('complementary', {
    name: 'Задача',
    exact: true,
  });
  await expect(
    panel.getByRole('tab', { name: 'Журнал', exact: true }),
  ).toHaveAttribute('aria-selected', 'true');
  await panel.getByRole('button', { name: 'Закрыть панель' }).click();
  await expect(
    entryCard(page, result.entry.id).getByRole('button', {
      name: 'Этап P',
      exact: true,
    }),
  ).toBeFocused();
  expect(await journalGeometry(page)).toEqual(geometry);
  await tabs.getByRole('tab', { name: 'Задачи', exact: true }).click();
  await expect(page.getByLabel('Поиск задач', { exact: true })).toHaveValue(
    'Строка',
  );
  await expect(page.getByLabel('Масштаб Ганта', { exact: true })).toHaveValue(
    'weeks',
  );
  expect(
    await page.locator('[data-plan-scroll]').evaluate((n) => n.scrollTop),
  ).toBe(before.top);
  expect(
    await page.locator('.timeline-time').evaluate((n) => n.scrollLeft),
  ).toBe(before.left);
  await restoredTimeline();
  await page.goBack();
  await expect(projectFeed(page)).toBeVisible();
  await page.goForward();
  await expect(page.locator('#project-view-tasks')).toBeVisible();
  await restoredTimeline();
  await tabs.getByRole('tab', { name: 'Журнал', exact: true }).click();
  await expect(projectFeed(page)).toBeVisible();
  await page.goBack();
  await expect(page.locator('#project-view-tasks')).toBeVisible();
  await restoredTimeline();
  await page.goForward();
  await expect(projectFeed(page)).toBeVisible();
  await tabs.getByRole('tab', { name: 'Задачи', exact: true }).click();
  await restoredTimeline();
  await page
    .getByLabel('Масштаб Ганта', { exact: true })
    .selectOption('months');
  await page.getByRole('button', { name: 'Следующий период' }).click();
  await expect.poll(period).not.toEqual(selectedPeriod);
  const manualPeriod = await period();
  await page.locator('[data-plan-scroll]').evaluate((node) => {
    node.scrollTop = 475;
  });
  await page.locator('.timeline-time').evaluate((node) => {
    node.scrollLeft = 230;
  });
  const manualAxes = await page.evaluate(() => ({
    top: document.querySelector('[data-plan-scroll]')!.scrollTop,
    left: document.querySelector('.timeline-time')!.scrollLeft,
  }));
  expect(manualAxes.top).toBeGreaterThan(0);
  expect(manualAxes.left).toBeGreaterThan(0);
  expect(manualAxes).not.toEqual({ top: before.top, left: before.left });
  const preservedManualTimeline = async () => {
    await expect(page.getByLabel('Масштаб Ганта', { exact: true })).toHaveValue(
      'months',
    );
    await expect.poll(period).toEqual(manualPeriod);
    await expect
      .poll(() =>
        page.locator('[data-plan-scroll]').evaluate((node) => node.scrollTop),
      )
      .toBe(manualAxes.top);
    await expect
      .poll(() =>
        page.locator('.timeline-time').evaluate((node) => node.scrollLeft),
      )
      .toBe(manualAxes.left);
  };
  for (let index = 0; index < 2; index++) {
    await tabs.getByRole('tab', { name: 'Журнал', exact: true }).click();
    await expect(projectFeed(page)).toBeVisible();
    await tabs.getByRole('tab', { name: 'Задачи', exact: true }).click();
    await preservedManualTimeline();
  }
  await page.goBack();
  await expect(projectFeed(page)).toBeVisible();
  await page.goBack();
  await expect(page.locator('#project-view-tasks')).toBeVisible();
  await preservedManualTimeline();
  await page.goForward();
  await expect(projectFeed(page)).toBeVisible();
  await page.goForward();
  await expect(page.locator('#project-view-tasks')).toBeVisible();
  await preservedManualTimeline();
  await page.getByLabel('Поиск задач', { exact: true }).fill('');
  await expect(
    page.getByRole('button', { name: 'Раскрыть Без дат', exact: true }),
  ).toBeVisible();
  await page.getByRole('button', { name: 'Список', exact: true }).click();
  await tabs.getByRole('tab', { name: 'Журнал', exact: true }).click();
  await tabs.getByRole('tab', { name: 'Задачи', exact: true }).click();
  await expect(page.getByLabel('Масштаб Ганта', { exact: true })).toBeHidden();
  expect(
    planContent(await readTree(page, runtime.origin, tree.project.id)),
  ).toEqual(planContent(tree));
});

test('second client metadata rename/move/create keeps dirty planning baseline and coherent journal picker', async ({
  page,
  browser,
  runtime,
}) => {
  const {
    tree: initialTree,
    summaryId,
    deepId,
  } = await seedJournal(page, runtime);
  let tree = initialTree;
  const added = await createJournalEntry(
    page,
    runtime.origin,
    tree.project.id,
    deepId,
    0,
    'Прежний путь',
    '2026-10-10',
  );
  if (added.kind !== 'saved') throw new Error('Missing saved entry');
  await openProjectJournal(page, runtime.origin);
  await entryCard(page, added.entry.id)
    .getByRole('button', { name: 'Уровень 5', exact: true })
    .click();
  const panel = page.getByRole('complementary', {
    name: 'Задача',
    exact: true,
  });
  await panel.getByRole('tab', { name: 'Задача', exact: true }).click();
  await panel
    .getByRole('button', { name: /Добавить описание|Изменить описание/ })
    .click();
  await panel
    .getByLabel('Описание', { exact: true })
    .fill('Локальный плановый черновик');
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
    tree = await send(remote, runtime.origin, tree, {
      type: 'task.edit',
      taskId: deepId,
      changes: {
        title: 'Переименована',
        description: 'Удалённая сохранённая версия',
      },
    });
    tree = await send(remote, runtime.origin, tree, {
      type: 'task.move',
      taskId: deepId,
      parentId: summaryId,
      position: 0,
    });
    tree = await send(remote, runtime.origin, tree, {
      type: 'task.create',
      parentId: summaryId,
      title: 'Новая работа',
    });
    const newId = tree.tasks.find((t) => t.title === 'Новая работа')!.id;
    await createJournalEntry(
      remote,
      runtime.origin,
      tree.project.id,
      newId,
      1,
      'Новое событие',
      '2026-10-11',
    );
    await page.evaluate(() => window.dispatchEvent(new Event('focus')));
    await expect(
      projectFeed(page).getByRole('button', {
        name: 'Переименована',
        exact: true,
      }),
    ).toBeVisible();
    await expect(
      projectFeed(page).getByRole('button', {
        name: 'Новая работа',
        exact: true,
      }),
    ).toBeVisible();
    await expect(panel.getByLabel('Описание', { exact: true })).toHaveValue(
      'Локальный плановый черновик',
    );
    await expect(
      panel.getByRole('heading', { name: 'Уровень 5', exact: true }),
    ).toBeVisible();
    await projectFeed(page)
      .getByRole('button', { name: 'Добавить запись', exact: true })
      .click();
    const modal = page.getByRole('region', { name: 'Новая запись журнала' });
    await modal
      .getByRole('button', { name: 'Выбрать задачу', exact: true })
      .click();
    await expect(
      modal.getByRole('option', {
        name: 'Этап P / Переименована',
        exact: true,
      }),
    ).toBeVisible();
    await expect(
      modal.getByRole('option', { name: 'Этап P / Новая работа', exact: true }),
    ).toBeVisible();
    await modal.getByRole('combobox').press('Escape');
    await page.keyboard.press('Escape');
    // Original baseline must conflict instead of silently overwriting remote planning.
    await panel.getByRole('button', { name: 'Сохранить', exact: true }).click();
    await expect(panel.getByRole('alert')).toBeVisible();
    expect(
      (await readTree(remote, runtime.origin, tree.project.id)).tasks.find(
        (t) => t.id === deepId,
      )?.description,
    ).toBe('Удалённая сохранённая версия');
  } finally {
    await context.close();
  }
});

test('metadata error and actual page/tree race retain safe state then converge without plan writes', async ({
  page,
  runtime,
}) => {
  const { tree: initialTree, deepId } = await seedJournal(page, runtime);
  let tree = initialTree;
  const added = await createJournalEntry(
    page,
    runtime.origin,
    tree.project.id,
    deepId,
    0,
    'Согласованная запись',
    '2026-10-10',
  );
  if (added.kind !== 'saved') throw new Error('Missing saved entry');
  await openProjectJournal(page, runtime.origin);
  await page.route(`**/api/projects/${tree.project.id}/tree`, async (route) => {
    await route.abort('failed');
  });
  tree = await send(page, runtime.origin, tree, {
    type: 'task.edit',
    taskId: deepId,
    changes: { title: 'После ошибки' },
  });
  await page.evaluate(() => window.dispatchEvent(new Event('focus')));
  await expect(projectFeed(page).getByRole('alert')).toBeVisible();
  await expect(
    entryCard(page, added.entry.id).getByRole('button', {
      name: 'Уровень 5',
      exact: true,
    }),
  ).toBeDisabled();
  await expect(
    projectFeed(page).getByRole('button', {
      name: 'Добавить запись',
      exact: true,
    }),
  ).toBeDisabled();
  await page.unroute(`**/api/projects/${tree.project.id}/tree`);
  let delayed = false;
  await page.route(
    `**/api/projects/${tree.project.id}/journal`,
    async (route) => {
      if (!delayed && route.request().method() === 'GET') {
        delayed = true;
        const response = await route.fetch();
        tree = await send(page, runtime.origin, tree, {
          type: 'task.edit',
          taskId: deepId,
          changes: { title: 'Результат гонки' },
        });
        await route.fulfill({ response });
      } else await route.continue();
    },
  );
  await projectFeed(page)
    .getByRole('button', { name: 'Повторить загрузку' })
    .click();
  await expect(
    projectFeed(page).getByRole('button', {
      name: 'Результат гонки',
      exact: true,
    }),
  ).toBeVisible();
  expect(
    (await readJournalPage(page, runtime.origin, tree.project.id))
      .projectRevision,
  ).toBe(tree.project.revision);
  expect(
    planContent(await readTree(page, runtime.origin, tree.project.id)),
  ).toEqual(planContent(tree));
});

test('dirty planning refuses Back without history displacement; project defaults and reload validate visit URLs', async ({
  page,
  runtime,
}) => {
  const { tree, summaryId } = await seedJournal(page, runtime);
  await createJournalEntry(
    page,
    runtime.origin,
    tree.project.id,
    summaryId,
    0,
    'История посещения',
    '2026-10-10',
  );
  const created = await page.request.post(`${runtime.origin}/api/projects`, {
    headers: { Origin: runtime.origin, 'X-Leaf-Contract-Version': '2' },
    data: { title: 'Другой синтетический проект' },
  });
  expect(created.status()).toBe(201);
  await openProjectJournal(page, runtime.origin);
  await projectFeed(page)
    .getByRole('button', { name: 'Этап P', exact: true })
    .click();
  const panel = page.getByRole('complementary', {
    name: 'Задача',
    exact: true,
  });
  await panel.getByRole('tab', { name: 'Задача', exact: true }).click();
  await panel
    .getByRole('button', { name: /Добавить описание|Изменить описание/ })
    .click();
  await panel
    .getByLabel('Описание', { exact: true })
    .fill('Грязный план защищён');
  const dirtyUrl = page.url();
  await page.goBack();
  await expect(
    page.getByRole('dialog', { name: 'Несохранённые изменения задачи' }),
  ).toBeVisible();
  await expect.poll(() => page.url()).toBe(dirtyUrl);
  await page.getByRole('button', { name: 'Продолжить редактирование' }).click();
  await expect(panel.getByLabel('Описание', { exact: true })).toHaveValue(
    'Грязный план защищён',
  );
  await panel.getByLabel('Описание', { exact: true }).fill('');
  await panel.getByRole('button', { name: 'Закрыть панель' }).click();
  await page
    .getByRole('button', { name: 'Другой синтетический проект', exact: true })
    .click();
  await expect(page.locator('#project-view-tasks')).toBeVisible();
  await page.goBack();
  await expect(projectFeed(page)).toBeVisible();
  await page.reload();
  await expect(projectFeed(page)).toBeVisible();
  await page.goto(
    `${runtime.origin}/?project=${tree.project.id}&view=bogus&task=invalid&panel=journal`,
  );
  await expect(page.locator('#project-view-tasks')).toBeVisible();
  await expect(
    page.getByRole('complementary', { name: 'Задача', exact: true }),
  ).toHaveCount(0);
  expect(
    (await readTree(page, runtime.origin, tree.project.id)).project.revision,
  ).toBe(tree.project.revision);
});

test('125-entry hidden focus refresh restores deep journal anchor through tabs, history and later manual scroll', async ({
  page,
  runtime,
}) => {
  const { tree, summaryId } = await seedJournal(page, runtime);
  for (let revision = 0; revision < 125; revision++)
    await createJournalEntry(
      page,
      runtime.origin,
      tree.project.id,
      summaryId,
      revision,
      `Синтетическая запись ${revision}\nСтрока журнала`,
      '2026-10-10',
    );
  await openProjectJournal(page, runtime.origin);
  const feed = projectFeed(page).locator('[data-journal-scroll]');
  const cards = feed.locator('[data-journal-entry-id]');
  for (const count of [100, 125]) {
    await projectFeed(page)
      .getByRole('button', { name: 'Показать ещё' })
      .click();
    await expect(cards).toHaveCount(count);
  }
  await cards.nth(105).evaluate((node) => {
    const scroll = node.closest<HTMLElement>('[data-journal-scroll]')!;
    scroll.scrollTop +=
      node.getBoundingClientRect().top -
      scroll.getBoundingClientRect().top +
      17;
  });
  const before = await journalGeometry(page);
  expect(before.id).toBe(
    await cards.nth(105).getAttribute('data-journal-entry-id'),
  );
  expect(await feed.evaluate((node) => node.scrollTop)).toBeGreaterThan(0);
  const tabs = page.getByRole('tablist', { name: 'Представление проекта' });
  const restored = async (
    saved: Awaited<ReturnType<typeof journalGeometry>>,
  ) => {
    await expect
      .poll(async () => (await journalGeometry(page)).id)
      .toBe(saved.id);
    const actual = await journalGeometry(page);
    expect(Math.abs(actual.offset - saved.offset)).toBeLessThan(0.1);
    expect({ ...actual, offset: 0 }).toEqual({ ...saved, offset: 0 });
  };
  await tabs.getByRole('tab', { name: 'Задачи', exact: true }).click();
  const refreshed = page.waitForResponse(
    (response) =>
      response.request().method() === 'GET' &&
      response.url() ===
        `${runtime.origin}/api/projects/${tree.project.id}/journal`,
  );
  await page.evaluate(() => window.dispatchEvent(new Event('focus')));
  expect((await refreshed).status()).toBe(200);
  await expect(cards).toHaveCount(50);
  expect(
    await feed.evaluate((node) => node.getBoundingClientRect().height),
  ).toBe(0);
  await tabs.getByRole('tab', { name: 'Журнал', exact: true }).click();
  await expect(cards).toHaveCount(125);
  await restored(before);
  await page.goBack();
  await expect(page.locator('#project-view-tasks')).toBeVisible();
  await page.goBack();
  await expect(projectFeed(page)).toBeVisible();
  await restored(before);
  await cards.nth(75).evaluate((node) => {
    const scroll = node.closest<HTMLElement>('[data-journal-scroll]')!;
    scroll.scrollTop +=
      node.getBoundingClientRect().top -
      scroll.getBoundingClientRect().top +
      23;
  });
  const manual = await journalGeometry(page);
  expect(manual.id).toBe(
    await cards.nth(75).getAttribute('data-journal-entry-id'),
  );
  expect(manual.id).not.toBe(before.id);
  for (let iteration = 0; iteration < 2; iteration++) {
    await tabs.getByRole('tab', { name: 'Задачи', exact: true }).click();
    await tabs.getByRole('tab', { name: 'Журнал', exact: true }).click();
    await restored(manual);
  }
  await page.goBack();
  await expect(page.locator('#project-view-tasks')).toBeVisible();
  await page.goForward();
  await expect(projectFeed(page)).toBeVisible();
  await restored(manual);
});

for (const decision of [
  'Сохранить',
  'Не сохранять',
  'Продолжить редактирование',
]) {
  test(`history absent from RAM after reload keeps task and URL coherent: ${decision}`, async ({
    page,
    runtime,
  }) => {
    const { tree, deepId } = await seedJournal(page, runtime);
    const first = tree.tasks.find((task) => task.title === 'Без дат')!;
    await page.goto(runtime.origin);
    await page
      .locator(`[role="treeitem"][data-task-id="${first.id}"]`)
      .first()
      .click();
    await page
      .locator(`[role="treeitem"][data-task-id="${deepId}"]`)
      .first()
      .click();
    await expect
      .poll(() => new URL(page.url()).searchParams.get('task'))
      .toBe(deepId);
    await page.reload();
    const panel = page.getByRole('complementary', {
      name: 'Задача',
      exact: true,
    });
    await expect(
      panel.getByRole('heading', { name: 'Уровень 5', exact: true }),
    ).toBeVisible();
    await panel.getByRole('button', { name: 'Изменить название' }).click();
    const editor = panel.getByLabel('Название задачи', { exact: true });
    await editor.fill('Черновик неизвестного перехода');
    const priorUrl = page.url();
    const priorId = await page.evaluate(
      () => window.history.state.leaf.visitId as string,
    );
    let commands = 0;
    page.on('request', (request) => {
      if (request.method() === 'POST' && request.url().endsWith('/commands'))
        commands++;
    });
    await page.goBack();
    const dialog = page.getByRole('dialog', {
      name: 'Несохранённые изменения задачи',
    });
    await expect(dialog).toBeVisible();
    await expect(page).toHaveURL(priorUrl);
    await dialog.getByRole('button', { name: decision, exact: true }).click();
    if (decision === 'Продолжить редактирование') {
      await expect(editor).toHaveValue('Черновик неизвестного перехода');
      await expect(page).toHaveURL(priorUrl);
      expect(commands).toBe(0);
      await panel.getByRole('button', { name: 'Сбросить изменения' }).click();
      await page.goForward();
      await expect(
        panel.getByRole('heading', { name: 'Уровень 5', exact: true }),
      ).toBeVisible();
      await expect
        .poll(() => new URL(page.url()).searchParams.get('task'))
        .toBe(deepId);
      await expect
        .poll(() =>
          page.evaluate(() => window.history.state.leaf.visitId as string),
        )
        .not.toBe(priorId);
      await page.reload();
      await expect(
        panel.getByRole('heading', { name: 'Уровень 5', exact: true }),
      ).toBeVisible();
      return;
    }
    await expect(
      panel.getByRole('heading', { name: 'Без дат', exact: true }),
    ).toBeVisible();
    await expect
      .poll(() => new URL(page.url()).searchParams.get('task'))
      .toBe(first.id);
    await expect
      .poll(() =>
        page.evaluate(() => window.history.state.leaf.visitId as string),
      )
      .not.toBe(priorId);
    expect(commands).toBe(decision === 'Сохранить' ? 1 : 0);
    await page.reload();
    await expect(
      panel.getByRole('heading', { name: 'Без дат', exact: true }),
    ).toBeVisible();
    await page.goForward();
    await expect(
      panel.getByRole('heading', {
        name:
          decision === 'Сохранить'
            ? 'Черновик неизвестного перехода'
            : 'Уровень 5',
        exact: true,
      }),
    ).toBeVisible();
    await expect
      .poll(() => new URL(page.url()).searchParams.get('task'))
      .toBe(deepId);
    await expect
      .poll(() =>
        page.evaluate(() => window.history.state.leaf.visitId as string),
      )
      .not.toBe(priorId);
    await page.goBack();
    await expect(
      panel.getByRole('heading', { name: 'Без дат', exact: true }),
    ).toBeVisible();
    await expect
      .poll(() => new URL(page.url()).searchParams.get('task'))
      .toBe(first.id);
    await expect
      .poll(() =>
        page.evaluate(() => window.history.state.leaf.visitId as string),
      )
      .not.toBe(priorId);
    await page.reload();
    await expect(
      panel.getByRole('heading', { name: 'Без дат', exact: true }),
    ).toBeVisible();
    expect(commands).toBe(decision === 'Сохранить' ? 1 : 0);
  });
}

test('unknown history cancellation invalidates earlier RAM indices before another dirty Back', async ({
  page,
  runtime,
}) => {
  const { tree, deepId } = await seedJournal(page, runtime);
  const first = tree.tasks.find((task) => task.title === 'Без дат')!;
  const last = tree.tasks.find((task) => task.title === 'Работа C')!;
  await page.goto(runtime.origin);
  await page
    .locator(`[role="treeitem"][data-task-id="${first.id}"]`)
    .first()
    .click();
  await page
    .locator(`[role="treeitem"][data-task-id="${deepId}"]`)
    .first()
    .click();
  await expect
    .poll(() => new URL(page.url()).searchParams.get('task'))
    .toBe(deepId);
  await page.reload();
  const panel = page.getByRole('complementary', {
    name: 'Задача',
    exact: true,
  });
  await expect(
    panel.getByRole('heading', { name: 'Уровень 5', exact: true }),
  ).toBeVisible();
  await page
    .locator(`[role="treeitem"][data-task-id="${last.id}"]`)
    .first()
    .click();
  await expect(
    panel.getByRole('heading', { name: 'Работа C', exact: true }),
  ).toBeVisible();
  await panel.getByRole('button', { name: 'Изменить название' }).click();
  await panel
    .getByLabel('Название задачи', { exact: true })
    .fill('Черновик последней задачи');
  const lastUrl = page.url();
  let commands = 0;
  page.on('request', (request) => {
    if (request.method() === 'POST' && request.url().endsWith('/commands'))
      commands++;
  });
  await page.evaluate(() => window.history.go(-2));
  const dialog = page.getByRole('dialog', {
    name: 'Несохранённые изменения задачи',
  });
  await expect(dialog).toBeVisible();
  await dialog
    .getByRole('button', { name: 'Продолжить редактирование' })
    .click();
  await expect(page).toHaveURL(lastUrl);
  await expect(
    panel.getByLabel('Название задачи', { exact: true }),
  ).toHaveValue('Черновик последней задачи');
  await panel.getByRole('button', { name: 'Сбросить изменения' }).click();
  await page.goForward();
  await expect(
    panel.getByRole('heading', { name: 'Уровень 5', exact: true }),
  ).toBeVisible();
  const middleUrl = page.url();
  await panel.getByRole('button', { name: 'Изменить название' }).click();
  await panel
    .getByLabel('Название задачи', { exact: true })
    .fill('Черновик средней задачи');
  await page.goBack();
  await expect(dialog).toBeVisible();
  await dialog
    .getByRole('button', { name: 'Продолжить редактирование' })
    .click();
  await expect(page).toHaveURL(middleUrl);
  await expect(
    panel.getByLabel('Название задачи', { exact: true }),
  ).toHaveValue('Черновик средней задачи');
  expect(commands).toBe(0);
  await panel.getByRole('button', { name: 'Сбросить изменения' }).click();
  await page.reload();
  await expect(
    panel.getByRole('heading', { name: 'Уровень 5', exact: true }),
  ).toBeVisible();
  await expect(page).toHaveURL(middleUrl);
});
