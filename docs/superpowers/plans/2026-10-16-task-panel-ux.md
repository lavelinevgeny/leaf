# Compact task panel UX Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Реализовать компактную карточку D22 с тремя вкладками, доступным сохранением общего черновика и сохранением действующих контрактов FS, журнала и навигации.

**Architecture:** TaskPanel остаётся единственным владельцем task draft, baseline и sent snapshot; App сохраняет владение командой, revision, pending envelope и RAM-навигацией. Локальные представления шапки/footer/сроков получают значения и callbacks, не пишут в API. Серверные контракты, SQLite и scheduler не меняются.

**Tech Stack:** существующие TypeScript, React, CSS tokens, Vitest/Testing Library и Playwright с syntheticRuntime; Fastify/SQLite используются существующими E2E без новых зависимостей.

**Spec:** [task-panel-ux, 2026-10-15](../specs/2026-10-15-task-panel-ux-design.md), рабочий D22 в [DECISIONS](../../DECISIONS.md). Исходный docs commit: `15091e4`; код исследован на базе `7f476cd`.

## Global Constraints

- «Используются существующие API и модель данных.»
- «Новые поля задачи, миграции, типы зависимостей, библиотеки, автосохранение, автопланирование и изменения формул scheduler/CPM не входят в задачу.»
- «Единственные утверждённые визуальные референсы — три PNG из design/README.md.» Перед UI-работой открыть все три изображения; исключённый коллаж подзадач не использовать.
- «Один task draft содержит название, статус, описание, nullable source-поля и входящие predecessorIds.» Данные вводов, в том числе ошибочные, остаются в RAM.
- «Текущий контракт task.edit заменяет только входящие endpoints.» Исходящие FS — отдельные команды только при clean task draft.
- «Никаких текстов в localStorage/sessionStorage, URL, history.state или логах.»
- «Все сценарии используют независимые синтетические данные.» Expected dates — буквальные значения, не вызов проверяемого scheduler.
- «Это D22, а не утверждённые пиксельные размеры.» Desktop ориентир 480 CSS px, диапазон 420–520; viewport менее 900 px — полноэкранная карточка. Проверки 1440×900, 1280×800, 375×812, низкой высоты и 200% масштаба.
- Первый релиз и S4–S6 не объявляются завершёнными. Настоящий запрос разрешает подготовку/ревью плана; реализация начинается отдельной задачей владельца.

---

## Исполнение и границы задач

Шесть последовательных задач: 1 → 2 → 3 → 4 → 5 → 6. Все изменяют общую панель; параллельных writers не запускать. Каждый этап заканчивается работающим поведением, affected tests и проверкой точного SHA отдельными Spec/Standards reviewers; findings исправить и повторно проверить до следующего этапа. Основной checkout, без новых worktree. При старте проверить Git status и AGENTS; новую ветку от main создавать только после согласованного состояния checkout, не переключать текущую ветку поверх чужих изменений.

Минимальные gates каждого code commit: `npm run typecheck`, `npm run lint`, `npm run test:unit`, `npm run test:integration`, релевантные E2E из задачи, `git diff --check`, `npm run security:staged`; hooks не обходить. Коммитить только перечисленные файлы и фактический STATUS. Полный завершающий gate — Task 6. В этом документе команды описывают будущие проверки, а чекбоксы не означают выполнение.

Файлы и ответственность:

| Файл | Изменение |
| --- | --- |
| `src/client/TaskPanel.tsx` | Владелец draft/save/reset, три видимые вкладки, объединённое содержимое, навигационные callbacks |
| `src/client/TaskPanelHeader.tsx` (новый) | Путь, редактируемый заголовок, статус, trigger сроков, меню; только UI state |
| `src/client/TaskPanelFooter.tsx` (новый) | Зарезервированная зона состояния, Save/reset/repair; без API |
| `src/client/TaskPanelSchedule.tsx` (новый), `src/client/task-panel-view.ts` (новый) | Постоянно mounted редактор сроков, подписи реальных полей и нормализация видимой вкладки |
| `src/client/TaskMoveDialog.tsx` (новый) | Поиск родителя, корень, порядок/уровень, focus trap |
| `src/client/TaskLeaveDialog.tsx` (новый) | Три решения по dirty task draft, состояние ожидания/ошибки |
| `src/client/PlanFields.tsx`, `src/client/CalendarDateInput.tsx` | Структурированные локальные ошибки, адресный фокус, корректное завершение ввода |
| `src/client/Dependencies.tsx`, `src/client/PredecessorPicker.tsx`, `src/client/predecessor-view.ts` | Draft входящих рёбер, отдельные исходящие команды, один picker известного направления |
| `src/client/App.tsx`, `src/client/workspace-navigation.ts` | Guards/continuation, branch-return/URL aliases, сохранение RAM-контекста |
| `src/client/TaskJournal.tsx`, `src/client/JournalFeed.tsx`, `src/client/use-journal.ts`, `src/client/journal-state.ts` | Разделение подтверждения записи и ошибки GET, внешний scroll owner task feed |
| `src/client/QuickAdd.tsx`, `src/client/TaskTree.tsx` | Только необходимые интеграционные props для причины блокировки/точки добавления/фокуса; общий компонент сохраняется |
| `src/client/strings.ts`, `src/client/styles/app.css`, `src/client/styles/planning.css`, `src/client/styles/journal.css` | Локальные подписи и scoped layout, без нового UI framework |

Новые компоненты вводить вместе с первым потребителем. Не переносить всю App или общую state machine журнала ради чистоты кода. `PanelTab` и URL продолжают использовать `details | subtasks | dependencies | journal`: видимое имя «Задача» соответствует первым двум значениям.

## Task 1: Общая шапка, три вкладки и сохранение во всех вкладках

**Files:** создать `src/client/TaskPanelHeader.tsx`, `src/client/TaskPanelFooter.tsx`, `src/client/task-panel-view.ts`, `tests/client/task-panel.test.tsx`; изменить `src/client/TaskPanel.tsx`, `src/client/App.tsx`, `src/client/strings.ts`, `src/client/styles/app.css`, `src/client/styles/planning.css`, `tests/client/planning.test.tsx`, `tests/client/inline-add.test.tsx`, `tests/e2e/subtasks.spec.ts`, `docs/STATUS.md`.

**Interfaces:** сохранить `TaskPanel.onSave(changes): Promise<ProjectTree | null>`, `saveAcknowledgement`, `onDirty`, `onTab`. Новая локальная функция `visiblePanelTab(tab: PanelTab): 'details' | 'dependencies' | 'journal'`. Header получает controlled `title`, `status`, `onTitle`, `onStatus`; edit-session title snapshot отменяет только название. Footer получает `dirty`, `busy`, `retry`, `disabledReason: string | null`, `onSave`, `onReset`, `onRepair`; `feedback: ReactNode` остаётся отображением существующего результата команды.

- [ ] **1. Зафиксировать красные клиентские тесты общей карточки.** В новом тесте использовать `optionalTreeFixture`, `task`, `emptySchedule` из `tests/client/fixtures.ts`, новый локальный stateful harness с полным текущим Props TaskPanel по образцу harness в `planning.test.tsx`. Не экспортировать harness из тестового файла. Проверить ровно три tabs, редактируемое единственное название, status в шапке, footer на каждой вкладке, отсутствие POST при смене вкладки. Ключевые проверки после изменения title через кнопку «Изменить название»:

```tsx
expect(screen.getAllByRole('tab').map((tab) => tab.textContent)).toEqual([
  'Задача', 'Зависимости', 'Журнал',
]);
await user.click(screen.getByRole('tab', { name: 'Журнал', exact: true }));
expect(onSave).not.toHaveBeenCalled();
await user.click(screen.getByRole('button', { name: 'Сохранить', exact: true }));
expect(onSave).toHaveBeenCalledExactlyOnceWith({ title: 'Работа B' });
```

Дополнить действующие тесты canonical C25 ack/deferred draft: смена вкладки до ack, новый draft после отправки, stale GET, старый frozen ack при уже известной большей revision. Старый ack разрешает отправленную операцию, но не понижает tree/revision/baseline более нового состояния. Reset должен возвращать сохранённый baseline задачи, source и входящих IDs, а не произвольный новый `task` из GET. QuickAdd/journal drafts не сбрасываются. Проверить empty title/removed/canAdopt legacy: действующее явное принятие legacy-интервала остаётся доступно даже при clean, без неявной конвертации.
- [ ] **2. Запустить красный тест:** `npx vitest run tests/client/task-panel.test.tsx tests/client/planning.test.tsx`. Ожидаемый новый FAIL — четыре tabs и отсутствие Save в журнале; прежние atomic tests должны оставаться green.
- [ ] **3. Собрать постоянный каркас и controlled header/footer.** Использовать один `form id="task-panel-edit"` и footer button `form="task-panel-edit"`, не вкладывать QuickAdd/journal формы внутрь task form. Удалить повторный read-only h2 + title input; editable title сохраняет роль heading в режиме чтения и accessible label в редакторе. Escape восстанавливает снимок сессии title и останавливает bubbling. Title/description raw values остаются в TaskPanel, не в transient вкладке.

```ts
export function visiblePanelTab(tab: PanelTab) {
  return tab === 'subtasks' ? 'details' : tab;
}
// Reset работает с уже сохранённым baseline, не с текущим фоновым GET.
setDraft({ ...baseline });
setPlan({ ...baselinePlan });
setIncoming([...baselineIncoming]);
```

Объединить описание и существующий TaskTree + `subtaskInput` во вкладке «Задача». Пустое описание — «Добавить описание», непустое plain text, 4 строки/«Развернуть», textarea auto-size в общей прокрутке; Enter остаётся переносом. Состояния edit/expanded живут в панели. Подзадачи — полная ветка независимо от фильтра, счётчик direct children, одна верхняя точка добавления, исчезающая при открытом QuickAdd; сохранять C30/C31 и отдельный draft. Обновить App-условия `panelTab === 'subtasks'` для preview/focus и существующие selectors: alias `subtasks` показывает секцию внутри `panel-details`. Не показывать четвёртый tab.
- [ ] **4. Зафиксировать геометрию и доступность.** В header tabs ArrowLeft/Right/Home/End работают по массиву из трёх значений. `panel-content` — единственный основной scroll; header/footer вне него. Начальный CSS:

```css
.task-panel { display: flex; flex-direction: column; min-height: 0; }
.panel-header, .panel-tabs, .panel-footer { flex: 0 0 auto; }
.panel-content { flex: 1 1 auto; min-height: 0; overflow-y: auto; }
.panel-footer { min-height: 4.5rem; }
.panel-description { white-space: pre-wrap; overflow-wrap: anywhere; }
```

Убрать конфликтующие прежние правила по месту, не добавлять повторяющиеся override blocks. Временный старый блок сроков/структурных действий пока сохраняет доступность до Tasks 2–3; итоговый UX не объявлять завершённым.
- [ ] **5. Green и commit.** Запустить тесты шага 2, unit/integration/typecheck/lint gates, `npx playwright test tests/e2e/subtasks.spec.ts tests/e2e/inline-add.spec.ts tests/e2e/linked-plan-fields.spec.ts`. Обновить старые selectors с сохранением прежних проверок поведения, STATUS и коммит `feat: unify task panel tabs and persistent save controls`. Независимые exact-SHA reviews.

## Task 2: Меню карточки, перемещение и единая защита навигации

**Files:** создать `src/client/TaskMoveDialog.tsx`, `src/client/TaskLeaveDialog.tsx`, `tests/client/task-panel-navigation.test.tsx`; изменить `src/client/TaskPanel.tsx`, `src/client/TaskPanelHeader.tsx`, `src/client/App.tsx`, `src/client/workspace-navigation.ts`, при необходимости `src/client/ActionMenu.tsx`, `src/client/QuickAdd.tsx`, `src/client/strings.ts`, `src/client/styles/app.css`, `tests/e2e/action-menus.spec.ts`, `tests/e2e/journal-navigation.spec.ts`, `tests/e2e/subtasks.spec.ts`, `docs/STATUS.md`.

**Interfaces:** использовать `TreeAction` (`sibling/up/down/in/out/delete`), `onMove(task, parentId)`, `subtreeIds`, `treeRows`. Внутри client определить `TaskPanelActions = { save: () => Promise<boolean>; reset: () => void; focusInvalid: () => void }`; TaskPanel регистрирует их через `registerActions(actions: TaskPanelActions | null): void` на mount/unmount, App держит ref, не копию draft. `save()` возвращает true только после ack отправленного snapshot и отсутствия нового dirty draft; false при validation/failure/uncertain. App `requestTaskNavigation(proceed: () => void): void` сохраняет одну RAM continuation и task/project identity, никогда не сериализует callback в history.

- [ ] **1. Добавить тесты трёх решений и структурных операций.** В App fixture открыть задачу, изменить название, выбрать другую задачу; диалог `Несохранённые изменения задачи` содержит `Сохранить`, `Не сохранять`, `Продолжить редактирование`. Deferred save до resolve не меняет выбранную задачу; reject сохраняет текст, uncertain блокирует discard и close. Отдельно invalid title возвращает фокус к названию, discard остаётся доступен. Test шаги:

```tsx
await user.click(screen.getByRole('button', { name: 'Продолжить редактирование' }));
expect(screen.getByRole('textbox', { name: 'Название' })).toHaveValue('Работа B');
expect(commandCalls).toHaveLength(0);
```

`commandCalls` в App mock — массив только запросов POST `/commands`, не произвольных fetch. Дополнить сценариями Back/Forward, путь родителя, сосед, закрытие, смена проекта, отменённый dialog и stale continuation после logout. Проверить move search/path/root, self/descendants исключены, up/down/in/out disabled с причиной на границах, preserveWork и delete branch warning с журналом/Undo. Subtask create при dirty показывает «Сначала сохраните изменения задачи», оставляет QuickAdd editable и не отправляет команду.
- [ ] **2. Red:** `npx vitest run tests/client/task-panel-navigation.test.tsx tests/client/inline-add.test.tsx`. Новая проверка должна падать на отсутствии three-choice dialog, не на ошибке fixture.
- [ ] **3. Встроить меню и два доступных диалога.** ActionMenu items: sibling, move, show-on-Gantt, separator + delete. Удалить постоянные `task-actions`/`move-controls`/delete из content. Dialog move использует один search, путь, явное «В корень», `<details>` «Порядок и уровень»; использует текущие валидаторы команд в App до отправки, а не только исключение descendants. Отмена без записи, modal focus trap/Escape/restore trigger. Причины disabled видны рядом с меню/контролом и через aria-describedby без hover; расширять ActionMenu только необходимым необязательным prop, не ломая меню проекта/журнала.
- [ ] **4. Провести все навигационные входы через один guard.** Pending/uncertain и journal interlock проверяются раньше dirty dialog. Обычный dirty открывает dialog; Save вызывает зарегистрированный `save`, discard — `reset` task-only, continue — очищает continuation. После ack recheck identity/session/new draft до продолжения; при false оставить панель. Глобальную `canNavigate` не превращать в очередь writes: структурные/исходящие команды остаются заблокированными при dirty и не выполняются после скрытого Save. Основные функции `selectTask`, `selectSubtask`, `selectNeighbor`, `closePanel`, `showOnGantt`, parent links, project switching и popstate используют navigation guard.

```ts
const actions = panelActions.current;
if (!actions || !(await actions.save())) return;
// Проверить тот же task/project/session и отсутствие нового draft.
const next = pendingNavigation.current;
pendingNavigation.current = null;
next?.proceed();
```

Popstate сначала компенсирует history index существующим suppressedPop, сохраняет target только в RAM; после решения выполняет ровно один переход, cancel возвращает прежний URL. Сохранить parse старых `details/subtasks`; branch history дополнить scrollTop/scrollLeft и focusId, возврат в объединённую вкладку/секцию. У restore token отмена при ручном выборе фокуса/новой навигации; отсутствие строки → QuickAdd/заголовок секции. Underlying TaskTimeline/filter/collapse/scale/оба scroll и project feed anchor не сбрасывать.
- [ ] **5. Green и commit.** Тесты шага 2, стандартные gates, `npx playwright test tests/e2e/action-menus.spec.ts tests/e2e/journal-navigation.spec.ts tests/e2e/journal-drafts.spec.ts tests/e2e/subtasks.spec.ts`. STATUS; `feat: guard task panel navigation and consolidate actions`; оба review gates.

## Task 3: Один редактор реальных сроков из шапки

**Files:** создать `src/client/TaskPanelSchedule.tsx`, `tests/client/task-panel-schedule.test.tsx`; изменить `src/client/task-panel-view.ts`, `src/client/TaskPanelHeader.tsx`, `src/client/TaskPanel.tsx`, `src/client/PlanFields.tsx`, `src/client/CalendarDateInput.tsx`, `src/client/strings.ts`, `src/client/styles/planning.css`, `tests/client/planning.test.tsx`, `tests/client/quick-add.test.tsx`, `tests/e2e/linked-plan-fields.spec.ts`, `tests/e2e/optional-scheduling.spec.ts`, `docs/STATUS.md`.

**Interfaces:** `taskScheduleLabel(source: SourceFields, calendar: Project['calendarType']): string` форматирует только source; summary label — отдельная ветка по `schedule.summaries[id]`, не `schedule.display`. `PlanFieldError = { field: keyof SourceFields; message: string }`; необязательный `onErrorChange(error: PlanFieldError | null)` у PlanFields плюс существующий `onValidityChange`. Локальный `PlanFieldsHandle = { finishInput: () => boolean; focusField: (field: keyof SourceFields) => void }` через React ref для Done/repair; существующие QuickSchedule/QuickAdd потребители без ref продолжают работать.

- [ ] **1. Добавить table-driven тесты подписи и завершения ввода.** Включить пустые/date-only/duration-only/full/null duration, calendar units, valid summary/incomplete summary, done→doing, deleted. Таблица задаёт actual source и literal expected без formatter из production в expected:

```ts
expect(taskScheduleLabel({ inputStart: null, inputFinish: null, durationDays: 3 }, 'weekdays'))
  .toBe('Без дат · 3 раб. дня');
expect(taskScheduleLabel({ inputStart: null, inputFinish: null, durationDays: null }, 'all-days'))
  .toBe('Без дат');
```

В компоненте ввести `31.02.2026`, закрыть Escape, сменить вкладку, открыть — raw строка и поле ошибки сохранены, Save disabled, footer «Исправить сроки» фокусирует поле. Проверить нерабочее `10.10.2026`, start>finish, fractional/zero duration, очистку одного/всех полей. Отдельный C18 weekdays: начало `09.10.2026`, duration 2 → окончание `12.10.2026`; изменение начала на `12.10.2026` → `13.10.2026`; all-days тот же Friday +2 → `10.10.2026`. До blur/Enter/Done остальные поля не изменяются.
- [ ] **2. Red:** `npx vitest run tests/client/task-panel-schedule.test.tsx tests/client/planning.test.tsx`. Ожидается отсутствие нового header editor; существующие C18 тесты сохраняются.
- [ ] **3. Реализовать popover без второго источника draft.** TaskPanelSchedule остаётся mounted при закрытии и смене вкладки, а закрытая поверхность hidden/inert; PlanFields error/pending не теряются при unmount. TaskPanel хранит source и последнее структурированное error для footer. `finishInput` завершает активный raw buffer синхронно через тот же путь `completeSourceEdit`, возвращает validity текущих значений, а не устаревший React state. CalendarDateInput предоставляет commit/focus для текущего поля; не парсить повторно DOM в другом компоненте.

```tsx
<button type="button" onClick={() => {
  if (fields.current?.finishInput()) onClose();
}}>Готово</button>
```

`Готово` не пишет на сервер; Escape/outside-click сохраняют raw draft и локальную ошибку, `stopPropagation` закрывает только ближайший слой. Нативный calendar Escape проверить в браузере отдельно от текстового поля. Focus возвращается trigger, repair — ошибочному полю. «Сегодня»/«Завтра» используют `useProjectToday` + `shiftDate` и `completeSourceEdit`, без silent snapping; не брать timezone host. Clear-all задаёт три null и очищает связанную validation, не вызывает C18 с фиктивным anchor. После reset сбросить stale raw/errors без повторного commit старого focused input.
- [ ] **4. Довести подпись и locks.** Header не получает условный `display` как source. Полные ISO dates/year доступны в editor и accessible description. Summary без обоих computed endpoints показывает «Сводные сроки не определены», собственный editor отсутствует; done/removed/locked — доступная причина. Редактор позиционируется в viewport как существующий QuickSchedule, низкий экран допускает собственный scroll; новых пресетов кроме требуемых Today/Tomorrow/clear не добавлять.
- [ ] **5. Green и commit.** Тесты шага 2 + `tests/client/quick-add.test.tsx`, стандартные gates, `npx playwright test tests/e2e/linked-plan-fields.spec.ts tests/e2e/optional-scheduling.spec.ts tests/e2e/conditional-gantt.spec.ts`. STATUS; `feat: edit task dates from a persistent header popover`; оба review gates.

## Task 4: Draft входящих FS внутри настоящего графа

**Files:** изменить `src/client/Dependencies.tsx`, `src/client/PredecessorPicker.tsx`, `src/client/predecessor-view.ts`, `src/client/TaskPanel.tsx`, `src/client/strings.ts`, `src/client/styles/planning.css`, `tests/client/dependencies.test.tsx`, `tests/client/predecessor-picker.test.tsx`, `tests/client/predecessor-view.test.ts`, `tests/client/task-panel.test.tsx`, `tests/e2e/fs-dependencies.spec.ts`, `tests/e2e/explicit-cpm.spec.ts`, `docs/STATUS.md`.

**Interfaces:** Dependencies получает `incomingIds: readonly string[]`, `onIncomingChange(ids: string[]): void`, `taskDirty: boolean`, `scheduleDirty: boolean`; `disabled` означает hard block busy/locked/removed/conflict, не обычный dirty. Существующий `onCommand(Command): Promise<boolean>` вызывается только для исходящих create/delete. PredecessorPicker расширить discriminated direction: существующий default predecessor сохраняет `successorId`, новый successor требует `predecessorId`; shared search/render используется обоими режимами. `successorCandidates(tree: ProjectTree, predecessorId: string, query: string): PredecessorCandidate[]` использует `validateDependency(tree.tasks, tree.dependencies, predecessorId, candidate.id)`, пути и same-project leaf фильтр. Existing predecessor mode сохраняет projected incoming graph validation.

- [ ] **1. Добавить тесты направления и atomic draft.** A→C, B→C, C→D/E: отдельная стрелка каждого ребра, снятая A→C остаётся pending removal с восстановлением, новая связь помечена «Не сохранено». Счётчик tab считает saved incident edges, draft marker отдельно. На выборе predecessor нет команды; на Save ровно один task.edit со source/title/predecessorIds. Successor dirty блокируется с точной причиной, clean выбор отправляет dependency.create, remove outgoing — dependency.delete. Параллельные ветки не превращаются в цепочку. Self/duplicate/summary/другой project/cycle отсутствуют среди кандидатов, error/loading/no-match/no-leaves различаются.

```tsx
expect(onCommand).not.toHaveBeenCalled();
expect(onIncomingChange).toHaveBeenLastCalledWith([predecessor.id]);
expect(screen.getByText('Не сохранено')).toBeVisible();
```

Эти assertions выполняются после выбора кандидата в stateful Dependencies fixture, где `predecessor` — synthetic task, onIncomingChange обновляет incomingIds. Добавить серверный E2E C25: A `2026-10-05…2026-10-06`, B `2026-10-05…2026-10-05`; совместный title B + incoming A save → B `2026-10-07…2026-10-07`, одна revision, один Undo. При rejected cycle повторить с исходным tree/revision, никакие поля не изменены. Не использовать UI, запрещающий cycle, как единственное доказательство rollback: отправить через существующий `send` helper заведомо конфликтный envelope отдельно.
- [ ] **2. Red:** `npx vitest run tests/client/dependencies.test.tsx tests/client/predecessor-picker.test.tsx tests/client/task-panel.test.tsx`.
- [ ] **3. Перенести единственный incoming editor в Dependencies.** Удалить picker из старых Details. Кнопки «Добавить предшественника»/«Добавить последователя» задают направление при открытии, select направления/задач удалены. Draft overlay строится поверх saved графа, deleted saved edge остаётся для restore; critical flags/float относятся к сохранённым IDs. Не записывать временные ID рёбер в API. Summary — пояснение leaf-only и доступные переходы к leaf, без add actions. Под схемой `<details>` расчёта с существующим ScheduleStatus; `scheduleDirty` (source/status/incoming) показывает «По сохранённому плану», blocking field/conflict error остаётся снаружи collapsed details.
- [ ] **4. Сохранить acknowledgement/retry/rollback границы.** Incoming save идёт через существующий `TaskPanel.save` и `App.commandTree`; исходящие — через прежнюю command pipeline с guards. Тестировать lost response/retry одного operationId, frozen ack после более нового tree и нового draft. Не понижать revision, не чистить новый draft; refresh текущего tree отдельно от разрешения отправленного snapshot. `disabled` не должен блокировать редактирование входящего draft только потому, что он стал dirty.
- [ ] **5. Green и commit.** Тесты шага 2 и predecessor-view, стандартные gates, `npx playwright test tests/e2e/fs-dependencies.spec.ts tests/e2e/explicit-cpm.spec.ts tests/e2e/planning-ui.spec.ts`. STATUS; `feat: edit incoming dependencies atomically in the task graph`; оба review gates.

## Task 5: Независимые результаты журнала и одна прокрутка

**Files:** изменить `src/client/TaskJournal.tsx`, `src/client/JournalFeed.tsx`, `src/client/JournalEditor.tsx` только для нужного feedback, `src/client/use-journal.ts`, `src/client/journal-state.ts`, `src/client/TaskPanelHeader.tsx`, `src/client/TaskPanel.tsx`, `src/client/App.tsx`, `src/client/styles/journal.css`, `tests/client/journal-compact.test.tsx`, `tests/client/journal-coherence.test.tsx`, `tests/client/journal-drafts.test.tsx`, `tests/e2e/task-journal.spec.ts`, `tests/e2e/journal-drafts.spec.ts`, `docs/STATUS.md`.

**Interfaces:** существующие `JournalController.submit/retry/refresh`, draft keys и revisions сохраняются. Добавить `lastWrite: { projectId: string; taskId: string | null; operationId: string; result: 'saved' | 'deleted' } | null` в локальное состояние и controller; это подтверждение операции, не вторая очередь. Feed phase/error остаются независимыми. Для task JournalFeed добавить необязательный `scrollContainer: HTMLElement | null` (по умолчанию собственный root для project feed), передаваемый из panel-content; его используют anchor/load-more измерения, а не только CSS.

- [ ] **1. Тестировать ack отдельно от последующего GET.** В существующем journal hook harness POST/PATCH возвращает ack, следующий GET ленты ошибку. `submit` подтверждён, pending=null, draft очищен только если равен sent snapshot, mutationError не превращается в «не сохранено». UI: «Запись сохранена. Не удалось обновить историю», повтор вызывает только GET. Initial GET failure не показывает saved. Старый lastWrite другой задачи не отображается у текущего composer. Дополнить delete outcome, paginated more-error, 409 pinned baseline, uncertain/429 exact retry, stale ack/newer local draft, 401 и late response после logout.

```ts
expect(result.current.pending).toBeNull();
expect(result.current.uncertain).toBe(false);
expect(result.current.lastWrite?.result).toBe('saved');
expect(result.current.taskFeed?.phase).toBe('error');
```

`result` — существующий renderHook useJournal fixture из journal tests, не новый controller. Разрешить GET fail по конкретному URL/методу, не `mockImplementationOnce` на любой fetch.
- [ ] **2. Red:** `npx vitest run tests/client/journal-compact.test.tsx tests/client/journal-drafts.test.tsx tests/client/journal-coherence.test.tsx`.
- [ ] **3. Разделить mutation outcome и read outcome.** В `use-journal` сразу после ack фиксировать scoped lastWrite, обновлять revision floors через max, освобождать только подтверждённый pending и sent snapshot. Следующий refresh меняет только feed state; initial error и uncertain write отдельны. Notice вычислять по текущим scope/operation/phase, не сравнением текста сообщений. Reset нового draft не стирает историю подтверждения чужой операции, но stale lastWrite не должен подписывать новую ошибку записи как успех; показывать статус операции рядом с composer, ошибку чтения у ленты.
- [ ] **4. Подключить общий scroll и metadata.** В task journal отменить max-height/overflow feed и фиксированную высоту editor; autosize textarea внутри panel-content, load more и anchors используют переданный scroll owner. Project feed сохраняет собственный scroll. В header journal показывает сохранённый coherent title/path из metadata, а editable draft title отдельно отмечен как «Несохранённое название» при расхождении, не выдаётся за metadata записи. Путь передавать из того же metadata.tasks/revision, не dirty planning tree. Обычный task dirty не блокирует journal; pending/uncertain любой записи блокирует конкурирующие writes. Запись не двигает planning baseline, Undo не отменяет независимый журнал. Смена вкладки/close сохраняет RAM draft; 401/успешный logout очищает lastWrite вместе со всеми private refs.
- [ ] **5. Green и commit.** Тесты шага 2, стандартные gates, `npx playwright test tests/e2e/task-journal.spec.ts tests/e2e/journal-drafts.spec.ts tests/e2e/journal-navigation.spec.ts tests/e2e/action-menus.spec.ts`. STATUS; `fix: separate journal acknowledgements from feed refresh failures`; оба review gates.

## Task 6: Адаптивность, клавиатура и сквозная приёмка

**Files:** создать `tests/e2e/task-panel-ux.spec.ts`; изменить scoped layout `src/client/styles/app.css`, `src/client/styles/planning.css`, `src/client/styles/journal.css`, компоненты Tasks 1–5 только по выявленным дефектам, `tests/client/task-panel.test.tsx`, `tests/client/task-panel-navigation.test.tsx`, `docs/UI.md`, `docs/ACCEPTANCE.md`, `docs/STATUS.md`, `START_HERE.md`.

**Interfaces:** новых API/types нет. E2E fixture — существующий `syntheticRuntime` из `scripts/e2e-server.ts`, setup/cleanup pattern из `tests/e2e/fs-dependencies.spec.ts`, `readTree`/`send` из `tests/helpers/optional-e2e.ts`. Каждый test свой runtime, request Origin/contract headers и session; context закрывается до runtime. Пароль syntheticRuntime не печатать, HTTP bodies/trace/screenshots не публиковать.

- [ ] **1. Добавить actual-server E2E для геометрии и полного потока.** Новый файл создаёт длинные synthetic title/description, 30 descendants включая глубокую ветку, fan-in/out и journal pages. Проверяет все три вкладки, открытие overlay, dirty→clean, ошибки полей, Save→ack→Undo. Фиксировать только геометрию через evaluate/boundingBox; baseline screenshot не подменяет рабочую проверку. Пример assert после прокрутки `.panel-content` в конец:

```ts
const panel = page.getByRole('complementary', { name: 'Задача', exact: true });
const footer = panel.locator('.panel-footer');
const before = await footer.boundingBox();
await panel.locator('.panel-content').evaluate((node) => { node.scrollTop = node.scrollHeight; });
expect(await footer.boundingBox()).toEqual(before);
await expect(panel.getByRole('tab', { name: 'Задача', exact: true })).toBeVisible();
```

Проверять header/tabs/width до и после меню/даты, и единственный постоянный vertical scroller при активной ленте. Низкая высота 375×420: все поля/действия доступны через разрешённый temporary editor scroll. При 375×812 измерять document.scrollWidth до открытия карточки и после: панель не увеличивает ширину, собственные контролы в viewport; не чинить общую мобильную шапку за пределами scope. Desktop 1440×900/1280×800 — диапазон панели 420–520, дерево остаётся доступно, Гант имеет видимый контекст. Увеличение 200% проверить вручную browser zoom и записать факт; CSS zoom не считать эквивалентом browser zoom.
- [ ] **2. Красный прогон:** `npx playwright test tests/e2e/task-panel-ux.spec.ts`. Зафиксировать реальные failing assertions. Не снимать требования ради зелёного теста; если часть уже green, сохранить регрессионные проверки без искусственного отказа.
- [ ] **3. Довести scoped адаптивность.** Использовать existing tokens и согласованный 480 px; на <900 px overlay занимает viewport, сохраняет underlying mounted workspace, прокручивается content, не document. Текст переносится без фиксированной высоты; title editor и description доступны целиком. Минимальные правила дополняют Task 1:

```css
.task-panel { width: min(480px, 100vw); max-width: 100vw; }
.panel-header { min-width: 0; overflow-wrap: anywhere; }
@media (max-width: 899px) {
  .task-panel { position: fixed; inset: 0; width: 100%; height: 100dvh; }
}
```

Устранить конфликт `flex-basis` и прежних media rules, использовать текущий layer scale. Menu/date/results попадают в viewport, низкий viewport позволяет overlay scroll. Desktop sidebar и non-modal picker без focus trap; dialogs — с trap. Проверить Escape local→panel, visible focus, aria errors/disabled reasons, title Escape, Ctrl/Cmd+Enter journal, Enter переносы, Ctrl/Cmd+Z text против global Undo.
- [ ] **4. Выполнить матрицу P01–P28 и полные gates.** Точное распределение ниже. Запустить `npm run verify`, `npm run format:check`, `npm run test:integration`, `npm run test:e2e`, `npm run check:kit`, `npm run check:package`; `verify` включает typecheck/lint/all Vitest/build. Затем staged guard/Gitleaks и `npm run security:history`. `npm run preflight` обязателен перед подготовкой публикации, но известные local-only файлы не удалять и guard не ослаблять; отказ workspace явно зафиксировать. Ни skips, ни `--if-present`, ни мок server вместо actual-server E2E.
- [ ] **5. Обновить документы по фактам и выполнить final review.** UI/START_HERE теперь описывают три реализованные вкладки; spec остаётся normative D22. ACCEPTANCE содержит реальные test paths/results, STATUS — passed/failed/not run, ограничения/следующую задачу. `feat: complete compact task panel acceptance` → два независимых exact-SHA review всего диапазона реализации. Исправления отдельным commit, reviewers повторно смотрят final SHA и закрытие замечаний. Завершить отчётом без заявления о S4–S6/push/deploy.

## Матрица покрытия спецификации

| Критерии | Ответственный этап | Обязательное доказательство |
| --- | --- | --- |
| P01–P03 | 1, 6 | Один title, desktop geometry, один scroll, footer/overlay стабильны в task-panel-ux E2E |
| P04–P05 | 1, 4 | Сохранение всех полей через вкладки; одна команда/revision/Undo и rollback в planning + fs-dependencies |
| P06–P10 | 3, 6 | Literal C18 dates, nullable labels, summary/done/deleted, raw errors/repair, nested Escape |
| P11–P13 | 1, 2, 6 | QuickAdd Enter, root bound Tab/Shift+Tab, preserveWork, dirty reason, child return при фильтре |
| P14–P17 | 4 | Реальные endpoints fan-in/out, запрещённые кандидаты, draft edges, separate outgoing, saved CPM labels |
| P18–P19 | 5 | Dirty task + journal write независимы, Undo journal conflicts, ack + failed GET → GET-only retry |
| P20–P21 | 1–5 | Task и journal uncertain/exact retry, stale/frozen outcomes, новые drafts, pinned metadata/baselines |
| P22–P23 | 2 | Search/root/reorder/level constraints, delete warning/Undo ветки с journal entries |
| P24–P25 | 2, 6 | Three-choice guard, deferred/failing Save, Back/Forward/project/parent/neighbor, old URL aliases, обе оси scroll |
| P26–P27 | Каждый UI этап, 6 | Keyboard/local Escape/text Undo, desktop/mobile/low/200%, overlay bounds и focus |
| P28 | 1–6 | Empty/loading/no-match/offline/deleted локально различимы; 401/logout очищают private RAM |

## Самопроверка плана и handoff

При подготовке сопоставлены все разделы spec и P01–P28, просмотрены три PNG и действующие TaskPanel/App/PlanFields/Dependencies/journal controllers/tests. Новые локальные interfaces описаны у первого потребителя; shared API/schema/scheduler не расширяются. Файлы тестов, отмеченные «создать», пока отсутствуют; приведённые assertions — содержимое будущих тестов, не отчёт о запуске.

После принятия плана реализацию вести последовательно по Tasks 1–6 с независимыми ревьюерами. Все чекбоксы пока открыты. Условия завершения — реальное поведение и перечисленные gates, а не готовность этой документации.
