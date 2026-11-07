import { useEffect, useId, useRef, useState, type ReactNode } from 'react';
import { ControlIcon } from './ControlIcon.js';
import { draftTaskId } from './quick-add-view.js';
import type { Dependency, ProjectTree, Task } from '../shared/contracts.js';
import { treeDateLabel, computedDateLabel } from './gantt-view.js';
import { treeRows } from './tree-view.js';
import { actionableDiagnostics } from './schedule-diagnostics.js';
import { diagnosticLabels, statusLabels, strings } from './strings.js';
export type TreeAction =
  'sibling' | 'child' | 'delete' | 'up' | 'down' | 'in' | 'out';
interface Props {
  tasks: Task[];
  selectedId: string | null;
  collapsed: ReadonlySet<string>;
  onToggle: (id: string) => void;
  onSelect: (task: Task) => boolean | void;
  onAction: (action: TreeAction, task: Task) => boolean | void;
  onJournal?:
    ((task: Task, trigger: HTMLElement) => boolean | void) | undefined;
  dependencies?: readonly Dependency[];
  onDependencies?: ((task: Task, trigger: HTMLElement) => void) | undefined;
  dependencyBlockedReason?: string | undefined;
  rootId?: string;
  label?: string;
  rows?: ReturnType<typeof treeRows>;
  schedule?: ProjectTree['schedule'];
  matchIds?: ReadonlySet<string>;
  quickInputId?: string;
  draftInput?: ReactNode;
  disabled?: boolean;
}
export function dependencySlotWidth(
  dependencies: readonly Dependency[],
): string {
  const counts = new Map<string, number>();
  for (const edge of dependencies) {
    counts.set(edge.predecessorId, (counts.get(edge.predecessorId) ?? 0) + 1);
    counts.set(edge.successorId, (counts.get(edge.successorId) ?? 0) + 1);
  }
  const maximum = Math.max(0, ...counts.values());
  return maximum ? `calc(28px + 4px + ${String(maximum).length}ch)` : '28px';
}
export function focusTaskRow(id: string, scope: ParentNode = document) {
  const row = scope.querySelector<HTMLElement>(`[data-task-id="${id}"]`);
  row?.focus();
  return !!row;
}
export function TaskTree({
  tasks,
  selectedId,
  collapsed,
  onToggle,
  onSelect,
  onAction,
  onJournal,
  dependencies = [],
  onDependencies,
  dependencyBlockedReason,
  rootId,
  label = strings.tasks,
  rows: suppliedRows,
  schedule,
  matchIds,
  quickInputId = 'quick-task',
  draftInput,
  disabled = false,
}: Props) {
  const descriptionPrefix = useId();
  const [rowFocused, setRowFocused] = useState(false);
  const summaryIds = new Set(tasks.map((task) => task.parentId));
  const global = new Set(
    schedule?.analysisStatus === 'ready' ? schedule.criticalTaskIds : [],
  );
  const partial =
    schedule?.analysisStatus === 'incomplete' ? schedule.partialAnalysis : null;
  const partialTasks = new Set(partial?.partialCriticalTaskIds ?? []);
  const partialSummaries = new Set(partial?.partialCriticalSummaryIds ?? []);
  const errors = actionableDiagnostics(schedule?.diagnostics ?? []);
  const rows = suppliedRows ?? treeRows(tasks, collapsed, rootId);
  const navigableRows = rows.filter((row) => row.task.id !== draftTaskId);
  const [focusedId, setFocusedId] = useState<string | null>(selectedId);
  const refs = useRef(new Map<string, HTMLDivElement>());
  const focusId = rows.some((row) => row.task.id === focusedId)
    ? focusedId
    : navigableRows[0]?.task.id;
  const previousFocus = useRef<string | null>(null);
  const ownsFocus = useRef(false);
  useEffect(() => {
    if (disabled) return;
    // Restore a nearby row when the focused branch is removed by a command.
    if (
      ownsFocus.current &&
      previousFocus.current &&
      !rows.some((row) => row.task.id === previousFocus.current) &&
      document.activeElement === document.body
    ) {
      if (focusId) refs.current.get(focusId)?.focus();
      else document.getElementById(quickInputId)?.focus();
    }
    previousFocus.current = focusedId;
  }, [tasks, focusedId, focusId, rows, quickInputId, disabled]);
  function focus(id: string | undefined) {
    if (id) {
      setFocusedId(id);
      refs.current.get(id)?.focus();
    }
  }
  return (
    <div
      role="tree"
      aria-label={label}
      className="task-tree"
      onFocus={(event) => {
        setRowFocused(event.target.matches('[role="treeitem"]'));
        ownsFocus.current = true;
      }}
      onBlur={(event) => {
        setRowFocused(false);
        if (event.relatedTarget)
          ownsFocus.current = event.currentTarget.contains(
            event.relatedTarget as Node,
          );
      }}
    >
      {rootId && rowFocused && (
        <p className="tree-keyboard-hint">{strings.treeKeyboardHint}</p>
      )}
      {rows.map(({ task, depth, hasChildren }, index) => {
        if (task.id === draftTaskId)
          return (
            <div
              key={task.id}
              className="quick-draft-row"
              style={{ paddingInlineStart: `${Math.min(depth, 5) * 12}px` }}
            >
              {draftInput}
            </div>
          );
        const count = dependencies.filter(
          (edge) =>
            edge.predecessorId === task.id || edge.successorId === task.id,
        ).length;
        const dependencyReason = summaryIds.has(task.id)
          ? strings.chooseLeaf
          : dependencyBlockedReason;
        const dependencyDescription = `${descriptionPrefix}-${task.id}`;
        const taskErrors = errors.filter((item) =>
          item.taskIds.includes(task.id),
        );
        const errorLabel = taskErrors.length
          ? `${strings.infeasible}: ${taskErrors.map((item) => diagnosticLabels[item.code]).join(' ')}`
          : '';
        const contextOnly = matchIds !== undefined && !matchIds.has(task.id);
        const containsCritical =
          schedule?.analysisStatus === 'ready' &&
          schedule.summaries[task.id]?.containsCritical === true;
        const partialCritical =
          partialTasks.has(task.id) || partialSummaries.has(task.id);
        const indicator = global.has(task.id)
          ? strings.critical
          : containsCritical
            ? strings.containsCritical
            : partialSummaries.has(task.id)
              ? strings.partialContainsCritical
              : partialTasks.has(task.id)
                ? strings.partialCritical
                : '';
        return (
          <div
            key={task.id}
            ref={(node) => {
              if (node) refs.current.set(task.id, node);
              else refs.current.delete(task.id);
            }}
            role="treeitem"
            aria-label={`${task.title}, ${statusLabels[task.status]}${computedDateLabel(task, schedule) ? `, ${computedDateLabel(task, schedule)}` : ''}`}
            aria-level={depth + 1}
            aria-description={
              [
                contextOnly ? strings.parentContext : '',
                errorLabel,
                strings.treeKeyboardHint,
              ]
                .filter(Boolean)
                .join('. ') || undefined
            }
            aria-expanded={hasChildren ? !collapsed.has(task.id) : undefined}
            aria-selected={selectedId === task.id}
            tabIndex={focusId === task.id ? 0 : -1}
            data-task-id={task.id}
            className={`task-row${selectedId === task.id ? ' selected' : ''}${summaryIds.has(task.id) ? ' summary' : ''}`}
            style={{ paddingInlineStart: `${16 + depth * 22}px` }}
            onFocus={() => setFocusedId(task.id)}
            onClick={() => onSelect(task)}
            onKeyDown={(event) => {
              if (event.target !== event.currentTarget) return;
              if (
                event.altKey &&
                ['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(
                  event.key,
                )
              ) {
                event.preventDefault();
                onAction(
                  (
                    {
                      ArrowUp: 'up',
                      ArrowDown: 'down',
                      ArrowLeft: 'out',
                      ArrowRight: 'in',
                    } as const
                  )[event.key as 'ArrowUp'],
                  task,
                );
                return;
              }
              if (event.key === 'ArrowDown') {
                event.preventDefault();
                focus(
                  rows
                    .slice(index + 1)
                    .find((row) => row.task.id !== draftTaskId)?.task.id,
                );
              }
              if (event.key === 'ArrowUp') {
                event.preventDefault();
                focus(
                  rows
                    .slice(0, index)
                    .findLast((row) => row.task.id !== draftTaskId)?.task.id,
                );
              }
              if (event.key === 'Home') {
                event.preventDefault();
                focus(navigableRows[0]?.task.id);
              }
              if (event.key === 'End') {
                event.preventDefault();
                focus(navigableRows.at(-1)?.task.id);
              }
              if (event.key === 'ArrowRight') {
                event.preventDefault();
                if (hasChildren && collapsed.has(task.id)) onToggle(task.id);
                else if (hasChildren)
                  focus(
                    rows
                      .slice(index + 1)
                      .find((row) => row.task.id !== draftTaskId)?.task.id,
                  );
              }
              if (event.key === 'ArrowLeft') {
                event.preventDefault();
                if (hasChildren && !collapsed.has(task.id)) onToggle(task.id);
                else focus(task.parentId ?? undefined);
              }
              if (event.key === 'Enter') {
                event.preventDefault();
                if (event.shiftKey) onAction('child', task);
                else onSelect(task);
              }
              if (event.key === 'Insert') {
                event.preventDefault();
                onAction(event.shiftKey ? 'child' : 'sibling', task);
              }
              if (event.key === 'Delete') {
                event.preventDefault();
                onAction('delete', task);
              }
            }}
          >
            {hasChildren ? (
              <button
                type="button"
                tabIndex={-1}
                className="disclosure"
                aria-label={`${collapsed.has(task.id) ? strings.expand : strings.collapse} ${task.title}`}
                onClick={(event) => {
                  event.stopPropagation();
                  onToggle(task.id);
                  refs.current.get(task.id)?.focus();
                }}
              >
                {collapsed.has(task.id) ? '▸' : '▾'}
              </button>
            ) : (
              <span className="disclosure" />
            )}
            <span className={`status-dot ${task.status}`} aria-hidden="true">
              {task.status === 'done' ? '✓' : ''}
            </span>
            <span className="task-title" title={task.title}>
              {task.title}
            </span>
            {contextOnly && (
              <span
                className="filter-context-label"
                title={strings.parentContext}
              >
                {strings.context}
              </span>
            )}
            {errorLabel && (
              <span
                role="img"
                className="schedule-error-indicator"
                title={errorLabel}
                aria-label={errorLabel}
              >
                !
              </span>
            )}
            {indicator && (
              <span
                className={
                  partialCritical
                    ? 'partial-critical-indicator'
                    : 'critical-indicator'
                }
                title={indicator}
                aria-label={indicator}
              >
                ◆
              </span>
            )}
            <span
              className="task-date"
              title={computedDateLabel(task, schedule) || strings.noDate}
            >
              {treeDateLabel(task, schedule) || strings.noDate}
            </span>
            {/* The sticky chain reserves its compact slot; secondary actions overlay the date. */}
            <span
              className="task-row-actions"
              onClick={(event) => event.stopPropagation()}
              onPointerDown={(event) => event.stopPropagation()}
              onKeyDown={(event) => event.stopPropagation()}
            >
              <span className="task-row-actions-secondary">
                <button
                  type="button"
                  aria-label={`${strings.addChild}: ${task.title}`}
                  title={strings.addChildHint}
                  disabled={disabled}
                  onClick={() => onAction('child', task)}
                >
                  <ControlIcon name="subtask" />
                </button>
                {onJournal && (
                  <button
                    type="button"
                    aria-label={`${strings.addJournalEntry}: ${task.title}`}
                    title={strings.addJournalEntry}
                    onClick={(event) => onJournal(task, event.currentTarget)}
                  >
                    <ControlIcon name="note" />
                  </button>
                )}
              </span>
              {onDependencies && (
                <>
                  <button
                    type="button"
                    tabIndex={0}
                    className="task-row-dependency"
                    data-count={count}
                    aria-label={`${strings.dependencies}: ${task.title}`}
                    aria-describedby={dependencyDescription}
                    disabled={disabled || !!dependencyReason}
                    onClick={(event) =>
                      onDependencies(task, event.currentTarget)
                    }
                  >
                    <ControlIcon name="chain" />
                    {count > 0 && <span>{count}</span>}
                  </button>
                  <span id={dependencyDescription} className="sr-only">
                    {`Связей: ${count}${dependencyReason ? `. ${dependencyReason}` : ''}`}
                  </span>
                </>
              )}
            </span>
          </div>
        );
      })}
    </div>
  );
}
