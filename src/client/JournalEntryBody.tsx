import { useId, useLayoutEffect, useRef, useState } from 'react';

function previewBody(body: string): string {
  const lines = body.split(/\r?\n/);
  const endings = body.match(/\r?\n/g) ?? [];
  const kept: number[] = [];
  for (let index = 0; index < lines.length; index++) {
    if (/^[ \t]*$/.test(lines[index]!)) {
      if (kept.length && !/^[ \t]*$/.test(lines[kept.at(-1)!]!))
        kept.push(index);
    } else kept.push(index);
  }
  if (kept.length && /^[ \t]*$/.test(lines[kept.at(-1)!]!)) kept.pop();
  return kept
    .map(
      (index, position) =>
        (/^[ \t]*$/.test(lines[index]!) ? '' : lines[index]!) +
        (position < kept.length - 1 ? (endings[index] ?? '\n') : ''),
    )
    .join('');
}

export function JournalEntryBody({
  body,
  expanded: controlledExpanded,
  onExpandedChange,
  visible = true,
}: {
  body: string;
  expanded?: boolean;
  onExpandedChange?: (expanded: boolean) => void;
  visible?: boolean;
}) {
  const id = useId();
  const text = useRef<HTMLParagraphElement>(null);
  const fontProbe = useRef<HTMLSpanElement>(null);
  const [localExpanded, setLocalExpanded] = useState(false);
  const expanded = controlledExpanded ?? localExpanded;
  const [overflow, setOverflow] = useState(false);
  const preview = previewBody(body);
  useLayoutEffect(() => {
    const node = text.current;
    // Reveal must measure in this layout commit; waiting for ResizeObserver
    // would let the feed restore its anchor against stale disclosure geometry.
    if (!node || expanded || !visible) return;
    let active = true;
    const measure = () => {
      if (active && node.clientHeight > 0)
        setOverflow(node.scrollHeight > node.clientHeight + 1);
    };
    measure();
    const observer =
      typeof ResizeObserver === 'undefined'
        ? null
        : new ResizeObserver(measure);
    observer?.observe(node);
    if (fontProbe.current) observer?.observe(fontProbe.current);
    void document.fonts?.ready.then(measure);
    document.fonts?.addEventListener('loadingdone', measure);
    document.fonts?.addEventListener('loadingerror', measure);
    window.addEventListener('resize', measure);
    return () => {
      active = false;
      observer?.disconnect();
      document.fonts?.removeEventListener('loadingdone', measure);
      document.fonts?.removeEventListener('loadingerror', measure);
      window.removeEventListener('resize', measure);
    };
  }, [preview, expanded, visible]);
  return (
    <>
      <p
        ref={text}
        id={id}
        className={`journal-body${expanded ? '' : ' journal-body--preview'}`}
      >
        {expanded ? body : preview}
        <span
          ref={fontProbe}
          className="journal-body-font-probe"
          aria-hidden="true"
        />
      </p>
      {(expanded || overflow || preview !== body) && (
        <button
          type="button"
          className="journal-body-toggle"
          aria-expanded={expanded}
          aria-controls={id}
          onClick={() => {
            setLocalExpanded(!expanded);
            onExpandedChange?.(!expanded);
          }}
        >
          {expanded ? 'Свернуть' : 'Показать полностью'}
        </button>
      )}
    </>
  );
}
