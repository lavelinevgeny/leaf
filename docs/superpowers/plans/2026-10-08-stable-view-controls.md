# Stable view controls Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use subagent-driven-development to implement this plan task-by-task. Steps use checkbox syntax for tracking.

**Goal:** Реализовать C22: «Список / Гант», стабильную геометрию, дату по запросу и фильтры без добавочной строки.

**Architecture:** Сохраняем TaskTimeline с единым деревом и общими строками; меняется только presentation. TaskFilters владеет popover и фокусом. Чистая filterTasks остаётся единственным алгоритмом отбора и счёта.

**Tech Stack:** Existing TypeScript, React/Vite, CSS, Vitest/Testing Library, Playwright.

**Spec:** [C22](../specs/2026-10-08-stable-view-controls-design.md).

## Global Constraints

- Сервер, схема, API, scheduler, source dates, CPM, транзакции и undo не меняются. Новых зависимостей нет.
- Высота строки 38 px; допуск стабильности геометрии 1 px; desktop 1440×900 и 1280×800; первая строка не ниже 230 px в базовом C20.
- Поиск: существующие trim/NFC, регистронезависимая подстрока, AND со статусом; счётчик без родителей контекста. Использовать filterTasks.
- Только синтетические fixtures; никакие screenshots, private runtime files, переписка или локальные персональные пути не коммитятся.
- Каждый агент работает в отдельном worktree вне основного checkout, читает START_HERE/AGENTS и профильные docs. Общие файлы меняются последовательно. Root сохраняет несвязанную правку STATUS.
- Node 24.21.0/npm 11.19.0; реальный Gitleaks для commit checks. Без skips, bypass hooks, новых пакетов, push/deployment.

## File structure

- `src/client/App.tsx`: state представления, размещение контроля в шапке.
- `src/client/TaskViewControl.tsx`: небольшая группа двух кнопок.
- `src/client/TaskTimeline.tsx`: общий toolbar, заголовок и дерево, scroll restoration, today tooltip, область пустого результата.
- `src/client/TaskFilters.tsx`: поиск, очистка, popover статуса и сброс.
- `src/client/strings.ts`, `src/client/styles/app.css`, `src/client/styles/planning.css`: централизованные строки и стили без новых библиотек.
- Client/E2E tests: доступность, состояние, геометрия и отсутствие server writes.

### Task 1: Stable list/Gantt switching and today disclosure

**Files:** Create `src/client/TaskViewControl.tsx`; modify App, TaskTimeline, strings, planning.css/app.css as needed. Test `tests/client/gantt.test.tsx`, `tests/client/inline-add.test.tsx`, `tests/client/planning.test.tsx`, `tests/e2e/compact-workspace.spec.ts`; create `tests/e2e/view-controls.spec.ts`. Update existing checkbox selectors in affected browser tests without removing their behavioral assertions.

**Interfaces:** Consumes existing `showGantt: boolean`, `setShowGantt`, `TaskTimeline.viewControl?: ReactNode`, `useProjectToday(timezone)`. Produces `TaskViewControl({showGantt, onChange}: {showGantt: boolean; onChange: (show: boolean) => void})` with group «Представление задач» and buttons «Список», «Гант». Leaves filter projection and old result block for Task 2.

- [x] Step 1: Add red tests for two pressed-state buttons and keyboard switching, persistent tree/editor and state; today tooltip hover/focus uses project date.

```tsx
const gantt = screen.getByRole('button', { name: 'Гант', exact: true });
await user.click(screen.getByRole('button', { name: 'Список', exact: true }));
expect(gantt).toHaveAttribute('aria-pressed', 'false');
await user.click(gantt);
expect(gantt).toHaveAttribute('aria-pressed', 'true');
```

- [x] Step 2: Run `npm exec vitest run tests/client/gantt.test.tsx tests/client/inline-add.test.tsx`; record expected red evidence.
- [x] Step 3: Implement semantic segmented control, mount common header/tree once, reserve toolbar height, and hide timeline only. Preserve existing scale/start; remember horizontal offset when hiding; do not auto-scroll on ordinary switching. Use existing ROW_HEIGHT/HEADER_HEIGHT values and tooltip style/focus conventions. Remove standalone `{start}` text. Example core control:

```tsx
<div role="group" aria-label="Представление задач" className="task-view-control">
  <button type="button" aria-pressed={!showGantt} onClick={() => onChange(false)}>Список</button>
  <button type="button" aria-pressed={showGantt} onClick={() => onChange(true)}>Гант</button>
</div>
```

- [x] Step 4: Add Playwright synthetic regression seeding at least 30 rows, capture a visible row ID after vertical scroll, then compare geometry/state across both modes, also with selected task panel and dirty quick input. Measure header/toolbar rectangles and scrollTop (tolerance 1); no writes, unchanged readTree snapshot. Verify horizontal position, scale/period and today tooltip. Synthetic captures go to OS temp outside checkout and must be visually inspected.

```ts
const y = (await row.boundingBox())!.y;
const top = await page.locator('[data-plan-scroll]').evaluate(n => n.scrollTop);
await page.getByRole('button', { name: 'Список', exact: true }).click();
expect(Math.abs((await row.boundingBox())!.y - y)).toBeLessThanOrEqual(1);
expect(await page.locator('[data-plan-scroll]').evaluate(n => n.scrollTop)).toBe(top);
```

- [x] Step 5: Run focused client tests, `npm run typecheck`, `npm run lint`, focused E2E in both viewport projects; format changed code. Update legacy selectors only to the new real controls. Stage own files, `npm run security:staged`, commit `feat: stabilize list and Gantt view switching`. Report red/green evidence, checks and concerns. Controller performs task spec/quality review before Task 2.

### Task 2: Filter popover and inline result count

**Files:** Modify TaskFilters, App, TaskTimeline, TaskViewControl, strings, app.css/planning.css. Test `tests/client/task-filters.test.tsx`; create focused component tests if useful. Update `tests/e2e/task-filters.spec.ts`, `tests/e2e/view-controls.spec.ts`, `tests/e2e/compact-workspace.spec.ts` and affected filter expectations.

**Interfaces:** Consumes completed Task 1 stable toolbar and `filterTasks(tasks, filter)`. Keep existing TaskFilters props. TaskTimeline renders its existing `projection.matchIds.size` status within `.gantt-toolbar`; when no matches the message belongs to `.plan-scroll`. No new count state/callback or duplicate search algorithm. Exclude ephemeral filter-popover editors from TaskViewControl pointer-focus preservation: a real outside click on a view button closes the popover and focuses that button; persistent search/task editors still retain focus.

- [x] Step 1: Red tests open button «Фильтры», assert focus on select «Фильтр по статусу», select doing, badge 1; Escape returns opener focus without closing task panel. Test click outside, Tab out, disabled/loading closure, project remount, text clear preserves status, and combined reset clears both/focuses search.

```tsx
await user.click(screen.getByRole('button', { name: /^Фильтры/ }));
const status = screen.getByRole('combobox', { name: 'Фильтр по статусу' });
expect(status).toHaveFocus();
await user.selectOptions(status, 'doing');
await user.keyboard('{Escape}');
expect(screen.getByRole('button', { name: 'Фильтры · 1' })).toHaveFocus();
```

- [x] Step 2: Run `npm exec vitest run tests/client/task-filters.test.tsx`; record expected red.
- [x] Step 3: Implement controlled status popover with refs/effects and close on outside pointer, focus departure, loading/project change. Stop Escape propagation before panel handler; loading select never remains stranded. Reserve fixed footprint of search/clear and badge; count inline in fixed toolbar and zero message in task area. Reset closes/focuses search. Use centralized strings and existing statusLabels.

```tsx
<button type="button" aria-expanded={open} aria-controls={popoverId}
  onClick={() => setOpen(value => !value)} disabled={disabled}>
  {filter.status === 'all' ? strings.filters : `${strings.filters} · 1`}
</button>
```

- [x] Step 4: Extend synthetic browser test to measure toolbar/header/plan area before/after opening, applying/clearing search/status, zero matches and reset. Assert match count excludes parent context, restored collapse and common Gantt rows. Verify D14 unchanged and writes=0 plus unchanged server tree, quick draft, dirty panel and errors. Cover both desktop viewports, panel opened, long project name; no relaxation of Task 1 geometry assertions.
- [x] Step 5: Run focused client tests, typecheck/lint and relevant filter/geometry/compact E2E; format, scan staged files and commit `feat: move task filters into a compact popover`. Report evidence. Controller task review then broad whole-change review.

## Root integration and completion

- [x] Before execution: self-review spec/plan coverage, create plan-scoped ledger and briefs; commit only specs/plan/doc pointers, leaving unrelated STATUS unstaged.
- [x] Integrate each reviewed task by fast-forward/cherry-pick into the owner feature branch, preserving the original working changes; review fixes go back to implementer.
- [x] Run `npm run verify`, `npm run format:check`, full `npm run test:e2e`, `npm run check:kit`, `npm run check:package`, `npm run security:workspace`; appropriate staged/history checks before local commits. Do not repeat broad checks without new changes/failures.
- [x] Review synthetic captures against approved references; final independent whole-change review, fix material findings through an implementer and scoped review.
- [x] Update STATUS with actual results, limitations and next task; mark completed steps. Preserve pre-existing audit addition separately from staged handoff. Report implementation/spec/plan links and verification; no external publication.
