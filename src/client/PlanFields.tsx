import type {
  Project,
  ProjectTree,
  Task,
  SourceFields,
} from '../shared/contracts.js';
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
}
export function PlanFields({
  task,
  plan,
  computed,
  summary,
  disabled,
  onChange,
}: Props) {
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
          <label>
            {strings.start}
            <input
              type="date"
              value={plan.inputStart ?? ''}
              onChange={(event) =>
                onChange({ ...plan, inputStart: event.target.value || null })
              }
            />
          </label>
          <label>
            {strings.finish}
            <input
              type="date"
              value={plan.inputFinish ?? ''}
              onChange={(event) =>
                onChange({ ...plan, inputFinish: event.target.value || null })
              }
            />
          </label>
        </div>
        <label>
          {strings.duration}
          <input
            type="number"
            min={1}
            max={1000000}
            step={1}
            value={plan.durationDays ?? ''}
            onChange={(event) =>
              onChange({
                ...plan,
                durationDays:
                  event.target.value === '' ? null : Number(event.target.value),
              })
            }
          />
        </label>
        <p className="field-hint">
          Даты и длительность необязательны. Изменение одного поля не заполняет
          остальные.
        </p>
      </fieldset>
    </>
  );
}
