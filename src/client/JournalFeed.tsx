import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { Task } from '../shared/contracts.js';
import type {
  JournalController,
  JournalDraftKey,
  JournalFeedState,
  JournalPosition,
} from './journal-state.js';
import { JournalEditor, JournalConflict } from './JournalEditor.js';
export const journalUndoCopy =
  'Записи редактируются и удаляются отдельно; отмена в шапке относится к плану';
export function JournalFeed({
  state,
  controller,
  disabled = false,
  onOpenTask,
  showTaskTitles,
  restorePosition,
  onPosition,
}: {
  restorePosition?: JournalPosition | undefined;
  onPosition?: ((position: JournalPosition) => void) | undefined;
  state: JournalFeedState;
  controller: JournalController;
  disabled?: boolean;
  onOpenTask: (task: Task, trigger: HTMLElement) => void;
  showTaskTitles: boolean;
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
  const root = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!menu) return;
    const close = (event: PointerEvent) => {
      if (
        !(event.target instanceof Element) ||
        !event.target.closest('[role=menu], [data-journal-menu]')
      )
        setMenu(null);
    };
    document.addEventListener('pointerdown', close);
    return () => document.removeEventListener('pointerdown', close);
  }, [menu]);
  const anchor = useRef<{
    id: string;
    date: string;
    offset: number;
    left: number;
    top: number;
  } | null>(null);
  const restoration = useRef<JournalPosition | null>(null);
  useEffect(() => {
    const cancel = () => {
      restoration.current = null;
      anchor.current = null;
    };
    document.addEventListener('pointerdown', cancel);
    document.addEventListener('focusin', cancel);
    root.current?.addEventListener('wheel', cancel);
    const node = root.current;
    return () => {
      document.removeEventListener('pointerdown', cancel);
      document.removeEventListener('focusin', cancel);
      node?.removeEventListener('wheel', cancel);
    };
  }, []);
  useLayoutEffect(() => {
    restoration.current = restorePosition ?? null;
  }, [restorePosition]);
  useLayoutEffect(() => {
    const saved = restoration.current,
      node = root.current;
    if (
      !saved ||
      !node ||
      !['ready', 'empty', 'no-match'].includes(state.phase)
    )
      return;
    const entry = saved.id
      ? node.querySelector<HTMLElement>(`[data-journal-entry="${saved.id}"]`)
      : null;
    if (entry) {
      node.scrollTop +=
        entry.getBoundingClientRect().top -
        node.getBoundingClientRect().top -
        saved.offset;
      node.scrollLeft = saved.left;
      restoration.current = null;
    } else if (saved.id && state.page?.nextCursor) {
      void controller.loadMore(state.scope.taskId ? 'task' : 'project');
    } else {
      const group = saved.date
        ? node.querySelector<HTMLElement>(`[data-journal-date="${saved.date}"]`)
        : null;
      node.scrollTop = group ? group.offsetTop : saved.id ? 0 : saved.top;
      node.scrollLeft = saved.left;
      restoration.current = null;
    }
  }, [state, restorePosition]);
  function capturePosition() {
    const node = root.current;
    if (!node || restoration.current) return;
    const top = node.getBoundingClientRect().top;
    const entry = [
      ...node.querySelectorAll<HTMLElement>('[data-journal-entry]'),
    ].find((item) => item.getBoundingClientRect().bottom > top);
    onPosition?.({
      id: entry?.dataset.journalEntry ?? null,
      date: entry?.dataset.workDate ?? null,
      offset: entry ? entry.getBoundingClientRect().top - top : 0,
      top: node.scrollTop,
      left: node.scrollLeft,
    });
  }
  const previous = useRef(state);
  const scope = state.scope.taskId ? 'task' : 'project';
  const blocked = disabled || controller.writing || !!controller.pending;
  const coherent =
    state.page &&
    state.metadata &&
    state.page.projectRevision === state.metadata.revision &&
    !['stale', 'metadata-error', 'error', 'loading'].includes(state.phase);
  useLayoutEffect(() => {
    if (
      !anchor.current &&
      !restoration.current &&
      (state.phase === 'loading' || state.phase === 'loading-more') &&
      previous.current.phase !== 'loading' &&
      previous.current.phase !== 'loading-more'
    ) {
      const node = root.current;
      if (node) {
        const top = node.getBoundingClientRect().top;
        const entry = [
          ...node.querySelectorAll<HTMLElement>('[data-journal-entry]'),
        ].find((item) => item.getBoundingClientRect().bottom > top);
        anchor.current = entry
          ? {
              id: entry.dataset.journalEntry!,
              date: entry.dataset.workDate!,
              offset: entry.getBoundingClientRect().top - top,
              left: node.scrollLeft,
              top: node.scrollTop,
            }
          : null;
      }
    }
    if (
      state.phase === 'ready' &&
      previous.current.page !== state.page &&
      anchor.current &&
      root.current
    ) {
      const saved = anchor.current;
      const node = root.current;
      const entry = node.querySelector<HTMLElement>(
        `[data-journal-entry="${saved.id}"]`,
      );
      if (entry) {
        node.scrollTop +=
          entry.getBoundingClientRect().top -
          node.getBoundingClientRect().top -
          saved.offset;
        node.scrollLeft = saved.left;
        anchor.current = null;
      } else if (state.page?.nextCursor) {
        void controller.loadMore(scope);
      } else {
        const group = node.querySelector<HTMLElement>(
          `[data-journal-date="${saved.date}"]`,
        );
        node.scrollTop = group ? group.offsetTop : 0;
        node.scrollLeft = saved.left;
        anchor.current = null;
      }
    }
    previous.current = state;
  }, [state]);
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
  return (
    <div
      ref={root}
      onScroll={capturePosition}
      className="journal-feed"
      data-journal-feed={scope}
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
          <p>{state.error}</p>
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
                <button
                  type="button"
                  data-journal-menu={entry.id}
                  aria-label={`Действия записи ${entry.workDate}`}
                  aria-haspopup="menu"
                  aria-expanded={menu === entry.id}
                  disabled={!coherent || blocked}
                  onClick={() => setMenu(menu === entry.id ? null : entry.id)}
                >
                  ⋯
                </button>
              </header>
              {menu === entry.id && (
                <div
                  role="menu"
                  aria-label="Действия записи"
                  onKeyDown={(event) => {
                    event.stopPropagation();
                    if (event.key === 'Escape') {
                      event.preventDefault();
                      restoreMenu(entry.id);
                    }
                    if (
                      ['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(
                        event.key,
                      )
                    ) {
                      event.preventDefault();
                      const buttons = [
                        ...event.currentTarget.querySelectorAll<HTMLButtonElement>(
                          'button',
                        ),
                      ];
                      const index = buttons.indexOf(
                        document.activeElement as HTMLButtonElement,
                      );
                      buttons[
                        event.key === 'Home'
                          ? 0
                          : event.key === 'End'
                            ? buttons.length - 1
                            : (index +
                                (event.key === 'ArrowDown'
                                  ? 1
                                  : buttons.length - 1)) %
                              buttons.length
                      ]?.focus();
                    }
                  }}
                >
                  <button
                    role="menuitem"
                    type="button"
                    autoFocus
                    onClick={() => {
                      setEditing(
                        controller.openEdit(entry, state.page!.journalRevision),
                      );
                      setMenu(null);
                    }}
                  >
                    Редактировать запись
                  </button>
                  <button
                    role="menuitem"
                    type="button"
                    onClick={() => {
                      controller.askDelete(entry, state.page!.journalRevision);
                      setMenu(null);
                    }}
                  >
                    Удалить запись
                  </button>
                </div>
              )}
              {draft?.entryId === entry.id ? (
                <JournalEditor
                  draft={draft}
                  controller={controller}
                  disabled={disabled || !coherent}
                  onSaved={() => restoreMenu(entry.id)}
                  onCancel={() => restoreMenu(entry.id)}
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
