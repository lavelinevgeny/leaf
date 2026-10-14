import { expect, it } from 'vitest';
import { createHash, randomUUID } from 'node:crypto';
import { openDatabase } from '../src/server/database.js';
import { JournalRepository } from '../src/server/journal-repository.js';
import {
  journalFixture,
  createInput,
  rawTables,
} from './helpers/journal-fixture.js';
it('keeps frozen create/update/delete acknowledgements after reopen and task deletion', () => {
  const f = journalFixture();
  try {
    let j = new JournalRepository(f.db, f.now);
    const create = createInput(f.taskId);
    const first = j.create(f.project.id, create, 'synthetic-session');
    if (first.kind !== 'saved') throw Error('Fixture');
    const update = {
      journalContractVersion: 1 as const,
      operationId: randomUUID(),
      expectedJournalRevision: 1,
      workDate: '9999-12-31',
      body: 'Later',
    };
    const second = j.update(
      f.project.id,
      first.entry.id,
      update,
      'synthetic-session',
    );
    const remove = {
      journalContractVersion: 1 as const,
      operationId: randomUUID(),
      expectedJournalRevision: 2,
    };
    const third = j.delete(
      f.project.id,
      first.entry.id,
      remove,
      'synthetic-session',
    );
    f.command({ type: 'task.delete', taskId: f.taskId });
    f.db.close();
    const reopened = openDatabase(f.path);
    try {
      j = new JournalRepository(reopened, f.now);
      expect(j.create(f.project.id, create, 'synthetic-session')).toEqual(
        first,
      );
      expect(
        j.update(f.project.id, first.entry.id, update, 'synthetic-session'),
      ).toEqual(second);
      expect(
        j.delete(f.project.id, first.entry.id, remove, 'synthetic-session'),
      ).toEqual(third);
      expect(j.getProjectPage(f.project.id, {}).journalRevision).toBe(3);
      expect(
        reopened.prepare('SELECT COUNT(*) AS n FROM journal_operations').get(),
      ).toEqual({ n: 3 });
    } finally {
      reopened.close();
    }
  } finally {
    f.close();
  }
});
it.each([
  'json',
  'digest',
  'project',
  'entryProject',
  'task',
  'body',
  'date',
  'kind',
  'revision',
  'extra',
  'contract',
])('rejects replay corruption %s atomically', (damage) => {
  const f = journalFixture();
  try {
    const j = new JournalRepository(f.db, f.now);
    const input = createInput(f.taskId);
    const saved = j.create(f.project.id, input, 'synthetic-session');
    if (saved.kind !== 'saved') throw Error('Fixture');
    // Independent accepted DTO shape, with only generated identity/timestamp pinned from setup.
    const entry = {
      id: saved.entry.id,
      projectId: f.project.id,
      taskId: f.taskId,
      workDate: '2024-02-29',
      body: '  Первая строка\nВторая строка  ',
      createdAt: saved.entry.createdAt,
      updatedAt: saved.entry.updatedAt,
    };
    const dto: Record<string, unknown> = {
      journalContractVersion: 1,
      kind: 'saved',
      projectId: f.project.id,
      journalRevision: 1,
      entry,
    };
    if (damage === 'project') dto.projectId = randomUUID();
    if (damage === 'entryProject') entry.projectId = randomUUID();
    if (damage === 'task') entry.taskId = randomUUID();
    if (damage === 'body') entry.body = 'Valid other text';
    if (damage === 'date') entry.workDate = '2024-02-28';
    if (damage === 'kind') {
      dto.kind = 'deleted';
      delete dto.entry;
      dto.deletedEntryId = randomUUID();
    }
    if (damage === 'revision') dto.journalRevision = 8;
    if (damage === 'extra') dto.sessionId = 'synthetic-session';
    const response = damage === 'json' ? 'invalid-json' : JSON.stringify(dto);
    const hash =
      damage === 'digest'
        ? '0'.repeat(64)
        : createHash('sha256').update(response).digest('hex');
    f.db
      .prepare(
        'UPDATE journal_operations SET response=?,responseSha256=? WHERE operationId=?',
      )
      .run(response, hash, input.operationId);
    if (damage === 'contract') {
      f.db.pragma('ignore_check_constraints=ON');
      f.db.prepare('UPDATE journal_operations SET contractVersion=2').run();
      f.db.pragma('ignore_check_constraints=OFF');
    }
    const before = rawTables(f.db, [
      'journal_entries',
      'journal_state',
      'journal_operations',
    ]);
    expect(() => j.create(f.project.id, input, 'synthetic-session')).toThrow();
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
it.each(['PATCH', 'DELETE'])(
  'rejects valid but wrong %s replay entry identity',
  (method) => {
    const f = journalFixture();
    try {
      const j = new JournalRepository(f.db, f.now);
      const saved = j.create(
        f.project.id,
        createInput(f.taskId),
        'synthetic-session',
      );
      if (saved.kind !== 'saved') throw Error('Fixture');
      const input = {
        journalContractVersion: 1 as const,
        operationId: randomUUID(),
        expectedJournalRevision: 1,
      };
      let dto;
      if (method === 'PATCH') {
        j.update(
          f.project.id,
          saved.entry.id,
          { ...input, workDate: '2024-02-28', body: 'Synthetic update' },
          'synthetic-session',
        );
        dto = {
          journalContractVersion: 1,
          kind: 'saved',
          projectId: f.project.id,
          journalRevision: 2,
          entry: {
            id: randomUUID(),
            projectId: f.project.id,
            taskId: f.taskId,
            workDate: '2024-02-28',
            body: 'Synthetic update',
            createdAt: '2026-10-10T12:00:00.000Z',
            updatedAt: '2026-10-10T12:00:00.000Z',
          },
        };
      } else {
        j.delete(f.project.id, saved.entry.id, input, 'synthetic-session');
        dto = {
          journalContractVersion: 1,
          kind: 'deleted',
          projectId: f.project.id,
          journalRevision: 2,
          deletedEntryId: randomUUID(),
        };
      }
      const response = JSON.stringify(dto);
      f.db
        .prepare(
          'UPDATE journal_operations SET response=?,responseSha256=? WHERE operationId=?',
        )
        .run(
          response,
          createHash('sha256').update(response).digest('hex'),
          input.operationId,
        );
      const before = rawTables(f.db, [
        'journal_entries',
        'journal_state',
        'journal_operations',
      ]);
      expect(() =>
        method === 'PATCH'
          ? j.update(
              f.project.id,
              saved.entry.id,
              { ...input, workDate: '2024-02-28', body: 'Synthetic update' },
              'synthetic-session',
            )
          : j.delete(f.project.id, saved.entry.id, input, 'synthetic-session'),
      ).toThrow();
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
  },
);
