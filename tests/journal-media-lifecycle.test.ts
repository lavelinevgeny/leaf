import { expect, it } from 'vitest';
import { richFixture, mediaContent } from './helpers/journal-rich-fixture.js';
import { rawTables } from './helpers/journal-fixture.js';
const tables = [
  'projects',
  'tasks',
  'journal_entries',
  'journal_entry_media',
  'journal_media',
  'journal_state',
  'journal_operations',
  'undo_snapshots',
  'undo_journal_manifest',
  'undo_journal_entries',
  'undo_journal_media',
  'operations',
];
it('pins exact content and one BLOB, revokes download and restores exact entries/bytes', async () => {
  const f = await richFixture();
  try {
    const a = await f.stage();
    const saved = f.journal.create(
      f.project.id,
      f.input(mediaContent(a.id)),
      'synthetic-session',
    );
    if (saved.kind !== 'saved') throw Error('fixture');
    const bytes = f.media.read(
      f.project.id,
      f.taskId,
      a.id,
      'synthetic-session',
    )!.bytes;
    f.command({ type: 'task.delete', taskId: f.taskId });
    expect(
      f.db.prepare('SELECT count(*) AS n FROM undo_journal_media').get(),
    ).toEqual({ n: 1 });
    expect(
      f.media.read(f.project.id, f.taskId, a.id, 'synthetic-session'),
    ).toBeUndefined();
    expect(f.media.collectGarbage()).toBe(0);
    f.command({ type: 'undo' });
    expect(f.journal.getEntry(f.project.id, saved.entry.id).entry).toEqual(
      saved.entry,
    );
    expect(
      f.media.read(f.project.id, f.taskId, a.id, 'synthetic-session')!.bytes,
    ).toEqual(bytes);
    expect(
      f.db.prepare('SELECT unreferencedAt FROM journal_media').get(),
    ).toEqual({ unreferencedAt: null });
  } finally {
    f.close();
  }
});
it.each([
  'blob',
  'missing-blob',
  'relation',
  'content',
  'manifest',
  'media-count',
  'payload',
  'legacy-digest',
  'home',
])('rolls back corrupt rich Undo %s', async (damage) => {
  const f = await richFixture();
  try {
    const a = await f.stage();
    f.journal.create(
      f.project.id,
      f.input(mediaContent(a.id)),
      'synthetic-session',
    );
    f.command({ type: 'task.delete', taskId: f.taskId });
    if (damage === 'blob')
      f.db
        .prepare('UPDATE journal_media SET bytes=?')
        .run(Buffer.from('damaged!! bytes'));
    if (damage === 'missing-blob')
      f.db.exec('UPDATE journal_media SET bytes=NULL');
    if (damage === 'relation') f.db.exec('DELETE FROM undo_journal_media');
    if (damage === 'content')
      f.db.exec('UPDATE undo_journal_entries SET contentJson=NULL');
    if (damage === 'manifest')
      f.db.exec(
        'DELETE FROM undo_journal_manifest WHERE undoSequence=(SELECT MAX(sequence) FROM undo_snapshots)',
      );
    if (damage === 'media-count')
      f.db.exec('UPDATE undo_journal_manifest SET mediaCount=0');
    if (damage === 'payload')
      f.db.exec("UPDATE undo_journal_manifest SET payloadSha256='bad'");
    if (damage === 'legacy-digest')
      f.db.exec("UPDATE undo_journal_manifest SET entriesSha256='bad'");
    if (damage === 'home')
      f.db.exec('UPDATE journal_media SET homeEntryId=NULL');
    const before = rawTables(f.db, tables);
    expect(() => f.command({ type: 'undo' })).toThrow();
    expect(rawTables(f.db, tables)).toEqual(before);
  } finally {
    f.close();
  }
});
it('requires even an empty lifecycle2 manifest and blocks media-only late entries', async () => {
  const f = await richFixture();
  try {
    const row = f.db
      .prepare(
        'SELECT journalLifecycleVersion FROM undo_snapshots ORDER BY sequence DESC LIMIT 1',
      )
      .get();
    expect(row).toEqual({ journalLifecycleVersion: 2 });
    const a = await f.stage();
    f.journal.create(
      f.project.id,
      f.input(mediaContent(a.id)),
      'synthetic-session',
    );
    const before = rawTables(f.db, tables);
    expect(() => f.command({ type: 'undo' })).toThrowError(
      expect.objectContaining({ code: 'UNDO_JOURNAL_CONFLICT' }),
    );
    expect(rawTables(f.db, tables)).toEqual(before);
  } finally {
    f.close();
  }
});
it('requires empty manifest integrity and restores historical lifecycle1 with unchanged old digest', async () => {
  const f = await richFixture();
  try {
    f.db.exec(
      'DELETE FROM undo_journal_manifest WHERE undoSequence=(SELECT MAX(sequence) FROM undo_snapshots)',
    );
    const before = rawTables(f.db, tables);
    expect(() => f.command({ type: 'undo' })).toThrow();
    expect(rawTables(f.db, tables)).toEqual(before);
  } finally {
    f.close();
  }
  const legacy = await richFixture();
  try {
    const { JournalRepository } =
      await import('../src/server/journal-repository.js');
    const { createInput } = await import('./helpers/journal-fixture.js');
    const j = new JournalRepository(legacy.db, legacy.now);
    const original = j.create(
      legacy.project.id,
      createInput(legacy.taskId),
      'synthetic-session',
    );
    legacy.command({ type: 'task.delete', taskId: legacy.taskId });
    const old = legacy.db
      .prepare(
        'SELECT entriesSha256 FROM undo_journal_manifest ORDER BY undoSequence DESC LIMIT 1',
      )
      .get();
    legacy.db.exec(
      'UPDATE undo_snapshots SET journalLifecycleVersion=1; UPDATE undo_journal_manifest SET mediaCount=NULL,payloadSha256=NULL',
    );
    expect(
      legacy.db
        .prepare(
          'SELECT entriesSha256 FROM undo_journal_manifest ORDER BY undoSequence DESC LIMIT 1',
        )
        .get(),
    ).toEqual(old);
    legacy.command({ type: 'undo' });
    if (original.kind !== 'saved') throw Error('fixture');
    expect(j.getEntry(legacy.project.id, original.entry.id).entry).toEqual(
      original.entry,
    );
  } finally {
    legacy.close();
  }
});
it('protects Undo BLOB across TTL, preserves surviving edits and begins GC grace only after pruning', async () => {
  const f = await richFixture();
  try {
    const { JournalMediaRepository } =
      await import('../src/server/journal-media-repository.js');
    const a = await f.stage();
    const saved = f.journal.create(
      f.project.id,
      f.input(mediaContent(a.id)),
      'synthetic-session',
    );
    if (saved.kind !== 'saved') throw Error('fixture');
    f.command({ type: 'task.create', title: 'survivor', parentId: null });
    const survivor = f.plan
      .getTree(f.project.id, 'synthetic-session')
      .tasks.find((t) => t.title === 'survivor')!;
    f.command({ type: 'task.delete', taskId: f.taskId });
    const later = f.journal.create(
      f.project.id,
      {
        ...f.input({ format: 'plain-text', text: 'surviving edit' }, 2),
        taskId: survivor.id,
      },
      'synthetic-session',
    );
    f.command({ type: 'undo' });
    if (later.kind !== 'saved') throw Error('fixture');
    expect(f.journal.getEntry(f.project.id, later.entry.id).entry).toEqual(
      later.entry,
    );
    expect(f.journal.getEntry(f.project.id, saved.entry.id).entry).toEqual(
      saved.entry,
    );
    f.command({ type: 'task.delete', taskId: f.taskId });
    let clock = Date.parse('2026-11-20T00:00:00.000Z');
    const gc = new JournalMediaRepository(f.db, () => clock);
    expect(gc.collectGarbage()).toBe(0);
    for (let n = 0; n < 21; n++)
      f.command({
        type: 'task.edit',
        taskId: survivor.id,
        changes: { title: `survivor ${n}` },
      });
    expect(
      f.db.prepare('SELECT count(*) AS n FROM undo_journal_media').get(),
    ).toEqual({ n: 0 });
    expect(gc.collectGarbage()).toBe(0);
    clock += 24 * 60 * 60 * 1000;
    expect(gc.collectGarbage()).toBe(1);
    expect(
      f.db.prepare('SELECT bytes FROM journal_media WHERE id=?').get(a.id),
    ).toEqual({ bytes: null });
  } finally {
    f.close();
  }
});
it('holds normalized image bytes by stored hash and restores without decoding source again', async () => {
  const f = await richFixture();
  try {
    const sharp = (await import('sharp')).default;
    const { randomUUID, createHash } = await import('node:crypto');
    const source = await sharp({
      create: { width: 2, height: 3, channels: 3, background: '#123456' },
    })
      .png()
      .toBuffer();
    const image = await f.media.stage({
      projectId: f.project.id,
      taskId: f.taskId,
      sessionId: 'synthetic-session',
      uploadId: randomUUID(),
      kind: 'image',
      fileName: 'image.png',
      bytes: source,
    });
    const saved = f.journal.create(
      f.project.id,
      f.input({
        format: 'rich-text',
        documentVersion: 1,
        doc: {
          type: 'doc',
          content: [
            {
              type: 'journalImage',
              attrs: { mediaId: image.id, alt: 'Synthetic image' },
            },
          ],
        },
      }),
      'synthetic-session',
    );
    if (saved.kind !== 'saved') throw Error('fixture');
    const bytes = f.media.read(
      f.project.id,
      f.taskId,
      image.id,
      'synthetic-session',
    )!.bytes;
    expect(bytes.equals(source)).toBe(false);
    const row = f.db
      .prepare('SELECT sourceSha256,storedSha256 FROM journal_media WHERE id=?')
      .get(image.id);
    expect(row).toEqual({
      sourceSha256: createHash('sha256').update(source).digest('hex'),
      storedSha256: createHash('sha256').update(bytes).digest('hex'),
    });
    f.command({ type: 'task.delete', taskId: f.taskId });
    f.command({ type: 'undo' });
    expect(f.journal.getEntry(f.project.id, saved.entry.id).entry).toEqual(
      saved.entry,
    );
    expect(
      f.media.read(f.project.id, f.taskId, image.id, 'synthetic-session')!
        .bytes,
    ).toEqual(bytes);
  } finally {
    f.close();
  }
});
it('does not inspect damaged surviving media during unrelated planning edits but rejects its deletion atomically', async () => {
  const f = await richFixture();
  try {
    const media = await f.stage();
    f.journal.create(
      f.project.id,
      f.input(mediaContent(media.id)),
      'synthetic-session',
    );
    f.db
      .prepare('UPDATE journal_media SET bytes=NULL WHERE id=?')
      .run(media.id);
    const journalTables = [
      'journal_entries',
      'journal_entry_media',
      'journal_media',
      'journal_state',
      'journal_operations',
    ];
    const journalBefore = rawTables(f.db, journalTables);
    const updated = f.command({
      type: 'task.edit',
      taskId: f.taskId,
      changes: { title: 'Unrelated planning rename' },
    });
    expect(updated.tasks.find((task) => task.id === f.taskId)?.title).toBe(
      'Unrelated planning rename',
    );
    expect(rawTables(f.db, journalTables)).toEqual(journalBefore);
    expect(
      f.db
        .prepare(
          'SELECT entryCount,mediaCount FROM undo_journal_manifest ORDER BY undoSequence DESC LIMIT 1',
        )
        .get(),
    ).toEqual({ entryCount: 0, mediaCount: 0 });
    const beforeDelete = rawTables(f.db, tables);
    expect(() =>
      f.command({ type: 'task.delete', taskId: f.taskId }),
    ).toThrow();
    expect(rawTables(f.db, tables)).toEqual(beforeDelete);
  } finally {
    f.close();
  }
});
