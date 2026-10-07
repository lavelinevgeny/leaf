import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { openDatabase } from '../src/server/database.js';
import { Repository } from '../src/server/repository.js';
import type { Command, ProjectTree } from '../src/shared/contracts.js';

let dir: string;
let db: ReturnType<typeof openDatabase>;
let repository: Repository;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'leaf-repository-'));
  db = openDatabase(join(dir, 'synthetic.sqlite'));
  repository = new Repository(db);
});
afterEach(() => {
  if (db.open) db.close();
  rmSync(dir, { recursive: true, force: true });
});
const session = 'synthetic-session-a';
function command(
  tree: ProjectTree,
  cmd: Command,
  operationId = randomUUID(),
  sessionId = session,
) {
  return repository.applyCommand(
    tree.project.id,
    { expectedRevision: tree.project.revision, operationId, command: cmd },
    sessionId,
  );
}
function createProject() {
  return repository.getTree(
    repository.createProject('Synthetic project').id,
    session,
  );
}
function create(
  tree: ProjectTree,
  title: string,
  parentId: string | null = null,
) {
  return command(tree, { type: 'task.create', title, parentId });
}
describe('transactional storage', () => {
  it('persists root, child, dates, status and sibling ordering after reopen', () => {
    let tree = create(createProject(), 'A');
    const a = tree.tasks[0]!.id;
    tree = create(tree, 'B', a);
    const b = tree.tasks.find((t) => t.title === 'B')!.id;
    tree = create(tree, 'C', a);
    tree = command(tree, {
      type: 'task.update',
      taskId: b,
      changes: { inputStart: '2026-10-07', inputFinish: null, status: 'doing' },
    });
    db.close();
    db = openDatabase(join(dir, 'synthetic.sqlite'));
    repository = new Repository(db);
    expect(repository.getTree(tree.project.id, session)).toEqual(tree);
    expect(db.pragma('foreign_keys', { simple: true })).toBe(1);
    expect(db.pragma('journal_mode', { simple: true })).toBe('wal');
  });
  it('deduplicates the operation before revision validation and rejects payload reuse', () => {
    const tree = createProject();
    const envelope = {
      expectedRevision: 0,
      operationId: randomUUID(),
      command: { type: 'task.create' as const, title: 'A', parentId: null },
    };
    const first = repository.applyCommand(tree.project.id, envelope, session);
    expect(repository.applyCommand(tree.project.id, envelope, session)).toEqual(
      first,
    );
    expect(() =>
      repository.applyCommand(
        tree.project.id,
        { ...envelope, command: { ...envelope.command, title: 'B' } },
        session,
      ),
    ).toThrowError(/операц/);
    expect(repository.getTree(tree.project.id, session).tasks).toHaveLength(1);
    expect(() =>
      repository.applyCommand(
        tree.project.id,
        { ...envelope, operationId: randomUUID() },
        session,
      ),
    ).toThrowError(/ревизи/i);
  });
  it('deletes and undoes the entire branch with original IDs and sibling order', () => {
    let tree = create(createProject(), 'A');
    const a = tree.tasks[0]!.id;
    tree = create(tree, 'B', a);
    const b = tree.tasks.find((t) => t.title === 'B')!.id;
    tree = create(tree, 'C', b);
    tree = create(tree, 'D');
    const saved = structuredClone(tree.tasks);
    tree = command(tree, { type: 'task.delete', taskId: a });
    expect(tree.tasks.map((t) => t.title)).toEqual(['D']);
    tree = command(tree, { type: 'undo' });
    expect(tree.tasks).toEqual(saved);
    expect(tree.project.revision).toBe(6);
  });
  it('does not allow undo to overwrite another session after refresh', () => {
    const own = create(createProject(), 'A');
    const other = command(
      own,
      { type: 'task.create', title: 'B', parentId: null },
      randomUUID(),
      'synthetic-session-b',
    );
    const refreshed = repository.getTree(own.project.id, session);
    expect(refreshed.canUndo).toBe(false);
    expect(() => command(refreshed, { type: 'undo' })).toThrow();
    expect(repository.getTree(own.project.id, session).tasks).toEqual(
      other.tasks,
    );
  });
  it('supports repeated own undo and limits snapshots to twenty', () => {
    let tree = createProject();
    for (let i = 0; i < 22; i++) tree = create(tree, `Task ${i}`);
    for (let i = 0; i < 20; i++) tree = command(tree, { type: 'undo' });
    expect(tree.tasks).toHaveLength(2);
    expect(tree.canUndo).toBe(false);
  });
  it('rejects cycles and foreign parents without bytes, revision, or undo changes', () => {
    let tree = create(createProject(), 'A');
    const a = tree.tasks[0]!.id;
    tree = create(tree, 'B', a);
    const b = tree.tasks.find((t) => t.title === 'B')!.id;
    tree = create(tree, 'C', b);
    const c = tree.tasks.find((t) => t.title === 'C')!.id;
    const foreign = create(createProject(), 'Foreign').tasks[0]!.id;
    db.pragma('wal_checkpoint(TRUNCATE)');
    const bytes = readFileSync(join(dir, 'synthetic.sqlite'));
    expect(() =>
      command(tree, { type: 'task.move', taskId: a, parentId: c, position: 0 }),
    ).toThrow();
    expect(() => create(tree, 'Invalid', foreign)).toThrow();
    expect(() =>
      command(tree, {
        type: 'task.update',
        taskId: c,
        changes: { inputStart: '2026-02-30' },
      }),
    ).toThrow();
    expect(repository.getTree(tree.project.id, session)).toEqual(tree);
    db.pragma('wal_checkpoint(TRUNCATE)');
    expect(readFileSync(join(dir, 'synthetic.sqlite')).equals(bytes)).toBe(
      true,
    );
  });
  it('requires dated leaf conversion confirmation and preserves its own work', () => {
    let tree = create(createProject(), 'Parent');
    const id = tree.tasks[0]!.id;
    tree = command(tree, {
      type: 'task.update',
      taskId: id,
      changes: {
        inputStart: '2026-10-07',
        inputFinish: '2026-10-08',
        status: 'doing',
        description: 'Synthetic work',
      },
    });
    const before = structuredClone(tree);
    expect(() => create(tree, 'Child', id)).toThrow();
    expect(repository.getTree(tree.project.id, session)).toEqual(before);
    tree = command(tree, {
      type: 'task.create',
      title: 'Child',
      parentId: id,
      preserveWork: true,
    });
    const work = tree.tasks.find((t) => t.title === 'Parent' && t.id !== id)!;
    expect(work).toMatchObject({
      parentId: id,
      inputStart: '2026-10-07',
      inputFinish: '2026-10-08',
      status: 'doing',
      description: 'Synthetic work',
      sortOrder: 0,
    });
    expect(tree.tasks.find((t) => t.id === id)).toMatchObject({
      inputStart: null,
      inputFinish: null,
      status: 'todo',
    });
    expect(() =>
      command(tree, {
        type: 'task.update',
        taskId: id,
        changes: { inputStart: '2026-10-09' },
      }),
    ).toThrow();
    tree = command(tree, { type: 'undo' });
    expect(tree.tasks).toEqual(before.tasks);
  });
  it('converts dated move targets, renumbers both sides and removes last-child dates', () => {
    let tree = create(createProject(), 'A');
    const a = tree.tasks[0]!.id;
    tree = create(tree, 'B');
    const b = tree.tasks.find((t) => t.title === 'B')!.id;
    tree = create(tree, 'C');
    const c = tree.tasks.find((t) => t.title === 'C')!.id;
    tree = command(tree, {
      type: 'task.update',
      taskId: b,
      changes: { inputFinish: '2026-10-08' },
    });
    expect(() =>
      command(tree, { type: 'task.move', taskId: c, parentId: b, position: 0 }),
    ).toThrow();
    tree = command(tree, {
      type: 'task.move',
      taskId: c,
      parentId: b,
      position: 1,
      preserveWork: true,
    });
    expect(
      tree.tasks
        .filter((t) => t.parentId === null)
        .map((t) => [t.id, t.sortOrder]),
    ).toEqual([
      [a, 0],
      [b, 1],
    ]);
    for (const child of tree.tasks.filter((t) => t.parentId === b))
      tree = command(tree, { type: 'task.delete', taskId: child.id });
    expect(tree.tasks.find((t) => t.id === b)).toMatchObject({
      inputStart: null,
      inputFinish: null,
    });
  });
  it('inserts after siblings and atomically revisions/undoes a project rename', () => {
    let tree = create(createProject(), 'A');
    const a = tree.tasks[0]!.id;
    tree = create(tree, 'B');
    tree = command(tree, {
      type: 'task.create',
      title: 'C',
      parentId: null,
      afterId: a,
    });
    expect(tree.tasks.map((t) => t.title)).toEqual(['A', 'C', 'B']);
    const rename = {
      title: 'Renamed',
      expectedRevision: tree.project.revision,
      operationId: randomUUID(),
    };
    const renamed = repository.renameProject(tree.project.id, rename, session);
    expect(repository.renameProject(tree.project.id, rename, session)).toEqual(
      renamed,
    );
    tree = command(renamed, { type: 'undo' });
    expect(tree.project.title).toBe('Synthetic project');
  });
});
