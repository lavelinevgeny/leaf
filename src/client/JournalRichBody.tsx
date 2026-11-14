import {
  Fragment,
  useId,
  useLayoutEffect,
  useRef,
  useState,
  useEffect,
  type ReactNode,
} from 'react';
import type { JournalEntryV2 } from '../shared/journal-contracts-v2.js';
import type { JournalNode } from '../shared/journal-content.js';
import type { JournalMedia } from '../shared/journal-media-contracts.js';
import { JournalEntryBody } from './JournalEntryBody.js';
import { useJournalImage } from './use-journal-image.js';
import type { JournalController } from './journal-state.js';
function ImageViewer({
  src,
  alt,
  onClose,
  returnFocus,
}: {
  src: string;
  alt: string;
  onClose: () => void;
  returnFocus: HTMLElement | null;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const previous = returnFocus;
    dialog.current?.showModal();
    return () => {
      if (
        previous instanceof HTMLElement &&
        previous.isConnected &&
        !previous.closest('[hidden]')
      )
        previous.focus({ preventScroll: true });
    };
  }, []);
  return (
    <dialog
      ref={dialog}
      className="journal-image-viewer"
      aria-label="Просмотр изображения"
      onCancel={(event) => {
        event.preventDefault();
        event.stopPropagation();
        onClose();
      }}
      onKeyDown={(event) => event.stopPropagation()}
    >
      <button type="button" autoFocus onClick={onClose}>
        Закрыть изображение
      </button>
      <img src={src} alt={alt} />
    </dialog>
  );
}
function Media({
  media,
  entry,
  alt = '',
  preview = false,
  readMedia,
}: {
  media: JournalMedia;
  entry: JournalEntryV2;
  alt?: string;
  preview?: boolean;
  readMedia: JournalController['readMedia'];
}) {
  const [error, setError] = useState(false),
    [viewer, setViewer] = useState(false);
  const opener = useRef<HTMLButtonElement>(null);
  const downloadRequest = useRef<AbortController | null>(null);
  const downloadUrls = useRef(new Set<string>());
  useEffect(
    () => () => {
      downloadRequest.current?.abort();
      for (const url of downloadUrls.current) URL.revokeObjectURL(url);
      downloadUrls.current.clear();
    },
    [],
  );
  const image = useJournalImage(
    readMedia,
    entry.projectId,
    entry.taskId,
    media.kind === 'image' ? media.id : null,
  );
  const src = image.src;
  const download = async () => {
    try {
      downloadRequest.current?.abort();
      const request = new AbortController();
      downloadRequest.current = request;
      const blob = await readMedia(
        entry.projectId,
        entry.taskId,
        media.id,
        true,
        request.signal,
      );
      if (!blob || request.signal.aborted) throw Error('download');
      const url = URL.createObjectURL(blob);
      downloadUrls.current.add(url);
      const a = document.createElement('a');
      a.href = url;
      a.download = media.fileName;
      a.click();
      setTimeout(() => {
        URL.revokeObjectURL(url);
        downloadUrls.current.delete(url);
      }, 1000);
      setError(false);
    } catch {
      setError(true);
    }
  };
  return (
    <div className={`journal-media${preview ? ' journal-media--preview' : ''}`}>
      {media.kind === 'image' ? (
        <button
          type="button"
          ref={opener}
          className="journal-image-open"
          aria-label="Открыть изображение"
          disabled={!src}
          onClick={(event) => {
            const button = event.currentTarget;
            button.focus({ preventScroll: true });
            void image.reload().then((ready) => {
              if (
                ready &&
                button.isConnected &&
                !button.closest('[hidden]') &&
                document.activeElement === button
              )
                setViewer(true);
            });
          }}
        >
          <img
            src={src ?? undefined}
            alt={alt || media.fileName}
            width={media.width}
            height={media.height}
            onError={() => setError(true)}
            onLoad={() => setError(false)}
          />
        </button>
      ) : (
        <button
          type="button"
          className="journal-file"
          onClick={() => void download()}
        >
          {media.fileName} · {(media.byteLength / 1024).toFixed(1)} KiB ·
          Скачать
        </button>
      )}
      {(error || image.error) && (
        <p role="alert">
          Вложение недоступно.{' '}
          <button
            type="button"
            onClick={() => {
              if (media.kind === 'file') void download();
              else {
                setError(false);
                void image.reload();
              }
            }}
          >
            Повторить чтение
          </button>
        </p>
      )}
      {viewer && src && (
        <ImageViewer
          src={src}
          alt={alt || media.fileName}
          onClose={() => setViewer(false)}
          returnFocus={opener.current}
        />
      )}
    </div>
  );
}
function textNode(node: JournalNode, key: number): ReactNode {
  switch (node.type) {
    case 'text': {
      let value: ReactNode = node.text;
      for (const mark of node.marks ?? [])
        value =
          mark.type === 'bold' ? (
            <strong>{value}</strong>
          ) : (
            <a href={mark.attrs.href} target="_blank" rel="noopener noreferrer">
              {value}
            </a>
          );
      return <Fragment key={key}>{value}</Fragment>;
    }
    case 'hardBreak':
      return <br key={key} />;
    case 'paragraph':
      return <p key={key}>{node.content?.map(textNode)}</p>;
    case 'bulletList':
      return <ul key={key}>{node.content.map(textNode)}</ul>;
    case 'orderedList':
      return <ol key={key}>{node.content.map(textNode)}</ol>;
    case 'listItem':
      return <li key={key}>{node.content.map(textNode)}</li>;
    default:
      return null;
  }
}
export function JournalRichBody({
  entry,
  expanded: controlled,
  onExpandedChange,
  visible = true,
  readMedia,
}: {
  entry: JournalEntryV2;
  expanded?: boolean;
  onExpandedChange?: (expanded: boolean) => void;
  visible?: boolean;
  readMedia: JournalController['readMedia'];
}) {
  const [local, setLocal] = useState(false);
  const expanded = controlled ?? local;
  const id = useId(),
    measure = useRef<HTMLDivElement>(null);
  const [prefix, setPrefix] = useState({
    count:
      entry.content.format === 'rich-text'
        ? entry.content.doc.content.length
        : 0,
    clamp: 0,
    overflow: false,
  });
  const nodes =
    entry.content.format === 'rich-text' ? entry.content.doc.content : [];
  useLayoutEffect(() => {
    if (!visible || !measure.current) return;
    let active = true;
    const resize = () => {
      if (!active || !measure.current || measure.current.closest('[hidden]'))
        return;
      let lines = 0,
        media = 0,
        count = 0,
        clamp = 0,
        overflow = false;
      const restore = Array.from(measure.current.children).map((child) => {
        const el = child as HTMLElement;
        const was = {
          hidden: el.hidden,
          maxHeight: el.style.maxHeight,
          overflow: el.style.overflow,
        };
        el.hidden = false;
        el.style.maxHeight = '';
        el.style.overflow = '';
        return () => {
          el.hidden = was.hidden;
          el.style.maxHeight = was.maxHeight;
          el.style.overflow = was.overflow;
        };
      });
      const children = Array.from(measure.current.children) as HTMLElement[];
      for (const [index, node] of nodes.entries()) {
        if (node.type === 'journalImage' || node.type === 'journalFile') {
          if (media) {
            overflow = true;
            break;
          }
          media++;
          count++;
          const item = entry.media.find((m) => m.id === node.attrs.mediaId);
          if (
            item?.kind === 'image' &&
            item.height *
              Math.min(
                1,
                (measure.current.clientWidth || item.width) / item.width,
              ) >
              160
          )
            overflow = true;
        } else {
          if (lines >= 4) {
            overflow = true;
            break;
          }
          const child = children[index];
          const lineHeight =
            parseFloat(getComputedStyle(child!).lineHeight) || 20;
          const used = Math.max(
            1,
            Math.ceil((child?.scrollHeight || lineHeight) / lineHeight),
          );
          count++;
          if (used > 4 - lines) {
            clamp = (4 - lines) * lineHeight;
            overflow = true;
            break;
          }
          lines += used;
        }
      }
      restore.forEach((fn) => fn());
      setPrefix({ count, clamp, overflow: overflow || count < nodes.length });
    };
    resize();
    const observer =
      typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(resize);
    observer?.observe(measure.current);
    void document.fonts?.ready.then(resize);
    document.fonts?.addEventListener('loadingdone', resize);
    window.addEventListener('resize', resize);
    return () => {
      active = false;
      observer?.disconnect();
      document.fonts?.removeEventListener('loadingdone', resize);
      window.removeEventListener('resize', resize);
    };
  }, [entry.content, entry.media, visible]);
  if (entry.content.format === 'plain-text')
    return (
      <JournalEntryBody
        body={entry.content.text}
        expanded={expanded}
        {...(onExpandedChange
          ? { onExpandedChange }
          : { onExpandedChange: setLocal })}
        visible={visible}
      />
    );
  const render = (
    node: (typeof nodes)[number],
    index: number,
    preview: boolean,
  ) =>
    node.type === 'journalImage' || node.type === 'journalFile' ? (
      <Media
        key={index}
        media={entry.media.find((m) => m.id === node.attrs.mediaId)!}
        entry={entry}
        alt={node.type === 'journalImage' ? node.attrs.alt : ''}
        preview={preview}
        readMedia={readMedia}
      />
    ) : (
      textNode(node, index)
    );
  return (
    <div className="journal-rich-body">
      <div id={id} ref={measure}>
        {nodes.map((node, index) => (
          <div
            className="journal-rich-block"
            key={index}
            hidden={!expanded && index >= prefix.count}
            style={
              !expanded && prefix.clamp && index === prefix.count - 1
                ? { maxHeight: prefix.clamp, overflow: 'hidden' }
                : undefined
            }
          >
            {render(node, index, !expanded)}
          </div>
        ))}
      </div>
      {(expanded || prefix.overflow) && (
        <button
          type="button"
          className="journal-body-toggle"
          aria-expanded={expanded}
          aria-controls={id}
          onClick={() => {
            setLocal(!expanded);
            onExpandedChange?.(!expanded);
          }}
        >
          {expanded ? 'Свернуть' : 'Показать полностью'}
        </button>
      )}
    </div>
  );
}
