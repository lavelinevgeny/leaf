import { z } from 'zod';
import { uuidSchema } from './contracts.js';
import {
  JOURNAL_MEDIA_LIMITS,
  journalMediaSchema,
  journalUnicodeStringSchema,
  type JournalMedia,
} from './journal-media-contracts.js';
export type JournalMark =
  { type: 'bold' } | { type: 'link'; attrs: { href: string } };
export type JournalInlineNode =
  | { type: 'text'; text: string; marks?: JournalMark[] | undefined }
  | { type: 'hardBreak' };
export type JournalParagraph = {
  type: 'paragraph';
  content?: JournalInlineNode[] | undefined;
};
export type JournalListItem = {
  type: 'listItem';
  content: [JournalParagraph, ...JournalList[]];
};
export type JournalList = {
  type: 'bulletList' | 'orderedList';
  content: JournalListItem[];
};
export type JournalMediaNode =
  | { type: 'journalImage'; attrs: { mediaId: string; alt: string } }
  | { type: 'journalFile'; attrs: { mediaId: string } };
export type JournalNode =
  | JournalInlineNode
  | JournalParagraph
  | JournalListItem
  | JournalList
  | JournalMediaNode;
export type JournalDocument = {
  type: 'doc';
  content: (JournalParagraph | JournalList | JournalMediaNode)[];
};
export type JournalContent =
  | { format: 'plain-text'; text: string }
  | { format: 'rich-text'; documentVersion: 1; doc: JournalDocument };
const utf8Length = (value: string) =>
  new TextEncoder().encode(value).byteLength;
const projectionFits = (value: string) =>
  value.length <= 10000 && utf8Length(value) <= 30000;
const plainText = journalUnicodeStringSchema
  .min(1)
  .max(10000)
  .refine(
    (value) => value.trim().length > 0 && projectionFits(value),
    'Empty or excessive text',
  );
export const journalHrefSchema = journalUnicodeStringSchema
  .min(1)
  .max(2048)
  .refine((value) => {
    if (/[\u0000-\u0020\u007f-\u009f]/.test(value)) return false;
    try {
      const url = new URL(value);
      return (
        (url.protocol === 'http:' || url.protocol === 'https:') &&
        !url.username &&
        !url.password
      );
    } catch {
      return false;
    }
  }, 'Invalid link');
const marks = z
  .array(
    z.discriminatedUnion('type', [
      z.strictObject({ type: z.literal('bold') }),
      z.strictObject({
        type: z.literal('link'),
        attrs: z.strictObject({ href: journalHrefSchema }),
      }),
    ]),
  )
  .max(2)
  .refine(
    (value) => new Set(value.map((mark) => mark.type)).size === value.length,
    'Duplicate mark',
  );
const inline: z.ZodType<JournalInlineNode> = z.discriminatedUnion('type', [
  z.strictObject({
    type: z.literal('text'),
    text: journalUnicodeStringSchema.min(1),
    marks: marks.optional(),
  }),
  z.strictObject({ type: z.literal('hardBreak') }),
]);
const paragraph: z.ZodType<JournalParagraph> = z.strictObject({
  type: z.literal('paragraph'),
  content: z.array(inline).optional(),
});
const list: z.ZodType<JournalList> = z.lazy(() =>
  z.strictObject({
    type: z.enum(['bulletList', 'orderedList']),
    content: z
      .array(
        z.strictObject({
          type: z.literal('listItem'),
          content: z.tuple([paragraph]).rest(list),
        }),
      )
      .min(1),
  }),
);
const mediaNode = z.discriminatedUnion('type', [
  z.strictObject({
    type: z.literal('journalImage'),
    attrs: z.strictObject({
      mediaId: uuidSchema,
      alt: journalUnicodeStringSchema.max(500),
    }),
  }),
  z.strictObject({
    type: z.literal('journalFile'),
    attrs: z.strictObject({ mediaId: uuidSchema }),
  }),
]);
// Bound the untrusted tree before Zod enters its recursive list schema or JSON.stringify.
const boundedDocument = z.unknown().superRefine((value, ctx) => {
  const stack = [{ value, depth: 1, lists: 0 }];
  let nodes = 0;
  let stringUnits = 0;
  while (stack.length) {
    const current = stack.pop()!;
    if (
      !current.value ||
      typeof current.value !== 'object' ||
      Array.isArray(current.value)
    ) {
      ctx.addIssue({ code: 'custom', message: 'Invalid document node' });
      return;
    }
    const node = current.value as Record<string, unknown>;
    const lists =
      current.lists +
      (node.type === 'bulletList' || node.type === 'orderedList' ? 1 : 0);
    if (++nodes > 1000 || current.depth > 12 || lists > 4) {
      ctx.addIssue({
        code: 'custom',
        message: 'Document exceeds structural limits',
      });
      return;
    }
    // Reject wide arrays before copying them into a traversal stack.
    if (node.content !== undefined) {
      if (
        !Array.isArray(node.content) ||
        nodes + stack.length + node.content.length > 1000
      ) {
        ctx.addIssue({ code: 'custom', message: 'Invalid node content' });
        return;
      }
      for (const child of node.content)
        stack.push({ value: child, depth: current.depth + 1, lists });
    }
    // Only allowed fields can reach serialization. Unknown objects never recurse here.
    if (
      Object.keys(node).some(
        (key) => !['type', 'content', 'text', 'marks', 'attrs'].includes(key),
      )
    ) {
      ctx.addIssue({ code: 'custom', message: 'Unknown node field' });
      return;
    }
    // Attrs and marks are flat scalar records. Bound those too before recursive
    // parsing, including malformed oversized arrays and non-JSON cyclic objects.
    const scalarRecord = (input: unknown, allowed: readonly string[]) => {
      if (!input || typeof input !== 'object' || Array.isArray(input))
        return false;
      return Object.entries(input).every(([key, item]) => {
        if (
          !allowed.includes(key) ||
          typeof item !== 'string' ||
          item.length > 2048
        )
          return false;
        stringUnits += item.length;
        return true;
      });
    };
    if (
      typeof node.type !== 'string' ||
      node.type.length > 32 ||
      (node.text !== undefined &&
        (typeof node.text !== 'string' || node.text.length > 10000)) ||
      (node.attrs !== undefined &&
        !scalarRecord(node.attrs, ['mediaId', 'alt']))
    ) {
      ctx.addIssue({ code: 'custom', message: 'Invalid node fields' });
      return;
    }
    if (node.marks !== undefined) {
      if (
        !Array.isArray(node.marks) ||
        node.marks.length > 2 ||
        node.marks.some((mark) => {
          if (!mark || typeof mark !== 'object' || Array.isArray(mark))
            return true;
          const record = mark as Record<string, unknown>;
          return (
            Object.keys(record).some(
              (key) => !['type', 'attrs'].includes(key),
            ) ||
            typeof record.type !== 'string' ||
            record.type.length > 4 ||
            (record.attrs !== undefined &&
              !scalarRecord(record.attrs, ['href']))
          );
        })
      ) {
        ctx.addIssue({ code: 'custom', message: 'Invalid marks' });
        return;
      }
    }
    if (typeof node.text === 'string') stringUnits += node.text.length;
    if (stringUnits > 48 * 1024) {
      ctx.addIssue({ code: 'custom', message: 'Document too large' });
      return;
    }
  }
  if (utf8Length(JSON.stringify(value)) > 48 * 1024)
    ctx.addIssue({ code: 'custom', message: 'Document too large' });
});
const structure: z.ZodType<JournalDocument> = z.strictObject({
  type: z.literal('doc'),
  content: z.array(z.union([paragraph, list, mediaNode])),
});
export const journalDocumentSchema = boundedDocument.pipe(structure);
export function collectJournalMediaIds(content: JournalContent): string[] {
  return content.format === 'plain-text'
    ? []
    : [
        ...new Set(
          content.doc.content.flatMap((node) =>
            node.type === 'journalImage' || node.type === 'journalFile'
              ? [node.attrs.mediaId]
              : [],
          ),
        ),
      ];
}
function renderDocument(
  doc: JournalDocument,
  media: ReadonlyMap<string, JournalMedia>,
  allowMissing: boolean,
): string {
  const render = (node: JournalNode, depth: number): string => {
    switch (node.type) {
      case 'text':
        return node.text;
      case 'hardBreak':
        return '\n';
      case 'paragraph':
        return (node.content ?? [])
          .map((child) => render(child, depth))
          .join('');
      case 'bulletList':
      case 'orderedList':
        return node.content
          .map((item, index) => {
            const [first, ...nested] = item.content;
            return `${'  '.repeat(depth)}${node.type === 'bulletList' ? '-' : `${index + 1}.`} ${render(first, depth)}${nested.map((child) => '\n' + render(child, depth + 1)).join('')}`;
          })
          .join('\n');
      case 'listItem':
        return node.content.map((child) => render(child, depth)).join('\n');
      case 'journalImage':
      case 'journalFile': {
        const found = media.get(node.attrs.mediaId);
        if (!found) {
          if (allowMissing) return '';
          throw new Error('Missing journal media metadata');
        }
        if (found.kind !== (node.type === 'journalImage' ? 'image' : 'file'))
          throw new Error('Journal media kind mismatch');
        return `[${found.kind === 'image' ? 'Изображение' : 'Файл'}: ${found.fileName}]`;
      }
    }
  };
  return doc.content.map((node) => render(node, 0)).join('\n');
}
function hasNonemptyText(doc: JournalDocument): boolean {
  const pending: (JournalDocument | JournalNode)[] = [doc];
  while (pending.length) {
    const node = pending.pop()!;
    if (node.type === 'text' && node.text.trim().length > 0) return true;
    if ('content' in node) pending.push(...(node.content ?? []));
  }
  return false;
}
export const journalContentSchema: z.ZodType<JournalContent> =
  z.discriminatedUnion('format', [
    z.strictObject({ format: z.literal('plain-text'), text: plainText }),
    z
      .strictObject({
        format: z.literal('rich-text'),
        documentVersion: z.literal(1),
        doc: journalDocumentSchema,
      })
      .refine((content) => {
        const ids = collectJournalMediaIds(content);
        const text = renderDocument(content.doc, new Map(), true);
        return (
          ids.length <= 10 &&
          projectionFits(text) &&
          (ids.length > 0 || hasNonemptyText(content.doc))
        );
      }, 'Empty or excessive rich content'),
  ]);
export function projectJournalContent(
  content: JournalContent,
  media: readonly JournalMedia[],
): string {
  const parsed = journalContentSchema.parse(content);
  if (parsed.format === 'plain-text') return parsed.text;
  const byId = new Map(
    media.map((item) => {
      const valid = journalMediaSchema.parse(item);
      return [valid.id, valid] as const;
    }),
  );
  const used = collectJournalMediaIds(parsed);
  if (
    used.reduce((total, id) => {
      const item = byId.get(id);
      if (!item) throw new Error('Missing journal media metadata');
      return total + item.byteLength;
    }, 0) > JOURNAL_MEDIA_LIMITS.entryBytes
  )
    throw new Error('Journal media quota exceeded');
  const projected = renderDocument(parsed.doc, byId, false);
  if (!projectionFits(projected))
    throw new Error('Journal projection too large');
  return projected;
}
export function plainTextToJournalDocument(text: string): JournalDocument {
  journalUnicodeStringSchema.parse(text);
  return {
    type: 'doc',
    content: [
      {
        type: 'paragraph',
        ...(text.length ? { content: [{ type: 'text' as const, text }] } : {}),
      },
    ],
  };
}
