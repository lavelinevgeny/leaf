import { expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import {
  journalFixture,
  createInput,
  rawTables,
} from './helpers/journal-fixture.js';
import { JournalRepository } from '../src/server/journal-repository.js';
import { JournalRepositoryV2 } from '../src/server/journal-repository-v2.js';
import { richFixture, mediaContent } from './helpers/journal-rich-fixture.js';
it('publishes media-only content atomically, searches projection and freezes acknowledgement without live media', async () => {
  const f = await richFixture();
  try {
    const a = await f.stage('Отчёт.txt');
    const input = f.input(mediaContent(a.id));
    const before = f.journal.getProjectPage(f.project.id, {});
    const first = f.journal.create(f.project.id, input, 'synthetic-session');
    expect(first.kind).toBe('saved');
    if (first.kind !== 'saved') throw Error('fixture');
    expect(first.entry.body).toBe('[Файл: Отчёт.txt]');
    expect(first.entry.content).toEqual(input.content);
    const after = f.journal.getProjectPage(f.project.id, { q: 'отчёт' });
    expect(after.entries).toEqual([first.entry]);
    expect(after.projectRevision).toBe(before.projectRevision);
    expect(after.journalRevision).toBe(before.journalRevision + 1);
    f.journal.delete(
      f.project.id,
      first.entry.id,
      {
        journalContractVersion: 2,
        operationId: randomUUID(),
        expectedJournalRevision: 1,
      },
      'synthetic-session',
    );
    f.db.prepare('UPDATE journal_media SET bytes=NULL').run();
    expect(
      new JournalRepositoryV2(f.db, f.now).create(
        f.project.id,
        input,
        'synthetic-session',
      ),
    ).toEqual(first);
  } finally {
    f.close();
  }
});
it('rejects the final missing media without any writes; validates stale baseline and cursor2', async () => {
  const f = await richFixture();
  try {
    const a = await f.stage();
    const tables = [
      'journal_entries',
      'journal_entry_media',
      'journal_state',
      'journal_operations',
      'journal_media',
    ];
    const before = rawTables(f.db, tables);
    expect(() =>
      f.journal.create(
        f.project.id,
        f.input(mediaContent(a.id, randomUUID())),
        'synthetic-session',
      ),
    ).toThrow();
    expect(rawTables(f.db, tables)).toEqual(before);
    f.journal.create(
      f.project.id,
      f.input(mediaContent(a.id)),
      'synthetic-session',
    );
    expect(() =>
      f.journal.create(
        f.project.id,
        f.input({ format: 'plain-text', text: 'stale' }),
        'synthetic-session',
      ),
    ).toThrow();
    f.journal.create(
      f.project.id,
      f.input({ format: 'plain-text', text: 'second' }, 1),
      'synthetic-session',
    );
    const page = f.journal.getProjectPage(f.project.id, { limit: 1 });
    expect(
      JSON.parse(Buffer.from(page.nextCursor!, 'base64url').toString()).version,
    ).toBe(2);
    expect(
      f.journal.getProjectPage(f.project.id, {
        limit: 1,
        cursor: page.nextCursor!,
      }).entries,
    ).toHaveLength(1);
    const bad = JSON.parse(
      Buffer.from(page.nextCursor!, 'base64url').toString(),
    );
    bad.version = 1;
    expect(() =>
      f.journal.getProjectPage(f.project.id, {
        limit: 1,
        cursor: Buffer.from(JSON.stringify(bad)).toString('base64url'),
      }),
    ).toThrow();
  } finally {
    f.close();
  }
});
it('reads legacy exact body/date without upgrading rows', () => {
  const f = journalFixture();
  try {
    const legacy = new JournalRepository(f.db, f.now);
    const saved = legacy.create(
      f.project.id,
      createInput(f.taskId, 0, ' A\u0000\nB '),
      'synthetic-session',
    );
    if (saved.kind !== 'saved') throw Error('fixture');
    const before = rawTables(f.db, ['journal_entries', 'journal_operations']);
    expect(
      new JournalRepositoryV2(f.db, f.now).getEntry(
        f.project.id,
        saved.entry.id,
      ).entry,
    ).toEqual({
      ...saved.entry,
      content: { format: 'plain-text', text: ' A\u0000\nB ' },
      media: [],
    });
    expect(rawTables(f.db, ['journal_entries', 'journal_operations'])).toEqual(
      before,
    );
  } finally {
    f.close();
  }
});
it('keeps exact rich content on date-only update and validates frozen document beyond its projection', async () => {
  const f = await richFixture();
  try {
    const content = {
      format: 'rich-text' as const,
      documentVersion: 1 as const,
      doc: {
        type: 'doc' as const,
        content: [
          {
            type: 'paragraph' as const,
            content: [
              {
                type: 'text' as const,
                text: 'same',
                marks: [{ type: 'bold' as const }],
              },
            ],
          },
        ],
      },
    };
    const input = f.input(content);
    const saved = f.journal.create(f.project.id, input, 'synthetic-session');
    if (saved.kind !== 'saved') throw Error('fixture');
    const update = {
      journalContractVersion: 2 as const,
      operationId: randomUUID(),
      expectedJournalRevision: 1,
      workDate: '0001-01-01',
      content,
    };
    const changed = f.journal.update(
      f.project.id,
      saved.entry.id,
      update,
      'synthetic-session',
    );
    if (changed.kind !== 'saved') throw Error('fixture');
    expect(changed.entry.content).toEqual(content);
    expect(changed.entry.body).toBe('same');
    expect(changed.entry.workDate).toBe('0001-01-01');
    const { createHash } = await import('node:crypto');
    const tampered = JSON.parse(JSON.stringify(saved));
    tampered.entry.content.doc.content[0].content[0].marks = [];
    const response = JSON.stringify(tampered);
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
      'journal_operations',
      'journal_state',
    ]);
    expect(() =>
      f.journal.create(f.project.id, input, 'synthetic-session'),
    ).toThrow('replay scope');
    expect(
      rawTables(f.db, [
        'journal_entries',
        'journal_operations',
        'journal_state',
      ]),
    ).toEqual(before);
  } finally {
    f.close();
  }
});
it.each(['entry', 'relation', 'replay'])(
  'rolls back all new publication rows on %s storage failure',
  async (point) => {
    const f = await richFixture();
    try {
      const a = await f.stage();
      const table =
        point === 'entry'
          ? 'journal_entries'
          : point === 'relation'
            ? 'journal_entry_media'
            : 'journal_operations';
      f.db.exec(
        `CREATE TRIGGER synthetic_failure BEFORE INSERT ON ${table} BEGIN SELECT RAISE(ABORT,'Synthetic failure'); END`,
      );
      const tables = [
        'journal_entries',
        'journal_entry_media',
        'journal_media',
        'journal_state',
        'journal_operations',
      ];
      const before = rawTables(f.db, tables);
      expect(() =>
        f.journal.create(
          f.project.id,
          f.input(mediaContent(a.id)),
          'synthetic-session',
        ),
      ).toThrow();
      expect(rawTables(f.db, tables)).toEqual(before);
    } finally {
      f.close();
    }
  },
);
it('replays create/update/delete exactly from an independently reopened database', async () => {
  const f = await richFixture();
  const { openDatabase } = await import('../src/server/database.js');
  const { rmSync } = await import('node:fs');
  let copy: ReturnType<typeof openDatabase> | undefined;
  try {
    const a = await f.stage();
    const input = f.input(mediaContent(a.id));
    const saved = f.journal.create(f.project.id, input, 'synthetic-session');
    if (saved.kind !== 'saved') throw Error('fixture');
    const update = {
      journalContractVersion: 2 as const,
      operationId: randomUUID(),
      expectedJournalRevision: 1,
      workDate: '2024-03-01',
      content: { format: 'plain-text' as const, text: 'edited' },
    };
    const edited = f.journal.update(
      f.project.id,
      saved.entry.id,
      update,
      'synthetic-session',
    );
    const remove = {
      journalContractVersion: 2 as const,
      operationId: randomUUID(),
      expectedJournalRevision: 2,
    };
    const deleted = f.journal.delete(
      f.project.id,
      saved.entry.id,
      remove,
      'synthetic-session',
    );
    f.db.close();
    copy = openDatabase(f.path);
    const repo = new JournalRepositoryV2(copy, f.now);
    expect(repo.create(f.project.id, input, 'synthetic-session')).toEqual(
      saved,
    );
    expect(
      repo.update(f.project.id, saved.entry.id, update, 'synthetic-session'),
    ).toEqual(edited);
    expect(
      repo.delete(f.project.id, saved.entry.id, remove, 'synthetic-session'),
    ).toEqual(deleted);
    expect(repo.getProjectPage(f.project.id, {}).entries).toEqual([]);
  } finally {
    if (copy) copy.close();
    if (f.db.open) f.db.close();
    rmSync(f.dir, { recursive: true, force: true });
  }
});
it('returns stable metadata order across acknowledgement, read and lifecycle restore for multiple files', async () => {
  const f = await richFixture();
  try {
    const a = await f.stage('first.txt');
    const b = await f.stage('second.txt');
    const ids = [a.id, b.id].sort().reverse();
    const saved = f.journal.create(
      f.project.id,
      f.input(mediaContent(...ids)),
      'synthetic-session',
    );
    if (saved.kind !== 'saved') throw Error('fixture');
    expect(f.journal.getEntry(f.project.id, saved.entry.id).entry).toEqual(
      saved.entry,
    );
    f.command({ type: 'task.delete', taskId: f.taskId });
    f.command({ type: 'undo' });
    expect(f.journal.getEntry(f.project.id, saved.entry.id).entry).toEqual(
      saved.entry,
    );
  } finally {
    f.close();
  }
});
