import { createHash, randomUUID } from 'node:crypto';
import type Database from 'better-sqlite3';
import { DomainError } from '../domain/tree.js';
import { uuidSchema } from '../shared/contracts.js';
import {
  collectJournalMediaIds,
  journalContentSchema,
  projectJournalContent,
  type JournalContent,
} from '../shared/journal-content.js';
import {
  JOURNAL_MEDIA_LIMITS as L,
  journalMediaSchema,
  type JournalMedia,
} from '../shared/journal-media-contracts.js';
import { normalizeJournalImage } from './journal-image.js';
export interface JournalMediaStageInput {
  projectId: string;
  taskId: string;
  sessionId: string;
  uploadId: string;
  kind: 'image' | 'file';
  fileName: string;
  bytes: Buffer;
}
export interface JournalRetainedMedia {
  media: JournalMedia;
  storedSha256: string;
}
export interface JournalMediaEntryScope {
  id: string;
  projectId: string;
  taskId: string;
}
interface MediaRow {
  id: string;
  uploadId: string;
  projectId: string;
  taskId: string;
  sessionId: string;
  homeEntryId: string | null;
  fileName: string;
  sourceFileName: string;
  kind: 'image' | 'file';
  mediaType: string;
  sourceByteLength: number;
  sourceSha256: string;
  byteLength: number;
  storedSha256: string;
  width: number | null;
  height: number | null;
  createdAt: string;
  unreferencedAt: string | null;
  bytes: Buffer | null;
}
export function safeJournalFileName(value: string): string {
  const clean = Buffer.from(value, 'utf8')
    .toString('utf8')
    .replace(/[\/\\\u0000-\u001f\u007f-\u009f\u202a-\u202e\u2066-\u2069]/g, '');
  let result = '';
  for (const char of clean) {
    if (Buffer.byteLength(result + char) > 255) break;
    result += char;
  }
  return result.trim() ? result : 'attachment';
}
const digest = (bytes: Buffer) =>
  createHash('sha256').update(bytes).digest('hex');
const invalid = () =>
  new DomainError('MEDIA_INVALID', 'Вложение недоступно для этой записи.');
function metadata(row: MediaRow): JournalMedia {
  const parsed = journalMediaSchema.safeParse({
    id: row.id,
    kind: row.kind,
    fileName: row.fileName,
    byteLength: row.byteLength,
    mediaType: row.mediaType,
    ...(row.kind === 'image' ? { width: row.width, height: row.height } : {}),
  });
  if (!parsed.success) throw Error('Invalid stored journal media metadata');
  return parsed.data;
}
function verify(row: MediaRow): void {
  if (
    !row.bytes ||
    row.bytes.length !== row.byteLength ||
    digest(row.bytes) !== row.storedSha256
  )
    throw Error('Invalid stored journal media');
  metadata(row);
}
export class JournalMediaRepository {
  constructor(
    private readonly db: Database.Database,
    private readonly now: () => number = Date.now,
  ) {}
  private row(id: string): MediaRow | undefined {
    return this.db.prepare('SELECT * FROM journal_media WHERE id=?').get(id) as
      MediaRow | undefined;
  }
  private requireSession(sessionId: string): void {
    if (
      !this.db
        .prepare('SELECT 1 FROM sessions WHERE id=? AND expiresAt>?')
        .get(sessionId, this.now())
    )
      throw new DomainError('AUTH_REQUIRED', 'Требуется вход.', 401);
  }
  private requireTask(projectId: string, taskId: string): void {
    if (
      !this.db
        .prepare('SELECT 1 FROM tasks WHERE projectId=? AND id=?')
        .get(projectId, taskId)
    )
      throw new DomainError('NOT_FOUND', 'Задача не найдена.', 404);
  }
  private existing(
    input: JournalMediaStageInput,
    name: string,
    sourceSha256: string,
  ): JournalMedia | undefined {
    const row = this.db
      .prepare('SELECT * FROM journal_media WHERE uploadId=?')
      .get(input.uploadId) as MediaRow | undefined;
    if (!row) return;
    if (
      row.projectId !== input.projectId ||
      row.taskId !== input.taskId ||
      row.sessionId !== input.sessionId ||
      row.kind !== input.kind ||
      row.sourceFileName !== safeJournalFileName(input.fileName) ||
      row.fileName !== name ||
      row.sourceByteLength !== input.bytes.length ||
      row.sourceSha256 !== sourceSha256
    )
      throw new DomainError(
        'MEDIA_UPLOAD_REUSED',
        'Идентификатор загрузки уже использован.',
        409,
      );
    if (
      row.bytes === null ||
      (row.unreferencedAt !== null &&
        Date.parse(row.unreferencedAt) + L.ttlMilliseconds <= this.now() &&
        !this.db
          .prepare(
            'SELECT 1 FROM journal_entry_media WHERE mediaId=? UNION ALL SELECT 1 FROM undo_journal_media WHERE mediaId=? LIMIT 1',
          )
          .get(row.id, row.id))
    )
      throw new DomainError(
        'MEDIA_UPLOAD_EXPIRED',
        'Загрузка устарела. Повторите прикрепление файла.',
        410,
      );
    verify(row);
    return metadata(row);
  }
  async stage(input: JournalMediaStageInput): Promise<JournalMedia> {
    uuidSchema.parse(input.uploadId);
    uuidSchema.parse(input.projectId);
    uuidSchema.parse(input.taskId);
    if (!['image', 'file'].includes(input.kind)) throw invalid();
    if (!input.bytes.length) throw new DomainError('MEDIA_EMPTY', 'Файл пуст.');
    if (
      input.bytes.length >
      (input.kind === 'image' ? L.imageSourceBytes : L.fileSourceBytes)
    )
      throw new DomainError(
        'MEDIA_TOO_LARGE',
        input.kind === 'image'
          ? 'Изображение превышает 10 MiB.'
          : 'Файл превышает 25 MiB.',
        413,
      );
    const safeName = safeJournalFileName(input.fileName);
    let imageStem = safeName.replace(/\.[^.]*$/u, '');
    while (Buffer.byteLength(imageStem) > 250)
      imageStem = Array.from(imageStem).slice(0, -1).join('');
    const name = input.kind === 'image' ? imageStem + '.webp' : safeName;
    const sourceSha256 = digest(input.bytes);
    this.requireSession(input.sessionId);
    this.collectGarbage();
    const prior = this.existing(input, name, sourceSha256);
    this.requireTask(input.projectId, input.taskId);
    if (prior) return prior;
    // No SQLite write lock is held while decoding untrusted raster bytes.
    const normalized =
      input.kind === 'image'
        ? await normalizeJournalImage(input.bytes)
        : undefined;
    const bytes = normalized?.bytes ?? Buffer.from(input.bytes);
    return this.db
      .transaction(() => {
        this.requireSession(input.sessionId);
        this.requireTask(input.projectId, input.taskId);
        const retry = this.existing(input, name, sourceSha256);
        if (retry) return retry;
        const quota = this.db
          .prepare(
            `SELECT COALESCE(SUM(byteLength),0) AS total, COALESCE(SUM(CASE WHEN projectId=? AND sessionId=? AND homeEntryId IS NULL THEN byteLength ELSE 0 END),0) AS staged FROM journal_media WHERE bytes IS NOT NULL`,
          )
          .get(input.projectId, input.sessionId) as {
          total: number;
          staged: number;
        };
        if (
          quota.total + bytes.length > L.installationBytes ||
          quota.staged + bytes.length > L.sessionProjectBytes
        )
          throw new DomainError(
            'MEDIA_QUOTA_EXCEEDED',
            'Превышена квота вложений (64 MiB черновиков / 512 MiB всего).',
            413,
          );
        const id = randomUUID();
        const timestamp = new Date(this.now()).toISOString();
        this.db
          .prepare(
            `INSERT INTO journal_media(id,uploadId,projectId,taskId,homeEntryId,sessionId,fileName,sourceFileName,kind,mediaType,sourceByteLength,sourceSha256,byteLength,storedSha256,width,height,createdAt,unreferencedAt,bytes) VALUES (?,?,?,?,NULL,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
          )
          .run(
            id,
            input.uploadId,
            input.projectId,
            input.taskId,
            input.sessionId,
            name,
            safeName,
            input.kind,
            normalized ? 'image/webp' : 'application/octet-stream',
            input.bytes.length,
            sourceSha256,
            bytes.length,
            digest(bytes),
            normalized?.width ?? null,
            normalized?.height ?? null,
            timestamp,
            timestamp,
            bytes,
          );
        return metadata(this.row(id)!);
      })
      .immediate();
  }
  read(
    projectId: string,
    taskId: string,
    mediaId: string,
    sessionId: string,
  ): { media: JournalMedia; bytes: Buffer } | undefined {
    this.requireSession(sessionId);
    return this.db.transaction(() => {
      if (
        !this.db
          .prepare('SELECT 1 FROM tasks WHERE projectId=? AND id=?')
          .get(projectId, taskId)
      )
        return;
      const row = this.row(mediaId);
      if (
        !row ||
        row.projectId !== projectId ||
        row.taskId !== taskId ||
        !row.bytes
      )
        return;
      const live = this.db
        .prepare(
          'SELECT 1 FROM journal_entry_media r JOIN journal_entries e ON e.id=r.entryId WHERE r.mediaId=? AND e.id=? AND e.projectId=? AND e.taskId=?',
        )
        .get(mediaId, row.homeEntryId, projectId, taskId);
      if (
        !live &&
        !(
          row.homeEntryId === null &&
          row.sessionId === sessionId &&
          row.unreferencedAt !== null &&
          Date.parse(row.unreferencedAt) + L.ttlMilliseconds > this.now()
        )
      )
        return;
      verify(row);
      return { media: metadata(row), bytes: row.bytes };
    })();
  }
  /** Private lifecycle helper; no session/download ACL is granted by retention. */
  verifyRetainedMedia(
    entry: JournalMediaEntryScope,
    mediaId: string,
  ): JournalRetainedMedia {
    const row = this.row(mediaId);
    if (
      !row ||
      row.projectId !== entry.projectId ||
      row.taskId !== entry.taskId ||
      row.homeEntryId !== entry.id
    )
      throw Error('Invalid retained journal media scope');
    verify(row);
    return { media: metadata(row), storedSha256: row.storedSha256 };
  }
  metadataForEntry(entryId: string): JournalMedia[] {
    const entry = this.db
      .prepare('SELECT id,projectId,taskId FROM journal_entries WHERE id=?')
      .get(entryId) as JournalMediaEntryScope | undefined;
    if (!entry) return [];
    const rows = this.db
      .prepare(
        'SELECT mediaId FROM journal_entry_media WHERE entryId=? ORDER BY mediaId',
      )
      .all(entryId) as { mediaId: string }[];
    return rows.map(
      (row) => this.verifyRetainedMedia(entry, row.mediaId).media,
    );
  }
  metadataForContent(
    entry: JournalMediaEntryScope,
    content: JournalContent,
    sessionId: string,
  ): JournalMedia[] {
    journalContentSchema.parse(content);
    this.requireSession(sessionId);
    this.requireTask(entry.projectId, entry.taskId);
    const result = collectJournalMediaIds(content).map((id) => {
      const row = this.row(id);
      if (
        !row ||
        !row.bytes ||
        row.projectId !== entry.projectId ||
        row.taskId !== entry.taskId ||
        (row.homeEntryId !== null
          ? row.homeEntryId !== entry.id
          : row.sessionId !== sessionId)
      )
        throw invalid();
      if (
        row.homeEntryId === null &&
        row.unreferencedAt !== null &&
        Date.parse(row.unreferencedAt) + L.ttlMilliseconds <= this.now()
      )
        throw new DomainError(
          'MEDIA_UPLOAD_EXPIRED',
          'Загрузка устарела. Повторите прикрепление файла.',
          410,
        );
      verify(row);
      return metadata(row);
    });
    projectJournalContent(content, result);
    return result;
  }
  attach(
    entry: JournalMediaEntryScope,
    content: JournalContent,
    sessionId: string,
  ): JournalMedia[] {
    if (!this.db.inTransaction)
      throw Error('Journal media attach requires caller transaction');
    const media = this.metadataForContent(entry, content, sessionId);
    if (
      !this.db
        .prepare(
          'SELECT 1 FROM journal_entries WHERE id=? AND projectId=? AND taskId=?',
        )
        .get(entry.id, entry.projectId, entry.taskId)
    )
      throw invalid();
    const old = this.db
      .prepare('SELECT mediaId FROM journal_entry_media WHERE entryId=?')
      .all(entry.id) as { mediaId: string }[];
    this.db
      .prepare('DELETE FROM journal_entry_media WHERE entryId=?')
      .run(entry.id);
    for (const item of media) {
      this.db
        .prepare(
          'UPDATE journal_media SET homeEntryId=?,unreferencedAt=NULL WHERE id=?',
        )
        .run(entry.id, item.id);
      this.db
        .prepare(
          'INSERT INTO journal_entry_media(entryId,mediaId) VALUES (?,?)',
        )
        .run(entry.id, item.id);
    }
    for (const item of old) this.markUnreferenced(item.mediaId);
    return media;
  }
  private markUnreferenced(id?: string): void {
    this.db
      .prepare(
        `UPDATE journal_media SET unreferencedAt=? WHERE id IN (SELECT m.id FROM journal_media m WHERE m.bytes IS NOT NULL AND m.unreferencedAt IS NULL ${id ? 'AND m.id=?' : ''} AND NOT EXISTS(SELECT 1 FROM journal_entry_media r WHERE r.mediaId=m.id) AND NOT EXISTS(SELECT 1 FROM undo_journal_media u WHERE u.mediaId=m.id) LIMIT ${L.gcBatch})`,
      )
      .run(new Date(this.now()).toISOString(), ...(id ? [id] : []));
  }
  collectGarbage(): number {
    return this.db
      .transaction(() => {
        this.markUnreferenced();
        return this.db
          .prepare(
            `UPDATE journal_media SET bytes=NULL WHERE id IN (SELECT m.id FROM journal_media m WHERE m.bytes IS NOT NULL AND m.unreferencedAt<=? AND NOT EXISTS(SELECT 1 FROM journal_entry_media r WHERE r.mediaId=m.id) AND NOT EXISTS(SELECT 1 FROM undo_journal_media u WHERE u.mediaId=m.id) LIMIT ${L.gcBatch})`,
          )
          .run(new Date(this.now() - L.ttlMilliseconds).toISOString()).changes;
      })
      .immediate();
  }
}
