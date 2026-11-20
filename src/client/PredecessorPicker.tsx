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
  dependencyCandidates,
  dependencySelectionIssues,
  type DependencyDirection,
  type DependencyProposal,
} from './predecessor-view.js';
import { strings } from './strings.js';
export interface PredecessorPickerProps {
  tree: ProjectTree | null;
  proposal: DependencyProposal;
  direction: 'selectable' | DependencyDirection;
  disabled: boolean;
  blockedReason?: string;
  error?: string;
  loadError?: string;
  onReload?: () => void;
  onAdd: (direction: DependencyDirection, taskId: string) => void;
  onRemove: (direction: DependencyDirection, taskId: string) => void;
  onClose: () => void;
}
export function PredecessorPicker(props: PredecessorPickerProps): ReactNode {
  const {
    tree,
    proposal,
    disabled,
    error,
    loadError,
    blockedReason,
    onReload,
    onAdd,
    onRemove,
    onClose,
  } = props;
  const [selectedDirection, setSelectedDirection] =
    useState<DependencyDirection>('predecessor');
  const direction =
    props.direction === 'selectable' ? selectedDirection : props.direction;
  const successor = direction === 'successor';
  const heading =
    props.direction === 'selectable'
      ? strings.dependencies
      : successor
        ? strings.addSuccessor
        : strings.addPredecessor;
  const blocked = disabled || !!blockedReason || !tree || !!loadError;
  const composing = useRef(false);
  const [query, setQuery] = useState('');
  const [active, setActive] = useState(-1);
  const popup = useRef<HTMLDivElement>(null);
  const search = useRef<HTMLInputElement>(null);
  const results = useRef<HTMLDivElement>(null);
  const id = useId();
  function updateFromControl(trigger: HTMLElement, update: () => void) {
    if (blocked) return;
    const ownedFocus = document.activeElement === trigger;
    update();
    // A removed or disabled choice must not lose keyboard Escape. This move
    // is synchronous and respects focus deliberately moved by the owner.
    if (
      ownedFocus &&
      document.activeElement === trigger &&
      search.current?.isConnected
    )
      search.current.focus();
  }
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
  const candidates =
    tree && !loadError
      ? dependencyCandidates(tree, proposal, direction, query)
      : [];
  const issues = tree ? dependencySelectionIssues(tree, proposal) : [];
  const groups: DependencyDirection[] =
    props.direction === 'selectable'
      ? ['predecessor', 'successor']
      : [direction];
  const currentTitle = proposal.task.title.trim() || strings.newTask;
  const byId = new Map(tree?.tasks.map((task) => [task.id, task]) ?? []);
  function ancestorPath(parentId: string | null, currentId: string): string {
    const ancestors: string[] = [];
    const visited = new Set([currentId]);
    let parent = parentId ? byId.get(parentId) : undefined;
    while (parent && !visited.has(parent.id)) {
      visited.add(parent.id);
      ancestors.unshift(parent.title);
      parent = parent.parentId ? byId.get(parent.parentId) : undefined;
    }
    return ancestors.join(' / ');
  }
  const currentPath = ancestorPath(proposal.task.parentId, proposal.task.id);
  const index = Math.min(active, candidates.length - 1);
  const activeId = candidates[index]?.task.id;
  const preview = candidates[Math.max(0, index)];
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
      aria-label={heading}
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
        <strong>{heading}</strong>
        <button
          type="button"
          aria-label={
            successor ? strings.closeSuccessors : strings.closePredecessors
          }
          onClick={onClose}
        >
          ×
        </button>
      </div>
      <div className="dependency-picker-context">
        <strong>{currentTitle}</strong>
        {currentPath && <small>{currentPath}</small>}
      </div>
      {props.direction === 'selectable' && (
        <div
          className="dependency-direction"
          role="group"
          aria-label={strings.taskExecutes}
        >
          <span>{strings.taskExecutes}</span>
          {(['predecessor', 'successor'] as const).map((value) => (
            <button
              type="button"
              key={value}
              disabled={blocked}
              aria-pressed={direction === value}
              onClick={() => {
                if (!blocked) {
                  setSelectedDirection(value);
                  setActive(-1);
                }
              }}
            >
              {value === 'predecessor'
                ? strings.dependencyAfter
                : strings.dependencyBefore}
            </button>
          ))}
        </div>
      )}
      <div className="dependency-picker-groups">
        {groups.map((group) => (
          <section
            key={group}
            aria-label={
              group === 'predecessor'
                ? strings.predecessors
                : strings.successors
            }
          >
            {props.direction === 'selectable' && (
              <strong className="dependency-group-label">
                {group === 'predecessor'
                  ? strings.dependencyAfter
                  : strings.dependencyBefore}
              </strong>
            )}
            <div className="predecessor-chips">
              {canonicalPredecessorIds(
                group === 'predecessor'
                  ? proposal.predecessorIds
                  : proposal.successorIds,
              ).map((selected) => {
                const selectedTask = byId.get(selected);
                const title = selectedTask?.title ?? strings.removedPredecessor;
                const path = selectedTask
                  ? ancestorPath(selectedTask.parentId, selectedTask.id)
                  : '';
                const fullTitle = [path, title].filter(Boolean).join(' / ');
                const duplicateTitle =
                  (tree?.tasks.filter((task) => task.title === title).length ??
                    0) > 1;
                const removalTitle =
                  duplicateTitle && path ? `${title} · ${path}` : title;
                const issue = issues.find(
                  (issue) =>
                    issue.direction === group && issue.taskId === selected,
                );
                return (
                  <span className="predecessor-chip" key={selected}>
                    <span
                      title={
                        group === 'predecessor'
                          ? `${fullTitle} → ${currentTitle}`
                          : `${currentTitle} → ${fullTitle}`
                      }
                    >
                      {group === 'predecessor'
                        ? `${title} → ${currentTitle}`
                        : `${currentTitle} → ${title}`}
                      {issue && (
                        <small className="field-error">{issue.reason}</small>
                      )}
                    </span>
                    <button
                      type="button"
                      aria-label={`${group === 'predecessor' ? strings.removePredecessor : strings.removeSuccessor}: ${removalTitle}`}
                      disabled={blocked}
                      onClick={(event) =>
                        updateFromControl(event.currentTarget, () =>
                          onRemove(group, selected),
                        )
                      }
                    >
                      ×
                    </button>
                  </span>
                );
              })}
            </div>
          </section>
        ))}
      </div>
      <input
        ref={search}
        type="search"
        role="searchbox"
        aria-label={
          successor ? strings.searchSuccessor : strings.searchPredecessor
        }
        aria-controls={id}
        aria-activedescendant={index >= 0 ? `${id}-${index}` : undefined}
        value={query}
        onChange={(event) => {
          setQuery(event.target.value);
          setActive(-1);
        }}
        onCompositionStart={() => {
          composing.current = true;
        }}
        onCompositionEnd={() => {
          composing.current = false;
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
            if (
              !composing.current &&
              !event.nativeEvent.isComposing &&
              event.keyCode !== 229 &&
              !blocked &&
              candidate
            )
              onAdd(direction, candidate.task.id);
          }
        }}
      />
      {error && (
        <p role="alert" className="field-error">
          {error}
        </p>
      )}
      {blockedReason && <p className="field-hint">{blockedReason}</p>}
      {loadError ? (
        <div>
          <p role="alert" className="field-error">
            {loadError}
          </p>
          {onReload && (
            <button type="button" disabled={disabled} onClick={onReload}>
              {strings.reload}
            </button>
          )}
        </div>
      ) : !tree ? (
        <p role="status">{strings.loadingTasks}</p>
      ) : !candidates.length ? (
        <p role="status">
          {query.trim() ? strings.noPredecessorResults : strings.noOtherLeaves}
        </p>
      ) : (
        <>
          {preview && (
            <p
              className="dependency-preview"
              aria-label={`${currentTitle} выполняется ${successor ? 'перед' : 'после'} ${preview.task.title}`}
              title={[preview.path, preview.task.title]
                .filter(Boolean)
                .join(' / ')}
            >
              {successor
                ? `${currentTitle} → ${preview.task.title}`
                : `${preview.task.title} → ${currentTitle}`}
            </p>
          )}
          <div
            id={id}
            ref={results}
            role="listbox"
            aria-label={successor ? strings.successors : strings.predecessors}
            className="predecessor-results"
          >
            {candidates.map((candidate, candidateIndex) => (
              <button
                type="button"
                role="option"
                id={`${id}-${candidateIndex}`}
                aria-selected={candidateIndex === index}
                aria-label={[candidate.task.title, candidate.path]
                  .filter(Boolean)
                  .join(' · ')}
                aria-description={
                  candidate.incomplete
                    ? strings.incompletePredecessorHint
                    : undefined
                }
                disabled={blocked}
                key={candidate.task.id}
                title={[candidate.path, candidate.task.title]
                  .filter(Boolean)
                  .join(' / ')}
                onFocus={() => setActive(candidateIndex)}
                onClick={(event) =>
                  updateFromControl(event.currentTarget, () =>
                    onAdd(direction, candidate.task.id),
                  )
                }
              >
                <span>{candidate.task.title}</span>
                {candidate.path && <small>{candidate.path}</small>}
                {candidate.incomplete && (
                  <small>{strings.incompletePredecessorHint}</small>
                )}
              </button>
            ))}
          </div>
        </>
      )}
    </div>
  );
}
