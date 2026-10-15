import {
  useEffect,
  useId,
  useRef,
  useState,
  useLayoutEffect,
  useImperativeHandle,
  type Ref,
} from 'react';
import { sourceFieldsSchema } from '../shared/contracts.js';
import type {
  Project,
  ProjectTree,
  Task,
  SourceFields,
} from '../shared/contracts.js';
import { completeSourceEdit } from '../domain/planning.js';
import {
  CalendarDateInput,
  type CalendarDateInputHandle,
} from './CalendarDateInput.js';
import { strings } from './strings.js';
import { useProjectToday } from './use-project-today.js';
export type PlanFieldError = { field: keyof SourceFields; message: string };
export type PlanFieldsHandle = {
  finishInput: () => boolean;
  focusField: (field: keyof SourceFields) => void;
};
interface Props {
  ref?: Ref<PlanFieldsHandle>;
  resetKey?: number;
  externalError?: PlanFieldError | null;
  onErrorChange?: (error: PlanFieldError | null) => void;
  onRawChange?: (dirty: boolean) => void;
  onEdit?: () => void;
  task: Pick<Task, 'status'>;
  plan: SourceFields;
  computed?:
    | Pick<ProjectTree['schedule']['tasks'][string], 'startDate' | 'finishDate'>
    | undefined;
  calendar: Project['calendarType'];
  timezone?: string;
  summary: boolean;
  disabled: boolean;
  onChange: (source: SourceFields) => void;
  onValidityChange?: (valid: boolean) => void;
  compact?: boolean;
}
export function PlanFields({
  ref,
  resetKey,
  externalError,
  onErrorChange,
  onRawChange,
  onEdit,
  task,
  plan,
  computed,
  calendar,
  timezone,
  summary,
  disabled,
  onChange,
  onValidityChange,
  compact = false,
}: Props) {
  const today = useProjectToday(timezone ?? 'UTC');
  const hintId = useId();
  const errorId = useId();
  const latest = useRef(plan);
  latest.current = plan;
  const start = useRef<CalendarDateInputHandle>(null);
  const finish = useRef<CalendarDateInputHandle>(null);
  const duration = useRef<HTMLInputElement>(null);
  const errorRef = useRef<PlanFieldError | null>(null);
  function report(value: PlanFieldError | null) {
    errorRef.current = value;
    onErrorChange?.(value);
    onValidityChange?.(!value);
  }
  const pending = useRef<Partial<SourceFields>>({});
  const [error, setError] = useState<{
    source: string;
    field: keyof SourceFields;
    message: string;
  } | null>(null);
  const [flash, setFlash] = useState<(keyof SourceFields)[]>([]);
  const [announcement, setAnnouncement] = useState('');
  const activeError =
    (error?.source === JSON.stringify(plan) ? error : null) ??
    externalError ??
    null;
  errorRef.current = activeError;
  useEffect(() => {
    onValidityChange?.(!activeError);
  }, [activeError, onValidityChange]);
  useLayoutEffect(() => {
    if (resetKey === undefined) return;
    pending.current = {};
    setError(null);
    report(null);
    onRawChange?.(false);
  }, [resetKey]);
  useImperativeHandle(ref, () => ({
    finishInput() {
      start.current?.commit();
      finish.current?.commit();
      if (Object.hasOwn(pending.current, 'durationDays'))
        commit('durationDays', latest.current.durationDays);
      return !errorRef.current;
    },
    focusField(field) {
      if (field === 'inputStart') start.current?.focus();
      else if (field === 'inputFinish') finish.current?.focus();
      else duration.current?.focus();
    },
  }));
  useEffect(() => {
    if (!flash.length) return;
    const timer = window.setTimeout(() => setFlash([]), 1800);
    return () => window.clearTimeout(timer);
  }, [flash]);
  function change(field: keyof SourceFields, value: string | number | null) {
    Object.assign(pending.current, { [field]: value });
    onRawChange?.(true);
    onEdit?.();
    report(null);
    setError(null);
    setFlash([]);
    setAnnouncement('');
    latest.current = { ...latest.current, [field]: value };
    onChange(latest.current);
  }
  function commit(field: keyof SourceFields, value: string | number | null) {
    if (!Object.hasOwn(pending.current, field)) return;
    if (pending.current[field] !== value) return;
    delete pending.current[field];
    const source = { ...latest.current, [field]: value };
    try {
      const next = completeSourceEdit(source, field, calendar);
      if (!sourceFieldsSchema.safeParse(next).success)
        throw new Error(strings.planInputError);
      const changed = (Object.keys(next) as (keyof SourceFields)[]).filter(
        (key) => key !== field && next[key] !== source[key],
      );
      latest.current = next;
      onChange(next);
      setError(null);
      report(null);
      onRawChange?.(Object.keys(pending.current).length > 0);
      setFlash(changed);
      setAnnouncement(
        changed.length
          ? `Пересчитано: ${changed.map((key) => (key === 'inputStart' ? strings.start : key === 'inputFinish' ? strings.finish : strings.durationLabel)).join(', ')}`
          : '',
      );
    } catch (failure) {
      const parsed = sourceFieldsSchema.safeParse(source);
      const invalidField = parsed.success
        ? field
        : parsed.error.issues[0]?.path[0];
      const addressed =
        invalidField === 'inputStart' ||
        invalidField === 'inputFinish' ||
        invalidField === 'durationDays'
          ? invalidField
          : field;
      const label =
        addressed === 'inputStart'
          ? strings.start
          : addressed === 'inputFinish'
            ? strings.finish
            : strings.durationLabel;
      const failureError = {
        source: JSON.stringify(source),
        field: addressed,
        message: `${label}: ${failure instanceof Error ? failure.message : strings.planInputError}`,
      };
      setError(failureError);
      report(failureError);
      onRawChange?.(true);
      onChange(source);
    }
  }
  if (summary)
    return (
      <>
        <div className="date-fields">
          <CalendarDateInput
            label={strings.start}
            disabled
            value={computed?.startDate ?? null}
          />
          <CalendarDateInput
            label={strings.finish}
            disabled
            value={computed?.finishDate ?? null}
          />
        </div>
        <p className="field-hint">{strings.summaryHint}</p>
      </>
    );
  const units =
    calendar === 'weekdays' ? strings.durationWorkingDays : strings.days;
  return (
    <>
      {task.status === 'done' && (
        <p className="field-hint">{strings.doneHint}</p>
      )}
      <fieldset
        className="plan-fields"
        disabled={disabled || task.status === 'done'}
      >
        <div className="date-fields">
          {(['inputStart', 'inputFinish'] as const).map((field) => (
            <CalendarDateInput
              key={field}
              ref={field === 'inputStart' ? start : finish}
              resetKey={resetKey}
              label={field === 'inputStart' ? strings.start : strings.finish}
              value={plan[field]}
              descriptionId={
                activeError?.field === field ? `${hintId} ${errorId}` : hintId
              }
              invalid={activeError?.field === field}
              highlighted={flash.includes(field)}
              {...(field === 'inputStart' && timezone && !compact
                ? { today }
                : {})}
              onChange={(value) => change(field, value)}
              onCommit={(value) => commit(field, value)}
            />
          ))}
        </div>
        <label className="duration-field">
          {strings.durationLabel}
          <span className="duration-input">
            <input
              ref={duration}
              aria-label={`${strings.durationLabel}, ${units}`}
              aria-describedby={
                activeError?.field === 'durationDays'
                  ? `${hintId} ${errorId}`
                  : hintId
              }
              aria-invalid={activeError?.field === 'durationDays' || undefined}
              className={
                flash.includes('durationDays') ? 'plan-recalculated' : undefined
              }
              type="number"
              min={1}
              max={1000000}
              step={1}
              value={plan.durationDays ?? ''}
              onChange={(event) =>
                change(
                  'durationDays',
                  event.target.value === '' ? null : Number(event.target.value),
                )
              }
              onBlur={(event) =>
                commit(
                  'durationDays',
                  event.target.value === '' ? null : Number(event.target.value),
                )
              }
              onKeyDown={(event) => {
                if (event.key === 'Enter') {
                  event.preventDefault();
                  event.currentTarget.blur();
                }
              }}
            />
            <span aria-hidden="true">
              {compact ? (calendar === 'weekdays' ? 'р.д.' : 'дн.') : units}
            </span>
          </span>
        </label>
        <p className="field-hint" id={hintId}>
          {strings.linkedPlanHint}
        </p>
        {activeError && (
          <p className="field-error" id={errorId} role="alert">
            {activeError.message}
          </p>
        )}
        <span role="status" className="sr-only" aria-live="polite">
          {announcement}
        </span>
      </fieldset>
    </>
  );
}
