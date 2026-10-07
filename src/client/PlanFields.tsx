import { useState } from 'react';
import type {
  Project,
  ProjectTree,
  Task,
  TaskPlan,
} from '../shared/contracts.js';
import { durationForFinish } from './planning-view.js';
import { modeLabels, strings } from './strings.js';
interface Props {
  task: Task;
  plan: TaskPlan;
  computed?:
    | Pick<ProjectTree['schedule']['tasks'][string], 'startDate' | 'finishDate'>
    | undefined;
  calendar: Project['calendarType'];
  summary: boolean;
  disabled: boolean;
  onChange: (plan: TaskPlan) => void;
}
export function PlanFields({
  task,
  plan,
  computed,
  calendar,
  summary,
  disabled,
  onChange,
}: Props) {
  const [error, setError] = useState('');
  if (summary)
    return (
      <>
        <div className="date-fields">
          <label>
            {strings.start}
            <input type="date" disabled value={computed?.startDate ?? ''} />
          </label>
          <label>
            {strings.finish}
            <input type="date" disabled value={computed?.finishDate ?? ''} />
          </label>
        </div>
        <p className="field-hint">{strings.summaryHint}</p>
      </>
    );
  function change(next: TaskPlan) {
    setError('');
    onChange(next);
  }
  function mode(value: TaskPlan['mode']) {
    const deadline = plan.deadline ?? null;
    if (value === 'unscheduled')
      change({ mode: value, inputStart: null, inputFinish: null, deadline });
    if (value === 'auto')
      change({
        mode: value,
        durationDays:
          plan.mode === 'fixed'
            ? (fixedDays() ?? task.durationDays ?? 0)
            : (task.durationDays ?? 0),
        notBefore:
          plan.mode === 'unscheduled'
            ? (plan.inputStart ?? null)
            : task.notBefore,
        deadline,
      });
    if (value === 'fixed')
      change({
        mode: value,
        inputStart: computed?.startDate ?? task.inputStart ?? '',
        inputFinish: computed?.finishDate ?? task.inputFinish ?? '',
        deadline,
      });
  }
  function fixedDays(): number | null {
    if (plan.mode !== 'fixed') return null;
    try {
      return durationForFinish(plan.inputStart, plan.inputFinish, calendar);
    } catch {
      return null;
    }
  }
  return (
    <>
      {task.status === 'done' && (
        <p className="field-hint">{strings.doneHint}</p>
      )}
      <fieldset
        className="plan-fields"
        disabled={disabled || task.status === 'done'}
      >
        <label>
          {strings.mode}
          <select
            value={plan.mode}
            onChange={(event) => mode(event.target.value as TaskPlan['mode'])}
          >
            {Object.entries(modeLabels).map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </select>
        </label>
        {plan.mode === 'auto' ? (
          <>
            <label>
              {strings.duration}
              <input
                type="number"
                min={1}
                max={1000000}
                step={1}
                required
                value={plan.durationDays || ''}
                onChange={(event) =>
                  change({ ...plan, durationDays: Number(event.target.value) })
                }
              />
            </label>
            <div className="calculated-dates">
              <span>{strings.computedStart}</span>
              <output>{computed?.startDate ?? strings.notScheduled}</output>
            </div>
            <label>
              {strings.computedFinish}
              <input
                type="date"
                disabled={!computed?.startDate}
                value={computed?.finishDate ?? ''}
                onChange={(event) => {
                  try {
                    change({
                      ...plan,
                      durationDays: durationForFinish(
                        computed!.startDate!,
                        event.target.value,
                        calendar,
                      ),
                    });
                  } catch {
                    setError(strings.workingDateError);
                  }
                }}
              />
            </label>
            <label>
              {strings.notBefore}
              <input
                type="date"
                value={plan.notBefore ?? ''}
                onChange={(event) =>
                  change({ ...plan, notBefore: event.target.value || null })
                }
              />
            </label>
            <p className="field-hint">{strings.autoHint}</p>
          </>
        ) : (
          <>
            <div className="date-fields">
              <label>
                {strings.start}
                <input
                  type="date"
                  required={plan.mode === 'fixed'}
                  value={plan.inputStart ?? ''}
                  onChange={(event) =>
                    change(
                      plan.mode === 'fixed'
                        ? { ...plan, inputStart: event.target.value }
                        : { ...plan, inputStart: event.target.value || null },
                    )
                  }
                />
              </label>
              <label>
                {strings.finish}
                <input
                  type="date"
                  required={plan.mode === 'fixed'}
                  value={plan.inputFinish ?? ''}
                  onChange={(event) =>
                    change(
                      plan.mode === 'fixed'
                        ? { ...plan, inputFinish: event.target.value }
                        : { ...plan, inputFinish: event.target.value || null },
                    )
                  }
                />
              </label>
            </div>
            <p className="field-hint">
              {plan.mode === 'fixed' ? strings.fixedHint : strings.datesHint}
            </p>
            {plan.mode === 'fixed' && (
              <div className="calculated-dates">
                <span>{strings.duration}</span>
                <output>{fixedDays() ?? strings.notScheduled}</output>
              </div>
            )}
            {plan.mode === 'unscheduled' &&
              plan.inputStart &&
              plan.inputFinish && (
                <button
                  className="quiet"
                  type="button"
                  onClick={() =>
                    change({
                      mode: 'fixed',
                      inputStart: plan.inputStart!,
                      inputFinish: plan.inputFinish!,
                      deadline: plan.deadline,
                    })
                  }
                >
                  {strings.fixedOffer}
                </button>
              )}
          </>
        )}
        <label>
          {strings.deadline}
          <input
            type="date"
            value={plan.deadline ?? ''}
            onChange={(event) =>
              change({ ...plan, deadline: event.target.value || null })
            }
          />
        </label>
        {plan.mode !== 'unscheduled' && (
          <button
            type="button"
            className="quiet danger"
            onClick={() => {
              if (window.confirm(strings.clearPlanConfirm))
                change({
                  mode: 'unscheduled',
                  inputStart: null,
                  inputFinish: null,
                  deadline: plan.deadline,
                });
            }}
          >
            {strings.clearPlan}
          </button>
        )}
      </fieldset>
      {error && (
        <p role="alert" className="field-error">
          {error}
        </p>
      )}
    </>
  );
}
