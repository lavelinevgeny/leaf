import { useEffect, useRef, useState } from 'react';
import type { Task } from '../shared/contracts.js';
import type { TreeAction } from './TaskTree.js';
import { orderedChildren, subtreeIds, treeRows } from './tree-view.js';
import { trapDialogKeys } from './TaskLeaveDialog.js';
import { strings } from './strings.js';

export function TaskMoveDialog({
  task,
  tasks,
  trigger,
  blockedReason,
  onMove,
  onAction,
  onClose,
}: {
  task: Task;
  trigger: HTMLButtonElement | null;
  tasks: Task[];
  blockedReason: string | null;
  onMove: (task: Task, parentId: string | null) => void;
  onAction: (action: TreeAction, task: Task) => boolean | void;
  onClose: () => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [query, setQuery] = useState('');
  const [parentId, setParentId] = useState<string | null>(task.parentId);
  const excluded = tasks.some((candidate) => candidate.id === task.id)
    ? subtreeIds(tasks, task.id)
    : new Set<string>();
  const siblings = orderedChildren(tasks, task.parentId);
  const index = siblings.findIndex((candidate) => candidate.id === task.id);
  const byId = new Map(tasks.map((candidate) => [candidate.id, candidate]));
  function path(candidate: Task): string {
    const parts = [candidate.title];
    let parent = byId.get(candidate.parentId ?? '');
    while (parent) {
      parts.unshift(parent.title);
      parent = byId.get(parent.parentId ?? '');
    }
    return parts.join(' / ');
  }
  const candidates = treeRows(tasks, new Set()).filter(
    ({ task: candidate }) =>
      !excluded.has(candidate.id) &&
      path(candidate)
        .toLocaleLowerCase()
        .includes(query.toLocaleLowerCase().trim()),
  );
  const controls: {
    action: TreeAction;
    label: string;
    reason: string | null;
  }[] = [
    {
      action: 'up',
      label: strings.moveUp,
      reason: index <= 0 ? 'Задача уже первая в группе.' : null,
    },
    {
      action: 'down',
      label: strings.moveDown,
      reason:
        index >= siblings.length - 1 ? 'Задача уже последняя в группе.' : null,
    },
    {
      action: 'out',
      label: strings.moveOut,
      reason: task.parentId === null ? 'Задача уже в корне.' : null,
    },
    {
      action: 'in',
      label: strings.moveIn,
      reason: index <= 0 ? 'Нет предыдущей задачи для вложения.' : null,
    },
  ];
  useEffect(() => {
    const origin = trigger ?? document.activeElement;
    const node = dialog.current!;
    node.showModal();
    node.querySelector<HTMLInputElement>('input')?.focus();
    return () => {
      const restore =
        node.contains(document.activeElement) ||
        document.activeElement === document.body;
      node.close();
      if (restore && origin instanceof HTMLElement && origin.isConnected)
        origin.focus({ preventScroll: true });
    };
  }, []);
  const selected = parentId ? byId.get(parentId) : null;
  const reason =
    blockedReason ??
    (parentId === task.parentId
      ? 'Выберите другого родителя.'
      : parentId && (!selected || excluded.has(parentId))
        ? 'Недоступный родитель.'
        : null);
  return (
    <dialog
      ref={dialog}
      className="task-dialog task-move-dialog"
      aria-labelledby="task-move-title"
      onKeyDown={trapDialogKeys}
      onCancel={(event) => {
        event.preventDefault();
        onClose();
      }}
    >
      <h2 id="task-move-title">Переместить задачу</h2>
      <label>
        Поиск родителя
        <input
          value={query}
          onChange={(event) => setQuery(event.target.value)}
        />
      </label>
      <p>Родитель: {selected ? path(selected) : strings.root}</p>
      <button
        type="button"
        aria-pressed={parentId === null}
        onClick={() => setParentId(null)}
      >
        В корень
      </button>
      <div
        className="task-move-candidates"
        role="group"
        aria-label="Новый родитель"
      >
        {candidates.map(({ task: candidate }) => (
          <button
            key={candidate.id}
            type="button"
            aria-pressed={parentId === candidate.id}
            onClick={() => setParentId(candidate.id)}
          >
            {path(candidate)}
          </button>
        ))}
        {!candidates.length && <p>Задачи не найдены.</p>}
      </div>
      <details>
        <summary>Порядок и уровень</summary>
        {controls.map((control) => {
          const why = blockedReason ?? control.reason;
          return (
            <div key={control.action}>
              <button
                type="button"
                disabled={!!why}
                aria-describedby={
                  why ? `move-${control.action}-reason` : undefined
                }
                onClick={() => {
                  onAction(control.action, task);
                  onClose();
                }}
              >
                {control.label}
              </button>
              {why && (
                <p id={`move-${control.action}-reason`} className="field-hint">
                  {why}
                </p>
              )}
            </div>
          );
        })}
      </details>
      {reason && (
        <p id="task-move-reason" className="field-hint">
          {reason}
        </p>
      )}
      <div className="dialog-actions">
        <button
          type="button"
          disabled={!!reason}
          aria-describedby={reason ? 'task-move-reason' : undefined}
          onClick={() => {
            onMove(task, parentId);
            onClose();
          }}
        >
          {strings.move}
        </button>
        <button type="button" onClick={onClose}>
          Отмена
        </button>
      </div>
    </dialog>
  );
}
