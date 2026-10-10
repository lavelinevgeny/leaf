import {
  test as base,
  expect,
  type Page,
  type Locator,
} from '@playwright/test';
import { randomUUID } from 'node:crypto';
import { syntheticRuntime } from '../../scripts/e2e-server.js';
import type {
  JournalMutation,
  JournalPage,
} from '../../src/shared/journal-contracts.js';
import type { ProjectTree } from '../../src/shared/contracts.js';
import { seedOptionalRuntime, send } from './optional-e2e.js';
export const test = base.extend<{
  runtime: Awaited<ReturnType<typeof syntheticRuntime>>;
}>({
  runtime: async ({ context }, use) => {
    const runtime = await syntheticRuntime();
    try {
      await use(runtime);
    } finally {
      try {
        await context.close();
      } finally {
        await runtime.close();
      }
    }
  },
});
export { expect };
export async function createJournalEntry(
  page: Page,
  origin: string,
  projectId: string,
  taskId: string,
  revision: number,
  body: string,
  workDate: string,
): Promise<JournalMutation> {
  const response = await page.request.post(
    `${origin}/api/projects/${projectId}/journal`,
    {
      headers: { Origin: origin, 'X-Leaf-Contract-Version': '2' },
      data: {
        journalContractVersion: 1,
        operationId: randomUUID(),
        expectedJournalRevision: revision,
        taskId,
        body,
        workDate,
      },
    },
  );
  expect(response.status()).toBe(201);
  return response.json();
}
export async function readJournalPage(
  page: Page,
  origin: string,
  projectId: string,
): Promise<JournalPage> {
  const response = await page.request.get(
    `${origin}/api/projects/${projectId}/journal`,
    { headers: { 'X-Leaf-Contract-Version': '2' } },
  );
  expect(response.status()).toBe(200);
  return response.json();
}
export async function mutateJournal(
  page: Page,
  origin: string,
  projectId: string,
  entryId: string,
  revision: number,
  changes?: { body: string; workDate: string },
): Promise<JournalMutation> {
  const response = await page.request.fetch(
    `${origin}/api/projects/${projectId}/journal/${entryId}`,
    {
      method: changes ? 'PATCH' : 'DELETE',
      headers: { Origin: origin, 'X-Leaf-Contract-Version': '2' },
      data: {
        journalContractVersion: 1,
        operationId: randomUUID(),
        expectedJournalRevision: revision,
        ...changes,
      },
    },
  );
  expect(response.status()).toBe(200);
  return response.json();
}
export async function seedJournal(
  page: Page,
  runtime: Awaited<ReturnType<typeof syntheticRuntime>>,
) {
  let tree = await seedOptionalRuntime(page, runtime);
  const doneId = tree.tasks.find((t) => t.title === 'Работа A')!.id;
  tree = await send(page, runtime.origin, tree, {
    type: 'task.edit',
    taskId: doneId,
    changes: { status: 'done' },
  });
  tree = await send(page, runtime.origin, tree, {
    type: 'task.create',
    parentId: null,
    title: 'Без дат',
  });
  let parentId = tree.tasks.find((t) => t.title === 'Без дат')!.id;
  for (let depth = 1; depth <= 5; depth++) {
    tree = await send(page, runtime.origin, tree, {
      type: 'task.create',
      parentId,
      title: `Уровень ${depth}`,
    });
    parentId = tree.tasks.find((t) => t.title === `Уровень ${depth}`)!.id;
  }
  return {
    tree,
    summaryId: tree.tasks.find((t) => t.title === 'Этап P')!.id,
    doneId,
    deepId: parentId,
  };
}
export function projectFeed(page: Page) {
  return page.locator('#project-view-journal');
}
export function entryCard(page: Page, id: string) {
  return projectFeed(page).locator(`[data-journal-entry-id="${id}"]`);
}
export async function openProjectJournal(page: Page, origin: string) {
  await page.goto(origin);
  await page
    .getByRole('tablist', { name: 'Представление проекта' })
    .getByRole('tab', { name: 'Журнал', exact: true })
    .click();
  await expect(projectFeed(page)).toBeVisible();
  await expect(
    projectFeed(page).getByRole('button', {
      name: 'Добавить запись',
      exact: true,
    }),
  ).toBeEnabled();
}
export async function editEntry(page: Page, id: string) {
  const card = entryCard(page, id);
  await card.getByRole('button', { name: /Действия записи/ }).click();
  await card.getByRole('menuitem', { name: 'Редактировать запись' }).click();
  return card.locator('[data-journal-editor]');
}
export async function chooseTask(dialog: Locator, path: string) {
  await dialog
    .getByRole('button', { name: 'Выбрать задачу', exact: true })
    .click();
  await dialog.getByRole('combobox', { name: 'Поиск задачи' }).fill(path);
  await dialog.getByRole('option').last().click();
}
export async function journalGeometry(page: Page) {
  return projectFeed(page).evaluate((node) => {
    const scroll = node.querySelector<HTMLElement>('[data-journal-scroll]')!;
    const top = scroll.getBoundingClientRect().top;
    const first = [
      ...scroll.querySelectorAll<HTMLElement>('[data-journal-entry-id]'),
    ].find((n) => n.getBoundingClientRect().bottom > top)!;
    const card = first.querySelector('article')!.getBoundingClientRect();
    const controls = node
      .querySelector('.journal-controls')!
      .getBoundingClientRect();
    const header = document
      .querySelector('.workspace-header')!
      .getBoundingClientRect();
    return {
      id: first.dataset.journalEntryId,
      offset: first.getBoundingClientRect().top - top,
      left: scroll.scrollLeft,
      cardX: card.x,
      cardWidth: card.width,
      controlsX: controls.x,
      controlsWidth: controls.width,
      controlsY: controls.y,
      headerY: header.y,
      headerHeight: header.height,
    };
  });
}
export async function assertPrivateBrowserState(page: Page, values: string[]) {
  const state = await page.evaluate(() =>
    JSON.stringify({
      local: { ...localStorage },
      session: { ...sessionStorage },
      history: history.state,
      url: location.href,
    }),
  );
  for (const value of values) expect(state).not.toContain(value);
}
export function planContent(tree: ProjectTree) {
  return {
    project: tree.project,
    tasks: tree.tasks,
    dependencies: tree.dependencies,
    schedule: tree.schedule,
    canUndo: tree.canUndo,
  };
}
