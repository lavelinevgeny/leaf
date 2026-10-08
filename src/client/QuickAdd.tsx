import { useEffect, useId, useRef, useState } from 'react';
import {
  sourceFieldsSchema,
  type Task,
  type SourceFields,
  type Project,
} from '../shared/contracts.js';
import { PlanFields } from './PlanFields.js';
import { newTaskPlan } from './planning-view.js';
import { orderedChildren } from './tree-view.js';
import { strings } from './strings.js';
export interface AddContext {
  parentId: string | null;
  afterId?: string;
}
interface Props {
  tasks: Task[];
  context: AddContext;
  onContext: (context: AddContext) => void;
  onCreate: (
    title: string,
    context: AddContext,
    plan: SourceFields,
  ) => Promise<boolean>;
  plan: SourceFields;
  onPlan: (plan: SourceFields) => void;
  calendar: Project['calendarType'];
  timezone: string;
  busy: boolean;
  blocked: boolean;
  title: string;
  onTitle: (title: string) => void;
  inputId?: string;
  rootId?: string;
}
export function QuickAdd({
  tasks,
  context,
  onContext,
  onCreate,
  plan,
  onPlan,
  calendar,
  timezone,
  busy,
  blocked,
  title,
  onTitle,
  inputId = 'quick-task',
  rootId,
}: Props) {
  const [editing, setEditing] = useState(false);
  const [scheduleOpen, setScheduleOpen] = useState(false);
  const [valid, setValid] = useState(true);
  const rejectedPlan = useRef<string | null>(null);
  function validityChanged(nextValid: boolean) {
    const source = JSON.stringify(plan);
    if (!nextValid) rejectedPlan.current = source;
    // Closing/reopening the fields must not dismiss the rejected source.
    if (!nextValid || rejectedPlan.current !== source) setValid(nextValid);
  }
  const scheduleId = useId();
  const canSubmit = valid && sourceFieldsSchema.safeParse(plan).success;
  const [restoreFocus, setRestoreFocus] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  const parent = tasks.find((task) => task.id === context.parentId);
  useEffect(() => {
    if (!restoreFocus || busy || blocked) return;
    if (
      document.activeElement === document.body ||
      document.activeElement === input.current
    )
      input.current?.focus();
    setRestoreFocus(false);
  }, [restoreFocus, busy, blocked]);
  async function submit() {
    if (!title.trim() || busy || blocked || !canSubmit) return;
    if (await onCreate(title, context, plan)) {
      setRestoreFocus(true);
    }
  }
  return (
    <form
      className="quick-add"
      onSubmit={(event) => {
        event.preventDefault();
        void submit();
      }}
    >
      <div className="quick-line">
        <span aria-hidden="true">＋</span>
        <input
          id={inputId}
          ref={input}
          aria-label={strings.newTask}
          placeholder={strings.newTask}
          value={title}
          maxLength={300}
          disabled={busy || blocked}
          onFocus={() => setEditing(true)}
          onChange={(event) => onTitle(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Escape') {
              event.preventDefault();
              event.stopPropagation();
              setEditing(false);
              return;
            }
            if (event.key !== 'Tab' || !editing) return;
            event.preventDefault();
            if (event.shiftKey && parent && parent.id !== rootId)
              onContext({ parentId: parent.parentId, afterId: parent.id });
            else if (!event.shiftKey) {
              const candidate =
                tasks.find((task) => task.id === context.afterId) ??
                orderedChildren(tasks, context.parentId).at(-1);
              if (candidate) onContext({ parentId: candidate.id });
            }
          }}
        />
        <button
          type="submit"
          disabled={busy || blocked || !title.trim() || !canSubmit}
        >
          {strings.addTask}
        </button>
      </div>
      <div className="quick-meta">
        <span>
          {strings.parent}: {parent?.title ?? strings.root}
        </span>
        <span>{strings.quickHint}</span>
        <button
          type="button"
          aria-expanded={scheduleOpen}
          aria-controls={scheduleId}
          disabled={busy || blocked}
          onClick={() => setScheduleOpen((open) => !open)}
        >
          {strings.newTaskSchedule}
        </button>
        {(title ||
          plan.inputStart !== null ||
          plan.inputFinish !== null ||
          plan.durationDays !== 1) && (
          <>
            <span role="status">{strings.quickDirty}</span>
            <button
              type="button"
              disabled={busy || blocked}
              onClick={() => {
                onTitle('');
                onPlan(newTaskPlan());
                rejectedPlan.current = null;
                setValid(true);
              }}
            >
              {strings.clearQuick}
            </button>
          </>
        )}
      </div>
      {!valid && <p className="field-hint">{strings.planInputError}</p>}
      {scheduleOpen && (
        <div id={scheduleId} className="quick-plan">
          <PlanFields
            task={{ status: 'todo' }}
            plan={plan}
            calendar={calendar}
            timezone={timezone}
            summary={false}
            disabled={busy || blocked}
            onChange={onPlan}
            onValidityChange={validityChanged}
          />
        </div>
      )}
    </form>
  );
}
