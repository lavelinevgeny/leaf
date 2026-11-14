import { z } from 'zod';
import { uuidSchema } from './contracts.js';
export const JOURNAL_MEDIA_LIMITS = Object.freeze({
  imageSourceBytes: 10 * 1024 * 1024,
  fileSourceBytes: 25 * 1024 * 1024,
  storedBytes: 25 * 1024 * 1024,
  requestBytes: 25 * 1024 * 1024 + 16 * 1024,
  imagePixels: 20_000_000,
  imageDimension: 16384,
  entryFiles: 10,
  entryBytes: 50 * 1024 * 1024,
  sessionProjectBytes: 64 * 1024 * 1024,
  installationBytes: 512 * 1024 * 1024,
  ttlMilliseconds: 24 * 60 * 60 * 1000,
  concurrentUploads: 2,
  attemptsPerMinute: 60,
  readTimeoutMilliseconds: 30_000,
  decodeTimeoutSeconds: 10,
  multipartFiles: 1,
  multipartFields: 2,
  multipartParts: 3,
  multipartFieldNameBytes: 32,
  multipartFieldBytes: 64,
  multipartHeaderPairs: 32,
  multipartHeaderBytes: 16 * 1024,
  gcBatch: 100,
});
export const journalUnicodeStringSchema = z
  .string()
  .refine(
    (value) =>
      !/[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/.test(
        value,
      ),
    'Invalid Unicode',
  );
const byteLength = (value: string) =>
  new TextEncoder().encode(value).byteLength;
export const journalFileNameSchema = journalUnicodeStringSchema
  .min(1)
  .refine(
    (value) =>
      byteLength(value) <= 255 &&
      !/[\/\\\u0000-\u001f\u007f-\u009f\u202a-\u202e\u2066-\u2069]/.test(value),
    'Invalid file name',
  );
const common = {
  id: uuidSchema,
  fileName: journalFileNameSchema,
  byteLength: z.number().int().min(1).max(JOURNAL_MEDIA_LIMITS.storedBytes),
};
export const journalMediaSchema = z.discriminatedUnion('kind', [
  z
    .strictObject({
      ...common,
      kind: z.literal('image'),
      mediaType: z.literal('image/webp'),
      width: z.number().int().min(1).max(16384),
      height: z.number().int().min(1).max(16384),
    })
    .refine(
      (media) => media.width * media.height <= JOURNAL_MEDIA_LIMITS.imagePixels,
      'Image too large',
    ),
  z.strictObject({
    ...common,
    kind: z.literal('file'),
    mediaType: z.literal('application/octet-stream'),
  }),
]);
export type JournalMedia = z.infer<typeof journalMediaSchema>;
export const journalUploadReadySchema = z.strictObject({
  mediaContractVersion: z.literal(1),
  uploadId: uuidSchema,
  media: journalMediaSchema,
});
export type JournalUploadReady = z.infer<typeof journalUploadReadySchema>;
