import { useEffect, useId, useRef, useState } from 'react';
import type {
  Project,
  ProjectTree,
  Task,
  SourceFields,
} from '../shared/contracts.js';
import { completeSourceEdit } from '../domain/planning.js';
import { CalendarDateInput } from './CalendarDateInput.js';
import { strings } from './strings.js';
interface Props {
  task: Task;
  plan: SourceFields;
  computed?:
    | Pick<ProjectTree['schedule']['tasks'][string], 'startDate' | 'finishDate'>
    | undefined;
  calendar: Project['calendarType'];
  summary: boolean;
  disabled: boolean;
  onChange: (source: SourceFields) => void;
  onValidityChange?: (valid: boolean) => void;
}
export function PlanFields({
  task,
  plan,
  computed,
  calendar,
  summary,
  disabled,
  onChange,
  onValidityChange,
}: Props) {
  const hintId = useId();
  const errorId = useId();
  const pending = useRef<Partial<SourceFields>>({});
  const [error, setError] = useState<{
    source: string;
    field: keyof SourceFields;
    message: string;
  } | null>(null);
  const [flash, setFlash] = useState<(keyof SourceFields)[]>([]);
  const [announcement, setAnnouncement] = useState('');
  const activeError = error?.source === JSON.stringify(plan) ? error : null;
  useEffect(() => {
    onValidityChange?.(!activeError);
  }, [activeError, onValidityChange]);
  useEffect(() => {
    if (!flash.length) return;
    const timer = window.setTimeout(() => setFlash([]), 1800);
    return () => window.clearTimeout(timer);
  }, [flash]);
  function change(field: keyof SourceFields, value: string | number | null) {
    Object.assign(pending.current, { [field]: value });
    setError(null);
    setFlash([]);
    setAnnouncement('');
    onChange({ ...plan, [field]: value });
  }
  function commit(field: keyof SourceFields, value: string | number | null) {
    if (!Object.hasOwn(pending.current, field)) return;
    if (pending.current[field] !== value) return;
    delete pending.current[field];
    const source = { ...plan, [field]: value };
    try {
      const next = completeSourceEdit(source, field, calendar);
      const changed = (Object.keys(next) as (keyof SourceFields)[]).filter(
        (key) => key !== field && next[key] !== source[key],
      );
      onChange(next);
      setError(null);
      onValidityChange?.(true);
      setFlash(changed);
      setAnnouncement(
        changed.length
          ? `Пересчитано: ${changed.map((key) => (key === 'inputStart' ? strings.start : key === 'inputFinish' ? strings.finish : strings.durationLabel)).join(', ')}`
          : '',
      );
    } catch (failure) {
      setError({
        source: JSON.stringify(source),
        field,
        message:
          failure instanceof Error ? failure.message : strings.planInputError,
      });
      onChange(source);
      onValidityChange?.(false);
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
              label={field === 'inputStart' ? strings.start : strings.finish}
              value={plan[field]}
              descriptionId={
                activeError?.field === field ? `${hintId} ${errorId}` : hintId
              }
              invalid={activeError?.field === field}
              highlighted={flash.includes(field)}
              onChange={(value) => change(field, value)}
              onCommit={(value) => commit(field, value)}
            />
          ))}
        </div>
        <label className="duration-field">
          {strings.durationLabel}
          <span className="duration-input">
            <input
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
            <span aria-hidden="true">{units}</span>
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
