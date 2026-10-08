import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type ReactNode,
} from 'react';
import type { ProjectTree, Task } from '../shared/contracts.js';
import { treeRows } from './tree-view.js';
import { TaskTree, type TreeAction } from './TaskTree.js';
import { Gantt } from './Gantt.js';
import {
  computedDateLabel,
  ganttInterval,
  sourceMarkers,
  shiftDate,
  type Scale,
} from './gantt-view.js';
import { scaleLabels, strings } from './strings.js';
import { useProjectToday } from './use-project-today.js';
import {
  emptyTaskFilter,
  filterTasks,
  type TaskFilter,
} from './task-filter.js';
export type GanttReveal = { taskId: string; sequence: number };
interface Props {
  tree: ProjectTree;
  selectedId: string | null;
  collapsed: ReadonlySet<string>;
  onToggle: (id: string) => void;
  onSelect: (task: Task) => void;
  onAction: (action: TreeAction, task: Task) => void;
  onPlan: (task: Task, kind: 'move' | 'resize', target: string) => void;
  disabled: boolean;
  show: boolean;
  reveal: GanttReveal | null;
  filter?: TaskFilter;
  viewControl?: ReactNode;
}
function timelineDate(task: Task, tree: ProjectTree, today: string) {
  return (
    ganttInterval(task, tree.schedule, {
      today,
      calendar: tree.project.calendarType,
    })?.start ?? sourceMarkers(task, tree.schedule)[0]?.date
  );
}
export function TaskTimeline({
  tree,
  selectedId,
  collapsed,
  onToggle,
  onSelect,
  onAction,
  onPlan,
  disabled,
  show,
  reveal,
  viewControl,
  filter = emptyTaskFilter,
}: Props) {
  const projection = useMemo(
    () => filterTasks(tree.tasks, filter),
    [tree.tasks, filter],
  );
  const filterKey = JSON.stringify(filter);
  const [filteredCollapse, setFilteredCollapse] = useState({
    key: filterKey,
    ids: new Set<string>(),
  });
  useEffect(() => {
    setFilteredCollapse({ key: filterKey, ids: new Set<string>() });
  }, [filterKey]);
  const filteredIds =
    filteredCollapse.key === filterKey
      ? filteredCollapse.ids
      : new Set<string>();
  const effectiveCollapsed = projection.active ? filteredIds : collapsed;
  const rows = treeRows(projection.tasks, effectiveCollapsed);
  function toggle(id: string) {
    if (!projection.active) return onToggle(id);
    setFilteredCollapse(() => {
      const ids = new Set(filteredIds);
      if (ids.has(id)) ids.delete(id);
      else ids.add(id);
      return { key: filterKey, ids };
    });
  }
  const focusedTask = tree.tasks.find((task) => task.id === selectedId);
  const today = useProjectToday(tree.project.timezone);
  const [scale, setScale] = useState<Scale>('days');
  const [start, setStart] = useState(() =>
    shiftDate(
      tree.tasks
        .map((task) => timelineDate(task, tree, today))
        .filter((date): date is string => !!date)
        .sort()[0] ?? today,
      -3,
    ),
  );
  const [width, setWidth] = useState(420);
  const horizontal = useRef<HTMLDivElement>(null);
  const vertical = useRef<HTMLDivElement>(null);
  const resize = useRef<{ x: number; width: number } | null>(null);
  useEffect(() => {
    if (!reveal) return;
    const task = tree.tasks.find((item) => item.id === reveal.taskId);
    const date = task && timelineDate(task, tree, today);
    if (date) setStart(shiftDate(date, -3));
    if (horizontal.current) horizontal.current.scrollLeft = 0;
    requestAnimationFrame(() => {
      const row = vertical.current?.querySelector<HTMLElement>(
        `[data-task-id="${reveal.taskId}"]`,
      );
      row?.scrollIntoView({ block: 'nearest' });
    });
  }, [reveal]);
  const movePeriod = (direction: number) => {
    setStart((previous) =>
      shiftDate(
        previous,
        direction * { days: 30, weeks: 90, months: 180 }[scale],
      ),
    );
    if (horizontal.current) horizontal.current.scrollLeft = 0;
  };
  const treeProps = {
    tasks: tree.tasks,
    rows,
    schedule: tree.schedule,
    selectedId,
    collapsed: effectiveCollapsed,
    onToggle: toggle,
    ...(projection.active ? { matchIds: projection.matchIds } : {}),
    onSelect,
    onAction,
  };
  const results = projection.active && (
    <p role="status" className="filter-results">
      {strings.taskMatchCount} {projection.matchIds.size}
      {tree.tasks.length > 0 && projection.matchIds.size === 0 && (
        <span className="no-task-matches">{strings.noTaskMatches}</span>
      )}
    </p>
  );
  return (
    <div
      className="task-timeline"
      style={{ '--tree-width': `${width}px` } as CSSProperties}
    >
      {results}
      <div className="gantt-toolbar">
        {viewControl}
        {show && (
          <>
            <label>
              {strings.scale}
              <select
                aria-label={strings.scale}
                value={scale}
                onChange={(event) => setScale(event.target.value as Scale)}
              >
                {Object.entries(scaleLabels).map(([value, label]) => (
                  <option key={value} value={value}>
                    {label}
                  </option>
                ))}
              </select>
            </label>
            <button
              type="button"
              aria-label={strings.previousPeriod}
              onClick={() => movePeriod(-1)}
            >
              ‹
            </button>
            <button
              type="button"
              onClick={() => {
                setStart(shiftDate(today, -3));
                if (horizontal.current) horizontal.current.scrollLeft = 0;
              }}
            >
              {strings.today}
            </button>
            <button
              type="button"
              aria-label={strings.nextPeriod}
              onClick={() => movePeriod(1)}
            >
              ›
            </button>
            <span>{start}</span>
          </>
        )}
      </div>
      <div className="plan-scroll" ref={vertical} data-plan-scroll>
        {show ? (
          <div className="timeline-columns">
            <div className="timeline-tree">
              <div className="timeline-heading">
                {strings.title}
                <span>
                  {strings.start} / {strings.finish}
                </span>
              </div>
              <TaskTree {...treeProps} />
            </div>
            <div
              className="timeline-divider"
              role="separator"
              tabIndex={0}
              aria-label={strings.treeWidth}
              aria-orientation="vertical"
              aria-valuemin={300}
              aria-valuemax={620}
              aria-valuenow={width}
              onKeyDown={(event) => {
                if (['ArrowLeft', 'ArrowRight'].includes(event.key)) {
                  event.preventDefault();
                  setWidth((value) =>
                    Math.max(
                      300,
                      Math.min(
                        620,
                        value + (event.key === 'ArrowLeft' ? -20 : 20),
                      ),
                    ),
                  );
                }
              }}
              onPointerDown={(event) => {
                if (event.button === 0) {
                  resize.current = { x: event.clientX, width };
                  event.currentTarget.setPointerCapture(event.pointerId);
                }
              }}
              onPointerMove={(event) => {
                if (resize.current)
                  setWidth(
                    Math.max(
                      300,
                      Math.min(
                        620,
                        resize.current.width + event.clientX - resize.current.x,
                      ),
                    ),
                  );
              }}
              onPointerUp={() => {
                resize.current = null;
              }}
              onPointerCancel={() => {
                resize.current = null;
              }}
            />
            <div
              className="timeline-time"
              ref={horizontal}
              tabIndex={0}
              aria-label={strings.gantt}
            >
              <Gantt
                tree={tree}
                rows={rows}
                start={start}
                scale={scale}
                today={today}
                selectedId={selectedId}
                disabled={disabled}
                onSelect={onSelect}
                onPlan={onPlan}
              />
            </div>
          </div>
        ) : (
          <TaskTree {...treeProps} />
        )}
      </div>
      <span className="sr-only">
        {focusedTask ? computedDateLabel(focusedTask, tree.schedule) : ''}
      </span>
    </div>
  );
}
