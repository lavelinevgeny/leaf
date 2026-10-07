# S3 Planning UI Implementation Plan

> **For agentic workers:** Execute this plan task-by-task with executing-plans in the authorized checkout. Steps use checkbox syntax for tracking. One writer owns shared contracts and scheduling semantics.

**Goal:** Build a working Gantt, atomic task plan editor and visual dependency panel.

**Architecture:** React/SVG renders one visible-tree and authoritative server schedule. Existing command/revision/idempotency/undo transactions handle all writes. Pure calendar presentation helpers produce explicit planning commands without client CPM.

**Tech Stack:** Existing TypeScript, React/Vite, Fastify, SQLite, Vitest, Playwright; no new dependencies.

**Spec:** [S3 design](../specs/2026-10-07-s3-planning-ui-design.md)

## Global Constraints

- One TypeScript package, one production container; no cloud/CDN/telemetry.
- Leaf-only FS, zero lag, optional dates, no dummy bars; hierarchy is not precedence.
- All authoritative writes and recalculation are server-side transactions.
- Use only the three approved PNGs; excluded subtask collage remains excluded.
- Synthetic fixtures only; no push/deployment/publication.

---

### Task 1: Atomic detail and plan editing

**Files:** `src/shared/contracts.ts`, `src/server/repository.ts`, `tests/scheduling-repository.test.ts`, `tests/scheduling-api.test.ts`, `docs/adr/005-planning-ui.md`.

**Interfaces:** Add `task.edit { taskId, changes: { title?, description?, status? }, plan?: TaskPlan }`; existing commands remain compatible. Reuse `applyTaskPlan`, `completedInterval`, and transaction validation.

- [x] Write independent SQLite assertions for combined title+duration, one undo, invalid Fixed rollback and done transitions.
  ```ts
  const after = step(before, { type: 'task.edit', taskId: id(before, 'C'), changes: { title: 'C revised' }, plan: { mode: 'auto', durationDays: 9 } });
  expect(after.schedule.projectFinishIndex).toBe(10);
  expect(step(after, { type: 'undo' }).tasks).toEqual(before.tasks);
  ```
- [x] Run the affected repository/API suites and confirm the new command fails before implementation.
- [x] Apply optional plan before entering done; release an existing done lock only when explicitly changing status away from done. Reuse existing transaction, revision and response validation. Reject summary planning and empty edits.
- [x] Run repository/API suites; document command ordering and undo in ADR 005.

### Task 2: Panel and project planning controls

**Files:** `src/client/TaskPanel.tsx`, `src/client/PlanFields.tsx`, `src/client/ProjectPlan.tsx`, `src/client/planning-view.ts`, `src/client/strings.ts`, `src/client/App.tsx`, `tests/client/planning.test.tsx`.

**Interfaces:** Panel `onSave(changes, plan?)` returns server-confirmed success. Project form sends `project.schedule`; pure `planOf(task)`/`planForGesture(task, schedule, project, gesture)` produce TaskPlan.

- [x] Add tests for explicit modes, calculated dates, single-date notes, summary/done locks, dirty preservation and exact retry.
  ```ts
  expect(planOf(task)).toEqual({ mode: 'auto', durationDays: 3, notBefore: null, deadline: null });
  ```
- [x] Confirm failures; implement small planning fields and project form. Keep editable constraints distinct from calculated dates. A single save emits task.edit only when plan changed; existing text-only update remains compatible.
- [x] Show coverage, diagnostic explanations, float/critical state and missing project origin. Run client and API regressions.

### Task 3: Shared tree and Gantt

**Files:** `src/client/TaskTree.tsx`, `src/client/tree-view.ts`, `src/client/TaskTimeline.tsx`, `src/client/Gantt.tsx`, `src/client/gantt-view.ts`, `src/client/styles/planning.css`, `tests/client/gantt.test.tsx`, `tests/client/gantt-view.test.ts`.

**Interfaces:** `TaskTimeline` builds `treeRows(tasks, collapsed)` once and passes the same rows to TaskTree/Gantt. Gantt consumes `ProjectTree.schedule`; gestures send one task.plan through App's existing executor.

- [x] Assert empty tasks have no bars, one date has a marker, summary dates are computed and collapsed rows match on both sides. Test all three scales, month/DST/year boundaries and bounded windows.
  ```ts
  expect(intervalOf(undated, schedule)).toBeNull();
  expect(shiftDate('2026-10-31', 1)).toBe('2026-11-01');
  ```
- [x] Implement bounded calendar SVG grid, today, weekends, normal/summary bars, critical labels and real visible-endpoint FS arrows. Add shared vertical scrolling and independent horizontal scrolling with keyboard-resizable divider.
- [x] Add pointer capture, local preview, cancel and one command at pointerup; keyboard arrows shift/resize via the same intent helper. Preserve done/summary locks and show FS-constrained move feedback.
- [x] Run targeted client tests and real browser gesture checks.

### Task 4: Dependency graph and integrated acceptance

**Files:** `src/client/Dependencies.tsx`, `src/client/TaskPanel.tsx`, `src/client/App.tsx`, `src/client/styles/planning.css`, `tests/client/dependencies.test.tsx`, `tests/e2e/planning-ui.spec.ts`, README/START_HERE/STATUS/IMPLEMENTATION_PLAN.

**Interfaces:** Graph consumes Task/Dependency/ScheduleResult, calls existing create/delete commands, neighbor selection and `showOnGantt(task)`. Reuse domain `validateDependency` for candidate explanations; the server remains authoritative.

- [x] Assert one arrow per actual neighbor edge, no hierarchy arrows, invalid candidates excluded with readable cycle path, delete keeps tasks, neighbor/back and keyboard tab navigation.
- [x] Implement compact vertical cards with critical text, search/direction, create/delete, additional-neighbor controls, navigation and Gantt reveal.
- [x] Add real UI E2E for branching T=8 → T=10 → undo, summary/critical IDs, resize/drag single revision, dependencies, Fixed/Auto/unknown/deadline, error/retry and restart. Capture and inspect synthetic screenshots at both viewports.
- [x] Run `verify`, `format:check`, `test:e2e`, `check:package`, `check:kit`, full `preflight`, `git diff --check`. Update STATUS with exact passed/failed/not-run checks and next S4. Commit scoped S3 changes after staged/history checks; do not push.
