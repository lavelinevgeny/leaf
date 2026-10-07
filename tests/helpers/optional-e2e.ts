import { expect, type Page } from '@playwright/test';
import { randomUUID } from 'node:crypto';
import type { Command, ProjectTree } from '../../src/shared/contracts.js';
import type { syntheticRuntime } from '../../scripts/e2e-server.js';
export async function readTree(
  page: Page,
  origin: string,
  projectId: string,
): Promise<ProjectTree> {
  const response = await page.request.get(
    `${origin}/api/projects/${projectId}/tree`,
    { headers: { 'X-Leaf-Contract-Version': '2' } },
  );
  expect(response.status()).toBe(200);
  return response.json();
}
export async function send(
  page: Page,
  origin: string,
  tree: ProjectTree,
  command: Command,
): Promise<ProjectTree> {
  const response = await page.request.post(
    `${origin}/api/projects/${tree.project.id}/commands`,
    {
      headers: { Origin: origin, 'X-Leaf-Contract-Version': '2' },
      data: {
        contractVersion: 2,
        expectedRevision: tree.project.revision,
        operationId: randomUUID(),
        command,
      },
    },
  );
  expect(response.status()).toBe(200);
  return response.json();
}
export async function seedOptionalRuntime(
  page: Page,
  runtime: Awaited<ReturnType<typeof syntheticRuntime>>,
): Promise<ProjectTree> {
  const login = await page.request.post(`${runtime.origin}/api/auth/login`, {
    headers: { Origin: runtime.origin },
    data: { password: runtime.password },
  });
  expect(login.status()).toBe(200);
  const created = await page.request.post(`${runtime.origin}/api/projects`, {
    headers: { Origin: runtime.origin, 'X-Leaf-Contract-Version': '2' },
    data: { title: 'Демо-проект' },
  });
  expect(created.status()).toBe(201);
  let tree = await readTree(page, runtime.origin, (await created.json()).id);
  tree = await send(page, runtime.origin, tree, {
    type: 'task.create',
    title: 'Этап P',
    parentId: null,
  });
  const parentId = tree.tasks[0]!.id;
  for (const title of ['Работа A', 'Работа C'])
    tree = await send(page, runtime.origin, tree, {
      type: 'task.create',
      title,
      parentId,
    });
  tree = await send(page, runtime.origin, tree, {
    type: 'task.edit',
    taskId: tree.tasks.find((t) => t.title === 'Работа A')!.id,
    changes: { inputStart: '2026-10-05', inputFinish: '2026-10-06' },
  });
  return send(page, runtime.origin, tree, {
    type: 'task.edit',
    taskId: tree.tasks.find((t) => t.title === 'Работа C')!.id,
    changes: { durationDays: 3 },
  });
}
