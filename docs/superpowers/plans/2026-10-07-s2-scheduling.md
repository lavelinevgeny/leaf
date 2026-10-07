# S2 Scheduling Implementation Plan

> **For agentic workers:** Use subagent-driven-development task reviews and an independent final review. Steps use checkbox syntax.

**Goal:** Чистый планировщик и серверные атомарные команды с согласованным расписанием и отменой.

**Architecture:** Calendar и scheduling — чистые domain modules. SQLite хранит исходные параметры и FS edges; существующая Repository пересчитывает результат внутри транзакции и включает его в ProjectTree. UI продолжает работать с деревом; Гант относится к S3.

**Tech Stack:** Existing strict TypeScript, Zod, better-sqlite3, Fastify, Vitest, Playwright. No new dependencies.

**Spec:** [SCHEDULING](../../SCHEDULING.md), [ADR 004](../../adr/004-scheduling-transactions.md), [ACCEPTANCE](../../ACCEPTANCE.md).

## Global Constraints

- Name: leaf. English identifiers, Russian owner communication.
- D04–D12 remain working defaults; no new confirmed product decisions.
- FS, lag 0, same-project leaves; hierarchy is not precedence.
- Unscheduled and unknown do not acquire duration 1 or dummy dates.
- All authoritative writes and recalculation are server-side transactions.
- Preserve existing uncommitted Make/admin/auth changes. No production/private data, push or deployment.
- One writer for schema and shared contracts. Workers use separate disposable worktrees; integrate only reviewed public source changes. Do not bypass linked-worktree privacy guards to commit.

## Task 1: Pure calendar and schedule

**Files:** Create `src/domain/calendar.ts`, `src/domain/scheduling-types.ts`, `src/domain/scheduling.ts`, `tests/scheduling.test.ts`, `tests/calendar.test.ts`.

**Interfaces:**

```ts
type CalendarType = 'weekdays' | 'all-days';
type PlanMode = 'unscheduled' | 'auto' | 'fixed';
interface SchedulingTask {
  id: string; parentId: string | null; status: 'todo' | 'doing' | 'done';
  planMode: PlanMode; durationDays: number | null;
  inputStart: string | null; inputFinish: string | null;
  notBefore: string | null; deadline: string | null;
  completedStart: string | null; completedFinish: string | null;
  completedStartIndex: number | null; completedFinishIndex: number | null;
}
interface SchedulingDependency { id: string; predecessorId: string; successorId: string }
interface ScheduleInput {
  startDate: string | null; calendarType: CalendarType;
  tasks: readonly SchedulingTask[]; dependencies: readonly SchedulingDependency[];
}
// All metric/date fields are nullable, including unscheduled/blocked leaves.
interface ScheduledTask {
  ES: number | null; EF: number | null; LS: number | null; LF: number | null;
  projectFloat: number | null; constraintFloat: number | null;
  startDate: string | null; finishDate: string | null;
  blockedReason: string | null;
}
interface ScheduleSummary {
  start: number | null; finish: number | null;
  startDate: string | null; finishDate: string | null;
  partial: boolean; containsCritical: boolean;
}
interface ScheduleDiagnostic {
  code: string; taskIds: string[]; dependencyIds: string[]; messageKey: string;
}
interface ScheduleResult {
  feasibility: 'feasible' | 'incomplete' | 'infeasible'; originDate: string | null;
  projectFinishIndex: number | null;
  coverage: { knownLeafCount: number; totalLeafCount: number };
  tasks: Record<string, ScheduledTask>; summaries: Record<string, ScheduleSummary>;
  criticalTaskIds: string[]; criticalDependencyIds: string[];
  diagnostics: ScheduleDiagnostic[];
}
// Export each type above, and these functions:
function calculateSchedule(input: ScheduleInput): ScheduleResult;
function nextWorkingDay(date: string, calendarType: CalendarType): string;
function dateToIndex(date: string, originDate: string, calendarType: CalendarType): number;
function indexToDate(index: number, originDate: string, calendarType: CalendarType): string;
function workingDaysInclusive(start: string, finish: string, calendarType: CalendarType): number;
function isWorkingDay(date: string, calendarType: CalendarType): boolean;
```

- [x] Write calendar tests from `calendar-cases.json`, explicit year 0001/9999 limits, same-day, leap/month/year/DST boundaries, negative indexes, round trips and weekend rejection/normalization.
- [x] Write independent scheduling tests from `cpm-cases.json`. Convert fixture fixed indexes to absolute dates with an all-days origin; expected ES/float/critical IDs stay fixture numbers.

```ts
expect(result.projectFinishIndex).toBe(8);
expect(result.criticalTaskIds.toSorted()).toEqual(['A', 'B', 'D']);
expect(result.tasks.C?.projectFloat).toBe(4);
```

- [x] Run targeted tests and confirm missing modules fail, then implement calendar arithmetic without browser timezone or milliseconds-as-days.
- [x] Implement deterministic iterative graph validation/topological passes, separate project/constraint float, unknown blocking, missing origin, deadlines, done locks, fixed conflicts, iterative summary aggregation. Cycles return infeasible diagnostics with involved task/edge IDs; server rejects them.
- [x] Add independent generated DAG assertions (FS and duration), immutability, input permutation, deep hierarchy, equal paths, release gap non-tight critical edge, fixed predecessor chains, incomplete summaries and completed locks.
- [x] Run targeted tests, typecheck/lint for these files and format; review task 1 diff before integration.

## Task 2: Transactional scheduling API

**Files:** Modify `src/shared/contracts.ts`, `src/server/database.ts`, `src/server/repository.ts`, `src/server/app.ts`, `.dockerignore`, `scripts/package-check.mjs`, package scripts; create `migrations/002-scheduling.sql`, `src/domain/planning.ts`, `tests/scheduling-repository.test.ts`, `tests/scheduling-api.test.ts`, `tests/migration.test.ts`; update independent legacy task/tree fixtures for added fields.

**Interfaces:** Consume task 1 types and `calculateSchedule`. Task DTO extends SchedulingTask. Project adds `startDate`, `calendarType`, `timezone` (default UTC, not an inferred owner timezone). Dependency DTO adds `projectId` to SchedulingDependency. ProjectTree adds `dependencies` and `schedule` with required schema-validated fields.

```ts
// New discriminated commands; each sits in the existing envelope.
type SchedulingCommand =
  | { type: 'project.schedule'; changes: { startDate?: string | null; calendarType?: CalendarType; timezone?: string } }
  | { type: 'task.plan'; taskId: string; plan:
      | { mode: 'unscheduled'; inputStart?: string | null; inputFinish?: string | null; deadline?: string | null }
      | { mode: 'auto'; durationDays: number; notBefore?: string | null; deadline?: string | null }
      | { mode: 'fixed'; inputStart: string; inputFinish: string; deadline?: string | null } }
  | { type: 'dependency.create'; predecessorId: string; successorId: string }
  | { type: 'dependency.delete'; dependencyId: string };
// GET /api/projects/:id/schedule response:
// { projectId: string, revision: number, schedule: ScheduleResult }
```

- [x] Write real SQLite tests: branch A2→B5 plus C3 converging D1, change C to 9, check T 8→10, critical switch, ancestor bounds, one undo restores original data and schedule, reopen preserves it.
- [x] Write graph rejection/rollback tests for cycle, duplicate, self, foreign-project and summary endpoints; cycle error includes the ID chain. Add fixed/unknown/done/calendar/deadline and preserve-work conversion tests.
- [x] Write migration test opening synthetic schema 001 with original IDs/dates/auth rows, apply 002, retain unscheduled dates and check reopen/schema-newer rejection. Old operation/undo format is cleared in migration transaction.
- [x] Run tests to observe missing commands fail; add SQL migration and sequential application of checked migration versions. Extend deny-default Docker allowlist explicitly for 002.
- [x] Extend Zod response/command schemas, shared types and legacy synthetic fixtures. Auto input duration is integer 1..1000000; Fixed duration is derived from its supported date interval. Scheduled arithmetic outside supported calendar bounds produces diagnostics. Calendar strings are validated calendar dates.
- [x] Extend Repository snapshot/save/undo with edges and settings. Apply planning transformations in domain helper. Reject malformed graphs before save, calculate response inside transaction, preserve original operation responses on retry.
- [x] Lock done at last calculated interval; clear locks on explicit return. Reject direct scheduled input-date edits and done planning. Move/create conversion transfers both edge endpoints to preserved work-child; delete removes incident edges.
- [x] Add authenticated schedule endpoint. Test origin, request schema rejection, revision conflict, operation retry after later commands, another session's undo conflict and trigger-forced rollback including settings/edges/operations/snapshots.
- [x] Run unit/integration, typecheck/lint, package check; independently review task 2.

## Task 3: Full verification and handoff

**Files:** Modify `tests/dev.test.ts`, `scripts/dev.mjs`, `vite.config.ts` only for an explicit isolated dev port; update `README.md`, `docs/BOOTSTRAP.md`, `START_HERE.md`, `docs/IMPLEMENTATION_PLAN.md`, `docs/STATUS.md` with verified S2 facts. Extend runtime/browser tests with synthetic scheduling commands.

- [x] Test dev smoke with an allocated disposable frontend port and matching origin instead of the owner's running 5173 service. Preserve default 5173 for ordinary dev.
- [x] Add browser/API smoke: server schedule returned for task edits/undo, actual process restart keeps scheduling source/edges and same result. Existing visible tree and panel scenarios continue to pass.
- [x] Run `npm run verify`, `npm run format:check`, build then `npm run test:e2e`, `npm run check:kit`, `npm run test:kit`, `npm run check:package`, `npm run security:workspace` and preflight with real Gitleaks. Report exact environment mismatch if unavailable; never suppress a suite.
- [x] Review full S2 diff independently for spec and quality; fix important findings and run affected checks again.
- [x] Update status with checks, limitations, touched areas and next S3 task. Preserve prior status entries. No commit/push of the owner's preceding unrelated work.

- [x] Transfer reviewed S2 public sources to the primary checkout only after the running dev server is stopped or confirmed to use synthetic data. Hot reload can apply migration 002; owner runtime has not been accessed.
