# «Актуальное» Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking. По указанию владельца: один отдельный implementer выполняет весь Task 1, затем отдельные reviewers проверяют соответствие спецификации и качество; исправления возвращаются implementer, commit делает координатор после принятия блока. Автор спецификации, автор плана и implementer — разные агенты.

**Goal:** Добавить в текущий проект простое представление «Актуальное»: незавершённые конечные задачи по реальному окончанию, с существующей карточкой, Undo и сохранением навигационного контекста.

**Architecture:** Чистый helper строит пять групп из полного принятого дерева, `useProjectToday` и существующего календаря. Один компактный React-компонент выводит группы; `App` точечно расширяет существующие tabs, RAM visits и возврат фокуса. Сервер, scheduler и модель данных не меняются; новый navigation framework не нужен.

**Tech Stack:** Существующие TypeScript, React, CSS tokens, Vitest/Testing Library, Playwright и синтетический Fastify/SQLite runtime. Без новых зависимостей.

**Spec:** [2026-11-06-current-tasks-design.md](../specs/2026-11-06-current-tasks-design.md), принятая после независимого review версия в `67044c1`; C32 — выбор владельца, D24 — рабочие детали.

## Global Constraints

- «Источник — последний принятый серверный `ProjectTree` текущего проекта, до любых фильтров/сворачивания дерева».
- «Не использовать summary, CPM, зависимости, conditional Gantt dates или draft-поля для срочности».
- «Граница `soonEnd` — третий рабочий день **строго после today** по `project.calendarType` (`weekdays` / `all-days`)»; `today` — календарная дата в `project.timezone`, без переноса на рабочий день.
- «Обычная смена представления сохраняет ту же смонтированную карточку и черновики, без нового запроса Save/Discard»; существующие защищаемые переходы, pending/uncertain locks и journal drafts сохраняются.
- «Раскрытие и позиция прокрутки «Актуального» входят в существующее RAM-состояние visit для Back/Forward; search/collapse в URL не добавляются».
- «Нет общего списка всех проектов, новых deadline/priority полей, настройки горизонта, поиска, filters, quick actions, пагинации, доски или новой навигационной подсистемы». Схема/API/scheduler и состав пакетов остаются прежними (§7 спецификации).
- Работать последовательно в разрешённой `feat/task-panel-ux`, без смены ветки/worktree. Implementer и reviewers не меняют index и не коммитят. Push/deployment не входят в задачу.
- Только синтетические fixtures/runtime; не читать private files. Три PNG из [design/README](../../../design/README.md) — единственные утверждённые референсы, без pixel-perfect требований.

## Карта файлов

| Файл | Ответственность |
|---|---|
| Create `src/client/current-view.ts` | Группировка, порядок, путь, типы групп и source origin; без React/записей |
| Create `src/client/CurrentTasks.tsx` | Пять доступных секций и компактные строки, контролируемое раскрытие |
| Create `src/client/styles/current.css` | Локальная компоновка, длинные строки, focus/узкая ширина |
| Modify `src/client/App.tsx` | Интеграция принятого snapshot, visits/scroll, открытие карточки и active-view focus fallback |
| Modify `src/client/ProjectViewTabs.tsx` | Третья вкладка, цикл стрелок и фокус только принятого перехода |
| Modify `src/client/workspace-navigation.ts` | Union/allowlist `current`, существующий формат URL/history |
| Create `tests/client/current-view.test.ts` | Независимые fixtures классификации/порядка/пути |
| Create `tests/client/current-tasks.test.tsx` | Семантика/клавиатура/состояния компонента |
| Create `tests/client/current-navigation.test.tsx` | App, guards, ack/errors, history, clock, focus |
| Modify `tests/client/journal-navigation.test.tsx` | URL allowlist и регрессия существующих visits |
| Create `tests/e2e/current-tasks.spec.ts` | Ключевые сценарии на actual server и визуальная приёмка |
| Modify `tests/e2e/task-journal.spec.ts` | Ожидание третьей project tab в keyboard case |
| Modify `docs/ACCEPTANCE.md`, `docs/STATUS.md`, `START_HERE.md` | Проверенные результаты/статус и следующий шаг; не объявлять S4 завершённым |

Переиспользовать без переписывания: `src/client/tree-view.ts` (`treeRows`), `src/domain/calendar.ts` (`indexToDate`, `isWorkingDay`), `src/client/use-project-today.ts`, `tests/client/fixtures.ts`, `tests/client/journal-fixtures.ts`, `tests/helpers/optional-e2e.ts`, `tests/helpers/journal-e2e.ts`. Не менять API/schema/package-lock и не выделять общий framework из `App`.

### Task 1: Законченное представление «Актуальное» с навигацией и приёмкой

**Files:** полный конкретный список выше; весь блок реализуется и проверяется вместе.

**Interfaces:**

- Consumes: `treeRows(tasks: readonly Task[], collapsed: ReadonlySet<string>, rootId?: string)`, возвращает rows с `task`, `depth`, `hasChildren`; передавать пустой Set для полного preorder.
- Consumes: `useProjectToday(timezone: string): string`, уже вызываемый в `App`; `indexToDate(index, originDate, calendarType): string`, `isWorkingDay(date, calendarType): boolean`.
- Produces в `current-view.ts`:

```ts
import type { Project, Task } from '../shared/contracts.js';
export type CurrentGroupId = 'overdue' | 'today' | 'soon' | 'later' | 'undated';
export type CurrentRow = { task: Task; path: string; order: number };
export type CurrentGroup = { id: CurrentGroupId; label: string; rows: CurrentRow[] };
export type CurrentOrigin = { projectId: string; taskId: string; groupId: CurrentGroupId };
// Реализации функций — шаги 2 и 4.
export function currentGroups(
  tasks: readonly Task[], calendar: Project['calendarType'], today: string,
): CurrentGroup[];
export function defaultCurrentCollapsed(): Set<CurrentGroupId>;
```

- Produces `CurrentTasks` с props `{ groups: readonly CurrentGroup[]; collapsed: ReadonlySet<CurrentGroupId>; onToggle: (id: CurrentGroupId) => void; onOpen: (task: Task, group: CurrentGroupId) => void }`. DOM IDs `current-group-${id}` для заголовков, `current-region-${id}` для областей, `current-task-${task.id}` для строк. Scroll owner — внешний `#project-view-current` в `App`; не создавать второй scroller внутри компонента.
- Extends `ProjectView = 'tasks' | 'current' | 'journal'`; `ProjectViewTabs.onChange: (view: ProjectView) => boolean`. `false` означает отказ; и клавиатурная, и pointer/click-навигация сохраняют прежние focus, активную вкладку и URL. Native pointer focus наступает до `onClick`: одного boolean-результата недостаточно, default focus нужно предотвратить до click либо синхронно восстановить прежний при отказе. Синхронное переключение вида не запускает dirty-dialog.
- Extends локальный `SessionVisit` в `App`: `currentCollapsed: Set<CurrentGroupId>`, `currentScrollTop: number`, `currentOrigin: CurrentOrigin | null`. История браузера всё ещё содержит только version/visitId; состояние берётся из RAM, строки — из свежего snapshot.

#### Этап 1. Зафиксировать независимые примеры группировки (A01–A05)

- [ ] Прочитать спецификацию, соответствующие UI/DECISIONS и текущие helpers; посмотреть три PNG. Проверить `git status --short`, сохранить чужие изменения, не переключать ветку. Координатор уже выполнил baseline `npm run doctor` успешно.
- [ ] Создать `tests/client/current-view.test.ts` на `task` из `fixtures.ts`. Основной пример должен вручную задавать ожидаемые ID, не вызывать calendar/tree helper для расчёта ожиданий:

```ts
const parent = task(1, { title: 'Этап', status: 'done' });
const leaf = (n: number, finish: string | null) => task(n, {
  parentId: parent.id, inputFinish: finish,
});
const input = [leaf(7, null), leaf(6, '2026-11-12'), leaf(5, '2026-11-11'),
  leaf(4, '2026-11-09'), leaf(3, '2026-11-06'), leaf(2, '2026-11-05'), parent];
expect(currentGroups(input, 'weekdays', '2026-11-06').map(g =>
  [g.id, g.rows.map(r => r.task.id)],
)).toEqual([
  ['overdue', [task(2).id]], ['today', [task(3).id]],
  ['soon', [task(4).id, task(5).id]], ['later', [task(6).id]],
  ['undated', [task(7).id]],
]);
```

- [ ] Добавить таблицы с явными ожиданиями: all-days пятница → boundary09.11; weekdays суббота07.11 → boundary11.11, окончание07.11 остаётся today; нерабочее окончание сравнивается без нормализации; `today=9999-12-31` и близкие дни дают безопасную последнюю границу. Проверить finish-only, start-only, duration-only, done leaf, summary, глубокий done ancestor; старые просрочки первыми, equal-date/null preorder/sortOrder/id при перестановке массива. Путь корня «Корень проекта», глубокий путь полный и соответствует переименованию/переносу. Входные объекты не мутируют.
- [ ] Запустить `npx vitest run tests/client/current-view.test.ts`, подтвердить FAIL из-за отсутствующего helper, а не дефекта fixture.

#### Этап 2. Реализовать только чистую проекцию

- [ ] В `current-view.ts` обходить полный `treeRows(tasks, new Set())`; путь строить из стека предков по `depth` до фильтрации leaves, сохранить индекс preorder. Исключить `hasChildren` и `status === 'done'`. Возвращать все пять групп в фиксированном порядке, включая пустые.
- [ ] Границу вычислять через календарные дни с существующим helper и явной отсечкой до выхода из диапазона:

```ts
let soonEnd = today;
let counted = 0;
while (counted < 3 && soonEnd !== '9999-12-31') {
  soonEnd = indexToDate(1, soonEnd, 'all-days');
  if (isWorkingDay(soonEnd, calendar)) counted += 1;
}
// inputFinish: null -> undated; <today -> overdue; ===today -> today;
// <=soonEnd -> soon; иначе later. Никаких schedule/display полей.
```

Сортировка датированной группы — `inputFinish`, затем сохранённый `order`; null-группа — только `order`. Defaults collapsed — новый Set `['later', 'undated']` при каждом сбросе проекта. Не менять календарь scheduler ради display boundary.
- [ ] Повторить unit-файл, получить PASS.

#### Этап 3. Зафиксировать доступность и контекст до интеграции (A06–A13)

- [ ] Создать component tests: ровно пять кнопок заголовков с counts/`aria-expanded`/`aria-controls`; defaults; Enter/Space раскрывают группу; «Нет задач» и общий empty message; в раскрытой группе доступны все 80 синтетических строк. Native button строки открывает task/group по click/Enter/Space, status — подписанный индикатор, не checkbox; дата «Окончание: 06.11.2026», «Сегодня»/«Просрочено» и null видны текстом.
- [ ] Создать `current-navigation.test.tsx` с `mockJournalApp`, `deferred`, `task`, `emptySchedule`; использовать существующий dialog shim и cleanup. Установить управляемое время `2026-11-06T12:00:00Z`, восстанавливать timers/history после теста. Начальный пример:

```ts
const server = mockJournalApp();
server.tree.tasks = [task(1, { inputFinish: '2026-11-06' })];
window.history.replaceState(null, '', `?project=${server.tree.project.id}&view=current`);
render(<App />);
const tab = await screen.findByRole('tab', { name: 'Актуальное', exact: true });
expect(tab).toHaveAttribute('aria-selected', 'true');
await userEvent.click(await screen.findByRole('button', { name: /Работа 1/ }));
expect(document.getElementById('tab-details')).toHaveAttribute('aria-selected', 'true');
```

Селекторы строк уточнять через `#project-view-current`, чтобы не спутать кнопку с текстом карточки. По существующим fixtures подменять `api.command`/`api.tree`, а не сам grouping helper.
- [ ] Включить минимальный полноценный набор client cases:

| Cases | Проверяемый исход |
|---|---|
| Direct links | current + task/panel, done/summary без ложной строки, missing task fallback, недоступный project без запроса чужого ID; reload/default/tasks/journal URLs |
| Обычные tabs | details draft сохраняется, нет Save/Discard; три tabs сохраняют filters/collapse/Gantt scale/scroll и journal query/draft; done-only tree filter не влияет на current |
| Защищаемая навигация | другая задача/проект/закрытие/Back: Cancel сохраняет URL/tab/focus; Save ждёт ack; Discard продолжает; journal pending/uncertain отказывает tab navigation без переноса фокуса |
| Authoritative updates | deferred save не меняет строку до ack; ack done скрывает, карточка открыта; Undo возвращает; finish переносит, child исключает former leaf; rename/move обновляет path |
| Ошибки | definite failure,409,uncertain сохраняют draft/строку, штатные refresh/exact retry и locks не обходятся |
| Visits | current collapse + scroll сохраняются при tabs/карточке и Back/Forward; новый проект defaults, посещённый history восстанавливает RAM; reload defaults |
| Clock/settings | минутный тик, focus, visibility return пересчитывают по timezone; принятый calendar/timezone ack пересчитывает сразу, сохраняет collapse/draft; только тик не пишет command/revision/Undo/URL |
| Focus | close → исходная видимая строка, иначе исходная группа, иначе current tab; свернутая группа/direct link; focused исчезнувшая строка; обновление при focus в другом контроле не крадёт focus |
| Undo/late replies | доступная Undo сохраняет focus; последняя Undo fallback в активном виде, без hidden tree; пользователь сменил focus или view до позднего ack — позднее восстановление отменено |
| Loading/error | pending initial GET не выдаёт empty, retry восстанавливает; смена проекта не выдаёт чужие строки; refresh error сохраняет прежний явно согласованный snapshot |
| Gantt | только «Показать на Ганте» переключает tasks, очищает filters и раскрывает ancestry по D14; закрытие карточки этого не делает |

Не дублировать все прежние journal retry тесты: добавить проверку новых точек входа с сохранёнными locks и прогнать существующий suite.
- [ ] Запустить новые client files и увидеть ожидаемые FAIL. В `journal-navigation.test.tsx` расширить roundtrip allowlist примером `view: 'current'`; прежний `board` остаётся invalid.

#### Этап 4. Компонент и небольшая интеграция

- [ ] Реализовать контролируемый `CurrentTasks` нативными button/section, без row menu или input. Ключевой markup группы:

```tsx
<h2><button id={`current-group-${group.id}`} type="button"
  aria-expanded={!collapsed.has(group.id)} aria-controls={`current-region-${group.id}`}
  onClick={() => onToggle(group.id)}>{group.label} <span>{group.rows.length}</span></button></h2>
<div id={`current-region-${group.id}`} role="region"
  aria-labelledby={`current-group-${group.id}`} hidden={collapsed.has(group.id)}>
  {/* Строки из group.rows; пустая раскрытая группа показывает «Нет задач». */}
</div>
```

Название, ancestry и подписи даты — plain text; полный title/path оставить в DOM. Для сокращённого текста раскрывать полный текст при `:focus-visible`/`:focus-within` и hover, с `overflow-wrap: anywhere`; одного `title` для клавиатуры недостаточно. CSS — тонкие разделители, `min-width: 0`, заметный focus, перенос даты на узкой ширине, без горизонтального overflow. Не добавлять метрики/карточки/настройки.
- [ ] В `workspace-navigation.ts` добавить `current` в union/allowlist; в `ProjectViewTabs` задать три подписи. Заменить формулу двух элементов:

```ts
const nextIndex = event.key === 'Home' ? 0 : event.key === 'End' ? values.length - 1
  : (index + (event.key === 'ArrowRight' ? 1 : -1) + values.length) % values.length;
const next = values[nextIndex]!;
if (onChange(next)) document.getElementById(`project-tab-${next}`)?.focus();
```

Pointer/click также должен фокусировать только принятый переход. Минимальный вариант на кнопке tabs — предотвратить native pointer focus до `onClick`, а при успешном переходе сфокусировать кнопку явно:

```tsx
onPointerDown={(event) => {
  if (event.button === 0) event.preventDefault();
}}
onClick={(event) => {
  if (onChange(view)) event.currentTarget.focus();
}}
```

Проверить этот порядок настоящим `userEvent.click`, а не одиночным `fireEvent.click`: при установленном pending/uncertain lock сохранить `const beforeFocus = document.activeElement` и `const beforeUrl = window.location.href`, нажать другую project tab, затем проверить `expect(document.activeElement).toBe(beforeFocus)`, прежние `aria-selected` обеих вкладок и `expect(window.location.href).toBe(beforeUrl)`. Отдельно проверить accepted click и rejected ArrowRight; фокус ранее мог быть не на tab, а в редакторе.

`changeProjectView` возвращает `false` при существующем lock, иначе capture/cancel stale focus/set view/`true`. Не пропускать этот обычный переход через `requestTaskNavigation` только из-за dirty карточки. Проверить pending/uncertain политики обоих видов записей, не разрешать переходы, ранее защищённые lock.
- [ ] В `App` вычислить groups из `tree.tasks`, `tree.project.calendarType`, уже существующего `projectToday`. Смонтировать третью tabpanel рядом с tasks/journal; `hidden` сохраняет DOM/контекст текущего проекта. Card остаётся на прежнем месте без нового key по projectView. Не показывать текущий empty до загрузки; новый проект использует штатное `loadProject` с очисткой старого tree.
- [ ] В `App` добавить state collapsed, ref scrollTop и origin; расширить **все** места создания/копирования `SessionVisit`: captureVisit, adoptUnrememberedVisit defaults, initialVisit, новый visit, restoreWorkspace, reset в loadProject. Set копировать, не мутировать visit. Внешний panel `onScroll` сохраняет top и вызывает `lastCapture.current()`; не читать нулевой scroll скрытого элемента поверх сохранённого значения. При restore применять top после раскрытия/показа DOM в layout effect; clamping — браузерный. Применённый restore одноразовый, отменяется новым пользовательским scroll/navigation; snapshot не откатывать к историческим данным.
- [ ] Открытие строки расширяет существующий `selectTask(task, origin?: CurrentOrigin)` или короткую обёртку вокруг того же `requestTaskNavigation`. Сохранять origin только внутри принятого callback, затем существующие selected/details/history действия. Cancel guard не подменяет источник. Возвраты из ancestors/neighbors сохраняют исходный current origin; origin ограничен project ID и хранится в RAM visit, для direct link — null.
- [ ] Добавить небольшой локальный active-view focus helper в `App`: current ищет видимую origin row → origin group → current tab; tasks сохраняет прежний tree/quick fallback; journal — видимый journal origin → journal tab. `closePanel` и disabled-final-Undo используют этот helper, с проверкой connected/hidden. Для исчезнувшей focused строки помнить последнюю row/group и отменять восстановление при focus/pointer/key в другом контроле; layout effect восстанавливает только потерянный focus своего списка и только при активном current. Раскрытие/ack сами по себе не закрывают карточку.
- [ ] Использовать существующую отмену `undoFocus`/focusin и подтверждённый snapshot effect; дополнительно отменять отложенные requests при принятой смене view/project. Не ставить безусловный RAF `.focus()`: поздний ack/restore не должен перехватывать ручной выбор. `showOnGantt` уже выставляет tasks/filter/collapse/showGantt: сохранить это поведение и корректно захватить current visit до перехода.
- [ ] Прогнать `npx vitest run tests/client/current-view.test.ts tests/client/current-tasks.test.tsx tests/client/current-navigation.test.tsx tests/client/journal-navigation.test.tsx tests/client/App.test.tsx`, устранить ошибки до browser приёмки.

#### Этап 5. Actual-server browser приёмка и регрессии

- [ ] Создать `tests/e2e/current-tasks.spec.ts` с fixture `test` из `tests/helpers/journal-e2e.ts`, `seedOptionalRuntime`/`send`/`readTree` из `optional-e2e.ts`. Clock браузера фиксировать до загрузки страницы (`page.clock.setFixedTime(new Date('2026-11-06T12:00:00Z'))`), календарь/timezone задавать API-командой `{ type: 'project.schedule', changes: { calendarType: 'weekdays', timezone: 'UTC' } }`, не изменением SQLite. Создать отдельные понятные cases:
  1. Все группы/порядок/глубокий путь/длинные строки, 80 leaves без лимита; defaults и полная клавиатурная последовательность tabs → группы → строка → панель → close.
  2. Реальный save done и Undo, finish change, добавление ребёнка; карточка остаётся открытой, counts отражают ack. Last Undo/direct-link close не фокусируют hidden tree.
  3. Фильтр done и свёрнутая ancestry в tasks → current → dirty карточка → journal/tasks/current без dialog → protected task context Cancel/Save/Discard; «Показать на Ганте» выполняет D14.
  4. Direct link/reload/Back/Forward с current task/panel, восстановление collapse/scroll после достаточно длинного списка. Existing journal navigation suite продолжает проверять Gantt/journal context.

Браузерные ожидания не рассчитывать через production currentGroups; даты/порядок задать явно. API ответ использовать для ID/revision. Пример утверждений:

```ts
await page.goto(`${runtime.origin}/?project=${tree.project.id}&view=current`);
const current = page.locator('#project-view-current');
await expect(page.getByRole('tab', { name: 'Актуальное', exact: true }))
  .toHaveAttribute('aria-selected', 'true');
await expect(current.getByRole('button', { name: 'Скоро 2', exact: true }))
  .toHaveAttribute('aria-expanded', 'true');
await expect(current.getByText('Окончание: 11.11.2026', { exact: true })).toBeVisible();
```

- [ ] Исправить `tests/e2e/task-journal.spec.ts` около 418: ArrowRight из project «Задачи» сначала фокусирует «Актуальное», второй ArrowRight — «Журнал». Panel tabs «Задача / Зависимости / Ход работы» не менять. Новые client cases проверяют обе стрелки с wrap, Home/End, accepted click и rejected keyboard/pointer click при lock: прежние focus, URL и активная вкладка сохраняются (этап4).
- [ ] `npm run build`, затем `npm run test:e2e -- tests/e2e/current-tasks.spec.ts tests/e2e/journal-navigation.spec.ts tests/e2e/task-journal.spec.ts`. Оба существующих projects дают 1440×900 и 1280×800. В новом spec отдельно установить 390×844 для длинных строк и полноэкранной карточки; проверить реальную достижимость кнопок/полного текста, отсутствие дополнительного overflow от current list, compare `scrollWidth/clientWidth` самого списка и документа. Если общий существующий header переполняется независимо от списка, записать факт отдельно, не расширять задачу на мобильный редизайн.
- [ ] Просмотреть синтетические browser screenshots текущего списка и открытой карточки в обоих desktop viewport и узком. Хранить вне репозитория. Проверить компактность строк, мягкие разделители, ясные текстовые сроки, доступный полный путь и нижние строки длинного списка; не ограничиваться DOM-тестом или статичным макетом.

#### Этап 6. Финальные проверки, review/fix loop, commit

- [ ] Выполнить на итоговом candidate последовательно: `npm run typecheck`, `npm run lint`, `npm run test:unit`, `npm run test:integration`, `npm run build`, `npm run format:check`, `npm run check:kit`, `git diff --check`. После fix повторять затронутые проверки; browser suites выше запускать после последнего изменения их кода/поведения. Не заменять отсутствующие suites `--if-present`, skip или пустыми tests. Полный E2E/preflight для локального блока не заявлять, если не запускались; публикация имеет отдельный полный gate по DEPLOYMENT.
- [ ] Обновить STATUS/ACCEPTANCE фактами A01–A13: перечислить проверенные сценарии и команды, counts, ограничения, screenshots вне checkout и следующий шаг. START_HERE сменить только фактический статус реализации. Не переписывать C32/D24 и не записывать рабочие подробности как новый выбор владельца.
- [ ] Implementer передаёт координатору diff и отчёт без commit/index. Координатор назначает независимый spec review всего Task1, затем quality review точного исправленного candidate. Каждый reviewer читает `git diff` к base, спецификацию и тесты; новые worktree не нужны. Findings → implementer fixes → affected checks → повтор review до принятия. По новой причине проверок не отказываться, но не повторять весь gate без изменения candidate.
- [ ] После принятия координатор сверяет состав файлов, выполняет штатный staged scan/hooks и commit `feat: add current tasks project view`. Commit только завершённого блока; нет промежуточных scaffold commits и нет push/deployment. В handoff: SHA, passed/failed/not run, remaining branches/worktrees и ограничения. Не называть первый релиз/S4 завершённым.

## Самопроверка плана

A01–A05 покрыты независимыми helper fixtures; A06 — component/browser; A07–A09 — deferred client acknowledgements/errors/clock и actual-server save; A10–A12 — existing visits с третьей вкладкой, dirty/lock/focus/Undo/Gantt; A13 — loading/error/project isolation и три viewport. План не вводит серверный расчёт срочности, дополнительные продуктовые controls, новые зависимости или смену архитектуры. Следующий шаг координатора — независимое review плана, исправления и отдельный commit плана; затем отдельный implementer выполняет Task1 без нового выбора способа исполнения.
