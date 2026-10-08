# Gantt Start Resize Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [x]`) syntax for tracking.

**Goal:** Добавить левую ручку Ганта, сохраняющую окончание и пересчитывающую длительность по календарю.

**Architecture:** Additive V2 task.resizeStart вычисляет duration на сервере, применяет existing source guards, FS validation и transaction/CPM/undo. Клиент добавляет третье gesture kind, preview и доступную ручку, сохраняя прежние move/right resize и C18 panel semantics.

**Tech Stack:** TypeScript, React, Fastify, Zod, SQLite, Vitest, Playwright. Existing pinned Node/npm из .nvmrc/package.json.

**Spec:** [C27 design](../specs/2026-10-09-gantt-start-resize-design.md).

## Global Constraints


- Один TypeScript package, React/Vite + Fastify + SQLite; никаких новых dependencies, schema migrations или lockfile изменений.
- Английские identifiers, централизованные русские UI строки; C18 panel semantics сохраняются.
- Только synthetic fixtures, без реальных баз, credentials, exports и owner screenshots; без push/deploy/publication.
- Все authoritative записи, вычисление длительности, FS validation и CPM выполняются сервером атомарно; display значения не записываются.
- Отдельные worktrees для concurrent agents; один writer shared contracts/scheduling semantics; независимый spec review и quality review каждого task с исправлением замечаний перед следующим task.

## Execution and review gates

Автор спецификации/плана, implementation agent и review agents разные. Каждый implementation task выполняется в отдельном worktree последовательно: Task 2 опирается на проверенный Task 1. После task сначала независимый spec review, затем независимый quality review; любые замечания исправляет implementer, reviewer проверяет исправленный diff. Root объединяет только accepted changes, запускает финальные проверки и независимые final reviews. Не менять security guards для linked worktree; publication gates выполняются из root checkout.

## Task 1: Authoritative V2 start-resize command

**Files:**
- Modify: `src/shared/contracts.ts` — additive commandV2Schema member.
- Modify: `src/domain/planning.ts` — чистый server-used duration/source helper, если нужен для малого repository switch.
- Modify: `src/server/repository.ts` — apply branch, cascade eligible command list и explicitlyEditedTaskId.
- Test: `tests/optional-planning.test.ts`, `tests/optional-api.test.ts`, `tests/fs-cascade-repository.test.ts`, `tests/legacy-compatibility.test.ts`.

**Interfaces:**
- Consumes: `realInterval(source, calendar)`, `workingDaysInclusive(start, finish, calendar)`, `applyPrivateSourcePatch` и existing `mutate`/`cascadeFs`.
- Produces: `CommandV2` member `{ type: 'task.resizeStart'; taskId: string; inputStart: string }`; no new stored field. Existing `Repository.applyCommand(projectId, envelope, sessionId): ProjectTree` returns canonical source and schedule.

- [x] **Step 1: Add failing contract/repository tests using existing synthetic harnesses.**

Add this literal test in `tests/fs-cascade-repository.test.ts`, using that file's existing fresh/create/task/step helpers:

```ts
it('resizes the start with a fixed inclusive finish and exact undo', () => {
  let tree = create(fresh(), 'B', '2026-10-05', '2026-10-09');
  const b = task(tree, 'B');
  expect(b.durationDays).toBeNull();
  tree = step(tree, {
    type: 'task.resizeStart', taskId: b.id, inputStart: '2026-10-04',
  });
  expect(task(tree, 'B')).toMatchObject({
    inputStart: '2026-10-04', inputFinish: '2026-10-09', durationDays: 6,
  });
  tree = step(tree, { type: 'undo' });
  expect(task(tree, 'B')).toMatchObject({
    inputStart: '2026-10-05', inputFinish: '2026-10-09', durationDays: null,
  });
});
```

Add literal weekdays case via existing project.schedule, 02…09/6 and 09…09/1; existing duration 5 and null variants. Add strict schema acceptance/rejection with concrete UUIDs from optional-api tests, V1 rejection, no-op null preservation. Capture existing `rows()` before rejected done/summary/null/unavailable/weekend/after-finish/overflow/FS commands and assert equality afterwards. Use GSR03 P=05…06→B=07…09 and GSR04 downstream C=12…13, ancestor summary and literal CPM values. Unknown predecessor stays unknown; never use display dates as constraint. Add operationId replay with identical envelope, changed envelope OPERATION_REUSED, stale 409, close/reopen synthetic DB and exact undo/restart assertions. Reuse existing fault-injection pattern for transaction failure rollback.

- [x] **Step 2: Confirm tests fail for the missing command.**

Run `npx vitest run tests/optional-planning.test.ts tests/optional-api.test.ts tests/fs-cascade-repository.test.ts tests/legacy-compatibility.test.ts`. Expected RED: missing command schema/switch/type; do not change historical expectations to hide failure.

- [x] **Step 3: Implement strict command schema and authoritative mutation.**

Add member using existing uuid/date schema names in contracts (read definitions before editing):

```ts
z.strictObject({
  type: z.literal('task.resizeStart'),
  taskId: uuidSchema,
  inputStart: calendarDateSchema,
})
```

Repository branch rejects summary/done/unavailable/incomplete real interval using existing error categories and localized messages; return without source edits if target equals source start. For real changes build the following source patch and pass it through existing private source validator before assigning timestamps:

```ts
const patch = {
  inputStart: command.inputStart,
  durationDays: workingDaysInclusive(
    command.inputStart, task.inputFinish!, snapshot.project.calendarType,
  ),
};
```

Validate duration bounds with source schema, map RangeError to existing INVALID_INTERVAL. Do not assign inputFinish or clear unavailable provenance. Add task.resizeStart to applyCommand cascade allowlist. Generalize existing explicitlyEditedTaskId condition to task.edit OR task.resizeStart when changedSourceTaskIds includes taskId; addedDependencyIds is empty for this command. Existing unchanged-finish barrier prevents outgoing moves; incoming direct source conflict must reject. Receipt payload remains `canonical(input)` containing new type/target, existing operation digest/cache and undo remain untouched. No new SQL migration or V1 member.

- [x] **Step 4: Run focused tests and gates; inspect SQL/undo equivalence and old contracts.**

Run focused command above, then `npm run typecheck`, `npm run lint`, `npm run test:unit`, `npm run test:integration`, `npm run format:check`, `npm run check:kit`. Fix failures caused by change, rerun affected gates. Record actual passed/failed/not-run counts in docs/STATUS.md; no broad unrelated refactor.

- [x] **Step 5: Submit task diff to independent spec and quality reviewers, fix/review until accepted, then commit.**

Use scoped git add of listed files and descriptive subject `feat: add authoritative Gantt start resize command`; run staged checks through approved existing workflow. Reviewer verifies GSR01–GSR05 and C18/right resize compatibility. No push.

## Task 2: Left handle, gestures and actual-server acceptance

**Files:**
- Modify: `src/client/Gantt.tsx` — gesture/preview/left handle/cancellation.
- Modify: `src/client/TaskTimeline.tsx`, `src/client/App.tsx` — onPlan type and task.resizeStart command dispatch.
- Modify: `src/client/planning-view.ts` — shared kind/type or left intent validation; no C18 mutation.
- Modify: `src/client/strings.ts`, `src/client/styles/planning.css` — localized name and non-overlapping hit geometry.
- Test: `tests/client/gantt.test.tsx`, `tests/client/gantt-view.test.ts`, `tests/client/App.test.tsx`, `tests/e2e/planning-ui.spec.ts`.
- Modify: `docs/UI.md`, `docs/STATUS.md` — actual behavior/results.

**Interfaces:**
- Consumes: Task 1 V2 command above; existing `command` pending/retry/notice/dirty guard path in App.
- Produces: onPlan `(task: Task, kind: 'move' | 'resize' | 'resize-start', target: string) => void`; left selector `data-gantt-resize-start`, Russian accessible name «Изменить начало: <название>». Existing selectors/body keyboard/right duration choice unchanged.

- [x] **Step 1: Add failing client tests before drawing the handle.**

In gantt.test.tsx use existing props/optionalTreeFixture helpers:

```tsx
it('uses the left handle keyboard without moving the finish or body', () => {
  const tree = optionalTreeFixture();
  const p = props(tree);
  render(<Gantt {...p} />);
  const handle = screen.getByRole('button', { name: 'Изменить начало: Работа A' });
  fireEvent.keyDown(handle, { key: 'ArrowLeft' });
  expect(p.onPlan).toHaveBeenCalledTimes(1);
  expect(p.onPlan).toHaveBeenCalledWith(tree.tasks[1], 'resize-start', '2026-10-02');
  expect(p.onSelect).not.toHaveBeenCalled();
});
```

Existing fixture Работа A=05…06 weekdays. Add ArrowRight to finish (duration 1), no ArrowRight beyond finish, Friday→Monday index stepping, body/right callbacks unchanged, no handle done/summary/conditional/draft/invalid/disabled/clipped-start. Reuse pointer helper with setPointerCapture mocked; verify only x1 changes, original x2 remains, foreign pointer/no-op/primary button guards, Escape/pointercancel/lostcapture and prop cancellation release do not dispatch. Add App request assertion task.resizeStart body, absence of duration dialog, existing dirty guard, server error/stale notice, focus after ack/rollback.

- [x] **Step 2: Run focused client tests and confirm missing-handle/type failures.**

Run `npx vitest run tests/client/gantt.test.tsx tests/client/gantt-view.test.ts tests/client/App.test.tsx`. Expected RED on absent named handle/command dispatch; preserve unrelated tests.

- [x] **Step 3: Implement third gesture and route start resize to server.**

Use the same kind union in Gantt, TaskTimeline and App. Anchor new gesture at interval.start; preview applies delta only to x1. The body and right modes keep their existing anchors and dialog. Before onPlan start dispatch, check target via workingDaysInclusive(target, original finish, calendar); reject reverse/non-working/range and span > 1_000_000, retain localized notice path. Do not snap weekends or materialize dates. App validates canNavigate/current revision/current task, then:

```ts
if (kind === 'resize-start') {
  await command({ type: 'task.resizeStart', taskId: task.id, inputStart: target });
  return;
}
```

Left rect uses existing editable plus x1 visibility guard, centralized string and separate data selector, captures pointer/stops propagation. Keyboard computes target through indexToDate(±1, interval.start, calendar), stops bubbling even when invalid; Shift remains left action. Share cancellation helper where useful, add lostcapture and unmount cancellation without canceling valid pointerup. Allocate non-overlapping edge zones/body for one-day visible bars in days/weeks/months; retain existing right appearance unless geometric necessity requires smaller hit region.

- [x] **Step 4: Add and run actual-server Playwright cases with literal persisted expectations.**

Extend existing syntheticRuntime/seedOptionalRuntime/readTree/send harness in planning-ui.spec.ts. Example keyboard case using existing Работа A initially 05…06 with null duration:

```ts
await page.goto(runtime.origin);
const handle = page.getByRole('button', { name: 'Изменить начало: Работа A' });
await handle.focus();
await page.keyboard.press('ArrowLeft');
await expect(page.getByRole('button', { name: /Работа A, 2026/ }))
  .toHaveAttribute('aria-label', /2026-10-02 – 2026-10-06/);
const changed = await readTree(page, runtime.origin, initial.project.id);
expect(changed.tasks.find(t => t.title === 'Работа A')).toMatchObject({
  inputStart: '2026-10-02', inputFinish: '2026-10-06', durationDays: 3,
});
expect(changed.project.revision).toBe(initial.project.revision + 1);
```

Add pointer drag by boundingBox/data selector, assert fixed right position and persisted finish/reload/undo exact null restoration. Add weekend target reject, one-day overlap/keyboard, done/summary/conditional states, empty/loading/error; Escape/capture/scale/filter cancellation. Add FS GSR03 rejected date and valid later start with canonical source, source/calendar/C18/right regressions. Reuse existing FS E2E lost-response pattern: route.fetch applies first, suppress response, retry sends exact body/operationId; assert one outcome/revision and no premature source change. Real competing send before released route gives 409 and intact snapshot. Dirty panel guard must prevent start edit. Run both configured viewports 1440×900 and 1280×800, no retries/skips. Inspect synthetic captures outside checkout against unchanged approved PNGs.

- [ ] **Step 5: Run complete relevant gates and update facts.**

Run `npm run verify`, `npm run format:check`, `npm run check:kit`, `npm run check:package`, `npx playwright test tests/e2e/planning-ui.spec.ts tests/e2e/conditional-gantt.spec.ts tests/e2e/fs-dependencies.spec.ts`, `git diff --check`. Root runs full E2E/preflight in ordinary checkout after accepted integration. Record failures honestly; no --if-present/skips/timeouts relaxation. docs/STATUS.md lists touched areas/check counts/limitations and next S4–S6, keeping unrelated owner entries.

- [ ] **Step 6: Independent spec/quality review, fixes and final handoff.**

Review GSR06–GSR07 plus server/client contract consistency, right resize/C18/done/null safety and focus/cancel. Repeat reviewer cycle until accepted, commit scoped files with subject `feat: resize Gantt starts while preserving finishes`. Root performs final independent reviews and verifies integrated bytes/checks before owner report; no remote changes.

## Integration checkpoint — 2026-10-09

Server и client выполнены разными агентами; каждый этап прошёл независимые spec/quality reviews. Два цикла исправили boundary repeat и поздний перехват фокуса. Root verify: 831/831 tests; format/kit/package и preflight с 52/52 scanner/hook tests PASS. Первый полный E2E: 162/164; два существующих calendar cases нуждались в hover перед скрытым меню. Однострочное исправление теста прошло независимый review и affected 2/2. Полный повторный E2E и whole-change review выполняются на интегрированной версии перед закрытием Steps 5–6.
