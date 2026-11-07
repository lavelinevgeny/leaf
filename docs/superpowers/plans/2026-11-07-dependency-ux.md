# Dependency UX Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Реализовать C33: симметричный граф и общий направленный выбор связей в строках и обоих QuickAdd с атомарным созданием, сохранением черновиков и доступным управлением.

**Architecture:** Расширить только create-command полем successorIds; существующая server transaction валидирует итоговый DAG, выполняет один causal pass и хранит один undo snapshot. Переиспользовать PredecessorPicker как общий направленный UI с чистой моделью полного proposal; хозяева сохраняют разные способы записи: incoming draft панели, immediate row/Gantt/outgoing и полный QuickDraft. TaskTree остаётся общим для списка, Ганта и подзадач, App сохраняет один immediate host и прежний command/retry flow.

**Tech Stack:** Существующий TypeScript/React/Vite/Fastify/SQLite, Zod, Vitest/Testing Library, Playwright; закреплённые package.json/package-lock.json и Node из .nvmrc, без новых зависимостей.

**Spec:** [C33/D28](../specs/2026-11-07-dependency-ux-design.md), [ADR 015](../../adr/015-create-successor-dependencies.md), reviewed spec commit `bbabcf8d7dc236100b8e4ee74049ff2f6b52c169`.

## Global Constraints

Следующие требования перенесены из спецификации дословно; действуют во всех задачах.

- «Актуальное», журнал, доска и общая перестройка панели вне объёма.
- Новых типов связей, lag, drag-connect, библиотек, SQL-полей или миграции нет.
- «Перед» не назначает начало текущей задачи обратным расчётом от последователя.
- Новых image assets нет.
- В продукте не показывать слова draft, immediate, API, transaction.
- Contract version 2, Task/ProjectTree DTO, SQL, `task.edit`, исторические payload/response остаются прежними.
- Старые команды без поля принимаются; сериализация старого payload не должна получать новое default поле, иначе сломается exact replay.
- Рабочая геометрия C30/D25 сохраняется: 38 px строки, click targets не меньше 28×28, дата и header выровнены, правые действия внутри видимой колонки, включая 300 px Гант и глубокую вложенность.
- Это тот же DOM control при hover/focus, а не заменяющая копия.
- Все данные синтетические; browser работает с настоящим локальным HTTP/SQLite runtime.
- Для реализации обязательны typecheck/lint/unit/integration и релевантные actual-server E2E; полный локальный gate координатора по [DEPLOYMENT](../../DEPLOYMENT.md) остаётся отдельным завершающим этапом.

---

## Порядок, границы записи и карта файлов

Работа последовательно в `feat/dependency-ux`, без смены ветки/worktree. Владелец уже разрешил исполнение; после отдельного review плана координатор назначает нового исполнителя каждой задачи, затем независимые spec/code reviews неизменного коммита. Следующая задача начинается после исправлений и PASS предыдущей. Не запускать suites параллельно. Каждый этап компилируется и имеет работающий пользовательский либо серверный результат; scaffolding-only коммитов нет. Application tests не подменяются mock-only приёмкой.

| Задача | Ответственность и файлы | Контракт для следующей задачи |
|---|---|---|
| 1 | `src/shared/contracts.ts`, `src/server/repository.ts`; `tests/optional-api.test.ts`, `tests/fs-cascade-repository.test.ts` | Optional create-only successorIds, atomic create/replay/undo. Единственный writer shared command schema. |
| 2 | `src/client/predecessor-view.ts`, `PredecessorPicker.tsx`, `Dependencies.tsx`, `strings.ts`, `styles/app.css`; небольшие адаптации вызовов `App.tsx`/`QuickAdd.tsx` | Полный DependencyProposal, направленные callbacks, fixed graph. Старые App/QuickAdd пока выбирают incoming через fixed mode. |
| 3 | `src/client/quick-add-view.ts`, `QuickAdd.tsx`, `App.tsx` и их tests | Обязательный successorIds в RAM QuickDraft, двустороннее создание обоих scope. |
| 4 | `src/client/TaskTree.tsx`, `TaskTimeline.tsx`, `TaskPanel.tsx`, `App.tsx`, `styles/app.css` и их tests | Одна row chain/count и общий directional immediate host строки/полосы Ганта. |
| 5 | `tests/e2e/dependency-ux.spec.ts`, при необходимости узкие browser regression updates; `docs/ACCEPTANCE.md`, `docs/STATUS.md`, `START_HERE.md` | Полная DUX evidence matrix, native zoom и финальные gates. |

Не выделять новый state manager, scheduler, HTTP transport или абстракцию всей панели. `predecessor-view.ts` уже отвечает за поиск/валидацию связей; его расширение и сохранение имени PredecessorPicker уменьшают churn. Task 2 переводит все существующие вызовы на новый typed props contract сразу, поэтому промежуточная сборка не зависит от Task 3/4. Старые helper exports допускаются как адаптеры к общей модели до миграции существующих тестов, но не оставлять второй независимый алгоритм candidates.

Во всех задачах обновлять STATUS только фактами: конкретные checks, ограничения, следующий этап. UI/ARCHITECTURE/DECISIONS и ADR уже задают C33/D28: менять только при фактическом расхождении реализации, не превращать D28 в новое C-решение. Смотреть три PNG из design/README; других референсов нет.

## Общий клиентский контракт (вводится Task 2)

В `predecessor-view.ts` экспортировать:

```ts
export type DependencyDirection = 'predecessor' | 'successor';
export interface DependencyProposal {
  task: Task;
  isNew: boolean;
  predecessorIds: readonly string[];
  successorIds: readonly string[];
}
export interface DependencySelectionIssue {
  direction: DependencyDirection;
  taskId: string;
  reason: string;
}
export function dependencyCandidates(
  tree: ProjectTree,
  proposal: DependencyProposal,
  direction: DependencyDirection,
  query: string,
): PredecessorCandidate[];
export function dependencySelectionIssues(
  tree: ProjectTree,
  proposal: DependencyProposal,
): DependencySelectionIssue[];
export function outgoingSuccessorIds(tree: ProjectTree, taskId: string): string[];
```

`PredecessorCandidate` и canonicalPredecessorIds сохраняются. `proposal` всегда содержит обе стороны текущей задачи; для existing snapshot хозяин берёт incomingPredecessorIds/outgoingSuccessorIds, для панели заменяет только incoming на draft. Для new task используется существующий `draftTask(tree, context, title, plan)`, включая parentId. Все функции чистые, без назначения дат и сетевых вызовов.

В `PredecessorPicker.tsx` экспортировать один контракт (не overload старых props):

```ts
export interface PredecessorPickerProps {
  tree: ProjectTree | null;
  proposal: DependencyProposal;
  direction: 'selectable' | DependencyDirection;
  disabled: boolean;
  blockedReason?: string;
  error?: string;
  loadError?: string;
  onReload?: () => void;
  onAdd: (direction: DependencyDirection, taskId: string) => void;
  onRemove: (direction: DependencyDirection, taskId: string) => void;
  onClose: () => void;
}
```

Selectable mode локально начинает с predecessor при каждом mount; fixed mode не показывает toggle и выводит chips только своей стороны. `onRemove` всегда несёт направление chip, не активного toggle. Callback не закрывает picker самостоятельно: host выбирает draft/immediate semantics. Новые слова: «Эта задача выполняется», «После», «Перед», «Новая задача», «Связи новой задачи: N, не сохранено», «Сначала сохраните или отмените изменения задачи»; существующие fixed-direction accessible names сохраняются. На каждом открытии host монтирует новый picker; обновление snapshot не должно перемонтировать открытый picker и терять query.

### Task 1: Атомарное создание с обеими сторонами FS

**Files:** Modify `src/shared/contracts.ts` (commandV2Schema create branch), `src/server/repository.ts` (task.create branch); Test `tests/optional-api.test.ts`, `tests/fs-cascade-repository.test.ts`; Modify `docs/STATUS.md`.

**Interfaces:** Consumes Command/commandV2Schema, Repository.applyCommand, existing mutate/cascadeFs/undo. Produces `Extract<Command, {type: 'task.create'}>['successorIds']` = `string[] | undefined`; никакого нового DTO поля или изменения task.edit.

- [ ] **Step 1: Написать failing contract/repository tests.** В optional-api использовать существующие commandV2Schema и API fixture. Пример обязательных assertions:

```ts
const old = { type: 'task.create', title: 'T', parentId: null };
const id = '22222222-2222-4222-8222-222222222222';
expect(commandV2Schema.parse(old)).not.toHaveProperty('successorIds');
expect(commandV2Schema.safeParse({ ...old, successorIds: [id] }).success).toBe(true);
for (const successorIds of [null, 'bad', ['bad'], [id, id]])
  expect(commandV2Schema.safeParse({ ...old, successorIds }).success).toBe(false);
expect(commandV2Schema.safeParse({
  type: 'task.edit', taskId: id, changes: { successorIds: [] },
}).success).toBe(false);
expect(taskV2Schema.shape).not.toHaveProperty('successorIds');
```

В fs-cascade-repository использовать уже существующие fresh/create/task/step/rows; не копировать production алгоритм для expected dates:

```ts
let before = step(fresh(), {
  type: 'project.schedule', changes: { calendarType: 'weekdays' },
});
before = create(before, 'A', '2026-11-09', '2026-11-09');
before = create(before, 'B', '2026-11-10', '2026-11-11');
const after = step(before, {
  type: 'task.create', title: 'T', parentId: null,
  inputStart: '2026-11-09', inputFinish: '2026-11-10', durationDays: 2,
  predecessorIds: [task(before, 'A').id], successorIds: [task(before, 'B').id],
});
expect(task(after, 'T')).toMatchObject({ inputStart: '2026-11-10', inputFinish: '2026-11-11' });
expect(task(after, 'B')).toMatchObject({ inputStart: '2026-11-12', inputFinish: '2026-11-13' });
expect(after.project.revision).toBe(before.project.revision + 1);
expect(after.dependencies).toHaveLength(2);
const undone = step(after, { type: 'undo' });
expect(undone.tasks).toEqual(before.tasks);
expect(undone.dependencies).toEqual(before.dependencies);
expect(undone.schedule).toEqual(before.schedule);
```

Добавить table cases incoming-only/outgoing-only/mixed/absent/explicit []; fan-in/out с неизменённым incoming другого predecessor у B; nullable T без обратного планирования. Отдельно count operations/undo + cascade spy ровно один вызов для mixed; reopen SQLite и exact replay возвращают сохранённый ответ без второго каскада. Для rollback сравнивать `rows()` до/после, а не только HTTP status. Обязательные fixtures: последняя outgoing чужого проекта/несуществующая, оба массива с одним ID, indirect B→A при A→T→B, summary, parent после preserveWork conversion с явно выбранным parent ID, done-push, legacy-unavailable causal source, overflow. Проверять откат порядка siblings и преобразования parent. Malformed/duplicate arrays идут через strict API (400), DAG/cascade отказ через обычную domain ошибку. Пример rollback assertion:

```ts
const saved = rows();
expect(() => step(before, {
  type: 'task.create', title: 'T', parentId: null,
  predecessorIds: [task(before, 'A').id],
  successorIds: [task(before, 'B').id, randomUUID()],
})).toThrow();
expect(rows()).toEqual(saved);
```

- [ ] **Step 2: Проверить RED.** `npx vitest run tests/optional-api.test.ts tests/fs-cascade-repository.test.ts` — новые valid successor/mixed assertions падают на отсутствии контракта/рёбер. Фиксировать реальную причину; compile error неизвестного поля до изменения shared type допустим только на RED, не в коммите.
- [ ] **Step 3: Добавить минимальное расширение.** В create schema добавить отдельный unique UUID array `.optional()` без `.default([])`; diagnostics для successors. После существующего replacePredecessors в create append outgoing, не replace incoming выбранных successors:

```ts
for (const successorId of command.successorIds ?? []) {
  snapshot.dependencies.push({
    id: randomUUID(), projectId: snapshot.project.id,
    predecessorId: task.id, successorId,
  });
}
```

Сохранить существующий общий validateDependencies после apply, затем единый addedDependencyIds/cascadeFs и mutate calculate/save. Никаких команд внутри команды, SQL-миграции или расширения scheduler. Parent conversion precedes explicit edge insertion; не remap новые IDs на preserved child.
- [ ] **Step 4: Проверить replay/API.** Добавить API запрос с одним operationId, повтором исходного payload, затем изменённым successorIds: exact replay тот же ответ; changed payload `OPERATION_REUSED`, before/after tables идентичны после отказа. Повтор old absent payload после создания/перезапуска не получает successorIds в canonical envelope; explicit [] отдельный payload. Проверить 409 без записи, Undo и existing journal collision tests.
- [ ] **Step 5: GREEN и commit.** Последовательно `npm run typecheck`, `npm run lint`, `npm run test:unit`, `npm run test:integration`. Обновить STATUS. `npm run check:kit`, `git diff --check`, stage только перечисленные файлы, `npm run security:staged`, обычный `git commit -m "feat: create tasks with atomic successor dependencies"`. Передать SHA для review; Task 2 ждёт PASS.

### Task 2: Полный proposal, общий picker и симметричный граф

**Files:** Modify `src/client/predecessor-view.ts`, `PredecessorPicker.tsx`, `Dependencies.tsx`, `QuickAdd.tsx`, `App.tsx`, `strings.ts`, `styles/app.css`; Test `tests/client/predecessor-view.test.ts`, `predecessor-picker.test.tsx`, `dependencies.test.tsx`, `task-panel.test.tsx`, `task-panel-navigation.test.tsx`, существующие picker callers в `quick-add.test.tsx`/`App.test.tsx`; Modify `docs/STATUS.md`.

**Interfaces:** Consumes Task 1 without writes to shared schema. Produces ровно общий контракт выше. Dependencies Props и TaskPanel incoming draft contract не расширять до outgoing draft. QuickAdd/App пока fixed predecessor: только адаптация props/callbacks, без новых create параметров.

- [ ] **Step 1: RED для полного proposal.** На fixtures optionalTreeFixture/task добавить смешанный цикл и контекст родителя:

```ts
const tree = optionalTreeFixture();
const a = task(1, { title: 'A' }), b = task(2, { title: 'B' });
const t = task(3, { title: 'T' });
tree.tasks = [a, b];
tree.dependencies = [{ id: 'BA', projectId: tree.project.id,
  predecessorId: b.id, successorId: a.id }];
const proposal: DependencyProposal = {
  task: t, isNew: true, predecessorIds: [a.id], successorIds: [],
};
expect(dependencyCandidates(tree, proposal, 'successor', '').map(x => x.task.id))
  .not.toContain(b.id);
expect(dependencySelectionIssues(tree, { ...proposal, successorIds: [b.id] }))
  .toEqual(expect.arrayContaining([expect.objectContaining({ taskId: b.id })]));
expect(dependencyCandidates(tree, {
  ...proposal, task: { ...t, parentId: b.id }, predecessorIds: [],
}, 'predecessor', '').map(x => x.task.id)).not.toContain(b.id);
```

Добавить независимые fixtures full tree order/trim/case/path, hidden/collapsed (данные full snapshot), undated/done leaf, foreign/self/summary/duplicate, incoming replacement освобождает obsolete edge, invalid selected ID после refresh остаётся issue и removable chip. Проверка каждого selected edge выполняется относительно остальных selected edges, поэтому mixed cycle не зависит от порядка обхода.
- [ ] **Step 2: RED picker/graph interactions.** Перевести fixture props на новый контракт и проверить switch query preservation, groups, preview первого кандидата до Enter, удаления chip неактивной стороны, fixed mode без toggle. Пример callback assertion:

```tsx
const onAdd = vi.fn();
render(<PredecessorPicker tree={tree} proposal={proposal}
  direction="selectable" disabled={false} onAdd={onAdd}
  onRemove={vi.fn()} onClose={vi.fn()} />);
await userEvent.click(screen.getByRole('button', { name: 'Перед', exact: true }));
await userEvent.type(screen.getByRole('searchbox'), 'B');
expect(screen.getByText('T → B')).toBeInTheDocument();
await userEvent.keyboard('{Enter}');
expect(onAdd).toHaveBeenCalledWith('successor', b.id);
```

Для этого второго test использовать graph без BA и пустые selection arrays: B должен быть допустимым. Добавить IME Enter (compositionStart/keyDown с isComposing/compositionEnd), outer form submit=0, outer Escape=0, arrows/scroll/Tab/Shift+Tab, disabled toggle/add/remove. Loading, loadError+reload callback, no leaves/no-match, write error, issue chips не сливаются в один empty state. Graph tests: 0/1/5 neighbors каждой стороны, одинаковые section headers внутри `.dependency-graph`, counters всей секции, incoming count исключает pending removal; page clamp после удаления последней видимой карточки. Existing arrows/critical labels/navigation assertions оставить.
- [ ] **Step 3: Запустить RED.** `npx vitest run tests/client/predecessor-view.test.ts tests/client/predecessor-picker.test.tsx tests/client/dependencies.test.tsx`.
- [ ] **Step 4: Реализовать pure model.** Сначала отфильтровать tasks по projectId; добавить virtual task для isNew. Base graph исключает incident edges текущей задачи, затем добавляет обе proposal groups. Для проверки кандидата вызвать существующий validateDependency с этим graph; для issues каждого selected edge удалить только его из graph и проверить сам edge. Parent становится summary благодаря virtual child; existing parent edges не должны делать весь proposal invalid сами по себе: проверяется выбранное ребро, не все старые endpoints до серверного preserveWork. Сервер остаётся авторитетным для conversion/cascade.

```ts
const selectedEdges = [
  ...proposal.predecessorIds.map(id => ({
    id: `draft:in:${id}`, predecessorId: id, successorId: proposal.task.id,
  })),
  ...proposal.successorIds.map(id => ({
    id: `draft:out:${id}`, predecessorId: proposal.task.id, successorId: id,
  })),
];
const endpoints = direction === 'predecessor'
  ? [candidate.id, proposal.task.id] as const
  : [proposal.task.id, candidate.id] as const;
validateDependency(tasks, proposedEdges, ...endpoints);
```

`tasks`, `proposedEdges`, `candidate` здесь локальные значения из указанного построения/обхода treeRows; code fragment вставляется в dependencyCandidates. Для issues ловить DomainError и выдавать короткую понятную reason, без удаления IDs. Сортировка/parent paths и incomplete labels остаются из predecessor-view.
- [ ] **Step 5: Реализовать picker и адаптировать callers.** Сохранить существующие top-layer positioning/ResizeObserver/active-scroll; ограничить max-height viewport, прокрутку chips/results, пересчитывать bounds после chips/error и resize. Локальные query/direction/active, direction change сохраняет query и focus и сбрасывает active; preview берёт `candidates[Math.max(0, index)]`. Полное accessible название с path для duplicate titles. Снять Enter propagation/default; IME не вызывает onAdd. Pending block действует на switch/add/remove, close остаётся доступен. App fixed adapter передаёт saved обе стороны и callbacks `(_direction, id) => immediateRelation(id, false/true)`; QuickAdd fixed adapter передаёт draftTask и successors []; все тестовые callers перевести в этом коммите, без необязательного successorIds в QuickDraft.
- [ ] **Step 6: Симметрично собрать граф.** Оба header/empty/paging внутри одной graph box, общий CSS-класс section header, один принцип геометрии. Сохранить absolute cards/SVG edge routes; выделить равную высоту header (36 px) и одинаковый card start inset, current card между секциями. Paging по четыре раздельно, counts `incomingIds.length`/`after.length`, unsaved marker рядом с incoming count. Header buttons видимо «+ Добавить», aria-label «Добавить предшественника/последователя». Fixed picker получает incoming draft + saved outgoing. Incoming onAdd/onRemove вызывает onIncomingChange; outgoing maps endpoint→exact edge ID и проверяет taskDirty/disabled перед каждой отправкой. Outgoing add закрывает после ack, remove оставляет открытым. Не менять TaskPanel.save('schedule').
- [ ] **Step 7: Проверить focus и guards графа.** Расширить существующий focusVersion/restoreTrigger: открытие запоминает trigger/секцию, deliberate focus/pointer outside picker отзывает token без восстановления после blur в body. Close внутри picker может восстановить один раз после снятия disabled; поздний ack использует token, не только текущее activeElement. Fallback только видимый header секции/вкладка Dependencies. Tests: close pending→ack, outside→blur→ack, selected task change, исчезнувший trigger, changed taskDirty while open. Dirty outgoing причина доступна, incoming остаётся редактируемым при разрешённых panel locks.
- [ ] **Step 8: GREEN/review.** Последовательно typecheck/lint/test:unit/test:integration; build и `npm run test:e2e -- tests/e2e/fs-dependencies.spec.ts tests/e2e/task-panel-ux.spec.ts`. Existing selectors обновлять по новым доступным названиям/структуре, не ослаблять assertions. STATUS + check:kit/diff/staged guard; обычный commit `feat: share directional dependency picker and symmetric graph`. Review точного SHA до Task 3.

### Task 3: Обе стороны связей в основном и вложенном QuickAdd

**Files:** Modify `src/client/quick-add-view.ts`, `QuickAdd.tsx`, `App.tsx`; Test `tests/client/predecessor-view.test.ts`, `quick-add.test.tsx`, `App.test.tsx`, `task-panel-navigation.test.tsx`; Create `tests/e2e/dependency-ux.spec.ts` (QuickAdd scenarios); Modify `docs/STATUS.md`.

**Interfaces:** Consumes DependencyProposal/PredecessorPicker selectable and create.successorIds. Produces обязательное `QuickDraft.successorIds: string[]`; QuickAdd props `successorIds: string[]`, `onSuccessors: (ids: string[]) => void`; onCreate принимает `(title: string, context: AddContext, plan: SourceFields, predecessorIds: string[], successorIds: string[]) => Promise<boolean>`. App createTask добавляет successorIds перед optional quickKey. Обновить обе call sites/вложенную closure и все harness в одном этапе.

- [ ] **Step 1: RED ownership и callbacks.** Добавить successorIds во все QuickDraft test literals, defaults и harness; новые assertions:

```ts
const draft: QuickDraft = {
  title: '', context: { parentId: null },
  plan: { inputStart: null, inputFinish: null, durationDays: 1 },
  predecessorIds: [], successorIds: ['B'],
};
expect(hasQuickDraft(draft)).toBe(true);
expect(sameQuickDraft(draft, { ...draft, successorIds: [] })).toBe(false);
expect(sameQuickDraft({ ...draft, successorIds: ['B', 'C'] },
  { ...draft, successorIds: ['C', 'B'] })).toBe(true);
```

QuickAdd controlled harness хранит оба массива; выбрать двух После, затем двух Перед; query сохраняется; обе groups/chips видны; remove одного Перед не трогает После. Escape сохраняет selections, reopen default После. Проверить `onCreate` вызван один раз с обоими массивами; title/plan/nulls прежние. Parent context switch/refresh не выбрасывает invalid IDs и блокирует submit, removable chip восстанавливает submit. Смена строки при successor-only не переносит контекст; независимость main/subtask ключей обязательна.
- [ ] **Step 2: RED App failure/replay.** В существующем App test mock server добавить outgoing effects только для task.create, чтобы тест мог наблюдать ack; значимые atomic assertions остаются server/E2E. Добавить обе стороны к captured envelope tests: ordinary failure сохраняет title/raw/IDs; 409 сохраняет и revalidates после refresh; lost response retry отправляет deep-equal исходный envelope (включая successorIds); newer draft successor edit или raw generation не очищается старым ack; frozen ack ниже revision floor вызывает refresh. Проверить reset после matched ack, cancel, discard, logout/401 и отдельную ветку. `npx vitest run tests/client/quick-add.test.tsx tests/client/App.test.tsx tests/client/predecessor-view.test.ts` — RED на отсутствующем successor ownership.
- [ ] **Step 3: Провести successorIds через весь RAM lifecycle.** Добавить обязательное поле в defaults/updateQuick/reconcile/rebase/captured submit/cleanup/discard обеих scopes. Полный canonical comparison включает оба массива; hasQuickDraft включает successor-only. onCreate отправляет одну task.create, копирует оба массива и capture context/raw version. Пример ядра:

```ts
const selected = { predecessorIds: [...predecessorIds], successorIds: [...successorIds] };
// commandTree получает одну command; options сохраняют прежние key/raw-version поля.
const value: Command = { type: 'task.create', title, ...addContext, ...plan, ...selected,
  ...(preserved ? { preserveWork: true } : {}) };
const sentQuickDraft: QuickDraft = {
  title, context: { ...addContext }, plan: { ...plan }, ...selected,
};
```

Вставить в существующий createTask после canNavigate/preserveWork. QuickAdd direction selectable; focus lease привязан к inputId/контексту. Добавить tests close→ack/retry и deliberate outside→blur body→late ack, исчезнувший chain возвращает фокус только своему QuickAdd. Запоминать отзыв намерения при focus/pointer вне picker; его нельзя восстановить проверкой одного document.activeElement. Смена branch/project отменяет старый lease. Обе группы управляются onPredecessors/onSuccessors по callback direction; invalid issue count блокирует submit и показывает причину, без server scheduling. Count — сумма двух массивов с unsaved accessible name. `clear()` очищает обе стороны; ack cleanup по sameQuickDraft плюс raw-generation остаётся хозяином App.
- [ ] **Step 4: GREEN с реальным runtime.** Новый browser file использует `test/expect` из `tests/helpers/journal-e2e.ts` и readTree/send/seedOptionalRuntime. Пройти оба QuickAdd (основной и panel subtask): выбрать A После + B Перед, ввести T, сохранить; один POST commands/revision, graph A→T→B, source dates по Task 1 fixture, один Undo. Outgoing-only без дат сохраняет nullable. Ordinary отказ и 409 показывают обе группы; повтор после refresh только явный. Escape picker не отменяет форму/панель. Build перед browser. Последовательно typecheck/lint/test:unit/test:integration; `npm run build`; `npm run test:e2e -- tests/e2e/dependency-ux.spec.ts tests/e2e/keyboard-entry.spec.ts`.
- [ ] **Step 5: Commit/review.** STATUS, check:kit/diff/staged guard, обычный commit `feat: preserve bidirectional quick-add dependency drafts`; независимый review SHA перед Task 4.

### Task 4: Цепочка общих строк и один immediate host

**Files:** Modify `src/client/TaskTree.tsx`, `TaskTimeline.tsx`, `TaskPanel.tsx`, `App.tsx`, `styles/app.css`, при необходимости `strings.ts`; Test `tests/client/App.test.tsx`, `task-panel-navigation.test.tsx`, `planning.test.tsx`, `task-panel.test.tsx`; Create `tests/client/task-tree-dependencies.test.tsx`; Extend `tests/e2e/dependency-ux.spec.ts`; Modify `docs/STATUS.md`.

**Interfaces:** TaskTree получает `dependencies?: readonly Dependency[]` и `onDependencies?: (task: Task, trigger: HTMLElement) => void`, `dependencyBlockedReason?: string`. TaskTimeline передаёт полный `tree.dependencies`, а свой existing onPredecessors использует и для TaskTree.onDependencies, и для Gantt.onPredecessors. TaskPanel получает optional `onRowDependencies` с той же сигнатурой и передаёт его своему TaskTree, плюс full tree.dependencies. App передаёт один openPredecessors во все три места; sidebar graph продолжает свой draft-aware host. Новый immediateRelation имеет `(direction: DependencyDirection, id: string, remove: boolean): void` и читает актуальный treeRef/hostRef.

- [ ] **Step 1: RED row rendering и routing.** Новый TaskTree test с incoming+outgoing fixture проверяет total incident count, один button/tab stop, отсутствие 0, summary disabled с причиной, draft preview без chain. Нажатия click/Enter/Space/pointerDown не вызывают onSelect/onAction и не начинают drag; callback получает исходный task и trigger. App tests: цепочка другой строки не открывает панель/не двигает QuickAdd; открывается selectable picker; оба направления add/remove посылают точные endpoints/edge IDs. Assertion для удаления противоположной toggle стороны:

```ts
// Fixture содержит A→T и T→B. Toggle сейчас После; удаляем chip Перед B.
await userEvent.click(screen.getByRole('button', { name: 'Убрать последователя: B' }));
expect(sent.command).toEqual({ type: 'dependency.delete', dependencyId: outbound.id });
```

`sent` берётся из уже существующего App fetch-command capture, `outbound` из test fixture. До ack saved chips/count остаются; после ack picker закрывается; Undo восстанавливает edge и даты. Отдельно проверить filtered/collapsed neighbor still counted/searchable.
- [ ] **Step 2: RED locks/focus.** Table-test opening и submit при busy/loading, uncertain pending, conflict, panel dirty/raw-invalid, projectDirty, journalLocked. Открыть при чистом состоянии, затем загрязнить другую задачу и убедиться что picker mutation disabled и command не отправлен; incoming panel draft не меняется. Retry/close/reopen не разрешают второй operationId. Focus sequences: Escape→same row chain; ack/retry→same trigger; close while disabled→ack; outside click→blur body→ack без фокуса; switch project/task; removed/hidden trigger→та же строка именно исходного tree scope→соответствующий QuickAdd. `npx vitest run tests/client/task-tree-dependencies.test.tsx tests/client/App.test.tsx tests/client/task-panel-navigation.test.tsx` — RED.
- [ ] **Step 3: Провести один row entry через существующие компоненты.** Count из полного dependencies, не filtered tasks/schedule/draft. Existing shared tree controls subtask/note сохраняются, chain следует за ними в DOM. Использовать существующий ControlIcon chain. Summary показывает disabled control с доступным пояснением. `aria-label="Зависимости: <title>"`, aria-describedby с количеством/blocked reason; один count внутри одной кнопки. Остановить propagation control keyboard/pointer, не всего дерева.
- [ ] **Step 4: Разместить цепочку без прыжков и перекрытия даты.** Сохранить sticky anchor, но выделить компактный intrinsic-width слот цепочки у правого края. Внутри anchor два прежних действия остаются absolute overlay слева от chain; chain — отдельный child этого же anchor и имеет своё normal-flow место. Резерв слота существует и когда N=0 control скрыт, поэтому hover/selected не сдвигает title/date. Ширина слота общая внутри дерева и его header: 28px плюс место для наибольшего saved count этого полного snapshot; tabular-nums, значение CSS variable `--leaf-dependency-slot-width` вычисляется по максимальному числу цифр (0 цифр при отсутствии связей, иначе зазор 4px + `Nch`). Это компактный резерв, не широкая колонка. Дата заканчивается перед слотом; header date выровнять тем же compact end inset. TaskTimeline задаёт variable на общий wrapper header/tree, TaskPanel — на свой subtree wrapper; filter/hover/selection не пересчитывают width по видимым строкам. При hover/selected/focus-within/touch показываются предыдущие две кнопки поверх только области даты; chain не лежит в скрываемом overlay. CSS ядро:

```css
.task-row-dependency { min-width: 28px; height: 28px; flex: none; }
.task-row-actions {
  flex: 0 0 var(--leaf-dependency-slot-width, 28px);
  position: sticky; inset-inline-end: 0;
}
.task-row-actions-secondary { position: absolute; inset-inline-end: 100%; }
.task-row:not(.selected):not(:hover):not(:focus-within)
  .task-row-dependency[data-count='0'] { opacity: 0; pointer-events: none; }
@media (hover: none) {
  .task-row:not(.selected):not(:hover):not(:focus-within)
    .task-row-dependency[data-count='0'] { opacity: 1; pointer-events: auto; }
}
```

Переименовать/сузить existing `.task-row-actions-inner` selectors под новый secondary wrapper; не оставлять ancestor opacity=0, скрывающий постоянную chain. Все controls ≥28px; 38px строки и title tooltip сохраняются. Reserved slot для summary также нужен для alignment. У count несколько цифр: общий компактный слот допускает рост только от реального изменения максимального count, не hover. Никакого второго indicator/control для измерения или показа; размер рассчитывается из saved counts. Browser проверяет header/date alignment, sticky при горизонтальном скролле, 300px/глубину/long title/diagnostic+critical; корректировать scoped CSS по измерениям, без перестройки layout Ганта.
- [ ] **Step 5: Направленный immediate host и focus lease.** App picker direction selectable, saved обе группы, callback direction задаёт endpoint pair. Deletion ищет exact pair в latest snapshot, отправляет только dependencyId. Recheck `canNavigate()`/project/leaf перед open и каждым submit. Отобразить тот же полный lock set включая journalLocked; доступная причина при грязной панели. Command envelope/execute/pending immutable, cleanup только после ack, global Undo прежний.

```ts
const predecessorId = direction === 'predecessor' ? id : host.taskId;
const successorId = direction === 'predecessor' ? host.taskId : id;
const edge = current.dependencies.find(item =>
  item.predecessorId === predecessorId && item.successorId === successorId);
if (remove && !edge) return;
const value: Command = remove
  ? { type: 'dependency.delete', dependencyId: edge!.id }
  : { type: 'dependency.create', predecessorId, successorId };
```

Сохранить существующий immediateTaskId option и delayed restore flow, добавить постоянный маркер отмены. События focus и pointer вне host/trigger отзывают lease; blur body его не возобновляет. Lease привязан к project/task/tree scope и экземпляру открытого picker, отменяется при navigation/logout. Pending close не снимает global locks. Fallback не делает document-wide выбор одноимённой строки из другого дерева. Одинаковые cases нужны для Gantt bar trigger и row.
- [ ] **Step 6: GREEN/browser/review.** Последовательно typecheck/lint/test:unit/test:integration/build. `npm run test:e2e -- tests/e2e/dependency-ux.spec.ts tests/e2e/fs-dependencies.spec.ts tests/e2e/task-panel-ux.spec.ts`; существующие row-action scenarios находятся также в `tests/e2e/keyboard-entry.spec.ts`: включить этот файл в профильный запуск. STATUS + kit/diff/staged guard; commit `feat: manage dependencies from shared task rows`; review SHA до Task 5.

### Task 5: Сквозная DUX-приёмка и финальный локальный gate

**Files:** Extend `tests/e2e/dependency-ux.spec.ts`; Modify `docs/ACCEPTANCE.md`, `docs/STATUS.md`, `START_HERE.md`. Исправление обнаруженного regression требует отдельного scoped code/test change и повторного review; не объявлять неисполненный case PASS.

**Interfaces:** Consumes completed Tasks 1–4, syntheticRuntime and existing test helpers. Produces заполненную DUX matrix со ссылками на test names/commands, фактическими PASS/FAIL/NOT RUN и ограничения финального SHA. Native zoom — обязательная часть этой задачи, не optional fallback.

- [ ] **Step 1: Дополнить actual-server browser fixtures/assertions.** Использовать independent A/T/B weekdays dates из Task 1, parent branches с одинаковыми названиями, 5+ fan-in/out, long titles, undated leaf, done, summary, глубина ≥6. Не вычислять expected даты через production scheduler. Перехватывать только нужный response для отказа/409/drop, реальные writes выполняет server; читать actual SQLite tree через readTree. Для lost successful response выполнить route.fetch, затем route.abort, retry должен вернуть тот же operationId/envelope и ровно одну задачу/ревизию. Unknown pending нельзя сбросить закрытием picker. Не печатать bodies/cookies.

Пример сквозной проверки сохранения и Undo после созданного mixed T:

```ts
const saved = await readTree(page, runtime.origin, before.project.id);
const t = saved.tasks.find(item => item.title === 'T')!;
expect(saved.project.revision).toBe(before.project.revision + 1);
expect(saved.dependencies.map(edge => [edge.predecessorId, edge.successorId]))
  .toEqual(expect.arrayContaining([[a.id, t.id], [t.id, b.id]]));
await page.getByRole('button', { name: /Отменить/ }).click();
const undone = await readTree(page, runtime.origin, before.project.id);
expect(undone.tasks).toEqual(before.tasks);
expect(undone.dependencies).toEqual(before.dependencies);
```

Здесь before/a/b — результат synthetic seed до единственного UI create; select Undo точным существующим accessible label, если regexp даёт несколько controls. Проверить raw errors, no-match/empty/loading/load-error/write-error; один видимый count до/после ack, graph incoming unsaved count отдельно от row saved count. Проверить original scope saves/Cancel и чужие journal drafts.
- [ ] **Step 2: Геометрия и реальные действия.** В существующих projects 1440×900/1280×800 измерять bounds row/tree/Gantt, count/date/three controls, граф headers и arrows. Минимум: list и Gantt column 300px; panel narrow/fullscreen; 0/1/>4 cards и pages; resize popup после нескольких chips/error; scroll active option в видимую область. Пример ожидаемых чисел:

```ts
const box = await chain.boundingBox();
expect(box!.width).toBeGreaterThanOrEqual(28);
expect(box!.height).toBeGreaterThanOrEqual(28);
const bounds = await row.boundingBox();
expect(bounds!.height).toBeCloseTo(38, 0);
const dateBox = await row.locator('.task-date').boundingBox();
expect(dateBox!.x + dateBox!.width).toBeLessThanOrEqual(box!.x);
```

Для idle count case увести pointer и фокус вне строки до измерения, проверить chain visible/enabled и дату visible; после hover проверить тот же DOM node, count не сменяется копией. Touch: отдельный fresh context `hasTouch: true, isMobile: true` с настоящим `matchMedia('(hover: none)').matches`, выполнить touchscreen tap по chain N=0 без открытия панели. Keyboard: Tab→chain/Enter и Space, arrows/Enter/IME/Escape, close/ack/retry и outside→blur→body. Не ограничиваться CSS declarations.
- [ ] **Step 3: Запустить профильные browser tests на свежей сборке.** `npm run build`, затем `npm run test:e2e -- tests/e2e/dependency-ux.spec.ts tests/e2e/fs-dependencies.spec.ts tests/e2e/task-panel-ux.spec.ts`. Оба viewport проекта, workers=1, retries=0; failing tests исправить по причине, не timeout/screenshot-only assertions.
- [ ] **Step 4: Настоящий browser zoom 200%.** Свежий headed Chromium, отдельный disposable profile и Xvfb display, только syntheticRuntime. Воспроизвести прежнюю методику ACCEPTANCE P27: native Ctrl+0, затем пять native Ctrl+equal через X11 keyboard tool (не page.keyboard в renderer, если shortcut не меняет browser zoom). До/после зафиксировать innerWidth/innerHeight/devicePixelRatio; ожидаем примерно 1440→720 CSS width, DPR1→2. CSS zoom, deviceScaleFactor и CDP pageScaleFactor не считаются browser zoom. На 200% пройти row chain/count, оба toggle, chips/preview, keyboard add/remove, Escape restore, graph headers/add/page и fullscreen panel. Bounding boxes popup должны быть в visual viewport после chips/error/resize, доступные controls не обрезаны. Осмотреть synthetic screenshots только во временном каталоге; не коммитить. Если native shortcut/tool не действует, устранить причину в disposable окружении, а не заменить проверку emulation. Если среда реально блокирует запуск, сообщить координатору FAIL/NOT RUN и оставить DUX12 незавершённым.
- [ ] **Step 5: Полный финальный gate.** На окончательном code candidate последовательно выполнить все команды даже если preflight остановился на известном workspace guard; failed preflight не переименовывать в PASS и не обходить защиту:

```sh
npm run preflight
npm run verify
npm run format:check
npm run check:package
npm run test:e2e
npm run check:kit
git diff --check
```

`verify` включает typecheck/lint/all Vitest/build, полный E2E только после fresh build. Записать число passed/failed/skipped и exact candidate, отделить native zoom от automation. Не читать/удалять private ignored files для исправления preflight; никакого push/deploy или remote CI. После application исправлений повторить затронутые gates и необходимый финальный gate на окончательной версии.
- [ ] **Step 6: Документировать evidence и commit.** ACCEPTANCE DUX01–DUX12 перевести из будущих требований в фактические результаты со ссылками на test names; STATUS перечисляет изменения, checks и ограничения, START_HERE заменяет «план, реализация впереди» проверенными фактами без заявления готовности S4–S6. Stage docs/tests явно, security:staged, обычный commit `test: verify dependency UX acceptance and browser geometry`. Независимый final review exact SHA; root отвечает за уже разрешённую локальную интеграцию и handoff веток/worktree.

## Матрица покрытия и self-review плана

| ID | Реализация | Обязательная evidence |
|---|---|---|
| DUX01 | Task 2 | dependencies.test + browser Task 5: оба section headers внутри graph, 0/1/5 и last-page removal, arrows/navigation |
| DUX02 | Task 4 | task-tree-dependencies/App + browser Task 5: три tree scope, idle N>0 одна кнопка+дата, summary, actual touch/keyboard |
| DUX03 | Tasks 2–4 | picker component multi-selection/toggle + обе QuickAdd/row/Gantt browser, reopen default без потери groups |
| DUX04 | Task 2, context wiring Task 3 | predecessor-view independent full proposal/indirect cycle/parent cases + hidden/collapsed/path browser |
| DUX05 | Task 4, outgoing graph Task 2 | App ack/exact edge tests + actual server add/remove/Undo с датами и stable unrelated IDs |
| DUX06 | Tasks 2/4 | task-panel/navigation/App guard matrix, schedule task.edit assertions и actual-server dirty/raw/pending/conflict cases |
| DUX07 | Tasks 1/3 | repository/API incoming/outgoing/mixed/absent/[]/nullable/fan-in-out/one cascade/Undo + оба QuickAdd browser |
| DUX08 | Task 1 | strict API malformed/duplicate; repository rows() rollback foreign/missing/summary/conversion/cycle/done/legacy/overflow |
| DUX09 | Tasks 1/3/4 | API OPERATION_REUSED, App 409/exact/frozen/raw-version/scoped cleanup; browser dropped-success response/retry |
| DUX10 | Tasks 2–4 | picker IME/keys; graph/QuickAdd/immediate focus token tests; browser outside→blur→body, disappeared trigger and scoped fallback |
| DUX11 | Tasks 2–4 | component loading/error/empty/busy, host locks; browser popup bounds/chips/error/resize and close-pending interlock |
| DUX12 | Tasks 4/5 | actual desktop bounds, 300px/depth, narrow/fullscreen, real touch, mandatory headed native browser zoom 200% |

План проверен по каждой секции C33/D28: task.edit/SQL/DTO не расширяются, shared schema имеет одного writer, каждое изменение caller находится в том же task, что и его type change; frozen historical replies и no-backward-scheduling сохраняются. DUX matrix — план проверок, не заявление их прохождения. До исполнения ни один DUX не помечается PASS на основании этого документа.
