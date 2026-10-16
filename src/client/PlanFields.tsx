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
import { completeSourceEdit, validateSourceInput } from '../domain/planning.js';
import {
  CalendarDateInput,
  type CalendarDateInputHandle,
} from './CalendarDateInput.js';
import { strings } from './strings.js';
import { useProjectToday } from './use-project-today.js';
export type PlanFieldError = { field: keyof SourceFields; message: string };
// Optional RAM snapshot shares the owning quick draft's lifetime, including remounts.
export type PlanFieldsDraft = {
  duration: { raw: string; source: number | null } | null;
  error: (PlanFieldError & { source: string }) | null;
  pending: Partial<SourceFields>;
};
export type PlanFieldsHandle = {
  finishInput: () => boolean;
  focusField: (field: keyof SourceFields) => void;
  setStart: (date: string) => void;
};
interface Props {
  ref?: Ref<PlanFieldsHandle>;
  resetKey?: number;
  inputDraft?: PlanFieldsDraft | undefined;
  onInputDraft?: ((draft: PlanFieldsDraft) => void) | undefined;
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
  inputDraft,
  onInputDraft,
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
  const previousError = useRef<PlanFieldError | null>(null);
  const [durationDraft, setDurationDraft] = useState<{
    raw: string;
    source: number | null;
  } | null>(inputDraft?.duration ?? null);
  const durationBuffer = useRef(durationDraft);
  durationBuffer.current = durationDraft;
  function setDurationInput(value: typeof durationDraft) {
    durationBuffer.current = value;
    setDurationDraft(value);
  }
  function activeDuration() {
    return durationBuffer.current?.source === latest.current.durationDays
      ? durationBuffer.current
      : null;
  }
  // Keep unfinished decimal/exponent text in RAM; an empty string alone is clear.
  function durationNumber(raw: string): number | null | undefined {
    const value = raw.trim();
    if (!value) return null;
    if (!/^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:e[+-]?\d+)?$/i.test(value))
      return undefined;
    const number = Number(value);
    return Number.isFinite(number) ? number : undefined;
  }
  function invalidDuration() {
    const draft = activeDuration();
    return draft !== null && durationNumber(draft.raw) === undefined;
  }
  function report(value: PlanFieldError | null) {
    errorRef.current = value;
    onErrorChange?.(value);
    onValidityChange?.(!value);
  }
  const pending = useRef<Partial<SourceFields>>({ ...inputDraft?.pending });
  const [error, setError] = useState<{
    source: string;
    field: keyof SourceFields;
    message: string;
  } | null>(inputDraft?.error ?? null);
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
    onInputDraft?.({
      duration: durationDraft,
      error,
      pending: { ...pending.current },
    });
  }, [durationDraft, error, plan]);
  const previousReset = useRef(resetKey);
  useLayoutEffect(() => {
    if (resetKey === undefined || previousReset.current === resetKey) return;
    previousReset.current = resetKey;
    pending.current = {};
    previousError.current = null;
    setDurationInput(null);
    setError(null);
    report(null);
    onRawChange?.(false);
  }, [resetKey]);
  useImperativeHandle(ref, () => ({
    finishInput() {
      start.current?.commit();
      finish.current?.commit();
      finishDuration();
      if (errorRef.current) return false;
      try {
        validate(latest.current);
        return true;
      } catch (failure) {
        fail(
          latest.current,
          previousError.current?.field ?? 'inputFinish',
          failure,
        );
        return false;
      }
    },
    setStart(date) {
      change('inputStart', date);
      commit('inputStart', date);
      start.current?.reset();
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
    if (errorRef.current) previousError.current = errorRef.current;
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
      if (invalidDuration())
        throw new Error('Введите целое число от 1 до 1 000 000.');
      const next = completeSourceEdit(source, field, calendar);
      validate(next);
      const changed = (Object.keys(next) as (keyof SourceFields)[]).filter(
        (key) => key !== field && next[key] !== source[key],
      );
      latest.current = next;
      if (field === 'durationDays') setDurationInput(null);
      previousError.current = null;
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
      fail(source, field, failure);
      onChange(source);
    }
  }
  function validate(source: SourceFields) {
    if (!sourceFieldsSchema.safeParse(source).success)
      throw new Error(strings.planInputError);
    validateSourceInput(source, calendar);
  }
  function fail(
    source: SourceFields,
    field: keyof SourceFields,
    failure: unknown,
  ) {
    const parsed = sourceFieldsSchema.safeParse(source);
    const invalidField = invalidDuration()
      ? 'durationDays'
      : !parsed.success
        ? parsed.error.issues[0]?.path[0]
        : source[field] === null
          ? (previousError.current?.field ?? field)
          : field;
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
  }
  function changeDuration(raw: string) {
    const value = durationNumber(raw);
    if (value === undefined) {
      setDurationInput({ raw, source: latest.current.durationDays });
      onEdit?.();
      fail(
        latest.current,
        'durationDays',
        new Error('Введите целое число от 1 до 1 000 000.'),
      );
    } else {
      change('durationDays', value);
      setDurationInput({ raw, source: value });
    }
  }
  function finishDuration() {
    if (invalidDuration()) {
      fail(
        latest.current,
        'durationDays',
        new Error('Введите целое число от 1 до 1 000 000.'),
      );
      return;
    }
    commit('durationDays', latest.current.durationDays);
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
              type="text"
              inputMode="decimal"
              value={
                durationDraft?.source === plan.durationDays
                  ? durationDraft.raw
                  : String(plan.durationDays ?? '')
              }
              onChange={(event) => changeDuration(event.target.value)}
              onBlur={finishDuration}
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
