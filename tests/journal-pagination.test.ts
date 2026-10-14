import { expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import { JournalRepository } from '../src/server/journal-repository.js';
import { journalFixture, createInput } from './helpers/journal-fixture.js';
const fixtureId = (n: number) =>
  `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
function seed(f: ReturnType<typeof journalFixture>) {
  const stmt = f.db.prepare(
    'INSERT INTO journal_entries(id,projectId,taskId,workDate,body,createdAt,updatedAt) VALUES (?,?,?,?,?,?,?)',
  );
  for (let n = 1; n <= 125; n++)
    stmt.run(
      fixtureId(n),
      f.project.id,
      f.taskId,
      n > 60 ? '2024-02-29' : '2024-02-28',
      `Synthetic ${n}`,
      '2026-10-10T12:00:00.000Z',
      '2026-10-10T12:00:00.000Z',
    );
}
it('pages independent 125-entry fixture with ties and shared day boundary', () => {
  const f = journalFixture();
  try {
    seed(f);
    const j = new JournalRepository(f.db, f.now);
    const first = j.getProjectPage(f.project.id, {});
    const second = j.getProjectPage(f.project.id, {
      cursor: first.nextCursor!,
    });
    const third = j.getProjectPage(f.project.id, {
      cursor: second.nextCursor!,
    });
    expect(first.entries.map((e) => e.id)).toEqual(
      Array.from({ length: 50 }, (_, i) => fixtureId(125 - i)),
    );
    expect(second.entries.map((e) => e.id)).toEqual(
      Array.from({ length: 50 }, (_, i) => fixtureId(75 - i)),
    );
    expect(third.entries.map((e) => e.id)).toEqual(
      Array.from({ length: 25 }, (_, i) => fixtureId(25 - i)),
    );
    expect(third.nextCursor).toBeNull();
    expect(second.entries[14]!.workDate).toBe('2024-02-29');
    expect(second.entries[15]!.workDate).toBe('2024-02-28');
    const cursor = JSON.parse(
      Buffer.from(first.nextCursor!, 'base64url').toString(),
    );
    expect(cursor).not.toHaveProperty('body');
    expect(cursor).not.toHaveProperty('sessionId');
    for (const [key, value] of [
      ['projectId', randomUUID()],
      ['taskId', f.taskId],
      ['q', 'other'],
      ['from', '2024-02-01'],
      ['to', '2024-03-01'],
      ['limit', 51],
      ['version', 2],
      ['unknown', 'field'],
    ]) {
      const forged = Buffer.from(
        JSON.stringify({ ...cursor, [key as string]: value }),
      ).toString('base64url');
      expect(() =>
        j.getProjectPage(f.project.id, { cursor: forged }),
      ).toThrowError(expect.objectContaining({ code: 'INVALID_REQUEST' }));
    }
    for (const cursor of ['=', 'e30', 'a'.repeat(4097)])
      expect(() => j.getProjectPage(f.project.id, { cursor })).toThrow();
  } finally {
    f.close();
  }
});
it.each(['journal', 'rename', 'delete', 'undo'])(
  'invalidates cursor after %s change',
  (change) => {
    const f = journalFixture();
    try {
      seed(f);
      const j = new JournalRepository(f.db, f.now);
      if (change === 'undo')
        f.command({
          type: 'task.edit',
          taskId: f.taskId,
          changes: { title: 'Before undo' },
        });
      const cursor = j.getProjectPage(f.project.id, {}).nextCursor!;
      if (change === 'journal')
        j.create(f.project.id, createInput(f.taskId), 'synthetic-session');
      if (change === 'rename')
        f.command({
          type: 'task.edit',
          taskId: f.taskId,
          changes: { title: 'Renamed' },
        });
      if (change === 'delete')
        f.command({ type: 'task.delete', taskId: f.taskId });
      if (change === 'undo') f.command({ type: 'undo' });
      expect(() => j.getProjectPage(f.project.id, { cursor })).toThrowError(
        expect.objectContaining({ code: 'JOURNAL_CURSOR_STALE' }),
      );
    } finally {
      f.close();
    }
  },
);
it('uses literal Russian NFC body OR current title and inclusive date bounds', () => {
  const f = journalFixture();
  try {
    const j = new JournalRepository(f.db, f.now);
    const bodies = ['Ёж', 'Е\u0308ж', '100%_\n<b>plain</b>', 'old'];
    const dates = ['0001-01-01', '2024-02-29', '2024-03-01', '9999-12-31'];
    for (let i = 0; i < bodies.length; i++)
      j.create(
        f.project.id,
        { ...createInput(f.taskId, i, bodies[i]), workDate: dates[i]! },
        'synthetic-session',
      );
    for (const q of [' ЁЖ ', 'е\u0308ж'])
      expect(
        j.getProjectPage(f.project.id, { q }).entries.map((e) => e.body),
      ).toEqual(['Е\u0308ж', 'Ёж']);
    for (const q of ['%', '_', '\n<b>', '<b>plain</b>'])
      expect(
        j.getProjectPage(f.project.id, { q }).entries.map((e) => e.body),
      ).toEqual(['100%_\n<b>plain</b>']);
    expect(
      j.getProjectPage(f.project.id, { from: '2024-02-29', to: '2024-03-01' })
        .entries,
    ).toHaveLength(2);
    expect(
      j.getProjectPage(f.project.id, { to: '0001-01-01' }).entries,
    ).toHaveLength(1);
    expect(
      j.getProjectPage(f.project.id, { from: '9999-12-31' }).entries,
    ).toHaveLength(1);
    f.command({
      type: 'task.edit',
      taskId: f.taskId,
      changes: { title: 'НОВОЕ', status: 'done' },
    });
    expect(j.getProjectPage(f.project.id, { q: 'новое' }).entries).toHaveLength(
      4,
    );
    f.command({
      type: 'task.create',
      parentId: f.taskId,
      title: 'Nested',
      preserveWork: true,
    });
    const child = f.plan
      .getTree(f.project.id, 'synthetic-session')
      .tasks.find((t) => t.title === 'Nested')!;
    j.create(
      f.project.id,
      createInput(child.id, 4, 'Child'),
      'synthetic-session',
    );
    expect(j.getTaskPage(f.project.id, f.taskId, {}).entries).toHaveLength(4);
    expect(j.getProjectPage(f.project.id, {}).entries).toHaveLength(5);
  } finally {
    f.close();
  }
});
it('bounds maximal normalized Unicode cursor and rejects invalid UTF8 bytes', () => {
  const f = journalFixture();
  try {
    const j = new JournalRepository(f.db, f.now);
    const q = '界'.repeat(300);
    j.create(f.project.id, createInput(f.taskId, 0, q), 'synthetic-session');
    j.create(f.project.id, createInput(f.taskId, 1, q), 'synthetic-session');
    const first = j.getProjectPage(f.project.id, { q, limit: 1 });
    expect(first.nextCursor!.length).toBeLessThanOrEqual(4096);
    expect(
      j.getProjectPage(f.project.id, { q, limit: 1, cursor: first.nextCursor! })
        .entries,
    ).toHaveLength(1);
    const invalid = Buffer.concat([
      Buffer.from('{"q":"'),
      Buffer.from([0xff]),
      Buffer.from('"}'),
    ]).toString('base64url');
    expect(() =>
      j.getProjectPage(f.project.id, { cursor: invalid }),
    ).toThrowError(expect.objectContaining({ code: 'INVALID_REQUEST' }));
  } finally {
    f.close();
  }
});
it('paginates a full300-unit JSON-escaped query with a bounded4096 cursor', () => {
  const f = journalFixture();
  try {
    const j = new JournalRepository(f.db, f.now);
    const q = '\u0001'.repeat(300);
    for (let n = 0; n < 2; n++)
      j.create(f.project.id, createInput(f.taskId, n, q), 'synthetic-session');
    const first = j.getProjectPage(f.project.id, { q, limit: 1 });
    expect(first.nextCursor!.length).toBeGreaterThan(2048);
    expect(first.nextCursor!.length).toBeLessThanOrEqual(4096);
    const second = j.getProjectPage(f.project.id, {
      q,
      limit: 1,
      cursor: first.nextCursor!,
    });
    expect(second.nextCursor).toBeNull();
    expect([...first.entries, ...second.entries].map((e) => e.body)).toEqual([
      q,
      q,
    ]);
    expect(
      new Set([...first.entries, ...second.entries].map((e) => e.id)).size,
    ).toBe(2);
  } finally {
    f.close();
  }
});
