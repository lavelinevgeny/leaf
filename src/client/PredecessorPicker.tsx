import {
  useLayoutEffect,
  useId,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import type { ProjectTree } from '../shared/contracts.js';
import {
  canonicalPredecessorIds,
  predecessorCandidates,
} from './predecessor-view.js';
import { strings } from './strings.js';
export interface PredecessorPickerProps {
  tree: ProjectTree | null;
  successorId: string | null;
  selectedIds: readonly string[];
  disabled: boolean;
  error?: string;
  onAdd: (id: string) => void;
  onRemove: (id: string) => void;
  onClose: () => void;
}
export function PredecessorPicker({
  tree,
  successorId,
  selectedIds,
  disabled,
  error,
  onAdd,
  onRemove,
  onClose,
}: PredecessorPickerProps): ReactNode {
  const [query, setQuery] = useState('');
  const [active, setActive] = useState(-1);
  const popup = useRef<HTMLDivElement>(null);
  const search = useRef<HTMLInputElement>(null);
  const results = useRef<HTMLDivElement>(null);
  const id = useId();
  function keepActiveVisible() {
    const list = results.current;
    const option = list?.querySelector<HTMLElement>('[aria-selected="true"]');
    if (!list || !option) return;
    const optionBounds = option.getBoundingClientRect();
    const top = list.getBoundingClientRect().top + list.clientTop;
    const bottom = top + list.clientHeight;
    if (optionBounds.top < top) list.scrollTop += optionBounds.top - top;
    else if (optionBounds.bottom > bottom)
      list.scrollTop += optionBounds.bottom - bottom;
  }
  useLayoutEffect(() => {
    const node = popup.current,
      anchor = document.activeElement;
    if (!node) return;
    const position = () => {
      const rect = anchor?.getBoundingClientRect();
      const width = Math.min(320, window.innerWidth - 24);
      const widthValue = `${width}px`;
      if (node.style.width !== widthValue) node.style.width = widthValue;
      const leftValue = `${Math.max(12, Math.min(rect?.left ?? 12, window.innerWidth - width - 12))}px`;
      const topValue = `${Math.max(12, Math.min((rect?.bottom ?? 12) + 8, window.innerHeight - node.offsetHeight - 12))}px`;
      // Setting the same geometry does not trigger another resize delivery.
      if (node.style.left !== leftValue) node.style.left = leftValue;
      if (node.style.top !== topValue) node.style.top = topValue;
    };
    node.showPopover?.();
    position();
    search.current?.focus();
    const observer =
      typeof ResizeObserver === 'function'
        ? new ResizeObserver(() => {
            position();
            keepActiveVisible();
          })
        : null;
    observer?.observe(node);
    window.addEventListener('resize', position);
    window.addEventListener('scroll', position, true);
    return () => {
      observer?.disconnect();
      window.removeEventListener('resize', position);
      window.removeEventListener('scroll', position, true);
    };
  }, []);
  const candidates = tree
    ? predecessorCandidates(tree, successorId, selectedIds, query)
    : [];
  const index = Math.min(active, candidates.length - 1);
  const activeId = candidates[index]?.task.id;
  useLayoutEffect(keepActiveVisible, [activeId, candidates.length]);
  return (
    <div
      ref={popup}
      popover={
        typeof HTMLElement.prototype.showPopover === 'function'
          ? 'manual'
          : undefined
      }
      className="predecessor-picker"
      role="dialog"
      aria-label={strings.afterFinish}
      onKeyDown={(event) => {
        if (event.key === 'Escape') {
          event.preventDefault();
          event.stopPropagation();
          onClose();
        }
        // Enter inside the selector never submits the enclosing creation/details form.
        if (event.key === 'Enter') event.stopPropagation();
      }}
    >
      <div className="predecessor-heading">
        <strong>{strings.afterFinish}</strong>
        <button
          type="button"
          aria-label={strings.closePredecessors}
          onClick={onClose}
        >
          ×
        </button>
      </div>
      <div className="predecessor-chips">
        {canonicalPredecessorIds(selectedIds).map((selected) => {
          const title =
            tree?.tasks.find((task) => task.id === selected)?.title ??
            strings.removedPredecessor;
          return (
            <span className="predecessor-chip" key={selected}>
              {title}
              <button
                type="button"
                aria-label={`${strings.removePredecessor}: ${title}`}
                disabled={disabled}
                onClick={() => onRemove(selected)}
              >
                ×
              </button>
            </span>
          );
        })}
      </div>
      <input
        ref={search}
        type="search"
        role="searchbox"
        aria-label={strings.searchPredecessor}
        aria-controls={id}
        aria-activedescendant={index >= 0 ? `${id}-${index}` : undefined}
        value={query}
        onChange={(event) => {
          setQuery(event.target.value);
          setActive(-1);
        }}
        onKeyDown={(event) => {
          if (['ArrowDown', 'ArrowUp'].includes(event.key)) {
            event.preventDefault();
            setActive((previous) => {
              const effective = Math.min(previous, candidates.length - 1);
              return candidates.length
                ? event.key === 'ArrowDown'
                  ? (effective + 1) % candidates.length
                  : effective <= 0
                    ? candidates.length - 1
                    : effective - 1
                : -1;
            });
          }
          if (event.key === 'Enter') {
            event.preventDefault();
            event.stopPropagation();
            const candidate = candidates[Math.max(0, index)];
            if (!disabled && candidate) onAdd(candidate.task.id);
          }
        }}
      />
      {error && (
        <p role="alert" className="field-error">
          {error}
        </p>
      )}
      {!tree ? (
        <p role="status">{strings.loading}</p>
      ) : !candidates.length ? (
        <p role="status">
          {query.trim() ? strings.noPredecessorResults : strings.noOtherLeaves}
        </p>
      ) : (
        <div
          id={id}
          ref={results}
          role="listbox"
          aria-label={strings.predecessors}
          className="predecessor-results"
        >
          {candidates.map((candidate, candidateIndex) => (
            <button
              type="button"
              role="option"
              id={`${id}-${candidateIndex}`}
              aria-selected={candidateIndex === index}
              disabled={disabled}
              key={candidate.task.id}
              onClick={() => onAdd(candidate.task.id)}
            >
              <span>{candidate.task.title}</span>
              {candidate.path && <small>{candidate.path}</small>}
              {candidate.incomplete && (
                <small>{strings.incompletePredecessorHint}</small>
              )}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
