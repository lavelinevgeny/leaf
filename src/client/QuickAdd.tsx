import { useEffect, useId, useRef, useState } from 'react';
import {
  sourceFieldsSchema,
  type Task,
  type SourceFields,
  type Project,
} from '../shared/contracts.js';
import { QuickSchedule } from './QuickSchedule.js';
import { scheduleChip } from './quick-add-view.js';
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
  parentPlan?: SourceFields | null;
  inline?: boolean;
  onEditing?: (editing: boolean) => void;
  onCancel?: () => void;
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
  parentPlan = null,
  inline = false,
  onEditing,
  onCancel,
}: Props) {
  const [editing, setEditing] = useState(false);
  const chip = useRef<HTMLButtonElement>(null);
  function beginEditing() {
    setEditing(true);
    onEditing?.(true);
  }
  function clear() {
    onTitle('');
    onPlan(newTaskPlan());
    rejectedPlan.current = null;
    setValid(true);
  }
  function cancel() {
    clear();
    setScheduleOpen(false);
    setEditing(false);
    onEditing?.(false);
    onCancel?.();
  }
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
      className={`quick-add${inline ? ' inline-quick-add' : ''}`}
      onBlur={(event) => {
        if (
          event.relatedTarget &&
          !event.currentTarget.contains(event.relatedTarget as Node)
        )
          onEditing?.(false);
      }}
      onSubmit={(event) => {
        event.preventDefault();
        void submit();
      }}
    >
      <div className="quick-line">
        <span className="draft-dot" aria-hidden="true">
          ＋
        </span>
        <input
          id={inputId}
          ref={input}
          aria-label={strings.newTask}
          aria-description={`${strings.parent}: ${parent?.title ?? strings.root}. ${strings.quickHint}`}
          placeholder={strings.newTask}
          value={title}
          maxLength={300}
          disabled={busy || blocked}
          onFocus={beginEditing}
          onChange={(event) => onTitle(event.target.value)}
          onKeyDown={(event) => {
            if (event.altKey && event.key.toLowerCase() === 'd') {
              event.preventDefault();
              setScheduleOpen((open) => !open);
              beginEditing();
              return;
            }
            if (event.key === 'Escape') {
              event.preventDefault();
              event.stopPropagation();
              if (inline) cancel();
              else {
                setEditing(false);
                onEditing?.(false);
              }
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
          ref={chip}
          type="button"
          className={`schedule-chip${!valid ? ' invalid' : ''}`}
          aria-label={strings.newTaskSchedule}
          aria-description={scheduleChip(plan, calendar)}
          aria-expanded={scheduleOpen}
          aria-controls={scheduleId}
          disabled={busy || blocked}
          title={`${scheduleChip(plan, calendar)} · Alt+D`}
          onClick={() => {
            setScheduleOpen((open) => !open);
            beginEditing();
          }}
        >
          <span aria-hidden="true">▦</span> {scheduleChip(plan, calendar)}
        </button>
        <button
          aria-label={strings.addTask}
          title={strings.addTask}
          className="quick-submit"
          type="submit"
          disabled={busy || blocked || !title.trim() || !canSubmit}
        >
          {inline ? '✓' : strings.addTask}
        </button>
        {inline && (
          <button
            type="button"
            className="quick-cancel"
            aria-label={strings.cancelTaskInput}
            title={strings.cancelTaskInput}
            disabled={busy || blocked}
            onClick={cancel}
          >
            ×
          </button>
        )}
      </div>
      <div className={inline ? 'quick-meta sr-only' : 'quick-meta'}>
        <span>
          {strings.parent}: {parent?.title ?? strings.root}
        </span>
        <span>{strings.quickHint}</span>
        {(title ||
          plan.inputStart !== null ||
          plan.inputFinish !== null ||
          plan.durationDays !== 1) && (
          <>
            <span role="status">{strings.quickDirty}</span>
            {!inline && (
              <button
                type="button"
                disabled={busy || blocked}
                onClick={() => {
                  clear();
                }}
              >
                {strings.clearQuick}
              </button>
            )}
          </>
        )}
      </div>
      {!valid && (
        <p className={inline ? 'sr-only' : 'field-hint'}>
          {strings.planInputError}
        </p>
      )}
      {scheduleOpen && (
        <QuickSchedule
          id={scheduleId}
          plan={plan}
          parentPlan={parentPlan}
          calendar={calendar}
          timezone={timezone}
          disabled={busy || blocked}
          anchor={chip.current}
          onChange={onPlan}
          onValidityChange={validityChanged}
          onClose={() => {
            setScheduleOpen(false);
            chip.current?.focus();
          }}
        />
      )}
    </form>
  );
}
