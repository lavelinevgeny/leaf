# FS Dependencies Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (- [ ]) syntax for tracking.

**Goal:** Give leaf one simple FS predecessor picker in creation, Details, list and Gantt, with atomic causal date propagation and existing project/parent critical-path recalculation.

**Architecture:** Extend command schemas only; retain Task DTOs, SQLite schema and Dependency IDs. A pure helper runs after final source/edge validation inside the existing immediate Repository transaction and before read-only calculateSchedule. React owns drafts/interaction; confirmed snapshots supply saved edges, canonical dates and critical indicators.

**Tech Stack:** Existing single TypeScript package, React/Vite, Fastify, better-sqlite3, Zod, Vitest and Playwright; no added dependencies.

**Spec:** [FS design](../specs/2026-10-08-fs-dependencies-design.md), especially F01–F16/§6.1; [ADR 011](../../adr/011-fs-command-cascade.md). Each task implementer reads both.

## Global Constraints

- “Только существующая FS, лаг 0, конечные работы одного проекта.” Hierarchy/row order never create precedence; no new status-completion restriction.
- “Пустые даты остаются пустыми.” Conditional display, duration, parent dates and today do not materialize source dates in cascade.
- “Удаление связи не подтягивает даты раньше. Done не переносится автоматически. Прямой конфликт явно редактируемых сроков отклоняется атомарно.”
- “Новые типы зависимостей, lag, режимы планирования, persisted anchors, таблицы, библиотеки и жест соединения полос не нужны.”
- “GET, чистый анализ, undo, cached exact outcome, frozen replay, title/status-only, перестановка строк и удаление связей не вызывают ремонт сроков.” Calendar edit also keeps current analysis without cascade.
- C16 formulas, C17 private provenance and exact frozen outcomes stay intact. Do not put cascade in calculateSchedule or add parent CPM.
- Keep C19 conditional display and clearable creation duration 1. Inspect only three PNGs from [design/README](../../../design/README.md); compact panel and existing vertical neighbor graph remain.
- Synthetic disposable data only; follow [PRIVACY](../../PRIVACY.md). Never read private runtime files or print cookies, credentials, full HTTP bodies, environment dumps or scanner values.
- package.json pins Node >=24.21.0 <25 and npm 11.19.0. Use nvm use and existing [BOOTSTRAP](../../BOOTSTRAP.md) setup; no personal paths in docs.
- Register meaningful suites in current package scripts; no --if-present, empty/skipped suites, dependency/lockfile changes.
- Owner authorized separate agents and review cycles. Implementation tasks execute sequentially using subagent-driven-development, one writer per worktree; implementers do not spawn helpers/reviewers themselves. No extra owner confirmation, push, deployment or publication.
- No implementation commit before plan review passes. For each task: tests/self-review, local candidate commit, independent review/fix loop before next task/integration. Preserve unrelated changes/index entries.

## File map and dependencies

| Files | Responsibility |
| --- | --- |
| src/domain/fs-cascade.ts; tests/fs-cascade.test.ts (new) | Pure causal propagation and independent source/date vectors. |
| src/shared/contracts.ts; src/server/repository.ts | Command-only predecessor arrays, final edges and transaction seam. |
| tests/fs-cascade-repository.test.ts (new); tests/optional-api.test.ts; package.json | SQLite/HTTP atomicity, replay/provenance/CPM and suite coverage. |
| tests/scheduling-api.test.ts; tests/scheduling-repository.test.ts; tests/explicit-cpm-repository.test.ts | Superseded live command outcomes; independent historical diagnostic coverage. |
| src/client/predecessor-view.ts; src/client/PredecessorPicker.tsx (new) | Pure candidates/paths/IDs and API-free picker. |
| src/client/quick-add-view.ts; QuickAdd.tsx; TaskPanel.tsx; App.tsx | Complete drafts, command envelope/retry and canonical baseline. |
| src/client/TaskTree.tsx; TaskTimeline.tsx; Gantt.tsx; Dependencies.tsx | List/Gantt entry points, host callbacks and confirmed graph. |
| src/client/strings.ts; styles/app.css; styles/planning.css | Russian copy, compact layout, visible focus/touch actions. |
| tests/client/predecessor-view.test.ts; predecessor-picker.test.tsx (new), existing client suites | Candidate, keyboard, draft and command behavior. |
| tests/e2e/fs-dependencies.spec.ts (new), explicit-cpm.spec.ts, optional-scheduling.spec.ts | Composed real-server proof; update superseded live expectations, retain historical/frozen controls. |
| docs/DECISIONS.md; SCHEDULING.md; UI.md; ACCEPTANCE.md; STATUS.md; START_HERE.md | C24 scope versus D17 defaults, normative behavior and facts. |

Task 1 produces tested wire/domain contracts. Task 2 consumes those and produces working UI/accessibility contracts. Task 3 tests the composed app and finishes documentation. Each task owns one independent runnable test cycle.

---

### Task 1: Command-only predecessors and causal atomic cascade

**Files:** Create src/domain/fs-cascade.ts, tests/fs-cascade.test.ts, tests/fs-cascade-repository.test.ts. Modify src/shared/contracts.ts (optionalEditSchema/task.create), src/server/repository.ts (applyCommand/apply seam), tests/optional-api.test.ts, package.json. Update superseded live command cases in tests/scheduling-api.test.ts, tests/scheduling-repository.test.ts, tests/explicit-cpm-repository.test.ts, tests/e2e/explicit-cpm.spec.ts and tests/e2e/optional-scheduling.spec.ts. Read calendar.ts, planning.ts, scheduling-types.ts, scheduling.ts, explicit-cpm.ts, optional-snapshot.ts and tests/helpers/explicit-cpm-fixtures.ts.

**Interfaces:**

- Consumes OptionalInput/OptionalTask/SchedulingDependency; existing validateSourceInput, realInterval, validateDependency/validateDependencies, DomainError and applyPrivateSourcePatch. Repository public applyCommand/getTree/getSchedule and calculateSchedule APIs remain unchanged.
- Produces exactly this pure contract and additive inferred Command fields; no Task/SQLite field or new public Repository method:

~~~ts
import type { OptionalInput, OptionalTask } from './scheduling-types.js';
export interface FsCascadeIntent {
  changedSourceTaskIds: readonly string[];
  addedDependencyIds: readonly string[];
  explicitlyEditedTaskId: string | null;
}
export interface FsCascadeResult {
  tasks: OptionalTask[];
  changedTaskIds: string[];
}
export function cascadeFs(
  before: OptionalInput,
  candidate: OptionalInput,
  intent: FsCascadeIntent,
): FsCascadeResult;
// Extract<Command, {type:'task.create'}> adds predecessorIds?: string[].
// Extract<Command, {type:'task.edit'}>['changes'] adds predecessorIds?: string[].
~~~

- Result contains candidate copies and sorted IDs for source fields actually changed by cascade. Repository merges only source fields into full Task objects, updating timestamps only for those changed records.
- Intent uses real before/after source value differences; explicitlyEditedTaskId is task.edit.taskId only for an actual source change. Equal private acknowledgement keeps existing behavior but does not initiate historical repair. New create is not a direct existing source edit.

- [ ] **Step 1: Add failing command-schema tests, then extend only command schemas.**

Append to optional-api.test.ts, importing commandV2Schema/taskV2Schema:

~~~ts
it('accepts command-only relations, rejecting duplicate IDs and DTO leakage', () => {
  const a = '22222222-2222-4222-8222-222222222222';
  const b = '22222222-2222-4222-8222-222222222223';
  expect(commandV2Schema.safeParse({
    type: 'task.create', title: 'B', parentId: null, predecessorIds: [a],
  }).success).toBe(true);
  expect(commandV2Schema.safeParse({
    type: 'task.edit', taskId: b, changes: { predecessorIds: [] },
  }).success).toBe(true);
  expect(commandV2Schema.safeParse({
    type: 'task.edit', taskId: b, changes: { predecessorIds: [a, a] },
  }).success).toBe(false);
  expect(taskV2Schema.shape).not.toHaveProperty('predecessorIds');
});
~~~

Run npm exec vitest run tests/optional-api.test.ts -t "command-only relations": FAIL on current strict schemas. Define z.array(uuidSchema).refine(ids => new Set(ids).size === ids.length, 'Duplicate predecessors') and add its optional field to create/edit.changes. Keep nonempty-changes refinement; malformed UUID/empty edit also reject. Rerun: PASS. Leave source/Task/snapshot/legacy schemas unchanged.

- [ ] **Step 2: Add failing pure chain and causal-barrier tests.**

Create fs-cascade.test.ts using existing leaf/edge constructors, with expected sources independent of implementation:

~~~ts
import { expect, it } from 'vitest';
import { cascadeFs } from '../src/domain/fs-cascade.js';
import { leaf, edge } from './helpers/explicit-cpm-fixtures.js';
it('F01 moves tight chain without mutating inputs or filling duration', () => {
  const before = {
    calendarType: 'all-days' as const,
    tasks: [
      leaf('A', '2026-10-05', '2026-10-06'),
      leaf('B', '2026-10-07', '2026-10-09'),
      leaf('C', '2026-10-10', '2026-10-11'),
    ],
    dependencies: [edge('AB','A','B'), edge('BC','B','C')],
  };
  const untouched = structuredClone(before);
  const candidate = {...before, tasks: [
    leaf('A','2026-10-07','2026-10-08'),
    before.tasks[1]!, before.tasks[2]!,
  ]};
  const result = cascadeFs(before, candidate, {
    changedSourceTaskIds: ['A'], addedDependencyIds: [],
    explicitlyEditedTaskId: 'A',
  });
  expect(result.tasks).toEqual([
    leaf('A','2026-10-07','2026-10-08'),
    leaf('B','2026-10-09','2026-10-11'),
    leaf('C','2026-10-12','2026-10-13'),
  ]);
  expect(result.changedTaskIds).toEqual(['B','C']);
  expect(before).toEqual(untouched);
  expect(candidate.tasks[1]!.inputStart).toBe('2026-10-07');
});
~~~

Add F14 todo/done B: historical A Oct05–07→B Oct07–08, edit A Oct06–07 with duration null => no B change/no done error. Run npm exec vitest run tests/fs-cascade.test.ts: FAIL before helper exists.

- [ ] **Step 3: Implement pure boundary primitives and causal topological walk.**

Use fixed civil origin 0001-01-01, existing dateToIndex/indexToDate/isWorkingDay/workingDaysInclusive/realInterval; no Date/clock/network/SQLite. Final DAG validation precedes helper. Candidate is copied, fan-in processed once in topological order. Private helper finishBoundary(task, calendar, unavailable) returns valid working finish index +1, including finish-only, or null for unavailable/nonworking/invalid full pair. sourceStart returns valid working index or null.

Direct actual source edits first validate their resulting start against final incoming bounds and reject EXPLICIT_PRECEDENCE_CONFLICT instead of moving the chosen date. Activate successors only for changed authoritative finish (including known/unknown); added edge activates its successor. Downstream continues only if cascade actually changes authoritative finish. Reachability is not activation. Use this controlling guard before push/pull/done checks:

~~~ts
if (!addedIncoming && newBound === oldBound) continue;
if (currentStart === null || newBound === null) continue;
const needsLatePush = newBound > currentStart;
const mayPullEarlier =
  currentStart > newBound &&
  oldStart === oldBound &&
  endpointsUnchanged && allOldAndNewFinishesKnown &&
  intent.explicitlyEditedTaskId !== task.id;
if (!needsLatePush && !mayPullEarlier) continue;
~~~

newBound/oldBound are max known incoming finishes; unknown predecessor permits late bound but forbids early pull. endpointsUnchanged compares endpoint sets, not edge IDs. Full valid pair moves preserving working span and exact nullable duration; start-only changes start only; finish-only/duration-only/empty stay intact. Removal/replacement does not itself authorize early pull.

Required late push through done => DONE_PLAN_LOCKED; optional early pull leaves done unchanged. Invalid/unavailable source never normalizes or loses marker. On affected edges compare old/new raw conflict distances solely for unavailable diagnostic checks: new/increased provable conflict requiring protected modification rejects; unchanged/unrelated old conflict remains. Raw unavailable finish is never a trusted bound. Calendar range overflow => CALENDAR_RANGE_EXCEEDED; pure errors identify task/chain IDs. At Repository command boundary translate those IDs using before/candidate Task titles before rethrowing DomainError; existing HTTP handler returns its safe message. Do not add titles to logs or infer an existing title-substitution helper.

- [ ] **Step 4: Complete independent literal vectors and rerun pure suites.**

Implement every F01–F16 directly from spec §6. Expected dates/indices/floats are literal, not calls to calendar/helper under test. Include sequential F03, F04 fan-in/max, F05 diamond, F06 both calendars/duration=null, F07 partial start, F08 empty creation, F09 unknown barrier, F10 direct rejection/relation-only push, F11 done, F12 deletion, F13 overflow, F14 unchanged finish, F15 unchanged max with done variants, F16 gap stops downstream historical repair.

Additional independent cases: start-only movement cannot activate downstream; finish-only successor stays null-start; lone weekend date not normalized; duration mismatch rejects necessary repair; unavailable raw valid pair never supplies bound, marker intact; new/worsened raw conflict rejects, unrelated old conflict survives. Freeze inputs to catch mutation.

Run npm exec vitest run tests/fs-cascade.test.ts tests/explicit-cpm.test.ts tests/optional-scheduling.test.ts: PASS; pure historical infeasible expectations unchanged.

- [ ] **Step 5: Write failing SQLite/HTTP command tests, then integrate final edges and helper.**

Use disposable mkdtemp/openDatabase/Repository/step/afterEach from explicit-cpm-repository.test.ts. Seed actual commands; raw insertion only for synthetic historical conflict/private marker fixtures. Assert create with predecessors is one task/edge/revision/undo; relation-only [A] on all-days A Oct05–07/B Oct07–08 returns B Oct08–09/null duration. Replacement omission keeps incoming, [] deletes without pull, [A,X] retains A edge ID; outgoing unchanged.

Use rawSyntheticCountsAndRevision plus ordered complete synthetic task/edge/provenance/undo/operation rows to prove rollback for self/duplicate/foreign/summary/cycle/done/direct conflict/overflow. preserveWork first converts own work/edges/marker; selecting converted parent summary rejects entire command without redirection. Exact envelope retry returns stored response before revision check with helper/CPM spy zero calls; altered envelope => OPERATION_REUSED, stale new envelope => REVISION_CONFLICT. GET/undo/calendar/title/status/move/removal/equal-values/frozen replay do not invoke repair.

Inside task.edit separate predecessorIds before scalar Object.assign; retain applyPrivateSourcePatch/source/done/reopen semantics. Use one private replacement helper after final conversion/insertion:

~~~ts
private replacePredecessors(
  snapshot: Snapshot, successorId: string, predecessorIds: readonly string[],
): void;
~~~

Reject duplicate IDs; remove only old incoming edges, validate proposed final incoming set one endpoint at a time with validateDependency, reuse old edge for same endpoint, randomUUID for new edge. task.create invokes after convert/task insert; edit omitted field does nothing. Existing dependency.create/delete remain.

At applyCommand change callback clone private before, apply scalar/conversion/edge patch, validate final dependencies, derive intent, then invoke pure helper for relevant create/edit/dependency.create only. Skip unchanged source/no-added-edge edit. Map private snapshots explicitly to OptionalInput with unavailable IDs; merge changed source fields/timestamp only. Existing immediate mutate transaction retains cached/undo/rename paths and calculate/save/outcome. A helper error rolls back everything, including undo/operation/revision.

Extend optional-api.test.ts actual app.inject create/replacement with version 2 headers: status 200 canonical fields/one edge/no DTO leakage; malformed duplicate => 400; genuine domain errors safe titles and unchanged rows. Run npm exec vitest run tests/fs-cascade-repository.test.ts tests/optional-api.test.ts: FAIL before seam integration, PASS after.

- [ ] **Step 6: Verify parent CPM, historical barriers, replay and suite coverage.**

Seed common R/P/Q, A Oct05–06→B Oct07–09 and C Oct05–07→D Oct08–09 in all-days. Before H=5, all leaves/edges critical, P/Q Oct05–09 true. Edit A Oct07–08 => B Oct09–11, H=7; projectFloat A/B/C/D=0/0/2/2, constraintFloat=0/0/0/2; only A/B/AB critical; P Oct07–11 true, Q Oct05–09 false, R Oct05–11 true. One undo restores exact tasks/nulls/edge IDs/provenance/schedule; restart retains; exact old envelope replay remains cached.

Repository F14–F16 synthetic infeasible snapshots must succeed without B/C movement, including done variants. Assert unshifted timestamps unchanged and moved timestamps equal injected now. Update only superseded live predecessor-delay/relation-add expectations; pure C16/frozen/legacy bytes remain unchanged.

In scheduling-api.test.ts, the live predecessor finish delay Oct06→Oct07 with B Oct07–09 now asserts B Oct08–10 and appropriate incomplete/ready analysis, rather than retained infeasible. In scheduling-repository.test.ts, newly added unavailable A→B with a provable raw conflict asserts atomic rejection and unchanged rows; preserve its historical diagnostic/stale-undo coverage by seeding the existing conflicting edge/source snapshot synthetically, without a live add. Run both named suites with the new Repository suite before full integration checks.

Add fs-cascade.test.ts to test:unit and fs-cascade-repository.test.ts to test:integration. Run typecheck, lint, test:unit, test:integration, build, format:check. Self-review against spec §§2–4/§6. Stage scoped paths, security:staged, local candidate commit “feat: cascade FS successors in atomic commands”; independent review/fixes before Task 2.

---

### Task 2: Shared picker, four entry points and complete drafts

**Files:** Create src/client/predecessor-view.ts, PredecessorPicker.tsx and tests/client/predecessor-view.test.ts, predecessor-picker.test.tsx. Modify quick-add-view.ts, QuickAdd.tsx, TaskPanel.tsx, App.tsx, TaskTree.tsx, TaskTimeline.tsx, Gantt.tsx, Dependencies.tsx, ControlIcon.tsx, strings.ts, styles/app.css/planning.css. Test existing quick-add.test.tsx, inline-add.test.tsx, planning.test.tsx, App.test.tsx, gantt.test.tsx, dependencies.test.tsx. Read spec §5, approved PNGs, UI.md, QuickSchedule.tsx/api.ts/current navigation guards.

**Interfaces:**

- Consumes Task 1's additive command fields and unchanged api.command(projectId, envelope): Promise<ProjectTree>. No client cascade.
- Produces these shared pure helpers and controlled selector:

~~~ts
// predecessor-view.ts
export interface PredecessorCandidate {
  task: Task; path: string; incomplete: boolean;
}
export function canonicalPredecessorIds(ids: readonly string[]): string[];
export function incomingPredecessorIds(tree: ProjectTree, taskId: string): string[];
export function predecessorCandidates(
  tree: ProjectTree, successorId: string | null,
  selectedIds: readonly string[], query: string,
): PredecessorCandidate[];
// successorId=null is not-yet-created QuickAdd.
// PredecessorPicker.tsx: no API/Command calls
export interface PredecessorPickerProps {
  tree: ProjectTree | null;
  successorId: string | null;
  selectedIds: readonly string[];
  disabled: boolean;
  error?: string;
  onAdd: (id: string) => void;
  onRemove: (id: string) => void;
  onClose: () => void;
}
export function PredecessorPicker(props: PredecessorPickerProps): ReactNode;
// quick-add-view.ts; export and remove local App duplicate
export interface QuickDraft {
  title: string; plan: SourceFields; predecessorIds: string[]; context: AddContext;
}
export function sameQuickDraft(left: QuickDraft, right: QuickDraft): boolean;
export function hasQuickDraft(draft: QuickDraft): boolean;
~~~

- QuickAdd adds tree: ProjectTree, predecessorIds: string[], onPredecessors(ids: string[]): void; onCreate(title, context, plan, predecessorIds): Promise<boolean>. Existing scheduling/indent/context props remain.
- TaskPanel.onSave(changes: Extract<Command,{type:'task.edit'}>['changes']): Promise<ProjectTree|null> replaces save-only boolean result. App adapts existing mutation flow to return the actual acknowledged snapshot to this callback; immediate relation callbacks retain Promise<boolean>. Never reconstruct canonical response from stale render/local plan.
- TaskTree/TaskTimeline/Gantt optional onPredecessors(task: Task, trigger: HTMLElement): void threads entry action only; do not expand TreeAction or couple tree to API.
- App command Mutation adds sentQuickDraft?: QuickDraft copied before send and retained through exact retry; quickKey remains project or project/task key. createTask(title, context, plan, predecessorIds, quickKey?): Promise<boolean>.
- App owns one immediate host {taskId,projectId,trigger}; picker saved IDs derive confirmed tree. Draft wrappers change local IDs only; immediate wrapper emits one dependency.create/delete per action, no optimistic selection/batch mode.

- [ ] **Step 1: Write failing candidates/full-draft tests, then pure helpers.**

Use optionalTreeFixture/task fixtures. Two “Работа” leaves under P/Q produce explicit paths P/Q in current tree order even when main projection is collapsed/filtered. Remove self/summary/foreign/cycle/chosen; existing successor candidate validation uses proposed selected incoming endpoints, not obsolete stored incoming. QuickAdd null endpoint filters real leaves; server remains authoritative after preserveWork.

~~~ts
const draft: QuickDraft = {
  title: 'B', context: {parentId:null},
  plan: {inputStart:null,inputFinish:null,durationDays:1},
  predecessorIds:['A','X'],
};
expect(sameQuickDraft(draft,{...draft,predecessorIds:['X','A']})).toBe(true);
expect(sameQuickDraft(draft,{...draft,predecessorIds:['A']})).toBe(false);
expect(sameQuickDraft(draft,{...draft,context:{parentId:'P'}})).toBe(false);
expect(sameQuickDraft(draft,{
  ...draft,plan:{...draft.plan,durationDays:null},
})).toBe(false);
expect(hasQuickDraft({...draft,title:'',predecessorIds:['A']})).toBe(true);
~~~

sameQuickDraft compares exact title, all source fields, canonical ID set and parentId/afterId context. canonicalPredecessorIds sorts unique UI IDs only; server duplicate rejection remains. Run npm exec vitest run tests/client/predecessor-view.test.ts: FAIL then PASS.

- [ ] **Step 2: Write keyboard/state picker tests, then implement compact selector.**

Use jsdom/userEvent: render picker inside enclosing Escape callback; search gets focus, type A/ArrowDown/Enter invokes onAdd(A) once, Esc invokes onClose once and enclosing callback zero. Tab is ordinary; selected chips have removal buttons. Assert tree=null loading, empty project no other leaves, populated query no results, error role=alert and disabled mutation. Test duplicate-title paths and incomplete hint.

Implement dialog “После окончания”, searchbox “Поиск предшественника”, listbox/options, ArrowUp/Down/Enter, removable chips “Убрать предшественника: <title>”. Esc preventDefault/stopPropagation. Unknown draft IDs show “Задача удалена” rather than silently vanish. Hint for incomplete leaf: “Связь сохранится; перенос использует только заданные даты”. Add strings/CSS focus ring/bounded result list fitting compact sidebar. No API imports.

Run npm exec vitest run tests/client/predecessor-picker.test.tsx tests/client/predecessor-view.test.ts: FAIL before component, PASS after.

- [ ] **Step 3: Connect both QuickAdd inputs and complete exact-retry matching.**

Chain trigger “После окончания новой задачи” sits beside existing schedule chip; Alt+L on title opens picker, inner Enter/Esc cannot submit/cancel form. Selection/clear/cancel and dirty indicator include IDs. Preserve QuickAdd Tab/Shift+Tab indent; picker Tab ordinary. Update create callback tests with [] fourth argument, selected A submission, rejected create keeps IDs, successful create focuses correct title.

Initialize/preserve IDs across all App project/subtask draft keys and apply/reload/branch navigation. hasQuickDrafts, discard, beforeunload/logout guards include relations alone. Capture complete submitted draft copy in pending job and clear only matching key/full draft after success:

~~~ts
updateQuick(job.quickKey ?? job.projectId, (draft) => {
  if (!job.sentQuickDraft || !sameQuickDraft(draft, job.sentQuickDraft))
    return draft;
  return {title:'',plan:newTaskPlan(),predecessorIds:[],
    context:created
      ? {parentId:created.parentId,afterId:created.id} : draft.context};
});
~~~

Canonical ID order matches; same title with changed source/IDs/context does not clear, including context. Exact retry retains original envelope/operationId/sent draft; rejection/stale/uncertain never clears. Main/subtask drafts stay separate. Deferred App tests prove changed same-title draft survives late ack and other key untouched; do not weaken application busy controls to expose race.

Post-ack focus/reset observes App.execute/pending operation completion, including the global exact-retry button after the original submit callback has ended; verify main and subtask QuickAdd retries separately.

Run npm exec vitest run tests/client/quick-add.test.tsx tests/client/inline-add.test.tsx tests/client/App.test.tsx: PASS.

- [ ] **Step 4: Make Details one dirty command and canonical baseline.**

Initialize incoming/baselineIncoming IDs from confirmed tree, canonical compare as part of dirty; field below PlanFields for leaf, summary explanatory hint. Save combines replacement IDs only when changed with existing details/source patch/canAdopt acknowledgement. onSave returns actual confirmed snapshot/null; rejection/stale/uncertain keeps all draft values.

Capture complete submitted draft before await. After ack baseline details/source/incoming come from confirmed Task/edges, including necessary relation-only push; use current-draft ref or equivalent to prevent stale closure falsely resetting newer edits. Replace local values/show saved only if current full draft still matches submitted. Dirty post-submit edits remain dirty against new baseline. Clean idle reload syncs; dirty reload does not overwrite. Cancel/discard restores all fields/IDs.

The same canonical-baseline reconciliation must run after global exact retry through App.execute, even when the original onSave await already returned failure; test global retry as well as panel Save retry, without overwriting newer dirty edits.

planning.test.tsx literal case A weekdays finish Oct09/B Oct08–09/null duration; relation-only Save callback returns B Oct12–13 and AB. Assert displayed canonical dates, A chip, clean/saved state and disabled unchanged Save. Deferred-save newer draft remains dirty/no false “Сохранено”. Graph/list/Gantt immediate commands remain blocked by dirty Details.

Run npm exec vitest run tests/client/planning.test.tsx tests/client/dependencies.test.tsx tests/client/App.test.tsx: PASS.

- [ ] **Step 5: Add immediate list/Gantt entry points and restore focus.**

Leaf row semantic chain action is keyboard/touch accessible, hover/focus visible; Alt+L opens host without panel. Summary gets “Выберите конечную работу”. Gantt action is sibling of bar button, including conditional leaf; summary/draft preview excluded. No drag/connect mode or nested button:

Gantt is SVG: render the HTML chain button in a sibling foreignObject (or HTML overlay), and use its actual HTML ref for Alt+L from the SVGGElement bar. No bare HTML button directly in SVG or unsafe as HTMLElement cast; test browser focus/visibility of that same trigger.

~~~tsx
<button type="button" aria-label={'После окончания: '+task.title}
  disabled={disabled}
  onPointerDown={event=>event.stopPropagation()}
  onClick={event=>{
    event.preventDefault(); event.stopPropagation();
    onPredecessors?.(task,event.currentTarget);
  }}
  onKeyDown={event=>{
    if (['Enter',' ','Escape'].includes(event.key)) event.stopPropagation();
  }}>
  <ControlIcon name="chain" />
</button>
~~~

Extend ControlIcon.tsx IconName union with 'chain' and paths with chain: 'M10 13a5 5 0 0 0 7 0l3-3a5 5 0 0 0-7-7l-2 2M14 11a5 5 0 0 0-7 0l-3 3a5 5 0 0 0 7 7l2-2'; no package. Stop relevant key/pointer/click bubbling to drag/selection. Thread callback through TaskTimeline. Host opens through existing canNavigate/clean/current-project guards; full tree candidates ignore filters. One add/delete sends existing edge command, confirmed IDs only, busy/pending/conflict blocks repeat. Success closes/focuses trigger after unlocked render; missing trigger => row then correct quick input. Error keeps picker query/confirmed selection; uncertain replay uses existing pending operation.

Observe successful ack in App.execute/pending completion to close/focus the immediate host after global exact retry; do not put this solely in the already-finished original onAdd/onRemove callback. Test lost-response retry for both list and Gantt hosts.

Keep Dependencies neighbor graph and existing outgoing actions behind dirty guards, with critical arrows from server. Add tests for no panel/selection/move/resize on action, conditional leaf, Alt+L/Esc/focus fallback, hidden candidates, ack-only selection, blocked dirty Details and safe rejection.

Run npm exec vitest run tests/client/gantt.test.tsx tests/client/dependencies.test.tsx tests/client/App.test.tsx tests/client/predecessor-picker.test.tsx: PASS.

- [ ] **Step 6: Check/self-review/local candidate and task review.**

Run typecheck, lint, test:unit, test:integration, build, format:check. New client suites are covered by existing tests/client script directory. Review spec §5/contracts/approved layout; scope stage, security:staged, local candidate “feat: add shared FS predecessor controls and drafts”; independent review/fix loop before Task 3.

---

### Task 3: Actual-server browser acceptance and normative handoff

**Files:** Create tests/e2e/fs-dependencies.spec.ts; update superseded live expectations in tests/e2e/explicit-cpm.spec.ts and tests/e2e/optional-scheduling.spec.ts. Modify DECISIONS/SCHEDULING/UI/ACCEPTANCE/STATUS/START_HERE. Read scripts/e2e-server.ts, tests/helpers/optional-e2e.ts, playwright.config.ts, AGENT_WORKFLOW/ARCHITECTURE/PRIVACY.

**Interfaces:** Consume Task 1 commands/ProjectTree and Task 2 accessible names/confirmed UI. Existing syntheticRuntime returns origin/databasePath/password/restart/close; readTree(page, origin, projectId): Promise<ProjectTree>, send(page, origin, tree, command): Promise<ProjectTree> seed real HTTP. Existing Playwright runs 1440x900 and 1280x800 and discovers new suite; no config/new script/real runtime access.

- [ ] **Step 1: Add real-server fixture and nullable quick-create acceptance.**

Use base.extend runtime from explicit-cpm.spec.ts with try/finally close. Login through UI without printing password; POST synthetic project/seed predecessor through real HTTP; reload/select project. Quick title B/Alt+L/search A/Enter/Esc/create. Assert title focus and readTree B null/null/1 plus AB edge in one revision. This is browser test before browser-specific fixes, not mocked success.

~~~ts
await page.getByLabel('Новая задача',{exact:true}).fill('B');
await page.getByLabel('Новая задача',{exact:true}).press('Alt+l');
const picker=page.getByRole('dialog',{name:'После окончания'});
await expect(picker.getByRole('searchbox')).toBeFocused();
await picker.getByRole('searchbox').fill('A');
await picker.getByRole('searchbox').press('Enter');
await picker.getByRole('searchbox').press('Escape');
await page.getByRole('button',{name:'Добавить задачу',exact:true}).click();
const current=await readTree(page,runtime.origin,projectId);
const b=current.tasks.find(t=>t.title==='B')!;
expect(b).toMatchObject({inputStart:null,inputFinish:null,durationDays:1});
expect(current.dependencies).toContainEqual(
  expect.objectContaining({predecessorId:a,successorId:b.id}),
);
~~~

Run npm run build then npm run test:e2e -- tests/e2e/fs-dependencies.spec.ts: PASS in both configured projects; traces/screenshots/video remain off.

- [ ] **Step 2: Add all entry points, focus, genuine failures and retry.**

Separate real UI tests: subtask QuickAdd child/edge/null dates one revision with main draft retained and quick-subtask focus; Details A finish Oct09/B Oct08–09 relation-only Save => canonical Oct12–13/clean state and undo; source conflicting edit rejects with draft/edge/revision unchanged; list add/remove each one existing edge command without panel; conditional Gantt action preserves null source and never drags/resizes/selects; no summary/draft endpoint. Candidates with duplicate titles under collapsed/filtered P/Q retain paths and selected correct hidden ID. Esc only closes nested picker; dirty Details blocks immediate graph/list/Gantt; empty/search/no-ack states accessible, sibling buttons and stable row geometry at both viewports.

For uncertain response route.fetch lets real server apply first command, then route.abort drops that response once; next retries continue to server. Capture envelope in memory only and assert exact operationId/body retry, one task/edge/revision, blocked draft until ack and focus/canonical baseline after retry. Stale genuine 409: mutate through send after draft preparation, submit old revision, reload conflict preserves dirty draft and IDs, corrected resubmit works. Cycle/done/source errors are real server responses, never route.fulfill fake success. Task 2 deferred tests own otherwise unreachable late-edit race; do not weaken busy UI.

Run npm run test:e2e -- tests/e2e/fs-dependencies.spec.ts: PASS both viewports.

- [ ] **Step 3: Prove parent critical branch, one undo and restart.**

Seed R/P/Q and literal §6.1 sources/AB/CD through real commands. Before four critical leaf bars/two critical arrows/P/Q indicators. Edit A Oct07–08/null duration once => B Oct09–11; readTree H ends Oct11, projectFloat 0/0/2/2, constraintFloat 0/0/0/2, only A/B/AB critical. UI P/R critical/Q ordinary; P Oct07–11, Q Oct05–09, R Oct05–11. One header undo restores exact tasks/nulls/edges/schedule; runtime restart/reload/login preserves. Do not expect pre-undo project revision/timestamp (undo is a new revision).

Update optional-scheduling.spec.ts live relation-add A Oct05–06→C Oct05–06 to assert canonical C Oct07–08 and the resulting server/UI analysis rather than retained infeasible; use rejection expectations for protected/raw conflicts. Preserve historical infeasible diagnostic UI coverage with a preexisting synthetic conflicting snapshot, not a live add that now repairs/rejects.

Run npm run test:e2e -- tests/e2e/fs-dependencies.spec.ts tests/e2e/explicit-cpm.spec.ts tests/e2e/optional-scheduling.spec.ts: PASS both viewports/historical/frozen controls.

- [ ] **Step 4: Reconcile confirmed scope/defaults and run final gates.**

DECISIONS C24 records only owner scope (independent FS in four inputs, dependent dates move, parent criticality, simple UX). D17 records chosen leaf/lag-zero, causal push/tight pull/no anchors, nullable/done/direct-edit rejection, draft versus immediate defaults. Link spec/ADR. In SCHEDULING put active command rules near C16, qualify conflicting older “save user conflict as infeasible” as historical/pure analysis; analysis still diagnoses historical infeasible snapshots. UI documents Alt+L/Esc/focus/whole-project picker/atomic draft/immediate ack/graph; ACCEPTANCE links F01–F16/§6.1/four-input/retry matrix. START_HERE concise C24/D17 state note. ADR 011 already covers architecture; no new ADR.

~~~sh
npm run typecheck
npm run lint
npm run test:unit
npm run test:integration
npm run build
npm run test:e2e
npm run format:check
npm run check:package
npm run check:kit
npm run test:kit
npm run security:workspace
~~~

verify can replace equivalent typecheck/lint/all Vitest/build without needless duplication. build precedes E2E/check:package. Do not skip failing scanner/environment gates; report/fix permitted cause. STATUS records passed/failed/not-run facts, touched areas, strict-null/no-anchor limits, both viewport proof/frozen regression and next S4 board/S5/S6; never claim whole release done. No personal paths/transcripts/private reports.

Inspect git diff --check/scoped diff; no runtime artifacts/new binaries/lockfile/migration changes. Local candidate commit “test: verify FS cascade and predecessor workflows” follows self-review and security:staged; independent final review/fix loop, affected tests plus required workflow history/preflight checks before handoff. No publication.

## Self-review

- [ ] Spec §§2–4/F01–F16/§6.1 => Task 1, including max/finish causal barriers, source/provenance/done/frozen/exact retry/undo.
- [ ] Spec §5 => Task 2, all four entry points/both QuickAdd/full draft comparison/canonical baseline/dirty guards.
- [ ] Spec §§6.1–7 => Task 3 real-server two-viewports/parent branch/undo/restart/genuine rejection/uncertain/docs/gates.
- [ ] No placeholders/missing interfaces/command-only DTO leakage/new modes/tables/libs/generated oracles or historical reachable repair.
