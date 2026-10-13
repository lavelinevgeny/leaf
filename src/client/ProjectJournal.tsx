import { useEffect, useId, useLayoutEffect, useRef, useState } from 'react';
import type { Task } from '../shared/contracts.js';
import type { JournalProjectQuery } from '../shared/journal-contracts.js';
import { journalProjectQuerySchema } from '../shared/journal-contracts.js';
import type {
  JournalController,
  JournalDraftKey,
  JournalMetadata,
  JournalPosition,
} from './journal-state.js';
import { createDraftKey } from './journal-state.js';
import { JournalFeed } from './JournalFeed.js';
import { JournalEditor } from './JournalEditor.js';
import { JournalTaskPicker } from './JournalTaskPicker.js';
import { CalendarDateInput } from './CalendarDateInput.js';

const displayDate = (value: string) => value.split('-').reverse().join('.');
export function periodLabel(query: JournalProjectQuery) {
  if (query.from && query.to)
    return `${displayDate(query.from)} – ${displayDate(query.to)}`;
  if (query.from) return `с ${displayDate(query.from)}`;
  if (query.to) return `по ${displayDate(query.to)}`;
  return 'Все даты';
}
export function ProjectJournal({
  controller,
  disabled = false,
  visible = true,
  projectId,
  today,
  query,
  onQuery,
  onOpenTask,
  restorePosition,
  onPosition,
}: {
  restorePosition?: JournalPosition | undefined;
  onPosition?: ((position: JournalPosition) => void) | undefined;
  visible?: boolean;
  controller: JournalController;
  disabled?: boolean;
  projectId: string;
  today: string;
  query: JournalProjectQuery;
  onQuery: (query: JournalProjectQuery) => void;
  onOpenTask: (task: Task, trigger: HTMLElement) => void;
}) {
  const [periodOpen, setPeriodOpen] = useState(false);
  const composerHeading = useId();
  const periodTrigger = useRef<HTMLButtonElement>(null);
  const [key, setKey] = useState<JournalDraftKey | null>(() => {
    const pending = controller.pending;
    return pending?.key === createDraftKey(projectId, null)
      ? pending.key
      : null;
  });
  const [filters, setFilters] = useState(query);
  const [invalid, setInvalid] = useState(false);
  const composer = useRef<HTMLElement>(null),
    trigger = useRef<HTMLButtonElement>(null);
  const focusReturn = useRef<Element | null>(null);
  useEffect(() => {
    const cancel = () => {
      focusReturn.current = null;
    };
    const moved = (event: FocusEvent) => {
      if (event.target !== trigger.current) cancel();
    };
    document.addEventListener('pointerdown', cancel);
    document.addEventListener('keydown', cancel);
    document.addEventListener('focusin', moved);
    return () => {
      document.removeEventListener('pointerdown', cancel);
      document.removeEventListener('keydown', cancel);
      document.removeEventListener('focusin', moved);
    };
  }, []);
  useLayoutEffect(() => {
    const owned = focusReturn.current,
      button = trigger.current;
    if (!owned || !button || key) return;
    if (
      !button.isConnected ||
      button.closest('[hidden]') ||
      (document.activeElement !== owned &&
        document.activeElement !== document.body &&
        document.activeElement !== button)
    ) {
      focusReturn.current = null;
      return;
    }
    if (button.disabled) return;
    focusReturn.current = null;
    button.focus();
  });
  const feed = controller.projectFeed;
  const metadata = feed?.metadata;
  // A new period, reset or Back/Forward reloads the feed without metadata.
  // The open composer stays mounted on the last metadata of this project;
  // `coherent` below keeps its picker and editor disabled until the reload
  // returns, so the kept task list is only shown, never used for a write.
  const [keptMetadata, setKeptMetadata] = useState<JournalMetadata | null>(
    metadata ?? null,
  );
  useEffect(() => {
    if (metadata) setKeptMetadata(metadata);
  }, [metadata]);
  const composerMetadata =
    metadata ??
    (keptMetadata?.projectId === projectId ? keptMetadata : undefined);
  // A project switch keeps this component mounted: the composer never shows
  // another project's draft, already in the render of the switch. The draft
  // itself stays in RAM (D21).
  const shownKey = key?.startsWith(`project:${projectId}:`) ? key : null;
  const draft = shownKey ? controller.getDraft(shownKey) : undefined;
  useEffect(() => setFilters(query), [query]);
  // Initial focus is a one-shot request of an "Добавить запись" press (also a
  // repeated one): the task picker while no task is chosen, otherwise the
  // text field. `ready` covers metadata arriving after the click; a later
  // metadata reload never moves focus on its own.
  const [focusRequest, setFocusRequest] = useState(0);
  const focusPending = useRef(false);
  const ready = !!(shownKey && draft && composerMetadata);
  const hasTask = !!draft?.taskId;
  useEffect(() => {
    const node = composer.current;
    if (!focusPending.current || !ready || !node) return;
    focusPending.current = false;
    (hasTask
      ? node.querySelector<HTMLElement>('[data-journal-body]')
      : node.querySelector<HTMLElement>('[data-journal-picker-trigger]')
    )?.focus();
  }, [ready, focusRequest]);
  // Returning to the previous project later shows the composer closed (5.7).
  const shownProject = useRef(projectId);
  useEffect(() => {
    if (shownProject.current === projectId) return;
    shownProject.current = projectId;
    focusPending.current = false;
    setKey(null);
  }, [projectId]);
  function close() {
    if (controller.writing || controller.pending) return;
    closeAfterSave();
  }
  function closeAfterSave() {
    const active = document.activeElement;
    focusReturn.current =
      active === document.body ||
      active === trigger.current ||
      (active && composer.current?.contains(active))
        ? active
        : null;
    focusPending.current = false;
    setKey(null);
  }
  function closePeriod() {
    setPeriodOpen(false);
    setInvalid(false);
    periodTrigger.current?.focus();
  }
  function apply() {
    const parsed = journalProjectQuerySchema.safeParse({
      ...(filters.q ? { q: filters.q } : {}),
      ...(filters.from ? { from: filters.from } : {}),
      ...(filters.to ? { to: filters.to } : {}),
    });
    setInvalid(!parsed.success);
    if (parsed.success) {
      onQuery(parsed.data);
      setPeriodOpen(false);
      periodTrigger.current?.focus();
    }
  }
  const coherent =
    !!metadata &&
    metadata.revision === feed?.page?.projectRevision &&
    !['stale', 'metadata-error', 'error', 'loading'].includes(feed.phase);
  return (
    <div className="project-journal">
      <form
        className="journal-controls"
        onSubmit={(event) => {
          event.preventDefault();
          apply();
        }}
      >
        <button
          type="button"
          className="primary"
          ref={trigger}
          data-journal-add
          disabled={
            !coherent ||
            !metadata?.tasks.length ||
            controller.writing ||
            !!controller.pending
          }
          onClick={() => {
            focusPending.current = true;
            setKey(controller.openCreate(projectId, null, today));
            setFocusRequest((n) => n + 1);
          }}
        >
          <span aria-hidden="true">+ </span>Добавить запись
        </button>
        <div className="journal-period">
          <button
            ref={periodTrigger}
            type="button"
            aria-expanded={periodOpen}
            aria-label={`Период: ${periodLabel(query)}`}
            onClick={() => (periodOpen ? closePeriod() : setPeriodOpen(true))}
          >
            {periodLabel(query)}
          </button>
          {periodOpen && (
            <div
              role="group"
              aria-label="Период журнала"
              className="journal-period-popover"
              onKeyDown={(event) => {
                if (event.key === 'Escape') {
                  event.preventDefault();
                  event.stopPropagation();
                  closePeriod();
                }
              }}
            >
              <CalendarDateInput
                label="С даты"
                value={filters.from ?? ''}
                onChange={(value) =>
                  setFilters({ ...filters, from: value ?? '' })
                }
              />
              <CalendarDateInput
                label="По дату"
                value={filters.to ?? ''}
                onChange={(value) =>
                  setFilters({ ...filters, to: value ?? '' })
                }
              />
              <button type="submit">Применить</button>
            </div>
          )}
        </div>
        {(query.q?.trim() || query.from || query.to) && (
          <button
            type="button"
            onClick={() => {
              setFilters({});
              onQuery({});
              closePeriod();
            }}
          >
            Сбросить
          </button>
        )}
      </form>
      {invalid && (
        <p role="alert" id="journal-period-error">
          Проверьте период: начальная дата не должна быть позже конечной.
        </p>
      )}
      {metadata && !metadata.tasks.length && (
        <p>Сначала создайте задачу, чтобы добавить запись.</p>
      )}
      {shownKey && draft && composerMetadata && (
        <section
          ref={composer}
          className="journal-composer"
          aria-labelledby={composerHeading}
          onKeyDown={(event) => {
            // Like the former <dialog>: composer keys never reach window
            // shortcuts (Escape closing the task panel, Ctrl/Cmd+Z undo).
            event.stopPropagation();
            if (event.key !== 'Escape' || event.defaultPrevented) return;
            event.preventDefault();
            close();
          }}
        >
          <h2 className="sr-only" id={composerHeading}>
            Новая запись журнала
          </h2>
          <JournalEditor
            draft={draft}
            controller={controller}
            disabled={disabled || !coherent}
            placeholder="Что сделали или узнали?"
            compactIdle
            onSaved={closeAfterSave}
            onCancel={() => close()}
            taskPicker={
              <JournalTaskPicker
                metadata={composerMetadata}
                value={draft.taskId}
                onChange={(taskId) =>
                  controller.changeDraft(draft.key, { taskId })
                }
                disabled={
                  disabled ||
                  !coherent ||
                  controller.writing ||
                  !!controller.pending
                }
              />
            }
          />
        </section>
      )}
      <p role="status" className="journal-notice">
        {controller.notice ?? ''}
      </p>
      {feed ? (
        <JournalFeed
          disabled={disabled}
          state={feed}
          controller={controller}
          onOpenTask={onOpenTask}
          showTaskTitles
          visible={visible}
          restorePosition={restorePosition}
          onPosition={onPosition}
        />
      ) : (
        <p role="status">Загрузка журнала…</p>
      )}
    </div>
  );
}
