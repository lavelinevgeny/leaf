import { useEffect, useLayoutEffect, useId, useRef, useState } from 'react';
import {
  sourceFieldsSchema,
  type Task,
  type SourceFields,
  type Project,
  type ProjectTree,
} from '../shared/contracts.js';
import { PredecessorPicker } from './PredecessorPicker.js';
import { ControlIcon } from './ControlIcon.js';
import { canonicalPredecessorIds } from './predecessor-view.js';
import { QuickSchedule, type QuickScheduleDraft } from './QuickSchedule.js';
import { scheduleChip } from './quick-add-view.js';
import { newTaskPlan } from './planning-view.js';
import { orderedChildren } from './tree-view.js';
import { strings } from './strings.js';
export interface AddContext {
  parentId: string | null;
  afterId?: string;
}
interface Props {
  active?: boolean;
  tree: ProjectTree;
  predecessorIds: string[];
  onPredecessors: (ids: string[]) => void;
  acknowledgement?: number;
  inputDraft?: QuickScheduleDraft | undefined;
  onInputDraft?: ((draft: QuickScheduleDraft | undefined) => void) | undefined;
  tasks: Task[];
  context: AddContext;
  onContext: (context: AddContext) => void;
  onCreate: (
    title: string,
    context: AddContext,
    plan: SourceFields,
    predecessorIds: string[],
  ) => Promise<boolean>;
  plan: SourceFields;
  onPlan: (plan: SourceFields) => void;
  calendar: Project['calendarType'];
  timezone: string;
  busy: boolean;
  blocked: boolean;
  submitBlockedReason?: string | null;
  title: string;
  onTitle: (title: string) => void;
  inputId?: string;
  rootId?: string;
  parentPlan?: SourceFields | null;
  inline?: boolean;
  onEditing?: (editing: boolean) => void;
  onRawEdit?: () => void;
  onCancel?: () => void;
}
export function QuickAdd({
  active = true,
  tree,
  predecessorIds,
  onPredecessors,
  acknowledgement,
  inputDraft,
  onInputDraft,
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
  submitBlockedReason,
  title,
  onTitle,
  inputId = 'quick-task',
  rootId,
  parentPlan = null,
  inline = false,
  onEditing,
  onRawEdit,
  onCancel,
}: Props) {
  const [editing, setEditing] = useState(false);
  const [titleFocused, setTitleFocused] = useState(false);
  const composing = useRef(false);
  const submitting = useRef(false);
  const chip = useRef<HTMLButtonElement>(null);
  const chain = useRef<HTMLButtonElement>(null);
  const [predecessorsOpen, setPredecessorsOpen] = useState(false);
  function beginEditing() {
    setEditing(true);
    onEditing?.(true);
  }
  function clear() {
    onRawEdit?.();
    onTitle('');
    onPlan(newTaskPlan());
    onPredecessors([]);
    resetFields();
    setValid(true);
  }
  function cancel() {
    clear();
    setScheduleOpen(false);
    setPredecessorsOpen(false);
    setEditing(false);
    onEditing?.(false);
    onCancel?.();
  }
  const [scheduleOpen, setScheduleOpen] = useState(false);
  const [scheduleMounted, setScheduleMounted] = useState(false);
  useEffect(() => {
    if (scheduleOpen) setScheduleMounted(true);
  }, [scheduleOpen]);
  const [resetVersion, setResetVersion] = useState(0);
  const rawVersion = useRef(0);
  const sentRawVersion = useRef<number | null>(null);
  function resetFields() {
    onInputDraft?.(undefined);
    rawVersion.current++;
    sentRawVersion.current = null;
    setResetVersion((version) => version + 1);
    setValid(true);
  }
  function acknowledgeFields() {
    const sent = sentRawVersion.current;
    if (sent !== null && sent === rawVersion.current) resetFields();
    else sentRawVersion.current = null;
  }
  const [valid, setValid] = useState(
    !inputDraft?.error && !inputDraft?.fields?.error,
  );
  const previousInputDraft = useRef(inputDraft);
  useLayoutEffect(() => {
    const previous = previousInputDraft.current;
    previousInputDraft.current = inputDraft;
    if (previous && !inputDraft) resetFields();
  }, [inputDraft]);
  function validityChanged(nextValid: boolean) {
    setValid(nextValid);
  }
  const scheduleId = useId();
  const canSubmit = valid && sourceFieldsSchema.safeParse(plan).success;
  const [restoreFocus, setRestoreFocus] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  const parent = tasks.find((task) => task.id === context.parentId);
  const focusRequest = useRef<{
    input: HTMLInputElement;
    revoked: boolean;
  } | null>(null);
  useEffect(() => {
    const leave = (event: FocusEvent) => {
      if (focusRequest.current && event.target !== focusRequest.current.input)
        focusRequest.current.revoked = true;
    };
    document.addEventListener('focusin', leave);
    return () => {
      document.removeEventListener('focusin', leave);
      focusRequest.current = null;
    };
  }, []);
  const previousContext = useRef({
    parentId: context.parentId,
    afterId: context.afterId,
    acknowledgement,
    active,
  });
  useEffect(() => {
    const previous = previousContext.current;
    if (
      !active ||
      previous.parentId !== context.parentId ||
      (previous.afterId !== context.afterId &&
        previous.acknowledgement === acknowledgement)
    ) {
      if (focusRequest.current) focusRequest.current.revoked = true;
    }
    previousContext.current = {
      parentId: context.parentId,
      afterId: context.afterId,
      acknowledgement,
      active,
    };
  }, [context.parentId, context.afterId, acknowledgement, active]);
  useEffect(() => {
    if (!restoreFocus || busy || blocked) return;
    const request = focusRequest.current;
    focusRequest.current = null;
    if (
      request &&
      !request.revoked &&
      active &&
      request.input === input.current &&
      request.input.isConnected &&
      !request.input.disabled &&
      !request.input.closest('[hidden]')
    )
      request.input.focus();
    setRestoreFocus(false);
  }, [restoreFocus, busy, blocked, active]);
  const previousAck = useRef(acknowledgement);
  useEffect(() => {
    if (acknowledgement === previousAck.current) return;
    previousAck.current = acknowledgement;
    acknowledgeFields();
    setPredecessorsOpen(false);
    setRestoreFocus(true);
  }, [acknowledgement]);
  async function submit() {
    if (
      !title.trim() ||
      composing.current ||
      submitting.current ||
      busy ||
      blocked ||
      !!submitBlockedReason ||
      !canSubmit
    )
      return;
    submitting.current = true;
    if (input.current)
      focusRequest.current = { input: input.current, revoked: false };
    sentRawVersion.current = rawVersion.current;
    try {
      if (await onCreate(title, context, plan, predecessorIds)) {
        acknowledgeFields();
        setRestoreFocus(true);
      }
    } finally {
      submitting.current = false;
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
        <button
          type="button"
          className="draft-dot quick-focus"
          aria-label={strings.focusQuickInput}
          title={strings.focusQuickInput}
          disabled={busy || blocked}
          onClick={() => input.current?.focus()}
        >
          {inline ? (
            <svg
              width="16"
              height="16"
              viewBox="0 0 16 16"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.8"
              strokeLinecap="round"
              focusable="false"
            >
              <path d="M8 3v10M3 8h10" />
            </svg>
          ) : (
            '＋'
          )}
        </button>
        <input
          id={inputId}
          ref={input}
          aria-label={strings.newTask}
          aria-description={`${strings.parent}: ${parent?.title ?? strings.root}. ${strings.quickKeyboardHint} · ${inline ? strings.quickCancelHint : strings.quickExitHint}`}
          placeholder={strings.newTask}
          value={title}
          maxLength={300}
          disabled={busy || blocked}
          onFocus={() => {
            setTitleFocused(true);
            beginEditing();
          }}
          onBlur={() => setTitleFocused(false)}
          onCompositionStart={() => {
            composing.current = true;
          }}
          onCompositionEnd={() => {
            composing.current = false;
          }}
          onChange={(event) => onTitle(event.target.value)}
          onKeyDown={(event) => {
            if (
              composing.current ||
              event.nativeEvent.isComposing ||
              event.keyCode === 229
            ) {
              if (event.key === 'Enter') event.preventDefault();
              event.stopPropagation();
              return;
            }
            if (event.key === 'Enter') event.stopPropagation();
            if (event.altKey && event.key.toLowerCase() === 'l') {
              event.preventDefault();
              event.stopPropagation();
              setPredecessorsOpen((open) => !open);
              setScheduleOpen(false);
              beginEditing();
              return;
            }
            if (event.altKey && event.key.toLowerCase() === 'd') {
              event.preventDefault();
              setScheduleOpen((open) => !open);
              setPredecessorsOpen(false);
              beginEditing();
              return;
            }
            if (event.key === 'Escape') {
              setTitleFocused(false);
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
          ref={chain}
          type="button"
          className="predecessor-action"
          aria-label={strings.newTaskPredecessors}
          aria-expanded={predecessorsOpen}
          title={`${strings.afterFinish} · Alt+L`}
          disabled={busy || blocked}
          onClick={() => {
            setPredecessorsOpen((open) => !open);
            setScheduleOpen(false);
            beginEditing();
          }}
        >
          <ControlIcon name="chain" />
          {predecessorIds.length > 0 && <span>{predecessorIds.length}</span>}
        </button>
        <button
          aria-label={strings.addTask}
          title={strings.addTask}
          className="quick-submit"
          type="submit"
          disabled={
            busy ||
            blocked ||
            !!submitBlockedReason ||
            !title.trim() ||
            !canSubmit
          }
          aria-describedby={
            submitBlockedReason ? `${scheduleId}-submit-reason` : undefined
          }
        >
          {inline ? (
            <svg
              width="16"
              height="16"
              viewBox="0 0 16 16"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.8"
              strokeLinecap="round"
              strokeLinejoin="round"
              aria-hidden="true"
              focusable="false"
            >
              <path d="m4 8 3 3 5-6" />
            </svg>
          ) : (
            strings.addTask
          )}
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
            <svg
              width="16"
              height="16"
              viewBox="0 0 16 16"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.8"
              strokeLinecap="round"
              aria-hidden="true"
              focusable="false"
            >
              <path d="m4 4 8 8m0-8-8 8" />
            </svg>
          </button>
        )}
      </div>
      {submitBlockedReason && (
        <p id={`${scheduleId}-submit-reason`} className="field-hint">
          {submitBlockedReason}
        </p>
      )}
      <div className={inline ? 'quick-meta sr-only' : 'quick-meta'}>
        <span>
          {strings.parent}: {parent?.title ?? strings.root}
        </span>
        {!inline && titleFocused && editing && (
          <span>
            {strings.quickKeyboardHint} · {strings.quickExitHint}
          </span>
        )}
        {(predecessorIds.length > 0 ||
          title ||
          plan.inputStart !== null ||
          plan.inputFinish !== null ||
          plan.durationDays !== 1 ||
          !valid) && (
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
      {predecessorsOpen && (
        <PredecessorPicker
          tree={tree}
          successorId={null}
          selectedIds={predecessorIds}
          disabled={busy || blocked}
          onAdd={(id) =>
            onPredecessors(canonicalPredecessorIds([...predecessorIds, id]))
          }
          onRemove={(id) =>
            onPredecessors(predecessorIds.filter((selected) => selected !== id))
          }
          onClose={() => {
            setPredecessorsOpen(false);
            chain.current?.focus();
          }}
        />
      )}
      {(scheduleOpen || scheduleMounted) && (
        <QuickSchedule
          inputDraft={inputDraft}
          onInputDraft={onInputDraft}
          open={scheduleOpen}
          resetVersion={resetVersion}
          onEdit={() => {
            rawVersion.current++;
            onRawEdit?.();
          }}
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
