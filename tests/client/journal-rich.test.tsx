// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import './journal-editor-helpers.js';
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { closeHistory } from '@tiptap/pm/history';
import type { Editor } from '@tiptap/core';
import { journalEditorDocument } from '../../src/client/JournalRichEditor.js';
import { JournalRichBody } from '../../src/client/JournalRichBody.js';
import { TaskJournal } from '../../src/client/TaskJournal.js';
import { useJournal } from '../../src/client/use-journal.js';
import { api, ApiError } from '../../src/client/api.js';
import {
  journalContentSchema,
  projectJournalContent,
} from '../../src/shared/journal-content.js';
import type { JournalController } from '../../src/client/journal-state.js';
import {
  journalContext,
  page5,
  journal5,
  deferred,
} from './journal-fixtures.js';
import type { JournalUploadReady } from '../../src/shared/journal-media-contracts.js';
import { task } from './fixtures.js';
let controller: JournalController;
function Harness() {
  controller = useJournal(journalContext({ taskId: journal5.taskId }));
  return (
    <TaskJournal controller={controller} task={task(1)} today="2026-11-15" />
  );
}
beforeEach(() => {
  vi.spyOn(api, 'journalProject').mockResolvedValue(page5);
  vi.spyOn(api, 'journalTask').mockResolvedValue({
    ...page5,
    taskId: journal5.taskId,
  });
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});
const editor = () =>
  (
    screen.getByRole('textbox', { name: 'Текст записи' }) as HTMLElement & {
      editor: Editor;
    }
  ).editor;
it('strips default attrs and unsupported marks; preserves exact plain baseline without parsing HTML', () => {
  const doc = journalEditorDocument({
    type: 'doc',
    content: [
      {
        type: 'orderedList',
        attrs: { start: 1 },
        content: [
          {
            type: 'listItem',
            content: [
              {
                type: 'paragraph',
                content: [
                  {
                    type: 'text',
                    text: 'literal <b>text</b>',
                    marks: [
                      { type: 'bold' },
                      {
                        type: 'link',
                        attrs: {
                          href: 'https://example.invalid/',
                          target: '_blank',
                          rel: 'noopener',
                          class: null,
                        },
                      },
                    ],
                  },
                ],
              },
            ],
          },
        ],
      },
    ],
  });
  const content = {
    format: 'rich-text' as const,
    documentVersion: 1 as const,
    doc,
  };
  expect(journalContentSchema.safeParse(content).success).toBe(true);
  expect(doc.content[0]).not.toHaveProperty('attrs');
  expect(JSON.stringify(doc)).not.toContain('target');
  expect(projectJournalContent(content, [])).toBe('1. literal <b>text</b>');
});
it('formatting/list/link edits serialize strict content; CtrlEnter/IME and local Undo never reach plan keys', async () => {
  render(<Harness />);
  await screen.findByRole('textbox', { name: 'Текст записи' });
  await waitFor(() => expect(controller.projectFeed?.phase).toBe('ready'));
  act(() => {
    editor().commands.insertContent({ type: 'text', text: 'Название' });
    editor().commands.selectAll();
    editor().commands.toggleBold();
    editor().commands.setLink({ href: 'https://example.invalid/path' });
    editor().commands.toggleOrderedList();
  });
  const draft = [...controller.drafts.values()][0]!;
  expect(journalContentSchema.safeParse(draft.content).success).toBe(true);
  expect(JSON.stringify(draft.content)).toContain('"bold"');
  expect(JSON.stringify(draft.content)).toContain('orderedList');
  const plan = vi.fn();
  window.addEventListener('keydown', plan);
  fireEvent.keyDown(screen.getByRole('textbox', { name: 'Текст записи' }), {
    key: 'z',
    ctrlKey: true,
  });
  expect(plan).not.toHaveBeenCalled();
  window.removeEventListener('keydown', plan);
  act(() =>
    editor().commands.insertContent({ type: 'text', text: 'After Undo' }),
  );
  const create = vi
    .spyOn(api, 'journalCreate')
    .mockRejectedValue(new ApiError('NETWORK_ERROR', 'offline', null, true));
  const root = screen.getByRole('textbox', { name: 'Текст записи' });
  fireEvent.keyDown(root, { key: 'Enter', ctrlKey: true, isComposing: true });
  expect(create).not.toHaveBeenCalled();
  const before = structuredClone(controller.getDraft(draft.key)?.content);
  fireEvent.keyDown(root, { key: 'Enter', ctrlKey: true });
  await waitFor(() => expect(create).toHaveBeenCalledOnce());
  expect(create.mock.calls[0]![1].content).toEqual(before);
});
it('file plus HTML creates one RAM block, preserves clipboard text, blocks save until ready and local Undo restores ready File', async () => {
  const pending = deferred<JournalUploadReady>();
  vi.spyOn(api, 'journalUpload').mockImplementation(() => pending.promise);
  render(<Harness />);
  await screen.findByRole('textbox', { name: 'Текст записи' });
  await waitFor(() => expect(controller.projectFeed?.phase).toBe('ready'));
  const file = new File(['synthetic bytes'], 'clip.txt', {
    type: 'text/plain',
  });
  fireEvent.paste(screen.getByRole('textbox', { name: 'Текст записи' }), {
    clipboardData: {
      files: [file],
      getData: (type: string) =>
        type === 'text/plain'
          ? 'clipboard text'
          : '<img src="https://example.invalid/not-read">',
    },
  });
  await waitFor(() => expect(api.journalUpload).toHaveBeenCalledOnce());
  const draft = [...controller.drafts.values()][0]!;
  const record = [...draft.uploads.values()][0]!;
  expect(
    editor()
      .getJSON()
      .content?.filter((n) => n.type === 'journalFile'),
  ).toHaveLength(1);
  expect(editor().getText()).toContain('clipboard text');
  expect(
    screen.getByRole('button', { name: 'Сохранить запись' }),
  ).toBeDisabled();
  const before = editor().getJSON();
  act(() => editor().view.dispatch(closeHistory(editor().state.tr)));
  // Explicit document removal is one user transaction, retaining source bytes for Undo.
  act(() =>
    editor().commands.setContent({
      type: 'doc',
      content: [
        { type: 'paragraph', content: [{ type: 'text', text: 'remaining' }] },
      ],
    }),
  );
  await act(async () =>
    pending.resolve({
      mediaContractVersion: 1,
      uploadId: record.uploadId,
      media: {
        id: '99999999-9999-4999-8999-999999999999',
        kind: 'file',
        mediaType: 'application/octet-stream',
        fileName: 'clip.txt',
        byteLength: 15,
      },
    }),
  );
  expect(editor().getText()).toBe('remaining');
  expect(controller.getDraft(draft.key)?.uploads.get(record.id)?.file).toBe(
    file,
  );
  act(() => editor().commands.undo());
  expect(editor().getJSON()).toEqual(before);
  expect(controller.getDraft(draft.key)?.uploads.get(record.id)?.status).toBe(
    'ready',
  );
});
it('external image HTML becomes an HTTP link and message without fetching bytes; script protocols stay text', async () => {
  const network = vi.spyOn(globalThis, 'fetch');
  render(<Harness />);
  await screen.findByRole('textbox', { name: 'Текст записи' });
  fireEvent.paste(screen.getByRole('textbox', { name: 'Текст записи' }), {
    clipboardData: {
      files: [],
      getData: (type: string) =>
        type === 'text/plain'
          ? 'safe text'
          : '<img src="https://example.invalid/picture.png"><img src="javascript:alert(1)"> <script>unsafe()</script>',
    },
  });
  expect(
    screen.getByText('Изображение не загружено. Прикрепите файл'),
  ).toBeVisible();
  expect(editor().getJSON()).toMatchObject({
    content: expect.arrayContaining([
      {
        type: 'paragraph',
        content: [
          {
            type: 'text',
            text: 'https://example.invalid/picture.png',
            marks: [expect.objectContaining({ type: 'link' })],
          },
        ],
      },
    ]),
  });
  expect(network).not.toHaveBeenCalled();
  expect(document.querySelector('img')).toBeNull();
});
it('image-only rich preview keeps first media, reserved dimensions and ordered expansion', () => {
  const media = {
    id: '99999999-9999-4999-8999-999999999999',
    kind: 'image' as const,
    mediaType: 'image/webp' as const,
    fileName: 'synthetic.webp',
    byteLength: 10,
    width: 40,
    height: 20,
  };
  const content = {
    format: 'rich-text' as const,
    documentVersion: 1 as const,
    doc: {
      type: 'doc' as const,
      content: [
        {
          type: 'journalImage' as const,
          attrs: { mediaId: media.id, alt: 'Synthetic picture' },
        },
        {
          type: 'paragraph' as const,
          content: [{ type: 'text' as const, text: 'after' }],
        },
        {
          type: 'journalImage' as const,
          attrs: { mediaId: media.id, alt: '' },
        },
      ],
    },
  };
  render(
    <JournalRichBody
      entry={{
        ...journal5,
        content,
        body: projectJournalContent(content, [media]),
        media: [media],
      }}
    />,
  );
  expect(screen.getByAltText('Synthetic picture')).toHaveAttribute(
    'width',
    '40',
  );
  expect(screen.getByAltText('Synthetic picture')).toHaveAttribute(
    'height',
    '20',
  );
  const images = document.querySelectorAll('.journal-media');
  expect(images[0]!.closest('[hidden]')).toBeNull();
  expect(images[1]!.closest('[hidden]')).not.toBeNull();
  fireEvent.click(screen.getByRole('button', { name: 'Показать полностью' }));
  expect(images[1]!.closest('[hidden]')).toBeNull();
});
it('Enter creates the next list item while Tab leaves native focus navigation available', async () => {
  render(<Harness />);
  await screen.findByRole('textbox', { name: 'Текст записи' });
  act(() => {
    editor().commands.insertContent('First');
    editor().commands.toggleBulletList();
    editor().commands.setTextSelection(editor().state.doc.content.size - 2);
  });
  fireEvent.keyDown(screen.getByRole('textbox', { name: 'Текст записи' }), {
    key: 'Enter',
    code: 'Enter',
  });
  expect(editor().getJSON().content?.[0]?.content).toHaveLength(2);
  const event = new KeyboardEvent('keydown', {
    key: 'Tab',
    bubbles: true,
    cancelable: true,
  });
  act(() => {
    screen.getByRole('textbox', { name: 'Текст записи' }).dispatchEvent(event);
  });
  expect(event.defaultPrevented).toBe(false);
});
