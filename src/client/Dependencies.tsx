import { useId, useRef, useState } from 'react';
import { PredecessorPicker } from './PredecessorPicker.js';
import { canonicalPredecessorIds } from './predecessor-view.js';
import { ScheduleStatus } from './ScheduleStatus.js';
import type {
  Command,
  Dependency,
  ProjectTree,
  Task,
} from '../shared/contracts.js';
import { compactDateLabel } from './gantt-view.js';
import { statusLabels, strings } from './strings.js';
interface Props {
  incomingIds: readonly string[];
  onIncomingChange: (ids: string[]) => void;
  taskDirty: boolean;
  scheduleDirty: boolean;
  task: Task;
  tree: ProjectTree;
  disabled: boolean;
  navigationDisabled?: boolean;
  onCommand: (command: Command) => Promise<boolean>;
  onSelect: (task: Task) => void;
  onShow: (task: Task) => void;
}
export function Dependencies({
  task,
  tree,
  disabled,
  incomingIds,
  onIncomingChange,
  taskDirty,
  scheduleDirty,
  navigationDisabled = disabled,
  onCommand,
  onSelect,
  onShow,
}: Props) {
  const [direction, setDirection] = useState<
    'predecessor' | 'successor' | null
  >(null);
  const trigger = useRef<HTMLButtonElement | null>(null);
  function open(
    direction: 'predecessor' | 'successor',
    anchor: HTMLButtonElement,
  ) {
    trigger.current = anchor;
    setDirection(direction);
  }
  function close() {
    setDirection(null);
    trigger.current?.focus();
  }
  const [beforePage, setBeforePage] = useState(0),
    [afterPage, setAfterPage] = useState(0);
  const marker = useId().replaceAll(':', '');
  const byId = new Map(tree.tasks.map((item) => [item.id, item]));
  const savedBefore = tree.dependencies.filter(
    (edge) => edge.successorId === task.id,
  );
  const before: Dependency[] = [
    ...savedBefore,
    ...incomingIds
      .filter((id) => !savedBefore.some((edge) => edge.predecessorId === id))
      .map((id) => ({
        id: `draft:${id}`,
        projectId: task.projectId,
        predecessorId: id,
        successorId: task.id,
      })),
  ];
  const savedIds = new Set(tree.dependencies.map((edge) => edge.id));
  const added = (edge: Dependency) => !savedIds.has(edge.id);
  const pendingRemoval = (edge: Dependency) =>
    edge.successorId === task.id && !incomingIds.includes(edge.predecessorId);
  const after = tree.dependencies.filter(
    (edge) => edge.predecessorId === task.id,
  );
  const offset = (page: number, count: number) =>
    Math.min(page, Math.max(0, Math.floor((count - 1) / 4) * 4));
  const beforeOffset = offset(beforePage, before.length),
    afterOffset = offset(afterPage, after.length);
  const predecessors = before.slice(beforeOffset, beforeOffset + 4),
    successors = after.slice(afterOffset, afterOffset + 4);
  const summaryIds = new Set(tree.tasks.map((item) => item.parentId));
  const summary = summaryIds.has(task.id);
  const currentY = 30 + predecessors.length * 72 + 24;
  const afterY = currentY + 100;
  const height = afterY + Math.max(36, successors.length * 72) + 8;
  const schedule = tree.schedule;
  const criticalEdges = new Set(
    schedule.analysisStatus === 'ready' ? schedule.criticalDependencyIds : [],
  );
  const partial =
    schedule.analysisStatus === 'incomplete' ? schedule.partialAnalysis : null;
  const partialEdges = new Set(partial?.partialCriticalDependencyIds ?? []);
  function card(item: Task | undefined, y: number, edge?: Dependency) {
    const title = item?.title ?? strings.removedPredecessor;
    const neighborId = edge
      ? edge.successorId === task.id
        ? edge.predecessorId
        : edge.successorId
      : task.id;
    const date = item
      ? compactDateLabel(item, tree.schedule) || strings.notScheduled
      : strings.notScheduled;
    return (
      <div
        key={edge?.id ?? task.id}
        data-dependency-direction={
          edge
            ? edge.successorId === task.id
              ? 'incoming'
              : 'outgoing'
            : undefined
        }
        className={`dependency-card${edge && (added(edge) || pendingRemoval(edge)) ? ' dependency-pending' : ''}${!edge ? ' current' : ''}${edge && partialEdges.has(edge.id) ? ' partial-critical' : ''}`}
        style={{ top: y }}
      >
        <button
          type="button"
          disabled={navigationDisabled || !edge || !item}
          className="dependency-open"
          aria-label={`${strings.openTask}: ${title}`}
          onClick={() => {
            if (item) onSelect(item);
          }}
        >
          <span
            className={`status-dot ${item?.status ?? 'todo'}`}
            aria-hidden="true"
          >
            {item?.status === 'done' ? '✓' : ''}
          </span>
          <span>
            <strong>{title}</strong>
            <small>
              {date}
              {item ? ` · ${statusLabels[item.status]}` : ''}
            </small>
            {edge && added(edge) && <small>{strings.dependencyUnsaved}</small>}
            {edge && pendingRemoval(edge) && (
              <small>{strings.dependencyRemoval}</small>
            )}
            {edge && partialEdges.has(edge.id) && (
              <small className="partial-critical-label">
                {strings.partialCriticalEdge}
              </small>
            )}
            {edge && criticalEdges.has(edge.id) && (
              <small className="critical-label">{strings.criticalEdge}</small>
            )}
          </span>
        </button>
        {edge && (
          <button
            className="dependency-remove quiet"
            type="button"
            disabled={disabled || (edge.successorId !== task.id && taskDirty)}
            aria-describedby={
              edge.successorId !== task.id && taskDirty
                ? `${marker}-blocked`
                : undefined
            }
            aria-label={`${pendingRemoval(edge) ? strings.restoreDependency : strings.deleteDependency}: ${title}`}
            onClick={() => {
              if (disabled) return;
              if (edge.successorId === task.id) {
                onIncomingChange(
                  canonicalPredecessorIds(
                    pendingRemoval(edge)
                      ? [...incomingIds, neighborId]
                      : incomingIds.filter((id) => id !== neighborId),
                  ),
                );
              } else if (!taskDirty)
                void onCommand({
                  type: 'dependency.delete',
                  dependencyId: edge.id,
                });
            }}
          >
            {pendingRemoval(edge) ? '↶' : '×'}
          </button>
        )}
      </div>
    );
  }
  return (
    <div className="dependencies-panel">
      <button
        className="quiet"
        type="button"
        disabled={navigationDisabled}
        onClick={() => onShow(task)}
      >
        {strings.showOnGantt}
      </button>
      {summary && (
        <>
          <p className="field-hint">{strings.summaryDependencyHint}</p>
          <ul className="dependency-leaves">
            {tree.tasks
              .filter((item) => {
                if (summaryIds.has(item.id)) return false;
                const seen = new Set<string>();
                let parent = item.parentId;
                while (parent && !seen.has(parent)) {
                  if (parent === task.id) return true;
                  seen.add(parent);
                  parent = byId.get(parent)?.parentId ?? null;
                }
                return false;
              })
              .map((item) => (
                <li key={item.id}>
                  <button
                    type="button"
                    disabled={navigationDisabled}
                    onClick={() => onSelect(item)}
                  >
                    {item.title}
                  </button>
                </li>
              ))}
          </ul>
        </>
      )}
      <div className="dependency-section-label">
        {strings.predecessors} ({before.length})
        {!summary && (
          <button
            type="button"
            className="quiet"
            disabled={disabled}
            onClick={(event) => open('predecessor', event.currentTarget)}
          >
            {strings.addPredecessor}
          </button>
        )}
        {before.length > 4 && (
          <button
            type="button"
            className="quiet"
            onClick={() =>
              setBeforePage((offset) =>
                offset + 4 < before.length ? offset + 4 : 0,
              )
            }
          >
            {strings.showMore}
          </button>
        )}
      </div>
      <div className="dependency-graph" style={{ height }}>
        <svg
          viewBox={`0 0 320 ${height}`}
          width="100%"
          height={height}
          aria-label={strings.dependencies}
        >
          <defs>
            <marker
              id={`${marker}-dep`}
              viewBox="0 0 8 8"
              refX="7"
              refY="4"
              markerWidth="6"
              markerHeight="6"
              orient="auto"
            >
              <path d="M0 0 L8 4 L0 8" fill="context-stroke" />
            </marker>
          </defs>
          {predecessors.map((edge, index) => (
            <path
              key={edge.id}
              data-dependency-edge={edge.id}
              d={`M38,${30 + index * 72 + 30} H${8 + index * 5} V${currentY + 30} H38`}
              markerEnd={`url(#${marker}-dep)`}
              className={`dependency-arrow${added(edge) || pendingRemoval(edge) ? ' dependency-pending' : ''}${criticalEdges.has(edge.id) ? ' critical' : ''}${partialEdges.has(edge.id) ? ' partial-critical' : ''}`}
            >
              <title>
                {byId.get(edge.predecessorId)?.title} → {task.title}
                {partialEdges.has(edge.id)
                  ? ` — ${strings.partialCriticalEdge}`
                  : criticalEdges.has(edge.id)
                    ? ` — ${strings.criticalEdge}`
                    : ''}
              </title>
            </path>
          ))}
          {successors.map((edge, index) => (
            <path
              key={edge.id}
              data-dependency-edge={edge.id}
              d={`M38,${currentY + 30} H${8 + index * 5} V${afterY + index * 72 + 30} H38`}
              markerEnd={`url(#${marker}-dep)`}
              className={`dependency-arrow${added(edge) || pendingRemoval(edge) ? ' dependency-pending' : ''}${criticalEdges.has(edge.id) ? ' critical' : ''}${partialEdges.has(edge.id) ? ' partial-critical' : ''}`}
            >
              <title>
                {task.title} → {byId.get(edge.successorId)?.title}
                {partialEdges.has(edge.id)
                  ? ` — ${strings.partialCriticalEdge}`
                  : criticalEdges.has(edge.id)
                    ? ` — ${strings.criticalEdge}`
                    : ''}
              </title>
            </path>
          ))}
        </svg>
        {predecessors.map((edge, index) =>
          card(byId.get(edge.predecessorId), 30 + index * 72, edge),
        )}
        {!before.length && (
          <p className="graph-empty" style={{ top: 0 }}>
            {strings.noPredecessors}
          </p>
        )}
        {card(task, currentY)}
        <span className="graph-section-title" style={{ top: currentY + 74 }}>
          {strings.successors} ({after.length})
          {!summary && (
            <button
              type="button"
              className="quiet"
              disabled={disabled || taskDirty}
              aria-describedby={taskDirty ? `${marker}-blocked` : undefined}
              onClick={(event) => open('successor', event.currentTarget)}
            >
              {strings.addSuccessor}
            </button>
          )}
        </span>
        {successors.map((edge, index) =>
          card(byId.get(edge.successorId), afterY + index * 72, edge),
        )}
        {!after.length && (
          <p className="graph-empty" style={{ top: afterY }}>
            {strings.noSuccessors}
          </p>
        )}
      </div>
      {after.length > 4 && (
        <button
          className="quiet"
          type="button"
          onClick={() =>
            setAfterPage((offset) =>
              offset + 4 < after.length ? offset + 4 : 0,
            )
          }
        >
          {strings.showMore}
        </button>
      )}
      {!summary && taskDirty && (
        <p id={`${marker}-blocked`} className="field-hint">
          {strings.saveTaskBeforeSubtask}
        </p>
      )}
      {direction && !summary && (
        <PredecessorPicker
          key={direction}
          tree={tree}
          {...(direction === 'predecessor'
            ? { successorId: task.id }
            : { direction: 'successor' as const, predecessorId: task.id })}
          selectedIds={
            direction === 'predecessor'
              ? incomingIds
              : after.map((edge) => edge.successorId)
          }
          disabled={disabled || (direction === 'successor' && taskDirty)}
          onAdd={(id) => {
            if (disabled) return;
            if (direction === 'predecessor')
              onIncomingChange(canonicalPredecessorIds([...incomingIds, id]));
            else if (!taskDirty)
              void onCommand({
                type: 'dependency.create',
                predecessorId: task.id,
                successorId: id,
              }).then((success) => {
                if (success) close();
              });
          }}
          onRemove={(id) => {
            if (disabled) return;
            if (direction === 'predecessor')
              onIncomingChange(
                incomingIds.filter((selected) => selected !== id),
              );
            else if (!taskDirty) {
              const edge = after.find((edge) => edge.successorId === id);
              if (edge)
                void onCommand({
                  type: 'dependency.delete',
                  dependencyId: edge.id,
                });
            }
          }}
          onClose={close}
        />
      )}
      {scheduleDirty && <p className="field-hint">{strings.savedPlan}</p>}
      <details className="dependency-calculation">
        <summary>{strings.calculation}</summary>
        <ScheduleStatus tree={tree} task={task} />
      </details>
    </div>
  );
}
