import { useLayoutEffect, useRef, useState } from 'react';
import { strings } from './strings.js';

export function TaskDescription({
  value,
  changed,
  editing,
  disabled,
  cancelDisabled,
  saving,
  error,
  onChange,
  onEdit,
  onCancel,
  onSave,
}: {
  value: string;
  changed: boolean;
  editing: boolean;
  disabled: boolean;
  cancelDisabled: boolean;
  saving: boolean;
  error: string | null;
  onChange: (value: string) => void;
  onEdit: () => void;
  onCancel: () => void;
  onSave: () => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const [overflow, setOverflow] = useState(false);
  const text = useRef<HTMLParagraphElement>(null);
  const editor = useRef<HTMLTextAreaElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const wasEditing = useRef(false);
  useLayoutEffect(() => {
    if (editing) editor.current?.focus({ preventScroll: true });
    else if (wasEditing.current && document.activeElement === document.body)
      trigger.current?.focus({ preventScroll: true });
    wasEditing.current = editing;
  }, [editing]);
  useLayoutEffect(() => {
    const node = editor.current;
    if (!node) return;
    const fit = () => {
      node.style.height = 'auto';
      node.style.height = `${Math.max(100, node.scrollHeight + node.offsetHeight - node.clientHeight)}px`;
    };
    fit();
    let width = node.clientWidth;
    const resize = () => {
      if (node.clientWidth === width) return;
      width = node.clientWidth;
      fit();
    };
    const sizes =
      typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(resize);
    sizes?.observe(node);
    window.addEventListener('resize', resize);
    return () => {
      sizes?.disconnect();
      window.removeEventListener('resize', resize);
    };
  }, [value, editing]);
  useLayoutEffect(() => {
    const node = text.current;
    if (!node) return;
    let active = true;
    const measure = () => {
      if (!active || !node.clientWidth) return;
      const line = parseFloat(getComputedStyle(node).lineHeight);
      setOverflow(node.scrollHeight > Math.ceil(line * 4) + 1);
    };
    measure();
    const sizes =
      typeof ResizeObserver === 'undefined'
        ? null
        : new ResizeObserver(measure);
    sizes?.observe(node);
    window.addEventListener('resize', measure);
    void document.fonts?.ready.then(measure);
    return () => {
      active = false;
      sizes?.disconnect();
      window.removeEventListener('resize', measure);
    };
  }, [value, editing, expanded]);
  function cancel() {
    onCancel();
    requestAnimationFrame(() =>
      trigger.current?.focus({ preventScroll: true }),
    );
  }
  return (
    <section className="panel-description-section">
      <div className="panel-section-heading">
        <h3 id="panel-description-heading">{strings.description}</h3>
        {!editing && value && (
          <button
            ref={value ? trigger : undefined}
            type="button"
            className="panel-edit-description"
            aria-label={strings.editDescription}
            title={strings.editDescription}
            disabled={disabled}
            onClick={onEdit}
          >
            <svg
              width="16"
              height="16"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.7"
              aria-hidden="true"
            >
              <path d="m15 4 5 5M4 20l5-1L21 7a2 2 0 0 0-5-5L4 14z" />
            </svg>
          </button>
        )}
      </div>
      {editing ? (
        <>
          <textarea
            ref={editor}
            aria-label={strings.description}
            aria-describedby={
              error ? 'panel-description-error' : 'panel-description-help'
            }
            disabled={disabled}
            value={value}
            maxLength={10000}
            rows={4}
            onChange={(event) => onChange(event.target.value)}
            onKeyDown={(event) => {
              if (event.nativeEvent.isComposing) return;
              if (event.key === 'Escape') {
                event.preventDefault();
                event.stopPropagation();
                if (!cancelDisabled) cancel();
              } else if (
                event.key === 'Enter' &&
                (event.ctrlKey || event.metaKey)
              ) {
                event.preventDefault();
                event.stopPropagation();
                if (!disabled) onSave();
              }
            }}
          />
          {error && (
            <p
              id="panel-description-error"
              className="error-message"
              role="alert"
            >
              {error}
            </p>
          )}
          <div className="panel-description-actions">
            <span id="panel-description-help" className="field-hint">
              Esc — отмена · Ctrl/Cmd+Enter — сохранить
            </span>
            <button type="button" disabled={cancelDisabled} onClick={cancel}>
              {strings.cancel}
            </button>
            <button
              type="button"
              className="primary"
              disabled={disabled || !changed}
              onClick={onSave}
            >
              {saving ? strings.saving : strings.save}
            </button>
          </div>
        </>
      ) : value ? (
        <>
          <p
            ref={text}
            className={`panel-description${expanded ? '' : ' is-collapsed'}`}
          >
            {value}
          </p>
          {overflow && (
            <button
              type="button"
              className="quiet panel-description-expand"
              aria-expanded={expanded}
              onClick={() => setExpanded((v) => !v)}
            >
              {expanded
                ? strings.collapseDescription
                : strings.expandDescription}
            </button>
          )}
        </>
      ) : (
        <button
          ref={trigger}
          type="button"
          aria-label={strings.addDescription}
          className="quiet panel-add-description"
          disabled={disabled}
          onClick={onEdit}
        >
          {strings.addDescription}…
        </button>
      )}
    </section>
  );
}
