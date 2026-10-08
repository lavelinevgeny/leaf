import { useEffect, useId, useRef, useState, type PointerEvent } from 'react';
import { ControlIcon } from './ControlIcon.js';
import { indexToDate } from '../domain/calendar.js';
import type { ProjectTree, Task } from '../shared/contracts.js';
import {
  calendarDays,
  sourceMarkers,
  dateX,
  HEADER_HEIGHT,
  ganttInterval,
  ROW_HEIGHT,
  shiftDate,
  windowFor,
  type Scale,
} from './gantt-view.js';
import { treeRows } from './tree-view.js';
import { strings } from './strings.js';
import { draftTaskId, draftInterval } from './quick-add-view.js';
export interface GanttProps {
  tree: ProjectTree;
  rows: ReturnType<typeof treeRows>;
  start: string;
  scale: Scale;
  today: string;
  selectedId: string | null;
  disabled: boolean;
  onSelect: (task: Task) => void;
  onPredecessors?: ((task: Task, trigger: HTMLElement) => void) | undefined;
  onPlan: (task: Task, kind: 'move' | 'resize', target: string) => void;
  draftId?: string | undefined;
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
  onPredecessors,
  draftId,
}: GanttProps) {
  const view = windowFor(start, scale);
  const marker = useId().replaceAll(':', '');
  const chainRefs = useRef(new Map<string, HTMLButtonElement>());
  const [hint, setHint] = useState('');
  useEffect(() => {
    if (!hint) return;
    const timer = window.setTimeout(() => setHint(''), 2500);
    return () => window.clearTimeout(timer);
  }, [hint]);
  const summaries = new Set(tree.tasks.map((task) => task.parentId));
  const gestureRef = useRef<Gesture | null>(null);
  const [preview, setPreview] = useState<Gesture | null>(null);
  const suppressClick = useRef(false);
  const height = HEADER_HEIGHT + rows.length * ROW_HEIGHT;
  const days = calendarDays(start, view.days);
  const schedule = tree.schedule;
  const critical = new Set(
    schedule.analysisStatus === 'ready' ? schedule.criticalTaskIds : [],
  );
  const criticalEdges = new Set(
    schedule.analysisStatus === 'ready' ? schedule.criticalDependencyIds : [],
  );
  const partial =
    schedule.analysisStatus === 'incomplete' ? schedule.partialAnalysis : null;
  const partialTasks = new Set(partial?.partialCriticalTaskIds ?? []);
  const partialEdges = new Set(partial?.partialCriticalDependencyIds ?? []);
  const partialSummaries = new Set(partial?.partialCriticalSummaryIds ?? []);
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
  }, [tree.project.revision, disabled, start, scale, rows]);
  function editable(task: Task) {
    return (
      !disabled &&
      task.status !== 'done' &&
      ganttInterval(task, tree.schedule, {
        today,
        calendar: tree.project.calendarType,
      })?.kind === 'work' &&
      !tree.schedule.summaries[task.id] &&
      !!tree.schedule.tasks[task.id]?.startDate
    );
  }
  function begin(
    event: PointerEvent<SVGElement>,
    task: Task,
    kind: 'move' | 'resize',
  ) {
    if (!editable(task) || event.button !== 0) return;
    const interval = ganttInterval(task, tree.schedule, {
      today,
      calendar: tree.project.calendarType,
    });
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
  const intervals = new Map(
    rows.map(({ task }) => [
      task.id,
      task.id === draftTaskId
        ? draftId
          ? draftInterval(tree, task, today)
          : null
        : ganttInterval(task, schedule, {
            today,
            calendar: tree.project.calendarType,
          }),
    ]),
  );
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
      {hint && (
        <text
          x={8}
          y={HEADER_HEIGHT - 8}
          className="predecessor-hint"
          role="status"
        >
          {hint}
        </text>
      )}
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
        const from = intervals.get(edge.predecessorId),
          to = intervals.get(edge.successorId);
        if (
          fromIndex === undefined ||
          toIndex === undefined ||
          !from ||
          !to ||
          from.kind === 'summary' ||
          to.kind === 'summary' ||
          edge.predecessorId === draftTaskId ||
          edge.successorId === draftTaskId
        )
          return null;
        const x1 = dateX(from.finish, start, view.dayWidth) + view.dayWidth,
          x2 = dateX(to.start, start, view.dayWidth);
        if (x1 < 0 || x1 > view.width || x2 < 0 || x2 > view.width) return null;
        const y1 = HEADER_HEIGHT + fromIndex * ROW_HEIGHT + ROW_HEIGHT / 2,
          y2 = HEADER_HEIGHT + toIndex * ROW_HEIGHT + ROW_HEIGHT / 2;
        const conditional =
          from.kind === 'conditional' || to.kind === 'conditional';
        // Overlapping display intervals need an approach from the left of the
        // successor so the arrowhead is not covered by its bar.
        const path =
          x2 >= x1 + 10
            ? `M${x1},${y1} H${x1 + 10} V${y2} H${x2}`
            : `M${x1},${y1} H${cap(x1 + 12)} V${y2 + ((y1 < y2 ? -1 : 1) * ROW_HEIGHT) / 2} H${cap(x2 - 12)} V${y2} H${x2}`;
        return (
          <path
            key={edge.id}
            data-gantt-edge={edge.id}
            d={path}
            className={`gantt-edge${conditional ? ' conditional' : ''}${criticalEdges.has(edge.id) ? ' critical' : ''}${partialEdges.has(edge.id) ? ' partial-critical' : ''}`}
            markerEnd={`url(#${marker}-arrow)`}
          >
            <title>
              {conditional
                ? strings.conditionalEdge
                : criticalEdges.has(edge.id)
                  ? strings.criticalEdge
                  : partialEdges.has(edge.id)
                    ? strings.partialCriticalEdge
                    : strings.dependencies}
            </title>
          </path>
        );
      })}
      {rows.map(({ task }, index) => {
        const interval = intervals.get(task.id);
        const containsCritical =
          schedule.analysisStatus === 'ready' &&
          schedule.summaries[task.id]?.containsCritical === true;
        const partialCritical =
          partialTasks.has(task.id) || partialSummaries.has(task.id);
        const criticalLabel = critical.has(task.id)
          ? strings.critical
          : containsCritical
            ? strings.containsCritical
            : partialSummaries.has(task.id)
              ? strings.partialContainsCritical
              : partialTasks.has(task.id)
                ? strings.partialCritical
                : '';
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
        const bar = visible;
        const cx1 = cap(x1),
          cx2 = cap(Math.max(x1 + 3, x2));
        return (
          <g
            key={task.id}
            className={selectedId === task.id ? 'selected' : undefined}
            data-gantt-row={task.id === draftTaskId ? undefined : task.id}
            data-gantt-draft={task.id === draftTaskId ? true : undefined}
          >
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
                role={task.id === draftTaskId ? 'img' : 'button'}
                tabIndex={task.id === draftTaskId ? undefined : 0}
                aria-label={
                  task.id === draftTaskId
                    ? strings.draftSchedulePreview
                    : `${task.title}, ${interval.start} – ${interval.finish}${interval.kind === 'conditional' ? `, ${strings.conditionalPlacement}` : ''}${interval.clipped ? ', Отображение ограничено предельной датой' : ''}${criticalLabel ? `, ${criticalLabel}` : ''}, ${editable(task) ? strings.moveBar : strings.openTask}`
                }
                aria-description={
                  task.id === draftTaskId
                    ? `${task.title}: ${interval.start} – ${interval.finish}. ${strings.notSaved}.`
                    : undefined
                }
                aria-disabled={disabled}
                className={`gantt-work ${interval.kind}${critical.has(task.id) ? ' critical' : ''}${partialCritical ? ' partial-critical' : ''}${containsCritical ? ' contains-critical' : ''}${task.status === 'done' ? ' completed' : ''}`}
                onPointerDown={(event) => begin(event, task, 'move')}
                onPointerMove={move}
                onPointerUp={finish}
                onPointerCancel={() => {
                  gestureRef.current = null;
                  setPreview(null);
                }}
                onClick={() => {
                  if (task.id === draftTaskId) {
                    document.getElementById('quick-task')?.focus();
                    return;
                  }
                  if (suppressClick.current) {
                    suppressClick.current = false;
                    return;
                  }
                  onSelect(task);
                }}
                onKeyDown={(event) => {
                  if (event.altKey && event.key.toLowerCase() === 'l') {
                    event.preventDefault();
                    event.stopPropagation();
                    if (disabled || task.id === draftTaskId) return;
                    if (summaries.has(task.id)) setHint(strings.chooseLeaf);
                    else {
                      const trigger = chainRefs.current.get(task.id);
                      if (trigger) onPredecessors?.(task, trigger);
                    }
                    return;
                  }
                  if (event.key === 'Enter' || event.key === ' ') {
                    event.preventDefault();
                    if (task.id === draftTaskId)
                      document.getElementById('quick-task')?.focus();
                    else onSelect(task);
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
                  {interval.kind === 'conditional'
                    ? ` (${strings.conditionalPlacement})`
                    : ''}
                  {interval.clipped
                    ? ' (Отображение ограничено предельной датой)'
                    : ''}
                  {criticalLabel ? ` (${criticalLabel})` : ''}
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
            {bar &&
              onPredecessors &&
              task.id !== draftTaskId &&
              !summaries.has(task.id) && (
                <foreignObject
                  x={Math.min(view.width - 32, Math.max(0, cx2 + 4))}
                  y={y + 5}
                  width={30}
                  height={30}
                  className="gantt-predecessor-host"
                >
                  <button
                    type="button"
                    className="predecessor-action gantt-predecessor"
                    ref={(node) => {
                      if (node) chainRefs.current.set(task.id, node);
                      else chainRefs.current.delete(task.id);
                    }}
                    aria-label={`${strings.afterFinish}: ${task.title}`}
                    title={`${strings.afterFinish} · Alt+L`}
                    disabled={disabled}
                    onPointerDown={(event) => event.stopPropagation()}
                    onClick={(event) => {
                      event.preventDefault();
                      event.stopPropagation();
                      onPredecessors(task, event.currentTarget);
                    }}
                    onKeyDown={(event) => {
                      if (['Enter', ' ', 'Escape'].includes(event.key))
                        event.stopPropagation();
                    }}
                  >
                    <ControlIcon name="chain" />
                  </button>
                </foreignObject>
              )}
            {(task.id === draftTaskId ? [] : sourceMarkers(task, tree.schedule))
              .filter(
                (source) =>
                  dateX(source.date, start, view.dayWidth) >= 0 &&
                  dateX(source.date, start, view.dayWidth) < view.width,
              )
              .map((source) => (
                <line
                  key={source.kind}
                  data-gantt-marker={`${task.id}:${source.kind}`}
                  role="button"
                  tabIndex={0}
                  aria-label={`${task.title}, ${source.kind === 'source-start' ? 'Исходное начало' : 'Исходное окончание'}: ${source.date}`}
                  x1={
                    dateX(source.date, start, view.dayWidth) + view.dayWidth / 2
                  }
                  x2={
                    dateX(source.date, start, view.dayWidth) + view.dayWidth / 2
                  }
                  y1={y + 10}
                  y2={y + 28}
                  className="gantt-note"
                  onClick={() => onSelect(task)}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter' || event.key === ' ') {
                      event.preventDefault();
                      onSelect(task);
                    }
                  }}
                />
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
