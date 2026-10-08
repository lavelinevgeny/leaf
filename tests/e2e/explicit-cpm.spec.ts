import { test as base, expect, type Page } from '@playwright/test';
import { randomUUID } from 'node:crypto';
import { syntheticRuntime } from '../../scripts/e2e-server.js';
import {
  projectTreeV2Schema,
  type ProjectTreeV2,
  type CommandV2,
} from '../../src/shared/contracts.js';
import Database from 'better-sqlite3';
import { commandEnvelopeV2Schema } from '../../src/shared/contracts.js';
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
test('explicit P04 edits, critical sets, one undo and restart agree', async ({
  page,
  runtime,
}, info) => {
  await page.goto(runtime.origin);
  await page.getByLabel('Пароль', { exact: true }).fill(runtime.password);
  await page.getByRole('button', { name: 'Войти', exact: true }).click();
  await expect(
    page.getByRole('button', { name: 'Новый проект' }),
  ).toBeVisible();
  const created = await page.request.post(runtime.origin + '/api/projects', {
    headers: { Origin: runtime.origin, 'X-Leaf-Contract-Version': '2' },
    data: { title: 'Synthetic explicit browser' },
  });
  expect(created.status()).toBe(201);
  const projectId = ((await created.json()) as { id: string }).id;
  let tree = await readTree(page, runtime.origin, projectId);
  tree = await command(page, runtime.origin, tree, {
    type: 'project.schedule',
    changes: { calendarType: 'all-days' },
  });
  for (const title of ['A', 'B', 'C', 'D'])
    tree = await command(page, runtime.origin, tree, {
      type: 'task.create',
      title,
      parentId: null,
    });
  const by = Object.fromEntries(tree.tasks.map((t) => [t.title, t.id]));
  for (const [title, inputStart, inputFinish] of [
    ['A', '2026-10-05', '2026-10-06'],
    ['B', '2026-10-07', '2026-10-09'],
    ['C', '2026-10-05', '2026-10-07'],
    ['D', '2026-10-08', '2026-10-09'],
  ] as const)
    tree = await command(page, runtime.origin, tree, {
      type: 'task.edit',
      taskId: by[title]!,
      changes: { inputStart, inputFinish },
    });
  for (const [from, to] of [
    ['A', 'B'],
    ['C', 'D'],
  ] as const)
    tree = await command(page, runtime.origin, tree, {
      type: 'dependency.create',
      predecessorId: by[from]!,
      successorId: by[to]!,
    });
  const before = structuredClone(tree);
  expect(tree.schedule.analysisStatus).toBe('ready');
  expect(tree.schedule.criticalTaskIds).toEqual(
    [by.A!, by.B!, by.C!, by.D!].sort(),
  );
  await page.reload();
  await page
    .getByRole('button', { name: 'Synthetic explicit browser', exact: true })
    .click();
  await expect(
    page
      .getByRole('tree', { name: 'Задачи', exact: true })
      .getByRole('treeitem'),
  ).toHaveCount(4);
  await expect(page.locator('.gantt-work.critical')).toHaveCount(4);
  await page.screenshot({
    path: '/tmp/leaf-task7-' + info.project.name + '-main.png',
  });
  const b = page.getByRole('treeitem', { name: /^B,/ }).first();
  await b.focus();
  await b.press('Enter');
  await page.getByLabel('Окончание', { exact: true }).fill('2026-10-11');
  const saved = page.waitForResponse(
    (r) => r.url().endsWith('/commands') && r.request().method() === 'POST',
  );
  await page.getByRole('button', { name: 'Сохранить', exact: true }).click();
  expect((await saved).status()).toBe(200);
  await expect(page.getByText('Сохранено', { exact: true })).toBeVisible();
  const after = await readTree(page, runtime.origin, projectId);
  expect(after.project.revision).toBe(before.project.revision + 1);
  if (after.schedule.analysisStatus !== 'ready')
    throw new Error('Expected ready');
  expect(after.schedule.criticalTaskIds).toEqual([by.A!, by.B!].sort());
  for (const [name, pf, cf] of [
    ['A', 0, 0],
    ['B', 0, 0],
    ['C', 2, 0],
    ['D', 2, 2],
  ] as const)
    expect(after.schedule.tasks[by[name]!]).toMatchObject({
      projectFloat: pf,
      constraintFloat: cf,
    });
  const ab = after.dependencies.find(
    (e) => e.predecessorId === by.A && e.successorId === by.B,
  )!.id;
  expect(after.schedule.criticalDependencyIds).toEqual([ab]);
  await page
    .getByLabel('Название задачи', { exact: true })
    .scrollIntoViewIfNeeded();
  await page.screenshot({
    path: '/tmp/leaf-task7-' + info.project.name + '-panel.png',
  });
  await page.getByRole('tab', { name: 'Зависимости', exact: true }).click();
  await expect(page.locator('[data-dependency-edge="' + ab + '"]')).toHaveClass(
    /(^| )critical( |$)/,
  );
  await page.screenshot({
    path: '/tmp/leaf-task7-' + info.project.name + '-graph.png',
  });
  await page.getByRole('treeitem', { name: /^D,/ }).first().press('Enter');
  await page.getByRole('tab', { name: 'Зависимости', exact: true }).click();
  const cd = after.dependencies.find(
    (e) => e.predecessorId === by.C && e.successorId === by.D,
  )!.id;
  await expect(
    page.locator('[data-dependency-edge="' + cd + '"]'),
  ).not.toHaveClass(/(^| )critical( |$)/);
  await page.getByRole('treeitem', { name: /^C,/ }).first().press('Enter');
  await page.getByRole('tab', { name: 'Детали', exact: true }).click();
  await expect(page.getByText(/Резерв проекта: 2/)).toBeVisible();
  await page.keyboard.press('Escape');
  const undoReply = page.waitForResponse(
    (r) => r.url().endsWith('/commands') && r.request().method() === 'POST',
  );
  await page
    .getByRole('button', { name: 'Отменить последнее изменение', exact: true })
    .click();
  expect((await undoReply).status()).toBe(200);
  const undone = await readTree(page, runtime.origin, projectId);
  expect(undone.tasks).toEqual(before.tasks);
  expect(undone.dependencies).toEqual(before.dependencies);
  expect(undone.schedule).toEqual(before.schedule);
  await runtime.restart();
  await page.reload();
  expect((await readTree(page, runtime.origin, projectId)).schedule).toEqual(
    before.schedule,
  );
});

async function readTree(
  page: Page,
  origin: string,
  projectId: string,
): Promise<ProjectTreeV2> {
  const response = await page.request.get(
    origin + '/api/projects/' + projectId + '/tree',
    { headers: { 'X-Leaf-Contract-Version': '2' } },
  );
  expect(response.status()).toBe(200);
  return projectTreeV2Schema.parse(await response.json());
}
async function command(
  page: Page,
  origin: string,
  tree: ProjectTreeV2,
  value: CommandV2,
): Promise<ProjectTreeV2> {
  const response = await page.request.post(
    origin + '/api/projects/' + tree.project.id + '/commands',
    {
      headers: { Origin: origin, 'X-Leaf-Contract-Version': '2' },
      data: {
        contractVersion: 2,
        expectedRevision: tree.project.revision,
        operationId: randomUUID(),
        command: value,
      },
    },
  );
  expect(response.status()).toBe(200);
  return projectTreeV2Schema.parse(await response.json());
}

async function seedN06(
  page: Page,
  runtime: Awaited<ReturnType<typeof syntheticRuntime>>,
  depth = 0,
) {
  const login = await page.request.post(runtime.origin + '/api/auth/login', {
    headers: { Origin: runtime.origin },
    data: { password: runtime.password },
  });
  expect(login.status()).toBe(200);
  const created = await page.request.post(runtime.origin + '/api/projects', {
    headers: { Origin: runtime.origin, 'X-Leaf-Contract-Version': '2' },
    data: { title: 'Synthetic CPM acceptance' },
  });
  expect(created.status()).toBe(201);
  let tree = await readTree(
    page,
    runtime.origin,
    ((await created.json()) as { id: string }).id,
  );
  tree = await command(page, runtime.origin, tree, {
    type: 'project.schedule',
    changes: { calendarType: 'all-days' },
  });
  let parentId: string | null = null;
  const parents: string[] = [];
  for (let n = 0; n < depth; n++) {
    tree = await command(page, runtime.origin, tree, {
      type: 'task.create',
      title: 'P' + n,
      parentId,
    });
    parentId = tree.tasks.find((t) => t.title === 'P' + n)!.id;
    parents.push(parentId);
  }
  for (const title of ['A', 'B', 'C'])
    tree = await command(page, runtime.origin, tree, {
      type: 'task.create',
      title,
      parentId,
    });
  const by = Object.fromEntries(tree.tasks.map((t) => [t.title, t.id]));
  for (const [title, inputStart, inputFinish] of [
    ['A', '2026-10-05', '2026-10-06'],
    ['B', '2026-10-10', '2026-10-10'],
    ['C', '2026-10-05', '2026-10-14'],
  ] as const)
    tree = await command(page, runtime.origin, tree, {
      type: 'task.edit',
      taskId: by[title]!,
      changes: { inputStart, inputFinish },
    });
  tree = await command(page, runtime.origin, tree, {
    type: 'dependency.create',
    predecessorId: by.A!,
    successorId: by.B!,
  });
  await page.goto(runtime.origin);
  await expect(
    page.getByRole('heading', {
      name: 'Synthetic CPM acceptance',
      exact: true,
    }),
  ).toBeVisible();
  return { tree, by, parents, parentId };
}
function runtimeCounts(path: string, projectId: string) {
  const db = new Database(path, { readonly: true });
  try {
    return {
      project: db
        .prepare('SELECT revision FROM projects WHERE id=?')
        .get(projectId),
      operations: db
        .prepare('SELECT COUNT(*) AS n FROM operations WHERE projectId=?')
        .get(projectId),
      undo: db
        .prepare('SELECT COUNT(*) AS n FROM undo_snapshots WHERE projectId=?')
        .get(projectId),
    };
  } finally {
    db.close();
  }
}
test('deep update and presentation actions preserve authoritative analysis and keyboard focus', async ({
  page,
  runtime,
}) => {
  test.setTimeout(120000);
  const { tree: before, by, parents } = await seedN06(page, runtime, 40);
  const row = page
    .getByRole('tree', { name: 'Задачи', exact: true })
    .getByRole('treeitem', { name: /^C,/ });
  await row.focus();
  await row.press('Enter');
  await expect(
    page.getByRole('complementary', { name: 'Задача', exact: true }),
  ).toBeVisible();
  await page.getByLabel('Окончание', { exact: true }).fill('2026-10-08');
  const saved = page.waitForResponse(
    (r) => r.url().endsWith('/commands') && r.request().method() === 'POST',
  );
  await page.getByRole('button', { name: 'Сохранить', exact: true }).focus();
  await page.keyboard.press('Enter');
  expect((await saved).status()).toBe(200);
  await expect(page.getByText('Сохранено', { exact: true })).toBeVisible();
  const after = await readTree(page, runtime.origin, before.project.id);
  expect(after.project.revision).toBe(before.project.revision + 1);
  if (after.schedule.analysisStatus !== 'ready')
    throw new Error('Expected ready');
  expect(after.schedule.horizonFinishDate).toBe('2026-10-10');
  expect(after.schedule.criticalTaskIds).toEqual([by.B!]);
  expect(after.schedule.criticalDependencyIds).toEqual([]);
  for (const [name, pf, cf] of [
    ['A', 3, 3],
    ['B', 0, 0],
    ['C', 2, 2],
  ] as const)
    expect(after.schedule.tasks[by[name]!]).toMatchObject({
      projectFloat: pf,
      constraintFloat: cf,
    });
  for (const id of parents)
    expect(after.schedule.summaries[id]).toEqual({
      startDate: '2026-10-05',
      finishDate: '2026-10-10',
      calendarSpanDays: 6,
      knownLeafCount: 3,
      totalLeafCount: 3,
      containsCritical: true,
    });
  await expect(
    page.locator('[data-gantt-bar="' + by.C + '"]').locator('..'),
  ).toHaveAttribute('aria-label', /2026-10-05.*2026-10-08/);
  await page.keyboard.press('Escape');
  await expect(row).toBeFocused();
  const state = runtimeCounts(runtime.databasePath, before.project.id);
  await page.getByRole('button', { name: 'Свернуть P0', exact: true }).click();
  await expect(row).toHaveCount(0);
  for (const scale of ['weeks', 'months', 'days']) {
    await page.getByLabel('Масштаб Ганта', { exact: true }).selectOption(scale);
    const current = await readTree(page, runtime.origin, before.project.id);
    expect(current.schedule).toEqual(after.schedule);
    expect(current.tasks).toEqual(after.tasks);
    expect(runtimeCounts(runtime.databasePath, before.project.id)).toEqual(
      state,
    );
  }
  await page.getByRole('button', { name: 'Раскрыть P0', exact: true }).click();
  await expect(row).toBeVisible();
  const b = page
    .getByRole('tree', { name: 'Задачи', exact: true })
    .getByRole('treeitem', { name: /^B,/ });
  await b.focus();
  await b.press('Enter');
  await page.getByRole('tab', { name: 'Зависимости', exact: true }).click();
  await expect(
    page.locator('[data-dependency-edge="' + after.dependencies[0]!.id + '"]'),
  ).not.toHaveClass(/(^| )critical( |$)/);
  await page.keyboard.press('Escape');
  await expect(b).toBeFocused();
  const undone = page.waitForResponse(
    (r) => r.url().endsWith('/commands') && r.request().method() === 'POST',
  );
  await page
    .getByRole('button', { name: 'Отменить последнее изменение', exact: true })
    .focus();
  await page.keyboard.press('Enter');
  expect((await undone).status()).toBe(200);
  const restored = await readTree(page, runtime.origin, before.project.id);
  expect(restored.tasks).toEqual(before.tasks);
  expect(restored.schedule).toEqual(before.schedule);
  await expect(
    page.getByRole('button', {
      name: 'Отменить последнее изменение',
      exact: true,
    }),
  ).toBeFocused();
});
test('conditional unknown keeps partial copy then known FS conflict suppresses all critical styles', async ({
  page,
  runtime,
}) => {
  const seeded = await seedN06(page, runtime, 1);
  let tree = await command(page, runtime.origin, seeded.tree, {
    type: 'task.create',
    title: 'U',
    parentId: seeded.parentId,
  });
  const u = tree.tasks.find((t) => t.title === 'U')!.id;
  tree = await command(page, runtime.origin, tree, {
    type: 'task.edit',
    taskId: u,
    changes: { durationDays: 3 },
  });
  expect(tree.schedule.analysisStatus).toBe('incomplete');
  if (tree.schedule.analysisStatus !== 'incomplete')
    throw new Error('Expected incomplete');
  expect(tree.schedule.criticalTaskIds).toEqual([]);
  expect(tree.schedule.criticalDependencyIds).toEqual([]);
  expect(tree.schedule.partialAnalysis?.partialCriticalTaskIds).toEqual([
    seeded.by.C!,
  ]);
  expect(tree.schedule.tasks[u]).toMatchObject({
    startDate: null,
    finishDate: null,
    projectFloat: null,
    constraintFloat: null,
  });
  expect(tree.schedule.display[u]).toEqual({
    kind: 'conditional',
    startDate: '2026-10-05',
    finishDate: '2026-10-07',
    clipped: false,
  });
  await page.reload();
  await expect(
    page
      .getByText(
        'Анализ датированной части; полный критический путь неизвестен',
      )
      .first(),
  ).toBeVisible();
  await expect(
    page.getByRole('button', {
      name: /U.*Условное размещение; полный интервал не задан/,
    }),
  ).toBeVisible();
  expect(await page.locator('.gantt-work.critical').count()).toBe(0);
  const conflicted = await command(page, runtime.origin, tree, {
    type: 'task.edit',
    taskId: seeded.by.A!,
    changes: { inputFinish: '2026-10-10' },
  });
  expect(conflicted.project.revision).toBe(tree.project.revision + 1);
  expect(conflicted.schedule.analysisStatus).toBe('infeasible');
  if (conflicted.schedule.analysisStatus !== 'infeasible')
    throw new Error('Expected infeasible');
  expect(conflicted.schedule.diagnostics.map((d) => d.code)).toEqual([
    'EXPLICIT_PRECEDENCE_CONFLICT',
    'UNKNOWN_INTERVAL',
  ]);
  expect(conflicted.schedule.partialAnalysis).toBeNull();
  expect(conflicted.schedule.criticalTaskIds).toEqual([]);
  expect(conflicted.schedule.criticalDependencyIds).toEqual([]);
  await page.reload();
  await expect(
    page.getByText(/Предшественник заканчивается после явного начала/).first(),
  ).toBeVisible();
  await expect(
    page.getByText(/Полная пара дат не задана/).first(),
  ).toBeVisible();
  await expect(page.getByText(/Анализ датированной части/)).toHaveCount(0);
  expect(
    await page
      .locator('.gantt-work.critical, .gantt-work.partial-critical')
      .count(),
  ).toBe(0);
  expect(
    (await readTree(page, runtime.origin, tree.project.id)).tasks.find(
      (t) => t.id === u,
    ),
  ).toMatchObject({ inputStart: null, inputFinish: null, durationDays: 3 });
});
test('lost committed response retries the exact envelope and frozen revision without another write', async ({
  page,
  runtime,
}) => {
  const { tree: before, by } = await seedN06(page, runtime);
  let envelope: ReturnType<typeof commandEnvelopeV2Schema.parse> | undefined;
  let frozen: ProjectTreeV2 | undefined;
  await page.route(
    '**/api/projects/' + before.project.id + '/commands',
    async (route) => {
      envelope = commandEnvelopeV2Schema.parse(route.request().postDataJSON());
      const committed = await route.fetch();
      expect(committed.status()).toBe(200);
      frozen = projectTreeV2Schema.parse(await committed.json());
      await route.abort('failed');
    },
    { times: 1 },
  );
  await page
    .getByRole('tree', { name: 'Задачи', exact: true })
    .getByRole('treeitem', { name: /^C,/ })
    .press('Enter');
  await page.getByLabel('Окончание', { exact: true }).fill('2026-10-08');
  await page.getByRole('button', { name: 'Сохранить', exact: true }).click();
  await expect(
    page.getByRole('button', { name: 'Повторить сохранение', exact: true }),
  ).toBeVisible();
  if (!envelope || !frozen)
    throw new Error('Expected captured committed synthetic response');
  expect(frozen.project.revision).toBe(before.project.revision + 1);
  const latest = await command(page, runtime.origin, frozen, {
    type: 'task.edit',
    taskId: by.B!,
    changes: { title: 'Latest B', inputFinish: '2026-10-11' },
  });
  const state = runtimeCounts(runtime.databasePath, before.project.id);
  const retry = page.waitForResponse(
    (r) => r.url().endsWith('/commands') && r.request().method() === 'POST',
  );
  await page
    .getByRole('button', { name: 'Повторить сохранение', exact: true })
    .click();
  const reply = await retry;
  expect(reply.status()).toBe(200);
  expect(reply.request().postDataJSON()).toEqual(envelope);
  expect(projectTreeV2Schema.parse(await reply.json())).toEqual(frozen);
  expect(runtimeCounts(runtime.databasePath, before.project.id)).toEqual(state);
  expect(await readTree(page, runtime.origin, before.project.id)).toEqual(
    latest,
  );
  await page.reload();
  await expect(
    page
      .getByRole('tree', { name: 'Задачи', exact: true })
      .getByRole('treeitem', { name: /^Latest B,/ }),
  ).toBeVisible();
  expect(
    (await readTree(page, runtime.origin, before.project.id)).schedule,
  ).toEqual(latest.schedule);
});

test('F03 tight and non-tight edges distinguish global and partial criticality and unknown undo restores ties', async ({
  page,
  runtime,
}) => {
  const seeded = await seedN06(page, runtime);
  let tree = await command(page, runtime.origin, seeded.tree, {
    type: 'task.edit',
    taskId: seeded.by.B!,
    changes: { inputStart: '2026-10-07', inputFinish: '2026-10-09' },
  });
  tree = await command(page, runtime.origin, tree, {
    type: 'task.edit',
    taskId: seeded.by.C!,
    changes: { inputStart: '2026-10-10', inputFinish: '2026-10-11' },
  });
  tree = await command(page, runtime.origin, tree, {
    type: 'dependency.create',
    predecessorId: seeded.by.B!,
    successorId: seeded.by.C!,
  });
  tree = await command(page, runtime.origin, tree, {
    type: 'dependency.create',
    predecessorId: seeded.by.A!,
    successorId: seeded.by.C!,
  });
  const by = seeded.by;
  const edge = (from: string, to: string) =>
    tree.dependencies.find(
      (e) => e.predecessorId === by[from] && e.successorId === by[to],
    )!.id;
  const ab = edge('A', 'B'),
    bc = edge('B', 'C'),
    ac = edge('A', 'C');
  if (tree.schedule.analysisStatus !== 'ready')
    throw new Error('Expected ready');
  expect(tree.schedule.criticalTaskIds).toEqual([by.A!, by.B!, by.C!].sort());
  expect(tree.schedule.criticalDependencyIds).toEqual([ab, bc].sort());
  for (const id of [by.A!, by.B!, by.C!])
    expect(tree.schedule.tasks[id]).toMatchObject({
      projectFloat: 0,
      constraintFloat: 0,
    });
  await page.reload();
  await page
    .getByRole('tree', { name: 'Задачи', exact: true })
    .getByRole('treeitem', { name: /^A,/ })
    .press('Enter');
  await page.getByRole('tab', { name: 'Зависимости', exact: true }).click();
  await expect(page.locator('[data-dependency-edge="' + ab + '"]')).toHaveClass(
    /(^| )critical( |$)/,
  );
  await expect(
    page.locator('[data-dependency-edge="' + ac + '"]'),
  ).not.toHaveClass(/(^| )critical( |$)/);
  await page.keyboard.press('Escape');
  const ready = structuredClone(tree);
  tree = await command(page, runtime.origin, tree, {
    type: 'task.create',
    title: 'U',
    parentId: null,
  });
  const u = tree.tasks.find((t) => t.title === 'U')!.id;
  if (tree.schedule.analysisStatus !== 'incomplete')
    throw new Error('Expected incomplete');
  expect(tree.schedule.partialAnalysis?.partialCriticalTaskIds).toEqual(
    [by.A!, by.B!, by.C!].sort(),
  );
  expect(tree.schedule.partialAnalysis?.partialCriticalDependencyIds).toEqual(
    [ab, bc].sort(),
  );
  expect(tree.schedule.criticalTaskIds).toEqual([]);
  expect(tree.schedule.criticalDependencyIds).toEqual([]);
  expect(tree.schedule.tasks[u]).toMatchObject({
    startDate: null,
    finishDate: null,
    projectFloat: null,
    constraintFloat: null,
  });
  await page.reload();
  await expect(
    page.getByText(
      'Анализ датированной части; полный критический путь неизвестен',
      { exact: true },
    ),
  ).toBeVisible();
  for (const id of [ab, bc])
    await expect(page.locator('[data-gantt-edge="' + id + '"]')).toHaveClass(
      /(^| )partial-critical( |$)/,
    );
  await expect(page.locator('[data-gantt-edge="' + ac + '"]')).not.toHaveClass(
    /(^| )(partial-critical|critical)( |$)/,
  );
  await page
    .getByRole('tree', { name: 'Задачи', exact: true })
    .getByRole('treeitem', { name: /^B,/ })
    .press('Enter');
  await page.getByRole('tab', { name: 'Зависимости', exact: true }).click();
  for (const id of [ab, bc]) {
    await expect(
      page.locator('[data-dependency-edge="' + id + '"]'),
    ).toHaveClass(/(^| )partial-critical( |$)/);
    await expect(
      page.locator('[data-dependency-edge="' + id + '"]'),
    ).not.toHaveClass(/(^| )critical( |$)/);
  }
  await expect(
    page
      .getByRole('complementary', { name: 'Задача', exact: true })
      .getByText('Критическая связь датированной части', { exact: true }),
  ).toHaveCount(2);
  await page.keyboard.press('Escape');
  const undo = page.waitForResponse(
    (r) => r.url().endsWith('/commands') && r.request().method() === 'POST',
  );
  await page
    .getByRole('button', { name: 'Отменить последнее изменение', exact: true })
    .click();
  expect((await undo).status()).toBe(200);
  const restored = await readTree(page, runtime.origin, tree.project.id);
  expect(restored.tasks).toEqual(ready.tasks);
  expect(restored.dependencies).toEqual(ready.dependencies);
  expect(restored.schedule).toEqual(ready.schedule);
});
test('ordinary done keeps positive structural reserve and P10 calendar change preserves sources with undo', async ({
  page,
  runtime,
}) => {
  const seeded = await seedN06(page, runtime),
    by = seeded.by;
  await page
    .getByRole('tree', { name: 'Задачи', exact: true })
    .getByRole('treeitem', { name: /^B,/ })
    .press('Enter');
  await page.getByLabel('Статус', { exact: true }).selectOption('done');
  const saved = page.waitForResponse(
    (r) => r.url().endsWith('/commands') && r.request().method() === 'POST',
  );
  await page.getByRole('button', { name: 'Сохранить', exact: true }).click();
  expect((await saved).status()).toBe(200);
  await expect(page.getByText('Сохранено', { exact: true })).toBeVisible();
  const done = await readTree(page, runtime.origin, seeded.tree.project.id);
  if (done.schedule.analysisStatus !== 'ready')
    throw new Error('Expected ready');
  expect(done.schedule.tasks[by.B!]).toMatchObject({
    projectFloat: 4,
    constraintFloat: 0,
  });
  expect(done.schedule.criticalTaskIds).toEqual([by.C!]);
  await expect(page.getByText(/Резерв проекта: 4/)).toBeVisible();
  await expect(page.getByText(/Резерв текущего размещения: 0/)).toBeVisible();
  await expect(
    page.locator('[data-gantt-bar="' + by.B + '"]').locator('..'),
  ).not.toHaveClass(/(^| )critical( |$)/);
  await page.keyboard.press('Escape');
  let p10 = await command(page, runtime.origin, done, {
    type: 'task.delete',
    taskId: by.C!,
  });
  p10 = await command(page, runtime.origin, p10, {
    type: 'task.edit',
    taskId: by.B!,
    changes: {
      status: 'todo',
      inputStart: '2026-10-12',
      inputFinish: '2026-10-13',
    },
  });
  p10 = await command(page, runtime.origin, p10, {
    type: 'task.edit',
    taskId: by.A!,
    changes: { inputStart: '2026-10-09', inputFinish: '2026-10-09' },
  });
  p10 = await command(page, runtime.origin, p10, {
    type: 'project.schedule',
    changes: { calendarType: 'weekdays' },
  });
  const ab = p10.dependencies[0]!.id;
  if (p10.schedule.analysisStatus !== 'ready')
    throw new Error('Expected ready');
  expect(p10.schedule.tasks[by.A!]).toMatchObject({
    projectFloat: 0,
    constraintFloat: 0,
  });
  expect(p10.schedule.tasks[by.B!]).toMatchObject({
    projectFloat: 0,
    constraintFloat: 0,
  });
  expect(p10.schedule.criticalTaskIds).toEqual([by.A!, by.B!].sort());
  expect(p10.schedule.criticalDependencyIds).toEqual([ab]);
  await page.reload();
  await page.getByText('Настройки проекта', { exact: true }).click();
  await page.getByLabel('Календарь', { exact: true }).selectOption('all-days');
  const switched = page.waitForResponse(
    (r) => r.url().endsWith('/commands') && r.request().method() === 'POST',
  );
  await page
    .getByRole('button', { name: 'Сохранить настройки проекта', exact: true })
    .click();
  expect((await switched).status()).toBe(200);
  const all = await readTree(page, runtime.origin, p10.project.id);
  if (all.schedule.analysisStatus !== 'ready')
    throw new Error('Expected ready');
  expect(all.project.revision).toBe(p10.project.revision + 1);
  expect(all.tasks).toEqual(p10.tasks);
  expect(all.schedule.tasks[by.A!]).toMatchObject({
    projectFloat: 2,
    constraintFloat: 2,
  });
  expect(all.schedule.tasks[by.B!]).toMatchObject({
    projectFloat: 0,
    constraintFloat: 0,
  });
  expect(all.schedule.criticalTaskIds).toEqual([by.B!]);
  expect(all.schedule.criticalDependencyIds).toEqual([]);
  await page
    .getByRole('tree', { name: 'Задачи', exact: true })
    .getByRole('treeitem', { name: /^A,/ })
    .press('Enter');
  await expect(page.getByText(/Резерв проекта: 2/)).toBeVisible();
  await page.keyboard.press('Escape');
  const undo = page.waitForResponse(
    (r) => r.url().endsWith('/commands') && r.request().method() === 'POST',
  );
  await page
    .getByRole('button', { name: 'Отменить последнее изменение', exact: true })
    .click();
  expect((await undo).status()).toBe(200);
  const restored = await readTree(page, runtime.origin, p10.project.id);
  expect(restored.tasks).toEqual(p10.tasks);
  expect(restored.schedule).toEqual(p10.schedule);
});

for (const focusDuringResponse of [false, true])
  test(
    'one-step undo ' +
      (focusDuringResponse
        ? 'preserves another control focus'
        : 'falls back to quick input when originating undo becomes disabled'),
    async ({ page, runtime }) => {
      const login = await page.request.post(
        runtime.origin + '/api/auth/login',
        {
          headers: { Origin: runtime.origin },
          data: { password: runtime.password },
        },
      );
      expect(login.status()).toBe(200);
      const created = await page.request.post(
        runtime.origin + '/api/projects',
        {
          headers: { Origin: runtime.origin, 'X-Leaf-Contract-Version': '2' },
          data: { title: 'Synthetic undo focus' },
        },
      );
      expect(created.status()).toBe(201);
      let tree = await readTree(
        page,
        runtime.origin,
        ((await created.json()) as { id: string }).id,
      );
      tree = await command(page, runtime.origin, tree, {
        type: 'task.create',
        title: 'A',
        parentId: null,
      });
      expect(tree.canUndo).toBe(true);
      await page.goto(runtime.origin);
      const undo = page.getByRole('button', {
        name: 'Отменить последнее изменение',
        exact: true,
      });
      await expect(undo).toBeEnabled();
      let captured!: () => void, release!: () => void;
      const reached = new Promise<void>((resolve) => {
          captured = resolve;
        }),
        held = new Promise<void>((resolve) => {
          release = resolve;
        });
      await page.route(
        '**/api/projects/' + tree.project.id + '/commands',
        async (route) => {
          const reply = await route.fetch();
          expect(reply.status()).toBe(200);
          captured();
          await held;
          await route.fulfill({ response: reply });
        },
        { times: 1 },
      );
      try {
        await undo.focus();
        await page.keyboard.press('Enter');
        await reached;
        await expect(undo).toBeDisabled();
        const other = page.getByRole('button', {
          name: 'Сегодня',
          exact: true,
        });
        if (focusDuringResponse) {
          await other.focus();
          await expect(other).toBeFocused();
        }
        const response = page.waitForResponse(
          (r) =>
            r.url().endsWith('/commands') && r.request().method() === 'POST',
        );
        release();
        expect((await response).status()).toBe(200);
        await expect(
          page.getByText('В проекте пока нет задач.', { exact: true }),
        ).toBeVisible();
        const current = await readTree(page, runtime.origin, tree.project.id);
        expect(current.project.revision).toBe(tree.project.revision + 1);
        expect(current.canUndo).toBe(false);
        expect(current.tasks).toEqual([]);
        await expect(undo).toBeDisabled();
        if (focusDuringResponse) await expect(other).toBeFocused();
        else
          await expect(
            page.getByLabel('Новая задача', { exact: true }),
          ).toBeFocused();
      } finally {
        release();
      }
    },
  );
