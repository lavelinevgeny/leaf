import { useEffect, useState } from 'react';
import type { Command, Project } from '../shared/contracts.js';
import { calendarLabels, strings } from './strings.js';
type Settings = Pick<Project, 'startDate' | 'calendarType' | 'timezone'>;
const settingsOf = (project: Project): Settings => ({
  startDate: project.startDate,
  calendarType: project.calendarType,
  timezone: project.timezone,
});
interface Props {
  project: Project;
  disabled: boolean;
  onSave: (
    command: Extract<Command, { type: 'project.schedule' }>,
  ) => Promise<boolean>;
  onDirty: (dirty: boolean) => void;
}
export function ProjectPlan({ project, disabled, onSave, onDirty }: Props) {
  const [draft, setDraft] = useState(() => settingsOf(project));
  const [baseline, setBaseline] = useState(() => settingsOf(project));
  const dirty = JSON.stringify(draft) !== JSON.stringify(baseline);
  useEffect(() => {
    onDirty(dirty);
  }, [dirty, onDirty]);
  useEffect(() => {
    const fresh = settingsOf(project);
    if (!dirty || JSON.stringify(fresh) === JSON.stringify(draft)) {
      setDraft(fresh);
      setBaseline(fresh);
    }
  }, [project, dirty]);
  return (
    <details className="project-plan">
      <summary>{strings.projectPlan}</summary>
      <form
        onSubmit={(event) => {
          event.preventDefault();
          void onSave({ type: 'project.schedule', changes: draft }).then(
            (success) => {
              if (success) {
                setBaseline(draft);
                onDirty(false);
              }
            },
          );
        }}
      >
        <fieldset disabled={disabled}>
          <label>
            {strings.projectStart}
            <input
              type="date"
              value={draft.startDate ?? ''}
              onChange={(event) =>
                setDraft({ ...draft, startDate: event.target.value || null })
              }
            />
          </label>
          <label>
            {strings.calendar}
            <select
              aria-label={strings.calendar}
              value={draft.calendarType}
              onChange={(event) =>
                setDraft({
                  ...draft,
                  calendarType: event.target.value as Project['calendarType'],
                })
              }
            >
              {Object.entries(calendarLabels).map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </select>
          </label>
          <label>
            {strings.timezone}
            <input
              required
              maxLength={100}
              value={draft.timezone}
              onChange={(event) =>
                setDraft({ ...draft, timezone: event.target.value })
              }
            />
          </label>
          <button className="primary" disabled={!dirty}>
            {strings.saveProjectPlan}
          </button>
          {dirty && (
            <button
              type="button"
              className="quiet"
              onClick={() => {
                setDraft(settingsOf(project));
                setBaseline(settingsOf(project));
                onDirty(false);
              }}
            >
              {strings.discard}
            </button>
          )}
        </fieldset>
      </form>
    </details>
  );
}
