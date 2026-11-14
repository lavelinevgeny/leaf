import type {
  JournalContent,
  JournalDocument,
  JournalNode,
} from '../shared/journal-content.js';
import {
  plainTextToJournalDocument,
  collectJournalMediaIds,
} from '../shared/journal-content.js';
import type { JournalMedia } from '../shared/journal-media-contracts.js';
import { JOURNAL_MEDIA_LIMITS as limits } from '../shared/journal-media-contracts.js';
export type JournalUpload = {
  taskId: string;
  id: string;
  uploadId: string;
  kind: 'image' | 'file';
  file: File;
  status: 'queued' | 'uploading' | 'error' | 'uncertain' | 'ready';
  error: string | null;
  expired: boolean;
  media: JournalMedia | null;
};
export function makeJournalUpload(file: File, taskId: string): JournalUpload {
  const kind = /^image\/(png|jpeg|webp)$/.test(file.type) ? 'image' : 'file';
  if (
    !file.size ||
    file.size >
      (kind === 'image' ? limits.imageSourceBytes : limits.fileSourceBytes)
  )
    throw Error(
      'Файл пуст или превышает предел: картинка 10 MiB, файл 25 MiB.',
    );
  return {
    taskId,
    id: crypto.randomUUID(),
    uploadId: crypto.randomUUID(),
    kind,
    file,
    status: 'queued',
    error: null,
    expired: false,
    media: null,
  };
}
export function journalDocument(content: JournalContent): JournalDocument {
  return content.format === 'rich-text'
    ? content.doc
    : plainTextToJournalDocument(content.text);
}
export function richContent(doc: JournalDocument): JournalContent {
  return { format: 'rich-text', documentVersion: 1, doc };
}
export function uploadsReady(
  content: JournalContent,
  uploads: ReadonlyMap<string, JournalUpload>,
): boolean {
  return collectJournalMediaIds(content).every(
    (id) => !uploads.has(id) || uploads.get(id)!.status === 'ready',
  );
}
export function resolveUploadContent(
  content: JournalContent,
  uploads: ReadonlyMap<string, JournalUpload>,
): JournalContent {
  if (content.format === 'plain-text') return structuredClone(content);
  if (!uploadsReady(content, uploads))
    throw Error('Дождитесь загрузки вложений или повторите загрузку.');
  return richContent({
    ...content.doc,
    content: content.doc.content.map((node) =>
      node.type === 'journalImage'
        ? {
            ...node,
            attrs: {
              ...node.attrs,
              mediaId:
                uploads.get(node.attrs.mediaId)?.media?.id ??
                node.attrs.mediaId,
            },
          }
        : node.type === 'journalFile'
          ? {
              ...node,
              attrs: {
                mediaId:
                  uploads.get(node.attrs.mediaId)?.media?.id ??
                  node.attrs.mediaId,
              },
            }
          : structuredClone(node),
    ),
  });
}
// Local preview tolerates unfinished uploads; this string never becomes a wire body.
export function journalDraftBody(
  content: JournalContent,
  media: readonly JournalMedia[],
  uploads: ReadonlyMap<string, JournalUpload>,
): string {
  if (content.format === 'plain-text') return content.text;
  const render = (node: JournalNode): string => {
    if (node.type === 'text') return node.text;
    if (node.type === 'hardBreak') return '\n';
    if (node.type === 'journalImage' || node.type === 'journalFile')
      return `[${uploads.get(node.attrs.mediaId)?.file.name ?? media.find((m) => m.id === node.attrs.mediaId)?.fileName ?? 'Вложение'}]`;
    return (node.content ?? [])
      .map(render)
      .join(node.type === 'paragraph' ? '' : '\n');
  };
  return content.doc.content.map(render).join('\n');
}
export function journalMediaUrl(
  projectId: string,
  taskId: string,
  id: string,
  download = false,
): string {
  return `/api/projects/${encodeURIComponent(projectId)}/tasks/${encodeURIComponent(taskId)}/journal-media/${encodeURIComponent(id)}${download ? '/download' : ''}`;
}
