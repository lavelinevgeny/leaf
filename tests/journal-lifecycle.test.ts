import { createHash, randomUUID } from 'node:crypto';
import { expect, it } from 'vitest';
import { DomainError } from '../src/domain/tree.js';
import { canonical } from '../src/shared/canonical.js';
import { JournalRepository } from '../src/server/journal-repository.js';
import { JournalLifecycle } from '../src/server/journal-lifecycle.js';
import {
  journalFixture,
  createInput,
  rawTables,
} from './helpers/journal-fixture.js';
const tables = [
  'projects',
  'tasks',
  'dependencies',
  'task_schedule_provenance',
  'journal_entries',
  'journal_state',
  'journal_operations',
  'undo_snapshots',
  'undo_journal_entries',
  'undo_journal_manifest',
  'operations',
];
function deletionFixture() {
  const f = journalFixture();
  const j = new JournalRepository(f.db, f.now);
  f.command({ type: 'task.create', title: 'Child', parentId: f.taskId });
  const child = f.plan
    .getTree(f.project.id, 'synthetic-session')
    .tasks.find((t) => t.title === 'Child')!;
  f.command({ type: 'task.create', title: 'Nested', parentId: child.id });
  f.command({ type: 'task.create', title: 'Sibling', parentId: null });
  const tree = f.plan.getTree(f.project.id, 'synthetic-session');
  const nested = tree.tasks.find((t) => t.title === 'Nested')!;
  const sibling = tree.tasks.find((t) => t.title === 'Sibling')!;
  for (const [i, id] of [f.taskId, child.id, nested.id, sibling.id].entries())
    j.create(
      f.project.id,
      createInput(id, i, `Synthetic ${i}`),
      'synthetic-session',
    );
  const before = j.getProjectPage(f.project.id, {}).entries;
  const deletion = {
    contractVersion: 2 as const,
    operationId: randomUUID(),
    expectedRevision: tree.project.revision,
    command: { type: 'task.delete' as const, taskId: f.taskId },
  };
  const deleted = f.plan.applyCommand(
    f.project.id,
    deletion,
    'synthetic-session',
  );
  return { f, j, before, sibling, deletion, deleted };
}
it('deletes a subtree once, restores exact sidecar and preserves later sibling journal edits', () => {
  const { f, j, before, sibling, deletion, deleted } = deletionFixture();
  try {
    expect(j.getProjectPage(f.project.id, {}).journalRevision).toBe(5);
    expect(j.getProjectPage(f.project.id, {}).entries).toEqual(
      before.filter((e) => e.taskId === sibling.id),
    );
    const old = before.find((e) => e.taskId === sibling.id)!;
    const update = {
      journalContractVersion: 1 as const,
      operationId: randomUUID(),
      expectedJournalRevision: 5,
      workDate: '2024-02-28',
      body: 'Sibling later',
    };
    const ack = j.update(f.project.id, old.id, update, 'synthetic-session');
    const later = j.create(
      f.project.id,
      createInput(sibling.id, 6, 'Synthetic temporary sibling note'),
      'synthetic-session',
    );
    if (later.kind !== 'saved') throw new Error('Fixture');
    j.delete(
      f.project.id,
      later.entry.id,
      {
        journalContractVersion: 1,
        operationId: randomUUID(),
        expectedJournalRevision: 7,
      },
      'synthetic-session',
    );
    f.command({ type: 'undo' });
    expect(j.getProjectPage(f.project.id, {}).journalRevision).toBe(9);
    expect(
      j
        .getProjectPage(f.project.id, {})
        .entries.filter((e) => e.taskId !== sibling.id),
    ).toEqual(before.filter((e) => e.taskId !== sibling.id));
    expect(j.getEntry(f.project.id, old.id).entry).toEqual(
      ack.kind === 'saved' ? ack.entry : null,
    );
    const all = rawTables(f.db, tables);
    expect(
      f.plan.applyCommand(f.project.id, deletion, 'synthetic-session'),
    ).toEqual(deleted);
    expect(rawTables(f.db, tables)).toEqual(all);
  } finally {
    f.close();
  }
});
it('blocks Undo removing a task with later notes until explicit journal deletion', () => {
  const f = journalFixture();
  try {
    const j = new JournalRepository(f.db, f.now);
    const saved = j.create(
      f.project.id,
      createInput(f.taskId),
      'synthetic-session',
    );
    if (saved.kind !== 'saved') throw Error('Fixture');
    const before = rawTables(f.db, tables);
    expect(() => f.command({ type: 'undo' })).toThrowError(
      expect.objectContaining({ code: 'UNDO_JOURNAL_CONFLICT' }),
    );
    expect(rawTables(f.db, tables)).toEqual(before);
    expect(f.plan.getTree(f.project.id, 'synthetic-session').canUndo).toBe(
      true,
    );
    j.delete(
      f.project.id,
      saved.entry.id,
      {
        journalContractVersion: 1,
        operationId: randomUUID(),
        expectedJournalRevision: 1,
      },
      'synthetic-session',
    );
    expect(f.command({ type: 'undo' }).tasks).toEqual([]);
  } finally {
    f.close();
  }
});
it.each([
  'one-row',
  'all-rows',
  'manifest',
  'body',
  'date',
  'count',
  'digest',
  'foreign-project',
  'foreign-task',
  'surviving-task',
  'collision',
  'v0-data',
])('rejects corrupt sidecar %s before any writes', (damage) => {
  const { f, j, sibling } = deletionFixture();
  try {
    const undo = f.db
      .prepare(
        'SELECT sequence FROM undo_snapshots ORDER BY sequence DESC LIMIT 1',
      )
      .get() as { sequence: number };
    const row = f.db
      .prepare(
        'SELECT id FROM undo_journal_entries WHERE undoSequence=? LIMIT 1',
      )
      .get(undo.sequence) as { id: string };
    if (damage === 'one-row')
      f.db
        .prepare(
          'DELETE FROM undo_journal_entries WHERE undoSequence=? AND id=?',
        )
        .run(undo.sequence, row.id);
    if (damage === 'all-rows')
      f.db
        .prepare('DELETE FROM undo_journal_entries WHERE undoSequence=?')
        .run(undo.sequence);
    if (damage === 'manifest')
      f.db
        .prepare('DELETE FROM undo_journal_manifest WHERE undoSequence=?')
        .run(undo.sequence);
    if (damage === 'body' || damage === 'date')
      f.db
        .prepare(
          `UPDATE undo_journal_entries SET ${damage === 'body' ? 'body' : 'workDate'}=? WHERE undoSequence=? AND id=?`,
        )
        .run(
          damage === 'body' ? 'Valid changed text' : '2024-02-28',
          undo.sequence,
          row.id,
        );
    if (damage === 'count')
      f.db
        .prepare(
          'UPDATE undo_journal_manifest SET entryCount=1 WHERE undoSequence=?',
        )
        .run(undo.sequence);
    if (damage === 'digest')
      f.db
        .prepare(
          'UPDATE undo_journal_manifest SET entriesSha256=? WHERE undoSequence=?',
        )
        .run('0'.repeat(64), undo.sequence);
    if (damage === 'v0-data')
      f.db
        .prepare(
          'UPDATE undo_snapshots SET journalLifecycleVersion=0 WHERE sequence=?',
        )
        .run(undo.sequence);
    if (
      [
        'foreign-project',
        'foreign-task',
        'surviving-task',
        'collision',
      ].includes(damage)
    ) {
      if (damage === 'foreign-project') {
        const other = f.plan.createProject('Synthetic other');
        f.db
          .prepare(
            'UPDATE undo_journal_entries SET projectId=? WHERE undoSequence=? AND id=?',
          )
          .run(other.id, undo.sequence, row.id);
      }
      if (damage === 'foreign-task')
        f.db
          .prepare(
            'UPDATE undo_journal_entries SET taskId=? WHERE undoSequence=? AND id=?',
          )
          .run(randomUUID(), undo.sequence, row.id);
      if (damage === 'surviving-task')
        f.db
          .prepare(
            'UPDATE undo_journal_entries SET taskId=? WHERE undoSequence=? AND id=?',
          )
          .run(sibling.id, undo.sequence, row.id);
      if (damage === 'collision')
        f.db
          .prepare('UPDATE journal_entries SET id=? WHERE taskId=?')
          .run(row.id, sibling.id);
      const entries = f.db
        .prepare(
          'SELECT id,projectId,taskId,workDate,body,createdAt,updatedAt FROM undo_journal_entries WHERE undoSequence=? ORDER BY id',
        )
        .all(undo.sequence);
      const hash = createHash('sha256')
        .update(
          canonical({
            undoSequence: undo.sequence,
            projectId: f.project.id,
            entries,
          }),
        )
        .digest('hex');
      f.db
        .prepare(
          'UPDATE undo_journal_manifest SET entriesSha256=? WHERE undoSequence=?',
        )
        .run(hash, undo.sequence);
    }
    const before = rawTables(f.db, tables);
    let failure: unknown;
    try {
      f.command({ type: 'undo' });
    } catch (error) {
      failure = error;
    }
    expect(failure).toBeInstanceOf(Error);
    expect((failure as Error).constructor).toBe(Error);
    expect(failure).not.toBeInstanceOf(DomainError);
    expect(rawTables(f.db, tables)).toEqual(before);
    expect(j.getProjectPage(f.project.id, {}).journalRevision).toBe(5);
  } finally {
    f.close();
  }
});
it.each(['capture', 'task-delete', 'restore', 'operation'])(
  'rolls back planning lifecycle failure at %s',
  (point) => {
    const { f } = deletionFixture();
    try {
      if (point === 'capture' || point === 'task-delete') {
        f.command({ type: 'undo' });
        f.db.exec(
          point === 'capture'
            ? "CREATE TRIGGER synthetic_failure BEFORE INSERT ON undo_journal_manifest BEGIN SELECT RAISE(ABORT,'Synthetic rollback'); END"
            : "CREATE TRIGGER synthetic_failure AFTER DELETE ON tasks BEGIN SELECT RAISE(ABORT,'Synthetic rollback'); END",
        );
      } else
        f.db.exec(
          point === 'restore'
            ? "CREATE TRIGGER synthetic_failure BEFORE INSERT ON journal_entries BEGIN SELECT RAISE(ABORT,'Synthetic rollback'); END"
            : "CREATE TRIGGER synthetic_failure BEFORE INSERT ON operations BEGIN SELECT RAISE(ABORT,'Synthetic rollback'); END",
        );
      const before = rawTables(f.db, tables);
      expect(() =>
        f.command(
          point === 'capture' || point === 'task-delete'
            ? { type: 'task.delete', taskId: f.taskId }
            : { type: 'undo' },
        ),
      ).toThrow();
      expect(rawTables(f.db, tables)).toEqual(before);
    } finally {
      f.close();
    }
  },
);
it('supports v1 empty manifest and historical v0, bounds sidecar lifetime and enforces transaction seam', () => {
  const f = journalFixture();
  try {
    const lifecycle = new JournalLifecycle(f.db);
    expect(() => lifecycle.captureDeletion(1, f.project.id, [])).toThrow(
      'requires transaction',
    );
    f.command({
      type: 'task.edit',
      taskId: f.taskId,
      changes: { title: 'New' },
    });
    expect(f.command({ type: 'undo' }).tasks[0]!.title).toBe('Parent');
    f.db.exec(
      'DELETE FROM undo_journal_manifest; UPDATE undo_snapshots SET journalLifecycleVersion=0',
    );
    expect(f.command({ type: 'undo' }).tasks).toEqual([]);
    f.command({ type: 'task.create', title: 'Again', parentId: null });
    const task = f.plan.getTree(f.project.id, 'synthetic-session').tasks[0]!;
    for (let i = 0; i < 22; i++)
      f.command({
        type: 'task.edit',
        taskId: task.id,
        changes: { title: `Synthetic ${i}` },
      });
    expect(
      f.db.prepare('SELECT COUNT(*) AS n FROM undo_snapshots').get(),
    ).toEqual({ n: 20 });
    expect(
      f.db.prepare('SELECT COUNT(*) AS n FROM undo_journal_manifest').get(),
    ).toEqual({ n: 20 });
    expect(f.db.pragma('foreign_key_check')).toEqual([]);
  } finally {
    f.close();
  }
});
it('preserves survivor bytes for plan settings, source, FS, move, status and Undo', () => {
  const f = journalFixture();
  try {
    const j = new JournalRepository(f.db, f.now);
    const original = j.create(
      f.project.id,
      createInput(f.taskId),
      'synthetic-session',
    );
    if (original.kind !== 'saved') throw Error('Fixture');
    const commands = [
      {
        type: 'task.edit' as const,
        taskId: f.taskId,
        changes: { title: 'Renamed' },
      },
      {
        type: 'task.edit' as const,
        taskId: f.taskId,
        changes: { status: 'doing' as const },
      },
      {
        type: 'task.edit' as const,
        taskId: f.taskId,
        changes: { inputStart: '2026-10-12', durationDays: 1 },
      },
      {
        type: 'project.schedule' as const,
        changes: {
          calendarType: 'all-days' as const,
          timezone: 'Europe/Moscow',
        },
      },
      {
        type: 'task.move' as const,
        taskId: f.taskId,
        parentId: null,
        position: 0,
      },
    ];
    f.db.exec(
      `CREATE TRIGGER synthetic_survivor BEFORE DELETE ON tasks WHEN OLD.id='${f.taskId}' BEGIN SELECT RAISE(ABORT,'Synthetic survivor churn'); END`,
    );
    for (const command of commands) {
      f.command(command);
      expect(j.getEntry(f.project.id, original.entry.id).entry).toEqual(
        original.entry,
      );
      f.command({ type: 'undo' });
      expect(j.getEntry(f.project.id, original.entry.id).entry).toEqual(
        original.entry,
      );
    }
    f.command({
      type: 'task.create',
      title: 'Synthetic successor',
      parentId: null,
      inputStart: '2026-10-13',
      durationDays: 1,
    });
    const successor = f.plan
      .getTree(f.project.id, 'synthetic-session')
      .tasks.find((t) => t.title === 'Synthetic successor')!;
    f.command({
      type: 'task.edit',
      taskId: f.taskId,
      changes: { inputStart: '2026-10-12', durationDays: 1 },
    });
    f.command({
      type: 'dependency.create',
      predecessorId: f.taskId,
      successorId: successor.id,
    });
    expect(j.getEntry(f.project.id, original.entry.id).entry).toEqual(
      original.entry,
    );
    f.command({ type: 'undo' });
    expect(j.getEntry(f.project.id, original.entry.id).entry).toEqual(
      original.entry,
    );
  } finally {
    f.close();
  }
});
it('syncs independent provenance through source adoption, promotion and Undo', () => {
  const f = journalFixture();
  try {
    f.db
      .prepare(
        "INSERT INTO task_schedule_provenance(taskId,reason) VALUES (?,'legacy-interval-unavailable')",
      )
      .run(f.taskId);
    const j = new JournalRepository(f.db, f.now);
    const saved = j.create(
      f.project.id,
      createInput(f.taskId),
      'synthetic-session',
    );
    const expected = [
      { taskId: f.taskId, reason: 'legacy-interval-unavailable' },
    ];
    expect(
      f.db.prepare('SELECT * FROM task_schedule_provenance').all(),
    ).toEqual(expected);
    f.command({
      type: 'task.edit',
      taskId: f.taskId,
      changes: { inputStart: '2026-10-12', durationDays: 1 },
    });
    expect(
      f.db.prepare('SELECT * FROM task_schedule_provenance').all(),
    ).toEqual([]);
    f.command({ type: 'undo' });
    expect(
      f.db.prepare('SELECT * FROM task_schedule_provenance').all(),
    ).toEqual(expected);
    // Completed work requires preservation without adopting a legacy source.
    f.command({
      type: 'task.edit',
      taskId: f.taskId,
      changes: { status: 'done' },
    });
    f.command({
      type: 'task.create',
      title: 'Nested',
      parentId: f.taskId,
      preserveWork: true,
    });
    const work = f.plan
      .getTree(f.project.id, 'synthetic-session')
      .tasks.find((t) => t.parentId === f.taskId && t.title === 'Parent')!;
    expect(
      f.db.prepare('SELECT * FROM task_schedule_provenance').all(),
    ).toEqual([{ taskId: work.id, reason: 'legacy-interval-unavailable' }]);
    f.command({ type: 'undo' });
    expect(
      f.db.prepare('SELECT * FROM task_schedule_provenance').all(),
    ).toEqual(expected);
    expect(j.getProjectPage(f.project.id, {}).entries).toEqual(
      saved.kind === 'saved' ? [saved.entry] : [],
    );
  } finally {
    f.close();
  }
});
it('prunes only own twenty snapshots and cascades associated sidecar while preserving another session', () => {
  const { f, j, sibling } = deletionFixture();
  try {
    // A second session holds a snapshot with an independent empty manifest.
    const revision = f.plan.getTree(f.project.id, 'synthetic-session').project
      .revision;
    f.plan.applyCommand(
      f.project.id,
      {
        contractVersion: 2,
        operationId: randomUUID(),
        expectedRevision: revision,
        command: {
          type: 'task.edit',
          taskId: sibling.id,
          changes: { title: 'Other session' },
        },
      },
      'synthetic-other-session',
    );
    const other = f.db
      .prepare(
        "SELECT sequence FROM undo_snapshots WHERE sessionId='synthetic-other-session'",
      )
      .get() as { sequence: number };
    for (let n = 0; n < 22; n++)
      f.command({
        type: 'task.edit',
        taskId: sibling.id,
        changes: { title: `Synthetic ${n}` },
      });
    expect(
      f.db
        .prepare(
          "SELECT COUNT(*) AS n FROM undo_snapshots WHERE sessionId='synthetic-session'",
        )
        .get(),
    ).toEqual({ n: 20 });
    expect(
      f.db.prepare('SELECT COUNT(*) AS n FROM undo_journal_entries').get(),
    ).toEqual({ n: 0 });
    expect(
      f.db
        .prepare(
          'SELECT entryCount FROM undo_journal_manifest WHERE undoSequence=?',
        )
        .get(other.sequence),
    ).toEqual({ entryCount: 0 });
    expect(j.getProjectPage(f.project.id, {}).entries).toHaveLength(1);
  } finally {
    f.close();
  }
});
it('captures and restores exact NUL/emoji bytes through branch deletion and Undo', () => {
  const f = journalFixture();
  try {
    f.command({
      type: 'task.create',
      title: 'Synthetic nested',
      parentId: f.taskId,
    });
    const child = f.plan
      .getTree(f.project.id, 'synthetic-session')
      .tasks.find((t) => t.parentId === f.taskId)!;
    const j = new JournalRepository(f.db, f.now);
    const bodies = ['\0Synthetic parent😀', '\0Synthetic child\0\n'];
    for (const [i, id] of [f.taskId, child.id].entries())
      j.create(
        f.project.id,
        createInput(id, i, bodies[i]),
        'synthetic-session',
      );
    const before = j.getProjectPage(f.project.id, {}).entries;
    f.command({ type: 'task.delete', taskId: f.taskId });
    expect(j.getProjectPage(f.project.id, {}).entries).toEqual([]);
    expect(
      f.db
        .prepare('SELECT body FROM undo_journal_entries ORDER BY taskId')
        .all()
        .map((row) => (row as { body: string }).body)
        .sort(),
    ).toEqual([...bodies].sort());
    f.command({ type: 'undo' });
    expect(j.getProjectPage(f.project.id, {}).entries).toEqual(before);
    expect(j.getProjectPage(f.project.id, {}).journalRevision).toBe(4);
  } finally {
    f.close();
  }
});
