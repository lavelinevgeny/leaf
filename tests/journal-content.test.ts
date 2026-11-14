import { expect, it } from 'vitest';
import {
  journalContentSchema,
  JournalPublicationError,
  journalDocumentSchema,
  collectJournalMediaIds,
  projectJournalContent,
  plainTextToJournalDocument,
} from '../src/shared/journal-content.js';
import { journalMediaSchema } from '../src/shared/journal-media-contracts.js';
import {
  journalCreateV2Schema,
  journalEntryV2Schema,
} from '../src/shared/journal-contracts-v2.js';
const id = '11111111-1111-4111-8111-111111111111';
const secondId = '22222222-2222-4222-8222-222222222222';
const rich = (content: unknown[]) => ({
  format: 'rich-text',
  documentVersion: 1,
  doc: { type: 'doc', content },
});
const paragraph = (text: string) => ({
  type: 'paragraph',
  content: [{ type: 'text', text }],
});
const file = { type: 'journalFile', attrs: { mediaId: id } };
const metadata = {
  id,
  kind: 'file' as const,
  fileName: 'example.txt',
  byteLength: 9,
  mediaType: 'application/octet-stream' as const,
};
it('accepts literal Unicode plain and media-only rich content with distinct ordered references', () => {
  expect(
    journalContentSchema.parse({
      format: 'plain-text',
      text: ' <img> **x**\r\n\0 ',
    }),
  ).toEqual({ format: 'plain-text', text: ' <img> **x**\r\n\0 ' });
  const content = journalContentSchema.parse(
    rich([
      file,
      file,
      { type: 'journalImage', attrs: { mediaId: secondId, alt: 'Демо' } },
    ]),
  );
  expect(collectJournalMediaIds(content)).toEqual([id, secondId]);
  expect(
    projectJournalContent(
      journalContentSchema.parse(rich([paragraph('Проверка')])),
      [],
    ),
  ).toBe('Проверка');
  expect(
    projectJournalContent(journalContentSchema.parse(rich([file])), [metadata]),
  ).toBe('[Файл: example.txt]');
});
it('projects rich content in order with literal link labels and nested list markers', () => {
  const content = journalContentSchema.parse(
    rich([
      {
        type: 'paragraph',
        content: [
          {
            type: 'text',
            text: '<b>Название</b>',
            marks: [
              { type: 'bold' },
              { type: 'link', attrs: { href: 'https://example.test/hidden' } },
            ],
          },
          { type: 'hardBreak' },
          { type: 'text', text: 'После' },
        ],
      },
      {
        type: 'orderedList',
        content: [
          {
            type: 'listItem',
            content: [
              paragraph('Один'),
              {
                type: 'bulletList',
                content: [{ type: 'listItem', content: [paragraph('Два')] }],
              },
            ],
          },
        ],
      },
      file,
    ]),
  );
  expect(projectJournalContent(content, [metadata])).toBe(
    '<b>Название</b>\nПосле\n1. Один\n  - Два\n[Файл: example.txt]',
  );
  expect(() => projectJournalContent(content, [])).toThrow();
  expect(() =>
    projectJournalContent(content, [
      {
        ...metadata,
        kind: 'image',
        mediaType: 'image/webp',
        width: 1,
        height: 1,
      },
    ]),
  ).toThrow();
});
it.each([
  rich([{ type: 'iframe' }]),
  rich([{ ...file, attrs: { mediaId: id, src: 'https://example.test' } }]),
  rich([{ type: 'paragraph', attrs: { align: 'left' } }]),
  rich([{ type: 'paragraph', content: [file] }]),
  rich([{ type: 'hardBreak' }]),
  rich([{ type: 'paragraph', content: [{ type: 'hardBreak', content: [] }] }]),
  rich([{ type: 'orderedList', attrs: { start: 2 }, content: [] }]),
  rich([{ type: 'listItem', content: [paragraph('a')] }]),
  rich([{ type: 'bulletList', content: [] }]),
  rich([{ type: 'text', text: 'outside' }]),
  rich([
    {
      type: 'paragraph',
      content: [{ type: 'text', text: 'x', marks: [{ type: 'italic' }] }],
    },
  ]),
  rich([
    {
      type: 'paragraph',
      content: [
        {
          type: 'text',
          text: 'x',
          marks: [{ type: 'bold' }, { type: 'bold' }],
        },
      ],
    },
  ]),
  rich([
    { type: 'journalImage', attrs: { mediaId: id, alt: 'a'.repeat(501) } },
  ]),
  rich([{ type: 'journalFile', attrs: { mediaId: 'not-id' } }]),
  rich([paragraph('\ud800')]),
  rich([paragraph('   ')]),
  rich([
    {
      type: 'bulletList',
      content: [{ type: 'listItem', content: [paragraph('   ')] }],
    },
  ]),
  rich([
    {
      type: 'orderedList',
      content: [{ type: 'listItem', content: [{ type: 'paragraph' }] }],
    },
  ]),
  rich([]),
  { format: 'plain-text', text: ' ' },
  { format: 'plain-text', text: 'a', body: 'untrusted' },
  { format: 'plain-text', text: 'a'.repeat(10001) },
  rich([paragraph('a'.repeat(10001))]),
  rich([paragraph('a'.repeat(49000))]),
])('rejects malformed, empty or excessive content %#', (value) => {
  expect(journalContentSchema.safeParse(value).success).toBe(false);
});
it.each([
  'javascript:alert(1)',
  'data:text/plain,x',
  'file:///tmp/x',
  'https://' +
    ['synthetic-user', 'synthetic-password'].join(':') +
    '@example.test',
  'https://example.test/\npath',
  'https://example.test/' + 'a'.repeat(2049),
  'https://example.test/\u007f',
])('rejects unsafe href %s', (href) => {
  expect(
    journalContentSchema.safeParse(
      rich([
        {
          type: 'paragraph',
          content: [
            {
              type: 'text',
              text: 'label',
              marks: [{ type: 'link', attrs: { href } }],
            },
          ],
        },
      ]),
    ).success,
  ).toBe(false);
});
it('bounds nodes/depth/list nesting before recursive validation, including cyclic inputs', () => {
  expect(
    journalDocumentSchema.safeParse({
      type: 'doc',
      content: Array.from({ length: 1000 }, () => paragraph('x')),
    }).success,
  ).toBe(false);
  let node: unknown = paragraph('text');
  for (let i = 0; i < 5; i++)
    node = {
      type: 'bulletList',
      content: [{ type: 'listItem', content: [paragraph('item'), node] }],
    };
  expect(journalContentSchema.safeParse(rich([node])).success).toBe(false);
  const cyclic: { type: string; content?: unknown[] } = { type: 'doc' };
  cyclic.content = [cyclic];
  expect(journalDocumentSchema.safeParse(cyclic).success).toBe(false);
  let deep: unknown = { type: 'paragraph' };
  for (let i = 0; i < 50; i++) deep = { type: 'listItem', content: [deep] };
  expect(
    journalDocumentSchema.safeParse({ type: 'doc', content: [deep] }).success,
  ).toBe(false);
});
it('converts legacy text using JSON only and preserves exact text and line separators', () => {
  const original = ' <img src=x> **text**\r\n\0\n ';
  const doc = plainTextToJournalDocument(original);
  expect(doc).toEqual({
    type: 'doc',
    content: [
      { type: 'paragraph', content: [{ type: 'text', text: original }] },
    ],
  });
  expect(
    projectJournalContent({ format: 'rich-text', documentVersion: 1, doc }, []),
  ).toBe(original);
});
it('validates public metadata, strict v2 envelopes and matching media/projection without changing v1', () => {
  expect(journalMediaSchema.parse(metadata)).toEqual(metadata);
  for (const bad of [
    { ...metadata, bytes: 'secret' },
    { ...metadata, fileName: '../bad' },
    { ...metadata, width: 1 },
    { ...metadata, byteLength: 0 },
    { ...metadata, fileName: '\ud800' },
  ])
    expect(journalMediaSchema.safeParse(bad).success).toBe(false);
  const input = {
    journalContractVersion: 2,
    operationId: id,
    expectedJournalRevision: 0,
    taskId: id,
    workDate: '2026-11-14',
    content: { format: 'plain-text', text: 'text' },
  };
  expect(journalCreateV2Schema.safeParse(input).success).toBe(true);
  expect(
    journalCreateV2Schema.safeParse({ ...input, body: 'client projection' })
      .success,
  ).toBe(false);
  const entry = {
    id,
    projectId: id,
    taskId: id,
    workDate: '2026-11-14',
    body: '[Файл: example.txt]',
    createdAt: '2026-11-14T12:00:00.000Z',
    updatedAt: '2026-11-14T12:00:00.000Z',
    content: rich([file]),
    media: [metadata],
  };
  expect(journalEntryV2Schema.safeParse(entry).success).toBe(true);
  expect(journalEntryV2Schema.safeParse({ ...entry, media: [] }).success).toBe(
    false,
  );
  expect(
    journalEntryV2Schema.safeParse({ ...entry, body: 'different' }).success,
  ).toBe(false);
  expect(
    journalEntryV2Schema.safeParse({
      ...entry,
      media: [metadata, { ...metadata, id: secondId }],
    }).success,
  ).toBe(false);
});
it('accepts exact text and structural boundaries and rejects byte-heavy rich documents before recursive parsing', () => {
  expect(
    journalContentSchema.safeParse({
      format: 'plain-text',
      text: '漢'.repeat(10000),
    }).success,
  ).toBe(true);
  expect(
    journalContentSchema.safeParse({
      format: 'plain-text',
      text: '😀'.repeat(5001),
    }).success,
  ).toBe(false);
  expect(
    journalDocumentSchema.safeParse({
      type: 'doc',
      content: Array.from({ length: 999 }, () => ({ type: 'paragraph' })),
    }).success,
  ).toBe(true);
  let nested: unknown = {
    type: 'bulletList',
    content: [{ type: 'listItem', content: [paragraph('inner')] }],
  };
  for (let i = 0; i < 3; i++)
    nested = {
      type: 'bulletList',
      content: [{ type: 'listItem', content: [paragraph('outer'), nested] }],
    };
  expect(journalContentSchema.safeParse(rich([nested])).success).toBe(true);
  const bulky = Array.from({ length: 30 }, () => ({
    type: 'paragraph',
    content: [
      {
        type: 'text',
        text: 'x',
        marks: [
          {
            type: 'link',
            attrs: { href: 'https://example.test/' + 'a'.repeat(1950) },
          },
        ],
      },
    ],
  }));
  expect(journalContentSchema.safeParse(rich(bulky)).success).toBe(false);
  expect(
    journalContentSchema.safeParse(
      rich([
        {
          type: 'paragraph',
          content: [
            {
              type: 'text',
              text: 'x',
              marks: Array.from({ length: 10000 }, () => ({ type: 'bold' })),
            },
          ],
        },
      ]),
    ).success,
  ).toBe(false);
});
it('counts media by distinct id and enforces entry bytes and final projection size', () => {
  const ids = Array.from(
    { length: 11 },
    (_, index) =>
      `${String(index + 1).padStart(8, '0')}-1111-4111-8111-111111111111`,
  );
  expect(
    journalContentSchema.safeParse(
      rich(ids.map((mediaId) => ({ type: 'journalFile', attrs: { mediaId } }))),
    ).success,
  ).toBe(false);
  const content = journalContentSchema.parse(
    rich(
      ids
        .slice(0, 3)
        .map((mediaId) => ({ type: 'journalFile', attrs: { mediaId } })),
    ),
  );
  expect(() =>
    projectJournalContent(
      content,
      ids.slice(0, 3).map((mediaId) => ({
        ...metadata,
        id: mediaId,
        byteLength: 25 * 1024 * 1024,
      })),
    ),
  ).toThrow();
  const duplicate = journalContentSchema.parse(rich([file, file]));
  expect(
    projectJournalContent(duplicate, [
      { ...metadata, byteLength: 25 * 1024 * 1024 },
    ]),
  ).toBe('[Файл: example.txt]\n[Файл: example.txt]');
  const excessive = journalContentSchema.parse(
    rich([paragraph('x'.repeat(9999)), file]),
  );
  expect(() => projectJournalContent(excessive, [metadata])).toThrow();
});

it('distinguishes resolved publication semantics from missing or corrupt server metadata', () => {
  const content = journalContentSchema.parse(rich([file]));
  expect(() =>
    projectJournalContent(content, [
      {
        ...metadata,
        kind: 'image',
        mediaType: 'image/webp',
        width: 1,
        height: 1,
      },
    ]),
  ).toThrow(expect.objectContaining({ reason: 'media-kind' }));
  const excessive = journalContentSchema.parse(
    rich([paragraph('x'.repeat(9999)), file]),
  );
  expect(() => projectJournalContent(excessive, [metadata])).toThrow(
    expect.objectContaining({ reason: 'projection' }),
  );
  for (const items of [[], [{ ...metadata, byteLength: -1 }]]) {
    let failure: unknown;
    try {
      projectJournalContent(content, items);
    } catch (error) {
      failure = error;
    }
    expect(failure).toBeInstanceOf(Error);
    expect(failure).not.toBeInstanceOf(JournalPublicationError);
  }
  const tooMany = journalContentSchema.safeParse(
    rich(
      Array.from({ length: 11 }, (_, n) => ({
        type: 'journalFile',
        attrs: {
          mediaId: `${String(n + 1).padStart(8, '0')}-1111-4111-8111-111111111111`,
        },
      })),
    ),
  );
  expect(tooMany.success).toBe(false);
  if (tooMany.success) throw Error('fixture');
  expect(tooMany.error.issues).toContainEqual(
    expect.objectContaining({
      code: 'custom',
      params: { journalLimit: 'entryFiles' },
    }),
  );
});
