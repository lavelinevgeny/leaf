import { expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import sharp from 'sharp';
import {
  journalFixture,
  createInput,
  rawTables,
} from './helpers/journal-fixture.js';
import { JournalRepository } from '../src/server/journal-repository.js';
import { JournalMediaRepository } from '../src/server/journal-media-repository.js';
import { JOURNAL_MEDIA_LIMITS as L } from '../src/shared/journal-media-contracts.js';
import type { JournalMedia } from '../src/shared/journal-media-contracts.js';
import type { JournalContent } from '../src/shared/journal-content.js';
function fixture() {
  const f = journalFixture();
  let time = Date.parse('2026-11-14T12:00:00.000Z');
  const now = () => time;
  f.db
    .prepare('INSERT INTO sessions VALUES (?,?)')
    .run('synthetic-session', time + 10 * L.ttlMilliseconds);
  f.db
    .prepare('INSERT INTO sessions VALUES (?,?)')
    .run('other-session', time + 10 * L.ttlMilliseconds);
  const repo = new JournalMediaRepository(f.db, now);
  const scope = {
    projectId: f.project.id,
    taskId: f.taskId,
    sessionId: 'synthetic-session',
  };
  const input = () => ({
    ...scope,
    uploadId: randomUUID(),
    kind: 'file' as const,
    fileName: 'example.txt',
    bytes: Buffer.from('synthetic'),
  });
  const entry = () => {
    const j = new JournalRepository(f.db, now);
    const saved = j.create(
      f.project.id,
      createInput(f.taskId, j.getProjectPage(f.project.id, {}).journalRevision),
      scope.sessionId,
    );
    if (saved.kind !== 'saved') throw Error('Fixture');
    return saved.entry;
  };
  return {
    ...f,
    repo,
    scope,
    input,
    entry,
    advance: (n: number) => {
      time += n;
    },
  };
}
const doc = (...ids: string[]): JournalContent => ({
  format: 'rich-text',
  documentVersion: 1,
  doc: {
    type: 'doc',
    content: ids.map((mediaId) => ({
      type: 'journalFile',
      attrs: { mediaId },
    })),
  },
});
it('stages one immutable identity, exact bytes and retry without journal or planning writes', async () => {
  const f = fixture();
  try {
    const before = rawTables(f.db, [
      'projects',
      'tasks',
      'journal_state',
      'journal_operations',
      'undo_snapshots',
    ]);
    const input = f.input();
    const a = await f.repo.stage(input);
    const b = await f.repo.stage(input);
    expect(b).toEqual(a);
    expect(
      f.db
        .prepare(
          'SELECT count(*) AS n FROM journal_media WHERE bytes IS NOT NULL',
        )
        .get(),
    ).toEqual({ n: 1 });
    expect(
      f.repo.read(f.scope.projectId, f.taskId, a.id, f.scope.sessionId)?.bytes,
    ).toEqual(Buffer.from('synthetic'));
    expect(
      rawTables(f.db, [
        'projects',
        'tasks',
        'journal_state',
        'journal_operations',
        'undo_snapshots',
      ]),
    ).toEqual(before);
    for (const change of [
      { bytes: Buffer.from('other') },
      { fileName: 'other.txt' },
      { sessionId: 'other-session' },
      { kind: 'image' as const },
      { taskId: randomUUID() },
    ])
      await expect(f.repo.stage({ ...input, ...change })).rejects.toMatchObject(
        { code: 'MEDIA_UPLOAD_REUSED', statusCode: 409 },
      );
    f.advance(L.ttlMilliseconds);
    expect(f.repo.collectGarbage()).toBe(1);
    await expect(f.repo.stage(input)).rejects.toMatchObject({
      code: 'MEDIA_UPLOAD_EXPIRED',
      statusCode: 410,
    });
    expect(
      f.repo.read(f.project.id, f.taskId, a.id, f.scope.sessionId),
    ).toBeUndefined();
  } finally {
    f.close();
  }
});
it('validates all IDs and ownership before attaching, and revokes reads when detached', async () => {
  const f = fixture();
  try {
    const a = await f.repo.stage(f.input());
    const e = f.entry();
    expect(
      f.repo.read(f.project.id, f.taskId, a.id, 'other-session'),
    ).toBeUndefined();
    expect(
      f.repo.read(randomUUID(), f.taskId, a.id, f.scope.sessionId),
    ).toBeUndefined();
    expect(() =>
      f.db
        .transaction(() =>
          f.repo.attach(e, doc(a.id, randomUUID()), f.scope.sessionId),
        )
        .immediate(),
    ).toThrow();
    expect(f.repo.metadataForEntry(e.id)).toEqual([]);
    f.db
      .transaction(() => f.repo.attach(e, doc(a.id), f.scope.sessionId))
      .immediate();
    expect(f.repo.metadataForEntry(e.id)).toEqual([a]);
    expect(
      f.repo.read(f.project.id, f.taskId, a.id, 'other-session')?.media,
    ).toEqual(a);
    const other = f.entry();
    expect(() =>
      f.db
        .transaction(() => f.repo.attach(other, doc(a.id), f.scope.sessionId))
        .immediate(),
    ).toThrow();
    f.advance(2 * L.ttlMilliseconds);
    expect(f.repo.collectGarbage()).toBe(0);
    f.db
      .transaction(() =>
        f.repo.attach(
          e,
          { format: 'plain-text', text: 'Remaining' },
          f.scope.sessionId,
        ),
      )
      .immediate();
    expect(
      f.repo.read(f.project.id, f.taskId, a.id, f.scope.sessionId),
    ).toBeUndefined();
    expect(f.repo.collectGarbage()).toBe(0);
    f.advance(L.ttlMilliseconds - 1);
    expect(f.repo.collectGarbage()).toBe(0);
    f.advance(1);
    expect(f.repo.collectGarbage()).toBe(1);
  } finally {
    f.close();
  }
});
it('normalizes static raster magic to lossless WebP without metadata; rejects malformed/animated/oversized images', async () => {
  const f = fixture();
  try {
    const bytes = await sharp({
      create: { width: 2, height: 3, channels: 4, background: '#aabbcc' },
    })
      .png()
      .toBuffer();
    const a = await f.repo.stage({
      ...f.input(),
      kind: 'image',
      bytes,
      fileName: 'picture.png',
    });
    expect(a).toMatchObject({
      kind: 'image',
      fileName: 'picture.webp',
      mediaType: 'image/webp',
      width: 2,
      height: 3,
    });
    const saved = f.repo.read(f.project.id, f.taskId, a.id, f.scope.sessionId)!;
    const meta = await sharp(saved.bytes).metadata();
    expect(meta.format).toBe('webp');
    expect(meta.exif).toBeUndefined();
    for (const invalid of [Buffer.from('<svg/>'), bytes.subarray(0, 40)])
      await expect(
        f.repo.stage({ ...f.input(), kind: 'image', bytes: invalid }),
      ).rejects.toMatchObject({ statusCode: 415 });
    await expect(
      f.repo.stage({
        ...f.input(),
        kind: 'image',
        bytes: Buffer.alloc(L.imageSourceBytes + 1),
      }),
    ).rejects.toMatchObject({ statusCode: 413 });
  } finally {
    f.close();
  }
});
it('sanitizes filenames, rejects empty bytes, expired sessions and task deletion at decode commit', async () => {
  const f = fixture();
  try {
    const a = await f.repo.stage({
      ...f.input(),
      fileName: '../bad\\name\r\n\u202e.txt',
    });
    expect(a.fileName).toBe('..badname.txt');
    await expect(
      f.repo.stage({ ...f.input(), bytes: Buffer.alloc(0) }),
    ).rejects.toMatchObject({ statusCode: 400 });
    await expect(
      f.repo.stage({ ...f.input(), sessionId: 'absent' }),
    ).rejects.toMatchObject({ statusCode: 401 });
    const bytes = await sharp({
      create: { width: 1, height: 1, channels: 3, background: '#ffffff' },
    })
      .png()
      .toBuffer();
    const pending = f.repo.stage({ ...f.input(), kind: 'image', bytes });
    f.command({ type: 'task.delete', taskId: f.taskId });
    await expect(pending).rejects.toMatchObject({ statusCode: 404 });
  } finally {
    f.close();
  }
});
it('keeps immutable safe source filename separately from normalized download name', async () => {
  const f = fixture();
  try {
    const bytes = await sharp({
      create: { width: 1, height: 1, channels: 3, background: '#ffffff' },
    })
      .png()
      .toBuffer();
    const input = {
      ...f.input(),
      kind: 'image' as const,
      bytes,
      fileName: 'same.png',
    };
    await f.repo.stage(input);
    await expect(
      f.repo.stage({ ...input, fileName: 'same.jpg' }),
    ).rejects.toMatchObject({ code: 'MEDIA_UPLOAD_REUSED', statusCode: 409 });
  } finally {
    f.close();
  }
});
it('starts retention only after both live and Undo pins disappear, including FK cascades', async () => {
  const f = fixture();
  try {
    const a = await f.repo.stage(f.input());
    const e = f.entry();
    f.db
      .transaction(() => f.repo.attach(e, doc(a.id), f.scope.sessionId))
      .immediate();
    const snapshot = f.db
      .prepare('SELECT MAX(sequence) AS n FROM undo_snapshots')
      .get() as { n: number };
    f.db
      .prepare(
        'INSERT INTO undo_journal_entries(undoSequence,id,projectId,taskId,workDate,body,createdAt,updatedAt) VALUES (?,?,?,?,?,?,?,?)',
      )
      .run(
        snapshot.n,
        e.id,
        e.projectId,
        e.taskId,
        e.workDate,
        e.body,
        e.createdAt,
        e.updatedAt,
      );
    f.db
      .prepare('INSERT INTO undo_journal_media VALUES (?,?,?)')
      .run(snapshot.n, e.id, a.id);
    f.db.prepare('DELETE FROM journal_entries WHERE id=?').run(e.id);
    f.advance(2 * L.ttlMilliseconds);
    expect(f.repo.collectGarbage()).toBe(0);
    expect(
      f.repo.read(f.project.id, f.taskId, a.id, f.scope.sessionId),
    ).toBeUndefined();
    f.db.prepare('DELETE FROM undo_snapshots WHERE sequence=?').run(snapshot.n);
    expect(f.repo.collectGarbage()).toBe(0);
    f.advance(L.ttlMilliseconds);
    expect(f.repo.collectGarbage()).toBe(1);
  } finally {
    f.close();
  }
});
it('verifies actual stored hashes on retry/read/attach with no partial relation writes', async () => {
  const f = fixture();
  try {
    const input = f.input();
    const a = await f.repo.stage(input);
    const e = f.entry();
    f.db
      .prepare('UPDATE journal_media SET bytes=? WHERE id=?')
      .run(Buffer.from('corrupted'), a.id);
    await expect(f.repo.stage(input)).rejects.toThrow(
      'Invalid stored journal media',
    );
    expect(() =>
      f.repo.read(f.project.id, f.taskId, a.id, f.scope.sessionId),
    ).toThrow();
    expect(() =>
      f.db
        .transaction(() => f.repo.attach(e, doc(a.id), f.scope.sessionId))
        .immediate(),
    ).toThrow();
    expect(
      f.db.prepare('SELECT count(*) AS n FROM journal_entry_media').get(),
    ).toEqual({ n: 0 });
  } finally {
    f.close();
  }
});
it('commits simultaneous same UUID decodes once and rolls back BLOB on DB failure', async () => {
  const f = fixture();
  try {
    const bytes = await sharp({
      create: { width: 2, height: 2, channels: 3, background: '#ffffff' },
    })
      .png()
      .toBuffer();
    const input = { ...f.input(), kind: 'image' as const, bytes };
    const [a, b] = await Promise.all([
      f.repo.stage(input),
      f.repo.stage(input),
    ]);
    expect(b).toEqual(a);
    f.db.exec(
      "CREATE TRIGGER synthetic_abort_media BEFORE INSERT ON journal_media BEGIN SELECT RAISE(ABORT,'Synthetic rollback'); END",
    );
    await expect(f.repo.stage(f.input())).rejects.toThrow('Synthetic rollback');
    expect(
      f.db.prepare('SELECT count(*) AS n FROM journal_media').get(),
    ).toEqual({ n: 1 });
  } finally {
    f.close();
  }
});
it('enforces staged quota at the commit boundary; attached bytes leave staged quota and tombstones leave both', async () => {
  const f = fixture();
  try {
    // Real synthetic BLOBs, exact64MiB; no production limit override.
    const inputs = [25, 25, 14].map((m) => ({
      ...f.input(),
      bytes: Buffer.alloc(m * 1024 * 1024, 65),
    }));
    const saved: JournalMedia[] = [];
    for (const input of inputs) saved.push(await f.repo.stage(input));
    await expect(f.repo.stage(f.input())).rejects.toMatchObject({
      statusCode: 413,
    });
    const e = f.entry();
    expect(() =>
      f.db
        .transaction(() =>
          f.repo.attach(e, doc(...saved.map((m) => m.id)), f.scope.sessionId),
        )
        .immediate(),
    ).toThrow();
    f.db
      .transaction(() => f.repo.attach(e, doc(saved[0]!.id), f.scope.sessionId))
      .immediate();
    await expect(f.repo.stage(f.input())).resolves.toMatchObject({
      kind: 'file',
    });
    f.advance(L.ttlMilliseconds);
    expect(f.repo.collectGarbage()).toBe(3);
    expect(
      f.repo.read(f.project.id, f.taskId, saved[0]!.id, f.scope.sessionId)
        ?.bytes.length,
    ).toBe(25 * 1024 * 1024);
    await expect(f.repo.stage(f.input())).resolves.toMatchObject({
      kind: 'file',
    });
  } finally {
    f.close();
  }
});
it('checks entry count/bytes and last invalid reference before changing relations or home entry', async () => {
  const f = fixture();
  try {
    const ids: string[] = [];
    for (let i = 0; i < 11; i++) ids.push((await f.repo.stage(f.input())).id);
    const e = f.entry();
    expect(() =>
      f.db
        .transaction(() => f.repo.attach(e, doc(...ids), f.scope.sessionId))
        .immediate(),
    ).toThrow();
    expect(
      f.db
        .prepare(
          'SELECT count(*) AS n FROM journal_media WHERE homeEntryId IS NOT NULL',
        )
        .get(),
    ).toEqual({ n: 0 });
    expect(
      f.repo.metadataForContent(e, doc(ids[0]!), f.scope.sessionId),
    ).toHaveLength(1);
    expect(
      f.db
        .prepare(
          'SELECT count(*) AS n FROM journal_media WHERE homeEntryId IS NOT NULL',
        )
        .get(),
    ).toEqual({ n: 0 });
  } finally {
    f.close();
  }
});
it('serializes concurrent decode commits at the exact staged quota boundary', async () => {
  const f = fixture();
  try {
    for (const length of [
      25 * 1024 * 1024,
      25 * 1024 * 1024,
      14 * 1024 * 1024 - 64,
    ])
      await f.repo.stage({ ...f.input(), bytes: Buffer.alloc(length, 65) });
    const bytes = await sharp({
      create: { width: 1, height: 1, channels: 3, background: '#ffffff' },
    })
      .png()
      .toBuffer();
    const results = await Promise.allSettled([
      f.repo.stage({ ...f.input(), kind: 'image', bytes }),
      f.repo.stage({ ...f.input(), kind: 'image', bytes }),
    ]);
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    const denied = results.find((r) => r.status === 'rejected');
    expect(denied).toMatchObject({ reason: { statusCode: 413 } });
    const usage = f.db
      .prepare(
        'SELECT sum(byteLength) AS n FROM journal_media WHERE bytes IS NOT NULL',
      )
      .get() as { n: number };
    expect(usage.n).toBeLessThanOrEqual(L.sessionProjectBytes);
  } finally {
    f.close();
  }
});
it('counts all retained installation bytes across sessions, projects and home entries; NULL tombstones free capacity', async () => {
  const f = fixture();
  try {
    // Real512MiB BLOB fixture. Rows with a home entry remain in installation quota.
    f.db.pragma('wal_checkpoint(TRUNCATE)');
    f.db.pragma('journal_mode=DELETE');
    const base = await f.repo.stage(f.input());
    const other = f.plan.createProject('Other synthetic scope');
    const insert = f.db.prepare(
      `INSERT INTO journal_media(id,uploadId,projectId,taskId,homeEntryId,sessionId,fileName,sourceFileName,kind,mediaType,sourceByteLength,sourceSha256,byteLength,storedSha256,createdAt,unreferencedAt,bytes) SELECT ?,?,?,taskId,'synthetic-home','other-session',fileName,sourceFileName,kind,mediaType,?,?,?, ?,createdAt,unreferencedAt,zeroblob(?) FROM journal_media WHERE id=?`,
    );
    const zero25 = Buffer.alloc(25 * 1024 * 1024);
    const hash25 = createHash('sha256').update(zero25).digest('hex');
    for (let i = 0; i < 20; i++)
      insert.run(
        randomUUID(),
        randomUUID(),
        other.id,
        zero25.length,
        hash25,
        zero25.length,
        hash25,
        zero25.length,
        base.id,
      );
    const finalBytes = 12 * 1024 * 1024 - 9;
    const finalHash = createHash('sha256')
      .update(Buffer.alloc(finalBytes))
      .digest('hex');
    const last = randomUUID();
    insert.run(
      last,
      randomUUID(),
      other.id,
      finalBytes,
      finalHash,
      finalBytes,
      finalHash,
      finalBytes,
      base.id,
    );
    await expect(f.repo.stage(f.input())).rejects.toMatchObject({
      statusCode: 413,
    });
    f.db.prepare('UPDATE journal_media SET bytes=NULL WHERE id=?').run(last);
    await expect(f.repo.stage(f.input())).resolves.toMatchObject({
      kind: 'file',
    });
  } finally {
    f.close();
  }
}, 30000);
import { createHash } from 'node:crypto';
it('rejects raster pixel/dimension overflow and animated WebP before storing a BLOB', async () => {
  const f = fixture();
  try {
    const oversized = await sharp({
      create: { width: 5000, height: 4001, channels: 3, background: '#ffffff' },
    })
      .png()
      .toBuffer();
    const tooWide = await sharp({
      create: { width: 16385, height: 1, channels: 3, background: '#ffffff' },
    })
      .png()
      .toBuffer();
    const animated = await sharp(
      Buffer.from([255, 0, 0, 255, 0, 0, 255, 255]),
      { raw: { width: 1, height: 2, channels: 4, pageHeight: 1 } },
    )
      .webp({ lossless: true, loop: 0, delay: [100, 100] })
      .toBuffer();
    for (const bytes of [oversized, tooWide, animated])
      await expect(
        f.repo.stage({ ...f.input(), kind: 'image', bytes }),
      ).rejects.toMatchObject({ statusCode: 415 });
    expect(
      f.db.prepare('SELECT count(*) AS n FROM journal_media').get(),
    ).toEqual({ n: 0 });
  } finally {
    f.close();
  }
});
import { crc32 } from 'node:zlib';
it('rejects APNG control chunks even when the raster decoder exposes only its first static frame', async () => {
  const f = fixture();
  try {
    const png = await sharp({
      create: { width: 1, height: 1, channels: 3, background: '#ffffff' },
    })
      .png()
      .toBuffer();
    const animation = Buffer.alloc(20);
    animation.writeUInt32BE(8, 0);
    animation.write('acTL', 4);
    animation.writeUInt32BE(2, 8);
    animation.writeUInt32BE(crc32(animation.subarray(4, 16)), 16);
    const bytes = Buffer.concat([
      png.subarray(0, 33),
      animation,
      png.subarray(33),
    ]);
    await expect(
      f.repo.stage({ ...f.input(), kind: 'image', bytes }),
    ).rejects.toMatchObject({ statusCode: 415 });
  } finally {
    f.close();
  }
});
it('preserves a WebP extension on255-byte multi-byte source filenames and validates retained scope privately', async () => {
  const f = fixture();
  try {
    const bytes = await sharp({
      create: { width: 1, height: 1, channels: 3, background: '#ffffff' },
    })
      .png()
      .toBuffer();
    const a = await f.repo.stage({
      ...f.input(),
      kind: 'image',
      bytes,
      fileName: 'я'.repeat(126) + '.png',
    });
    expect(Buffer.byteLength(a.fileName)).toBeLessThanOrEqual(255);
    expect(a.fileName.endsWith('.webp')).toBe(true);
    const e = f.entry();
    const content: JournalContent = {
      format: 'rich-text',
      documentVersion: 1,
      doc: {
        type: 'doc',
        content: [{ type: 'journalImage', attrs: { mediaId: a.id, alt: '' } }],
      },
    };
    f.db
      .transaction(() => f.repo.attach(e, content, f.scope.sessionId))
      .immediate();
    const retained = f.repo.verifyRetainedMedia(e, a.id);
    expect(retained.media).toEqual(a);
    expect(retained.storedSha256).toBe(
      createHash('sha256')
        .update(
          f.repo.read(f.project.id, f.taskId, a.id, f.scope.sessionId)!.bytes,
        )
        .digest('hex'),
    );
    expect(() =>
      f.repo.verifyRetainedMedia({ ...e, taskId: randomUUID() }, a.id),
    ).toThrow();
  } finally {
    f.close();
  }
});
it('auto-orients JPEG and strips embedded EXIF/ICC metadata rather than merely relabeling bytes', async () => {
  const f = fixture();
  try {
    const bytes = await sharp({
      create: { width: 2, height: 3, channels: 3, background: '#aabbcc' },
    })
      .withMetadata({ orientation: 6 })
      .jpeg()
      .toBuffer();
    expect((await sharp(bytes).metadata()).exif).toBeDefined();
    const media = await f.repo.stage({
      ...f.input(),
      kind: 'image',
      bytes,
      fileName: 'oriented.jpg',
    });
    expect(media).toMatchObject({
      width: 3,
      height: 2,
      mediaType: 'image/webp',
    });
    const normalized = f.repo.read(
      f.project.id,
      f.taskId,
      media.id,
      f.scope.sessionId,
    )!;
    const metadata = await sharp(normalized.bytes).metadata();
    expect(metadata.exif).toBeUndefined();
    expect(metadata.icc).toBeUndefined();
    expect(metadata.orientation).toBeUndefined();
    const hashes = f.db
      .prepare('SELECT sourceSha256,storedSha256 FROM journal_media WHERE id=?')
      .get(media.id) as { sourceSha256: string; storedSha256: string };
    expect(hashes.sourceSha256).toBe(
      createHash('sha256').update(bytes).digest('hex'),
    );
    expect(hashes.sourceSha256).not.toBe(hashes.storedSha256);
  } finally {
    f.close();
  }
});

it('refuses a matching ready retry after task deletion and treats corrupt stored metadata as an internal error', async () => {
  const f = fixture();
  try {
    const input = f.input();
    const a = await f.repo.stage(input);
    f.db
      .prepare('UPDATE journal_media SET fileName=? WHERE id=?')
      .run('bad\nname', a.id);
    expect(() =>
      f.repo.read(f.project.id, f.taskId, a.id, f.scope.sessionId),
    ).toThrow('Invalid stored journal media metadata');
    f.db
      .prepare('UPDATE journal_media SET fileName=? WHERE id=?')
      .run('example.txt', a.id);
    f.command({ type: 'task.delete', taskId: f.taskId });
    await expect(f.repo.stage(input)).rejects.toMatchObject({
      statusCode: 404,
    });
  } finally {
    f.close();
  }
});
