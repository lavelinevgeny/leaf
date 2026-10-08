# Conditional Gantt Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [x]`) syntax for tracking.

**Goal:** Реализовать C19: видимые условные own/group/today полосы и создание с очищаемой длительностью 1 без автоматической даты.

**Architecture:** Чистый domain helper обслуживает статическую server display и клиентский today fallback. Серверный CPM/source/SQL не меняются. Общие PlanFields обслуживают создание и редактирование; App хранит сроки в существующих per-project/per-branch черновиках.

**Tech Stack:** Один TypeScript package; существующие React/Vite, Fastify/SQLite, Vitest и Playwright.

**Spec:** [C19](../specs/2026-10-08-conditional-gantt-design.md), [ADR 010](../../adr/010-conditional-display-today.md).

## Global Constraints

- Условные края не участвуют в summary, FS, coverage и CPM и не становятся концами временных стрелок.
- Response DTO, SQL, migration, frozen replies и authoritative CPM не меняются. task.create получает три необязательных source поля из существующей sourcePatchSchema, с nullable defaults и серверной проверкой полного интервала; версия контракта остаётся 2.
- Новый черновик: durationDays=1, inputStart/inputFinish=null.
- API без явно переданных полей сохраняет прежний default null.
- Без новых зависимостей, схем хранения, миграций, автопланирования, resources, holiday calendar или изменений S4 доски/S5/S6.
- Только синтетические данные; Node 24.21.0, npm 11.19.0. Не менять lockfile/security/hooks и не выполнять remote действия.

### Task 1: Чистая проекция и Гант

**Files:** Modify `package.json` (include display tests in test:unit); create `src/domain/conditional-display.ts`, `src/client/use-project-today.ts`; modify `src/domain/scheduling.ts`, `src/client/gantt-view.ts`, `src/client/Gantt.tsx`, `src/client/TaskTimeline.tsx`, `src/client/strings.ts`; tests `tests/conditional-display.test.ts`, `tests/optional-scheduling.test.ts`, `tests/explicit-cpm.test.ts`, `tests/client/explicit-cpm.test.tsx`, `tests/client/gantt-view.test.ts`, `tests/client/gantt.test.tsx`, `tests/client/today.test.tsx`.

**Interfaces:** `conditionalDisplay(source: SourceFields, groupStart: string | null, today: string | null, calendar: CalendarType): ConditionalDisplay | null`; `conditionalFinish(anchor, duration, calendar)` preserves its existing export; `ganttInterval(task, schedule, context?: { today: string; calendar: CalendarType })`; `useProjectToday(timezone: string): string`.

- [x] Write literal failing tests for own start/finish, group priority, root today, calendars, clipping, invalid/complete pairs and immutable input. Example:

```ts
expect(conditionalDisplay({ inputStart: null, inputFinish: '2026-10-12', durationDays: 2 }, '2026-10-05', '2026-10-08', 'weekdays')).toEqual({ kind: 'conditional', startDate: '2026-10-09', finishDate: '2026-10-12', clipped: false });
```

- [x] Run `npx vitest run tests/conditional-display.test.ts tests/client/gantt-view.test.ts` and record RED on missing helper/context behavior.
- [x] Move unchanged forward display arithmetic into the helper, add symmetric backward arithmetic, use own dates before group/today, reject invalid/complete sources. Server invokes with today=null; client uses context today only when provided.

```ts
const display = conditionalDisplay(task, task.parentId === null ? null : knownStartMin.get(task.parentId)!, null, input.calendarType);
if (display) displays.set(id, display);
```

- [x] Pass the same explicit today/calendar to rendering and reveal; refresh today every minute and on focus/visibilitychange. Change conditional accessible text to full-interval wording; preserve real markers, real labels and gesture restrictions.
- [x] Update superseded finish-only/no-anchor assertions; run domain/Gantt/CPM/legacy suites. Verify no summary/FS/critical source promotion and no frozen-module edits.

### Task 2: Создание и Today

**Files:** Modify `src/shared/contracts.ts`, `src/server/repository.ts`, `tests/optional-api.test.ts`, `src/client/App.tsx`, `src/client/QuickAdd.tsx`, `src/client/PlanFields.tsx`, `src/client/CalendarDateInput.tsx`, `src/client/TaskPanel.tsx`, `src/client/strings.ts`, `src/client/styles/planning.css`; tests `tests/client/quick-add.test.tsx`, `tests/client/App.test.tsx`, `tests/client/planning.test.tsx`.

**Interfaces:** QuickDraft gains `plan: SourceFields`; QuickAdd consumes `plan`, `onPlan`, project calendar/timezone; `onCreate(title, context, plan)` carries one task.create payload. PlanFields accepts optional timezone and task status, CalendarDateInput accepts explicit today.

- [x] Write failing interaction tests: initial 1, clearing, unchanged existing null, Today sets linked draft but no request, failed request retains source, separate branch drafts, exact retry/reset. Assert:

```ts
expect(commands[0]?.command).toMatchObject({ type: 'task.create', durationDays: 1, inputStart: null, inputFinish: null });
```

- [x] Run `npx vitest run tests/client/quick-add.test.tsx tests/client/App.test.tsx tests/client/planning.test.tsx` and record RED.
- [x] Add disclosure with shared PlanFields and a Today action beside start. Use `completeSourceEdit({ ...plan, inputStart: today }, 'inputStart', calendar)` through the existing commit path; preserve weekday validation, locked/done/summary behavior.
- [x] Extend strict task.create with `...sourcePatchSchema.shape`; repository uses null for omitted fields, calls `validateSourceInput(source, calendar)` before converting the parent, and creates source in the same transaction. Test valid pair, defaults, mismatch/weekend rollback, exact replay and undo.
- [x] Store plan with title/context in App. Send `...plan` in task.create, keep source through failed/uncertain responses, reset only confirmed matching draft to default source. Track/discard changed source for logout/beforeunload.

```ts
const defaultPlan: SourceFields = { inputStart: null, inputFinish: null, durationDays: 1 };
```

- [x] Run focused client tests; verify main/subtask keyboard focus, invalid form, disabled pending and independent draft context.

### Task 3: Сквозная проверка и handoff

**Files:** Create `tests/e2e/conditional-gantt.spec.ts`; modify superseded checks in `tests/e2e/explicit-cpm.spec.ts`, `tests/e2e/subtasks.spec.ts`, `tests/e2e/task-tree.spec.ts`; update `docs/STATUS.md` and this plan.

- [x] Add synthetic browser tests using syntheticRuntime/readTree/send and `page.clock.install`: own/group/today positions, day rollover/reveal/keyboard without mutations, default/clear/Today creation, one undo, exact retry and restart. Assert saved nullable fields and unchanged revision after day rollover.
- [x] Run `npm run verify`, `npm run format:check`, `npm run test:e2e`, `npm run check:package`, `npm run check:kit`, `npm run test:kit`, `npm run security:workspace` on pinned Node. Fix regressions caused by C19 and rerun affected checks without skips.
- [x] Inspect scoped diff, specification coverage and synthetic UI in both viewports; record passed/failed/not run with counts and limitations in STATUS. No commit/push/deployment required by this plan.

## Результат выполнения

Все задачи выполнены 2026-10-08. Финальный verify 620/620; полный browser suite 68/68, после финальной правки QuickAdd профильные browser suites 20/20. Format, package, kit, test:kit 52/52, workspace и diff checks PASS. Факты и ограничения — в [STATUS](../../STATUS.md). Изменения оставлены в рабочем дереве без коммита и публикации.
