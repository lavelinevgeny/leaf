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
      readMedia={async () => null}
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
it.each([0, 5])(
  'multiline text plus one file pastes once at position %s using the current document',
  async (offset) => {
    vi.spyOn(api, 'journalUpload').mockImplementation(
      () => new Promise(() => {}),
    );
    render(<Harness />);
    await screen.findByRole('textbox', { name: 'Текст записи' });
    await waitFor(() => expect(controller.projectFeed?.phase).toBe('ready'));
    if (offset)
      act(() => {
        editor().commands.insertContent('LEFT RIGHT');
        editor().commands.setTextSelection(offset);
      });
    fireEvent.paste(screen.getByRole('textbox', { name: 'Текст записи' }), {
      clipboardData: {
        files: [new File(['synthetic'], 'clip.txt', { type: 'text/plain' })],
        getData: (type: string) =>
          type === 'text/plain'
            ? 'first line\nsecond line'
            : '<img src="https://example.invalid/never">',
      },
    });
    const doc = journalEditorDocument(editor().getJSON());
    expect(doc.content?.filter((n) => n.type === 'journalFile')).toHaveLength(
      1,
    );
    expect(
      doc.content.flatMap((n) =>
        n.type === 'paragraph'
          ? (n.content ?? []).flatMap((child) =>
              child.type === 'text' ? [child.text] : [],
            )
          : [],
      ),
    ).toEqual(
      offset
        ? ['LEFT', 'first line', 'second line', ' RIGHT']
        : ['first line', 'second line'],
    );
    expect(doc.content.map((n) => n.type)).toEqual(
      offset
        ? ['paragraph', 'paragraph', 'paragraph', 'journalFile', 'paragraph']
        : ['paragraph', 'paragraph', 'journalFile', 'paragraph'],
    );
  },
);
it('selection Escape suppresses floating tools until a new selection and layers popup then toolbar then parent', async () => {
  const parent = vi.fn();
  render(
    <div onKeyDown={parent}>
      <Harness />
    </div>,
  );
  await screen.findByRole('textbox', { name: 'Текст записи' });
  act(() => {
    editor().commands.insertContent('keep selected text');
    editor().commands.selectAll();
  });
  expect(
    screen.getByRole('toolbar', { name: 'Форматирование записи' }),
  ).toBeVisible();
  parent.mockClear();
  fireEvent.keyDown(screen.getByRole('textbox', { name: 'Текст записи' }), {
    key: 'Escape',
  });
  expect(
    screen.queryByRole('toolbar', { name: 'Форматирование записи' }),
  ).toBeNull();
  expect(parent).not.toHaveBeenCalled();
  expect(editor().getText()).toBe('keep selected text');
  fireEvent.keyDown(screen.getByRole('textbox', { name: 'Текст записи' }), {
    key: 'Escape',
  });
  expect(parent).toHaveBeenCalledOnce();
  parent.mockClear();
  fireEvent.pointerDown(screen.getByRole('textbox', { name: 'Текст записи' }));
  act(() => {
    editor().commands.setTextSelection({ from: 1, to: 5 });
  });
  fireEvent.keyDown(screen.getByRole('textbox', { name: 'Текст записи' }), {
    key: 'k',
    ctrlKey: true,
  });
  expect(
    screen.getByRole('dialog', { name: 'Редактировать ссылку' }),
  ).toBeVisible();
  parent.mockClear();
  fireEvent.keyDown(screen.getByLabelText('Название ссылки'), {
    key: 'Escape',
  });
  expect(
    screen.queryByRole('dialog', { name: 'Редактировать ссылку' }),
  ).toBeNull();
  expect(screen.getByRole('toolbar')).toBeVisible();
  expect(parent).not.toHaveBeenCalled();
  fireEvent.keyDown(screen.getByRole('textbox', { name: 'Текст записи' }), {
    key: 'Escape',
  });
  expect(screen.queryByRole('toolbar')).toBeNull();
  expect(parent).not.toHaveBeenCalled();
  fireEvent.keyDown(screen.getByRole('textbox', { name: 'Текст записи' }), {
    key: 'Escape',
  });
  expect(parent).toHaveBeenCalledOnce();
});

import { useEffect, useState } from 'react';
import { JournalEditor } from '../../src/client/JournalEditor.js';
import type { JournalDraftKey } from '../../src/client/journal-state.js';
type AdmissionMode =
  'empty' | 'file-size' | 'image-size' | 'count' | 'demo' | 'no-task';
function AdmissionHarness({
  mode,
  locked = false,
}: {
  mode: AdmissionMode;
  locked?: boolean;
}) {
  controller = useJournal(
    journalContext({
      taskId: mode === 'no-task' ? null : journal5.taskId,
      uploadsDisabled: mode === 'demo',
    }),
  );
  const [key, setKey] = useState<JournalDraftKey | null>(null);
  useEffect(() => {
    setKey(
      controller.openCreate(
        journal5.projectId,
        mode === 'no-task' ? null : journal5.taskId,
        '2026-11-15',
      ),
    );
  }, []);
  const draft = key ? controller.getDraft(key) : undefined;
  return draft ? (
    <JournalEditor
      draft={draft}
      controller={controller}
      disabled={locked}
      onSaved={() => {}}
    />
  ) : null;
}
const rejectedFile = (mode: AdmissionMode) =>
  mode === 'file-size'
    ? new File([new Uint8Array(25 * 1024 * 1024 + 1)], 'oversize.txt')
    : mode === 'image-size'
      ? new File([new Uint8Array(10 * 1024 * 1024 + 1)], 'oversize.png', {
          type: 'image/png',
        })
      : new File(mode === 'empty' ? [] : ['synthetic'], 'rejected.txt', {
          type: 'text/plain',
        });
const admissionCases = (
  ['empty', 'file-size', 'image-size', 'count', 'demo', 'no-task'] as const
).flatMap((mode) => [1, 5].map((position) => ({ mode, position })));
it.each(admissionCases)(
  'preserves clipboard text once when $mode file admission fails at $position',
  async ({ mode, position }) => {
    const upload = vi
      .spyOn(api, 'journalUpload')
      .mockImplementation(() => new Promise(() => {}));
    render(<AdmissionHarness mode={mode} />);
    await screen.findByRole('textbox', { name: 'Текст записи' });
    await waitFor(() => expect(controller.projectFeed?.phase).toBe('ready'));
    act(() => editor().commands.insertContent('LEFT RIGHT'));
    if (mode === 'count') {
      const key = [...controller.drafts.keys()][0]!;
      act(() => {
        controller.addFiles(
          key,
          Array.from(
            { length: 10 },
            (_, index) => new File(['synthetic'], `existing-${index}.txt`),
          ),
        );
      });
      await waitFor(() =>
        expect(controller.getDraft(key)?.uploads.size).toBe(10),
      );
    }
    act(() => editor().commands.setTextSelection(position));
    const before = journalEditorDocument(editor().getJSON()).content.filter(
      (n) => n.type === 'journalImage' || n.type === 'journalFile',
    );
    const beforeCalls = upload.mock.calls.length;
    fireEvent.paste(screen.getByRole('textbox', { name: 'Текст записи' }), {
      clipboardData: {
        files: [rejectedFile(mode)],
        getData: (type: string) =>
          type === 'text/plain'
            ? 'first pasted line\nsecond pasted line'
            : '<img src="https://example.invalid/not-read">',
      },
    });
    const doc = journalEditorDocument(editor().getJSON());
    expect(
      doc.content.filter(
        (n) => n.type === 'journalImage' || n.type === 'journalFile',
      ),
    ).toEqual(before);
    expect(
      doc.content.flatMap((n) =>
        n.type === 'paragraph'
          ? (n.content ?? []).flatMap((child) =>
              child.type === 'text' ? [child.text] : [],
            )
          : [],
      ),
    ).toEqual(
      position === 1
        ? ['first pasted line', 'second pasted line', 'LEFT RIGHT']
        : ['LEFT', 'first pasted line', 'second pasted line', ' RIGHT'],
    );
    expect(upload.mock.calls.length).toBe(beforeCalls);
    if (mode === 'demo')
      expect(
        screen.getByText('В демо загрузка файлов отключена'),
      ).toBeVisible();
    else if (mode === 'no-task')
      expect(screen.getByText('Сначала выберите задачу')).toBeVisible();
    else
      expect(screen.getByRole('alert')).toHaveTextContent(
        mode === 'count'
          ? 'Не более 10 вложений'
          : 'Файл пуст или превышает предел',
      );
  },
);
it.each(['readonly', 'pending'] as const)(
  'rejected-file text fallback respects %s lock',
  async (lock) => {
    vi.spyOn(api, 'journalUpload');
    vi.spyOn(api, 'journalCreate').mockImplementation(
      () => new Promise(() => {}),
    );
    const view = render(<AdmissionHarness mode="empty" />);
    await screen.findByRole('textbox', { name: 'Текст записи' });
    await waitFor(() => expect(controller.projectFeed?.phase).toBe('ready'));
    act(() => editor().commands.insertContent('Keep original'));
    if (lock === 'readonly')
      view.rerender(<AdmissionHarness mode="empty" locked />);
    else
      act(() => {
        void controller.submit([...controller.drafts.keys()][0]!);
      });
    await waitFor(() =>
      expect(
        screen.getByRole('textbox', { name: 'Текст записи' }),
      ).toHaveAttribute('contenteditable', 'false'),
    );
    const before = editor().getJSON();
    const draft = [...controller.drafts.values()][0]!.content;
    fireEvent.paste(screen.getByRole('textbox', { name: 'Текст записи' }), {
      clipboardData: {
        files: [new File([], 'empty.txt')],
        getData: () => 'must not insert',
      },
    });
    expect(editor().getJSON()).toEqual(before);
    expect([...controller.drafts.values()][0]!.content).toEqual(draft);
    expect(api.journalUpload).not.toHaveBeenCalled();
  },
);
