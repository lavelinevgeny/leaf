import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { Task } from '../shared/contracts.js';
import type {
  JournalController,
  JournalDraftKey,
  JournalFeedState,
  JournalPosition,
} from './journal-state.js';
import { journalFeedCoherent } from './journal-state.js';
import { JournalEditor, JournalConflict } from './JournalEditor.js';
import { ActionMenu } from './ActionMenu.js';
import { JournalEntryBody } from './JournalEntryBody.js';
export function JournalFeed({
  state,
  controller,
  disabled = false,
  visible = true,
  onOpenTask,
  showTaskTitles,
  collapseBodies = false,
  restorePosition,
  onPosition,
  scrollContainer,
}: {
  scrollContainer?: HTMLElement | null | undefined;
  visible?: boolean;
  restorePosition?: JournalPosition | undefined;
  onPosition?: ((position: JournalPosition) => void) | undefined;
  state: JournalFeedState;
  controller: JournalController;
  disabled?: boolean;
  onOpenTask: (task: Task, trigger: HTMLElement) => void;
  showTaskTitles: boolean;
  collapseBodies?: boolean;
}) {
  const [editing, setEditing] = useState<JournalDraftKey | null>(() => {
    const pending = controller.pending;
    return pending?.method === 'PATCH' &&
      pending.projectId === state.scope.projectId &&
      (!state.scope.taskId || pending.sentDraft.taskId === state.scope.taskId)
      ? pending.key
      : null;
  });
  const [menu, setMenu] = useState<string | null>(null);
  // Tail-page rows may briefly disappear during refresh and editor rows replace
  // their body component. Keep disclosure state with this task-scoped feed.
  const [expandedEntries, setExpandedEntries] = useState<Set<string>>(
    () => new Set(),
  );
  const root = useRef<HTMLDivElement>(null);
  // Hidden DOM has zero rectangles and may clamp scroll while a refreshed page
  // replaces loaded rows. Keep the last actual visible position independently.
  const lastVisible = useRef<JournalPosition | null>(null);
  const restoration = useRef<JournalPosition | null>(null);
  const previous = useRef(state);
  const scope = state.scope.taskId ? 'task' : 'project';
  const blocked = disabled || controller.writing || !!controller.pending;
  const coherent = journalFeedCoherent(state);
  function readPosition(): JournalPosition | null {
    const node = root.current;
    if (!node || node.closest('[hidden]')) return null;
    const owner = scrollContainer ?? node;
    const top = owner.getBoundingClientRect().top;
    const entry = [
      ...node.querySelectorAll<HTMLElement>('[data-journal-entry]'),
    ].find((item) => item.getBoundingClientRect().bottom > top);
    return {
      id: entry?.dataset.journalEntry ?? null,
      date: entry?.dataset.workDate ?? null,
      offset: entry ? entry.getBoundingClientRect().top - top : 0,
      top: owner.scrollTop,
      left: owner.scrollLeft,
    };
  }
  function capturePosition() {
    if (restoration.current || !coherent) return;
    const position = readPosition();
    if (!position) return;
    lastVisible.current = position;
    onPosition?.(position);
  }
  useEffect(() => {
    const cancel = () => {
      // Navigation back to this tab must not cancel its pending restoration.
      if (root.current?.closest('[hidden]')) return;
      restoration.current = null;
    };
    const focusin = (event: FocusEvent) => {
      // Programmatic focus on the feed itself (dismissed menu) is not navigation.
      if (event.target !== root.current) cancel();
    };
    document.addEventListener('pointerdown', cancel);
    document.addEventListener('focusin', focusin);
    const node = scrollContainer ?? root.current;
    node?.addEventListener('wheel', cancel);
    const keyboard = (event: KeyboardEvent) => {
      if (
        ['ArrowUp', 'ArrowDown', 'PageUp', 'PageDown', 'Home', 'End'].includes(
          event.key,
        )
      )
        cancel();
    };
    node?.addEventListener('keydown', keyboard);
    return () => {
      document.removeEventListener('pointerdown', cancel);
      document.removeEventListener('focusin', focusin);
      node?.removeEventListener('wheel', cancel);
      node?.removeEventListener('keydown', keyboard);
    };
  }, [scrollContainer]);
  useEffect(() => {
    const owner = scrollContainer ?? root.current;
    owner?.addEventListener('scroll', capturePosition);
    return () => owner?.removeEventListener('scroll', capturePosition);
  });
  useLayoutEffect(() => {
    // Each explicit history event supplies a new object; consumed requests are
    // not replayed by later renders or ordinary tab switches.
    restoration.current = restorePosition ?? null;
  }, [restorePosition]);
  useLayoutEffect(() => {
    if (
      !restoration.current &&
      (state.phase === 'loading' || state.phase === 'loading-more') &&
      previous.current.phase !== 'loading' &&
      previous.current.phase !== 'loading-more'
    )
      restoration.current = readPosition() ?? lastVisible.current;
    previous.current = state;
    const node = root.current;
    if (!visible || !node || node.closest('[hidden]')) return;
    if (!coherent || !['ready', 'empty', 'no-match'].includes(state.phase))
      return;
    const requested = restoration.current;
    const restore = () => {
      if (
        !node.isConnected ||
        node.closest('[hidden]') ||
        restoration.current !== requested
      )
        return;
      const owner = scrollContainer ?? node;
      const saved = restoration.current;
      if (saved) {
        const entry = saved.id
          ? node.querySelector<HTMLElement>(
              `[data-journal-entry="${saved.id}"]`,
            )
          : null;
        if (entry) {
          const target =
            owner.scrollTop +
            entry.getBoundingClientRect().top -
            owner.getBoundingClientRect().top -
            saved.offset;
          if (
            target > owner.scrollHeight - owner.clientHeight + 1 &&
            state.page?.nextCursor
          ) {
            void controller.loadMore(scope);
            return;
          }
          owner.scrollTop = target;
          owner.scrollLeft = saved.left;
        } else if (saved.id && state.page?.nextCursor) {
          void controller.loadMore(scope);
          return;
        } else {
          const group = saved.date
            ? node.querySelector<HTMLElement>(
                `[data-journal-date="${saved.date}"]`,
              )
            : null;
          owner.scrollTop = group
            ? owner.scrollTop +
              group.getBoundingClientRect().top -
              owner.getBoundingClientRect().top
            : saved.id
              ? 0
              : saved.top;
          owner.scrollLeft = saved.left;
        }
        restoration.current = null;
      }
      capturePosition();
    };
    // New task-body rows measure overflow in layout effects and may add their
    // disclosure button in a second commit. Restore against that final height.
    if (collapseBodies && restoration.current) {
      const frame = requestAnimationFrame(restore);
      return () => cancelAnimationFrame(frame);
    }
    restore();
  }, [state, visible, restorePosition, scrollContainer, collapseBodies]);
  const entries = state.page?.entries ?? [];
  const draft = editing ? controller.getDraft(editing) : undefined;
  const confirmation = controller.deleteConfirmation;
  async function finishDelete(id: string, action: () => Promise<boolean>) {
    const index = entries.findIndex((entry) => entry.id === id),
      neighbor = entries[index + 1] ?? entries[index - 1];
    const owned = document.activeElement;
    if (!(await action())) return;
    requestAnimationFrame(() => {
      if (
        !root.current?.isConnected ||
        root.current.closest('[hidden]') ||
        (document.activeElement !== owned &&
          document.activeElement !== document.body)
      )
        return;
      (neighbor
        ? root.current.querySelector<HTMLButtonElement>(
            `[data-journal-menu="${neighbor.id}"]`,
          )
        : document.querySelector<HTMLButtonElement>('[data-journal-add]')
      )?.focus();
    });
  }
  const restoreMenu = (id: string) => {
    setEditing(null);
    setMenu(null);
    const owned = document.activeElement;
    requestAnimationFrame(() => {
      if (
        document.activeElement !== owned &&
        document.activeElement !== document.body
      )
        return;
      if (root.current?.closest('[hidden]')) return;
      root.current
        ?.querySelector<HTMLButtonElement>(`[data-journal-menu="${id}"]`)
        ?.focus();
    });
  };
  const focusInEntry = (id: string, selector: string) => {
    const owned = document.activeElement;
    requestAnimationFrame(() => {
      // Same guards as restoreMenu: a hidden feed or a later focus choice wins.
      if (
        root.current?.closest('[hidden]') ||
        (document.activeElement !== owned &&
          document.activeElement !== document.body)
      )
        return;
      // A silently refused action leaves no target: keep focus on the trigger,
      // or on the feed itself when the trigger is disabled.
      const trigger = root.current?.querySelector<HTMLButtonElement>(
        `[data-journal-menu="${id}"]`,
      );
      (
        root.current?.querySelector<HTMLElement>(
          `[data-journal-entry-id="${id}"] ${selector}`,
        ) ?? (trigger && !trigger.disabled ? trigger : root.current)
      )?.focus({ preventScroll: true });
    });
  };
  return (
    <div
      ref={root}
      onScroll={capturePosition}
      className="journal-feed"
      data-journal-feed={scope}
      data-journal-scroll={scrollContainer ? undefined : ''}
      tabIndex={-1}
    >
      {['loading', 'loading-more'].includes(state.phase) && (
        <p role="status" className="journal-loading">
          Загрузка журнала…
        </p>
      )}
      {state.phase === 'empty' && (
        <p className="empty-state">Записей пока нет</p>
      )}
      {state.phase === 'no-match' && (
        <p className="empty-state">Нет записей по выбранным условиям</p>
      )}
      {state.error && (
        <div role="alert">
          <p>
            {controller.notice &&
            !controller.mutationError &&
            !controller.pending &&
            controller.lastWrite?.projectId === state.scope.projectId &&
            (!state.scope.taskId ||
              controller.lastWrite.taskId === state.scope.taskId) &&
            state.phase === 'error'
              ? `${controller.lastWrite.result === 'deleted' ? 'Запись удалена' : 'Запись сохранена'}. Не удалось обновить историю`
              : state.error}
          </p>
          <button
            type="button"
            onClick={() =>
              void (state.phase === 'more-error'
                ? controller.loadMore(scope)
                : controller.refresh())
            }
          >
            Повторить загрузку
          </button>
        </div>
      )}
      {draft && !entries.some((entry) => entry.id === draft.entryId) && (
        <div>
          <p role="status">
            Запись отсутствует в текущей ленте. Черновик сохранён.
          </p>
          <JournalEditor
            draft={draft}
            controller={controller}
            disabled={disabled}
            onSaved={() => setEditing(null)}
            onCancel={() => setEditing(null)}
          />
        </div>
      )}
      {confirmation &&
        confirmation.projectId === state.scope.projectId &&
        !entries.some((entry) => entry.id === confirmation.entry.id) && (
          <div>
            <p role="status">
              Подтверждение удаления сохранено; запись отсутствует в текущей
              ленте.
            </p>
            <button
              type="button"
              disabled={blocked}
              onClick={() => controller.cancelDelete()}
            >
              Отмена удаления
            </button>
            {controller.uncertain && (
              <button
                type="button"
                disabled={controller.writing}
                onClick={() =>
                  void finishDelete(confirmation.entry.id, () =>
                    controller.retry(),
                  )
                }
              >
                Повторить сохранение
              </button>
            )}
          </div>
        )}
      {entries.map((entry, index) => {
        const task = state.metadata?.tasks.find(
          (task) => task.id === entry.taskId,
        );
        return (
          <section
            key={entry.id}
            data-journal-entry={entry.id}
            data-journal-entry-id={entry.id}
            data-work-date={entry.workDate}
            className="journal-entry"
          >
            {entries[index - 1]?.workDate !== entry.workDate && (
              <h3 data-journal-date={entry.workDate}>
                {entry.workDate.split('-').reverse().join('.')}
              </h3>
            )}
            <article>
              <header>
                {showTaskTitles && (
                  <button
                    type="button"
                    className="journal-task-link"
                    disabled={!coherent || !task || blocked}
                    onClick={(event) => {
                      if (task) onOpenTask(task, event.currentTarget);
                    }}
                  >
                    {task?.title ?? 'Загрузка задачи…'}
                  </button>
                )}
                <ActionMenu
                  className="journal-entry-menu"
                  label={`Действия записи ${entry.workDate}`}
                  open={menu === entry.id}
                  onOpenChange={(open) => setMenu(open ? entry.id : null)}
                  disabled={!coherent || blocked}
                  triggerData={{ 'data-journal-menu': entry.id }}
                  items={[
                    {
                      id: 'edit',
                      label: 'Редактировать запись',
                      onSelect: () => {
                        const key = controller.openEdit(
                          entry,
                          state.page!.journalRevision,
                        );
                        if (!key) return false;
                        setEditing(key);
                        focusInEntry(
                          entry.id,
                          '[data-journal-editor] textarea',
                        );
                      },
                    },
                    {
                      id: 'delete',
                      label: 'Удалить запись',
                      tone: 'danger',
                      separatorBefore: true,
                      onSelect: () => {
                        // Same refusal as the disabled trigger: no write in flight.
                        if (blocked) return false;
                        controller.askDelete(
                          entry,
                          state.page!.journalRevision,
                        );
                        focusInEntry(entry.id, '[data-journal-cancel-delete]');
                      },
                    },
                  ]}
                />
              </header>
              {draft?.entryId === entry.id ? (
                <JournalEditor
                  draft={draft}
                  controller={controller}
                  disabled={disabled || !coherent}
                  onSaved={() => restoreMenu(entry.id)}
                  onCancel={() => restoreMenu(entry.id)}
                />
              ) : collapseBodies ? (
                <JournalEntryBody
                  body={entry.body}
                  expanded={expandedEntries.has(entry.id)}
                  onExpandedChange={(expanded) =>
                    setExpandedEntries((previous) => {
                      const next = new Set(previous);
                      if (expanded) next.add(entry.id);
                      else next.delete(entry.id);
                      return next;
                    })
                  }
                />
              ) : (
                <p className="journal-body">{entry.body}</p>
              )}
              {confirmation?.entry.id === entry.id &&
                confirmation.projectId === state.scope.projectId && (
                  <div role="group" aria-label="Подтверждение удаления записи">
                    <p>
                      Удалить эту запись? Отмена плана её не восстанавливает.
                    </p>
                    {controller.activeConflictKey && (
                      <JournalConflict
                        controller={controller}
                        draftKey={controller.activeConflictKey}
                      />
                    )}
                    <button
                      type="button"
                      disabled={blocked || !!controller.activeConflictKey}
                      onClick={() =>
                        void finishDelete(entry.id, () =>
                          controller.confirmDelete(),
                        )
                      }
                    >
                      Подтвердить удаление записи
                    </button>
                    <button
                      type="button"
                      data-journal-cancel-delete
                      disabled={blocked}
                      onClick={() => {
                        controller.cancelDelete();
                        restoreMenu(entry.id);
                      }}
                    >
                      Отмена удаления
                    </button>
                    {controller.mutationError && (
                      <p role="alert">{controller.mutationError}</p>
                    )}
                    {controller.uncertain && (
                      <button
                        type="button"
                        disabled={controller.writing}
                        onClick={() =>
                          void finishDelete(confirmation.entry.id, () =>
                            controller.retry(),
                          )
                        }
                      >
                        Повторить сохранение
                      </button>
                    )}
                  </div>
                )}
            </article>
          </section>
        );
      })}
      {state.page?.nextCursor && (
        <button
          type="button"
          disabled={state.phase === 'loading-more' || !coherent}
          onClick={() => void controller.loadMore(scope)}
        >
          Показать ещё
        </button>
      )}
    </div>
  );
}
