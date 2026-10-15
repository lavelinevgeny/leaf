import {
  useLayoutEffect,
  useRef,
  useState,
  useImperativeHandle,
  type Ref,
} from 'react';
import type { Project, SourceFields } from '../shared/contracts.js';
import {
  PlanFields,
  type PlanFieldsHandle,
  type PlanFieldError,
} from './PlanFields.js';
import { shiftDate } from './gantt-view.js';
import { taskScheduleLabel } from './task-panel-view.js';
import { useProjectToday } from './use-project-today.js';
import { strings } from './strings.js';
export type TaskPanelScheduleHandle = Pick<
  PlanFieldsHandle,
  'finishInput' | 'focusField'
>;
interface Props {
  ref?: Ref<TaskPanelScheduleHandle>;
  plan: SourceFields;
  project: Project;
  summary: boolean;
  computed?:
    { startDate: string | null; finishDate: string | null } | undefined;
  disabledReason: string | null;
  error: PlanFieldError | null;
  resetKey: number;
  onChange: (source: SourceFields) => void;
  onValidityChange: (valid: boolean) => void;
  onErrorChange: (error: PlanFieldError | null) => void;
  onRawChange: (dirty: boolean) => void;
  onEdit: () => void;
  onResetFields: () => void;
}
export function TaskPanelSchedule({
  ref,
  plan,
  project,
  summary,
  computed,
  disabledReason,
  error,
  resetKey,
  onChange,
  onValidityChange,
  onErrorChange,
  onRawChange,
  onEdit,
  onResetFields,
}: Props) {
  const [open, setOpen] = useState(false);
  const anchor = useRef<HTMLButtonElement>(null);
  const popup = useRef<HTMLDivElement>(null);
  const fields = useRef<PlanFieldsHandle>(null);
  const today = useProjectToday(project.timezone);
  function close() {
    setOpen(false);
    anchor.current?.focus({ preventScroll: true });
  }
  useImperativeHandle(ref, () => ({
    finishInput: () => fields.current?.finishInput() ?? true,
    focusField(field) {
      setOpen(true);
      requestAnimationFrame(() => fields.current?.focusField(field));
    },
  }));
  useLayoutEffect(() => {
    const node = popup.current,
      trigger = anchor.current;
    if (!open || !node || !trigger) return;
    node.showPopover?.();
    const position = () => {
      const rect = trigger.getBoundingClientRect();
      const width = Math.min(440, window.innerWidth - 24);
      node.style.width = `${width}px`;
      node.style.left = `${Math.max(12, Math.min(rect.left, window.innerWidth - width - 12))}px`;
      node.style.top = `${Math.max(12, Math.min(rect.bottom + 8, window.innerHeight - node.offsetHeight - 12))}px`;
    };
    position();
    node.querySelector<HTMLInputElement>('input[type="text"]')?.focus();
    const dismiss = (event: PointerEvent) => {
      if (
        event.target instanceof Node &&
        !node.contains(event.target) &&
        !trigger.contains(event.target)
      )
        close();
    };
    document.addEventListener('pointerdown', dismiss);
    window.addEventListener('resize', position);
    window.addEventListener('scroll', position, true);
    return () => {
      node.hidePopover?.();
      document.removeEventListener('pointerdown', dismiss);
      window.removeEventListener('resize', position);
      window.removeEventListener('scroll', position, true);
    };
  }, [open]);
  const label = summary
    ? computed?.startDate && computed.finishDate
      ? taskScheduleLabel(
          {
            inputStart: computed.startDate,
            inputFinish: computed.finishDate,
            durationDays: null,
          },
          project.calendarType,
        )
      : strings.summaryScheduleUnknown
    : taskScheduleLabel(plan, project.calendarType);
  function preset(date: string) {
    fields.current?.setStart(date);
  }
  return (
    <div className="panel-schedule">
      <button
        ref={anchor}
        type="button"
        aria-label={`${strings.taskDates}: ${label}`}
        aria-expanded={open}
        aria-description={disabledReason ?? undefined}
        aria-describedby="task-panel-date-description"
        disabled={summary || !!disabledReason}
        onClick={() => setOpen((value) => !value)}
        onKeyDown={(event) => {
          if (open && event.key === 'Escape') {
            event.preventDefault();
            event.stopPropagation();
            close();
          }
        }}
      >
        {label}
      </button>
      <span id="task-panel-date-description" className="sr-only">
        {summary
          ? `${strings.summaryHint}; ${strings.start}: ${computed?.startDate ?? '—'}; ${strings.finish}: ${computed?.finishDate ?? '—'}`
          : `${strings.start}: ${plan.inputStart ?? '—'}; ${strings.finish}: ${plan.inputFinish ?? '—'}; ${strings.durationLabel}: ${plan.durationDays ?? '—'}`}
      </span>
      {!summary && (
        <div
          ref={popup}
          role="dialog"
          aria-label={strings.taskDates}
          hidden={!open}
          inert={!open}
          popover={
            typeof HTMLElement.prototype.showPopover === 'function'
              ? 'manual'
              : undefined
          }
          className="quick-schedule task-panel-schedule"
          onKeyDown={(event) => {
            if (event.key === 'Escape') {
              event.preventDefault();
              event.stopPropagation();
              close();
            }
          }}
        >
          <strong>{strings.taskDates}</strong>
          <div className="quick-presets">
            <button
              type="button"
              disabled={!!disabledReason}
              onClick={() => preset(today)}
            >
              {strings.today}
            </button>
            <button
              type="button"
              disabled={!!disabledReason}
              onClick={() => preset(shiftDate(today, 1))}
            >
              {strings.tomorrow}
            </button>
          </div>
          <PlanFields
            ref={fields}
            externalError={error}
            resetKey={resetKey}
            task={{ status: 'doing' }}
            plan={plan}
            calendar={project.calendarType}
            summary={false}
            disabled={!!disabledReason}
            compact
            onChange={onChange}
            onValidityChange={onValidityChange}
            onErrorChange={onErrorChange}
            onRawChange={onRawChange}
            onEdit={onEdit}
          />
          <div className="quick-schedule-actions">
            <button
              type="button"
              disabled={!!disabledReason}
              onClick={() => {
                onResetFields();
                onChange({
                  inputStart: null,
                  inputFinish: null,
                  durationDays: null,
                });
                onEdit();
              }}
            >
              {strings.clearAllSchedule}
            </button>
            <button
              type="button"
              disabled={!!disabledReason}
              onClick={() => {
                if (fields.current?.finishInput()) close();
              }}
            >
              {strings.confirmSchedule}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
