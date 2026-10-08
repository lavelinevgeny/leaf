import {
  test as base,
  expect,
  type Page,
  type Locator,
} from '@playwright/test';
import Database from 'better-sqlite3';
import { syntheticRuntime } from '../../scripts/e2e-server.js';
import { readTree, send } from '../helpers/optional-e2e.js';
import type { ProjectTree } from '../../src/shared/contracts.js';

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
type Runtime = Awaited<ReturnType<typeof syntheticRuntime>>;
async function project(page: Page, runtime: Runtime) {
  await page.goto(runtime.origin);
  await page.getByLabel('Пароль', { exact: true }).fill(runtime.password);
  await page.getByRole('button', { name: 'Войти', exact: true }).click();
  await expect(
    page.getByRole('button', { name: 'Новый проект', exact: true }),
  ).toBeVisible();
  const created = await page.request.post(`${runtime.origin}/api/projects`, {
    headers: { Origin: runtime.origin, 'X-Leaf-Contract-Version': '2' },
    data: { title: 'Демо FS' },
  });
  expect(created.status()).toBe(201);
  return readTree(page, runtime.origin, (await created.json()).id);
}
async function create(
  page: Page,
  runtime: Runtime,
  tree: ProjectTree,
  title: string,
  parentId: string | null = null,
  inputStart: string | null = null,
  inputFinish: string | null = null,
) {
  return send(page, runtime.origin, tree, {
    type: 'task.create',
    title,
    parentId,
    inputStart,
    inputFinish,
    durationDays: null,
  });
}
const taskId = (tree: ProjectTree, title: string) =>
  tree.tasks.find((t) => t.title === title)!.id;
const picker = (page: Page) =>
  page.getByRole('dialog', { name: 'После окончания', exact: true });
const panel = (page: Page) =>
  page.getByRole('complementary', { name: 'Задача', exact: true });
const row = (page: Page, id: string) =>
  page
    .getByRole('tree', { name: 'Задачи', exact: true })
    .locator(`[data-task-id="${id}"]`);
async function show(page: Page) {
  await page.reload();
  await page.getByRole('button', { name: 'Демо FS', exact: true }).click();
}
async function choose(page: Page, title: string) {
  const search = picker(page).getByRole('searchbox');
  await expect(search).toBeFocused();
  await search.fill(title);
  await search.press('ArrowDown');
  await search.press('Enter');
  await search.press('Escape');
}
async function save(page: Page, status = 200) {
  const response = page.waitForResponse(
    (r) => r.url().endsWith('/commands') && r.request().method() === 'POST',
  );
  await page.getByRole('button', { name: 'Сохранить', exact: true }).click();
  const result = await response;
  expect(result.status()).toBe(status);
  return result;
}
async function visibleWithin(inner: Locator, outer: Locator) {
  const a = await inner.boundingBox(),
    b = await outer.boundingBox();
  expect(a).not.toBeNull();
  expect(b).not.toBeNull();
  expect(a!.y).toBeGreaterThanOrEqual(b!.y - 1);
  expect(a!.y + a!.height).toBeLessThanOrEqual(b!.y + b!.height + 1);
}

test('quick create saves nullable task and FS in one revision and restores title focus', async ({
  page,
  runtime,
}) => {
  let tree = await project(page, runtime);
  tree = await create(
    page,
    runtime,
    tree,
    'A',
    null,
    '2026-10-07',
    '2026-10-09',
  );
  await show(page);
  const title = page.getByLabel('Новая задача', { exact: true });
  await title.fill('B');
  await title.press('Alt+l');
  const search = picker(page).getByRole('searchbox');
  await expect(search).toBeFocused();
  await search.fill('A');
  await search.press('Enter');
  await search.press('Escape');
  await page
    .getByRole('button', { name: 'Добавить задачу', exact: true })
    .click();
  await expect(row(page, taskId(tree, 'A'))).toBeVisible();
  await expect(title).toHaveValue('');
  await expect(title).toBeFocused();
  const current = await readTree(page, runtime.origin, tree.project.id);
  const b = current.tasks.find((t) => t.title === 'B')!;
  expect(b).toMatchObject({
    inputStart: null,
    inputFinish: null,
    durationDays: 1,
  });
  expect(current.project.revision).toBe(tree.project.revision + 1);
  expect(current.dependencies).toEqual([
    expect.objectContaining({
      predecessorId: taskId(tree, 'A'),
      successorId: b.id,
    }),
  ]);
});

test('subtask draft creates child plus edge atomically, retaining the main draft', async ({
  page,
  runtime,
}) => {
  let tree = await project(page, runtime);
  tree = await create(page, runtime, tree, 'P');
  tree = await create(page, runtime, tree, 'A');
  await show(page);
  const main = page.locator('#quick-task');
  await main.fill('Основной черновик');
  await row(page, taskId(tree, 'P')).click();
  await page.getByRole('tab', { name: 'Подзадачи', exact: true }).click();
  const quick = panel(page).getByLabel('Новая задача', { exact: true });
  await quick.fill('Ребёнок');
  await quick.press('Alt+l');
  await choose(page, 'A');
  await expect(
    panel(page).getByRole('button', {
      name: 'После окончания новой задачи',
      exact: true,
    }),
  ).toBeFocused();
  await panel(page)
    .getByRole('button', { name: 'Добавить задачу', exact: true })
    .click();
  await expect(quick).toHaveValue('');
  await expect(quick).toBeFocused();
  await expect(main).toHaveValue('Основной черновик');
  const current = await readTree(page, runtime.origin, tree.project.id),
    child = current.tasks.find((t) => t.title === 'Ребёнок')!;
  expect(current.project.revision).toBe(tree.project.revision + 1);
  expect(child).toMatchObject({
    parentId: taskId(tree, 'P'),
    inputStart: null,
    inputFinish: null,
    durationDays: 1,
  });
  expect(current.dependencies).toEqual([
    expect.objectContaining({
      predecessorId: taskId(tree, 'A'),
      successorId: child.id,
    }),
  ]);
});

test('Details relation-only save adopts canonical weekday dates, clean baseline and undo', async ({
  page,
  runtime,
}, info) => {
  let tree = await project(page, runtime);
  tree = await create(
    page,
    runtime,
    tree,
    'A',
    null,
    '2026-10-09',
    '2026-10-09',
  );
  tree = await create(
    page,
    runtime,
    tree,
    'B',
    null,
    '2026-10-08',
    '2026-10-09',
  );
  await show(page);
  await row(page, taskId(tree, 'B')).click();
  await panel(page)
    .getByRole('button', { name: 'После окончания', exact: true })
    .click();
  await choose(page, 'A');
  await expect(panel(page)).toBeVisible();
  await expect(
    panel(page).getByRole('button', { name: 'После окончания', exact: true }),
  ).toBeFocused();
  await save(page);
  await expect(page.getByText('Сохранено', { exact: true })).toBeVisible();
  const current = await readTree(page, runtime.origin, tree.project.id);
  expect(current.project.revision).toBe(tree.project.revision + 1);
  expect(current.tasks.find((t) => t.title === 'B')).toMatchObject({
    inputStart: '2026-10-12',
    inputFinish: '2026-10-13',
    durationDays: null,
  });
  await expect(page.getByLabel('Начало', { exact: true })).toHaveValue(
    '12.10.2026',
  );
  await expect(page.getByLabel('Окончание', { exact: true })).toHaveValue(
    '13.10.2026',
  );
  await expect(
    page.getByRole('button', { name: 'Отбросить изменения', exact: true }),
  ).toHaveCount(0);
  await panel(page)
    .locator('.panel-content')
    .evaluate((el) => {
      el.scrollTop = 0;
    });
  await page.screenshot({
    path: `/tmp/leaf-fs-${info.project.name}-details-fields.png`,
  });
  await page.getByRole('tab', { name: 'Зависимости', exact: true }).click();
  await expect(page.locator('[data-dependency-edge]')).toHaveCount(1);
  await panel(page)
    .locator('.panel-content')
    .evaluate((el) => {
      el.scrollTop = 0;
    });
  await panel(page).locator('.dependency-graph').scrollIntoViewIfNeeded();
  await expect(page.locator('[data-dependency-edge]')).toBeVisible();
  await page.screenshot({
    path: `/tmp/leaf-fs-${info.project.name}-details.png`,
  });
  await page.keyboard.press('Escape');
  await page
    .getByRole('button', { name: 'Отменить последнее изменение', exact: true })
    .click();
  await expect(page.locator('[data-gantt-edge]')).toHaveCount(0);
  const restored = await readTree(page, runtime.origin, tree.project.id);
  expect(restored.tasks).toEqual(tree.tasks);
  expect(restored.dependencies).toEqual(tree.dependencies);
  expect(restored.schedule).toEqual(tree.schedule);
});

test('list and conditional Gantt use single immediate commands without opening or dragging task', async ({
  page,
  runtime,
}) => {
  let tree = await project(page, runtime);
  tree = await create(page, runtime, tree, 'A');
  tree = await create(page, runtime, tree, 'B');
  await show(page);
  const commands: unknown[] = [];
  page.on('request', (request) => {
    if (request.url().endsWith('/commands') && request.method() === 'POST')
      commands.push(request.postDataJSON().command);
  });
  const listTrigger = row(page, taskId(tree, 'B')).getByRole('button', {
    name: 'После окончания: B',
    exact: true,
  });
  await row(page, taskId(tree, 'B')).hover();
  const chainBounds = await listTrigger.boundingBox(),
    childBounds = await row(page, taskId(tree, 'B'))
      .getByRole('button', { name: 'Добавить подзадачу: B', exact: true })
      .boundingBox();
  expect(chainBounds!.x + chainBounds!.width).toBeLessThanOrEqual(
    childBounds!.x,
  );
  await listTrigger.click();
  await picker(page).getByRole('searchbox').fill('A');
  await picker(page).getByRole('searchbox').press('Enter');
  await expect(picker(page)).toHaveCount(0);
  await expect(listTrigger).toBeFocused();
  await expect(panel(page)).toHaveCount(0);
  let current = await readTree(page, runtime.origin, tree.project.id);
  expect(current.project.revision).toBe(tree.project.revision + 1);
  expect(current.dependencies).toHaveLength(1);
  await expect(page.locator('.gantt-edge.conditional')).toHaveCount(1);
  await listTrigger.click();
  await picker(page)
    .getByRole('button', { name: 'Убрать предшественника: A', exact: true })
    .click();
  await expect(picker(page)).toHaveCount(0);
  await expect(listTrigger).toBeFocused();
  current = await readTree(page, runtime.origin, tree.project.id);
  expect(current.project.revision).toBe(tree.project.revision + 2);
  expect(current.dependencies).toEqual([]);
  await expect(page.locator('[data-gantt-edge]')).toHaveCount(0);
  const bar = page.locator(`[data-gantt-bar="${taskId(tree, 'B')}"]`);
  await bar.focus();
  const ganttTrigger = page
    .getByRole('group', { name: 'Гант', exact: true })
    .getByRole('button', { name: 'После окончания: B', exact: true });
  await expect(ganttTrigger).toBeVisible();
  expect(
    await ganttTrigger.evaluate((el) => el.parentElement?.tagName),
  ).not.toBe('BUTTON');
  await ganttTrigger.click();
  await picker(page).getByRole('searchbox').fill('A');
  await picker(page).getByRole('searchbox').press('Enter');
  await expect(picker(page)).toHaveCount(0);
  await expect(ganttTrigger).toBeFocused();
  await expect(panel(page)).toHaveCount(0);
  current = await readTree(page, runtime.origin, tree.project.id);
  expect(current.project.revision).toBe(tree.project.revision + 3);
  expect(current.tasks).toEqual(tree.tasks);
  await expect(page.locator('.gantt-edge.conditional')).toHaveCount(1);
  expect(commands).toEqual([
    {
      type: 'dependency.create',
      predecessorId: taskId(tree, 'A'),
      successorId: taskId(tree, 'B'),
    },
    { type: 'dependency.delete', dependencyId: expect.any(String) },
    {
      type: 'dependency.create',
      predecessorId: taskId(tree, 'A'),
      successorId: taskId(tree, 'B'),
    },
  ]);
});

test('saved FS from a completed task to an undated subtask stays visible after reload and undo', async ({
  page,
  runtime,
}, info) => {
  await page.clock.install({ time: new Date('2026-10-08T09:00:00Z') });
  let tree = await project(page, runtime);
  tree = await create(page, runtime, tree, 'P');
  tree = await create(
    page,
    runtime,
    tree,
    'A',
    taskId(tree, 'P'),
    '2026-10-08',
    '2026-10-08',
  );
  tree = await create(page, runtime, tree, 'B', taskId(tree, 'P'));
  tree = await send(page, runtime.origin, tree, {
    type: 'task.update',
    taskId: taskId(tree, 'A'),
    changes: { status: 'done' },
  });
  await show(page);
  const trigger = row(page, taskId(tree, 'B')).getByRole('button', {
    name: 'После окончания: B',
    exact: true,
  });
  await trigger.click();
  await picker(page).getByRole('searchbox').fill('A');
  await picker(page).getByRole('searchbox').press('Enter');
  await expect(picker(page)).toHaveCount(0);
  const current = await readTree(page, runtime.origin, tree.project.id);
  expect(current.tasks).toEqual(tree.tasks);
  expect(current.project.revision).toBe(tree.project.revision + 1);
  expect(current.dependencies).toHaveLength(1);
  const edge = page.locator(
    `[data-gantt-edge="${current.dependencies[0]!.id}"]`,
  );
  await expect(edge).toBeVisible();
  await expect(edge).toHaveClass('gantt-edge conditional');
  expect(
    await edge.evaluate((el) => getComputedStyle(el).strokeDasharray),
  ).toBe('4px, 3px');
  await page.screenshot({
    path: `/tmp/leaf-conditional-fs-${info.project.name}.png`,
  });
  await show(page);
  await expect(edge).toBeVisible();
  expect(await readTree(page, runtime.origin, tree.project.id)).toEqual(
    current,
  );
  await page
    .getByRole('button', { name: 'Отменить последнее изменение', exact: true })
    .click();
  await expect(edge).toHaveCount(0);
  const restored = await readTree(page, runtime.origin, tree.project.id);
  expect(restored.tasks).toEqual(tree.tasks);
  expect(restored.dependencies).toEqual(tree.dependencies);
  expect(restored.schedule).toEqual(tree.schedule);
});

test('whole-project picker distinguishes hidden duplicate titles and preserves row geometry', async ({
  page,
  runtime,
}) => {
  let tree = await project(page, runtime);
  for (const parent of ['P', 'Q']) {
    tree = await create(page, runtime, tree, parent);
    tree = await create(
      page,
      runtime,
      tree,
      'Одинаковая',
      taskId(tree, parent),
    );
  }
  tree = await create(page, runtime, tree, 'B');
  const qChild = tree.tasks.find((t) => t.parentId === taskId(tree, 'Q'))!.id;
  await show(page);
  await row(page, taskId(tree, 'P'))
    .getByRole('button', { name: 'Свернуть P', exact: true })
    .click();
  await row(page, taskId(tree, 'Q'))
    .getByRole('button', { name: 'Свернуть Q', exact: true })
    .click();
  await page
    .getByRole('searchbox', { name: 'Поиск задач', exact: true })
    .fill('B');
  const target = row(page, taskId(tree, 'B')),
    before = await target.boundingBox();
  await target.focus();
  await target.press('Alt+l');
  await picker(page).getByRole('searchbox').fill('Одинаковая');
  await expect(picker(page).getByRole('option')).toHaveCount(2);
  await picker(page).getByRole('option').filter({ hasText: 'Q' }).click();
  await expect(picker(page)).toHaveCount(0);
  expect(await target.boundingBox()).toEqual(before);
  const current = await readTree(page, runtime.origin, tree.project.id);
  expect(current.dependencies).toEqual([
    expect.objectContaining({
      predecessorId: qChild,
      successorId: taskId(tree, 'B'),
    }),
  ]);
});

test('uncertain create applies on server, blocks draft, then exact retry acknowledges only once', async ({
  page,
  runtime,
}) => {
  let tree = await project(page, runtime);
  tree = await create(page, runtime, tree, 'A');
  await show(page);
  const title = page.getByLabel('Новая задача', { exact: true });
  await title.fill('B');
  await title.press('Alt+l');
  await choose(page, 'A');
  const envelopes: unknown[] = [];
  await page.route('**/api/projects/*/commands', async (route) => {
    envelopes.push(route.request().postDataJSON());
    if (envelopes.length === 1) {
      const applied = await route.fetch();
      expect(applied.status()).toBe(200);
      await route.abort('failed');
    } else await route.continue();
  });
  await page
    .getByRole('button', { name: 'Добавить задачу', exact: true })
    .click();
  await expect(
    page.getByRole('button', { name: 'Повторить', exact: true }),
  ).toBeVisible();
  await expect(title).toHaveValue('B');
  await expect(title).toBeDisabled();
  await expect(
    page.getByRole('button', { name: 'Добавить задачу', exact: true }),
  ).toBeDisabled();
  const applied = await readTree(page, runtime.origin, tree.project.id);
  expect(applied.project.revision).toBe(tree.project.revision + 1);
  expect(applied.dependencies).toHaveLength(1);
  await expect(row(page, taskId(applied, 'B'))).toHaveCount(0);
  await page.getByRole('button', { name: 'Повторить', exact: true }).click();
  await expect(title).toHaveValue('');
  await expect(title).toBeFocused();
  expect(envelopes).toHaveLength(2);
  expect(envelopes[1]).toEqual(envelopes[0]);
  const confirmed = await readTree(page, runtime.origin, tree.project.id);
  expect(confirmed).toEqual(applied);
  expect(confirmed.tasks.filter((t) => t.title === 'B')).toHaveLength(1);
});

test('real stale 409 keeps Details source and IDs through reload and corrected resubmit', async ({
  page,
  runtime,
}) => {
  let tree = await project(page, runtime);
  tree = await create(page, runtime, tree, 'A');
  tree = await create(page, runtime, tree, 'B');
  await show(page);
  await row(page, taskId(tree, 'B')).click();
  await panel(page)
    .getByRole('button', { name: 'После окончания', exact: true })
    .click();
  await choose(page, 'A');
  await page
    .getByLabel('Описание', { exact: true })
    .fill('Синтетический черновик');
  tree = await send(page, runtime.origin, tree, {
    type: 'task.edit',
    taskId: taskId(tree, 'A'),
    changes: { title: 'A обновлена' },
  });
  await save(page, 409);
  await expect(page.getByText(/Проект изменён в другой сессии/)).toBeVisible();
  await page
    .getByRole('button', { name: 'Загрузить актуальный проект', exact: true })
    .click();
  await expect(page.getByLabel('Описание', { exact: true })).toHaveValue(
    'Синтетический черновик',
  );
  await expect(panel(page).locator('.predecessor-chip')).toHaveText(
    'A обновлена',
  );
  expect(
    (await readTree(page, runtime.origin, tree.project.id)).dependencies,
  ).toEqual([]);
  await save(page);
  await expect(page.getByText('Сохранено', { exact: true })).toBeVisible();
  const current = await readTree(page, runtime.origin, tree.project.id);
  expect(current.project.revision).toBe(tree.project.revision + 1);
  expect(current.dependencies).toEqual([
    expect.objectContaining({
      predecessorId: taskId(tree, 'A обновлена'),
      successorId: taskId(tree, 'B'),
    }),
  ]);
});

test('source conflict rejects real save and dirty Details guards list Gantt and graph', async ({
  page,
  runtime,
}) => {
  let tree = await project(page, runtime);
  tree = await create(
    page,
    runtime,
    tree,
    'A',
    null,
    '2026-10-09',
    '2026-10-09',
  );
  tree = await create(
    page,
    runtime,
    tree,
    'B',
    null,
    '2026-10-12',
    '2026-10-13',
  );
  tree = await send(page, runtime.origin, tree, {
    type: 'dependency.create',
    predecessorId: taskId(tree, 'A'),
    successorId: taskId(tree, 'B'),
  });
  await show(page);
  await row(page, taskId(tree, 'B')).click();
  await page.getByLabel('Начало', { exact: true }).fill('2026-10-08');
  await page.getByLabel('Начало', { exact: true }).press('Tab');
  const rejected = await save(page, 400);
  expect((await rejected.json()).code).toBe('EXPLICIT_PRECEDENCE_CONFLICT');
  await expect(page.getByLabel('Начало', { exact: true })).toHaveValue(
    '08.10.2026',
  );
  await expect(panel(page).locator('.predecessor-chip')).toHaveText('A');
  expect(await readTree(page, runtime.origin, tree.project.id)).toEqual(tree);
  await expect(
    row(page, taskId(tree, 'A')).getByRole('button', {
      name: 'После окончания: A',
      exact: true,
    }),
  ).toBeDisabled();
  await row(page, taskId(tree, 'A')).press('Alt+l');
  await expect(picker(page)).toHaveCount(0);
  await expect(
    page
      .getByRole('group', { name: 'Гант', exact: true })
      .getByRole('button', { name: 'После окончания: A', exact: true }),
  ).toBeDisabled();
  await page.getByRole('tab', { name: 'Зависимости', exact: true }).click();
  await expect(
    page.getByRole('button', { name: 'Добавить зависимость', exact: true }),
  ).toBeDisabled();
  expect(await readTree(page, runtime.origin, tree.project.id)).toEqual(tree);
});

for (const failure of ['done', 'cycle', 'calendar'] as const)
  test(`real ${failure} failure retains relation draft and leaves snapshot unchanged`, async ({
    page,
    runtime,
  }) => {
    let tree = await project(page, runtime);
    if (failure === 'calendar')
      tree = await send(page, runtime.origin, tree, {
        type: 'project.schedule',
        changes: { calendarType: 'all-days' },
      });
    tree = await create(
      page,
      runtime,
      tree,
      'A',
      null,
      failure === 'calendar' ? '9999-12-31' : '2026-10-09',
      failure === 'calendar' ? '9999-12-31' : '2026-10-09',
    );
    tree = await create(
      page,
      runtime,
      tree,
      'B',
      null,
      '2026-10-08',
      '2026-10-09',
    );
    if (failure === 'done')
      tree = await send(page, runtime.origin, tree, {
        type: 'task.edit',
        taskId: taskId(tree, 'B'),
        changes: { status: 'done' },
      });
    await show(page);
    await row(page, taskId(tree, 'B')).click();
    await panel(page)
      .getByRole('button', { name: 'После окончания', exact: true })
      .click();
    await choose(page, 'A');
    if (failure === 'cycle') {
      tree = await send(page, runtime.origin, tree, {
        type: 'dependency.create',
        predecessorId: taskId(tree, 'B'),
        successorId: taskId(tree, 'A'),
      });
      await save(page, 409);
      await page
        .getByRole('button', {
          name: 'Загрузить актуальный проект',
          exact: true,
        })
        .click();
    }
    const response = page.waitForResponse(
      (r) => r.url().endsWith('/commands') && r.request().method() === 'POST',
    );
    await page.getByRole('button', { name: 'Сохранить', exact: true }).click();
    const failed = await response;
    expect(failed.status()).toBe(400);
    const body = await failed.json();
    expect(body.code).toBe(
      failure === 'done'
        ? 'DONE_PLAN_LOCKED'
        : failure === 'cycle'
          ? 'DEPENDENCY_CYCLE'
          : 'CALENDAR_RANGE_EXCEEDED',
    );
    await expect(panel(page).locator('.predecessor-chip')).toHaveText('A');
    await expect(
      page.getByRole('button', { name: 'Отбросить изменения', exact: true }),
    ).toBeVisible();
    expect(await readTree(page, runtime.origin, tree.project.id)).toEqual(tree);
  });

test('bounded keyboard results and dynamic picker growth stay visible near viewport bottom', async ({
  page,
  runtime,
}, info) => {
  let tree = await project(page, runtime);
  for (let i = 1; i <= 20; i++)
    tree = await create(
      page,
      runtime,
      tree,
      `Кандидат ${String(i).padStart(2, '0')} с длинным названием`,
    );
  tree = await create(page, runtime, tree, 'B');
  await show(page);
  const quick = page.getByLabel('Новая задача', { exact: true });
  await quick.scrollIntoViewIfNeeded();
  await quick.focus();
  await quick.press('Alt+l');
  const search = picker(page).getByRole('searchbox');
  await search.fill('Кандидат');
  const list = picker(page).getByRole('listbox');
  for (let i = 0; i < 20; i++) {
    await search.press('ArrowDown');
    await visibleWithin(
      picker(page).getByRole('option', { selected: true }),
      list,
    );
  }
  await search.press('ArrowUp');
  await visibleWithin(
    picker(page).getByRole('option', { selected: true }),
    list,
  );
  const initial = await picker(page).boundingBox();
  for (let i = 0; i < 12; i++) {
    await search.press('ArrowDown');
    await search.press('Enter');
  }
  await expect(picker(page).locator('.predecessor-chip')).toHaveCount(12);
  await expect
    .poll(async () => {
      const box = await picker(page).boundingBox();
      return box!.y + box!.height;
    })
    .toBeLessThanOrEqual(page.viewportSize()!.height - 11);
  const bounds = await picker(page).boundingBox(),
    viewport = page.viewportSize()!;
  expect(bounds!.height).toBeGreaterThan(initial!.height);
  expect(bounds!.y).toBeGreaterThanOrEqual(11);
  expect(bounds!.y + bounds!.height).toBeLessThanOrEqual(viewport.height - 11);
  expect(bounds!.x).toBeGreaterThanOrEqual(11);
  expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(viewport.width - 11);
  await page.screenshot({
    path: `/tmp/leaf-fs-${info.project.name}-picker.png`,
  });
  await search.fill('Отсутствует');
  await expect(picker(page).getByRole('status')).toHaveText(
    'Ничего не найдено',
  );
  await search.press('Escape');
  await expect(
    page.getByRole('button', {
      name: 'После окончания новой задачи',
      exact: true,
    }),
  ).toBeFocused();
  expect(await readTree(page, runtime.origin, tree.project.id)).toEqual(tree);
});

test('empty project picker exposes accessible empty state and summary is no relation endpoint', async ({
  page,
  runtime,
}) => {
  let tree = await project(page, runtime);
  await show(page);
  const quick = page.getByLabel('Новая задача', { exact: true });
  await quick.focus();
  await quick.press('Alt+l');
  await expect(picker(page).getByRole('status')).toHaveText(
    'Нет других конечных работ',
  );
  await picker(page).getByRole('searchbox').press('Escape');
  tree = await create(page, runtime, tree, 'P');
  tree = await create(page, runtime, tree, 'A', taskId(tree, 'P'));
  await show(page);
  await expect(
    row(page, taskId(tree, 'P')).getByRole('button', {
      name: 'После окончания: P',
      exact: true,
    }),
  ).toHaveCount(0);
  await row(page, taskId(tree, 'P')).focus();
  await row(page, taskId(tree, 'P')).press('Alt+l');
  await expect(picker(page)).toHaveCount(0);
  await expect(
    page.getByText('Выберите конечную работу', { exact: true }),
  ).toBeVisible();
  expect(await readTree(page, runtime.origin, tree.project.id)).toEqual(tree);
});

test('parent critical branch changes in one edit and exact undo survives restart', async ({
  page,
  runtime,
}, info) => {
  let tree = await project(page, runtime);
  tree = await send(page, runtime.origin, tree, {
    type: 'project.schedule',
    changes: { calendarType: 'all-days' },
  });
  tree = await create(page, runtime, tree, 'R');
  for (const title of ['P', 'Q'])
    tree = await create(page, runtime, tree, title, taskId(tree, 'R'));
  for (const [title, parent, start, finish] of [
    ['A', 'P', '2026-10-05', '2026-10-06'],
    ['B', 'P', '2026-10-07', '2026-10-09'],
    ['C', 'Q', '2026-10-05', '2026-10-07'],
    ['D', 'Q', '2026-10-08', '2026-10-09'],
  ])
    tree = await create(
      page,
      runtime,
      tree,
      title!,
      taskId(tree, parent!),
      start!,
      finish!,
    );
  for (const [a, b] of [
    ['A', 'B'],
    ['C', 'D'],
  ])
    tree = await send(page, runtime.origin, tree, {
      type: 'dependency.create',
      predecessorId: taskId(tree, a!),
      successorId: taskId(tree, b!),
    });
  await show(page);
  await expect(page.locator('.gantt-work.critical')).toHaveCount(4);
  await expect(page.locator('.gantt-edge.critical')).toHaveCount(2);
  for (const title of ['P', 'Q', 'R'])
    await expect(
      row(page, taskId(tree, title)).getByLabel('Содержит критические задачи', {
        exact: true,
      }),
    ).toBeVisible();
  await row(page, taskId(tree, 'A')).click();
  await page.getByLabel('Начало', { exact: true }).fill('2026-10-07');
  await page.getByLabel('Начало', { exact: true }).press('Tab');
  await page.getByLabel('Окончание', { exact: true }).fill('2026-10-08');
  await page.getByLabel('Окончание', { exact: true }).press('Tab');
  await page.getByLabel('Длительность, дней', { exact: true }).fill('');
  await save(page);
  await expect(page.getByText('Сохранено', { exact: true })).toBeVisible();
  const after = await readTree(page, runtime.origin, tree.project.id);
  expect(after.project.revision).toBe(tree.project.revision + 1);
  expect(after.tasks.find((t) => t.title === 'A')).toMatchObject({
    inputStart: '2026-10-07',
    inputFinish: '2026-10-08',
    durationDays: null,
  });
  expect(after.tasks.find((t) => t.title === 'B')).toMatchObject({
    inputStart: '2026-10-09',
    inputFinish: '2026-10-11',
    durationDays: null,
  });
  if (after.schedule.analysisStatus !== 'ready')
    throw new Error('Expected ready cascade');
  expect(after.schedule.horizonFinishDate).toBe('2026-10-11');
  for (const [title, projectFloat, constraintFloat] of [
    ['A', 0, 0],
    ['B', 0, 0],
    ['C', 2, 0],
    ['D', 2, 2],
  ] as const)
    expect(after.schedule.tasks[taskId(tree, title)]).toMatchObject({
      projectFloat,
      constraintFloat,
    });
  expect(after.schedule.criticalTaskIds).toEqual(
    [taskId(tree, 'A'), taskId(tree, 'B')].sort(),
  );
  expect(after.schedule.criticalDependencyIds).toEqual([
    tree.dependencies.find((d) => d.predecessorId === taskId(tree, 'A'))!.id,
  ]);
  for (const [title, startDate, finishDate, containsCritical] of [
    ['P', '2026-10-07', '2026-10-11', true],
    ['Q', '2026-10-05', '2026-10-09', false],
    ['R', '2026-10-05', '2026-10-11', true],
  ] as const)
    expect(after.schedule.summaries[taskId(tree, title)]).toMatchObject({
      startDate,
      finishDate,
      containsCritical,
    });
  await page.keyboard.press('Escape');
  await expect(page.locator('.gantt-work.critical')).toHaveCount(2);
  await expect(page.locator('.gantt-edge.critical')).toHaveCount(1);
  for (const title of ['P', 'R'])
    await expect(
      row(page, taskId(tree, title)).getByLabel('Содержит критические задачи', {
        exact: true,
      }),
    ).toBeVisible();
  await expect(
    row(page, taskId(tree, 'Q')).getByLabel('Содержит критические задачи', {
      exact: true,
    }),
  ).toHaveCount(0);
  await page.screenshot({
    path: `/tmp/leaf-fs-${info.project.name}-critical.png`,
  });
  await page
    .getByRole('button', { name: 'Отменить последнее изменение', exact: true })
    .click();
  await expect(page.locator('.gantt-work.critical')).toHaveCount(4);
  await expect(page.locator('.gantt-edge.critical')).toHaveCount(2);
  const restored = await readTree(page, runtime.origin, tree.project.id);
  expect(restored.tasks).toEqual(tree.tasks);
  expect(restored.dependencies).toEqual(tree.dependencies);
  expect(restored.schedule).toEqual(tree.schedule);
  expect(restored.project.revision).toBe(after.project.revision + 1);
  await runtime.restart();
  await page.reload();
  await expect(page.locator('.gantt-work.critical')).toHaveCount(4);
  const restarted = await readTree(page, runtime.origin, tree.project.id);
  expect(restarted).toEqual(restored);
});

test('immediate picker waits for genuine server acknowledgement before rendering saved chips', async ({
  page,
  runtime,
}) => {
  let tree = await project(page, runtime);
  tree = await create(page, runtime, tree, 'A');
  tree = await create(page, runtime, tree, 'B');
  await show(page);
  let release!: () => void, applied!: () => void;
  const held = new Promise<void>((resolve) => {
      release = resolve;
    }),
    reached = new Promise<void>((resolve) => {
      applied = resolve;
    });
  await page.route(
    '**/api/projects/*/commands',
    async (route) => {
      const response = await route.fetch();
      expect(response.status()).toBe(200);
      applied();
      await held;
      await route.fulfill({ response });
    },
    { times: 1 },
  );
  try {
    const trigger = row(page, taskId(tree, 'B')).getByRole('button', {
      name: 'После окончания: B',
      exact: true,
    });
    await trigger.click();
    await picker(page).getByRole('option').filter({ hasText: 'A' }).click();
    await reached;
    await expect(picker(page).locator('.predecessor-chip')).toHaveCount(0);
    await expect(picker(page).getByRole('option')).toBeDisabled();
    await expect(page.getByText('Сохранено', { exact: true })).toHaveCount(0);
    await expect(page.locator('[data-gantt-edge]')).toHaveCount(0);
    const current = await readTree(page, runtime.origin, tree.project.id);
    expect(current.project.revision).toBe(tree.project.revision + 1);
    expect(current.dependencies).toHaveLength(1);
    release();
    await expect(picker(page)).toHaveCount(0);
    await expect(trigger).toBeFocused();
    await expect(panel(page)).toHaveCount(0);
    await expect(page.locator('.gantt-edge.conditional')).toHaveCount(1);
    await trigger.click();
    await expect(
      picker(page).getByRole('button', {
        name: 'Убрать предшественника: A',
        exact: true,
      }),
    ).toBeEnabled();
    await picker(page).getByRole('searchbox').press('Escape');
    await expect(trigger).toBeFocused();
  } finally {
    release();
  }
});

test('preexisting synthetic infeasible snapshot still shows local diagnostics without live repair', async ({
  page,
  runtime,
}) => {
  let tree = await project(page, runtime);
  tree = await create(
    page,
    runtime,
    tree,
    'A',
    null,
    '2026-10-05',
    '2026-10-07',
  );
  tree = await create(
    page,
    runtime,
    tree,
    'B',
    null,
    '2026-10-08',
    '2026-10-09',
  );
  tree = await send(page, runtime.origin, tree, {
    type: 'dependency.create',
    predecessorId: taskId(tree, 'A'),
    successorId: taskId(tree, 'B'),
  });
  // Only this test's disposable synthetic DB receives a preexisting conflict;
  // normal C24 relation commands would repair it or reject the write.
  const db = new Database(runtime.databasePath);
  try {
    db.prepare('UPDATE tasks SET inputStart=?, inputFinish=? WHERE id=?').run(
      '2026-10-07',
      '2026-10-08',
      taskId(tree, 'B'),
    );
  } finally {
    db.close();
  }
  const before = await readTree(page, runtime.origin, tree.project.id);
  expect(before.schedule.analysisStatus).toBe('infeasible');
  expect(before.schedule.criticalTaskIds).toEqual([]);
  expect(before.schedule.criticalDependencyIds).toEqual([]);
  await show(page);
  for (const title of ['A', 'B'])
    await expect(row(page, taskId(tree, title))).toHaveAttribute(
      'aria-description',
      /Предшественник заканчивается после явного начала/,
    );
  await row(page, taskId(tree, 'B')).click();
  await expect(
    panel(page).getByText('Предшественник заканчивается после явного начала.', {
      exact: true,
    }),
  ).toBeVisible();
  await expect(page.getByLabel('Начало', { exact: true })).toHaveValue(
    '07.10.2026',
  );
  await expect(page.locator('.gantt-work.critical')).toHaveCount(0);
  expect(await readTree(page, runtime.origin, tree.project.id)).toEqual(before);
});
