import { test as base, expect, type Page } from '@playwright/test';
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
async function readTree(
  page: Page,
  origin: string,
  projectId: string,
): Promise<ProjectTree> {
  const response = await page.request.get(
    `${origin}/api/projects/${projectId}/tree`,
  );
  expect(response.status()).toBe(200);
  return response.json();
}
async function command(
  page: Page,
  origin: string,
  tree: ProjectTree,
  value: Command,
): Promise<ProjectTree> {
  const response = await page.request.post(
    `${origin}/api/projects/${tree.project.id}/commands`,
    {
      headers: { Origin: origin },
      data: {
        expectedRevision: tree.project.revision,
        operationId: randomUUID(),
        command: value,
      },
    },
  );
  expect(response.status()).toBe(200);
  return response.json();
}
test('real scheduling API, tree panel edits, complete undo and process restart agree', async ({
  page,
  runtime,
}) => {
  await page.goto(runtime.origin);
  await page.getByLabel('Пароль', { exact: true }).fill(runtime.password);
  await page.getByRole('button', { name: 'Войти', exact: true }).click();
  await expect(
    page.getByRole('button', { name: 'Новый проект' }),
  ).toBeVisible();
  const created = await page.request.post(`${runtime.origin}/api/projects`, {
    headers: { Origin: runtime.origin },
    data: { title: 'Синтетическое расписание' },
  });
  expect(created.status()).toBe(201);
  const projectId = ((await created.json()) as { id: string }).id;
  let tree = await readTree(page, runtime.origin, projectId);
  tree = await command(page, runtime.origin, tree, {
    type: 'project.schedule',
    changes: { startDate: '2026-10-05', calendarType: 'all-days' },
  });
  for (const title of ['A', 'B', 'C', 'D'])
    tree = await command(page, runtime.origin, tree, {
      type: 'task.create',
      title,
      parentId: null,
    });
  const ids = Object.fromEntries(
    tree.tasks.map((task) => [task.title, task.id]),
  );
  for (const [title, durationDays] of [
    ['A', 2],
    ['B', 5],
    ['C', 3],
    ['D', 1],
  ] as const) {
    tree = await command(page, runtime.origin, tree, {
      type: 'task.plan',
      taskId: ids[title]!,
      plan: { mode: 'auto', durationDays },
    });
  }
  for (const [from, to] of [
    ['A', 'B'],
    ['B', 'D'],
    ['C', 'D'],
  ])
    tree = await command(page, runtime.origin, tree, {
      type: 'dependency.create',
      predecessorId: ids[from!]!,
      successorId: ids[to!]!,
    });
  expect(tree.schedule.projectFinishIndex).toBe(8);
  const original = structuredClone(tree);
  tree = await command(page, runtime.origin, tree, {
    type: 'task.plan',
    taskId: ids.C!,
    plan: { mode: 'auto', durationDays: 9 },
  });
  expect(tree.schedule.projectFinishIndex).toBe(10);
  expect(tree.schedule.criticalTaskIds.toSorted()).toEqual(
    [ids.C, ids.D].toSorted(),
  );
  await page.reload();
  await expect(
    page.getByRole('heading', { name: 'Синтетическое расписание' }),
  ).toBeVisible();
  await page
    .getByRole('button', { name: 'Отменить последнее изменение' })
    .click();
  await expect
    .poll(
      async () =>
        (await readTree(page, runtime.origin, projectId)).schedule
          .projectFinishIndex,
    )
    .toBe(8);
  tree = await readTree(page, runtime.origin, projectId);
  expect(tree.schedule).toEqual(original.schedule);
  expect(tree.dependencies).toEqual(original.dependencies);
  await page
    .getByRole('tree', { name: 'Задачи', exact: true })
    .getByRole('treeitem', { name: /^C,/ })
    .click();
  await page.getByLabel('Название задачи').fill('C revised');
  await page.getByRole('button', { name: 'Сохранить', exact: true }).click();
  await expect(page.getByText('Сохранено', { exact: true })).toBeVisible();
  tree = await readTree(page, runtime.origin, projectId);
  expect(tree.schedule).toEqual(original.schedule);
  const saved = structuredClone(tree);
  await runtime.restart();
  await page.reload();
  await expect(
    page
      .getByRole('tree', { name: 'Задачи', exact: true })
      .getByRole('treeitem', { name: /^C revised,/ }),
  ).toBeVisible();
  const reopened = await readTree(page, runtime.origin, projectId);
  expect(reopened.tasks).toEqual(saved.tasks);
  expect(reopened.dependencies).toEqual(saved.dependencies);
  expect(reopened.schedule).toEqual(saved.schedule);
  const response = await page.request.get(
    `${runtime.origin}/api/projects/${projectId}/schedule`,
  );
  expect(await response.json()).toEqual({
    projectId,
    revision: reopened.project.revision,
    schedule: saved.schedule,
  });
});

test('tree create and move confirmations preserve undated done and linked Auto work atomically', async ({
  page,
  runtime,
}) => {
  await page.goto(runtime.origin);
  await page.getByLabel('Пароль', { exact: true }).fill(runtime.password);
  await page.getByRole('button', { name: 'Войти', exact: true }).click();
  await expect(
    page.getByRole('button', { name: 'Новый проект' }),
  ).toBeVisible();
  const created = await page.request.post(`${runtime.origin}/api/projects`, {
    headers: { Origin: runtime.origin },
    data: { title: 'Сохранение собственной работы' },
  });
  expect(created.status()).toBe(201);
  const projectId = ((await created.json()) as { id: string }).id;
  let tree = await readTree(page, runtime.origin, projectId);
  tree = await command(page, runtime.origin, tree, {
    type: 'project.schedule',
    changes: { startDate: '2026-10-05', calendarType: 'all-days' },
  });
  for (const title of [
    'Undated done',
    'Auto work',
    'Move child',
    'Predecessor',
    'Successor',
  ])
    tree = await command(page, runtime.origin, tree, {
      type: 'task.create',
      title,
      parentId: null,
    });
  const ids = Object.fromEntries(
    tree.tasks.map((task) => [task.title, task.id]),
  );
  tree = await command(page, runtime.origin, tree, {
    type: 'task.plan',
    taskId: ids['Auto work']!,
    plan: { mode: 'auto', durationDays: 3, deadline: '2026-10-20' },
  });
  for (const [predecessorId, successorId] of [
    [ids.Predecessor!, ids['Auto work']!],
    [ids['Auto work']!, ids.Successor!],
  ] as const)
    tree = await command(page, runtime.origin, tree, {
      type: 'dependency.create',
      predecessorId,
      successorId,
    });
  await page.reload();
  const mainTree = page.getByRole('tree', { name: 'Задачи', exact: true });
  await mainTree.getByRole('treeitem', { name: /^Undated done,/ }).click();
  await page.getByLabel('Статус').selectOption('done');
  await page.getByRole('button', { name: 'Сохранить', exact: true }).click();
  await expect(page.getByText('Сохранено', { exact: true })).toBeVisible();
  tree = await readTree(page, runtime.origin, projectId);
  expect(
    tree.tasks.find((task) => task.id === ids['Undated done']),
  ).toMatchObject({ status: 'done', inputStart: null, inputFinish: null });
  const beforeCreate = structuredClone(tree);
  await page.getByRole('button', { name: 'Добавить подзадачу' }).click();
  const quick = page.getByLabel('Новая задача');
  await quick.fill('New child');
  async function confirm(accept: boolean, action: () => Promise<void>) {
    const handled = new Promise<void>((resolve, reject) => {
      page.once('dialog', async (dialog) => {
        try {
          expect(dialog.message()).toContain('сохранить');
          if (accept) await dialog.accept();
          else await dialog.dismiss();
          resolve();
        } catch (error) {
          reject(error);
        }
      });
    });
    await action();
    await handled;
  }
  await confirm(false, () => quick.press('Enter'));
  expect(await readTree(page, runtime.origin, projectId)).toEqual(beforeCreate);
  await expect(quick).toHaveValue('New child');
  await confirm(true, () => quick.press('Enter'));
  await expect(
    mainTree.getByRole('treeitem', { name: /^New child,/ }),
  ).toBeVisible();
  tree = await readTree(page, runtime.origin, projectId);
  const ownDone = tree.tasks.find(
    (task) =>
      task.parentId === ids['Undated done'] && task.title === 'Undated done',
  )!;
  expect(ownDone.status).toBe('done');
  expect(
    tree.tasks.filter((task) => task.parentId === ids['Undated done']),
  ).toHaveLength(2);
  expect(
    tree.tasks.find((task) => task.id === ids['Undated done']),
  ).toMatchObject({ status: 'todo', planMode: 'unscheduled' });
  const beforeMove = structuredClone(tree);
  const moveRow = mainTree.getByRole('treeitem', { name: /^Move child,/ });
  await moveRow.focus();
  await confirm(false, () => page.keyboard.press('Alt+ArrowRight'));
  expect(await readTree(page, runtime.origin, projectId)).toEqual(beforeMove);
  await moveRow.focus();
  await confirm(true, () => page.keyboard.press('Alt+ArrowRight'));
  await expect
    .poll(
      async () =>
        (await readTree(page, runtime.origin, projectId)).tasks.find(
          (task) => task.id === ids['Move child'],
        )!.parentId,
    )
    .toBe(ids['Auto work']);
  tree = await readTree(page, runtime.origin, projectId);
  const ownAuto = tree.tasks.find(
    (task) => task.parentId === ids['Auto work'] && task.title === 'Auto work',
  )!;
  expect(ownAuto).toMatchObject({
    planMode: 'auto',
    durationDays: 3,
    deadline: '2026-10-20',
  });
  expect(tree.tasks.find((task) => task.id === ids['Auto work'])).toMatchObject(
    { planMode: 'unscheduled', durationDays: null, deadline: null },
  );
  expect(tree.dependencies).toEqual(
    beforeMove.dependencies.map((edge) => ({
      ...edge,
      predecessorId:
        edge.predecessorId === ids['Auto work']
          ? ownAuto.id
          : edge.predecessorId,
      successorId:
        edge.successorId === ids['Auto work'] ? ownAuto.id : edge.successorId,
    })),
  );
});
