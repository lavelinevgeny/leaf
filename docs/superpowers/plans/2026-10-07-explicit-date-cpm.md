# Explicit Date CPM Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use `subagent-driven-development` or `executing-plans` to implement this plan task-by-task. The owner requires separate author, implementation worker and two independent reviewers. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Подключить настоящий серверный CPM введённых интервалов C16 к единственному target scheduler после Task 5, сохранив nullable source, точный replay и атомарную отмену.

**Architecture:** Существующий `calculateSchedule(input: OptionalInput): OptionalResult` сохраняет единственный вход; projection real/FS/summary/display из Task 5 дополняется чистым анализом leaf DAG. Координаты, обратные границы и H/Hknown остаются внутри domain; публичный DTO различает live ready/incomplete/infeasible и неизменяемый frozen pending результат. React только показывает серверные floats, множества IDs и подписанный partial result.

**Tech Stack:** TypeScript strict; React 19.3.0/Vite 8.3.3; Fastify 5.12.5; better-sqlite3 13.0.3; Zod 4.6.5; Vitest 5.0.3; Playwright 1.63.0; Node 24.21.0/npm 11.19.0, существующий exact lockfile.

**Spec:** [Принятое приложение C16, разделы 1–4/P01–P11](../specs/2026-10-07-optional-scheduling-policy-proposal.md), [утверждённая спецификация, разделы 8–11/N06/OS16](../specs/2026-10-07-optional-scheduling-design.md), [ADR 008](../../adr/008-explicit-date-cpm.md), [основной план, Tasks 1/2/5/6/7](2026-10-07-optional-scheduling.md). Читать также [DECISIONS](../../DECISIONS.md), [SCHEDULING](../../SCHEDULING.md), [ACCEPTANCE](../../ACCEPTANCE.md), [PRIVACY](../../PRIVACY.md), [AGENT_WORKFLOW](../../AGENT_WORKFLOW.md).

**Status:** Technical annex Task 6 подготовлен для двух independent reviews. C16/O06/G-CPM CLOSED как выбор политики; Task 6 GREEN и Task 7 execution ещё не заявлены. Базовые APPROVED основного плана не распространяются на этот документ. Ни один fenced test ниже не является уже реализованным application test.

## Global Constraints

- C11–C17 подтверждены владельцем. D13 и другие D — рабочие defaults. C16 сохраняет W01 допуск только валидных пар; C17 дополняет W06 однократной конвертацией и exact archive. Остальные W — технические предложения, не отдельные owner decisions.
- Конечная задача содержит `inputStart: CalendarDate | null`, `inputFinish: CalendarDate | null`, `durationDays: positive integer | null`.
- Пропуск поля в patch сохраняет прежнее значение; явный `null` очищает только его.
- `CalendarDate` — валидная строка `YYYY-MM-DD` в существующем диапазоне 0001–9999. Окончание включительно.
- Календарь проекта сохраняется: `all-days` или `weekdays` (пн–пт), default D04; timezone нужен для «Сегодня», не для арифметики дат.
- Целевой публичный DTO не содержит `deadline`, `notBefore`, `planMode`, `project.startDate` и relative completed indices.
- Авторитетные записи, проверка графа, пересчёт, result и undo — одна SQLite-транзакция с `expectedRevision`/`operationId`.
- Граф остаётся DAG с leaf-only FS, lag=0, внутри одного проекта; parentId не создаёт precedence.
- Один writer одновременно меняет shared contracts, schema, migration и scheduling semantics. Каждый concurrent agent использует свой worktree.
- Только disposable synthetic fixtures. Не читать production DB, backups, `.env`, реальные экспорты, credential stores или истории агента. Не логировать archive/raw bodies/cookies.
- Не менять стек, lockfile, scanner policy, Git identity или hooks. Без ORM, платного Gantt, graph editor, облаков, CDN, telemetry, AI API, очередей и ресурсов.
- Только три PNG из [design/README](../../../design/README.md); исключённый коллаж не использовать. Русский UI, English identifiers/commit subjects.
- Push, deploy, release и production migration требуют отдельного поручения владельца. Положительное ревью плана этого разрешения не даёт.
- Все последующие задачи требуют Task 5 GREEN и двух APPROVED этого annex на один точный SHA. Preparation files `optional-*.ts` уже удалены Task 5; не создавать их повторно.
- Frozen `pending-policy` ответы принимаются в прежней форме без defaults/добавления floats и не пересчитываются. Live `calculateSchedule` после подключения никогда не возвращает pending.
- Calendar spans, source dates, summary и display не записываются анализом. Duration-only, start+duration, finish+duration и условные полосы не входят в CPM.
- Нормативная C16 раздел 3 имеет приоритет над промежуточной классификацией Task 2: saved invalid/mismatch interval даёт unknown/incomplete, пока нет доказанного FS-конфликта. Malformed graph fail closed; мутации уже отклоняет existing validator. Task 7 меняет эту классификацию явно, без исправления source.

## Вход из Task 5 и карта файлов

Task 5 переносит `OptionalTask`/`OptionalInput`/`RealTask`/`OptionalSummary`/`ConditionalDisplay`/`OptionalResult` в `src/domain/scheduling-types.ts`, переносит `realInterval` в `src/domain/planning.ts`, а schemas и V2 aliases — в `src/shared/contracts.ts`. Названия OptionalInput/OptionalTask оставлены совместимыми; новый проектный start не добавлять.

```ts
// Уже существует после Task 5: точный вход, не новый envelope.
export interface OptionalTask extends SourceFields {
  id: string; parentId: string | null; status: 'todo' | 'doing' | 'done';
}
export interface OptionalInput {
  calendarType: CalendarType;
  tasks: readonly OptionalTask[];
  dependencies: readonly SchedulingDependency[];
}
export function calculateSchedule(input: OptionalInput): OptionalResult;
export function realInterval(
  source: SourceFields, calendar: CalendarType,
): { startDate: string; finishDate: string; calendarSpanDays: number } | null;
export function validateDependency(
  tasks: readonly Pick<OptionalTask, 'id' | 'parentId'>[],
  dependencies: readonly SchedulingDependency[],
  predecessorId: string, successorId: string,
): void;
export function validateDependencies(
  tasks: readonly Pick<OptionalTask, 'id' | 'parentId'>[],
  dependencies: readonly SchedulingDependency[],
): void;
```

| Файл | Действие и ответственность |
|---|---|
| `src/shared/contracts.ts` | Сохранить точный pending schema как frozen; добавить live strict schemas/union и V2 aliases |
| `src/domain/scheduling-types.ts` | Сохранить input/real/display types; определить domain graph/analysis types и OptionalResult alias |
| `src/domain/explicit-cpm.ts` | Новый pure coordinate/weak-component/backward analysis; без SQL/React/legacy imports |
| `src/domain/scheduling.ts` | Выделить existing projection; добавить диагностику unknown, normative status classification; один calculateSchedule |
| `src/domain/calendar.ts` | Существующую O(1)/O(log year) арифметику переиспользовать без новых зависимостей |
| `src/server/repository.ts` | Parse live result before commit; cached response parse union without recalculation |
| `src/client/ScheduleStatus.tsx`, `strings.ts` | Status/float/partial copy и отсутствие ложного global результата |
| `src/client/Gantt.tsx`, `gantt-view.ts`, `Dependencies.tsx`, `TaskTree.tsx` | Global и partial IDs показывать раздельно; summary только индикатор потомков |
| `tests/helpers/explicit-cpm-fixtures.ts` | Literal numerical matrix ниже; никакого вызова solver для expected |
| `tests/explicit-cpm-contracts.test.ts` | Strict union, frozen pending equality, compile-time type assignment |
| `tests/explicit-cpm.test.ts` | P01–P11/N06/fork/join/partial/extremes/invariance/deep fixtures |
| `tests/explicit-cpm-repository.test.ts` | Revision/undo/restart/retry/frozen response/rollback на disposable SQLite |
| `tests/scheduling-api.test.ts` | Live HTTP response strict parse, status/unknown/conflict priorities |
| `tests/client/explicit-cpm.test.tsx` | Literal server DTOs, unknown/partial/error/keyboard |
| `tests/e2e/explicit-cpm.spec.ts` | Реальный browser edit→recalculate→undo→restart и collapse/graph |
| `package.json` | Добавить новые suites в явные unit/integration lists; lockfile не менять |
| `docs/STATUS.md`, `docs/adr/008-explicit-date-cpm.md` | Фактические checks/limitations и ссылка на реализованный annex после GREEN |

Исторические `fixtures/scheduling/cpm-cases.json` проверяют прежний Auto, не заменяются новым observed-interval oracle. `calendar-cases.json` сохраняется. Новые literal fixtures находятся в TypeScript test helper и исполняются Vitest; `check:kit` этого не доказывает.

## Полный контракт результата

Технический контракт добавляет `horizonFinishDate` — последнее включительное введённое окончание ready-плана, без сохранения source; для пустого ready-плана null. В incomplete/infeasible оно null. В partial `knownHorizonFinishDate` — последнее включительное окончание всех известных валидных leaves, включая vertices blocked components. Исключительные H/Hknown и техническая origin наружу не передаются.

- Live ready: каждая запись tasks имеет валидный interval и integer floats; summary имеет `containsCritical: boolean`. `partialAnalysis=null`.
- Live incomplete: все ordinary floats и `containsCritical` null; global IDs пусты; partialAnalysis отдельный nullable объект. В нём только полностью известные weak components; blocked vertices не получают ни нулевых, ни null partial float entries.
- Live infeasible: ordinary floats/summary critical null, global IDs пусты, `partialAnalysis=null` независимо от coverage.
- Frozen pending: ровно форма Task 1/5, без новых полей, включая прежнюю feasibility/diagnostics. Parser не улучшает её outcome.
- Empty live project: ready/feasible, coverage 0/0, оба горизонта отсутствуют, maps/IDs/diagnostics пусты.
- Summary не имеет float. `partialCriticalSummaryIds` означает наличие partial-critical конечного потомка и показывается только с подписью partial.

Заменить только определение result schemas в `contracts.ts` следующим блоком; existing source/project/task/dependency/snapshot/command schemas и exported aliases Task 5 сохраняются. `projectTreeV2Schema`/`scheduleResponseV2Schema` ниже заменяют прежние exports, `ProjectTree`/`ScheduleResponse` остаются aliases этих V2 forms.

```ts
const countCpmSchema = z.number().int().nonnegative();
const floatCpmSchema = z.number().int().nonnegative();
const coverageCpmSchema = z.strictObject({
  knownLeafCount: countCpmSchema, totalLeafCount: countCpmSchema,
}).refine(x => x.knownLeafCount <= x.totalLeafCount, 'Invalid coverage');
const idsCpmSchema = z.array(uuidSchema).refine(
  ids => ids.every((id, i) => i === 0 || ids[i - 1]! < id),
  'IDs must be unique and sorted',
);
const diagnosticsCpmSchema = z.array(z.strictObject({
  code: z.string(), taskIds: z.array(uuidSchema),
  dependencyIds: z.array(uuidSchema), messageKey: z.string(),
}));
const realCpmShape = {
  startDate: calendarDateSchema.nullable(),
  finishDate: calendarDateSchema.nullable(),
  calendarSpanDays: z.number().int().positive().nullable(),
};
const realCpmSchema = z.strictObject(realCpmShape).refine(x =>
  [x.startDate, x.finishDate, x.calendarSpanDays].every(v => v === null) ||
  [x.startDate, x.finishDate, x.calendarSpanDays].every(v => v !== null),
  'Incomplete real interval',
);
const summaryCpmShape = {
  ...realCpmShape, knownLeafCount: countCpmSchema, totalLeafCount: countCpmSchema,
};
const displayCpmSchema = z.record(uuidSchema, z.strictObject({
  kind: z.literal('conditional'), startDate: calendarDateSchema,
  finishDate: calendarDateSchema, clipped: z.boolean(),
}));

// Exact Task 1/5 form: no new validation, defaults, transforms or additions.
export const frozenPendingScheduleV2Schema = z.strictObject({
  analysisStatus: z.literal('pending-policy'),
  feasibility: z.enum(['feasible', 'incomplete', 'infeasible']),
  coverage: z.strictObject({
    knownLeafCount: countCpmSchema, totalLeafCount: countCpmSchema,
  }),
  tasks: z.record(uuidSchema, z.strictObject(realCpmShape)),
  summaries: z.record(uuidSchema, z.strictObject(summaryCpmShape)),
  display: displayCpmSchema,
  criticalTaskIds: z.array(uuidSchema).length(0),
  criticalDependencyIds: z.array(uuidSchema).length(0),
  diagnostics: diagnosticsCpmSchema,
});
const liveCommonCpmShape = {
  coverage: coverageCpmSchema, display: displayCpmSchema,
  diagnostics: diagnosticsCpmSchema,
};
const readyTaskCpmSchema = z.strictObject({
  startDate: calendarDateSchema, finishDate: calendarDateSchema,
  calendarSpanDays: z.number().int().positive(),
  projectFloat: floatCpmSchema, constraintFloat: floatCpmSchema,
}).refine(x => x.constraintFloat <= x.projectFloat, 'Invalid floats');
const unanalyzedTaskCpmSchema = z.strictObject({
  ...realCpmShape, projectFloat: z.null(), constraintFloat: z.null(),
}).refine(x => realCpmSchema.safeParse({
  startDate: x.startDate, finishDate: x.finishDate,
  calendarSpanDays: x.calendarSpanDays,
}).success, 'Incomplete real interval');
const readySummaryCpmSchema = z.strictObject({
  startDate: calendarDateSchema, finishDate: calendarDateSchema,
  calendarSpanDays: z.number().int().positive(),
  knownLeafCount: countCpmSchema, totalLeafCount: countCpmSchema,
  containsCritical: z.boolean(),
}).refine(x => x.knownLeafCount === x.totalLeafCount && x.totalLeafCount > 0,
  'Incomplete ready summary');
const unanalyzedSummaryCpmSchema = z.strictObject({
  ...summaryCpmShape, containsCritical: z.null(),
}).refine(x => x.knownLeafCount <= x.totalLeafCount &&
  realCpmSchema.safeParse({ startDate: x.startDate, finishDate: x.finishDate,
    calendarSpanDays: x.calendarSpanDays }).success, 'Invalid summary');
export const partialAnalysisV2Schema = z.strictObject({
  labelKey: z.literal('scheduling.PARTIAL_ANALYSIS'),
  knownHorizonFinishDate: calendarDateSchema,
  coverage: z.strictObject({
    analyzedLeafCount: countCpmSchema, blockedLeafCount: countCpmSchema,
  }),
  tasks: z.record(uuidSchema, z.strictObject({ knownHorizonFloat: floatCpmSchema })),
  partialCriticalTaskIds: idsCpmSchema,
  partialCriticalDependencyIds: idsCpmSchema,
  partialCriticalSummaryIds: idsCpmSchema,
}).refine(x =>
  Object.keys(x.tasks).length === x.coverage.analyzedLeafCount &&
  x.partialCriticalTaskIds.every(id => x.tasks[id]?.knownHorizonFloat === 0),
  'Invalid partial coverage/critical tasks',
);
export const readyScheduleV2Schema = z.strictObject({
  ...liveCommonCpmShape, analysisStatus: z.literal('ready'),
  feasibility: z.literal('feasible'),
  tasks: z.record(uuidSchema, readyTaskCpmSchema),
  summaries: z.record(uuidSchema, readySummaryCpmSchema),
  horizonFinishDate: calendarDateSchema.nullable(),
  partialAnalysis: z.null(),
  criticalTaskIds: idsCpmSchema, criticalDependencyIds: idsCpmSchema,
}).refine(x =>
  x.coverage.knownLeafCount === x.coverage.totalLeafCount &&
  Object.keys(x.tasks).length === x.coverage.totalLeafCount &&
  (x.coverage.totalLeafCount === 0 ? x.horizonFinishDate === null : x.horizonFinishDate !== null) &&
  x.criticalTaskIds.every(id => x.tasks[id]?.projectFloat === 0),
  'Invalid ready coverage/horizon/critical tasks',
);
export const incompleteScheduleV2Schema = z.strictObject({
  ...liveCommonCpmShape, analysisStatus: z.literal('incomplete'),
  feasibility: z.literal('incomplete'),
  tasks: z.record(uuidSchema, unanalyzedTaskCpmSchema),
  summaries: z.record(uuidSchema, unanalyzedSummaryCpmSchema),
  horizonFinishDate: z.null(), partialAnalysis: partialAnalysisV2Schema.nullable(),
  criticalTaskIds: z.array(uuidSchema).length(0),
  criticalDependencyIds: z.array(uuidSchema).length(0),
}).refine(x =>
  x.coverage.knownLeafCount < x.coverage.totalLeafCount &&
  Object.keys(x.tasks).length === x.coverage.totalLeafCount &&
  (x.partialAnalysis === null ? x.coverage.knownLeafCount === 0 :
    x.partialAnalysis.coverage.analyzedLeafCount +
    x.partialAnalysis.coverage.blockedLeafCount === x.coverage.totalLeafCount),
  'Invalid incomplete coverage',
);
export const infeasibleScheduleV2Schema = z.strictObject({
  ...liveCommonCpmShape, analysisStatus: z.literal('infeasible'),
  feasibility: z.literal('infeasible'),
  tasks: z.record(uuidSchema, unanalyzedTaskCpmSchema),
  summaries: z.record(uuidSchema, unanalyzedSummaryCpmSchema),
  horizonFinishDate: z.null(), partialAnalysis: z.null(),
  criticalTaskIds: z.array(uuidSchema).length(0),
  criticalDependencyIds: z.array(uuidSchema).length(0),
});
export const liveScheduleResultV2Schema = z.discriminatedUnion('analysisStatus', [
  readyScheduleV2Schema, incompleteScheduleV2Schema, infeasibleScheduleV2Schema,
]);
export const scheduleResultV2Schema = z.union([
  frozenPendingScheduleV2Schema, liveScheduleResultV2Schema,
]);
export const projectTreeV2Schema = snapshotV2Schema.extend({
  contractVersion: z.literal(2), canUndo: z.boolean(), schedule: scheduleResultV2Schema,
});
export const scheduleResponseV2Schema = z.strictObject({
  contractVersion: z.literal(2), projectId: uuidSchema,
  revision: countCpmSchema, schedule: scheduleResultV2Schema,
});
export type FrozenPendingScheduleV2 = z.infer<typeof frozenPendingScheduleV2Schema>;
export type LiveScheduleResultV2 = z.infer<typeof liveScheduleResultV2Schema>;
export type ScheduleResultV2 = z.infer<typeof scheduleResultV2Schema>;
export type PartialAnalysisV2 = z.infer<typeof partialAnalysisV2Schema>;
export type ProjectTreeV2 = z.infer<typeof projectTreeV2Schema>;
export type ScheduleResponseV2 = z.infer<typeof scheduleResponseV2Schema>;
export type ProjectTree = ProjectTreeV2;
export type ScheduleResponse = ScheduleResponseV2;
export const scheduleResultSchema = scheduleResultV2Schema;
export const projectTreeSchema = projectTreeV2Schema;
export const scheduleResponseSchema = scheduleResponseV2Schema;
```

Не дублировать существующие aliases: заменить их определения. `OptionalResult = ScheduleResultV2` импортируется из shared только как type. `LiveResult = LiveScheduleResultV2`; final `calculateSchedule` возвращает `LiveResult` (сужение return совместимо с прежним OptionalResult), cached responses — OptionalResult. Проекция исключает только прежние pending-only fields:

```ts
// src/domain/scheduling-types.ts: existing real/input definitions remain.
import type {
  FrozenPendingScheduleV2, LiveScheduleResultV2, ScheduleResultV2,
} from '../shared/contracts.js';
export type OptionalResult = ScheduleResultV2;
export type LiveResult = LiveScheduleResultV2;
export type ExplicitProjection = Omit<FrozenPendingScheduleV2,
  'analysisStatus' | 'criticalTaskIds' | 'criticalDependencyIds'>;
export interface WorkingInterval { s: number; f: number; d: number }
export interface CpmVertex extends WorkingInterval {
  id: string; status: 'todo' | 'doing' | 'done';
}
export interface CpmGraph {
  vertices: ReadonlyMap<string, CpmVertex>; // Only valid real leaves.
  leafIds: readonly string[];              // Includes unknown leaves.
  dependencies: readonly SchedulingDependency[]; // Original validated DAG.
  topoIds: readonly string[];              // All leaves, no summary vertices.
  weakComponents: readonly (readonly string[])[];
  originDate: string; calendarType: CalendarType;
}
export interface BackwardValue {
  LS: number; LF: number; projectFloat: number; constraintFloat: number;
}
export interface BackwardAnalysis {
  horizon: number | null;
  values: ReadonlyMap<string, BackwardValue>;
  criticalTaskIds: string[]; criticalDependencyIds: string[];
}
// Pure exports in explicit-cpm.ts:
export function toWorkingInterval(
  task: SourceFields, calendar: CalendarType, originDate?: string,
): WorkingInterval | null;
export function buildCpmGraph(input: OptionalInput, originDate?: string): CpmGraph;
export function analyzeDatedGraph(
  graph: CpmGraph, analyzedIds: ReadonlySet<string>, horizon: number | null,
): BackwardAnalysis;
export function analyzeExplicitDates(
  input: OptionalInput, projection: ExplicitProjection, originDate?: string,
): LiveResult;
// Pure exports in scheduling.ts:
export function projectExplicitSchedule(input: OptionalInput): ExplicitProjection;
export function calculateSchedule(input: OptionalInput): LiveResult;
```

`buildCpmGraph` consumes already graph-validated input from projection; for direct tests require `validateDependencies` first. No unsafe casts to legacy SchedulingTask. `analyzeDatedGraph` rejects an analyzed set containing an unknown vertex or an edge crossing that set with `RangeError('INVALID_ANALYSIS_COMPONENT')`; input IDs must be union of complete weak components. No path enumeration. `analyzeExplicitDates` immediately suppresses analysis on graph diagnostic/known FS violation, so malformed graph is never passed to arithmetic.

## Координата и алгоритм

Default internal origin `'0001-01-01'` is Monday and working in both calendars. It is a technical coordinate, never a release date. Alternative working origins are only test injection into pure helpers; no new application option.

Civil ordinal O(0001-01-01)=0; proleptic Gregorian leap rule. For all-days W(date)=O(date). For weekdays, only Monday–Friday dates admitted and `W(date)=5*floor(O/7)+(O mod 7)`. `s=W(start)-W(origin)`, `f=W(finish)-W(origin)+1`, `d=f-s`. Existing `dateToIndex`/`workingDaysInclusive` implement this without day iteration.

```ts
export function toWorkingInterval(
  task: SourceFields, calendar: CalendarType, originDate = '0001-01-01',
): WorkingInterval | null {
  const real = realInterval(task, calendar);
  if (real === null) return null;
  const s = dateToIndex(real.startDate, originDate, calendar);
  const f = dateToIndex(real.finishDate, originDate, calendar) + 1;
  return { s, f, d: f - s };
}
```

At inclusive `9999-12-31`, f may lie one boundary beyond the last representable date. Keep f/H/LF numeric; convert only `H-1`/`f-1` via `indexToDate`. Never request ISO date of exclusive f. All-days full range d=3652059; weekdays d=2608615; both fit safe integer and exceed input duration cap without limiting derived span. Negative coordinates from a later injected origin are valid. Source one-sided weekend is retained; cannot supply a working FS bound or real interval.

Implementation sequence inside `analyzeExplicitDates`:

1. Take leaf IDs/real pairs/summary/display from projection without mutating it. Detect malformed graph diagnostics (`DUPLICATE_TASK_ID`, `INVALID_PARENT`, `TREE_CYCLE`, `DUPLICATE_DEPENDENCY_ID`, `DEPENDENCY_TASK_NOT_FOUND`, `SELF_DEPENDENCY`, `DEPENDENCY_REQUIRES_LEAVES`, `DUPLICATE_DEPENDENCY`, `DEPENDENCY_CYCLE`, `INVALID_PROJECT_CALENDAR`) or `EXPLICIT_PRECEDENCE_CONFLICT`. Return infeasible before any normal/partial analysis.
2. For every missing pair append `UNKNOWN_INTERVAL` ([task], no edges); for invalid full pair append `INVALID_INTERVAL`; for valid date pair whose supplied duration mismatches append `DURATION_MISMATCH`. Do not duplicate equivalent existing projection diagnostic. Missing pair is not replaced by duration/display. FS checks still use independently known predecessor finish/successor start even when realInterval=null.
3. Necessary absent FS edge bound → `UNKNOWN_PRECEDENCE`, both endpoints and original edge ID; nonworking/invalid necessary bound → `INVALID_PRECEDENCE_BOUNDARY`. Check all checkable edges, preserving unknown diagnostics alongside conflict. `EXPLICIT_PRECEDENCE_CONFLICT` reports exact endpoints/edge; no automatic shift. Graph errors fail closed; saved source/calendar mismatch alone means incomplete. Existing mutation validator still rejects newly supplied invalid pairs and graph.
4. Build CpmGraph with iterative Kahn topological traversal and iterative undirected BFS/DFS weak components over **all** leaves and **all** original edges, including unknown. Sort leaf IDs, component members, components by smallest ID, IDs in result and diagnostics by `code/taskIds/dependencyIds` using existing deterministic comparison. Use indexed queue cursor, no `shift()` for 10000-node graph. Sorting O((V+E)log(V+E)), passes O(V+E), memory O(V+E); arithmetic does not depend on date span.
5. `knownHorizon=max(f of all valid leaves)`; null if none. If all leaves known, H=knownHorizon. In reverse topo iterate all known leaves; terminal LF=H; otherwise min(H, successors' LS); LS=LF-d, projectFloat=LS-s; constraintFloat=done?0:min(H-f, successors' **entered s** minus f). Derive critical tasks float=0; edge critical iff both float=0 **and f(predecessor)=s(successor)**.
6. In incomplete use Hknown across all known leaves, then analyzedIds as union of complete weak components. Run same reverse pass on these vertices; publish only `knownHorizonFloat` (ordinary projectFloat from that horizon) in separate partial tasks. No partial constraintFloat. Known vertices in blocked components influence Hknown but receive no partial entry. If Hknown exists but analyzedIds empty, publish partial object with empty maps/sets and blocked count=all leaves; if none known, partialAnalysis=null.
7. Make every live leaf task/summary carry ordinary null floats/critical in incomplete/infeasible. For ready aggregate `containsCritical` bottom-up by OR of critical **leaf** membership. For partial aggregate separate `partialCriticalSummaryIds` by leaf membership regardless of whether the summary range is complete; missing summary range remains null. Do not introduce graph edges from parentId.
8. Copy source intervals/display unchanged into the typed final result; Repository performs strict live schema parsing before commit. `calculateSchedule` does only `analyzeExplicitDates(input, projectExplicitSchedule(input))`; it does not call legacy calculator, use today or write anything.

A ready DAG with valid FS implies LS>=entered s, projectFloat>=0 and constraintFloat<=projectFloat. Assert these domain invariants before constructing ready result; unexpected violation throws internal safe error, causing transaction rollback, instead of clipping to zero. For partial assert same within analyzed components. Valid source range/summary remains visible during infeasible; only analysis is suppressed.

## Независимые numerical fixtures и runnable tests

Техническая опора в следующих P/F/N случаях — 2026-10-05, all-days, кроме P10/P11. Например A 5–6 октября означает [0,2), B 7–9 октября [2,5), C 5–14 октября [0,10). Expected arrays записаны вручную по нормативным формулам; helper только строит input, не вычисляет даты/float. IDs A/B/AB допустимы в pure domain tests; strict DTO tests ниже используют literal UUID.

В `tests/helpers/explicit-cpm-fixtures.ts` записать целиком:

```ts
import type { OptionalInput, OptionalTask } from '../../src/domain/scheduling-types.js';
export const leaf = (
  id: string, inputStart: string | null, inputFinish: string | null,
  durationDays: number | null = null,
  status: OptionalTask['status'] = 'todo', parentId: string | null = null,
): OptionalTask => ({ id, inputStart, inputFinish, durationDays, status, parentId });
export const edge = (id: string, predecessorId: string, successorId: string) =>
  ({ id, predecessorId, successorId });
export type ReadyFixture = {
  id: string; input: OptionalInput; horizon: string;
  floats: [string, number, number][]; critical: string[]; criticalEdges: string[];
};
export const readyFixtures: ReadyFixture[] = [
  { id: 'P01', input: { calendarType: 'all-days', tasks: [
    leaf('A','2026-10-05','2026-10-06'), leaf('B','2026-10-07','2026-10-09'),
    leaf('C','2026-10-10','2026-10-11') ],
    dependencies: [edge('AB','A','B'),edge('BC','B','C')] },
    horizon:'2026-10-11', floats:[['A',0,0],['B',0,0],['C',0,0]],
    critical:['A','B','C'], criticalEdges:['AB','BC'] },
  { id: 'P02', input: { calendarType: 'all-days', tasks: [
    leaf('A','2026-10-05','2026-10-06'),leaf('B','2026-10-10','2026-10-11') ],
    dependencies:[edge('AB','A','B')] },
    horizon:'2026-10-11', floats:[['A',3,3],['B',0,0]],
    critical:['B'],criticalEdges:[] },
  { id: 'P03', input: { calendarType: 'all-days', tasks: [
    leaf('A','2026-10-05','2026-10-06'),leaf('B','2026-10-07','2026-10-09'),
    leaf('C','2026-10-05','2026-10-14') ],dependencies:[edge('AB','A','B')] },
    horizon:'2026-10-14',floats:[['A',5,0],['B',5,5],['C',0,0]],
    critical:['C'],criticalEdges:[] },
  { id: 'P04', input: { calendarType: 'all-days', tasks: [
    leaf('A','2026-10-05','2026-10-06'),leaf('B','2026-10-07','2026-10-09'),
    leaf('C','2026-10-05','2026-10-07'),leaf('D','2026-10-08','2026-10-09') ],
    dependencies:[edge('AB','A','B'),edge('CD','C','D')] },
    horizon:'2026-10-09',floats:[['A',0,0],['B',0,0],['C',0,0],['D',0,0]],
    critical:['A','B','C','D'],criticalEdges:['AB','CD'] },
  { id: 'P05', input: { calendarType: 'all-days', tasks: [
    leaf('A','2026-10-05','2026-10-06'),leaf('B','2026-10-07','2026-10-11'),
    leaf('C','2026-10-05','2026-10-07'),leaf('D','2026-10-08','2026-10-09') ],
    dependencies:[edge('AB','A','B'),edge('CD','C','D')] },
    horizon:'2026-10-11',floats:[['A',0,0],['B',0,0],['C',2,0],['D',2,2]],
    critical:['A','B'],criticalEdges:['AB'] },
  { id: 'P06', input: { calendarType: 'all-days', tasks: [
    leaf('A','2026-10-05','2026-10-06',null,'done'),
    leaf('B','2026-10-07','2026-10-09'),leaf('C','2026-10-05','2026-10-14') ],
    dependencies:[edge('AB','A','B')] },
    horizon:'2026-10-14',floats:[['A',5,0],['B',5,5],['C',0,0]],
    critical:['C'],criticalEdges:[] },
  { id: 'P10', input: { calendarType: 'weekdays', tasks: [
    leaf('A','2026-10-09','2026-10-09'),leaf('B','2026-10-12','2026-10-13') ],
    dependencies:[edge('AB','A','B')] },
    horizon:'2026-10-13',floats:[['A',0,0],['B',0,0]],
    critical:['A','B'],criticalEdges:['AB'] },
  { id: 'N06', input: { calendarType: 'all-days', tasks: [
    leaf('A','2026-10-05','2026-10-06'),leaf('B','2026-10-10','2026-10-10'),
    leaf('C','2026-10-05','2026-10-14') ],dependencies:[edge('AB','A','B')] },
    horizon:'2026-10-14',floats:[['A',7,3],['B',4,4],['C',0,0]],
    critical:['C'],criticalEdges:[] },
  { id: 'N06-done', input: { calendarType: 'all-days', tasks: [
    leaf('A','2026-10-05','2026-10-06'),
    leaf('B','2026-10-10','2026-10-10',null,'done'),
    leaf('C','2026-10-05','2026-10-14') ],dependencies:[edge('AB','A','B')] },
    horizon:'2026-10-14',floats:[['A',7,3],['B',4,0],['C',0,0]],
    critical:['C'],criticalEdges:[] },
  { id: 'F01-fork-join', input: { calendarType: 'all-days', tasks: [
    leaf('A','2026-10-05','2026-10-06'),leaf('B','2026-10-07','2026-10-09'),
    leaf('C','2026-10-07','2026-10-08'),leaf('D','2026-10-10','2026-10-11') ],
    dependencies:[edge('AB','A','B'),edge('AC','A','C'),
      edge('BD','B','D'),edge('CD','C','D')] },
    horizon:'2026-10-11',floats:[['A',0,0],['B',0,0],['C',1,1],['D',0,0]],
    critical:['A','B','D'],criticalEdges:['AB','BD'] },
  { id: 'F02-tied-fork-join', input: { calendarType: 'all-days', tasks: [
    leaf('A','2026-10-05','2026-10-06'),leaf('B','2026-10-07','2026-10-09'),
    leaf('C','2026-10-07','2026-10-09'),leaf('D','2026-10-10','2026-10-11') ],
    dependencies:[edge('AB','A','B'),edge('AC','A','C'),
      edge('BD','B','D'),edge('CD','C','D')] },
    horizon:'2026-10-11',floats:[['A',0,0],['B',0,0],['C',0,0],['D',0,0]],
    critical:['A','B','C','D'],criticalEdges:['AB','AC','BD','CD'] },
  { id: 'F03-nontight-extra-edge', input: { calendarType: 'all-days', tasks: [
    leaf('A','2026-10-05','2026-10-06'),leaf('B','2026-10-07','2026-10-09'),
    leaf('C','2026-10-10','2026-10-11') ],
    dependencies:[edge('AB','A','B'),edge('BC','B','C'),edge('AC','A','C')] },
    horizon:'2026-10-11',floats:[['A',0,0],['B',0,0],['C',0,0]],
    critical:['A','B','C'],criticalEdges:['AB','BC'] },
];
```

Ручная проверка F01: D.LS=5; B.LS=2; C.LS=3; A.LS=min(2,3)-2=0; C имеет project/constraint=1. F03: A/C нулевые, но AC gap=3, поэтому AC не critical. P05: C constraint=0 при project=2; D constraint=2. N06: B.LS=9, A.LS=7, C.LS=0, поэтому 7/4/0 и 3/4/0; done B меняет только constraint 4→0.

`tests/explicit-cpm.test.ts` начинается следующим runnable кодом; каждый дополнительный test в этом разделе добавляется в тот же файл.

```ts
import { expect, it } from 'vitest';
import { calculateSchedule, projectExplicitSchedule } from '../src/domain/scheduling.js';
import { analyzeExplicitDates, buildCpmGraph, analyzeDatedGraph,
  toWorkingInterval } from '../src/domain/explicit-cpm.js';
import type { OptionalInput } from '../src/domain/scheduling-types.js';
import { leaf, edge, readyFixtures } from './helpers/explicit-cpm-fixtures.js';

it.each(readyFixtures)('$id literal observed intervals', ({ input, horizon, floats, critical, criticalEdges }) => {
  const before = structuredClone(input);
  const result = calculateSchedule(input);
  expect(result.analysisStatus).toBe('ready');
  if (result.analysisStatus !== 'ready') throw new Error('Expected ready');
  expect(result.feasibility).toBe('feasible');
  expect(result.horizonFinishDate).toBe(horizon);
  expect(Object.entries(result.tasks).map(([id,t]) =>
    [id,t.projectFloat,t.constraintFloat]).sort()).toEqual(floats);
  expect(result.criticalTaskIds).toEqual(critical);
  expect(result.criticalDependencyIds).toEqual(criticalEdges);
  expect(result.partialAnalysis).toBeNull();
  expect(result.diagnostics).toEqual([]);
  expect(input).toEqual(before);
  const reversed = { ...input, tasks: [...input.tasks].reverse(),
    dependencies: [...input.dependencies].reverse() };
  expect(calculateSchedule(reversed)).toEqual(result);
  expect(analyzeExplicitDates(input, projectExplicitSchedule(input), '2026-10-05'))
    .toEqual(analyzeExplicitDates(input, projectExplicitSchedule(input), '2026-10-20'));
});

it('P07 uses a single Hknown and no ordinary/global analysis', () => {
  const input: OptionalInput = { calendarType:'all-days', tasks:[
    leaf('A','2026-10-05','2026-10-06'),leaf('B','2026-10-07','2026-10-09'),
    leaf('C','2026-10-05','2026-10-14'),leaf('U',null,null) ],
    dependencies:[edge('AB','A','B')] };
  const r = calculateSchedule(input);
  expect(r.analysisStatus).toBe('incomplete');
  if (r.analysisStatus !== 'incomplete') throw new Error('Expected incomplete');
  expect(r.coverage).toEqual({knownLeafCount:3,totalLeafCount:4});
  expect(r.horizonFinishDate).toBeNull();
  expect(Object.values(r.tasks).map(t => [t.projectFloat,t.constraintFloat]))
    .toEqual([[null,null],[null,null],[null,null],[null,null]]);
  expect(r.criticalTaskIds).toEqual([]); expect(r.criticalDependencyIds).toEqual([]);
  expect(r.partialAnalysis).toEqual({
    labelKey:'scheduling.PARTIAL_ANALYSIS',knownHorizonFinishDate:'2026-10-14',
    coverage:{analyzedLeafCount:3,blockedLeafCount:1},
    tasks:{ A:{knownHorizonFloat:5},B:{knownHorizonFloat:5},C:{knownHorizonFloat:0} },
    partialCriticalTaskIds:['C'],partialCriticalDependencyIds:[],partialCriticalSummaryIds:[],
  });
  expect(r.diagnostics).toEqual([{code:'UNKNOWN_INTERVAL',taskIds:['U'],
    dependencyIds:[],messageKey:'scheduling.UNKNOWN_INTERVAL'}]);
});

it.each([
  ['P08','2026-10-09','2026-10-14',0,['C']],
  ['Hknown-blocked-late','2026-10-16','2026-10-16',2,[]],
] as const)('%s never bypasses unknown and includes blocked known leaves in Hknown',
  (_name,bFinish,horizon,cFloat,partialIds) => {
  const input: OptionalInput = { calendarType:'all-days',tasks:[
    leaf('A','2026-10-05','2026-10-06'),leaf('U',null,null),
    leaf('B','2026-10-07',bFinish),leaf('C','2026-10-05','2026-10-14') ],
    dependencies:[edge('AU','A','U'),edge('UB','U','B')] };
  const r=calculateSchedule(input);
  expect(r.analysisStatus).toBe('incomplete');
  if(r.analysisStatus!=='incomplete') throw new Error('Expected incomplete');
  expect(r.coverage).toEqual({knownLeafCount:3,totalLeafCount:4});
  expect(r.partialAnalysis).toEqual({
    labelKey:'scheduling.PARTIAL_ANALYSIS',knownHorizonFinishDate:horizon,
    coverage:{analyzedLeafCount:1,blockedLeafCount:3},
    tasks:{C:{knownHorizonFloat:cFloat}},partialCriticalTaskIds:[...partialIds],
    partialCriticalDependencyIds:[],partialCriticalSummaryIds:[],
  });
  expect(r.diagnostics).toEqual([
    {code:'UNKNOWN_INTERVAL',taskIds:['U'],dependencyIds:[],messageKey:'scheduling.UNKNOWN_INTERVAL'},
    {code:'UNKNOWN_PRECEDENCE',taskIds:['A','U'],dependencyIds:['AU'],messageKey:'scheduling.UNKNOWN_PRECEDENCE'},
    {code:'UNKNOWN_PRECEDENCE',taskIds:['B','U'],dependencyIds:['UB'],messageKey:'scheduling.UNKNOWN_PRECEDENCE'},
  ]);
  expect(r.criticalTaskIds).toEqual([]); expect(r.criticalDependencyIds).toEqual([]);
});

it('P09 conflict plus unknown suppresses all floats and partial IDs', () => {
  const r=calculateSchedule({calendarType:'all-days',tasks:[
    leaf('A','2026-10-05','2026-10-07'),leaf('B','2026-10-07','2026-10-09'),
    leaf('U',null,null) ],dependencies:[edge('AB','A','B'),edge('BU','B','U')]});
  expect(r.analysisStatus).toBe('infeasible');
  if(r.analysisStatus!=='infeasible') throw new Error('Expected infeasible');
  expect(r.coverage).toEqual({knownLeafCount:2,totalLeafCount:3});
  expect(r.tasks.A).toEqual({startDate:'2026-10-05',finishDate:'2026-10-07',
    calendarSpanDays:3,projectFloat:null,constraintFloat:null});
  expect(r.partialAnalysis).toBeNull();
  expect(r.criticalTaskIds).toEqual([]);expect(r.criticalDependencyIds).toEqual([]);
  expect(Object.values(r.tasks).every(t => t.projectFloat===null && t.constraintFloat===null)).toBe(true);
  expect(r.diagnostics).toEqual([
    {code:'EXPLICIT_PRECEDENCE_CONFLICT',taskIds:['A','B'],dependencyIds:['AB'],messageKey:'scheduling.EXPLICIT_PRECEDENCE_CONFLICT'},
    {code:'UNKNOWN_INTERVAL',taskIds:['U'],dependencyIds:[],messageKey:'scheduling.UNKNOWN_INTERVAL'},
    {code:'UNKNOWN_PRECEDENCE',taskIds:['B','U'],dependencyIds:['BU'],messageKey:'scheduling.UNKNOWN_PRECEDENCE'},
  ]);
});

it.each([
  [null,null,3],['2026-10-09',null,3],[null,'2026-10-13',3],
] as const)('P11 keeps %s/%s/%s unknown', (start,finish,duration) => {
  const input:OptionalInput={calendarType:'weekdays',
    tasks:[leaf('U',start,finish,duration)],dependencies:[]};
  expect(toWorkingInterval(input.tasks[0]!,'weekdays')).toBeNull();
  const r=calculateSchedule(input);
  expect(r.analysisStatus).toBe('incomplete');
  if(r.analysisStatus!=='incomplete') throw new Error('Expected incomplete');
  expect(r.tasks.U).toEqual({startDate:null,finishDate:null,calendarSpanDays:null,
    projectFloat:null,constraintFloat:null});
  expect(r.partialAnalysis).toBeNull();expect(r.display).toEqual({});
  expect(input.tasks[0]).toEqual(leaf('U',start,finish,duration));
});
```

### Дополнительные exact boundary/status cases

Все следующие tests обязательны, включая две разновидности P09 (без U и с U). Добавить в тот же test файл:

```ts
it('keeps unknown standalone leaves incomplete and empty project ready', () => {
  const empty=calculateSchedule({calendarType:'weekdays',tasks:[],dependencies:[]});
  expect(empty).toEqual({analysisStatus:'ready',feasibility:'feasible',
    coverage:{knownLeafCount:0,totalLeafCount:0},tasks:{},summaries:{},display:{},
    horizonFinishDate:null,partialAnalysis:null,criticalTaskIds:[],
    criticalDependencyIds:[],diagnostics:[]});
  const unknown=calculateSchedule({calendarType:'all-days',
    tasks:[leaf('U',null,null,null,'done')],dependencies:[]});
  expect(unknown.analysisStatus).toBe('incomplete');
  expect(unknown.tasks.U).toMatchObject({calendarSpanDays:null,projectFloat:null,constraintFloat:null});
});

it('FS can be known while both intervals remain unknown', () => {
  const r=calculateSchedule({calendarType:'weekdays',tasks:[
    leaf('A',null,'2026-10-09'),leaf('B','2026-10-12',null)],
    dependencies:[edge('AB','A','B')]});
  expect(r.analysisStatus).toBe('incomplete');
  expect(r.coverage).toEqual({knownLeafCount:0,totalLeafCount:2});
  expect(r.diagnostics).toEqual([
    {code:'UNKNOWN_INTERVAL',taskIds:['A'],dependencyIds:[],messageKey:'scheduling.UNKNOWN_INTERVAL'},
    {code:'UNKNOWN_INTERVAL',taskIds:['B'],dependencyIds:[],messageKey:'scheduling.UNKNOWN_INTERVAL'},
  ]);
  const conflict=calculateSchedule({calendarType:'weekdays',tasks:[
    leaf('A',null,'2026-10-09'),leaf('B','2026-10-09',null)],
    dependencies:[edge('AB','A','B')]});
  expect(conflict.analysisStatus).toBe('infeasible');
  expect(conflict.criticalTaskIds).toEqual([]);
});

it.each([
  ['calendar-invalid',leaf('U','2026-10-10','2026-10-12'), 'INVALID_INTERVAL'],
  ['duration-mismatch',leaf('U','2026-10-09','2026-10-12',3), 'DURATION_MISMATCH'],
  ['reversed',leaf('U','2026-10-13','2026-10-12'), 'INVALID_INTERVAL'],
] as const)('%s saved source is incomplete without a proved FS conflict', (_name,u,code) => {
  const r=calculateSchedule({calendarType:'weekdays',
    tasks:[u,leaf('C','2026-10-12','2026-10-13')],dependencies:[]});
  expect(r.analysisStatus).toBe('incomplete');
  expect(r.coverage).toEqual({knownLeafCount:1,totalLeafCount:2});
  expect(r.diagnostics).toEqual([{code,taskIds:['U'],dependencyIds:[],
    messageKey:'scheduling.'+code}]);
  if(r.analysisStatus!=='incomplete') throw new Error('Expected incomplete');
  expect(r.partialAnalysis?.tasks).toEqual({C:{knownHorizonFloat:0}});
});

it('known leaves in an entirely blocked graph yield an empty partial set', () => {
  const r=calculateSchedule({calendarType:'all-days',tasks:[
    leaf('A','2026-10-05','2026-10-06'),leaf('U',null,null)],
    dependencies:[edge('AU','A','U')]});
  if(r.analysisStatus!=='incomplete') throw new Error('Expected incomplete');
  expect(r.partialAnalysis).toEqual({
    labelKey:'scheduling.PARTIAL_ANALYSIS',knownHorizonFinishDate:'2026-10-06',
    coverage:{analyzedLeafCount:0,blockedLeafCount:2},tasks:{},
    partialCriticalTaskIds:[],partialCriticalDependencyIds:[],partialCriticalSummaryIds:[],
  });
});

it.each([
  ['all-days',3652059],['weekdays',2608615],
] as const)('%s handles full range without iterating days', (calendarType,span) => {
  const input:OptionalInput={calendarType,
    tasks:[leaf('A','0001-01-01','9999-12-31')],dependencies:[]};
  const r=calculateSchedule(input);
  expect(r.analysisStatus).toBe('ready');
  expect(r.tasks.A).toEqual({startDate:'0001-01-01',finishDate:'9999-12-31',
    calendarSpanDays:span,projectFloat:0,constraintFloat:0});
  if(r.analysisStatus!=='ready') throw new Error('Expected ready');
  expect(r.horizonFinishDate).toBe('9999-12-31');
  expect(r.criticalTaskIds).toEqual(['A']);
  expect(toWorkingInterval(input.tasks[0]!,calendarType,'0001-01-01'))
    .toEqual({s:0,f:span,d:span});
});
it('last representable day does not require a date for exclusive f', () => {
  const r=calculateSchedule({calendarType:'weekdays',
    tasks:[leaf('A','9999-12-31','9999-12-31')],dependencies:[]});
  expect(r.tasks.A).toMatchObject({calendarSpanDays:1,projectFloat:0,constraintFloat:0});
});
it('coordinate translation moves s/f/LS/LF only', () => {
  const f=readyFixtures.find(f => f.id==='N06')!;
  const g0=buildCpmGraph(f.input,'2026-10-05');
  const g1=buildCpmGraph(f.input,'2026-10-20');
  const a0=analyzeDatedGraph(g0,new Set(['A','B','C']),10);
  const a1=analyzeDatedGraph(g1,new Set(['A','B','C']),-5);
  expect(g0.vertices.get('A')).toEqual({id:'A',status:'todo',s:0,f:2,d:2});
  expect(g1.vertices.get('A')).toEqual({id:'A',status:'todo',s:-15,f:-13,d:2});
  expect(a0.values.get('A')).toEqual({LS:7,LF:9,projectFloat:7,constraintFloat:3});
  expect(a1.values.get('A')).toEqual({LS:-8,LF:-6,projectFloat:7,constraintFloat:3});
  expect(a0.criticalTaskIds).toEqual(['C']);expect(a1.criticalTaskIds).toEqual(['C']);
  expect(() => analyzeDatedGraph(g0,new Set(['A']),10))
    .toThrow('INVALID_ANALYSIS_COMPONENT');
});
```

Дополнить exact cases: P09 без U имеет diagnostic только EXPLICIT_PRECEDENCE_CONFLICT; Weekdays nonworking successor start при finish-only predecessor имеет UNKNOWN_INTERVAL обоих плюс INVALID_PRECEDENCE_BOUNDARY(edge AB), никогда ready; проверка all-days пятница→суббота имеет floats 0/0 и edge AB critical. Malformed graph tests используют existing diagnostic IDs перечисленных выше и проверяют no ordinary/partial analysis; не создавать synthetic bypass для production validator.

### Глубокий summary, display и равные пути без перечисления

```ts
it('deep summaries aggregate leaf criticality, never become CPM vertices', () => {
  const parents=Array.from({length:40},(_,i) =>
    leaf('P'+String(i).padStart(2,'0'),null,null,null,'todo',
      i===0?null:'P'+String(i-1).padStart(2,'0')));
  const input:OptionalInput={calendarType:'all-days',tasks:[...parents,
    leaf('A','2026-10-05','2026-10-06',null,'todo','P39'),
    leaf('B','2026-10-07','2026-10-09',null,'todo','P39'),
    leaf('C','2026-10-05','2026-10-14',null,'todo','P39')],
    dependencies:[edge('AB','A','B')]};
  const r=calculateSchedule(input);
  expect(r.criticalTaskIds).toEqual(['C']);
  expect(Object.keys(r.tasks)).toEqual(['A','B','C']);
  for(const p of parents) expect(r.summaries[p.id]).toEqual({
    startDate:'2026-10-05',finishDate:'2026-10-14',calendarSpanDays:10,
    knownLeafCount:3,totalLeafCount:3,containsCritical:true});
  const unknown={...input,tasks:[...input.tasks,
    leaf('U',null,null,3,'todo','P39')]};
  const partial=calculateSchedule(unknown);
  if(partial.analysisStatus!=='incomplete') throw new Error('Expected incomplete');
  for(const p of parents) expect(partial.summaries[p.id]).toEqual({
    startDate:null,finishDate:null,calendarSpanDays:null,
    knownLeafCount:3,totalLeafCount:4,containsCritical:null});
  expect(partial.partialAnalysis?.partialCriticalSummaryIds).toEqual(parents.map(p=>p.id));
  expect(partial.display.U).toEqual({kind:'conditional',startDate:'2026-10-05',
    finishDate:'2026-10-07',clipped:false});
  expect(partial.tasks.U).toMatchObject({startDate:null,finishDate:null,projectFloat:null});
  const noDuration={...unknown,tasks:unknown.tasks.map(t => t.id==='U'?{...t,durationDays:null}:t)};
  const oneDay=calculateSchedule(noDuration);
  expect(oneDay.analysisStatus).toBe('incomplete');
  expect(oneDay.criticalTaskIds).toEqual([]);
  if(oneDay.analysisStatus!=='incomplete') throw new Error('Expected incomplete');
  expect(oneDay.partialAnalysis).toEqual(partial.partialAnalysis);
  expect(oneDay.display.U).toEqual({kind:'conditional',startDate:'2026-10-05',
    finishDate:'2026-10-05',clipped:false});
});

it('10000-level hierarchy is iterative and ignores parent source values', () => {
  const tasks=Array.from({length:10000},(_,i) =>
    leaf('P'+String(i).padStart(5,'0'),'2026-10-01','2026-10-31',31,'todo',
      i===0?null:'P'+String(i-1).padStart(5,'0')));
  tasks.push(leaf('A','2026-10-05','2026-10-05',null,'todo','P09999'));
  const r=calculateSchedule({calendarType:'all-days',tasks,dependencies:[]});
  expect(r.coverage).toEqual({knownLeafCount:1,totalLeafCount:1});
  expect(r.criticalTaskIds).toEqual(['A']);
  expect(Object.keys(r.summaries)).toHaveLength(10000);
  expect(r.summaries.P00000).toEqual({startDate:'2026-10-05',finishDate:'2026-10-05',
    calendarSpanDays:1,knownLeafCount:1,totalLeafCount:1,containsCritical:true});
});

// 30 two-vertex layers represent 2^30 equal combinations; output is only sets.
// Literal dates repeat twice per layer; no production calendar/solver helper.
it('returns all equal critical IDs in O(V+E) space', () => {
  const dates=['01','02','03','04','05','06','07','08','09','10','11','12','13','14','15',
    '16','17','18','19','20','21','22','23','24','25','26','27','28','29','30'];
  const tasks=dates.flatMap((day,i)=>['a','b'].map(suffix=>
    leaf('L'+String(i).padStart(2,'0')+suffix,'2026-10-'+day,'2026-10-'+day)));
  const dependencies=dates.slice(1).flatMap((_day,i)=>['a','b'].flatMap(from=>
    ['a','b'].map(to=>edge('E'+String(i).padStart(2,'0')+from+to,
      'L'+String(i).padStart(2,'0')+from,'L'+String(i+1).padStart(2,'0')+to))));
  const r=calculateSchedule({calendarType:'all-days',tasks,dependencies});
  expect(r.analysisStatus).toBe('ready');
  expect(r.criticalTaskIds).toEqual(tasks.map(t=>t.id));
  expect(r.criticalDependencyIds).toEqual(dependencies.map(e=>e.id));
  expect(r.criticalTaskIds).toHaveLength(60);
  expect(r.criticalDependencyIds).toHaveLength(116);
  expect(Object.values(r.tasks).every(t=>t.projectFloat===0 && t.constraintFloat===0)).toBe(true);
});
```

Дополнить deep mutation: в 40-level fixture изменить C.finish с14 на8 октября, A/B становятся global critical, все 40 summary ranges=5–9 октября и containsCritical=true; coverage 3/3, floats A/B=0/0,C=1/1, criticalTaskIds=['A','B'], criticalDependencyIds=['AB']. Одна undo в storage test восстанавливает предыдущую C-critical картину целиком. Summary с FS-conflict сохраняет полный реальный range, containsCritical=null; дерево не создаёт новых edges.

### Независимое исполнение численного oracle

После добавления literal fixture helper следующий command проверяет ready expected методом полного перебора допустимых **задержек** малых случаев. Он не импортирует production solver/calendar и не повторяет backward pass. Для projectFloat done остаётся в структурном анализе; отдельно local float done=0. UTC Date используется только этим малым synthetic oracle, не domain арифметикой.

```sh
node --import tsx --input-type=module <<'JS'
import assert from 'node:assert/strict';
import { readyFixtures } from './tests/helpers/explicit-cpm-fixtures.ts';
const civil = s => Date.parse(s+'T00:00:00.000Z')/86400000;
const base = civil('2026-10-05');
const position = (s,cal) => {
  const target = civil(s);
  if(cal==='all-days') return target-base;
  let n=0;
  for(let d=base;d<target;d++) {
    const wd=new Date(d*86400000).getUTCDay();
    if(wd!==0 && wd!==6) n++;
  }
  return n;
};
for(const fixture of readyFixtures) {
  const {input}=fixture;
  const work=input.tasks.map(t=>({id:t.id,status:t.status,
    s:position(t.inputStart,input.calendarType),
    f:position(t.inputFinish,input.calendarType)+1}));
  const H=Math.max(...work.map(t=>t.f));
  const chosen=new Map(), max=new Map(work.map(t=>[t.id,t.s]));
  let solutions=0;
  function visit(i) {
    if(i===work.length) {
      if(input.dependencies.some(e=> {
        const p=work.find(t=>t.id===e.predecessorId);
        return chosen.get(p.id)+p.f-p.s>chosen.get(e.successorId);
      })) return;
      solutions++;
      for(const t of work) max.set(t.id,Math.max(max.get(t.id),chosen.get(t.id)));
      return;
    }
    const t=work[i];
    for(let s=t.s;s+(t.f-t.s)<=H;s++) {chosen.set(t.id,s);visit(i+1);}
  }
  visit(0); assert.ok(solutions>0,fixture.id);
  const values=work.map(t=> {
    const gaps=input.dependencies.filter(e=>e.predecessorId===t.id)
      .map(e=>work.find(v=>v.id===e.successorId).s-t.f);
    return [t.id,max.get(t.id)-t.s,t.status==='done'?0:Math.min(H-t.f,...gaps)];
  }).sort();
  assert.deepEqual(values,fixture.floats,fixture.id);
  const critical=values.filter(v=>v[1]===0).map(v=>v[0]);
  const edges=input.dependencies.filter(e=>critical.includes(e.predecessorId) &&
    critical.includes(e.successorId) &&
    work.find(t=>t.id===e.predecessorId).f===work.find(t=>t.id===e.successorId).s)
    .map(e=>e.id).sort();
  assert.deepEqual(critical,fixture.critical,fixture.id);
  assert.deepEqual(edges,fixture.criticalEdges,fixture.id);
  assert.equal(position(fixture.horizon,input.calendarType)+1,H,fixture.id);
}
console.log('Independent small-fixture enumeration passed: '+readyFixtures.length+' cases');
JS
```

Это не acceptance test существующего приложения. Пока helper не существует, author/reviewer может извлечь **только первый fixture TypeScript block** в disposable temp файл, удалить его type-only import и импортировать этот файл в команду; не создавать application files до implementation gate. Extreme counts отдельно проверяются независимым proleptic Gregorian oracle: all-days=3652059; weekdays=521722*5+5=2608615.

## Exact pure function implementation tasks

### Task A: Strict result union и frozen parsing

**Files:** Modify `src/shared/contracts.ts`, `src/domain/scheduling-types.ts`; create `tests/explicit-cpm-contracts.test.ts`; modify `package.json` unit list.

**Interfaces:** Consumes exact Task 5 schemas/input. Produces полный strict DTO/aliases выше. `OptionalResult` включает frozen; `LiveResult` не включает frozen. Все consumers должны сузить `analysisStatus` прежде, чем читать floats/partial/horizon.

- [ ] **Step 1: Write RED strict parser tests.** В новый test file записать следующий literal fixture и tests. Он не вызывает scheduling.

```ts
import { expect, it } from 'vitest';
import { frozenPendingScheduleV2Schema, scheduleResultV2Schema,
  liveScheduleResultV2Schema, type ScheduleResultV2,
  type LiveScheduleResultV2 } from '../src/shared/contracts.js';
import type { OptionalResult, LiveResult } from '../src/domain/scheduling-types.js';
const A='22222222-2222-4222-8222-222222222222';
const U='22222222-2222-4222-8222-222222222223';
const pending={
  analysisStatus:'pending-policy',feasibility:'feasible',
  coverage:{knownLeafCount:1,totalLeafCount:2},
  tasks:{
    [A]:{startDate:'2026-10-05',finishDate:'2026-10-06',calendarSpanDays:2},
    [U]:{startDate:null,finishDate:null,calendarSpanDays:null}},
  summaries:{},display:{},criticalTaskIds:[],criticalDependencyIds:[],diagnostics:[],
};
const ready={
  analysisStatus:'ready',feasibility:'feasible',
  coverage:{knownLeafCount:1,totalLeafCount:1},
  tasks:{[A]:{startDate:'2026-10-05',finishDate:'2026-10-06',calendarSpanDays:2,
    projectFloat:0,constraintFloat:0}},summaries:{},display:{},
  horizonFinishDate:'2026-10-06',partialAnalysis:null,
  criticalTaskIds:[A],criticalDependencyIds:[],diagnostics:[],
};
const incomplete={
  analysisStatus:'incomplete',feasibility:'incomplete',
  coverage:{knownLeafCount:1,totalLeafCount:2},
  tasks:{
    [A]:{startDate:'2026-10-05',finishDate:'2026-10-06',calendarSpanDays:2,
      projectFloat:null,constraintFloat:null},
    [U]:{startDate:null,finishDate:null,calendarSpanDays:null,
      projectFloat:null,constraintFloat:null}},
  summaries:{},display:{},horizonFinishDate:null,
  criticalTaskIds:[],criticalDependencyIds:[],diagnostics:[],
  partialAnalysis:{labelKey:'scheduling.PARTIAL_ANALYSIS',
    knownHorizonFinishDate:'2026-10-06',coverage:{analyzedLeafCount:1,blockedLeafCount:1},
    tasks:{[A]:{knownHorizonFloat:0}},partialCriticalTaskIds:[A],
    partialCriticalDependencyIds:[],partialCriticalSummaryIds:[]},
};
it('preserves exact frozen pending and admits only live forms to the live parser',()=>{
  const domain:OptionalResult=scheduleResultV2Schema.parse(pending);
  const shared:ScheduleResultV2=domain;
  expect(shared).toEqual(pending);
  expect(frozenPendingScheduleV2Schema.parse(pending)).toEqual(pending);
  expect(liveScheduleResultV2Schema.safeParse(pending).success).toBe(false);
  const live:LiveResult=liveScheduleResultV2Schema.parse(ready);
  const assignment:LiveScheduleResultV2=live;
  expect(assignment).toEqual(ready);
  expect(scheduleResultV2Schema.parse(incomplete)).toEqual(incomplete);
});
it.each([
  {...pending,horizonFinishDate:null},
  {...ready,deadline:'2026-10-20'},
  {...ready,originDate:'2026-10-05'},
  {...ready,criticalTaskIds:[A,A]},
  {...ready,tasks:{[A]:{...ready.tasks[A],projectFloat:-1}}},
  {...incomplete,criticalTaskIds:[A]},
  {...incomplete,tasks:{...incomplete.tasks,[A]:{...incomplete.tasks[A],projectFloat:0}}},
  {...incomplete,partialAnalysis:{...incomplete.partialAnalysis,
    tasks:{[A]:{knownHorizonFloat:0,projectFloat:0}}}},
  {...incomplete,analysisStatus:'infeasible',feasibility:'infeasible'},
])('rejects cross-status/unknown fields',value=>{
  expect(scheduleResultV2Schema.safeParse(value).success).toBe(false);
});
it('infeasible strictly suppresses partial and accepts null ordinary floats',()=>{
  const value={...incomplete,analysisStatus:'infeasible',feasibility:'infeasible',
    partialAnalysis:null};
  expect(scheduleResultV2Schema.parse(value)).toEqual(value);
});
```

Дополнить rejected record keys malformed UUID, summary containsCritical=true в incomplete, null ready float, partial count mismatch, partial critical unknown ID, removed legacy fields inside project/task/commands; command strict forms из Task 5 уже должны отклонять их. Не превращать frozen pending с feasibility=feasible/coverage1/2 в новый incomplete.

- [ ] **Step 2: Run RED.** `npm test -- tests/explicit-cpm-contracts.test.ts`: FAIL missing exports/ready union; конкретные strict cases падают до реализации.
- [ ] **Step 3: Install complete schema/type block из раздела контракта.** Сохранить исходный pending schema побайтово по полям/validators; new schema aliases не влияют на source patch. Под exactOptionalPropertyTypes source patch передаёт лишь определённые присутствующие значения: `if (changes.inputStart !== undefined) patch.inputStart = changes.inputStart`; аналогично finish/duration. Не добавлять explicit undefined и unsafe cast.
- [ ] **Step 4: Run GREEN.** `npm test -- tests/explicit-cpm-contracts.test.ts`; `npm run typecheck`; `npm run lint`. Обновить existing Task 5 consumers type narrowing, frozen fixtures не украшать новыми полями.
- [ ] **Step 5: Commit.** `git add -- src/shared/contracts.ts src/domain/scheduling-types.ts tests/explicit-cpm-contracts.test.ts package.json`; `npm run security:staged`; `git diff --cached --check`; `git commit -m 'feat: define strict explicit-date analysis results'`. Два independent reviews этого scoped SHA.

### Task B: Чистый граф, координата и backward pass

**Files:** Create `src/domain/explicit-cpm.ts`, `tests/helpers/explicit-cpm-fixtures.ts`, `tests/explicit-cpm.test.ts`; modify unit list in `package.json`.

**Interfaces:** Consumes OptionalInput/SourceFields/realInterval/calendar funcs. Produces `toWorkingInterval`, `buildCpmGraph`, `analyzeDatedGraph`, `analyzeExplicitDates` exact signatures выше. No SQL/UI/legacy dependency.

- [ ] **Step 1: Write RED.** Скопировать полную ready/partial numerical matrix и domain tests выше; для алгоритма прямые `buildCpmGraph/analyzeDatedGraph` tests дают RED независимо от интеграции calculateSchedule.
- [ ] **Step 2: Run RED.** `npm test -- tests/explicit-cpm.test.ts`: FAIL missing module/exports, затем конкретные N06/fork/gap assertions.
- [ ] **Step 3: Add coordinate and graph pass.** Использовать показанный toWorkingInterval и следующий complete graph builder. Imports: types из scheduling-types, `SourceFields` из shared/contracts, `realInterval` из planning, `dateToIndex/indexToDate` из calendar.

```ts
export function buildCpmGraph(input: OptionalInput, originDate='0001-01-01'): CpmGraph {
  const parents=new Set(input.tasks.flatMap(t=>t.parentId===null?[]:[t.parentId]));
  const leaves=input.tasks.filter(t=>!parents.has(t.id)).toSorted((a,b)=>a.id<b.id?-1:a.id>b.id?1:0);
  const leafIds=leaves.map(t=>t.id);
  const vertices=new Map<string,CpmVertex>();
  for(const t of leaves) {
    const w=toWorkingInterval(t,input.calendarType,originDate);
    if(w) vertices.set(t.id,{id:t.id,status:t.status,...w});
  }
  const dependencies=[...input.dependencies].sort((a,b)=>a.id<b.id?-1:a.id>b.id?1:0);
  const outgoing=new Map(leafIds.map(id=>[id,[] as string[]]));
  const neighbors=new Map(leafIds.map(id=>[id,[] as string[]]));
  const indegree=new Map(leafIds.map(id=>[id,0]));
  for(const e of dependencies) {
    if(!outgoing.has(e.predecessorId)||!outgoing.has(e.successorId))
      throw new RangeError('INVALID_ANALYSIS_GRAPH');
    outgoing.get(e.predecessorId)!.push(e.successorId);
    neighbors.get(e.predecessorId)!.push(e.successorId);
    neighbors.get(e.successorId)!.push(e.predecessorId);
    indegree.set(e.successorId,indegree.get(e.successorId)!+1);
  }
  const topoIds=leafIds.filter(id=>indegree.get(id)===0);
  for(let i=0;i<topoIds.length;i++) {
    for(const next of outgoing.get(topoIds[i]!)!) {
      const n=indegree.get(next)!-1; indegree.set(next,n);
      if(n===0) topoIds.push(next);
    }
  }
  if(topoIds.length!==leafIds.length) throw new RangeError('INVALID_ANALYSIS_GRAPH');
  const visited=new Set<string>(),weakComponents:string[][]=[];
  for(const id of leafIds) {
    if(visited.has(id)) continue;
    const queue=[id];visited.add(id);
    for(let i=0;i<queue.length;i++)
      for(const next of neighbors.get(queue[i]!)!)
        if(!visited.has(next)){visited.add(next);queue.push(next);}
    weakComponents.push(queue.sort());
  }
  return {vertices,leafIds,dependencies,topoIds,weakComponents,originDate,
    calendarType:input.calendarType};
}
export function analyzeDatedGraph(
  graph:CpmGraph,analyzedIds:ReadonlySet<string>,horizon:number|null,
):BackwardAnalysis {
  const values=new Map<string,BackwardValue>();
  if(horizon===null) {
    if(analyzedIds.size) throw new RangeError('INVALID_ANALYSIS_COMPONENT');
    return {horizon,values,criticalTaskIds:[],criticalDependencyIds:[]};
  }
  if(!Number.isSafeInteger(horizon)) throw new RangeError('INVALID_ANALYSIS_HORIZON');
  for(const id of analyzedIds)
    if(!graph.vertices.has(id)) throw new RangeError('INVALID_ANALYSIS_COMPONENT');
  const outgoing=new Map([...analyzedIds].map(id=>[id,[] as string[]]));
  for(const e of graph.dependencies) {
    const p=analyzedIds.has(e.predecessorId),s=analyzedIds.has(e.successorId);
    if(p!==s) throw new RangeError('INVALID_ANALYSIS_COMPONENT');
    if(p) outgoing.get(e.predecessorId)!.push(e.successorId);
  }
  for(let i=graph.topoIds.length-1;i>=0;i--) {
    const id=graph.topoIds[i]!;
    if(!analyzedIds.has(id)) continue;
    const v=graph.vertices.get(id)!, successors=outgoing.get(id)!;
    let LF=horizon, constraintFloat=horizon-v.f;
    for(const next of successors) {
      const later=values.get(next);
      if(!later) throw new RangeError('INVALID_ANALYSIS_GRAPH');
      LF=Math.min(LF,later.LS);
      constraintFloat=Math.min(constraintFloat,graph.vertices.get(next)!.s-v.f);
    }
    const LS=LF-v.d,projectFloat=LS-v.s;
    if(v.status==='done') constraintFloat=0;
    if(projectFloat<0||constraintFloat<0||constraintFloat>projectFloat)
      throw new RangeError('INVALID_ANALYSIS_FLOAT');
    values.set(id,{LS,LF,projectFloat,constraintFloat});
  }
  const criticalTaskIds=[...values].filter(([,v])=>v.projectFloat===0)
    .map(([id])=>id).sort();
  const criticalDependencyIds=graph.dependencies.filter(e=>
    values.get(e.predecessorId)?.projectFloat===0 &&
    values.get(e.successorId)?.projectFloat===0 &&
    graph.vertices.get(e.predecessorId)!.f===graph.vertices.get(e.successorId)!.s)
    .map(e=>e.id).sort();
  return {horizon,values,criticalTaskIds,criticalDependencyIds};
}
```

Обратный pass не вычисляет earliest и не нормализует даты. Для analyzedIds пусто при известном H возвращает пустые values/IDs; это допустимый partial case. All known/blocked distinction реализуется в Task C composition, не вырезанием неизвестных из графа.

- [ ] **Step 4: Run independent oracle и GREEN.** Execute oracle command выше; `npm test -- tests/explicit-cpm.test.ts` после composition Task C. До C прямые graph/coordinate/backward tests должны быть GREEN, full wrapper tests закономерно RED; не коммитить RED branch как finished deliverable. Tasks B/C выполняет один worker до общего commit ниже.

### Task C: Live composition поверх реальной проекции

**Files:** Modify `src/domain/scheduling.ts`, `src/domain/explicit-cpm.ts`; tests из B. B/C — один testable deliverable и один writer/commit.

**Interfaces:** Consumes `projectExplicitSchedule(input): ExplicitProjection`, B graph/backward functions. Produces единственный `calculateSchedule(input): LiveResult`. Source/date/display maps сохраняют семантику Task 5; projection не является вторым выбираемым scheduler.

- [ ] **Step 1: Add summary/display/invalid/conflict tests выше.** Run `npm test -- tests/explicit-cpm.test.ts`: RED на pending status/ordinary floats/partial sets.
- [ ] **Step 2: Extract projection without changing real/display values.** Existing Task 5 body `calculateSchedule` переименовать в `projectExplicitSchedule`, удалить pending-only fields из return object. Исправить saved invalid severity и ранний выход: unknown/invalid source не должен останавливать FS проверки остальных edges. У source diagnostics exact codes `UNKNOWN_INTERVAL`/`INVALID_INTERVAL`/`DURATION_MISMATCH`; у FS `UNKNOWN_PRECEDENCE`/`INVALID_PRECEDENCE_BOUNDARY`/`EXPLICIT_PRECEDENCE_CONFLICT`. Полный graph invalid по-прежнему fail closed.

```ts
// scheduling.ts
import { analyzeExplicitDates } from './explicit-cpm.js';
export function calculateSchedule(input: OptionalInput): LiveResult {
  return analyzeExplicitDates(input, projectExplicitSchedule(input));
}
// Existing projectExplicitSchedule body computes real, summary, display and
// all source/FS diagnostics only; no floats or critical IDs.
```

- [ ] **Step 3: Add complete result composition.** В `explicit-cpm.ts` импортировать `validateSourceInput`/`realInterval` из planning и DomainError из tree. Следующий код добавляется после graph/backward functions. Он нормализует unknown diagnostics без подавления доказанного конфликта; strict parsing остаётся на server boundary, потому что pure domain tests допускают symbolic IDs.

```ts
const graphErrors=new Set(['DUPLICATE_TASK_ID','INVALID_PARENT','TREE_CYCLE',
  'DUPLICATE_DEPENDENCY_ID','DEPENDENCY_TASK_NOT_FOUND','SELF_DEPENDENCY',
  'DEPENDENCY_REQUIRES_LEAVES','DUPLICATE_DEPENDENCY','DEPENDENCY_CYCLE',
  'INVALID_PROJECT_CALENDAR']);
function criticalSummaryIds(input:OptionalInput,criticalIds:readonly string[]):string[] {
  const map=new Map(input.tasks.map(t=>[t.id,t]));
  const counts=new Map(input.tasks.map(t=>[t.id,0]));
  for(const t of input.tasks) if(t.parentId!==null && counts.has(t.parentId))
    counts.set(t.parentId,counts.get(t.parentId)!+1);
  const isSummary=new Set([...counts].filter(([,n])=>n>0).map(([id])=>id));
  const flagged=new Set(criticalIds);
  const queue=[...counts].filter(([,n])=>n===0).map(([id])=>id);
  for(let i=0;i<queue.length;i++) {
    const id=queue[i]!, parent=map.get(id)!.parentId;
    if(parent===null||!counts.has(parent)) continue;
    if(flagged.has(id)) flagged.add(parent);
    const n=counts.get(parent)!-1;counts.set(parent,n);
    if(n===0) queue.push(parent);
  }
  return [...isSummary].filter(id=>flagged.has(id)).sort();
}
export function analyzeExplicitDates(
  input:OptionalInput,projection:ExplicitProjection,originDate='0001-01-01',
):LiveResult {
  const taskById=new Map(input.tasks.map(t=>[t.id,t]));
  const diagnostics=projection.diagnostics.map(d=>({
    ...d,taskIds:[...d.taskIds].sort(),dependencyIds:[...d.dependencyIds].sort(),
  }));
  const add=(code:string,id:string) => {
    if(!diagnostics.some(d=>d.code===code&&d.taskIds.length===1&&d.taskIds[0]===id&&d.dependencyIds.length===0))
      diagnostics.push({code,taskIds:[id],dependencyIds:[],messageKey:'scheduling.'+code});
  };
  for(const id of Object.keys(projection.tasks).sort()) {
    const t=taskById.get(id)!;
    if(realInterval(t,input.calendarType)!==null) continue;
    if(t.inputStart===null||t.inputFinish===null) add('UNKNOWN_INTERVAL',id);
    else {
      try { validateSourceInput(t,input.calendarType); }
      catch(error) {
        add(error instanceof DomainError && error.code==='DURATION_MISMATCH' ?
          'DURATION_MISMATCH':'INVALID_INTERVAL',id);
      }
    }
  }
  diagnostics.sort((a,b)=>a.code<b.code?-1:a.code>b.code?1:
    JSON.stringify(a.taskIds)<JSON.stringify(b.taskIds)?-1:
    JSON.stringify(a.taskIds)>JSON.stringify(b.taskIds)?1:
    JSON.stringify(a.dependencyIds)<JSON.stringify(b.dependencyIds)?-1:
    JSON.stringify(a.dependencyIds)>JSON.stringify(b.dependencyIds)?1:0);
  const tasks=Object.fromEntries(Object.entries(projection.tasks).map(([id,t])=>
    [id,{...t,projectFloat:null,constraintFloat:null}]));
  const summaries=Object.fromEntries(Object.entries(projection.summaries).map(([id,s])=>
    [id,{...s,containsCritical:null}]));
  const common={coverage:projection.coverage,display:projection.display,diagnostics};
  if(diagnostics.some(d=>graphErrors.has(d.code)||d.code==='EXPLICIT_PRECEDENCE_CONFLICT'))
    return {...common,analysisStatus:'infeasible',feasibility:'infeasible',
      tasks,summaries,horizonFinishDate:null,partialAnalysis:null,
      criticalTaskIds:[],criticalDependencyIds:[]};
  const graph=buildCpmGraph(input,originDate);
  let H:number|null=null;
  for(const v of graph.vertices.values()) H=H===null?v.f:Math.max(H,v.f);
  const complete=graph.vertices.size===graph.leafIds.length;
  if(!complete) {
    const analyzedIds=new Set(graph.weakComponents
      .filter(component=>component.every(id=>graph.vertices.has(id))).flat());
    const a=analyzeDatedGraph(graph,analyzedIds,H);
    return {...common,analysisStatus:'incomplete',feasibility:'incomplete',
      tasks,summaries,horizonFinishDate:null,criticalTaskIds:[],criticalDependencyIds:[],
      partialAnalysis:H===null?null:{
        labelKey:'scheduling.PARTIAL_ANALYSIS',
        knownHorizonFinishDate:indexToDate(H-1,originDate,input.calendarType),
        coverage:{analyzedLeafCount:analyzedIds.size,blockedLeafCount:graph.leafIds.length-analyzedIds.size},
        tasks:Object.fromEntries([...a.values].sort(([a],[b])=>a<b?-1:a>b?1:0)
          .map(([id,v])=>[id,{knownHorizonFloat:v.projectFloat}])),
        partialCriticalTaskIds:a.criticalTaskIds,partialCriticalDependencyIds:a.criticalDependencyIds,
        partialCriticalSummaryIds:criticalSummaryIds(input,a.criticalTaskIds),
      }};
  }
  const a=analyzeDatedGraph(graph,new Set(graph.leafIds),H);
  const criticalSummaries=new Set(criticalSummaryIds(input,a.criticalTaskIds));
  const readyTasks=Object.fromEntries(graph.leafIds.map(id=>{
    const real=realInterval(taskById.get(id)!,input.calendarType);
    if(real===null) throw new RangeError('INVALID_ANALYSIS_INTERVAL');
    const v=a.values.get(id)!;
    return [id,{...real,projectFloat:v.projectFloat,constraintFloat:v.constraintFloat}];
  }));
  const readySummaries=Object.fromEntries(Object.entries(projection.summaries).map(([id,s])=>{
    const {startDate,finishDate,calendarSpanDays}=s;
    if(startDate===null||finishDate===null||calendarSpanDays===null)
      throw new RangeError('INVALID_ANALYSIS_SUMMARY');
    return [id,{...s,startDate,finishDate,calendarSpanDays,containsCritical:criticalSummaries.has(id)}];
  }));
  return {...common,analysisStatus:'ready',feasibility:'feasible',
    tasks:readyTasks,summaries:readySummaries,
    horizonFinishDate:H===null?null:indexToDate(H-1,originDate,input.calendarType),
    partialAnalysis:null,criticalTaskIds:a.criticalTaskIds,criticalDependencyIds:a.criticalDependencyIds};
}
```

Projection must emit exactly one source diagnostic per unknown/invalid leaf. It must never add UNKNOWN_INTERVAL alongside INVALID_INTERVAL/DURATION_MISMATCH for the same full invalid pair. The constructor's add deduplicates same diagnosis; copy diagnostic sort keys use ordinal string comparison. Legacy-specific saved diagnosis can coexist but never supplies a real interval. A partial missing pair retaining finish-only source is unknown even if display is known.

- [ ] **Step 4: Run GREEN.** `npm test -- tests/explicit-cpm-contracts.test.ts tests/explicit-cpm.test.ts tests/calendar.test.ts tests/optional-scheduling.test.ts`; after Task 5 suite name is still `optional-scheduling.test.ts` unless integrator moved it explicitly. Then `npm run typecheck`, `npm run lint`, `npm run test:unit` and independent oracle. No skip/empty suites.
- [ ] **Step 5: Commit B/C together.** Stage `src/domain/explicit-cpm.ts`, `src/domain/scheduling.ts`, fixture/tests and package unit list; staged guard/Gitleaks and normal hooks; commit `feat: analyze explicit task intervals and partial components`. Two independent reviews of this SHA include literal floats/IDs/diagnostics, immutability, complexity and negative-origin invariance.

### Task D: Atomic server result, undo, restart и frozen retry

**Files:** Modify `src/server/repository.ts`, `tests/scheduling-api.test.ts`, `tests/optional-migration.test.ts`; create `tests/explicit-cpm-repository.test.ts`; modify integration list in `package.json`.

**Interfaces:** Consumes Task 5 Repository: `createProject(title): Project`, `getTree(projectId,sessionId): ProjectTreeV2`, `applyCommand(projectId,CommandEnvelopeV2,sessionId): ProjectTreeV2`, `replayLegacy(projectId,body:unknown,sessionId): ProjectTreeV2` and `openDatabase(path)` for newly created/schema3 synthetic DB. Existing `change` transaction parses response before commit and caches exact result. Command body/header contract remains V2.

- [ ] **Step 1: Write independently expected P04→P05→undo→restart test.** Новый test file целиком создаёт disposable DB; не читает application runtime. Exact task/dependency IDs создаёт Repository; ожидаемые множества берутся по literal titles/from-to mapping, не из calculator.

```ts
import {afterEach,beforeEach,expect,it,vi} from 'vitest';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {randomUUID,createHash} from 'node:crypto';
import {openDatabase} from '../src/server/database.js';
import {Repository} from '../src/server/repository.js';
import * as scheduling from '../src/domain/scheduling.js';
import {projectTreeV2Schema,type ProjectTreeV2,type CommandV2} from '../src/shared/contracts.js';
let directory:string,path:string,db:ReturnType<typeof openDatabase>,repository:Repository;
const session='synthetic-explicit-cpm-session';
beforeEach(()=>{
  directory=mkdtempSync(join(tmpdir(),'leaf-explicit-cpm-'));
  path=join(directory,'synthetic.sqlite');db=openDatabase(path);repository=new Repository(db);
});
afterEach(()=>{
  vi.restoreAllMocks();if(db.open) db.close();rmSync(directory,{recursive:true,force:true});
});
function step(tree:ProjectTreeV2,command:CommandV2):ProjectTreeV2 {
  return repository.applyCommand(tree.project.id,{
    contractVersion:2,expectedRevision:tree.project.revision,operationId:randomUUID(),command,
  },session);
}
function ids(tree:ProjectTreeV2) {
  return Object.fromEntries(tree.tasks.map(t=>[t.title,t.id]));
}
function p04():ProjectTreeV2 {
  const p=repository.createProject('Synthetic explicit CPM');
  let t=repository.getTree(p.id,session);
  t=step(t,{type:'project.schedule',changes:{calendarType:'all-days'}});
  for(const title of ['A','B','C','D']) t=step(t,{type:'task.create',title,parentId:null});
  const by=ids(t);
  for(const [title,inputStart,inputFinish] of [
    ['A','2026-10-05','2026-10-06'],['B','2026-10-07','2026-10-09'],
    ['C','2026-10-05','2026-10-07'],['D','2026-10-08','2026-10-09'],
  ] as const) t=step(t,{type:'task.edit',taskId:by[title]!,changes:{inputStart,inputFinish}});
  for(const [from,to] of [['A','B'],['C','D']] as const)
    t=step(t,{type:'dependency.create',predecessorId:by[from]!,successorId:by[to]!});
  return t;
}
function assertFloats(tree:ProjectTreeV2,expected:[string,number,number][]) {
  if(tree.schedule.analysisStatus!=='ready') throw new Error('Expected ready');
  const by=ids(tree),s=tree.schedule;
  expect(expected.map(([name])=>by[name])).not.toContain(undefined);
  for(const [name,projectFloat,constraintFloat] of expected)
    expect(s.tasks[by[name]!]).toMatchObject({projectFloat,constraintFloat});
}
it('P04/P05 changes critical branch, retries exact outcome, undoes once and survives restart',()=>{
  const before=p04(),by=ids(before);
  assertFloats(before,[['A',0,0],['B',0,0],['C',0,0],['D',0,0]]);
  const envelope={contractVersion:2 as const,expectedRevision:before.project.revision,
    operationId:randomUUID(),command:{type:'task.edit' as const,taskId:by.B!,
      changes:{inputFinish:'2026-10-11'}}};
  const after=repository.applyCommand(before.project.id,envelope,session);
  expect(after.project.revision).toBe(before.project.revision+1);
  assertFloats(after,[['A',0,0],['B',0,0],['C',2,0],['D',2,2]]);
  expect(after.schedule.criticalTaskIds).toEqual([by.A!,by.B!].sort());
  const ab=after.dependencies.find(e=>e.predecessorId===by.A&&e.successorId===by.B)!.id;
  expect(after.schedule.criticalDependencyIds).toEqual([ab]);
  const undone=step(after,{type:'undo'});
  expect(undone.tasks).toEqual(before.tasks);
  expect(undone.dependencies).toEqual(before.dependencies);
  expect(undone.schedule).toEqual(before.schedule);
  const latestRevision=undone.project.revision;
  db.close();db=openDatabase(path);repository=new Repository(db);
  expect(repository.getTree(before.project.id,session).schedule).toEqual(before.schedule);
  const spy=vi.spyOn(scheduling,'calculateSchedule');
  const replay=repository.applyCommand(before.project.id,envelope,session);
  expect(replay).toEqual(after);expect(replay.project.revision).toBe(before.project.revision+1);
  expect(spy).not.toHaveBeenCalled();
  expect(repository.getTree(before.project.id,session).project.revision).toBe(latestRevision);
});
it('frozen pending target reply survives CPM wiring and restart unchanged',()=>{
  const before=p04(),by=ids(before),operationId=randomUUID();
  const envelope={contractVersion:2 as const,expectedRevision:before.project.revision,
    operationId,command:{type:'task.edit' as const,taskId:by.A!,changes:{title:'A saved'}}};
  const response=repository.applyCommand(before.project.id,envelope,session);
  // Synthetic existing Task5 operation: literal pending projection, exact stored JSON.
  const real=Object.fromEntries(response.tasks.map(t=>[t.id,{
    startDate:t.inputStart,finishDate:t.inputFinish,
    calendarSpanDays:t.title==='A saved'?2:t.title==='B'?3:t.title==='C'?3:2,
  }]));
  const frozen=projectTreeV2Schema.parse({...response,schedule:{
    analysisStatus:'pending-policy',feasibility:'feasible',
    coverage:{knownLeafCount:4,totalLeafCount:4},tasks:real,summaries:{},display:{},
    criticalTaskIds:[],criticalDependencyIds:[],diagnostics:[],
  }});
  const frozenText=JSON.stringify(frozen);
  const digest=createHash('sha256').update(frozenText).digest('hex');
  db.prepare('UPDATE operations SET response=?,responseSha256=? WHERE operationId=?')
    .run(frozenText,digest,operationId);
  const changed=step(response,{type:'task.edit',taskId:by.B!,changes:{inputFinish:'2026-10-11'}});
  db.close();db=openDatabase(path);repository=new Repository(db);
  const spy=vi.spyOn(scheduling,'calculateSchedule');
  const replay=repository.applyCommand(before.project.id,envelope,session);
  expect(replay).toEqual(frozen);expect(replay.schedule.analysisStatus).toBe('pending-policy');
  expect(spy).not.toHaveBeenCalled();
  const stored=db.prepare('SELECT response FROM operations WHERE operationId=?').get(operationId) as {response:string};
  expect(stored.response).toBe(frozenText);
  expect(repository.getTree(before.project.id,session).project.revision).toBe(changed.project.revision);
});
```

DTO parser проверяет strict response fields before commit, а cached parse принимает union без solver; update synthetic operation не меняет payload/archive и выполняется только в собственном test DB.

Добавить failure injection как literal typed invalid live result, вызывая `vi.spyOn(scheduling,'calculateSchedule').mockReturnValueOnce`: result infeasible с `partialAnalysis` object запрещённым strict schema. Перед вызовом сохранить `getTree` и counts tasks/dependencies/operations/undo_snapshots/revision; `task.edit` title+source должен бросить safe500 и полностью восстановить все counts/source/title/revision. Inject typed invalid через `unknown` допускается только test assertion boundary для simulation invalid internal response, не application cast. Добавить done test N06: изменение source done отклонено; status doing+finish в одном envelope меняет constraint float, undo возвращает done исходную pair; не материализует дату unknown done.

- [ ] **Step 2: Add HTTP tests.** В existing `tests/scheduling-api.test.ts` Task 5 `headers()` уже содержит X-Leaf-Contract-Version=2; `send` уже содержит contractVersion2. Seed P04 теми же literal `task.edit` commands; POST B.finish11 даёт ready/float P05, GET /schedule той же revision — идентичный schedule, POST undo — P04. P09+U POST source edit сохраняется одной revision и возвращает infeasible с обеими diagnostics, normal/partial IDs пусты; invalid new triple возвращает400 и no writes. Header426, origin/session checks и strict V2 input из Task5 сохраняются.
- [ ] **Step 3: Preserve frozen legacy replay.** Повторить M08 durable test из Task5 через `replayLegacy` после CPM подключения/restart: frozen pending revision9 остаётся pending, source finish6 октября и cached response bytes прежние; latest revision10 ready не подставляется. Corrupt digest/parser даёт safe500/no writes, никакого fallback recalculation. Не выполнять migration 003 повторно и не менять archive.
- [ ] **Step 4: Run RED.** `npm test -- tests/explicit-cpm-repository.test.ts tests/scheduling-api.test.ts tests/optional-migration.test.ts` — перед server union/wiring FAIL wrong status/frozen parse/rollback.
- [ ] **Step 5: Wire server parse before commit.** Live getTree/getSchedule используют current calculate; `change` parses `projectTreeV2Schema` до записи operation response/commit. Replay branch читает response/digest, парсит union и возвращает результат, без чтения current project schedule. Existing auth/session/revision/idempotency/undo bounds сохраняются.
- [ ] **Step 6: Run GREEN и commit.** `npm run test:integration`; `npm run typecheck`; `npm run lint`; staged checks и normal commit `feat: preserve atomic critical path analysis and frozen retries`; два independent reviews.

Frozen reply test uses direct operation injection to emulate already accepted Task5 outcome. Migration/replay production policy is unchanged; actual historical projection test remains M08 from reviewed Task5 rather than inventing new C17 behavior.

### Task E: Серверная критичность в UI и browser acceptance

**Files:** Modify `src/client/ScheduleStatus.tsx`/`strings.ts`, `Gantt.tsx`/`gantt-view.ts`, `Dependencies.tsx`/`TaskTree.tsx`; create `tests/client/explicit-cpm.test.tsx` and `tests/e2e/explicit-cpm.spec.ts`. Existing Task 5 fixtures/API/dirty panel/keyboard gesture behavior remains. No new layout, reference asset or dependency.

**Interfaces:** UI consumes `ProjectTreeV2['schedule']` through analysisStatus discrimination. Ready uses global critical IDs and ordinary floats. Incomplete uses partial object's IDs only with explicit partial label; ordinary global highlights stay empty. Infeasible/pending use no ordinary/partial critical styles. Domain input has no collapse/filter/zoom.

- [ ] **Step 1: Write RED rendering tests using literal schedule.** The following standalone test uses actual `ScheduleStatus` with a fully defined fixture. It imports no calculator. IDs/project/task fields are synthetic; inline fixture is independent of engine.

```tsx
// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import {cleanup,render,screen} from '@testing-library/react';
import {afterEach,expect,it} from 'vitest';
afterEach(cleanup);
import {ScheduleStatus} from '../../src/client/ScheduleStatus.js';
import {projectTreeV2Schema} from '../../src/shared/contracts.js';
const A='22222222-2222-4222-8222-222222222222';
const U='22222222-2222-4222-8222-222222222223';
const projectId='11111111-1111-4111-8111-111111111111';
const timestamp='2026-10-07T00:00:00.000Z';
const project={id:projectId,title:'Демо-проект',revision:5,calendarType:'all-days',
  timezone:'UTC',createdAt:timestamp,updatedAt:timestamp};
const task=(id:string,title:string,inputStart:string|null,inputFinish:string|null)=>({
  id,projectId,parentId:null,title,description:'',sortOrder:id===A?0:1,status:'todo',
  inputStart,inputFinish,durationDays:null,createdAt:timestamp,updatedAt:timestamp,
});
const partialTree=()=>projectTreeV2Schema.parse({contractVersion:2,project,canUndo:true,
  tasks:[task(A,'Работа A','2026-10-05','2026-10-06'),task(U,'Работа U',null,null)],
  dependencies:[],schedule:{
    analysisStatus:'incomplete',feasibility:'incomplete',coverage:{knownLeafCount:1,totalLeafCount:2},
    tasks:{[A]:{startDate:'2026-10-05',finishDate:'2026-10-06',calendarSpanDays:2,projectFloat:null,constraintFloat:null},
      [U]:{startDate:null,finishDate:null,calendarSpanDays:null,projectFloat:null,constraintFloat:null}},
    summaries:{},display:{},horizonFinishDate:null,criticalTaskIds:[],criticalDependencyIds:[],
    diagnostics:[{code:'UNKNOWN_INTERVAL',taskIds:[U],dependencyIds:[],messageKey:'scheduling.UNKNOWN_INTERVAL'}],
    partialAnalysis:{labelKey:'scheduling.PARTIAL_ANALYSIS',knownHorizonFinishDate:'2026-10-06',
      coverage:{analyzedLeafCount:1,blockedLeafCount:1},tasks:{[A]:{knownHorizonFloat:0}},
      partialCriticalTaskIds:[A],partialCriticalDependencyIds:[],partialCriticalSummaryIds:[]},
  }});
it('labels partial criticality and never substitutes ordinary/global floats',()=>{
  const tree=partialTree();
  render(<ScheduleStatus tree={tree} task={tree.tasks[0]!}/>);
  expect(screen.getByText('Анализ датированной части; полный критический путь неизвестен')).toBeVisible();
  expect(screen.getByText(/Резерв до известного горизонта: 0/)).toBeVisible();
  expect(screen.queryByText(/^Критична для окончания проекта$/)).not.toBeInTheDocument();
  expect(screen.queryByText(/^Резерв проекта:/)).not.toBeInTheDocument();
});
it('conflict removes all partial labels and highlights',()=>{
  const tree=partialTree();
  tree.schedule=projectTreeV2Schema.parse({...tree,schedule:{...tree.schedule,
    analysisStatus:'infeasible',feasibility:'infeasible',partialAnalysis:null,
    diagnostics:[{code:'EXPLICIT_PRECEDENCE_CONFLICT',taskIds:[A,U],
      dependencyIds:[],messageKey:'scheduling.EXPLICIT_PRECEDENCE_CONFLICT'}]}}).schedule;
  render(<ScheduleStatus tree={tree} task={tree.tasks[0]!}/>);
  expect(screen.queryByText(/Анализ датированной части/)).not.toBeInTheDocument();
  expect(screen.queryByText(/Резерв до известного горизонта/)).not.toBeInTheDocument();
});
```

Use same Vitest jsdom setup/cleanup conventions as existing client suites. Exact copy added in strings:
`scheduling.PARTIAL_ANALYSIS` = «Анализ датированной части; полный критический путь неизвестен»;
`knownHorizonFloat` label = «Резерв до известного горизонта»;
global critical label = «Критична для окончания проекта»;
pending = «Расчёт критического пути ещё не подключён».
Global/partial styles have separate accessible labels; do not rely on color alone. Ready projectFloat and constraintFloat remain separate lines.

Дополнить literal rendering tests: ready N06 A shows project7/constraint3 and no critical label; B done shows project4/constraint0 and no critical label; C has global label; F03 AB/BC arrows critical, AC arrow noncritical despite both ends critical; incomplete partial summary has partial label and no normal containsCritical; pending fixture is original Task5 shape and pending copy; infeasible keeps real source bars/diagnostic but suppresses all critical indicators. Loading/empty/error views and dirty draft tests из Task5 rerun; conditional bar keyboard ArrowRight remains disabled for planning, Enter opens panel, Tab/Esc focus works. No renderer runs scheduling.

- [ ] **Step 2: Run RED.** `npm test -- tests/client/explicit-cpm.test.tsx` — FAIL missing partial copy/type narrowing or false global critical.
- [ ] **Step 3: Implement discriminated rendering.** Use the following narrowing pattern at each consumer before reading new fields. Ready maps global IDs; incomplete partial IDs never enter global set. Summary global indicator reads ready containsCritical only.

```ts
const globalTasks = new Set(schedule.analysisStatus==='ready' ? schedule.criticalTaskIds : []);
const globalEdges = new Set(schedule.analysisStatus==='ready' ? schedule.criticalDependencyIds : []);
const partial = schedule.analysisStatus==='incomplete' ? schedule.partialAnalysis : null;
const partialTasks = new Set(partial?.partialCriticalTaskIds ?? []);
const partialEdges = new Set(partial?.partialCriticalDependencyIds ?? []);
// In ScheduleStatus:
const ordinary = schedule.analysisStatus==='ready' && task ? schedule.tasks[task.id] : undefined;
const known = partial && task ? partial.tasks[task.id] : undefined;
// Display known.knownHorizonFloat only below the exact PARTIAL_ANALYSIS label.
// Never place partial IDs into globalTasks/globalEdges or ordinary summaries.
```

Partial Gantt/graph indicator uses distinct text label and style, maintains original endpoints and never draws bypass links. Whole summary range stays null until all leaf descendants have real pairs. Any cache delivery pending remains visibly pending without a client recomputation. API revision guard prevents old frozen reply overwriting current tree; successful replay still completes its own uncertain operation.

- [ ] **Step 4: Write browser P04→P05→undo→restart case.** In `tests/e2e/explicit-cpm.spec.ts` reuse `syntheticRuntime` fixture exactly as existing `tests/e2e/scheduling.spec.ts`; the file must define its own readTree/command helpers with version headers/body. `runtime.databasePath` from reviewed Task5 belongs only to disposable test runtime; no production path.

```ts
async function readTree(page:Page,origin:string,projectId:string):Promise<ProjectTreeV2> {
  const response=await page.request.get(origin+'/api/projects/'+projectId+'/tree',
    {headers:{'X-Leaf-Contract-Version':'2'}});
  expect(response.status()).toBe(200);
  return projectTreeV2Schema.parse(await response.json());
}
async function command(page:Page,origin:string,tree:ProjectTreeV2,value:CommandV2):Promise<ProjectTreeV2> {
  const response=await page.request.post(origin+'/api/projects/'+tree.project.id+'/commands',{
    headers:{Origin:origin,'X-Leaf-Contract-Version':'2'},
    data:{contractVersion:2,expectedRevision:tree.project.revision,
      operationId:randomUUID(),command:value},
  });
  expect(response.status()).toBe(200);
  return projectTreeV2Schema.parse(await response.json());
}
```

Imports: `test as base/expect/type Page` from Playwright; `randomUUID` from node:crypto; `syntheticRuntime` from `../../scripts/e2e-server.js`; V2 schemas/types from shared/contracts. Define base fixture runtime open/use/finally close as existing scheduling suite. Login with runtime.password synthetic credential; project creation POST has X-Leaf-Contract-Version2; seed exactly P04 dates/dependencies from Task D with nullable duration. Read response expected arrays A/B/C/D=0. Open B compact panel, change finish9→11, save once; real HTTP schedule P05 floats A/B=0,C/D=2 and critical only A/B/AB. Browser must show critical graph edge AB and noncritical CD, C ordinary reserve2. One visible Undo restores P04 dates/floats/both edges. `runtime.restart()` and reload preserves P04. Restart uses only existing synthetic helper.

Add separate browser tests: deep C date14→8 updates tree/Gantt/graph and 40 summaries one revision; collapse/filter/scale changes neither GET schedule nor IDs; P07 known partial label, unknown U conditional bar never creates global critical; introduce known FS-conflict with unknown U and verify conflict+unknown copy, all critical sets empty; exact target retry after simulated response loss returns frozen original revision after later changes with no additional operation/undo. At both configured viewports 1440×900 and 1280×800 keyboard open/edit/save/Esc/Undo maintains focus. Assertions inspect numeric HTTP DTO and visible accessible labels, not CSS screenshot alone.

Полный основной browser test в том же файле после readTree/command helpers:

```ts
import {test as base,expect,type Page} from '@playwright/test';
import {randomUUID} from 'node:crypto';
import {syntheticRuntime} from '../../scripts/e2e-server.js';
import {projectTreeV2Schema,type ProjectTreeV2,type CommandV2} from '../../src/shared/contracts.js';
const test=base.extend<{runtime:Awaited<ReturnType<typeof syntheticRuntime>>}>({
  runtime:async({},use)=>{
    const runtime=await syntheticRuntime();
    try{await use(runtime);}finally{await runtime.close();}
  },
});
test('explicit P04 edits, critical sets, one undo and restart agree',async({page,runtime})=>{
  await page.goto(runtime.origin);
  await page.getByLabel('Пароль',{exact:true}).fill(runtime.password);
  await page.getByRole('button',{name:'Войти',exact:true}).click();
  await expect(page.getByRole('button',{name:'Новый проект'})).toBeVisible();
  const created=await page.request.post(runtime.origin+'/api/projects',{
    headers:{Origin:runtime.origin,'X-Leaf-Contract-Version':'2'},
    data:{title:'Synthetic explicit browser'},
  });
  expect(created.status()).toBe(201);
  const projectId=(await created.json() as {id:string}).id;
  let tree=await readTree(page,runtime.origin,projectId);
  tree=await command(page,runtime.origin,tree,{type:'project.schedule',changes:{calendarType:'all-days'}});
  for(const title of ['A','B','C','D'])
    tree=await command(page,runtime.origin,tree,{type:'task.create',title,parentId:null});
  const by=Object.fromEntries(tree.tasks.map(t=>[t.title,t.id]));
  for(const [title,inputStart,inputFinish] of [
    ['A','2026-10-05','2026-10-06'],['B','2026-10-07','2026-10-09'],
    ['C','2026-10-05','2026-10-07'],['D','2026-10-08','2026-10-09'],
  ] as const)
    tree=await command(page,runtime.origin,tree,{type:'task.edit',taskId:by[title]!,changes:{inputStart,inputFinish}});
  for(const [from,to] of [['A','B'],['C','D']] as const)
    tree=await command(page,runtime.origin,tree,{
      type:'dependency.create',predecessorId:by[from]!,successorId:by[to]!,
    });
  const before=structuredClone(tree);
  expect(tree.schedule.analysisStatus).toBe('ready');
  expect(tree.schedule.criticalTaskIds).toEqual([by.A!,by.B!,by.C!,by.D!].sort());
  await page.reload();
  await page.getByRole('button',{name:'Synthetic explicit browser',exact:true}).click();
  const b=page.getByRole('treeitem',{name:/^B,/}).first();
  await b.focus();await b.press('Enter');
  await page.getByLabel('Окончание',{exact:true}).fill('2026-10-11');
  const saved=page.waitForResponse(r=>r.url().endsWith('/commands')&&r.request().method()==='POST');
  await page.getByRole('button',{name:'Сохранить',exact:true}).click();
  expect((await saved).status()).toBe(200);
  const after=await readTree(page,runtime.origin,projectId);
  expect(after.project.revision).toBe(before.project.revision+1);
  if(after.schedule.analysisStatus!=='ready') throw new Error('Expected ready');
  expect(after.schedule.criticalTaskIds).toEqual([by.A!,by.B!].sort());
  for(const [name,pf,cf] of [['A',0,0],['B',0,0],['C',2,0],['D',2,2]] as const)
    expect(after.schedule.tasks[by[name]!]).toMatchObject({projectFloat:pf,constraintFloat:cf});
  const ab=after.dependencies.find(e=>e.predecessorId===by.A&&e.successorId===by.B)!.id;
  expect(after.schedule.criticalDependencyIds).toEqual([ab]);
  await page.getByRole('treeitem',{name:/^C,/}).first().press('Enter');
  await expect(page.getByText(/Резерв проекта: 2/)).toBeVisible();
  const undoReply=page.waitForResponse(r=>r.url().endsWith('/commands')&&r.request().method()==='POST');
  await page.getByRole('button',{name:'Отменить последнее изменение',exact:true}).click();
  expect((await undoReply).status()).toBe(200);
  const undone=await readTree(page,runtime.origin,projectId);
  expect(undone.tasks).toEqual(before.tasks);
  expect(undone.dependencies).toEqual(before.dependencies);
  expect(undone.schedule).toEqual(before.schedule);
  await runtime.restart();await page.reload();
  expect((await readTree(page,runtime.origin,projectId)).schedule).toEqual(before.schedule);
});
```

Global float copy for this acceptance test: `projectFloat` = «Резерв проекта», `constraintFloat` = «Резерв текущего размещения». Labels explain hypothetical structural delay versus fixed neighboring intervals; neither label offers source mutation.


- [ ] **Step 5: Run GREEN и full acceptance.** `npm test -- tests/client/explicit-cpm.test.tsx`; `npm run verify`; `npm run format:check`; `npm run test:e2e -- tests/e2e/explicit-cpm.spec.ts tests/e2e/optional-scheduling.spec.ts`; `npm run check:package`; `npm run check:kit`; `git diff --check`. Expect no skipped/retried suites; run all E2E once for integrated Task7. Update affected explicit unit/integration lists. Do not use --if-present.
- [ ] **Step 6: Commit/review/handoff.** Normal staged guard+Gitleaks/hooks, commit `feat: show verified explicit-date critical paths`, two independent reviewers on same SHA. STATUS reports exact passed/failed/not-run and unresolved release work. ADR008 links implementation/checks without changing C16 formula. C05/OS16 complete only with all domain/storage/API/browser acceptance GREEN; V1 remains unfinished pending S4–S6.

## Численная и contract coverage для review

| Требование | Независимый expected / проверка |
|---|---|
| Admission пары, без Auto/duration inference | P11, full pair nullable duration, invalid saved source, conditional deep U |
| Entered placement/global horizon/gaps | P01/P02/P03/N06 и done N06 |
| Fork/join/equal paths/critical edge predicate | F01/F02/F03, P04, 60-task/116-edge layer case |
| Done structural/local float separation | P06, N06-done, source editing/explicit return+undo |
| Incomplete/weak components/global known lower horizon | P07/P08/Hknown-blocked-late/all-blocked/no-known |
| Conflict priority plus unknown | P09 alone/P09+U, finish-only/start-only conflict |
| Calendar adjacency and extremes | P10, weekdays Friday→Monday, all-days Friday→Saturday, full 0001–9999 span |
| Technical origin invariance | Every ready fixture with two origins; literal N06 negative LS/LF |
| Hierarchy/summary/display separation | 40-level complete/incomplete/deep-change, 10000-level summary source ignored |
| Pure/immutable/deterministic/finite output | Reversed input fixtures, source clone equality, no path enumeration |
| Strict live/frozen union and type consistency | Contract tests and typecheck; pending exact equality, cross-status rejection |
| Atomic revision/undo/restart/exact retry | P04→P05→undo, latest revision vs cached outcome, server rollback injection |
| Frozen historical migration response | Task5 M08 durable restart repeated after CPM; pending parser/no solver |
| Server-only UI/keyboard/empty/error/loading | Literal UI fixtures, real browser DTO+labels, Task5 UX regression |

## Gate и исполнение

- [ ] Автор сохраняет annex и scoped local commit с нормальными hooks/security:staged; отчёт отличает документационные проверки от будущих application tests.
- [ ] Reviewer 1 независимо проверяет exact SHA на standards/type consistency/file map/commands/privacy/frozen parsing.
- [ ] Reviewer 2 независимо проверяет exact SHA на C16/owner evidence/numerical matrix/admission/weak components/Hknown/conflict/undo/UI.
- [ ] При CHANGES_REQUIRED исправить technical annex, rerun affected doc/oracle checks и получить **оба** APPROVED нового SHA. Accepted policy не переоткрывать; изменение формулы нельзя скрывать как code detail.
- [ ] Task7 запускается только после Task5 GREEN и двух APPROVED annex. Исполнитель проверяет `git status --short --branch`, читает START_HERE/AGENTS/PRIVACY, использует один worktree writer, Node24.21.0/npm11.19.0 и существующий lockfile.
- [ ] Исполнение A→B/C→D→E использует TDD RED/GREEN и scoped commits/reviews. Нет permission на production migration/push/deploy.
- [ ] Финальный STATUS фиксирует implemented behavior, exact checks, limitations и S4–S6 next work; policy CLOSED и implementation GREEN остаются разными фактами.
