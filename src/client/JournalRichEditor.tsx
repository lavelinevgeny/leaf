import {
  createContext,
  useContext,
  useLayoutEffect,
  useRef,
  useState,
} from 'react';
import { Node, type JSONContent } from '@tiptap/core';
import { closeHistory } from '@tiptap/pm/history';
import {
  EditorContent,
  useEditor,
  NodeViewWrapper,
  ReactNodeViewRenderer,
  type NodeViewProps,
} from '@tiptap/react';
import { useJournalImage } from './use-journal-image.js';
import StarterKit from '@tiptap/starter-kit';
import type {
  JournalDocument,
  JournalNode,
  JournalMark,
} from '../shared/journal-content.js';
import { journalHrefSchema } from '../shared/journal-content.js';
import type {
  JournalController,
  JournalDraft,
  JournalEditorHandle,
} from './journal-state.js';
import { journalDocument, richContent } from './journal-upload-state.js';
const DraftContext = createContext<{
  draft: JournalDraft;
  controller: JournalController;
} | null>(null);
/** Strip adapter defaults; only the shared schema fields leave this module. */
export function journalEditorDocument(json: JSONContent): JournalDocument {
  const clean = (node: JSONContent): JournalNode => {
    if (node.type === 'text')
      return {
        type: 'text',
        text: node.text ?? '',
        ...(node.marks?.length
          ? {
              marks: node.marks.flatMap<JournalMark>((mark) =>
                mark.type === 'bold'
                  ? [{ type: 'bold' as const }]
                  : mark.type === 'link' &&
                      journalHrefSchema.safeParse(mark.attrs?.href).success
                    ? [
                        {
                          type: 'link' as const,
                          attrs: { href: mark.attrs!.href as string },
                        },
                      ]
                    : [],
              ),
            }
          : {}),
      };
    if (node.type === 'hardBreak') return { type: 'hardBreak' };
    if (node.type === 'journalImage')
      return {
        type: 'journalImage',
        attrs: {
          mediaId: node.attrs!.mediaId as string,
          alt: (node.attrs?.alt as string) ?? '',
        },
      };
    if (node.type === 'journalFile')
      return {
        type: 'journalFile',
        attrs: { mediaId: node.attrs!.mediaId as string },
      };
    return {
      type: node.type,
      ...(node.content?.length ? { content: node.content.map(clean) } : {}),
    } as JournalNode;
  };
  return {
    type: 'doc',
    content: (json.content ?? []).map(clean) as JournalDocument['content'],
  };
}
function UploadNode({ node, editor, getPos }: NodeViewProps) {
  const context = useContext(DraftContext)!;
  const id = node.attrs.mediaId as string;
  const upload = context.draft.uploads.get(id);
  const media = upload?.media ?? context.draft.media.find((m) => m.id === id);
  const image = useJournalImage(
    context.controller.readMedia,
    context.draft.projectId,
    context.draft.taskId!,
    node.type.name === 'journalImage' ? (media?.id ?? id) : null,
    upload?.kind === 'image' ? upload.file : undefined,
  );
  const src = image.src;
  return (
    <NodeViewWrapper className="journal-upload" contentEditable={false}>
      {node.type.name === 'journalImage' && src && (
        <img
          src={src ?? undefined}
          alt={(node.attrs.alt as string) || 'Вложенное изображение'}
          {...(media?.kind === 'image'
            ? { width: media.width, height: media.height }
            : {})}
        />
      )}
      <span>{media?.fileName ?? upload?.file.name ?? 'Вложение'}</span>
      {upload && upload.status !== 'ready' && (
        <span role="status">
          {upload.status === 'error' || upload.status === 'uncertain'
            ? upload.error
            : 'Загрузка…'}
        </span>
      )}
      {upload &&
        (upload.status === 'error' ||
          upload.status === 'uncertain' ||
          (upload.status === 'ready' && context.controller.mutationError)) && (
          <button
            type="button"
            onClick={() =>
              void context.controller.retryUpload(context.draft.key, id)
            }
          >
            Повторить загрузку
          </button>
        )}
      <button
        type="button"
        aria-label="Удалить вложение"
        disabled={!editor.isEditable}
        onClick={() => {
          const pos = getPos();
          if (pos !== undefined)
            editor
              .chain()
              .focus()
              .command(({ tr }) => {
                closeHistory(tr);
                return true;
              })
              .deleteRange({ from: pos, to: pos + node.nodeSize })
              .run();
        }}
      >
        Удалить
      </button>
    </NodeViewWrapper>
  );
}
const mediaNode = (name: 'journalImage' | 'journalFile') =>
  Node.create({
    name,
    group: 'block',
    atom: true,
    selectable: true,
    draggable: true,
    addAttributes() {
      return {
        mediaId: { default: null },
        ...(name === 'journalImage' ? { alt: { default: '' } } : {}),
      };
    },
    // External HTML cannot create a trusted attachment node.
    parseHTML() {
      return [];
    },
    renderHTML({ node }) {
      return [
        'div',
        { 'data-journal-media': node.attrs.mediaId },
        name === 'journalImage' ? 'Изображение' : 'Файл',
      ];
    },
    addNodeView() {
      return ReactNodeViewRenderer(UploadNode);
    },
  });
export function JournalRichEditor({
  draft,
  controller,
  disabled,
  visible,
  placeholder,
  descriptionId,
  onReady,
}: {
  draft: JournalDraft;
  controller: JournalController;
  disabled: boolean;
  visible: boolean;
  placeholder?: string | undefined;
  descriptionId?: string | undefined;
  onReady?: (handle: JournalEditorHandle) => void;
}) {
  const current = useRef({ draft, controller, disabled, visible });
  current.current = { draft, controller, disabled, visible };
  const picker = useRef<HTMLInputElement>(null);
  const [toolbar, setToolbar] = useState(false),
    [selected, setSelected] = useState(false),
    [selectionToolsDismissed, setSelectionToolsDismissed] = useState(false),
    [link, setLink] = useState(false);
  const [title, setTitle] = useState(''),
    [href, setHref] = useState(''),
    [message, setMessage] = useState('');
  const selection = useRef({ from: 1, to: 1 });
  const addFiles = (files: File[], text = '') => {
    const { controller, draft, disabled } = current.current;
    if (
      !editor ||
      !editor.isEditable ||
      disabled ||
      !controller.active ||
      controller.writing ||
      controller.pending
    )
      return;
    const paragraphs: JSONContent[] = text
      ? text.split(/\r?\n/).map((line) => ({
          type: 'paragraph',
          ...(line ? { content: [{ type: 'text', text: line }] } : {}),
        }))
      : [];
    const added = controller.addFiles(draft.key, files);
    if (!added) {
      if (paragraphs.length)
        editor.commands.insertContentAt(editor.state.selection, paragraphs);
      return;
    }
    const nodes = added.nodes;
    // Top-level media cannot enter a list item. Insert after the enclosing root block.
    const $pos = editor.state.doc.resolve(selection.current.from);
    const end = editor.state.doc.resolve(selection.current.to);
    const hasFollowingText =
      $pos.depth === 1 && end.parentOffset < end.parent.content.size;
    const position = $pos.depth > 1 ? $pos.after(1) : selection.current;
    editor
      .chain()
      .insertContentAt(position, [
        ...paragraphs,
        ...nodes,
        ...(hasFollowingText ? [] : [{ type: 'paragraph' }]),
      ])
      .run();
  };
  const editor = useEditor(
    {
      injectCSS: false,
      immediatelyRender: true,
      autofocus: false,
      extensions: [
        StarterKit.configure({
          blockquote: false,
          code: false,
          codeBlock: false,
          heading: false,
          horizontalRule: false,
          italic: false,
          strike: false,
          underline: false,
          dropcursor: false,
          gapcursor: false,
          trailingNode: false,
          listKeymap: false,
          listItem: false,
          link: {
            openOnClick: false,
            autolink: true,
            linkOnPaste: true,
            protocols: ['http', 'https'],
            isAllowedUri: (href) => journalHrefSchema.safeParse(href).success,
          },
        }),
        Node.create({
          name: 'listItem',
          addKeyboardShortcuts() {
            return {
              Enter: () => this.editor.commands.splitListItem(this.name),
            };
          },
          content: 'paragraph (bulletList | orderedList)*',
          defining: true,
          parseHTML: () => [{ tag: 'li' }],
          renderHTML: () => ['li', 0],
        }),
        mediaNode('journalImage'),
        mediaNode('journalFile'),
      ],
      content: journalDocument(draft.content) as JSONContent,
      editable: !disabled,
      onUpdate: ({ editor }) => {
        const next = richContent(journalEditorDocument(editor.getJSON()));
        current.current.controller.changeDraft(current.current.draft.key, {
          content: next,
        });
      },
      onSelectionUpdate: ({ editor }) => {
        selection.current = {
          from: editor.state.selection.from,
          to: editor.state.selection.to,
        };
        setSelected(!editor.state.selection.empty);
      },
      editorProps: {
        handleDOMEvents: { keydown: (_view, event) => event.key === 'Escape' },
        attributes: () => ({
          role: 'textbox',
          'aria-disabled': String(current.current.disabled),
          'aria-label': 'Текст записи',
          'aria-multiline': 'true',
          'aria-describedby': descriptionId ?? '',
          'data-journal-body': '',
          'data-placeholder': placeholder ?? '',
        }),
        handleKeyDown: (_view, event) => {
          if (event.isComposing) return false;
          if (
            (event.ctrlKey || event.metaKey) &&
            event.key.toLowerCase() === 'k'
          ) {
            event.preventDefault();
            openLink();
            return true;
          }
          // Tab belongs to browser focus navigation, never list indentation.
          return false;
        },
        handlePaste: (_view, event) => {
          const transfer = event.clipboardData;
          if (!transfer) return false;
          if (transfer.files.length) {
            event.preventDefault();
            addFiles(
              Array.from(transfer.files),
              transfer.getData('text/plain'),
            );
            return true;
          }
          const text = transfer.getData('text/plain');
          const html = transfer.getData('text/html');
          if (!text && !html) return false;
          event.preventDefault();
          const remote = [
            ...html.matchAll(/<img\b[^>]*\bsrc\s*=\s*["']([^"']+)["']/gi),
          ]
            .map((m) => m[1]!)
            .filter((url) => journalHrefSchema.safeParse(url).success);
          const template = document.createElement('template');
          template.innerHTML = html;
          const plain = text || (template.content.textContent ?? '');
          if (
            !editor!.state.selection.empty &&
            journalHrefSchema.safeParse(plain).success
          ) {
            editor!.chain().setLink({ href: plain }).run();
            return true;
          }
          const nodes: JSONContent[] = plain.split(/\r?\n/).map((line) => ({
            type: 'paragraph',
            ...(line ? { content: [{ type: 'text', text: line }] } : {}),
          }));
          for (const url of remote)
            nodes.push({
              type: 'paragraph',
              content: [
                {
                  type: 'text',
                  text: url,
                  marks: [{ type: 'link', attrs: { href: url } }],
                },
              ],
            });
          if (remote.length)
            setMessage('Изображение не загружено. Прикрепите файл');
          editor!.commands.insertContent(nodes);
          return true;
        },
        handleDrop: (view, event) => {
          if (!event.dataTransfer?.files.length) return false;
          event.preventDefault();
          const pos = view.posAtCoords({
            left: event.clientX,
            top: event.clientY,
          });
          if (pos) selection.current = { from: pos.pos, to: pos.pos };
          addFiles(Array.from(event.dataTransfer.files));
          return true;
        },
      },
    },
    [draft.generation],
  );
  // listItem's content expression must be restricted in the extension schema, not HTML.
  useLayoutEffect(() => {
    editor?.setEditable(!disabled, false);
  }, [editor, disabled]);
  useLayoutEffect(() => {
    if (!editor) return;
    const incoming = journalDocument(draft.content);
    if (
      JSON.stringify(journalEditorDocument(editor.getJSON())) !==
      JSON.stringify(incoming)
    )
      editor.commands.setContent(incoming as JSONContent, {
        emitUpdate: false,
      });
    if (visible && !disabled && !editor.view.dom.closest('[hidden]'))
      onReady?.({
        root: editor.view.dom,
        focus: () =>
          editor.commands.focus(undefined, { scrollIntoView: false }),
      });
  }, [editor, draft.content, visible, disabled, onReady]);
  function openLink() {
    if (!editor) return;
    selection.current = {
      from: editor.state.selection.from,
      to: editor.state.selection.to,
    };
    setTitle(
      editor.state.doc.textBetween(
        selection.current.from,
        selection.current.to,
      ),
    );
    setHref((editor.getAttributes('link').href as string) ?? '');
    setToolbar(true);
    setLink(true);
  }
  function applyLink() {
    if (!editor || !title.trim() || !journalHrefSchema.safeParse(href).success)
      return;
    editor
      .chain()
      .focus()
      .insertContentAt(selection.current, {
        type: 'text',
        text: title,
        marks: [
          ...(editor.isActive('bold') ? [{ type: 'bold' }] : []),
          { type: 'link', attrs: { href } },
        ],
      })
      .run();
    setLink(false);
  }
  const unavailable = controller.uploadsDisabled
    ? 'В демо загрузка файлов отключена'
    : !draft.taskId
      ? 'Сначала выберите задачу'
      : null;
  return (
    <DraftContext value={{ draft, controller }}>
      <div
        className="journal-rich-editor"
        onPointerDownCapture={(event) => {
          if ((event.target as Element).closest('[contenteditable]'))
            setSelectionToolsDismissed(false);
        }}
        onKeyDownCapture={(event) => {
          if (
            event.key !== 'Escape' &&
            (event.target as Element).closest('[contenteditable]')
          )
            setSelectionToolsDismissed(false);
        }}
        onKeyDown={(event) => {
          if (
            (event.ctrlKey || event.metaKey) &&
            ['z', 'y'].includes(event.key.toLowerCase())
          ) {
            event.stopPropagation();
            if (
              event.target !== editor?.view.dom &&
              !(event.target as Element).closest('[contenteditable]')
            ) {
              event.preventDefault();
              if (event.shiftKey || event.key.toLowerCase() === 'y')
                editor?.commands.redo();
              else editor?.commands.undo();
            }
          }
          if (event.key === 'Tab') event.stopPropagation();
          if (
            event.key === 'Escape' &&
            (link || toolbar || (selected && !selectionToolsDismissed))
          ) {
            event.preventDefault();
            event.stopPropagation();
            if (link) setLink(false);
            else {
              setToolbar(false);
              setSelectionToolsDismissed(true);
            }
            editor?.commands.focus(undefined, { scrollIntoView: false });
          }
        }}
      >
        <EditorContent editor={editor} />
        <div className="journal-format-controls">
          <button
            type="button"
            disabled={disabled}
            aria-expanded={toolbar}
            onMouseDown={() => {
              if (editor)
                selection.current = {
                  from: editor.state.selection.from,
                  to: editor.state.selection.to,
                };
            }}
            onClick={() => {
              setToolbar(!toolbar);
              setSelectionToolsDismissed(toolbar);
            }}
          >
            Форматирование
          </button>
          <button
            type="button"
            disabled={disabled || !!unavailable}
            title={unavailable ?? 'Прикрепить файл'}
            onClick={() => picker.current?.click()}
          >
            Прикрепить файл
          </button>
          <input
            ref={picker}
            type="file"
            multiple
            hidden
            aria-label="Выбрать вложения"
            disabled={disabled || !!unavailable}
            onChange={(event) => {
              addFiles(Array.from(event.target.files ?? []));
              event.target.value = '';
            }}
          />
        </div>
        {(toolbar || (selected && !selectionToolsDismissed)) && (
          <div
            className={`journal-format-toolbar${selected && !toolbar ? ' journal-format-toolbar--floating' : ''}`}
            role="toolbar"
            aria-label="Форматирование записи"
          >
            {[
              ['Жирный', () => editor?.chain().focus().toggleBold().run()],
              [
                'Маркированный список',
                () => editor?.chain().focus().toggleBulletList().run(),
              ],
              [
                'Нумерованный список',
                () => editor?.chain().focus().toggleOrderedList().run(),
              ],
              ['Ссылка', openLink],
            ].map(([label, action]) => (
              <button
                key={label as string}
                type="button"
                disabled={disabled}
                onMouseDown={(event) => event.preventDefault()}
                onClick={action as () => void}
              >
                {label as string}
              </button>
            ))}
          </div>
        )}
        {link && (
          <div
            role="dialog"
            aria-label="Редактировать ссылку"
            className="journal-link-popup"
            onKeyDown={(event) => {
              if (
                event.key === 'Enter' &&
                !event.nativeEvent.isComposing &&
                event.target instanceof HTMLInputElement
              ) {
                event.preventDefault();
                event.stopPropagation();
                applyLink();
              }
            }}
          >
            <label>
              Название ссылки
              <input
                autoFocus
                value={title}
                onChange={(event) => setTitle(event.target.value)}
              />
            </label>
            <label>
              Адрес ссылки
              <input
                value={href}
                onChange={(event) => setHref(event.target.value)}
              />
            </label>
            <button
              type="button"
              disabled={
                !title.trim() || !journalHrefSchema.safeParse(href).success
              }
              onClick={applyLink}
            >
              Применить ссылку
            </button>
            <button
              type="button"
              onClick={() => {
                setLink(false);
                editor?.commands.focus(undefined, { scrollIntoView: false });
              }}
            >
              Отмена
            </button>
          </div>
        )}
        <small className="journal-upload-limits">
          Картинка PNG/JPEG/WebP до 10 MiB; файл до 25 MiB; до 10 файлов / 50
          MiB. Изображения сохраняются в WebP без метаданных. Другие форматы —
          файлы для скачивания.
        </small>
        {unavailable && <p role="status">{unavailable}</p>}
        {message && <p role="status">{message}</p>}
      </div>
    </DraftContext>
  );
}
