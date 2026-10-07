import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { openDatabase } from '../src/server/database.js';
import { Repository } from '../src/server/repository.js';
import * as scheduling from '../src/domain/scheduling.js';
import {
  projectTreeSchema,
  type Command,
  type ProjectTree,
} from '../src/shared/contracts.js';

let directory: string;
let db: ReturnType<typeof openDatabase>;
let repository: Repository;
const session = 'synthetic-scheduling-session';
beforeEach(() => {
  directory = mkdtempSync(join(tmpdir(), 'leaf-scheduling-storage-'));
  db = openDatabase(join(directory, 'synthetic.sqlite'));
  repository = new Repository(db);
});
afterEach(() => {
  vi.restoreAllMocks();
  if (db.open) db.close();
  rmSync(directory, { recursive: true, force: true });
});
function step(tree: ProjectTree, command: Command, sessionId = session) {
  return repository.applyCommand(
    tree.project.id,
    {
      expectedRevision: tree.project.revision,
      operationId: randomUUID(),
      command,
    },
    sessionId,
  );
}
function fresh() {
  const project = repository.createProject('Synthetic schedule');
  return step(repository.getTree(project.id, session), {
    type: 'project.schedule',
    changes: { startDate: '2026-10-05', calendarType: 'all-days' },
  });
}
function create(
  tree: ProjectTree,
  title: string,
  parentId: string | null = null,
) {
  return step(tree, { type: 'task.create', title, parentId });
}
const id = (tree: ProjectTree, title: string) =>
  tree.tasks.find((t) => t.title === title)!.id;
function auto(tree: ProjectTree, title: string, durationDays: number) {
  return step(tree, {
    type: 'task.plan',
    taskId: id(tree, title),
    plan: { mode: 'auto', durationDays },
  });
}
function edge(tree: ProjectTree, from: string, to: string) {
  return step(tree, {
    type: 'dependency.create',
    predecessorId: id(tree, from),
    successorId: id(tree, to),
  });
}
function parallel() {
  let tree = create(fresh(), 'Summary');
  const parent = id(tree, 'Summary');
  for (const title of ['A', 'B', 'C', 'D']) tree = create(tree, title, parent);
  for (const [title, days] of [
    ['A', 2],
    ['B', 5],
    ['C', 3],
    ['D', 1],
  ] as const)
    tree = auto(tree, title, days);
  tree = edge(tree, 'A', 'B');
  tree = edge(tree, 'B', 'D');
  return edge(tree, 'C', 'D');
}
function counts() {
  return ['operations', 'undo_snapshots', 'dependencies'].map((table) =>
    db.prepare(`SELECT COUNT(*) AS count FROM ${table}`).get(),
  );
}
describe('scheduling transactions', () => {
  it('switches critical branches and ancestor bounds, restores one change with undo and survives reopen', () => {
    const before = parallel();
    expect(before.schedule.projectFinishIndex).toBe(8);
    expect(before.schedule.criticalTaskIds.toSorted()).toEqual(
      ['A', 'B', 'D'].map((title) => id(before, title)).toSorted(),
    );
    expect(before.schedule.tasks[id(before, 'C')]!.projectFloat).toBe(4);
    expect(before.schedule.summaries[id(before, 'Summary')]).toMatchObject({
      start: 0,
      finish: 8,
      partial: false,
    });
    const after = auto(before, 'C', 9);
    expect(after.schedule.projectFinishIndex).toBe(10);
    expect(after.schedule.criticalTaskIds.toSorted()).toEqual(
      ['C', 'D'].map((title) => id(after, title)).toSorted(),
    );
    expect(after.schedule.summaries[id(after, 'Summary')]!.finish).toBe(10);
    const undone = step(after, { type: 'undo' });
    expect(undone.tasks).toEqual(before.tasks);
    expect(undone.dependencies).toEqual(before.dependencies);
    expect(undone.schedule).toEqual(before.schedule);
    db.close();
    db = openDatabase(join(directory, 'synthetic.sqlite'));
    repository = new Repository(db);
    const reopened = repository.getTree(before.project.id, session);
    expect(reopened.schedule).toEqual(before.schedule);
    expect(reopened.dependencies).toEqual(before.dependencies);
  });
  it('rejects cycles with an ID chain, duplicates, self links, summaries and foreign endpoints atomically', () => {
    const before = parallel();
    const foreign = create(fresh(), 'Foreign');
    const a = id(before, 'A');
    const b = id(before, 'B');
    const d = id(before, 'D');
    const baseline = counts();
    for (const [from, to] of [
      [d, a],
      [a, b],
      [a, a],
      [id(before, 'Summary'), a],
      [id(foreign, 'Foreign'), a],
    ]) {
      expect(() =>
        step(before, {
          type: 'dependency.create',
          predecessorId: from!,
          successorId: to!,
        }),
      ).toThrow();
      expect(repository.getTree(before.project.id, session)).toEqual(before);
      expect(counts()).toEqual(baseline);
    }
    try {
      step(before, {
        type: 'dependency.create',
        predecessorId: d,
        successorId: a,
      });
      expect.fail('A dependency cycle must be rejected');
    } catch (error) {
      expect(error).toMatchObject({ code: 'DEPENDENCY_CYCLE' });
      expect((error as Error).message).toContain(`${d} → ${a} → ${b} → ${d}`);
    }
  });
  it('preserves the original operation response after a later schedule change and rejects stale revisions', () => {
    const before = parallel();
    const envelope = {
      expectedRevision: before.project.revision,
      operationId: randomUUID(),
      command: {
        type: 'task.plan' as const,
        taskId: id(before, 'C'),
        plan: { mode: 'auto' as const, durationDays: 9 },
      },
    };
    const first = repository.applyCommand(before.project.id, envelope, session);
    const latest = auto(first, 'C', 12);
    expect(
      repository.applyCommand(before.project.id, envelope, session),
    ).toEqual(first);
    expect(repository.getTree(latest.project.id, session)).toEqual(latest);
    expect(() =>
      step(before, {
        type: 'dependency.delete',
        dependencyId: first.dependencies[0]!.id,
      }),
    ).toThrowError(/ревизи/i);
  });
  it('cannot undo another session schedule mutation', () => {
    const before = parallel();
    const after = step(
      before,
      { type: 'project.schedule', changes: { calendarType: 'weekdays' } },
      'synthetic-other-session',
    );
    expect(() => step(after, { type: 'undo' })).toThrowError(/отмен/i);
    expect(repository.getTree(before.project.id, session).schedule).toEqual(
      after.schedule,
    );
  });
  it('rolls back settings, tasks, edges, undo and operations when storage fails', () => {
    const before = parallel();
    const baseline = counts();
    db.exec(
      "CREATE TRIGGER synthetic_schedule_failure BEFORE INSERT ON operations BEGIN SELECT RAISE(ABORT, 'Synthetic storage failure'); END",
    );
    expect(() =>
      step(before, {
        type: 'project.schedule',
        changes: { startDate: '2026-10-12' },
      }),
    ).toThrow();
    expect(() =>
      step(before, {
        type: 'dependency.delete',
        dependencyId: before.dependencies[0]!.id,
      }),
    ).toThrow();
    expect(() => auto(before, 'C', 9)).toThrow();
    expect(repository.getTree(before.project.id, session)).toEqual(before);
    expect(counts()).toEqual(baseline);
  });
  it('retains fixed dates and distinguishes project slack, fixed slack and hard conflicts', () => {
    let tree = fresh();
    for (const title of ['A', 'B', 'C']) tree = create(tree, title);
    tree = auto(tree, 'A', 2);
    tree = auto(tree, 'C', 10);
    tree = step(tree, {
      type: 'task.plan',
      taskId: id(tree, 'B'),
      plan: {
        mode: 'fixed',
        inputStart: '2026-10-10',
        inputFinish: '2026-10-10',
      },
    });
    tree = edge(tree, 'A', 'B');
    expect(tree.schedule.tasks[id(tree, 'A')]).toMatchObject({
      projectFloat: 7,
      constraintFloat: 3,
    });
    expect(tree.schedule.tasks[id(tree, 'B')]).toMatchObject({
      projectFloat: 4,
      constraintFloat: 0,
    });
    tree = auto(tree, 'A', 7);
    expect(tree.schedule.feasibility).toBe('infeasible');
    expect(
      tree.schedule.diagnostics.some(
        (d) => d.code === 'FIXED_PRECEDENCE_CONFLICT',
      ),
    ).toBe(true);
    expect(tree.schedule.criticalTaskIds).toEqual([]);
    expect(tree.tasks.find((t) => t.title === 'B')!.inputStart).toBe(
      '2026-10-10',
    );
  });
  it('keeps unknown tasks and dependent work incomplete without duration zero', () => {
    let tree = create(fresh(), 'Unknown');
    tree = create(tree, 'Known');
    tree = auto(tree, 'Known', 2);
    tree = edge(tree, 'Unknown', 'Known');
    expect(tree.schedule.feasibility).toBe('incomplete');
    expect(tree.schedule.tasks[id(tree, 'Known')]!.ES).toBeNull();
    expect(
      tree.schedule.tasks[id(tree, 'Known')]!.blockedReason,
    ).not.toBeNull();
    expect(
      tree.tasks.find((t) => t.title === 'Unknown')!.durationDays,
    ).toBeNull();
  });
  it('uses weekdays and optional origin, and keeps deadline warning separate from criticality', () => {
    let tree = create(fresh(), 'A');
    tree = create(tree, 'B');
    tree = auto(tree, 'A', 1);
    tree = auto(tree, 'B', 1);
    tree = edge(tree, 'A', 'B');
    tree = step(tree, {
      type: 'project.schedule',
      changes: { startDate: '2026-10-09', calendarType: 'weekdays' },
    });
    expect(tree.schedule.tasks[id(tree, 'A')]!.finishDate).toBe('2026-10-09');
    expect(tree.schedule.tasks[id(tree, 'B')]!.startDate).toBe('2026-10-12');
    tree = step(tree, {
      type: 'task.plan',
      taskId: id(tree, 'B'),
      plan: { mode: 'auto', durationDays: 3, deadline: '2026-10-12' },
    });
    expect(tree.schedule.feasibility).toBe('feasible');
    expect(
      tree.schedule.diagnostics.some((d) => d.code === 'DEADLINE_EXCEEDED'),
    ).toBe(true);
    expect(tree.schedule.criticalTaskIds).toContain(id(tree, 'B'));
    tree = step(tree, {
      type: 'project.schedule',
      changes: { startDate: null },
    });
    expect(tree.schedule.originDate).toBeNull();
    expect(tree.schedule.tasks[id(tree, 'A')]!.startDate).toBeNull();
    expect(tree.schedule.feasibility).toBe('incomplete');
  });
  it('rejects newly fixed weekend dates and direct edits of calculated fields', () => {
    let tree = create(fresh(), 'A');
    tree = step(tree, {
      type: 'project.schedule',
      changes: { calendarType: 'weekdays' },
    });
    expect(() =>
      step(tree, {
        type: 'task.plan',
        taskId: id(tree, 'A'),
        plan: {
          mode: 'fixed',
          inputStart: '2026-10-10',
          inputFinish: '2026-10-10',
        },
      }),
    ).toThrow();
    tree = auto(tree, 'A', 2);
    expect(() =>
      step(tree, {
        type: 'task.update',
        taskId: id(tree, 'A'),
        changes: { inputStart: '2026-10-12' },
      }),
    ).toThrow();
    expect(repository.getTree(tree.project.id, session)).toEqual(tree);
  });
  it('locks completed dates against predecessor changes and restores Auto on explicit return', () => {
    let tree = create(fresh(), 'A');
    tree = create(tree, 'B');
    tree = auto(tree, 'A', 2);
    tree = auto(tree, 'B', 1);
    tree = edge(tree, 'A', 'B');
    tree = step(tree, {
      type: 'task.update',
      taskId: id(tree, 'B'),
      changes: { status: 'done' },
    });
    const completed = structuredClone(tree.schedule.tasks[id(tree, 'B')]);
    expect(() => auto(tree, 'B', 4)).toThrow();
    tree = auto(tree, 'A', 4);
    expect(tree.schedule.feasibility).toBe('infeasible');
    expect(tree.schedule.tasks[id(tree, 'B')]!.startDate).toBe(
      completed!.startDate,
    );
    expect(
      tree.schedule.tasks[id(tree, 'B')]!.EF! -
        tree.schedule.tasks[id(tree, 'B')]!.ES!,
    ).toBe(1);
    tree = step(tree, {
      type: 'task.update',
      taskId: id(tree, 'B'),
      changes: { status: 'todo' },
    });
    expect(tree.schedule.feasibility).toBe('feasible');
    expect(tree.schedule.tasks[id(tree, 'B')]!.ES).toBe(4);
    expect(tree.tasks.find((t) => t.title === 'B')!.planMode).toBe('auto');
  });
  it('moves both edge endpoints and complete own work to a confirmed work-child', () => {
    const before = parallel();
    const parentId = id(before, 'B');
    expect(() => create(before, 'New child', parentId)).toThrow();
    const after = step(before, {
      type: 'task.create',
      title: 'New child',
      parentId,
      preserveWork: true,
    });
    const work = after.tasks.find((t) => t.title === 'B' && t.id !== parentId)!;
    expect(work).toMatchObject({ parentId, planMode: 'auto', durationDays: 5 });
    expect(after.tasks.find((t) => t.id === parentId)).toMatchObject({
      planMode: 'unscheduled',
      durationDays: null,
    });
    expect(
      after.dependencies.some(
        (d) => d.predecessorId === parentId || d.successorId === parentId,
      ),
    ).toBe(false);
    expect(
      after.dependencies.filter(
        (d) => d.predecessorId === work.id || d.successorId === work.id,
      ),
    ).toHaveLength(2);
    expect(after.schedule.projectFinishIndex).toBe(
      before.schedule.projectFinishIndex,
    );
    expect(after.schedule.summaries[parentId]!.partial).toBe(true);
    const undone = step(after, { type: 'undo' });
    expect(undone.tasks).toEqual(before.tasks);
    expect(undone.dependencies).toEqual(before.dependencies);
    expect(undone.schedule).toEqual(before.schedule);
  });
  it('requires conversion of an undated connected leaf and deletion removes/restores incident edges', () => {
    let tree = create(fresh(), 'Unknown');
    tree = create(tree, 'Known');
    tree = edge(tree, 'Unknown', 'Known');
    expect(() => create(tree, 'Child', id(tree, 'Unknown'))).toThrow();
    const deleted = step(tree, {
      type: 'task.delete',
      taskId: id(tree, 'Unknown'),
    });
    expect(deleted.dependencies).toEqual([]);
    const undone = step(deleted, { type: 'undo' });
    expect(undone.dependencies).toEqual(tree.dependencies);
    expect(undone.schedule).toEqual(tree.schedule);
  });
  it('ignores sibling order, names and descriptions when calculating dates', () => {
    const before = parallel();
    let tree = step(before, {
      type: 'task.update',
      taskId: id(before, 'C'),
      changes: { title: 'Renamed', description: 'Synthetic text' },
    });
    tree = step(tree, {
      type: 'task.move',
      taskId: id(tree, 'Renamed'),
      parentId: id(tree, 'Summary'),
      position: 0,
    });
    expect(tree.schedule).toEqual(before.schedule);
  });
  it('preserves deadline across planning modes, retains Auto release, and clears obsolete interval inputs', () => {
    let tree = create(fresh(), 'A');
    const taskId = id(tree, 'A');
    tree = step(tree, {
      type: 'task.plan',
      taskId,
      plan: {
        mode: 'auto',
        durationDays: 2,
        notBefore: '2026-10-08',
        deadline: '2026-10-20',
      },
    });
    tree = auto(tree, 'A', 3);
    expect(tree.tasks[0]).toMatchObject({
      notBefore: '2026-10-08',
      deadline: '2026-10-20',
    });
    expect(tree.schedule.tasks[taskId]!.ES).toBe(3);
    tree = step(tree, {
      type: 'task.plan',
      taskId,
      plan: {
        mode: 'fixed',
        inputStart: '2026-10-09',
        inputFinish: '2026-10-12',
      },
    });
    expect(tree.tasks[0]).toMatchObject({
      durationDays: 4,
      notBefore: null,
      deadline: '2026-10-20',
    });
    tree = auto(tree, 'A', 2);
    expect(tree.tasks[0]).toMatchObject({
      inputStart: null,
      inputFinish: null,
      notBefore: null,
      deadline: '2026-10-20',
    });
    tree = step(tree, {
      type: 'task.plan',
      taskId,
      plan: { mode: 'unscheduled', inputStart: '2026-10-08' },
    });
    expect(tree.tasks[0]).toMatchObject({
      planMode: 'unscheduled',
      durationDays: null,
      notBefore: null,
      inputStart: '2026-10-08',
      inputFinish: null,
      deadline: '2026-10-20',
    });
    tree = step(tree, {
      type: 'task.plan',
      taskId,
      plan: { mode: 'unscheduled', deadline: null },
    });
    expect(tree.tasks[0]).toMatchObject({
      inputStart: null,
      inputFinish: null,
      deadline: null,
    });
  });
  it('recalculates Fixed duration on calendar change and persists invalid calendar constraints with diagnostics', () => {
    let tree = create(fresh(), 'A');
    const taskId = id(tree, 'A');
    tree = step(tree, {
      type: 'task.plan',
      taskId,
      plan: {
        mode: 'fixed',
        inputStart: '2026-10-09',
        inputFinish: '2026-10-12',
      },
    });
    tree = step(tree, {
      type: 'project.schedule',
      changes: { calendarType: 'weekdays' },
    });
    expect(tree.tasks[0]!.durationDays).toBe(2);
    expect(tree.schedule.tasks[taskId]).toMatchObject({ ES: 4, EF: 6 });
    expect(() =>
      step(tree, {
        type: 'task.plan',
        taskId,
        plan: {
          mode: 'fixed',
          inputStart: '2026-10-12',
          inputFinish: '2026-10-09',
        },
      }),
    ).toThrow();
    tree = step(tree, {
      type: 'project.schedule',
      changes: { calendarType: 'all-days' },
    });
    expect(tree.tasks[0]!.durationDays).toBe(4);
    tree = step(tree, {
      type: 'task.plan',
      taskId,
      plan: {
        mode: 'fixed',
        inputStart: '2026-10-10',
        inputFinish: '2026-10-12',
      },
    });
    tree = step(tree, {
      type: 'project.schedule',
      changes: { calendarType: 'weekdays' },
    });
    expect(tree.schedule.feasibility).toBe('infeasible');
    expect(tree.tasks[0]!.inputStart).toBe('2026-10-10');
    expect(
      tree.schedule.diagnostics.some(
        (diagnostic) => diagnostic.code === 'NON_WORKING_DATE',
      ),
    ).toBe(true);
  });
  it('accepts unchanged panel date fields and captures completed work without replacing its plan', () => {
    let tree = create(fresh(), 'A');
    const taskId = id(tree, 'A');
    tree = step(tree, {
      type: 'task.plan',
      taskId,
      plan: {
        mode: 'auto',
        durationDays: 2,
        notBefore: '2026-10-08',
        deadline: '2026-10-20',
      },
    });
    tree = step(tree, {
      type: 'task.update',
      taskId,
      changes: {
        title: 'Renamed',
        status: 'done',
        inputStart: null,
        inputFinish: null,
      },
    });
    expect(tree.tasks[0]).toMatchObject({
      status: 'done',
      planMode: 'auto',
      durationDays: 2,
      notBefore: '2026-10-08',
      deadline: '2026-10-20',
      completedStart: '2026-10-08',
      completedFinish: '2026-10-09',
      completedStartIndex: null,
      completedFinishIndex: null,
    });
    const before = tree;
    tree = step(tree, {
      type: 'task.create',
      title: 'Child',
      parentId: taskId,
      preserveWork: true,
    });
    const work = tree.tasks.find(
      (task) => task.parentId === taskId && task.title === 'Renamed',
    )!;
    expect(work).toMatchObject({
      status: 'done',
      planMode: 'auto',
      durationDays: 2,
      notBefore: '2026-10-08',
      deadline: '2026-10-20',
      completedStart: '2026-10-08',
      completedFinish: '2026-10-09',
    });
    expect(tree.tasks.find((task) => task.id === taskId)).toMatchObject({
      planMode: 'unscheduled',
      durationDays: null,
      notBefore: null,
      deadline: null,
      completedStart: null,
      completedFinish: null,
      status: 'todo',
    });
    tree = step(tree, { type: 'undo' });
    expect(tree.tasks).toEqual(before.tasks);
  });
  it('locks relative completed intervals without an origin and clears all locks on return', () => {
    let tree = create(fresh(), 'A');
    tree = create(tree, 'B');
    tree = auto(tree, 'A', 2);
    tree = auto(tree, 'B', 1);
    tree = edge(tree, 'A', 'B');
    tree = step(tree, {
      type: 'project.schedule',
      changes: { startDate: null },
    });
    const taskId = id(tree, 'B');
    tree = step(tree, {
      type: 'task.update',
      taskId,
      changes: { status: 'done' },
    });
    expect(tree.tasks.find((task) => task.id === taskId)).toMatchObject({
      planMode: 'auto',
      durationDays: 1,
      completedStart: null,
      completedFinish: null,
      completedStartIndex: 2,
      completedFinishIndex: 3,
    });
    tree = auto(tree, 'A', 4);
    expect(tree.schedule.feasibility).toBe('infeasible');
    expect(tree.schedule.tasks[taskId]).toMatchObject({ ES: 2, EF: 3 });
    tree = step(tree, {
      type: 'task.update',
      taskId,
      changes: { status: 'doing' },
    });
    expect(tree.schedule.tasks[taskId]).toMatchObject({ ES: 4, EF: 5 });
    expect(tree.tasks.find((task) => task.id === taskId)).toMatchObject({
      completedStart: null,
      completedFinish: null,
      completedStartIndex: null,
      completedFinishIndex: null,
    });
  });
  it('rejects completion without a calculable interval, while ordinary Unscheduled work can complete', () => {
    let tree = create(fresh(), 'Unknown');
    tree = create(tree, 'Blocked');
    tree = auto(tree, 'Blocked', 2);
    tree = edge(tree, 'Unknown', 'Blocked');
    expect(() =>
      step(tree, {
        type: 'task.update',
        taskId: id(tree, 'Blocked'),
        changes: { status: 'done' },
      }),
    ).toThrow();
    const after = step(tree, {
      type: 'task.update',
      taskId: id(tree, 'Unknown'),
      changes: { status: 'done' },
    });
    expect(after.tasks.find((task) => task.title === 'Unknown')!.status).toBe(
      'done',
    );
    let fixed = create(fresh(), 'Fixed');
    fixed = step(fixed, {
      type: 'task.plan',
      taskId: id(fixed, 'Fixed'),
      plan: {
        mode: 'fixed',
        inputStart: '2026-10-06',
        inputFinish: '2026-10-07',
      },
    });
    fixed = step(fixed, {
      type: 'project.schedule',
      changes: { startDate: null },
    });
    expect(() =>
      step(fixed, {
        type: 'task.update',
        taskId: id(fixed, 'Fixed'),
        changes: { status: 'done' },
      }),
    ).toThrow();
  });
  it('converts the target of a move and returns an empty summary to an unscheduled leaf', () => {
    let tree = create(fresh(), 'Parent');
    tree = create(tree, 'Moved');
    tree = create(tree, 'Predecessor');
    tree = create(tree, 'Successor');
    tree = auto(tree, 'Parent', 3);
    tree = edge(tree, 'Predecessor', 'Parent');
    tree = edge(tree, 'Parent', 'Successor');
    const parentId = id(tree, 'Parent');
    const movedId = id(tree, 'Moved');
    expect(() =>
      step(tree, { type: 'task.move', taskId: movedId, parentId, position: 0 }),
    ).toThrow();
    tree = step(tree, {
      type: 'task.move',
      taskId: movedId,
      parentId,
      position: 1,
      preserveWork: true,
    });
    const work = tree.tasks.find(
      (task) => task.parentId === parentId && task.title === 'Parent',
    )!;
    expect(work.durationDays).toBe(3);
    expect(
      tree.dependencies.map((edge) => [edge.predecessorId, edge.successorId]),
    ).toEqual(
      expect.arrayContaining([
        [id(tree, 'Predecessor'), work.id],
        [work.id, id(tree, 'Successor')],
      ]),
    );
    tree = step(tree, { type: 'task.delete', taskId: movedId });
    tree = step(tree, { type: 'task.delete', taskId: work.id });
    expect(tree.tasks.find((task) => task.id === parentId)).toMatchObject({
      planMode: 'unscheduled',
      durationDays: null,
      inputStart: null,
      inputFinish: null,
    });
    expect(tree.dependencies).toEqual([]);
    expect(tree.schedule.summaries[parentId]).toBeUndefined();
    expect(tree.schedule.tasks[parentId]!.ES).toBeNull();
  });
  it('keeps valid inputs whose arithmetic exceeds supported calendar bounds as diagnostics', () => {
    let tree = create(fresh(), 'A');
    tree = step(tree, {
      type: 'project.schedule',
      changes: { startDate: '9999-12-31' },
    });
    tree = auto(tree, 'A', 1000000);
    expect(tree.schedule.feasibility).toBe('infeasible');
    expect(tree.tasks[0]!.durationDays).toBe(1000000);
    expect(
      tree.schedule.diagnostics.some(
        (diagnostic) => diagnostic.code === 'CALENDAR_RANGE_EXCEEDED',
      ),
    ).toBe(true);
  });
  it('accepts full supported Fixed spans and derives duration beyond the Auto input maximum after calendar changes', () => {
    let tree = create(fresh(), 'Long fixed work');
    tree = step(tree, {
      type: 'project.schedule',
      changes: { startDate: '0001-01-01', calendarType: 'weekdays' },
    });
    const taskId = id(tree, 'Long fixed work');
    tree = step(tree, {
      type: 'task.plan',
      taskId,
      plan: {
        mode: 'fixed',
        inputStart: '0001-01-01',
        inputFinish: '3000-01-01',
      },
    });
    expect(tree.tasks[0]!.durationDays).toBe(782403);
    expect(tree.schedule.tasks[taskId]!.EF).toBe(782403);
    expect(projectTreeSchema.safeParse(tree).success).toBe(true);
    tree = step(tree, {
      type: 'project.schedule',
      changes: { calendarType: 'all-days' },
    });
    expect(tree.tasks[0]!.durationDays).toBe(1095363);
    expect(tree.schedule.tasks[taskId]!.EF).toBe(1095363);
    expect(projectTreeSchema.safeParse(tree).success).toBe(true);
    tree = step(tree, {
      type: 'task.plan',
      taskId,
      plan: {
        mode: 'fixed',
        inputStart: '0001-01-01',
        inputFinish: '3000-01-01',
      },
    });
    expect(tree.tasks[0]!.durationDays).toBe(1095363);
    expect(tree.schedule.feasibility).toBe('feasible');
  });
  it('rolls back every persisted scheduling field when the fresh mutation response is malformed', () => {
    const before = parallel();
    const persisted = () =>
      ['projects', 'tasks', 'dependencies', 'undo_snapshots', 'operations'].map(
        (table) => db.prepare(`SELECT * FROM ${table} ORDER BY rowid`).all(),
      );
    const baseline = persisted();
    const calculate = scheduling.calculateSchedule;
    const spy = vi.spyOn(scheduling, 'calculateSchedule');
    const attempts: Command[] = [
      {
        type: 'project.schedule',
        changes: {
          startDate: '2026-10-12',
          calendarType: 'weekdays',
          timezone: 'Etc/GMT-3',
        },
      },
      {
        type: 'task.plan',
        taskId: id(before, 'C'),
        plan: { mode: 'auto', durationDays: 9 },
      },
      { type: 'dependency.delete', dependencyId: before.dependencies[0]!.id },
      {
        type: 'task.create',
        title: 'Synthetic child',
        parentId: id(before, 'B'),
        preserveWork: true,
      },
    ];
    for (const command of attempts) {
      // The first calculation precedes save. Corrupt only the fresh response
      // calculated after save, so schema validation must unwind actual SQL writes.
      spy.mockImplementationOnce(calculate).mockImplementationOnce((input) => ({
        ...calculate(input),
        coverage: { knownLeafCount: -1, totalLeafCount: input.tasks.length },
      }));
      expect(() => step(before, command)).toThrowError(
        'Invalid internal tree response',
      );
      expect(persisted()).toEqual(baseline);
      expect(repository.getTree(before.project.id, session)).toEqual(before);
    }
  });
});
