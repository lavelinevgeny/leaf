import { expect, it } from 'vitest';
import { JournalRepository } from '../src/server/journal-repository.js';
import { journalFixture, createInput } from './helpers/journal-fixture.js';
it('keeps a journal entry and plan revision across rename and exact retry', () => {
  const f = journalFixture();
  try {
    const journal = new JournalRepository(f.db, f.now);
    const tree = f.plan.getTree(f.project.id, 'synthetic-session');
    const input = createInput(f.taskId);
    const saved = journal.create(f.project.id, input, 'synthetic-session');
    if (saved.kind !== 'saved') throw Error('Expected saved fixture');
    expect(f.plan.getTree(f.project.id, 'synthetic-session')).toEqual(tree);
    f.db.exec(
      `CREATE TRIGGER synthetic_survivor_guard BEFORE DELETE ON tasks BEGIN SELECT RAISE(ABORT, 'Synthetic task churn'); END`,
    );
    f.command({
      type: 'task.edit',
      taskId: f.taskId,
      changes: { title: 'Renamed' },
    });
    expect(journal.getProjectPage(f.project.id, {}).entries).toEqual([
      saved.entry,
    ]);
    expect(journal.getTaskPage(f.project.id, f.taskId, {}).entries).toEqual([
      saved.entry,
    ]);
    expect(journal.create(f.project.id, input, 'synthetic-session')).toEqual(
      saved,
    );
    expect(journal.getProjectPage(f.project.id, {}).journalRevision).toBe(1);
    expect(
      f.db.prepare('SELECT COUNT(*) AS n FROM journal_operations').get(),
    ).toEqual({ n: 1 });
  } finally {
    f.close();
  }
});

import Database from 'better-sqlite3';
import { randomUUID } from 'node:crypto';
import { vi } from 'vitest';
import * as scheduling from '../src/domain/scheduling.js';
import * as cascade from '../src/domain/fs-cascade.js';
import { rawTables } from './helpers/journal-fixture.js';
const journalTables = [
  'journal_entries',
  'journal_state',
  'journal_operations',
];
it('CRUD preserves all planning rows and never invokes planning or solvers', () => {
  const f = journalFixture();
  try {
    const journal = new JournalRepository(f.db, f.now);
    const before = rawTables(f.db, [
      'projects',
      'tasks',
      'dependencies',
      'task_schedule_provenance',
      'undo_snapshots',
      'operations',
    ]);
    const tree = vi.spyOn(f.plan, 'getTree');
    const solver = vi.spyOn(scheduling, 'calculateSchedule');
    const fs = vi.spyOn(cascade, 'cascadeFs');
    const saved = journal.create(
      f.project.id,
      createInput(f.taskId),
      'synthetic-session',
    );
    if (saved.kind !== 'saved') throw Error('Fixture');
    expect(journal.getEntry(f.project.id, saved.entry.id).entry.body).toBe(
      '  Первая строка\nВторая строка  ',
    );
    journal.getTaskPage(f.project.id, f.taskId, {});
    journal.getProjectPage(f.project.id, {});
    const input = {
      journalContractVersion: 1 as const,
      operationId: randomUUID(),
      expectedJournalRevision: 1,
      workDate: '0001-01-01',
      body: 'Changed',
    };
    const updated = journal.update(
      f.project.id,
      saved.entry.id,
      input,
      'synthetic-session',
    );
    if (updated.kind !== 'saved') throw Error('Fixture');
    expect(updated.entry.createdAt).toBe(saved.entry.createdAt);
    expect(updated.entry.updatedAt > saved.entry.updatedAt).toBe(true);
    expect(
      journal.update(f.project.id, saved.entry.id, input, 'synthetic-session'),
    ).toEqual(updated);
    journal.delete(
      f.project.id,
      saved.entry.id,
      {
        journalContractVersion: 1,
        operationId: randomUUID(),
        expectedJournalRevision: 2,
      },
      'synthetic-session',
    );
    expect(
      rawTables(f.db, [
        'projects',
        'tasks',
        'dependencies',
        'task_schedule_provenance',
        'undo_snapshots',
        'operations',
      ]),
    ).toEqual(before);
    expect(tree).not.toHaveBeenCalled();
    expect(solver).not.toHaveBeenCalled();
    expect(fs).not.toHaveBeenCalled();
  } finally {
    vi.restoreAllMocks();
    f.close();
  }
});
it.each(['journal_entries', 'journal_state', 'journal_operations'])(
  'rolls back create if %s rejects writes',
  (table) => {
    const f = journalFixture();
    try {
      const j = new JournalRepository(f.db, f.now);
      const before = rawTables(f.db, journalTables);
      f.db.exec(
        `CREATE TRIGGER synthetic_write_failure BEFORE ${table === 'journal_state' ? 'UPDATE' : 'INSERT'} ON ${table} BEGIN SELECT RAISE(ABORT,'Synthetic rollback'); END`,
      );
      expect(() =>
        j.create(f.project.id, createInput(f.taskId), 'synthetic-session'),
      ).toThrow();
      expect(rawTables(f.db, journalTables)).toEqual(before);
    } finally {
      f.close();
    }
  },
);
it('serializes independent connections and rejects stale or reused envelopes', () => {
  const f = journalFixture();
  const db2 = new Database(f.path);
  try {
    const j1 = new JournalRepository(f.db, f.now),
      j2 = new JournalRepository(db2, f.now);
    for (let n = 0; n < 5; n++)
      j1.create(f.project.id, createInput(f.taskId, n), 'synthetic-session');
    const input = createInput(f.taskId, 5);
    j1.create(f.project.id, input, 'synthetic-session');
    expect(() =>
      j2.create(f.project.id, createInput(f.taskId, 5), 'synthetic-session'),
    ).toThrowError(
      expect.objectContaining({ code: 'JOURNAL_REVISION_CONFLICT' }),
    );
    for (const changed of [
      { ...input, body: 'Other' },
      { ...input, workDate: '9999-12-31' },
    ])
      expect(() =>
        j2.create(f.project.id, changed, 'synthetic-session'),
      ).toThrowError(expect.objectContaining({ code: 'OPERATION_REUSED' }));
    expect(() => j2.create(f.project.id, input, 'other-session')).toThrowError(
      expect.objectContaining({ code: 'OPERATION_REUSED' }),
    );
    expect(j2.getProjectPage(f.project.id, {}).journalRevision).toBe(6);
  } finally {
    db2.close();
    f.close();
  }
});
it('fails safely for missing state and revision overflow without writes', () => {
  const f = journalFixture();
  try {
    const j = new JournalRepository(f.db, f.now);
    f.db
      .prepare('UPDATE journal_state SET revision=?')
      .run(Number.MAX_SAFE_INTEGER);
    const before = rawTables(f.db, journalTables);
    expect(() =>
      j.create(
        f.project.id,
        createInput(f.taskId, Number.MAX_SAFE_INTEGER),
        'synthetic-session',
      ),
    ).toThrow();
    expect(rawTables(f.db, journalTables)).toEqual(before);
    f.db.exec('DELETE FROM journal_state');
    expect(() => j.getProjectPage(f.project.id, {})).toThrow(
      'Missing internal journal state',
    );
    expect(() =>
      j.create(f.project.id, createInput(f.taskId), 'synthetic-session'),
    ).toThrow();
  } finally {
    f.close();
  }
});
it.each([
  'update-entry',
  'delete-entry',
  'update-state',
  'delete-state',
  'update-replay',
  'delete-replay',
])('rolls back %s trigger failure', (point) => {
  const f = journalFixture();
  try {
    const j = new JournalRepository(f.db, f.now);
    const saved = j.create(
      f.project.id,
      createInput(f.taskId),
      'synthetic-session',
    );
    if (saved.kind !== 'saved') throw Error('Fixture');
    const before = rawTables(f.db, journalTables);
    const verb = point.startsWith('update') ? 'UPDATE' : 'DELETE';
    const table = point.endsWith('entry')
      ? 'journal_entries'
      : point.endsWith('state')
        ? 'journal_state'
        : 'journal_operations';
    const event =
      table === 'journal_operations'
        ? 'INSERT'
        : table === 'journal_state'
          ? 'UPDATE'
          : verb;
    f.db.exec(
      `CREATE TRIGGER synthetic_write_failure BEFORE ${event} ON ${table} BEGIN SELECT RAISE(ABORT,'Synthetic rollback'); END`,
    );
    const input = {
      journalContractVersion: 1 as const,
      operationId: randomUUID(),
      expectedJournalRevision: 1,
    };
    expect(() =>
      verb === 'UPDATE'
        ? j.update(
            f.project.id,
            saved.entry.id,
            { ...input, workDate: '2024-02-28', body: 'Synthetic update' },
            'synthetic-session',
          )
        : j.delete(f.project.id, saved.entry.id, input, 'synthetic-session'),
    ).toThrow();
    expect(rawTables(f.db, journalTables)).toEqual(before);
  } finally {
    f.close();
  }
});
it('does not impose demo quota in normal repository', () => {
  const f = journalFixture();
  try {
    const j = new JournalRepository(f.db, f.now);
    for (let n = 0; n < 205; n++)
      j.create(
        f.project.id,
        createInput(f.taskId, n, 'Synthetic normal'),
        'synthetic-session',
      );
    expect(j.getProjectPage(f.project.id, {}).journalRevision).toBe(205);
  } finally {
    f.close();
  }
});
it('accepts summary, completed and undated tasks with date identity independent of project timezone', () => {
  const f = journalFixture();
  try {
    f.command({
      type: 'task.create',
      parentId: f.taskId,
      title: 'Synthetic leaf',
    });
    const leaf = f.plan
      .getTree(f.project.id, 'synthetic-session')
      .tasks.find((t) => t.title === 'Synthetic leaf')!;
    f.command({
      type: 'task.edit',
      taskId: leaf.id,
      changes: { status: 'done' },
    });
    f.command({
      type: 'project.schedule',
      changes: { timezone: 'Europe/Moscow' },
    });
    const j = new JournalRepository(f.db, f.now);
    const parent = j.create(
      f.project.id,
      createInput(f.taskId, 0, 'Synthetic summary'),
      'synthetic-session',
    );
    const done = j.create(
      f.project.id,
      createInput(leaf.id, 1, 'Synthetic completed undated'),
      'synthetic-session',
    );
    if (parent.kind !== 'saved' || done.kind !== 'saved')
      throw Error('Fixture');
    expect(parent.entry.workDate).toBe('2024-02-29');
    expect(done.entry.workDate).toBe('2024-02-29');
    expect(j.getTaskPage(f.project.id, f.taskId, {}).entries).toEqual([
      parent.entry,
    ]);
    expect(j.getTaskPage(f.project.id, leaf.id, {}).entries).toEqual([
      done.entry,
    ]);
    expect(
      f.plan
        .getTree(f.project.id, 'synthetic-session')
        .tasks.find((t) => t.id === leaf.id),
    ).toMatchObject({ status: 'done', inputStart: null, inputFinish: null });
  } finally {
    f.close();
  }
});
it('stores NUL and valid pairs exactly through read/update/replay/delete without changing plan', () => {
  const f = journalFixture();
  try {
    const j = new JournalRepository(f.db, f.now);
    const before = rawTables(f.db, [
      'projects',
      'tasks',
      'undo_snapshots',
      'operations',
    ]);
    const body = '\0Synthetic\u0001😀\n';
    const input = createInput(f.taskId, 0, body);
    const created = j.create(f.project.id, input, 'synthetic-session');
    if (created.kind !== 'saved') throw Error('Fixture');
    expect(created.entry.body).toBe(body);
    expect(j.getEntry(f.project.id, created.entry.id).entry.body).toBe(body);
    expect(j.getProjectPage(f.project.id, {}).entries[0]!.body).toBe(body);
    expect(j.create(f.project.id, input, 'synthetic-session')).toEqual(created);
    const draft = {
      journalContractVersion: 1 as const,
      operationId: randomUUID(),
      expectedJournalRevision: 1,
      workDate: '2024-02-28',
      body: '\0Changed\0😀',
    };
    const updated = j.update(
      f.project.id,
      created.entry.id,
      draft,
      'synthetic-session',
    );
    if (updated.kind !== 'saved') throw Error('Fixture');
    expect(j.getEntry(f.project.id, created.entry.id).entry.body).toBe(
      draft.body,
    );
    expect(
      j.update(f.project.id, created.entry.id, draft, 'synthetic-session'),
    ).toEqual(updated);
    j.delete(
      f.project.id,
      created.entry.id,
      {
        journalContractVersion: 1,
        operationId: randomUUID(),
        expectedJournalRevision: 2,
      },
      'synthetic-session',
    );
    expect(j.create(f.project.id, input, 'synthetic-session')).toEqual(created);
    expect(j.getProjectPage(f.project.id, {}).entries).toEqual([]);
    expect(
      rawTables(f.db, ['projects', 'tasks', 'undo_snapshots', 'operations']),
    ).toEqual(before);
  } finally {
    f.close();
  }
});
it('rejects malformed direct repository query without reads producing a cursor', () => {
  const f = journalFixture();
  try {
    const j = new JournalRepository(f.db, f.now);
    const before = rawTables(f.db, [
      'journal_entries',
      'journal_state',
      'journal_operations',
    ]);
    for (const q of ['\ud800', '\udfff'])
      expect(() => j.getProjectPage(f.project.id, { q })).toThrow();
    expect(
      rawTables(f.db, [
        'journal_entries',
        'journal_state',
        'journal_operations',
      ]),
    ).toEqual(before);
  } finally {
    f.close();
  }
});
it('admits maximum UTF16 NUL-containing body at the UTF8 SQL boundary', () => {
  const f = journalFixture();
  try {
    const j = new JournalRepository(f.db, f.now);
    const body = '\0' + '界'.repeat(9999);
    const ack = j.create(
      f.project.id,
      createInput(f.taskId, 0, body),
      'synthetic-session',
    );
    if (ack.kind !== 'saved') throw Error('Fixture');
    expect(j.getEntry(f.project.id, ack.entry.id).entry.body).toBe(body);
    expect(
      f.db
        .prepare(
          'SELECT length(CAST(body AS BLOB)) AS bytes FROM journal_entries',
        )
        .get(),
    ).toEqual({ bytes: 29998 });
    f.command({ type: 'task.delete', taskId: f.taskId });
    f.command({ type: 'undo' });
    expect(j.getEntry(f.project.id, ack.entry.id).entry).toEqual(ack.entry);
  } finally {
    f.close();
  }
});
