import { useEffect, useId, useRef, useState, type PointerEvent } from 'react';
import { indexToDate } from '../domain/calendar.js';
import type { ProjectTree, Task } from '../shared/contracts.js';
import {
  calendarDays,
  dateX,
  HEADER_HEIGHT,
  intervalOf,
  ROW_HEIGHT,
  shiftDate,
  windowFor,
  type Scale,
} from './gantt-view.js';
import { treeRows } from './tree-view.js';
import { strings } from './strings.js';
export interface GanttProps {
  tree: ProjectTree;
  rows: ReturnType<typeof treeRows>;
  start: string;
  scale: Scale;
  today: string;
  selectedId: string | null;
  disabled: boolean;
  onSelect: (task: Task) => void;
  onPlan: (task: Task, kind: 'move' | 'resize', target: string) => void;
}
interface Gesture {
  task: Task;
  kind: 'move' | 'resize';
  anchor: string;
  clientX: number;
  delta: number;
  pointerId: number;
}
export function Gantt({
  tree,
  rows,
  start,
  scale,
  today,
  selectedId,
  disabled,
  onSelect,
  onPlan,
}: GanttProps) {
  const view = windowFor(start, scale);
  const marker = useId().replaceAll(':', '');
  const gestureRef = useRef<Gesture | null>(null);
  const [preview, setPreview] = useState<Gesture | null>(null);
  const suppressClick = useRef(false);
  const height = HEADER_HEIGHT + rows.length * ROW_HEIGHT;
  const days = calendarDays(start, view.days);
  const critical = new Set(tree.schedule.criticalTaskIds);
  const criticalEdges = new Set(tree.schedule.criticalDependencyIds);
  useEffect(() => {
    const cancel = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && gestureRef.current) {
        event.preventDefault();
        event.stopImmediatePropagation();
        gestureRef.current = null;
        setPreview(null);
        suppressClick.current = true;
      }
    };
    window.addEventListener('keydown', cancel, true);
    return () => window.removeEventListener('keydown', cancel, true);
  }, []);
  useEffect(() => {
    gestureRef.current = null;
    setPreview(null);
  }, [tree.project.revision, disabled, start, scale]);
  function editable(task: Task) {
    return (
      !disabled &&
      task.status !== 'done' &&
      task.planMode !== 'unscheduled' &&
      !tree.schedule.summaries[task.id] &&
      !tree.schedule.tasks[task.id]?.blockedReason
    );
  }
  function begin(
    event: PointerEvent<SVGElement>,
    task: Task,
    kind: 'move' | 'resize',
  ) {
    if (!editable(task) || event.button !== 0) return;
    const interval = intervalOf(task, tree.schedule);
    if (!interval?.finish) return;
    event.stopPropagation();
    event.preventDefault();
    event.currentTarget.setPointerCapture(event.pointerId);
    gestureRef.current = {
      task,
      kind,
      anchor: kind === 'move' ? interval.start : interval.finish,
      clientX: event.clientX,
      delta: 0,
      pointerId: event.pointerId,
    };
  }
  function move(event: PointerEvent<SVGElement>) {
    const gesture = gestureRef.current;
    if (!gesture || event.pointerId !== gesture.pointerId) return;
    const delta = Math.round((event.clientX - gesture.clientX) / view.dayWidth);
    gestureRef.current = { ...gesture, delta };
    setPreview(gestureRef.current);
  }
  function finish(event: PointerEvent<SVGElement>) {
    const gesture = gestureRef.current;
    if (!gesture || event.pointerId !== gesture.pointerId) return;
    gestureRef.current = null;
    setPreview(null);
    if (gesture.delta) {
      suppressClick.current = true;
      onPlan(
        gesture.task,
        gesture.kind,
        shiftDate(gesture.anchor, gesture.delta),
      );
    }
  }
  const positions = new Map(rows.map((row, index) => [row.task.id, index]));
  const cap = (x: number) => Math.max(0, Math.min(view.width, x));
  return (
    <svg
      className="gantt-svg"
      width={view.width}
      height={height}
      aria-label={strings.gantt}
      role="group"
    >
      <defs>
        <marker
          id={`${marker}-arrow`}
          viewBox="0 0 8 8"
          refX="7"
          refY="4"
          markerWidth="6"
          markerHeight="6"
          orient="auto-start-reverse"
        >
          <path d="M0 0 L8 4 L0 8" fill="context-stroke" />
        </marker>
      </defs>
      {rows.map(({ task }, index) =>
        selectedId === task.id ? (
          <rect
            key={task.id}
            x={0}
            y={HEADER_HEIGHT + index * ROW_HEIGHT}
            width={view.width}
            height={ROW_HEIGHT}
            fill="#e8f4ec"
          />
        ) : null,
      )}
      {days.map(({ date, weekend, x }) => (
        <g key={date} aria-hidden="true">
          {weekend && (
            <rect
              x={x * view.dayWidth}
              y={HEADER_HEIGHT}
              width={view.dayWidth}
              height={height - HEADER_HEIGHT}
              className="gantt-weekend"
            />
          )}
          {(scale === 'days' ||
            (scale === 'weeks' && x % 7 === 0) ||
            date.endsWith('-01')) && (
            <line
              x1={x * view.dayWidth}
              x2={x * view.dayWidth}
              y1={0}
              y2={height}
              className="gantt-grid"
            />
          )}
          {(x === 0 || date.endsWith('-01')) && (
            <text x={x * view.dayWidth + 6} y={18} className="gantt-month">
              {date.slice(0, 7)}
            </text>
          )}
          {(scale === 'days' || (scale === 'weeks' && x % 7 === 0)) && (
            <text x={x * view.dayWidth + 5} y={43} className="gantt-day">
              {date.slice(8)}
            </text>
          )}
        </g>
      ))}
      <line
        x1={0}
        x2={view.width}
        y1={HEADER_HEIGHT}
        y2={HEADER_HEIGHT}
        className="gantt-grid"
      />
      {dateX(today, start, view.dayWidth) >= 0 &&
        dateX(today, start, view.dayWidth) < view.width && (
          <g className="gantt-today" aria-label={`${strings.today}: ${today}`}>
            <line
              x1={dateX(today, start, view.dayWidth) + view.dayWidth / 2}
              x2={dateX(today, start, view.dayWidth) + view.dayWidth / 2}
              y1={22}
              y2={height}
            />
            <text x={dateX(today, start, view.dayWidth) + 3} y={30}>
              {scale === 'months' ? '' : '●'}
            </text>
          </g>
        )}
      {tree.dependencies.map((edge) => {
        const fromIndex = positions.get(edge.predecessorId),
          toIndex = positions.get(edge.successorId);
        const from = tree.schedule.tasks[edge.predecessorId],
          to = tree.schedule.tasks[edge.successorId];
        if (
          fromIndex === undefined ||
          toIndex === undefined ||
          !from?.finishDate ||
          !to?.startDate
        )
          return null;
        const x1 = dateX(from.finishDate, start, view.dayWidth) + view.dayWidth,
          x2 = dateX(to.startDate, start, view.dayWidth);
        if (x1 < 0 || x1 > view.width || x2 < 0 || x2 > view.width) return null;
        const y1 = HEADER_HEIGHT + fromIndex * ROW_HEIGHT + ROW_HEIGHT / 2,
          y2 = HEADER_HEIGHT + toIndex * ROW_HEIGHT + ROW_HEIGHT / 2;
        const bend = x2 >= x1 + 10 ? x1 + 10 : Math.max(x1, x2) + 12;
        return (
          <path
            key={edge.id}
            data-gantt-edge={edge.id}
            d={`M${x1},${y1} H${bend} V${y2} H${x2}`}
            className={`gantt-edge${criticalEdges.has(edge.id) ? ' critical' : ''}`}
            markerEnd={`url(#${marker}-arrow)`}
          >
            <title>
              {criticalEdges.has(edge.id)
                ? strings.criticalEdge
                : strings.dependencies}
            </title>
          </path>
        );
      })}
      {rows.map(({ task }, index) => {
        const interval = intervalOf(task, tree.schedule);
        const y = HEADER_HEIGHT + index * ROW_HEIGHT;
        let x1 = interval ? dateX(interval.start, start, view.dayWidth) : 0;
        let x2 = interval?.finish
          ? dateX(interval.finish, start, view.dayWidth) + view.dayWidth
          : x1;
        if (preview?.task.id === task.id) {
          if (preview.kind === 'move') {
            x1 += preview.delta * view.dayWidth;
            x2 += preview.delta * view.dayWidth;
          } else x2 += preview.delta * view.dayWidth;
        }
        const visible = interval && x2 >= 0 && x1 < view.width;
        const bar = visible && interval.kind !== 'note';
        const cx1 = cap(x1),
          cx2 = cap(Math.max(x1 + 3, x2));
        return (
          <g key={task.id} data-gantt-row={task.id}>
            <rect
              x={0}
              y={y}
              width={view.width}
              height={ROW_HEIGHT}
              fill="transparent"
            />
            <line
              x1={0}
              x2={view.width}
              y1={y + ROW_HEIGHT}
              y2={y + ROW_HEIGHT}
              className="gantt-row-line"
            />
            {bar && (
              <g
                role="button"
                tabIndex={0}
                aria-label={`${task.title}, ${interval.start} – ${interval.finish}${critical.has(task.id) ? `, ${strings.critical}` : ''}, ${editable(task) ? strings.moveBar : strings.openTask}`}
                aria-disabled={disabled}
                className={`gantt-work ${interval.kind}${critical.has(task.id) ? ' critical' : ''}${task.status === 'done' ? ' completed' : ''}${tree.schedule.summaries[task.id]?.partial ? ' partial' : ''}`}
                onPointerDown={(event) => begin(event, task, 'move')}
                onPointerMove={move}
                onPointerUp={finish}
                onPointerCancel={() => {
                  gestureRef.current = null;
                  setPreview(null);
                }}
                onClick={() => {
                  if (suppressClick.current) {
                    suppressClick.current = false;
                    return;
                  }
                  onSelect(task);
                }}
                onKeyDown={(event) => {
                  if (event.key === 'Enter' || event.key === ' ') {
                    event.preventDefault();
                    onSelect(task);
                  }
                  if (
                    ['ArrowLeft', 'ArrowRight'].includes(event.key) &&
                    editable(task)
                  ) {
                    event.preventDefault();
                    event.stopPropagation();
                    const direction = event.key === 'ArrowRight' ? 1 : -1;
                    const anchor = event.shiftKey
                      ? interval.finish!
                      : interval.start;
                    try {
                      onPlan(
                        task,
                        event.shiftKey ? 'resize' : 'move',
                        indexToDate(
                          direction,
                          anchor,
                          tree.project.calendarType,
                        ),
                      );
                    } catch {
                      /* Boundary keys leave the plan unchanged. */
                    }
                  }
                }}
              >
                <title>
                  {task.title}: {interval.start} – {interval.finish}
                  {task.status === 'done' ? ` (${strings.doneHint})` : ''}
                </title>
                {interval.kind === 'summary' ? (
                  <path
                    data-gantt-bar={task.id}
                    d={`M${cx1},${y + 11} H${cx2} V${y + 24} L${Math.max(cx1, cx2 - 5)},${y + 19} H${cx1 + 5} L${cx1},${y + 24} Z`}
                  />
                ) : (
                  <rect
                    data-gantt-bar={task.id}
                    x={cx1}
                    y={y + 9}
                    width={Math.max(3, cx2 - cx1)}
                    height={20}
                    rx={4}
                  />
                )}
                {editable(task) &&
                  interval.kind === 'work' &&
                  x2 >= 0 &&
                  x2 <= view.width && (
                    <rect
                      data-gantt-resize={task.id}
                      x={x2 - 7}
                      y={y + 9}
                      width={7}
                      height={20}
                      className="gantt-resize"
                      role="button"
                      tabIndex={0}
                      aria-label={`${strings.resizeBar}: ${task.title}`}
                      onPointerDown={(event) => begin(event, task, 'resize')}
                      onKeyDown={(event) => {
                        if (['ArrowLeft', 'ArrowRight'].includes(event.key)) {
                          event.preventDefault();
                          event.stopPropagation();
                          try {
                            onPlan(
                              task,
                              'resize',
                              indexToDate(
                                event.key === 'ArrowRight' ? 1 : -1,
                                interval.finish!,
                                tree.project.calendarType,
                              ),
                            );
                          } catch {
                            /* Date range boundary. */
                          }
                        }
                      }}
                    />
                  )}
              </g>
            )}
            {visible &&
              interval.kind === 'note' &&
              [
                interval.start,
                ...(interval.finish && interval.finish !== interval.start
                  ? [interval.finish]
                  : []),
              ].map((date) => (
                <g
                  key={date}
                  data-gantt-note={task.id}
                  role="button"
                  tabIndex={0}
                  aria-label={`${task.title}, ${date}`}
                  onClick={() => onSelect(task)}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter' || event.key === ' ') {
                      event.preventDefault();
                      onSelect(task);
                    }
                  }}
                >
                  <title>
                    {task.title}: {date}
                  </title>
                  <line
                    x1={dateX(date, start, view.dayWidth) + view.dayWidth / 2}
                    x2={dateX(date, start, view.dayWidth) + view.dayWidth / 2}
                    y1={y + 10}
                    y2={y + 28}
                    className="gantt-note"
                  />
                </g>
              ))}
          </g>
        );
      })}
      {preview && (
        <text
          className="gantt-preview"
          x={Math.max(
            5,
            cap(
              dateX(
                shiftDate(preview.anchor, preview.delta),
                start,
                view.dayWidth,
              ),
            ) - 50,
          )}
          y={HEADER_HEIGHT - 6}
        >
          {shiftDate(preview.anchor, preview.delta)}
        </text>
      )}
    </svg>
  );
}
