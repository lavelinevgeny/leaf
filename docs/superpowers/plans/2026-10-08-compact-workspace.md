# Compact workspace implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Deliver C20: tasks immediately below compact controls, contextual diagnostics and settings/help on request.

**Architecture:** Keep the existing React/Fastify/SQLite package and authoritative scheduler. Extract small client project controls for the menu/dialog lifecycle; retain App ownership of existing commands and dirty/conflict state. Use existing schedule diagnostics for local row indicators, without generating scheduling semantics in React.

**Tech Stack:** TypeScript, React, existing CSS tokens, Vitest/Testing Library, Playwright; Node 24.21.0/npm 11.19.0.

**Spec:** [C20](../specs/2026-10-08-compact-workspace-design.md)

## Global Constraints

- Серверные транзакции, scheduler, source dates, календарь, timezone, coverage DTO, зависимости, критические множества и undo не меняются.
- Новых библиотек, схемы, API, раздела аналитики, дублирования или удаления проекта нет.
- Partial critical labels в строках, полосах и связях сохраняются отдельно от global.
- Проверки используют только синтетические проекты. Собственные временные снимки не коммитятся; изображения и реальные названия из беседы не копируются.
- Separate worktree per agent; implementation tasks execute sequentially. Preserve unrelated files and do not touch lockfile/security policy. All task reviews cover spec and quality before integration.

---

### Task 1: Compact header and project controls

**Files:** Create `src/client/ProjectControls.tsx`, `tests/client/project-controls.test.tsx`; modify `src/client/App.tsx`, `src/client/ProjectPlan.tsx`, `src/client/TaskFilters.tsx`, `src/client/strings.ts`, `src/client/styles/app.css`, `src/client/styles/planning.css`, `tests/client/App.test.tsx`, `tests/client/task-filters.test.tsx`, `tests/e2e/planning-ui.spec.ts`, `tests/e2e/explicit-cpm.spec.ts`.

**Interfaces:** Consumes current `ProjectPlan` props `project`, `disabled`, `onSave: (project.schedule command) => Promise<boolean>`, `onDirty`; App retains `command`, `renameProject`, `rename`, `setProjectPlanDirty`, errorView and navigation protection. Produces compact project controls/dialog rendering and accessible menu opener `Действия проекта`. Settings/rename keep existing names. No new API contracts. Local errors/retry must remain visible when a modal is open; reuse App feedback instead of obscuring it behind modal content.

- [x] Step 1: Add interaction tests before implementation. Cover initial absence of settings fields/rename form, menu keyboard open/Escape focus return, dialog Tab containment, saved/discarded/failed settings drafts, rename persistence, guards against project switch/task selection while dirty, no writes from menu actions. Adapt existing rename and project-settings browser flows to explicitly open the new menu. Test reset absence initially and after reset.

```tsx
expect(screen.queryByRole('button', { name: 'Сбросить поиск и фильтры' })).toBeNull();
await user.click(screen.getByRole('button', { name: 'Действия проекта' }));
await user.click(screen.getByRole('button', { name: 'Настройки проекта', exact: true }));
expect(screen.getByRole('dialog', { name: 'Настройки проекта', exact: true })).toBeVisible();
await user.type(screen.getByLabelText('Часовой пояс проекта'), '/invalid');
await user.keyboard('{Escape}');
expect(screen.getByLabelText('Часовой пояс проекта')).toHaveValue('UTC/invalid');
```

- [x] Step 2: Run `npx vitest run tests/client/project-controls.test.tsx tests/client/App.test.tsx tests/client/task-filters.test.tsx`; record real RED cases, not only pre-existing failures.
- [x] Step 3: Implement focused project controls; menu contains settings and rename only. Reuse existing command ownership and ProjectPlan form; mount it on demand, never silently unmount dirty drafts. Use native dialog or equivalent complete focus handling, return focus and explicit discard. Successful save may leave a clean dialog open; closing clean dialog restores opener. Handle project changes and close stale clean forms. Remove original large rename form and permanently mounted ProjectPlan. Use compact spacing, conditional reset and icon undo with existing accessible name/title and all disabled guards.

```tsx
{(filter.query !== '' || filter.status !== 'all') && (
  <button type="button" aria-label={strings.resetTaskFilters}
    disabled={disabled} onClick={() => { onChange(emptyTaskFilter); input.current?.focus(); }}>
    {strings.reset}
  </button>
)}
```

- [x] Step 4: Run covering tests, `npm run typecheck`, `npm run lint`, format affected files. Do not remove assertions about dirty/conflict/uncertain saves to accommodate a dialog. Agent report records RED/GREEN, commands, limitations; commit only scoped changes with an English subject. Task review and integration precede Task 2.

### Task 2: Contextual schedule diagnostics and on-demand Gantt help

**Files:** Create `src/client/schedule-diagnostics.ts`, `tests/client/schedule-diagnostics.test.tsx`; modify `src/client/App.tsx`, `src/client/ScheduleStatus.tsx`, `src/client/TaskTree.tsx`, `src/client/TaskTimeline.tsx`, `src/client/strings.ts`, `src/client/styles/planning.css`, relevant `tests/client/explicit-cpm.test.tsx`, `tests/client/gantt.test.tsx`.

**Interfaces:** Consumes unmodified `ProjectTree['schedule'].diagnostics` containing `code`, `taskIds`, `dependencyIds`, `messageKey`. Produces client-only `actionableDiagnostics(diagnostics)` to select row errors, and a predicate/helper to suppress absence-only diagnostics in panel. Keep legacy availability/frozen pending explanations in panel. TaskTree already receives schedule in main tree and subtasks, and existing row selection opens details; no new event contract.

- [x] Step 1: Add independent diagnostic fixtures: EXPLICIT_PRECEDENCE_CONFLICT involving A/B; unrelated C; unknown-only D; invalid input E. Assert localized accessible indicators, detailed panel conflict, no global infeasible badge on C, no missing-date warning, partial/global labels unchanged, and full server fixture unchanged. Add help open/Escape/keyboard tests and Gantt-off control absence.

```tsx
const diagnostics = [
  { code: 'EXPLICIT_PRECEDENCE_CONFLICT', taskIds: ['A', 'B'], dependencyIds: ['AB'], messageKey: 'conflict' },
  { code: 'UNKNOWN_INTERVAL', taskIds: ['D'], dependencyIds: [], messageKey: 'unknown' },
];
expect(actionableDiagnostics(diagnostics).map(d => d.code)).toEqual(['EXPLICIT_PRECEDENCE_CONFLICT']);
expect(diagnostics).toHaveLength(2);
```

- [x] Step 2: Run `npx vitest run tests/client/schedule-diagnostics.test.tsx tests/client/explicit-cpm.test.tsx tests/client/gantt.test.tsx`; record RED.
- [x] Step 3: Remove global ScheduleStatus mount/import from App. Filter UNKNOWN_INTERVAL, UNKNOWN_PRECEDENCE, UNKNOWN_DEPENDENCY, BLOCKED_BY_UNKNOWN and historical missing-origin-only messages from normal panel warnings; retain real errors and migration explanation. Remove `Неполные сроки`. Add localized indicator using explicit actionable allowlist from spec, text title plus accessible name; keep row height stable and existing row selection/keyboard. Do not show general infeasible on a task without actionable diagnostics. Preserve ready/incomplete/pending analysis text in panel and legacy component tests where relevant.

```ts
const actionableCodes = new Set([
  'EXPLICIT_PRECEDENCE_CONFLICT', 'INVALID_INTERVAL', 'DURATION_MISMATCH',
  'INVALID_PRECEDENCE_BOUNDARY', 'INVALID_DURATION', 'NON_WORKING_DATE',
  'CALENDAR_RANGE_EXCEEDED',
]);
```

- [x] Step 4: Replace permanent `.gantt-hint` paragraph with `?` anchored help overlay in toolbar, using existing gestureHint text; keyboard open/close and return focus. Keep toolbar only in show=true branch; remove obsolete persistent-height CSS. Tighten toolbar spacing without changing shared Gantt/tree heading height independently.
- [x] Step 5: Run covering client tests, typecheck/lint and formatting; report and commit. Task review and integration precede Task 3.

### Task 3: Browser acceptance and regression verification

**Files:** Create `tests/e2e/compact-workspace.spec.ts`; update affected existing E2E assertions only where C20 intentionally changes presentation. No application-code edits unless a found defect is explicitly assigned back to the implementation owner.

**Interfaces:** Consumes Task 1 accessible project menu/dialog and Task 2 local row diagnostics/help. Uses `syntheticRuntime`, `seedOptionalRuntime`, `readTree`, `send` from existing helpers; fixture task names remain synthetic. Produces browser evidence for CW01–CW08 in both configured viewports.

- [ ] Step 1: Seed at least 24 tasks through real API and add independent A/B FS-conflict case; collect mutation request counts and a before tree snapshot. Navigate to application; assert absent global coverage/unknown-date warnings and menu/help/filter view actions produce no writes and identical tree/revision/canUndo.
- [ ] Step 2: Test menu/dialog keyboard/Escape/focus, settings save/discard/failed response plus exact retry, 409 conflict reload with retained settings draft, real Tab/Shift+Tab boundary assertions in the browser, rename and compact undo persisted behavior, Gantt toggle/help, local conflict and unrelated task. Preserve real backend assertions; no browser mocks for successful writes.
- [ ] Step 3: Verify concrete geometry in both viewport projects. Capture synthetic screenshots to temp outside checkout for manual review, reporting exact paths only in scratch report. Verify alignment/order of tree/Gantt after filter/collapse and enough complete visible rows.

```ts
const rows = page.getByRole('tree', { name: 'Задачи', exact: true }).getByRole('treeitem');
const first = await rows.first().boundingBox();
expect(first!.y).toBeLessThanOrEqual(230);
const lastVisible = await rows.nth(9).boundingBox();
const scroll = await page.locator('[data-plan-scroll]').boundingBox();
expect(lastVisible!.y + lastVisible!.height).toBeLessThanOrEqual(scroll!.y + scroll!.height);
```

- [ ] Step 4: Build and run `npx playwright test tests/e2e/compact-workspace.spec.ts` and affected browser suites. Fix stale assumptions with equal-strength behavioral assertions; report failures separately from successful reruns. Format, commit; task review.

## Final integration gates

- [ ] Integrator runs `npm run verify`, `npm run format:check`, complete `npm run test:e2e`, `npm run check:package`, `npm run check:kit`, `npm run test:kit`, `npm run security:workspace` and `git diff --check` on pinned runtime. No skipped tests or --if-present.
- [ ] Review synthetic captures in both viewports and previously approved three PNGs; new external image is not copied.
- [ ] Independent whole-change review using immutable base/head diff; fix assigned findings through agents and scoped re-review.
- [ ] Update `docs/STATUS.md` with exact passed/failed/not-run facts and remaining S4–S6 scope; mark completed plan checkboxes. Run doc/security checks after final documentation edits. Local commits use enabled guards; no push/deploy/release.
