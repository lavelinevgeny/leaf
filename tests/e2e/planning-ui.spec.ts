import {
  test as base,
  expect,
  type Page,
  type Locator,
} from '@playwright/test';
import { randomUUID } from 'node:crypto';
import { syntheticRuntime } from '../../scripts/e2e-server.js';
import type { Command, ProjectTree } from '../../src/shared/contracts.js';
const test = base.extend<{
  runtime: Awaited<ReturnType<typeof syntheticRuntime>>;
}>({
  runtime: async ({}, use) => {
    const runtime = await syntheticRuntime();
    try {
      await use(runtime);
    } finally {
      await runtime.close();
    }
  },
});
async function read(
  page: Page,
  origin: string,
  id: string,
): Promise<ProjectTree> {
  const response = await page.request.get(`${origin}/api/projects/${id}/tree`);
  expect(response.status()).toBe(200);
  return response.json();
}
async function send(
  page: Page,
  origin: string,
  tree: ProjectTree,
  command: Command,
): Promise<ProjectTree> {
  const response = await page.request.post(
    `${origin}/api/projects/${tree.project.id}/commands`,
    {
      headers: { Origin: origin },
      data: {
        expectedRevision: tree.project.revision,
        operationId: randomUUID(),
        command,
      },
    },
  );
  expect(response.status()).toBe(200);
  return response.json();
}
async function seed(
  page: Page,
  runtime: Awaited<ReturnType<typeof syntheticRuntime>>,
  planned = false,
) {
  await page.goto(runtime.origin);
  await page.getByLabel('Пароль', { exact: true }).fill(runtime.password);
  await page.getByRole('button', { name: 'Войти', exact: true }).click();
  await expect(
    page.getByRole('button', { name: 'Новый проект' }),
  ).toBeVisible();
  const response = await page.request.post(`${runtime.origin}/api/projects`, {
    headers: { Origin: runtime.origin },
    data: { title: 'Демо-проект Ганта' },
  });
  expect(response.status()).toBe(201);
  let tree = await read(
    page,
    runtime.origin,
    ((await response.json()) as { id: string }).id,
  );
  tree = await send(page, runtime.origin, tree, {
    type: 'task.create',
    title: 'Этап',
    parentId: null,
  });
  const summaryId = tree.tasks[0]!.id;
  for (const title of ['A', 'B', 'C', 'D', 'Без дат', 'Пометка'])
    tree = await send(page, runtime.origin, tree, {
      type: 'task.create',
      title,
      parentId: summaryId,
    });
  const ids = Object.fromEntries(
    tree.tasks.map((task) => [task.title, task.id]),
  );
  tree = await send(page, runtime.origin, tree, {
    type: 'task.update',
    taskId: ids['Пометка']!,
    changes: { inputFinish: '2026-10-16' },
  });
  if (planned) {
    tree = await send(page, runtime.origin, tree, {
      type: 'project.schedule',
      changes: { startDate: '2026-10-05', calendarType: 'all-days' },
    });
    for (const [title, durationDays] of [
      ['A', 2],
      ['B', 5],
      ['C', 3],
      ['D', 1],
    ] as const)
      tree = await send(page, runtime.origin, tree, {
        type: 'task.plan',
        taskId: ids[title]!,
        plan: { mode: 'auto', durationDays },
      });
    for (const [from, to] of [
      ['A', 'B'],
      ['B', 'D'],
      ['C', 'D'],
    ])
      tree = await send(page, runtime.origin, tree, {
        type: 'dependency.create',
        predecessorId: ids[from!]!,
        successorId: ids[to!]!,
      });
  }
  await page.reload();
  await expect(
    page.getByRole('heading', { name: 'Демо-проект Ганта' }),
  ).toBeVisible();
  return { tree, ids };
}
const mainTree = (page: Page) =>
  page.getByRole('tree', { name: 'Задачи', exact: true });
async function openTask(page: Page, title: string) {
  await mainTree(page)
    .getByRole('treeitem', { name: new RegExp(`^${title},`) })
    .click();
}
async function save(page: Page) {
  await page.getByRole('button', { name: 'Сохранить', exact: true }).click();
  await expect(page.getByText('Сохранено', { exact: true })).toBeVisible();
}
async function close(page: Page) {
  await page.getByRole('button', { name: 'Закрыть панель' }).click();
  await expect(
    page.getByRole('complementary', { name: 'Задача', exact: true }),
  ).toHaveCount(0);
}
async function drag(
  page: Page,
  locator: Locator,
  delta: number,
  cancel = false,
) {
  const box = (await locator.boundingBox())!;
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width / 2 + delta, box.y + box.height / 2, {
    steps: 8,
  });
  if (cancel) await page.keyboard.press('Escape');
  await page.mouse.up();
}
test('UI plans branches, switches the critical path, undoes once and renders the approved neighbor graph', async ({
  page,
  runtime,
}, testInfo) => {
  const { tree: seeded, ids } = await seed(page, runtime);
  const projectId = seeded.project.id;
  await expect(page.locator('[data-gantt-bar]')).toHaveCount(0);
  await expect(page.locator('[data-gantt-note]')).toHaveCount(1);
  await page.getByText('План проекта', { exact: true }).click();
  await page.getByLabel('Начало проекта').fill('2026-10-05');
  await page.getByLabel('Календарь', { exact: true }).selectOption('all-days');
  await page.getByLabel('Часовой пояс проекта').fill('Europe/Moscow');
  await page.getByRole('button', { name: 'Сохранить план проекта' }).click();
  await expect(
    page.getByRole('button', { name: 'Сохранить план проекта' }),
  ).toBeDisabled();
  await page.getByText('План проекта', { exact: true }).click();
  for (const [title, days] of [
    ['A', 2],
    ['B', 5],
    ['C', 3],
    ['D', 1],
  ] as const) {
    await openTask(page, title);
    await page.getByLabel('Режим планирования').selectOption('auto');
    await page.getByLabel('Длительность, рабочих дней').fill(String(days));
    await save(page);
    await close(page);
  }
  for (const [selected, predecessor] of [
    ['B', 'A'],
    ['D', 'B'],
    ['D', 'C'],
  ]) {
    await openTask(page, selected!);
    await page.getByRole('tab', { name: 'Зависимости', exact: true }).click();
    await page.getByLabel('Поиск работы для связи').fill(predecessor!);
    await page
      .getByLabel('Работа для связи')
      .selectOption({ label: predecessor! });
    await page.getByRole('button', { name: 'Добавить зависимость' }).click();
    await expect(
      page.getByRole('button', { name: `Открыть: ${predecessor}` }),
    ).toBeVisible();
    await close(page);
  }
  const original = await read(page, runtime.origin, projectId);
  expect(original.schedule.projectFinishIndex).toBe(8);
  expect(original.schedule.criticalTaskIds.toSorted()).toEqual(
    [ids.A, ids.B, ids.D].toSorted(),
  );
  await openTask(page, 'C');
  await page.getByLabel('Название задачи').fill('C длинная ветвь');
  await page.getByLabel('Длительность, рабочих дней').fill('9');
  await save(page);
  let changed = await read(page, runtime.origin, projectId);
  expect(changed.project.revision).toBe(original.project.revision + 1);
  expect(changed.schedule.projectFinishIndex).toBe(10);
  expect(changed.schedule.criticalTaskIds.toSorted()).toEqual(
    [ids.C, ids.D].toSorted(),
  );
  expect(changed.schedule.summaries[ids['Этап']!]!.finish).toBe(10);
  await expect(
    page.locator(`[data-gantt-bar="${ids.C}"]`).locator('..'),
  ).toHaveClass(/critical/);
  await page.locator('.panel-content').evaluate((node) => {
    node.scrollTop = 0;
  });
  await page.screenshot({
    path: testInfo.outputPath(`synthetic-details-${testInfo.project.name}.png`),
  });
  console.log(
    `Synthetic details screenshot: ${testInfo.outputPath(`synthetic-details-${testInfo.project.name}.png`)}`,
  );
  await close(page);
  await page.screenshot({
    path: testInfo.outputPath(`synthetic-gantt-${testInfo.project.name}.png`),
  });
  console.log(
    `Synthetic Gantt screenshot: ${testInfo.outputPath(`synthetic-gantt-${testInfo.project.name}.png`)}`,
  );
  await page
    .getByRole('button', { name: 'Отменить последнее изменение' })
    .click();
  await expect
    .poll(
      async () =>
        (await read(page, runtime.origin, projectId)).schedule
          .projectFinishIndex,
    )
    .toBe(8);
  changed = await read(page, runtime.origin, projectId);
  expect(changed.tasks).toEqual(original.tasks);
  expect(changed.schedule).toEqual(original.schedule);
  await openTask(page, 'D');
  await page.getByRole('tab', { name: 'Зависимости', exact: true }).click();
  await expect(page.locator('[data-dependency-edge]')).toHaveCount(2);
  await page.getByLabel('Направление связи').selectOption('successor');
  await page.getByLabel('Поиск работы для связи').fill('A');
  await expect(
    page.getByText('Цикл зависимостей: D → A → B → D'),
  ).toBeVisible();
  await expect(
    page.getByRole('button', { name: 'Добавить зависимость' }),
  ).toBeDisabled();
  expect((await read(page, runtime.origin, projectId)).project.revision).toBe(
    changed.project.revision,
  );
  await page.getByRole('button', { name: 'Открыть: B' }).click();
  await expect(
    page.getByRole('heading', { name: 'B', exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole('tab', { name: 'Зависимости', exact: true }),
  ).toHaveAttribute('aria-selected', 'true');
  await page.getByRole('button', { name: 'Назад: D' }).click();
  await expect(
    page.getByRole('heading', { name: 'D', exact: true }),
  ).toBeVisible();
  await mainTree(page).getByRole('button', { name: 'Свернуть Этап' }).click();
  await expect(page.locator('[data-gantt-row]')).toHaveCount(1);
  await page.getByRole('button', { name: 'Показать на Ганте' }).click();
  await expect(
    mainTree(page).getByRole('treeitem', { name: /^D,/ }),
  ).toBeVisible();
  await expect(page.locator('[data-gantt-row]')).toHaveCount(7);
  await page.screenshot({
    path: testInfo.outputPath(
      `synthetic-planning-${testInfo.project.name}.png`,
    ),
  });
  console.log(
    `Synthetic planning screenshot: ${testInfo.outputPath(`synthetic-planning-${testInfo.project.name}.png`)}`,
  );
  await page.getByRole('button', { name: 'Удалить связь: C' }).click();
  await expect(page.locator('[data-dependency-edge]')).toHaveCount(1);
  expect((await read(page, runtime.origin, projectId)).tasks).toHaveLength(7);
  await close(page);
  await page
    .getByRole('button', { name: 'Отменить последнее изменение' })
    .click();
  await expect
    .poll(
      async () =>
        (await read(page, runtime.origin, projectId)).dependencies.length,
    )
    .toBe(3);
  const saved = await read(page, runtime.origin, projectId);
  await runtime.restart();
  await page.reload();
  await expect(
    mainTree(page).getByRole('treeitem', { name: /^D,/ }),
  ).toBeVisible();
  const reopened = await read(page, runtime.origin, projectId);
  expect(reopened.tasks).toEqual(saved.tasks);
  expect(reopened.dependencies).toEqual(saved.dependencies);
  expect(reopened.schedule).toEqual(saved.schedule);
});

test('Gantt drag, resize, cancel, keyboard and one undo agree with the persisted server plan', async ({
  page,
  runtime,
}) => {
  const { tree: original, ids } = await seed(page, runtime, true);
  const projectId = original.project.id;
  const resize = page.locator(`[data-gantt-resize="${ids.C}"]`);
  await drag(page, resize, 180);
  await expect
    .poll(
      async () =>
        (await read(page, runtime.origin, projectId)).schedule
          .projectFinishIndex,
    )
    .toBe(10);
  let current = await read(page, runtime.origin, projectId);
  expect(current.project.revision).toBe(original.project.revision + 1);
  expect(current.tasks.find((task) => task.id === ids.C)!.durationDays).toBe(9);
  await page
    .getByRole('button', { name: 'Отменить последнее изменение' })
    .click();
  await expect
    .poll(
      async () =>
        (await read(page, runtime.origin, projectId)).schedule
          .projectFinishIndex,
    )
    .toBe(8);
  const beforeCancel = await read(page, runtime.origin, projectId);
  await drag(page, page.locator(`[data-gantt-bar="${ids.C}"]`), 60, true);
  expect((await read(page, runtime.origin, projectId)).project.revision).toBe(
    beforeCancel.project.revision,
  );
  await drag(page, page.locator(`[data-gantt-bar="${ids.C}"]`), 60);
  await expect
    .poll(
      async () =>
        (await read(page, runtime.origin, projectId)).tasks.find(
          (task) => task.id === ids.C,
        )!.notBefore,
    )
    .toBe('2026-10-07');
  current = await read(page, runtime.origin, projectId);
  expect(current.project.revision).toBe(beforeCancel.project.revision + 1);
  await expect(
    page.locator(`[data-gantt-bar="${ids.D}"]`).locator('..'),
  ).toHaveAttribute('aria-disabled', 'false');
  await drag(page, page.locator(`[data-gantt-bar="${ids.D}"]`), -60);
  await expect
    .poll(
      async () =>
        (await read(page, runtime.origin, projectId)).tasks.find(
          (task) => task.id === ids.D,
        )!.notBefore,
    )
    .toBe('2026-10-10');
  await expect(
    page.getByText(/Начало осталось на допустимой дате/),
  ).toBeVisible();
  expect(
    (await read(page, runtime.origin, projectId)).schedule.tasks[ids.D!]!
      .startDate,
  ).toBe('2026-10-12');
  const bar = page.locator(`[data-gantt-bar="${ids.C}"]`).locator('..');
  await bar.focus();
  await page.keyboard.press('Shift+ArrowRight');
  await expect
    .poll(
      async () =>
        (await read(page, runtime.origin, projectId)).tasks.find(
          (task) => task.id === ids.C,
        )!.durationDays,
    )
    .toBe(4);
  await page.getByLabel('Масштаб Ганта').selectOption('weeks');
  await expect(page.locator('.gantt-svg')).toHaveAttribute('width', '2520');
  await page.getByLabel('Масштаб Ганта').selectOption('months');
  await expect(page.locator('.gantt-svg')).toHaveAttribute('width', '2196');
  await page.getByRole('separator', { name: 'Ширина дерева' }).focus();
  await page.keyboard.press('ArrowRight');
  await expect(
    page.getByRole('separator', { name: 'Ширина дерева' }),
  ).toHaveAttribute('aria-valuenow', '440');
  const treeRow = (await mainTree(page)
    .getByRole('treeitem', { name: /^C,/ })
    .boundingBox())!;
  const ganttRowY = await page
    .locator(`[data-gantt-row="${ids.C}"] > rect`)
    .evaluate((node) => node.getBoundingClientRect().y);
  expect(Math.abs(treeRow.y - ganttRowY)).toBeLessThan(1);
  let large = await read(page, runtime.origin, projectId);
  const criticalBefore = large.schedule.criticalTaskIds;
  for (let index = 0; index < 30; index++)
    large = await send(page, runtime.origin, large, {
      type: 'task.create',
      title: `Пустая ${index}`,
      parentId: null,
    });
  expect(large.schedule.criticalTaskIds).toEqual(criticalBefore);
  await page.reload();
  await expect(
    mainTree(page).getByRole('treeitem', { name: /^Пустая 20,/ }),
  ).toBeAttached();
  await page.locator('[data-plan-scroll]').evaluate((node) => {
    node.scrollTop = 800;
  });
  const visible = mainTree(page).getByRole('treeitem', { name: /^Пустая 20,/ });
  await expect(visible).toBeInViewport();
  const row = (await visible.boundingBox())!;
  const largeId = large.tasks.find((task) => task.title === 'Пустая 20')!.id;
  const rightY = await page
    .locator(`[data-gantt-row="${largeId}"] > rect`)
    .evaluate((node) => node.getBoundingClientRect().y);
  expect(Math.abs(row.y - rightY)).toBeLessThan(1);
  await expect(
    page.locator(`[data-gantt-row="${largeId}"] [data-gantt-bar]`),
  ).toHaveCount(0);
});

test('Fixed, deadline, incomplete and completed states remain explicit and invalid dates preserve the draft', async ({
  page,
  runtime,
}) => {
  const { tree: original, ids } = await seed(page, runtime, true);
  const projectId = original.project.id;
  await page.getByText('План проекта', { exact: true }).click();
  await page.getByLabel('Календарь', { exact: true }).selectOption('weekdays');
  await page.getByRole('button', { name: 'Сохранить план проекта' }).click();
  await expect(
    page.getByRole('button', { name: 'Сохранить план проекта' }),
  ).toBeDisabled();
  await page.getByText('План проекта', { exact: true }).click();
  await openTask(page, 'B');
  await page.getByLabel('Режим планирования').selectOption('fixed');
  await expect(page.getByLabel('Начало', { exact: true })).toHaveValue(
    '2026-10-07',
  );
  await expect(page.getByLabel('Окончание', { exact: true })).toHaveValue(
    '2026-10-13',
  );
  await save(page);
  const fixed = await read(page, runtime.origin, projectId);
  await page.getByLabel('Начало', { exact: true }).fill('2026-10-10');
  await page.getByRole('button', { name: 'Сохранить', exact: true }).click();
  await expect(page.getByRole('alert')).toContainText('Закреплённый интервал');
  await expect(page.getByLabel('Начало', { exact: true })).toHaveValue(
    '2026-10-10',
  );
  expect((await read(page, runtime.origin, projectId)).project.revision).toBe(
    fixed.project.revision,
  );
  await page
    .getByRole('button', { name: 'Отбросить изменения', exact: true })
    .click();
  await close(page);
  await openTask(page, 'A');
  await page.getByLabel('Длительность, рабочих дней').fill('5');
  await page.getByLabel('Дедлайн').fill('2026-10-06');
  await save(page);
  await close(page);
  await expect(page.getByText('Конфликт плана', { exact: true })).toBeVisible();
  await expect(
    page.getByText(/Плановое окончание позже дедлайна/),
  ).toBeVisible();
  await expect(
    page.getByText(/Предшественник заканчивается после закреплённого начала/),
  ).toBeVisible();
  const conflict = await read(page, runtime.origin, projectId);
  expect(conflict.schedule.criticalTaskIds).toEqual([]);
  expect(conflict.schedule.tasks[ids.B!]!.startDate).toBe('2026-10-07');
  await openTask(page, 'B');
  await page.getByLabel('Режим планирования').selectOption('auto');
  await expect(page.getByLabel('Длительность, рабочих дней')).toHaveValue('5');
  await save(page);
  await close(page);
  await expect(page.getByText('Конфликт плана', { exact: true })).toHaveCount(
    0,
  );
  await openTask(page, 'C');
  page.once('dialog', (dialog) => void dialog.accept());
  await page
    .getByRole('button', { name: 'Удалить планирование', exact: true })
    .click();
  await save(page);
  await close(page);
  await expect(
    page.getByText('Предварительный расчёт', { exact: true }),
  ).toBeVisible();
  await expect(page.locator(`[data-gantt-bar="${ids.D}"]`)).toHaveCount(0);
  await expect(
    mainTree(page).getByRole('treeitem', { name: /^Этап,/ }),
  ).toContainText('*');
  expect(
    (await read(page, runtime.origin, projectId)).schedule.tasks[ids.D!]!
      .blockedReason,
  ).toBe('BLOCKED_BY_UNKNOWN');
  await openTask(page, 'A');
  await page.getByLabel('Статус').selectOption('done');
  await save(page);
  await expect(page.getByLabel('Длительность, рабочих дней')).toBeDisabled();
  await expect(
    page.getByText('Верните завершённую задачу в работу перед планированием.', {
      exact: true,
    }),
  ).toBeVisible();
  await page.getByLabel('Статус').selectOption('doing');
  await expect(page.getByLabel('Длительность, рабочих дней')).toBeEnabled();
  await page.getByLabel('Длительность, рабочих дней').fill('6');
  await save(page);
  const resumed = await read(page, runtime.origin, projectId);
  expect(resumed.tasks.find((task) => task.id === ids.A)).toMatchObject({
    status: 'doing',
    durationDays: 6,
    completedStart: null,
    completedFinish: null,
  });
  await close(page);
});
