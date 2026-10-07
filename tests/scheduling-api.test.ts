import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { buildApp, type LeafApp } from '../src/server/app.js';
import * as scheduling from '../src/domain/scheduling.js';
import {
  projectTreeSchema,
  type Command,
  type ProjectTree,
} from '../src/shared/contracts.js';

let app: LeafApp;
let directory: string;
let cookie: string;
const origin = 'http://127.0.0.1:3000';
const headers = () => ({ origin, cookie: `leaf_session=${cookie}` });
beforeEach(async () => {
  directory = mkdtempSync(join(tmpdir(), 'leaf-scheduling-api-'));
  app = await buildApp({
    databasePath: join(directory, 'synthetic.sqlite'),
    publicOrigin: origin,
  });
  const password = 'Synthetic-scheduling-test-passphrase';
  await app.auth.setup(password);
  const login = await app.inject({
    method: 'POST',
    url: '/api/auth/login',
    headers: { origin },
    payload: { password },
  });
  cookie = login.cookies[0]!.value;
});
afterEach(async () => {
  vi.restoreAllMocks();
  await app.close();
  rmSync(directory, { recursive: true, force: true });
});
function tree() {
  return app.repository.getTree(
    app.repository.createProject('Synthetic API plan').id,
    app.auth.session(cookie)!,
  );
}
function send(
  current: ProjectTree,
  command: Command | object,
  operationId = randomUUID(),
) {
  return app.inject({
    method: 'POST',
    url: `/api/projects/${current.project.id}/commands`,
    headers: headers(),
    payload: {
      expectedRevision: current.project.revision,
      operationId,
      command,
    },
  });
}
async function step(current: ProjectTree, command: Command) {
  const response = await send(current, command);
  expect(response.statusCode).toBe(200);
  return projectTreeSchema.parse(response.json());
}
describe('scheduling HTTP contract', () => {
  it('accepts a combined edit and rejects empty edits, legacy date fields and summary plans', async () => {
    let current = await step(tree(), {
      type: 'task.create',
      title: 'A',
      parentId: null,
    });
    const taskId = current.tasks[0]!.id;
    const before = current;
    current = await step(current, {
      type: 'task.edit',
      taskId,
      changes: { title: 'A revised' },
      plan: { mode: 'auto', durationDays: 3 },
    });
    expect(current.project.revision).toBe(before.project.revision + 1);
    expect(current.tasks[0]).toMatchObject({
      title: 'A revised',
      durationDays: 3,
    });
    for (const command of [
      { type: 'task.edit', taskId, changes: {} },
      { type: 'task.edit', taskId, changes: { inputStart: '2026-10-05' } },
      {
        type: 'task.edit',
        taskId,
        changes: { title: 'Rejected' },
        plan: { mode: 'auto', durationDays: 0 },
      },
    ])
      expect((await send(current, command)).statusCode).toBe(400);
    const undone = await step(current, { type: 'undo' });
    expect(undone.tasks).toEqual(before.tasks);
    current = await step(undone, {
      type: 'task.create',
      title: 'Child',
      parentId: taskId,
    });
    const response = await send(current, {
      type: 'task.edit',
      taskId,
      changes: { title: 'Rejected summary' },
      plan: { mode: 'auto', durationDays: 2 },
    });
    expect(response.statusCode).toBe(400);
    expect(response.json().code).toBe('SUMMARY_PLANNING');
    expect(
      app.repository.getTree(current.project.id, app.auth.session(cookie)!),
    ).toEqual(current);
  });
  it('returns a revision-consistent authenticated schedule and validates the full tree schema', async () => {
    let current = tree();
    const url = `/api/projects/${current.project.id}/schedule`;
    expect((await app.inject(url)).statusCode).toBe(401);
    current = await step(current, {
      type: 'project.schedule',
      changes: {
        startDate: '2026-10-09',
        calendarType: 'weekdays',
        timezone: 'UTC',
      },
    });
    current = await step(current, {
      type: 'task.create',
      title: 'A',
      parentId: null,
    });
    current = await step(current, {
      type: 'task.plan',
      taskId: current.tasks[0]!.id,
      plan: { mode: 'auto', durationDays: 2 },
    });
    const response = await app.inject({ url, headers: headers() });
    expect(response.statusCode).toBe(200);
    expect(response.headers['cache-control']).toBe('no-store');
    expect(response.json()).toEqual({
      projectId: current.project.id,
      revision: current.project.revision,
      schedule: current.schedule,
    });
    expect(current.schedule.tasks[current.tasks[0]!.id]!.finishDate).toBe(
      '2026-10-12',
    );
    const malformed = await app.inject({
      url: '/api/projects/invalid/schedule',
      headers: headers(),
    });
    expect(malformed.statusCode).toBe(400);
  });
  it('rejects unknown planning fields, empty changes, invalid durations and invalid timezones without mutation', async () => {
    let current = tree();
    current = await step(current, {
      type: 'task.create',
      title: 'A',
      parentId: null,
    });
    for (const command of [
      { type: 'project.schedule', changes: {} },
      { type: 'project.schedule', changes: { timezone: 'Synthetic/Invalid' } },
      { type: 'project.schedule', changes: { startDate: '2026-02-30' } },
      {
        type: 'task.plan',
        taskId: current.tasks[0]!.id,
        plan: { mode: 'auto', durationDays: 0 },
      },
      {
        type: 'task.plan',
        taskId: current.tasks[0]!.id,
        plan: { mode: 'auto', durationDays: 1.5 },
      },
      {
        type: 'task.plan',
        taskId: current.tasks[0]!.id,
        plan: { mode: 'auto', durationDays: 1000001 },
      },
      {
        type: 'task.plan',
        taskId: current.tasks[0]!.id,
        plan: { mode: 'auto', durationDays: 2, inputFinish: '2026-10-10' },
      },
    ]) {
      const response = await send(current, command);
      expect(response.statusCode).toBe(400);
      expect(Object.keys(response.json())).toEqual(['code', 'message']);
      expect(
        app.repository.getTree(current.project.id, app.auth.session(cookie)!),
      ).toEqual(current);
    }
  });
  it('retains exact operation responses, conflict status and origin enforcement for schedule writes', async () => {
    const current = tree();
    const command: Command = {
      type: 'project.schedule',
      changes: { startDate: '2026-10-05' },
    };
    const operationId = randomUUID();
    const first = await send(current, command, operationId);
    expect(first.statusCode).toBe(200);
    expect((await send(current, command, operationId)).json()).toEqual(
      first.json(),
    );
    expect((await send(current, command)).statusCode).toBe(409);
    const forbidden = await app.inject({
      method: 'POST',
      url: `/api/projects/${current.project.id}/commands`,
      headers: {
        cookie: `leaf_session=${cookie}`,
        origin: 'http://wrong.example.test',
      },
      payload: { expectedRevision: 1, operationId: randomUUID(), command },
    });
    expect(forbidden.statusCode).toBe(403);
    const undone = await step(first.json<ProjectTree>(), { type: 'undo' });
    expect(undone.project.startDate).toBeNull();
    expect(undone.schedule.originDate).toBeNull();
  });
  it.each([{ projectId: 'synthetic-invalid-project-id' }, { revision: -1 }])(
    'rejects malformed GET schedule envelopes with a safe internal error: %j',
    async (corruption) => {
      const current = tree();
      vi.spyOn(app.repository, 'getSchedule').mockReturnValue({
        projectId: current.project.id,
        revision: current.project.revision,
        schedule: current.schedule,
        ...corruption,
      });
      const response = await app.inject({
        url: `/api/projects/${current.project.id}/schedule`,
        headers: headers(),
      });
      expect(response.statusCode).toBe(500);
      expect(response.json()).toEqual({
        code: 'INTERNAL_ERROR',
        message: 'Не удалось выполнить запрос.',
      });
    },
  );
  it('rejects malformed computed GET tree and schedule results with safe internal errors', async () => {
    const current = tree();
    const calculate = scheduling.calculateSchedule;
    vi.spyOn(scheduling, 'calculateSchedule').mockImplementation((input) => ({
      ...calculate(input),
      originDate: 'synthetic-internal-invalid-date',
    }));
    for (const route of ['tree', 'schedule']) {
      const response = await app.inject({
        url: `/api/projects/${current.project.id}/${route}`,
        headers: headers(),
      });
      expect(response.statusCode).toBe(500);
      expect(response.json()).toEqual({
        code: 'INTERNAL_ERROR',
        message: 'Не удалось выполнить запрос.',
      });
    }
  });
  it('maps malformed computed command responses to 500 while retaining 400 for malformed user requests', async () => {
    const current = tree();
    const calculate = scheduling.calculateSchedule;
    const spy = vi
      .spyOn(scheduling, 'calculateSchedule')
      .mockImplementation((input) => ({
        ...calculate(input),
        projectFinishIndex: 1.5,
      }));
    const response = await send(current, {
      type: 'project.schedule',
      changes: { startDate: '2026-10-05' },
    });
    expect(response.statusCode).toBe(500);
    expect(response.json()).toEqual({
      code: 'INTERNAL_ERROR',
      message: 'Не удалось выполнить запрос.',
    });
    spy.mockRestore();
    expect(
      app.repository.getTree(current.project.id, app.auth.session(cookie)!),
    ).toEqual(current);
    const invalidRequest = await send(current, {
      type: 'project.schedule',
      changes: { startDate: 'synthetic-invalid-user-date' },
    });
    expect(invalidRequest.statusCode).toBe(400);
    expect(invalidRequest.json()).toEqual({
      code: 'INVALID_REQUEST',
      message: 'Проверьте поля запроса.',
    });
  });
});
