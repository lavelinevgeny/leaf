# S4 Task Search and Status Filters Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Find tasks by title and status while keeping their complete parent context and synchronized tree/Gantt rows.

**Architecture:** A pure client projection selects matching tasks and their ancestors from the complete server snapshot. TaskTimeline builds the flattened rows once and supplies them to TaskTree and Gantt. Filtering retains the original snapshot and server scheduling results.

**Tech Stack:** Existing TypeScript, React, CSS, Vitest, Testing Library and Playwright; no additional dependencies.

**Spec:** [UI](../../UI.md), [A04 acceptance](../../ACCEPTANCE.md), [working default D14](../../DECISIONS.md).

## Global Constraints

- Product name: `leaf`; Russian UI, English identifiers.
- Node 24.21.0, npm 11.19.0; keep the lockfile and security policy unchanged.
- Use only the three PNGs in [design/README](../../../design/README.md); the excluded subtask collage is not a reference.
- Filtering changes only display; dates, hierarchy, dependencies, revisions, operations, undo and CPM remain server authoritative.
- Use synthetic fixtures and external temporary browser outputs; no private runtime data or remote changes.
- Search details below are working defaults, not new confirmed owner decisions.

## Behavior

Search is a trimmed, Unicode-normalized, case-insensitive literal substring of the title. Status options are all/todo/doing/done. Query and status must both match. Retain each match and its full ancestor chain, in existing sibling order and depth; a matching parent does not automatically include nonmatching descendants. Identify parents retained only for context and count direct matches, excluding context rows.

Filtering initially reveals matching paths even when the ordinary tree is collapsed. Collapsing within filtered results is temporary and independent of ordinary collapse state; changing the query/status resets temporary collapse. Clearing filters restores the original collapsed tree. Opening a task preserves filter state and drafts. “Show on Gantt” clears filters before revealing the requested task. Project changes reset filters; validated same-project conflict reloads preserve them.

No matches gets a dedicated message, distinct from an empty project. Search Escape clears its text and retains focus without closing a task panel. Reset clears both controls and focuses search. Filtering remains available with a dirty panel; it never discards the selected task or its draft. During project loading controls are disabled. Offline/conflict feedback remains visible.

## Task 1: Complete search/filter slice

**Files:**

- Create: `src/client/task-filter.ts`, `src/client/TaskFilters.tsx`.
- Modify: `src/client/App.tsx`, `src/client/TaskTimeline.tsx`, `src/client/TaskTree.tsx`, `src/client/Gantt.tsx`, `src/client/strings.ts`, `src/client/styles/app.css`.
- Test: `tests/client/task-filter.test.ts`, `tests/client/task-filters.test.tsx`, `tests/client/gantt.test.tsx`, `tests/e2e/task-filters.spec.ts`.
- Docs: `START_HERE.md`, `docs/UI.md`, `docs/DECISIONS.md`, `docs/IMPLEMENTATION_PLAN.md`, `docs/STATUS.md`.

**Interfaces:**

```ts
type TaskFilter = { query: string; status: Task['status'] | 'all' };
function filterTasks(tasks: readonly Task[], filter: TaskFilter): {
  tasks: readonly Task[];
  matchIds: ReadonlySet<string>;
  active: boolean;
};
```

TaskFilters consumes filter/onChange/disabled props. TaskTimeline accepts an optional filter, projects complete tasks, supplies the same rows to both views, and passes matchIds to TaskTree. Existing TaskTimeline callers without a filter retain their behavior.

- [x] **Step 1: Independent projection tests, then RED.**

Use literal fixtures from `tests/client/fixtures.ts`, without calculating expected rows with production helpers. Cover conjunctive title/status, ancestor retention, original object identity, stable order, matching parent semantics, blank/Unicode/literal queries, no matches and a 5,000-level chain. Example assertion:

```ts
const root = task(1, { title: 'Этап', status: 'done' });
const leaf = task(2, { title: 'Монтаж', parentId: root.id, status: 'doing' });
const result = filterTasks([root, leaf], { query: ' МОНТАЖ ', status: 'doing' });
expect(result.tasks).toEqual([root, leaf]);
expect([...result.matchIds]).toEqual([leaf.id]);
expect(result.tasks[0]).toBe(root);
```

Run `npm exec vitest -- run tests/client/task-filter.test.ts`; expect missing module before implementation.

- [x] **Step 2: Interaction tests, then RED.**

Render App against independent synthetic HTTP snapshots. Assert the literal task IDs in tree and `[data-gantt-row]` agree. Cover hidden matching descendants, independent filtered collapse/restoration, context annotations/counts, query/status intersection, reset/Escape focus, empty/loading/offline states, dirty panel/quick draft retention, project switch and “Show on Gantt”. Assert filtering adds no HTTP calls and does not mutate the input snapshot.

Run `npm exec vitest -- run tests/client/task-filters.test.tsx`; expect missing search controls before implementation.

- [x] **Step 3: Projection and controls, then GREEN.**

Build a Map of original tasks, collect direct match IDs, and walk each parent chain until an already retained ancestor. Filter the original array by retained IDs. Never recursively walk arbitrary depth or mutate tasks. Reuse visibleTree to preserve ordering/depth. Store filtered collapse separately in TaskTimeline, keyed to query/status; keep App's ordinary collapsed set intact. Put compact labeled controls in the header and centralized Russian strings in strings.ts. Mark context rows accessibly and keep summary styling based on the full tree.

The ancestor closure uses original objects and terminates once a shared path has already been retained:

```ts
const byId = new Map(tasks.map((task) => [task.id, task]));
const retained = new Set<string>();
for (const matchId of matchIds) {
  let current: string | null = matchId;
  while (current && !retained.has(current)) {
    retained.add(current);
    current = byId.get(current)?.parentId ?? null;
  }
}
return { tasks: tasks.filter((task) => retained.has(task.id)), matchIds, active };
```

Run both focused test files and `npm run typecheck`.

- [x] **Step 4: Real browser acceptance.**

Use syntheticRuntime and existing readTree/send helpers. Seed nested tasks, explicit dates and dependencies through real API. Search inside a collapsed branch, combine status, navigate with the keyboard, toggle Gantt, clear filters and compare the complete server tree before/after. Assert zero mutation requests and unchanged revision/tasks/dependencies/schedule/canUndo; additionally compare synthetic SQL operation/undo counts. Exercise editing under a filter and undo. Capture both configured viewports outside the checkout and inspect them against approved main layout.

Run `npm run build`, then `npm run test:e2e -- tests/e2e/task-filters.spec.ts`.

- [x] **Step 5: Full verification and factual handoff.**

Run `npm run verify`, `npm run format:check`, `npm run check:package`, `npm run test:e2e` and `npm run preflight` on pinned Node. Review `git diff --check` and the scoped changes. Update STATUS with passed/failed/not-run facts and the next S4 task. No commit, push, deployment or release is required by this slice.

## Execution result — 2026-10-08

Task 1 is complete. Verify: 541/541 tests, typecheck/lint/build PASS. Browser: 50/50 full and 4/4 focused PASS at both configured viewports, without retries/skips. Format/package checks and ordinary root preflight PASS. Six synthetic captures were inspected outside the checkout. No independent review or Docker rerun; no publication or production data access. Full facts and the next S4 task are in [STATUS](../../STATUS.md).
