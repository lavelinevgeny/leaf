# Inline Task Addition Implementation Plan

> **For agentic workers:** Execute the authorized scope inline; follow the repository acceptance checks. No parallel writers are needed.

**Goal:** Add inline task creation with local Gantt preview and compact schedule selection.

**Architecture:** Reuse QuickAdd, PlanFields and the pure C18/C19 helpers. TaskTimeline shares a presentation-only draft row between TaskTree and Gantt; App retains title/source/context and existing transactional create/retry/undo.

**Tech Stack:** Existing TypeScript, React, native popover, CSS and Playwright.

**Spec:** [UI C21](../../UI.md), [confirmed decisions](../../DECISIONS.md).

## Global Constraints

- Keep optional source fields and leaf-only FS rules; hierarchy is not precedence.
- Do not persist draft or conditional display dates, or include them in summaries/CPM.
- C15 excludes deadline. C18 governs linked fields; C19 governs placement.
- Use synthetic fixtures and existing dependencies; preserve unrelated changes.

### Task 1: Context actions and shared draft row

Files: `src/client/App.tsx`, `TaskTree.tsx`, `TaskTimeline.tsx`, `Gantt.tsx`, `quick-add-view.ts`; tests: `tests/client/inline-add.test.tsx`.

- [x] Reproduce missing Shift+Enter child action with `fireEvent.keyDown(row, { key: 'Enter', shiftKey: true })` and assert `onAction('child', task)`.
- [x] Add the hover/focus action and retain Insert/Shift+Insert.
- [x] Insert a stable draft row at AddContext; skip it during tree keyboard navigation.
- [x] Calculate draft display through `realInterval` / `conditionalDisplay`; never recalculate the authoritative schedule.
- [x] Verify group/today placement, dated draft appearance, tree immutability and no draft dependencies.

### Task 2: Compact schedule editing

Files: `src/client/QuickAdd.tsx`, `QuickSchedule.tsx`, `PlanFields.tsx`, `styles/planning.css`; tests: existing quick-add tests and `tests/e2e/inline-add.spec.ts`.

- [x] Add the schedule chip and Alt+D, keeping Tab/Shift+Tab inside the title editor.
- [x] Reuse linked fields and validation; add Today/Tomorrow/Until Friday/parent presets and clearable duration.
- [x] Use a native top-layer popover with positioning, Escape and focus return.
- [x] Draw conditional bars with muted fill and dashed outline; render header undo as an accessible icon.
- [x] Verify local-only preview, complete save, cancellation and independent retry drafts.

### Task 3: Validation and handoff

- [x] Run `npm run verify`, `npm run format:check`, `npm run check:kit`, `npm run check:package` and `npm run security:workspace`.
- [x] Run relevant Playwright suites at both configured viewport sizes and inspect synthetic captures.
- [x] Update `docs/STATUS.md` with exact passed/failed/not-run facts and the remaining S4–S6 scope.
