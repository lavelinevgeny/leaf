import { useEffect, useRef, useState } from 'react';
import type { ProjectTree, Task } from '../shared/contracts.js';
import { compactDateLabel, computedDateLabel } from './gantt-view.js';
import { treeRows } from './tree-view.js';
import { statusLabels, strings } from './strings.js';
export type TreeAction =
  'sibling' | 'child' | 'delete' | 'up' | 'down' | 'in' | 'out';
interface Props {
  tasks: Task[];
  selectedId: string | null;
  collapsed: ReadonlySet<string>;
  onToggle: (id: string) => void;
  onSelect: (task: Task) => void;
  onAction: (action: TreeAction, task: Task) => void;
  rootId?: string;
  label?: string;
  rows?: ReturnType<typeof treeRows>;
  schedule?: ProjectTree['schedule'];
}
export function focusTaskRow(id: string) {
  const row = document.querySelector<HTMLElement>(`[data-task-id="${id}"]`);
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
  rootId,
  label = strings.tasks,
  rows: suppliedRows,
  schedule,
}: Props) {
  const rows = suppliedRows ?? treeRows(tasks, collapsed, rootId);
  const [focusedId, setFocusedId] = useState<string | null>(selectedId);
  const refs = useRef(new Map<string, HTMLDivElement>());
  const focusId = rows.some((row) => row.task.id === focusedId)
    ? focusedId
    : rows[0]?.task.id;
  const previousFocus = useRef<string | null>(null);
  useEffect(() => {
    // Restore a nearby row when the focused branch is removed by a command.
    if (
      previousFocus.current &&
      !rows.some((row) => row.task.id === previousFocus.current) &&
      document.activeElement === document.body
    ) {
      if (focusId) refs.current.get(focusId)?.focus();
      else document.getElementById('quick-task')?.focus();
    }
    previousFocus.current = focusedId;
  }, [tasks, focusedId, focusId, rows]);
  function focus(id: string | undefined) {
    if (id) {
      setFocusedId(id);
      refs.current.get(id)?.focus();
    }
  }
  return (
    <div role="tree" aria-label={label} className="task-tree">
      {rows.map(({ task, depth, hasChildren }, index) => (
        <div
          key={task.id}
          ref={(node) => {
            if (node) refs.current.set(task.id, node);
            else refs.current.delete(task.id);
          }}
          role="treeitem"
          aria-label={`${task.title}, ${statusLabels[task.status]}${computedDateLabel(task, schedule) ? `, ${computedDateLabel(task, schedule)}` : ''}`}
          aria-level={depth + 1}
          aria-expanded={hasChildren ? !collapsed.has(task.id) : undefined}
          aria-selected={selectedId === task.id}
          tabIndex={focusId === task.id ? 0 : -1}
          data-task-id={task.id}
          className={`task-row${selectedId === task.id ? ' selected' : ''}${hasChildren ? ' summary' : ''}`}
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
              focus(rows[index + 1]?.task.id);
            }
            if (event.key === 'ArrowUp') {
              event.preventDefault();
              focus(rows[index - 1]?.task.id);
            }
            if (event.key === 'Home') {
              event.preventDefault();
              focus(rows[0]?.task.id);
            }
            if (event.key === 'End') {
              event.preventDefault();
              focus(rows.at(-1)?.task.id);
            }
            if (event.key === 'ArrowRight') {
              event.preventDefault();
              if (hasChildren && collapsed.has(task.id)) onToggle(task.id);
              else if (hasChildren) focus(rows[index + 1]?.task.id);
            }
            if (event.key === 'ArrowLeft') {
              event.preventDefault();
              if (hasChildren && !collapsed.has(task.id)) onToggle(task.id);
              else focus(task.parentId ?? undefined);
            }
            if (event.key === 'Enter') {
              event.preventDefault();
              onSelect(task);
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
          {schedule?.criticalTaskIds.includes(task.id) && (
            <span
              className="critical-indicator"
              title={strings.critical}
              aria-label={strings.critical}
            >
              ◆
            </span>
          )}
          <span
            className="task-date"
            title={computedDateLabel(task, schedule) || strings.noDate}
          >
            {compactDateLabel(task, schedule) || strings.noDate}
          </span>
        </div>
      ))}
    </div>
  );
}
