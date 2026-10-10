import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { Task } from '../shared/contracts.js';
import type { JournalProjectQuery } from '../shared/journal-contracts.js';
import { journalProjectQuerySchema } from '../shared/journal-contracts.js';
import type {
  JournalController,
  JournalDraftKey,
  JournalPosition,
} from './journal-state.js';
import { createDraftKey } from './journal-state.js';
import { JournalFeed, journalUndoCopy } from './JournalFeed.js';
import { JournalEditor } from './JournalEditor.js';
import { JournalTaskPicker } from './JournalTaskPicker.js';
import { CalendarDateInput } from './CalendarDateInput.js';
export function ProjectJournal({
  controller,
  disabled = false,
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
  controller: JournalController;
  disabled?: boolean;
  projectId: string;
  today: string;
  query: JournalProjectQuery;
  onQuery: (query: JournalProjectQuery) => void;
  onOpenTask: (task: Task, trigger: HTMLElement) => void;
}) {
  const [periodOpen, setPeriodOpen] = useState(false);
  const periodTrigger = useRef<HTMLButtonElement>(null);
  const [key, setKey] = useState<JournalDraftKey | null>(() => {
    const pending = controller.pending;
    return pending?.key === createDraftKey(projectId, null)
      ? pending.key
      : null;
  });
  const [filters, setFilters] = useState(query);
  const [invalid, setInvalid] = useState(false);
  const dialog = useRef<HTMLDialogElement>(null),
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
  const draft = key ? controller.getDraft(key) : undefined;
  useEffect(() => setFilters(query), [query]);
  useEffect(() => {
    if (!key || !dialog.current) return;
    const node = dialog.current;
    node.showModal?.();
    if (!node.open) node.setAttribute('open', '');
    const overflow = document.body.style.overflow,
      padding = document.body.style.paddingRight;
    const gap = window.innerWidth - document.documentElement.clientWidth;
    document.body.style.overflow = 'hidden';
    if (gap > 0) document.body.style.paddingRight = `${gap}px`;
    return () => {
      node.close?.();
      document.body.style.overflow = overflow;
      document.body.style.paddingRight = padding;
    };
  }, [key, !!draft, !!metadata]);
  function close() {
    if (controller.writing || controller.pending) return;
    closeAfterSave();
  }
  function closeAfterSave() {
    const active = document.activeElement;
    focusReturn.current =
      active === document.body ||
      active === trigger.current ||
      (active && dialog.current?.contains(active))
        ? active
        : null;
    setKey(null);
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
        <div className="journal-period">
          <button
            ref={periodTrigger}
            type="button"
            aria-expanded={periodOpen}
            onClick={() => setPeriodOpen(!periodOpen)}
          >
            Период{query.from || query.to ? ' •' : ''}
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
                  setPeriodOpen(false);
                  periodTrigger.current?.focus();
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
        <button
          type="button"
          onClick={() => {
            setFilters({});
            setInvalid(false);
            onQuery({});
          }}
        >
          Сбросить
        </button>
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
          onClick={() => setKey(controller.openCreate(projectId, null, today))}
        >
          Добавить запись
        </button>
      </form>
      {invalid && (
        <p role="alert" id="journal-period-error">
          Проверьте период: начальная дата не должна быть позже конечной.
        </p>
      )}
      {metadata && !metadata.tasks.length && (
        <p>Сначала создайте задачу, чтобы добавить запись.</p>
      )}
      <p className="journal-hint">{journalUndoCopy}</p>
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
          restorePosition={restorePosition}
          onPosition={onPosition}
        />
      ) : (
        <p role="status">Загрузка журнала…</p>
      )}
      {key && draft && metadata && (
        <dialog
          ref={dialog}
          className="journal-dialog"
          aria-label="Новая запись журнала"
          aria-modal="true"
          onCancel={(event) => {
            event.preventDefault();
            event.stopPropagation();
            close();
          }}
          onKeyDown={(event) => {
            event.stopPropagation();
            if (event.key === 'Escape') {
              event.preventDefault();
              close();
            }
            if (event.key === 'Tab') {
              const controls = [
                ...event.currentTarget.querySelectorAll<HTMLElement>(
                  'button:not(:disabled),input:not(:disabled),textarea:not(:disabled),[tabindex="0"]',
                ),
              ];
              const first = controls[0],
                last = controls.at(-1);
              if (event.shiftKey && document.activeElement === first) {
                event.preventDefault();
                last?.focus();
              } else if (!event.shiftKey && document.activeElement === last) {
                event.preventDefault();
                first?.focus();
              }
            }
          }}
        >
          <h2>Новая запись</h2>
          <JournalEditor
            draft={draft}
            controller={controller}
            disabled={disabled || !coherent}
            onSaved={closeAfterSave}
            onCancel={() => close()}
            taskPicker={
              <JournalTaskPicker
                metadata={metadata}
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
        </dialog>
      )}
    </div>
  );
}
