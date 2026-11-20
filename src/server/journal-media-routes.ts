import multipart from '@fastify/multipart';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { DomainError } from '../domain/tree.js';
import { uuidSchema } from '../shared/contracts.js';
import {
  JOURNAL_MEDIA_LIMITS as L,
  journalUploadReadySchema,
} from '../shared/journal-media-contracts.js';
import { JournalMediaRepository } from './journal-media-repository.js';
export const JOURNAL_MEDIA_UPLOAD_ROUTE =
  '/api/projects/:id/tasks/:taskId/journal-media';
const paramsSchema = z.strictObject({ id: uuidSchema, taskId: uuidSchema });
const readParamsSchema = paramsSchema.extend({ mediaId: uuidSchema });
const tooLarge = () =>
  new DomainError(
    'MEDIA_TOO_LARGE',
    'Запрос превышает допустимый размер вложения.',
    413,
  );
const invalid = () =>
  new DomainError('MEDIA_INVALID', 'Проверьте поля загрузки.');
/** Accept one ordinary RFC2046 boundary only. Extended/continued/duplicate
 * parameters and quoted escapes are excluded before either parser sees bytes. */
function parseUploadBoundary(contentType: string): string {
  const match =
    /^multipart\/form-data[ \t]*;[ \t]*boundary[ \t]*=[ \t]*(?:([0-9A-Za-z'+_.-]{1,70})|"([0-9A-Za-z'()+_,./:=? -]{1,70})")[ \t]*$/i.exec(
      contentType,
    );
  const boundary = match?.[1] ?? match?.[2];
  if (!boundary || boundary.endsWith(' ')) throw invalid();
  return boundary;
}
let activeUploads = 0;
const attempts = new Map<string, { count: number; until: number }>();
/** A second, bounded wire scan: busboy truncates excessive headers silently.
 * Keep only a boundary tail or one bounded header, never a second file buffer. */
class WireGuard {
  private count = 0;
  private buffer: Buffer = Buffer.alloc(0);
  private state: 'boundary' | 'headers' | 'body' = 'boundary';
  private readonly boundary: Buffer;
  constructor(boundary: string) {
    this.boundary = Buffer.from(`\r\n--${boundary}`);
  }
  push(chunk: Buffer): void {
    this.count += chunk.length;
    if (this.count > L.requestBytes) throw tooLarge();
    // A chunk may contain a large file; scan it without retaining the body.
    let data = this.buffer.length ? Buffer.concat([this.buffer, chunk]) : chunk;
    this.buffer = Buffer.alloc(0);
    for (;;) {
      if (this.state === 'headers') {
        const end = data.indexOf('\r\n\r\n');
        if (end < 0) {
          if (data.length > L.multipartHeaderBytes) throw tooLarge();
          this.buffer = data;
          return;
        }
        if (end > L.multipartHeaderBytes) throw tooLarge();
        const lines = data.subarray(0, end).toString('latin1').split('\r\n');
        if (lines.length > L.multipartHeaderPairs) throw tooLarge();
        if (lines.some((line) => !line.includes(':') || /^[ \t]/.test(line)))
          throw invalid();
        data = data.subarray(end + 4);
        this.state = 'body';
      } else {
        const marker =
          this.state === 'boundary' ? this.boundary.subarray(2) : this.boundary;
        const start = data.indexOf(marker);
        if (start < 0) {
          this.buffer = Buffer.from(
            data.subarray(Math.max(0, data.length - marker.length - 2)),
          );
          return;
        }
        const after = start + marker.length;
        if (data.length < after + 2) {
          this.buffer = Buffer.from(data.subarray(start));
          return;
        }
        const suffix = data.toString('ascii', after, after + 2);
        if (suffix === '--') {
          this.buffer = Buffer.alloc(0);
          return;
        }
        if (suffix !== '\r\n') {
          data = data.subarray(after);
          continue;
        }
        data = data.subarray(after + 2);
        this.state = 'headers';
      }
    }
  }
}
export function registerJournalMediaRoutes(
  app: FastifyInstance,
  options: {
    repository: JournalMediaRepository;
    requireSession: (request: FastifyRequest) => string;
    requireContract: (request: FastifyRequest) => void;
    demoMode: boolean;
    now: () => number;
  },
): void {
  app.register(async (scoped) => {
    await scoped.register(multipart, {
      limits: {
        fileSize: L.fileSourceBytes,
        files: L.multipartFiles,
        fields: L.multipartFields,
        parts: L.multipartParts,
        fieldNameSize: L.multipartFieldNameBytes,
        fieldSize: L.multipartFieldBytes,
        headerPairs: L.multipartHeaderPairs,
      },
      throwFileSizeLimit: true,
    });
    const admissions = new WeakMap<
      FastifyRequest,
      { session: string; boundary: string; release: () => void }
    >();
    const release = (r: FastifyRequest) => admissions.get(r)?.release();
    scoped.addHook('onResponse', async (request) => {
      release(request);
    });
    scoped.addHook('onError', async (request) => {
      release(request);
    });
    scoped.post(
      JOURNAL_MEDIA_UPLOAD_ROUTE,
      {
        onRequest: async (request) => {
          const session = options.requireSession(request);
          options.requireContract(request);
          paramsSchema.parse(request.params);
          if (options.demoMode)
            throw new DomainError(
              'DEMO_MEDIA_DISABLED',
              'В демо загрузка файлов отключена.',
              403,
            );
          if (
            request.headers['content-type']
              ?.split(';')[0]
              ?.trim()
              .toLowerCase() !== 'multipart/form-data'
          )
            throw new DomainError(
              'MULTIPART_REQUIRED',
              'Требуется multipart загрузка.',
              415,
            );
          const boundary = parseUploadBoundary(
            request.headers['content-type']!,
          );
          const time = options.now();
          for (const [id, item] of attempts)
            if (item.until <= time) attempts.delete(id);
          const attempt = attempts.get(session) ?? {
            count: 0,
            until: time + 60_000,
          };
          if (
            attempt.count >= L.attemptsPerMinute ||
            activeUploads >= L.concurrentUploads ||
            (!attempts.has(session) && attempts.size >= 10000)
          )
            throw new DomainError(
              'MEDIA_BUSY',
              'Слишком много загрузок. Повторите позже.',
              429,
            );
          attempt.count++;
          attempts.set(session, attempt);
          activeUploads++;
          let released = false;
          admissions.set(request, {
            session,
            boundary,
            release: () => {
              if (!released) {
                released = true;
                activeUploads--;
              }
            },
          });
          options.repository.collectGarbage();
          const length = request.headers['content-length'];
          if (
            length !== undefined &&
            (!/^\d+$/.test(length) || Number(length) > L.requestBytes)
          )
            throw tooLarge();
        },
      },
      async (request, reply) => {
        const { id, taskId } = paramsSchema.parse(request.params);
        const session = admissions.get(request)!.session;
        let failure: Error | undefined;
        let rejectRead: (e: Error) => void = () => {};
        const failed = new Promise<never>((_resolve, reject) => {
          rejectRead = reject;
        });
        const fail = (error: Error) => {
          if (failure) return;
          failure = error;
          rejectRead(error);
          request.raw.unpipe();
          request.raw.pause();
          request.raw.emit('error', error);
        };
        const guard = new WireGuard(admissions.get(request)!.boundary);
        const onData = (chunk: Buffer) => {
          try {
            guard.push(chunk);
          } catch (error) {
            fail(error instanceof Error ? error : invalid());
          }
        };
        const onAbort = () =>
          fail(new DomainError('MEDIA_INTERRUPTED', 'Загрузка прервана.', 400));
        const timer = setTimeout(
          () =>
            fail(
              new DomainError(
                'MEDIA_TIMEOUT',
                'Загрузка превысила 30 секунд.',
                408,
              ),
            ),
          L.readTimeoutMilliseconds,
        );
        request.raw.on('data', onData);
        request.raw.once('aborted', onAbort);
        try {
          const parsed = await Promise.race([
            failed,
            (async () => {
              let bytes: Buffer | undefined;
              let fileName: string | undefined;
              const fields = new Map<string, string>();
              for await (const part of request.parts()) {
                if (failure) throw failure;
                if (
                  Buffer.byteLength(part.fieldname) > L.multipartFieldNameBytes
                )
                  throw tooLarge();
                if (part.type === 'file') {
                  if (bytes !== undefined || part.fieldname !== 'file')
                    throw invalid();
                  fileName = part.filename;
                  bytes = await part.toBuffer();
                  if (part.file.truncated) throw tooLarge();
                } else {
                  if (part.fieldnameTruncated || part.valueTruncated)
                    throw tooLarge();
                  if (
                    !['uploadId', 'kind'].includes(part.fieldname) ||
                    fields.has(part.fieldname) ||
                    typeof part.value !== 'string'
                  )
                    throw invalid();
                  fields.set(part.fieldname, part.value);
                }
              }
              if (failure) throw failure;
              if (
                bytes === undefined ||
                fileName === undefined ||
                fields.size !== L.multipartFields
              )
                throw invalid();
              const uploadId = uuidSchema.parse(fields.get('uploadId'));
              const kind = z.enum(['image', 'file']).parse(fields.get('kind'));
              return { uploadId, kind, fileName, bytes };
            })(),
          ]);
          clearTimeout(timer);
          const media = await options.repository.stage({
            projectId: id,
            taskId,
            sessionId: session,
            ...parsed,
          });
          return reply.code(201).send(
            journalUploadReadySchema.parse({
              mediaContractVersion: 1,
              uploadId: parsed.uploadId,
              media,
            }),
          );
        } finally {
          clearTimeout(timer);
          request.raw.removeListener('data', onData);
          request.raw.removeListener('aborted', onAbort);
          release(request);
          if (!request.raw.complete) {
            request.raw.unpipe();
            request.raw.pause();
            reply.header('Connection', 'close');
            reply.raw.once('finish', () => request.raw.destroy());
          }
        }
      },
    );
    for (const download of [false, true])
      scoped.get(
        `${JOURNAL_MEDIA_UPLOAD_ROUTE}/:mediaId${download ? '/download' : ''}`,
        async (request, reply) => {
          const session = options.requireSession(request);
          const { id, taskId, mediaId } = readParamsSchema.parse(
            request.params,
          );
          const result = options.repository.read(id, taskId, mediaId, session);
          if (!result)
            throw new DomainError('NOT_FOUND', 'Файл не найден.', 404);
          const { media, bytes } = result;
          // ASCII fallback is deliberately constant; UTF-8 name is RFC5987 encoded.
          const encoded = encodeURIComponent(media.fileName).replace(
            /['()*]/g,
            (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`,
          );
          const disposition =
            download || media.kind === 'file' ? 'attachment' : 'inline';
          return reply
            .header('Cache-Control', 'no-store')
            .header('X-Content-Type-Options', 'nosniff')
            .header('Referrer-Policy', 'no-referrer')
            .header(
              'Content-Disposition',
              `${disposition}; filename="attachment${media.kind === 'image' ? '.webp' : ''}"; filename*=UTF-8''${encoded}`,
            )
            .header('Content-Length', bytes.length)
            .type(media.mediaType)
            .send(bytes);
        },
      );
  });
}
