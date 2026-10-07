import { useId, useState } from 'react';
import { validateDependency } from '../domain/planning.js';
import type {
  Command,
  Dependency,
  ProjectTree,
  Task,
} from '../shared/contracts.js';
import { compactDateLabel } from './gantt-view.js';
import { statusLabels, strings } from './strings.js';
interface Props {
  task: Task;
  tree: ProjectTree;
  disabled: boolean;
  onCommand: (command: Command) => Promise<boolean>;
  onSelect: (task: Task) => void;
  onShow: (task: Task) => void;
}
export function Dependencies({
  task,
  tree,
  disabled,
  onCommand,
  onSelect,
  onShow,
}: Props) {
  const [direction, setDirection] = useState<'predecessor' | 'successor'>(
    'predecessor',
  );
  const [search, setSearch] = useState('');
  const [chosen, setChosen] = useState('');
  const [beforePage, setBeforePage] = useState(0),
    [afterPage, setAfterPage] = useState(0);
  const marker = useId().replaceAll(':', '');
  const byId = new Map(tree.tasks.map((item) => [item.id, item]));
  const before = tree.dependencies.filter(
    (edge) => edge.successorId === task.id,
  );
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
  const candidates: Task[] = [],
    rejections: string[] = [];
  for (const item of tree.tasks) {
    if (
      item.id === task.id ||
      item.projectId !== task.projectId ||
      summaryIds.has(item.id) ||
      !item.title
        .toLocaleLowerCase('ru')
        .includes(search.toLocaleLowerCase('ru'))
    )
      continue;
    try {
      validateDependency(
        tree.tasks,
        tree.dependencies,
        direction === 'predecessor' ? item.id : task.id,
        direction === 'predecessor' ? task.id : item.id,
      );
      candidates.push(item);
    } catch (error) {
      if (search && error instanceof Error)
        rejections.push(
          error.message.replace(
            /[0-9a-f]{8}-[0-9a-f-]{27}/gi,
            (id) => byId.get(id)?.title ?? strings.taskRemoved,
          ),
        );
    }
  }
  const choice = candidates.some((item) => item.id === chosen)
    ? chosen
    : (candidates[0]?.id ?? '');
  const currentY = 30 + predecessors.length * 72 + 24;
  const afterY = currentY + 100;
  const height = afterY + Math.max(36, successors.length * 72) + 8;
  const criticalEdges = new Set(tree.schedule.criticalDependencyIds);
  function card(item: Task, y: number, edge?: Dependency) {
    const date = compactDateLabel(item, tree.schedule) || strings.notScheduled;
    return (
      <div
        key={edge?.id ?? item.id}
        className={`dependency-card${!edge ? ' current' : ''}`}
        style={{ top: y }}
      >
        <button
          type="button"
          disabled={disabled || !edge}
          className="dependency-open"
          aria-label={`${strings.openTask}: ${item.title}`}
          onClick={() => onSelect(item)}
        >
          <span className={`status-dot ${item.status}`} aria-hidden="true">
            {item.status === 'done' ? '✓' : ''}
          </span>
          <span>
            <strong>{item.title}</strong>
            <small>
              {date} · {statusLabels[item.status]}
            </small>
            {edge && criticalEdges.has(edge.id) && (
              <small className="critical-label">{strings.criticalEdge}</small>
            )}
          </span>
        </button>
        {edge && (
          <button
            className="dependency-remove quiet"
            type="button"
            disabled={disabled}
            aria-label={`${strings.deleteDependency}: ${item.title}`}
            onClick={() =>
              void onCommand({
                type: 'dependency.delete',
                dependencyId: edge.id,
              })
            }
          >
            ×
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
        disabled={disabled}
        onClick={() => onShow(task)}
      >
        {strings.showOnGantt}
      </button>
      {summary && <p className="field-hint">{strings.summaryDependencyHint}</p>}
      <div className="dependency-section-label">
        {strings.predecessors} ({before.length})
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
              className={`dependency-arrow${criticalEdges.has(edge.id) ? ' critical' : ''}`}
            >
              <title>
                {byId.get(edge.predecessorId)?.title} → {task.title}
              </title>
            </path>
          ))}
          {successors.map((edge, index) => (
            <path
              key={edge.id}
              data-dependency-edge={edge.id}
              d={`M38,${currentY + 30} H${8 + index * 5} V${afterY + index * 72 + 30} H38`}
              markerEnd={`url(#${marker}-dep)`}
              className={`dependency-arrow${criticalEdges.has(edge.id) ? ' critical' : ''}`}
            >
              <title>
                {task.title} → {byId.get(edge.successorId)?.title}
              </title>
            </path>
          ))}
        </svg>
        {predecessors.map((edge, index) =>
          card(byId.get(edge.predecessorId)!, 30 + index * 72, edge),
        )}
        {!before.length && (
          <p className="graph-empty" style={{ top: 0 }}>
            {strings.noPredecessors}
          </p>
        )}
        {card(task, currentY)}
        <span className="graph-section-title" style={{ top: currentY + 74 }}>
          {strings.successors} ({after.length})
        </span>
        {successors.map((edge, index) =>
          card(byId.get(edge.successorId)!, afterY + index * 72, edge),
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
      {!summary && (
        <form
          className="dependency-create"
          onSubmit={(event) => {
            event.preventDefault();
            if (!choice || disabled) return;
            void onCommand({
              type: 'dependency.create',
              predecessorId: direction === 'predecessor' ? choice : task.id,
              successorId: direction === 'predecessor' ? task.id : choice,
            }).then((success) => {
              if (success) {
                setSearch('');
                setChosen('');
              }
            });
          }}
        >
          <fieldset disabled={disabled}>
            <label>
              {strings.dependencyDirection}
              <select
                value={direction}
                onChange={(event) => {
                  setDirection(event.target.value as typeof direction);
                  setChosen('');
                }}
              >
                <option value="predecessor">
                  {strings.predecessor} → {strings.currentTask}
                </option>
                <option value="successor">
                  {strings.currentTask} → {strings.successor}
                </option>
              </select>
            </label>
            <label>
              {strings.searchDependency}
              <input
                type="search"
                value={search}
                onChange={(event) => {
                  setSearch(event.target.value);
                  setChosen('');
                }}
              />
            </label>
            <label>
              {strings.dependencyWork}
              <select
                value={choice}
                onChange={(event) => setChosen(event.target.value)}
                disabled={!candidates.length}
              >
                {!candidates.length && (
                  <option value="">{strings.noCandidates}</option>
                )}
                {candidates.map((item) => (
                  <option key={item.id} value={item.id}>
                    {item.title}
                  </option>
                ))}
              </select>
            </label>
            {rejections.slice(0, 3).map((message, index) => (
              <p key={index} className="field-hint">
                {message}
              </p>
            ))}
            <button type="submit" className="primary" disabled={!choice}>
              {strings.addDependency}
            </button>
          </fieldset>
        </form>
      )}
    </div>
  );
}
