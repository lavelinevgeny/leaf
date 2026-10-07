# Explicit Date CPM Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use `subagent-driven-development` or `executing-plans` to implement this plan task-by-task. The owner requires separate author, implementation worker and two independent reviewers. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Подключить настоящий серверный CPM введённых интервалов C16 к единственному target scheduler после Task 5, сохранив nullable source, точный replay и атомарную отмену.

**Architecture:** Существующий `calculateSchedule(input: OptionalInput): OptionalResult` сохраняет единственный вход; projection real/FS/summary/display из Task 5 дополняется чистым анализом leaf DAG. Координаты, обратные границы и H/Hknown остаются внутри domain; публичный DTO различает live ready/incomplete/infeasible и неизменяемый frozen pending результат. React только показывает серверные floats, множества IDs и подписанный partial result.

**Tech Stack:** TypeScript strict; React 19.3.0/Vite 8.3.3; Fastify 5.12.5; better-sqlite3 13.0.3; Zod 4.6.5; Vitest 5.0.3; Playwright 1.63.0; Node 24.21.0/npm 11.19.0, существующий exact lockfile.

**Spec:** [Принятое приложение C16, разделы 1–4/P01–P11](../specs/2026-10-07-optional-scheduling-policy-proposal.md), [утверждённая спецификация, разделы 8–11/N06/OS16](../specs/2026-10-07-optional-scheduling-design.md), [ADR 008](../../adr/008-explicit-date-cpm.md), [основной план, Tasks 1/2/5/6/7](2026-10-07-optional-scheduling.md). Читать также [DECISIONS](../../DECISIONS.md), [SCHEDULING](../../SCHEDULING.md), [ACCEPTANCE](../../ACCEPTANCE.md), [PRIVACY](../../PRIVACY.md), [AGENT_WORKFLOW](../../AGENT_WORKFLOW.md).

**Status:** C17 input amendment 2026-10-08 подготовлен для двух новых independent reviews. Substantive candidate29f193e ранее получил два APPROVED; они не распространяются на этот изменённый typed/algorithm body. C16/O06/G-CPM CLOSED как выбор политики; Task7 требует Task4 review и Task5 GREEN. Ни один fenced test ниже не является уже реализованным application test.

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
- Все последующие задачи требуют Task5 GREEN и двух APPROVED текущего amended annex на один точный SHA. Task5 удаляет temporary shared/domain optional modules; server-only `optional-migration.ts`/`optional-upgrade.ts`/`optional-snapshot.ts` и compatibility contracts сохраняются.
- Frozen `pending-policy` ответы принимаются в прежней форме без defaults/добавления floats и не пересчитываются. Live `calculateSchedule` после подключения никогда не возвращает pending.
- Calendar spans, source dates, summary и display не записываются анализом. Duration-only, start+duration, finish+duration и условные полосы не входят в CPM.
- Нормативная C16 раздел 3 имеет приоритет над промежуточной классификацией Task 2: saved invalid/mismatch interval даёт unknown/incomplete, пока нет доказанного FS-конфликта. Malformed graph fail closed; мутации уже отклоняет existing validator. Task 7 меняет эту классификацию явно, без исправления source.
- C17 private unavailable provenance переживает active/undo/reopen и передаётся в pure input как `unavailableTaskIds`. Marked leaf исключён из real/coverage/summary/CPM даже при валидной retained pair; raw source FS/minima/notes сохраняются. Public Task/DTO не содержит provenance.

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
  unavailableTaskIds?: readonly string[];
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
| `src/server/repository.ts` | PrivateSnapshotV2→pure unavailable IDs; public field picking; parse live before commit, cache union without recalculation |
| `src/server/optional-snapshot.ts` | Reviewed Task4 server-private strict schema/type/applyPrivateSourcePatch; Task7 imports, не дублирует публично |
| `src/server/legacy-pending-types.ts`, `legacy-pending-source.ts`, `legacy-pending-projection.ts` | Frozen initial migration/preview projection, private structural input/frozen source validation; no active solver import |
| `src/server/legacy-compatibility.ts`, `optional-upgrade.ts`, `optional-migration.ts` | Initial adaptation/preview используют frozen pending/source helper; archive/resolution/acknowledgement rules сохраняются |
| `src/client/ScheduleStatus.tsx`, `strings.ts` | Status/float/partial copy и отсутствие ложного global результата |
| `src/client/Gantt.tsx`, `gantt-view.ts`, `Dependencies.tsx`, `TaskTree.tsx` | Global и partial IDs показывать раздельно; summary только индикатор потомков |
| `tests/helpers/explicit-cpm-fixtures.ts` | Literal numerical matrix ниже; никакого вызова solver для expected |
| `tests/explicit-cpm-contracts.test.ts` | Strict union, frozen pending equality, compile-time type assignment |
| `tests/explicit-cpm.test.ts` | P01–P11/N06/fork/join/partial/extremes/invariance/deep fixtures |
| `tests/explicit-cpm-repository.test.ts` | Revision/undo/restart/retry/frozen response/rollback на disposable SQLite |
| `tests/legacy-pending-projection.test.ts` | Literal initial frozen outcomes, adapter/preview/SQL003 without live solver; positive current LIVE controls |
| `tests/scheduling-api.test.ts` | Live HTTP response strict parse, status/unknown/conflict priorities |
| `tests/client/explicit-cpm.test.tsx` | Literal server DTOs, unknown/partial/error/keyboard |
| `tests/e2e/explicit-cpm.spec.ts` | Реальный browser edit→recalculate→undo→restart и collapse/graph |
| `package.json` | Добавить новые suites в явные unit/integration lists; lockfile не менять |
| `docs/STATUS.md`, `docs/adr/008-explicit-date-cpm.md` | Фактические checks/limitations и ссылка на реализованный annex после GREEN |

Исторические `fixtures/scheduling/cpm-cases.json` проверяют прежний Auto, не заменяются новым observed-interval oracle. `calendar-cases.json` сохраняется. Новые literal fixtures находятся в TypeScript test helper и исполняются Vitest; `check:kit` этого не доказывает.

### C17 private input boundary — 2026-10-08

Task4 задаёт server-only `PrivateSnapshotV2 = SnapshotV2 & {legacyIntervalUnavailable:string[]}`, `privateSnapshotV2Schema` и `applyPrivateSourcePatch` в `src/server/optional-snapshot.ts`. В Task5 imports shared optional-contracts/planning меняются на active contracts/planning; этот private server module сохраняется. Его strict schema имеет следующий exact shape; schema/type уже принадлежит Task4, Task7 не создаёт второй public schema:

```ts
// src/server/optional-snapshot.ts — Task4 boundary, already implemented before Task5.
import {z} from 'zod';
import {snapshotV2Schema,type TaskV2,type SourcePatch} from '../shared/contracts.js';
import type {CalendarType} from '../domain/scheduling-types.js';
export const privateSnapshotV2Schema=snapshotV2Schema.extend({
  legacyIntervalUnavailable:z.array(z.uuid()),
}).superRefine((snapshot,ctx)=>{
  const ids=new Set(snapshot.tasks.map(task=>task.id));
  if(new Set(snapshot.legacyIntervalUnavailable).size!==snapshot.legacyIntervalUnavailable.length||
    snapshot.legacyIntervalUnavailable.some(id=>!ids.has(id))||
    snapshot.tasks.some(task=>task.projectId!==snapshot.project.id)||
    snapshot.dependencies.some(edge=>edge.projectId!==snapshot.project.id))
    ctx.addIssue({code:'custom',message:'Invalid private scheduling provenance'});
});
export type PrivateSnapshotV2=z.infer<typeof privateSnapshotV2Schema>;
// Existing Task4 export; declaration identifies its exact interface, not a replacement body.
export declare function applyPrivateSourcePatch(
  task:TaskV2,patch:SourcePatch,calendar:CalendarType,unavailable:boolean,
  reopenedStatus?:'todo'|'doing',
):{task:TaskV2;unavailable:boolean};
```

Private persistence table `task_schedule_provenance` имеет `taskId PRIMARY KEY REFERENCES tasks(id) ON DELETE CASCADE` и reason `legacy-interval-unavailable`. SQL003/pin/resolver/archive outcome относятся к Task4 writer/review, не изменяются Task7. `projectLegacySnapshot` возвращает PRIVATE snapshot; `adaptLegacyTree` и Repository выбирают только project/tasks/dependencies для public DTO и передают `legacyIntervalUnavailable` в optional pure-input field. Нельзя spread private snapshot в public tree или публичный snapshotSchema. Public source/status/duration остаются без изменения; публичный client не отправляет unavailable IDs.

Leaf marker означает неизвестный real interval: blank real map, не knownLeafCount, null full summary при таком потомке, grouped sorted `LEGACY_INTERVAL_UNAVAILABLE` diagnostic. Parent marker сам не является leaf provenance и не исключает известные child leaves; при preserveWork исходная work provenance переносится на созданный leaf child. Marked leaf остаётся vertex ID в topo/weak components и сохраняет original graph edges, но не имеет WorkingInterval. `Hknown` исключает marked leaf, включает unmarked known leaves даже в blocked component. Raw known predecessor.inputFinish/successor.inputStart по-прежнему доказывают FS-конфликт; infeasible подавляет normal и partial analysis.

Clear разрешён только explicit source-key patch после validation, включая equal values; отсутствующие/undefined поля не считаются patch. На ORIGINAL done требуется explicit status todo/doing в том же command. Details/status-only/calendar/edge edits marker сохраняют; reopen не интерпретирует retained valid pair как восстановленный lock. Private metadata входит в beforeSnapshot/undo и восстанавливается атомарно с tasks. Полностью определённые TaskD regressions ниже проверяют pass-through, clear/undo/reopen; ordinary unmarked explicit done сохраняет P06/N06-done semantics.

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
export const liveProjectTreeV2Schema = snapshotV2Schema.extend({
  contractVersion: z.literal(2), canUndo: z.boolean(), schedule: liveScheduleResultV2Schema,
});
export const liveScheduleResponseV2Schema = z.strictObject({
  contractVersion: z.literal(2), projectId: uuidSchema,
  revision: countCpmSchema, schedule: liveScheduleResultV2Schema,
});
export type LiveProjectTreeV2 = z.infer<typeof liveProjectTreeV2Schema>;
export type LiveScheduleResponseV2 = z.infer<typeof liveScheduleResponseV2Schema>;
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

Civil ordinal O(0001-01-01)=0; proleptic Gregorian leap rule. For all-days W(date)=O(date). For weekdays, only Monday–Friday dates admitted and `W(date)=5*floor(O/7)+(O mod 7)`. `s=W(start)-W(origin)`, `f=W(finish)-W(origin)+1`, `d=f-s`. Existing `dateToIndex`/`workingDaysInclusive` implement this without day iteration. `toWorkingInterval` проверяет только candidate source pair; graph builder сначала исключает unavailable ID и не вызывает этот helper для marked leaf. Отдельная raw FS-проверка использует source границы независимо от admission.

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

1. Take leaf IDs/real pairs/summary/display from projection without mutating it. Detect malformed graph diagnostics (`DUPLICATE_TASK_ID`, `INVALID_PARENT`, `TREE_CYCLE`, `DUPLICATE_DEPENDENCY_ID`, `DEPENDENCY_TASK_NOT_FOUND`, `SELF_DEPENDENCY`, `DEPENDENCY_REQUIRES_LEAVES`, `DUPLICATE_DEPENDENCY`, `DEPENDENCY_CYCLE`, `INVALID_PROJECT_CALENDAR`, `INVALID_UNAVAILABLE_TASK`) or `EXPLICIT_PRECEDENCE_CONFLICT`. Return infeasible before any normal/partial analysis.
2. For every unmarked missing pair append `UNKNOWN_INTERVAL` ([task], no edges); for invalid full pair append `INVALID_INTERVAL`; for valid date pair whose supplied duration mismatches append `DURATION_MISMATCH`. Marked leaves receive grouped sorted `LEGACY_INTERVAL_UNAVAILABLE` and no redundant UNKNOWN_INTERVAL. Do not duplicate equivalent projection diagnostics. Missing/marked pair is not replaced by duration/display/retained source. FS checks still use independently known predecessor finish/successor start even when realInterval=null or leaf is marked.
3. Necessary absent FS edge bound → `UNKNOWN_PRECEDENCE`, both endpoints and original edge ID; nonworking/invalid necessary bound → `INVALID_PRECEDENCE_BOUNDARY`. Check all checkable edges, preserving unknown diagnostics alongside conflict. `EXPLICIT_PRECEDENCE_CONFLICT` reports exact endpoints/edge; no automatic shift. Graph errors fail closed; saved source/calendar mismatch alone means incomplete. Existing mutation validator still rejects newly supplied invalid pairs and graph.
4. Build CpmGraph with iterative Kahn topological traversal and iterative undirected BFS/DFS weak components over **all** leaves and **all** original edges, including unknown. Sort leaf IDs, component members, components by smallest ID, IDs in result and diagnostics by `code/taskIds/dependencyIds` using existing deterministic comparison. Use indexed queue cursor, no `shift()` for 10000-node graph. Sorting O((V+E)log(V+E)), passes O(V+E), memory O(V+E); arithmetic does not depend on date span.
5. `knownHorizon=max(f of all admitted unmarked valid leaves)`; null if none. If all leaves known, H=knownHorizon. In reverse topo iterate all known leaves; terminal LF=H; otherwise min(H, successors' LS); LS=LF-d, projectFloat=LS-s; constraintFloat=done?0:min(H-f, successors' **entered s** minus f). Derive critical tasks float=0; edge critical iff both float=0 **and f(predecessor)=s(successor)**.
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
  { id: 'P10-all-days', input: { calendarType: 'all-days', tasks: [
    leaf('A','2026-10-09','2026-10-09'),leaf('B','2026-10-12','2026-10-13') ],
    dependencies:[edge('AB','A','B')] },
    horizon:'2026-10-13',floats:[['A',2,2],['B',0,0]],
    critical:['B'],criticalEdges:[] },
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
  { id: 'C17-unmarked-done-control', input: { calendarType:'all-days',tasks:[
    leaf('D','2026-10-05','2026-10-07',3,'done'),
    leaf('K','2026-10-09','2026-10-10'),leaf('C','2026-10-05','2026-10-08')],
    dependencies:[edge('DK','D','K')]},
    horizon:'2026-10-10',floats:[['C',2,2],['D',1,0],['K',0,0]],
    critical:['K'],criticalEdges:[] },
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
import { expect, it, vi } from 'vitest';
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

it('F03 plus unknown U publishes tight partial edges without global criticality', () => {
  const input:OptionalInput={calendarType:'all-days',tasks:[
    leaf('A','2026-10-05','2026-10-06'),leaf('B','2026-10-07','2026-10-09'),
    leaf('C','2026-10-10','2026-10-11'),leaf('U',null,null)],
    dependencies:[edge('AB','A','B'),edge('BC','B','C'),edge('AC','A','C')]};
  const r=calculateSchedule(input);
  expect(r.analysisStatus).toBe('incomplete');
  if(r.analysisStatus!=='incomplete') throw new Error('Expected incomplete');
  expect(r.coverage).toEqual({knownLeafCount:3,totalLeafCount:4});
  expect(r.criticalTaskIds).toEqual([]);expect(r.criticalDependencyIds).toEqual([]);
  expect(r.partialAnalysis).toEqual({
    labelKey:'scheduling.PARTIAL_ANALYSIS',knownHorizonFinishDate:'2026-10-11',
    coverage:{analyzedLeafCount:3,blockedLeafCount:1},
    tasks:{A:{knownHorizonFloat:0},B:{knownHorizonFloat:0},C:{knownHorizonFloat:0}},
    partialCriticalTaskIds:['A','B','C'],partialCriticalDependencyIds:['AB','BC'],
    partialCriticalSummaryIds:[],
  });
  expect(Object.values(r.tasks).every(t=>t.projectFloat===null&&t.constraintFloat===null)).toBe(true);
  expect(r.diagnostics).toEqual([{code:'UNKNOWN_INTERVAL',taskIds:['U'],
    dependencyIds:[],messageKey:'scheduling.UNKNOWN_INTERVAL'}]);
});

it('wide unknown leaves use bounded diagnostic lookup work without timing assertions',()=>{
  const n=10000;
  const tasks=Array.from({length:n},(_,i)=>leaf('U'+String(i).padStart(5,'0'),null,null));
  const input:OptionalInput={calendarType:'all-days',tasks,dependencies:[]};
  const projection={
    feasibility:'incomplete' as const,coverage:{knownLeafCount:0,totalLeafCount:n},
    tasks:Object.fromEntries(tasks.map(t=>[t.id,{startDate:null,finishDate:null,calendarSpanDays:null}])),
    summaries:{},display:{},diagnostics:tasks.map(t=>({code:'UNKNOWN_INTERVAL',
      taskIds:[t.id],dependencyIds:[],messageKey:'scheduling.UNKNOWN_INTERVAL'})),
  };
  const originalSome=Array.prototype.some;
  let inspections=0;
  const spy=vi.spyOn(Array.prototype,'some').mockImplementation(function(
    this:unknown[],predicate:(value:unknown,index:number,array:unknown[])=>unknown,thisArg?:unknown,
  ){
    return originalSome.call(this,(value,index,array)=>{
      inspections++;return predicate.call(thisArg,value,index,array);
    });
  });
  let r:ReturnType<typeof analyzeExplicitDates>;
  try{r=analyzeExplicitDates(input,projection);}finally{spy.mockRestore();}
  expect(inspections).toBeLessThanOrEqual(20*n);
  expect(r.analysisStatus).toBe('incomplete');
  expect(r.diagnostics).toEqual(projection.diagnostics);
  expect(Object.keys(r.tasks)).toHaveLength(n);
  expect(r.coverage).toEqual({knownLeafCount:0,totalLeafCount:n});
  if(r.analysisStatus!=='incomplete') throw new Error('Expected incomplete');
  expect(r.partialAnalysis).toBeNull();
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

C17 marked valid-source cases добавить в тот же `tests/explicit-cpm.test.ts`; calculateSchedule/projectExplicitSchedule/graph helpers и leaf/edge imports определены выше. Expected не вызывает solver.

```ts
const c17Input=():OptionalInput=>({
  calendarType:'all-days',unavailableTaskIds:['D'],
  tasks:[
    leaf('P',null,null),
    leaf('D','2026-10-05','2026-10-07',3,'done','P'),
    leaf('K','2026-10-09','2026-10-10',null,'todo','P'),
    leaf('U',null,null,3,'todo','P'),
    leaf('C','2026-10-05','2026-10-08')],
  dependencies:[edge('DK','D','K')],
});
it('C17 valid retained done source stays unknown and blocks its whole weak component',()=>{
  const input=c17Input(),before=structuredClone(input),r=calculateSchedule(input);
  expect(r.analysisStatus).toBe('incomplete');expect(r.feasibility).toBe('incomplete');
  expect(r.coverage).toEqual({knownLeafCount:2,totalLeafCount:4});
  expect(r.tasks.D).toEqual({startDate:null,finishDate:null,calendarSpanDays:null,
    projectFloat:null,constraintFloat:null});
  expect(r.summaries.P).toEqual({startDate:null,finishDate:null,calendarSpanDays:null,
    knownLeafCount:1,totalLeafCount:3,containsCritical:null});
  expect(r.display.U).toEqual({kind:'conditional',startDate:'2026-10-05',
    finishDate:'2026-10-07',clipped:false});
  expect(r.diagnostics).toEqual([
    {code:'LEGACY_INTERVAL_UNAVAILABLE',taskIds:['D'],dependencyIds:[],
      messageKey:'scheduling.LEGACY_INTERVAL_UNAVAILABLE'},
    {code:'UNKNOWN_INTERVAL',taskIds:['U'],dependencyIds:[],messageKey:'scheduling.UNKNOWN_INTERVAL'},
  ]);
  expect(r.criticalTaskIds).toEqual([]);expect(r.criticalDependencyIds).toEqual([]);
  if(r.analysisStatus!=='incomplete')throw new Error('Expected incomplete');
  expect(r.partialAnalysis).toEqual({labelKey:'scheduling.PARTIAL_ANALYSIS',
    knownHorizonFinishDate:'2026-10-10',coverage:{analyzedLeafCount:1,blockedLeafCount:3},
    tasks:{C:{knownHorizonFloat:2}},partialCriticalTaskIds:[],
    partialCriticalDependencyIds:[],partialCriticalSummaryIds:[]});
  const graph=buildCpmGraph(input,'2026-10-05');
  expect([...graph.vertices.keys()]).toEqual(['C','K']);
  expect(graph.leafIds).toEqual(['C','D','K','U']);
  expect(graph.weakComponents).toEqual([['C'],['D','K'],['U']]);
  expect(graph.dependencies).toEqual([edge('DK','D','K')]);
  expect(input).toEqual(before);
  expect(analyzeExplicitDates(input,projectExplicitSchedule(input),'2026-10-20')).toEqual(r);
});
it('C17 excludes marked late finish from Hknown while preserving source minima',()=>{
  const input=c17Input();
  input.tasks=input.tasks.map(t=>t.id==='D'?{...t,inputFinish:'2026-10-20',durationDays:16}:t);
  input.dependencies=[];
  const r=calculateSchedule(input);
  if(r.analysisStatus!=='incomplete')throw new Error('Expected incomplete');
  expect(r.partialAnalysis).toEqual({labelKey:'scheduling.PARTIAL_ANALYSIS',
    knownHorizonFinishDate:'2026-10-10',coverage:{analyzedLeafCount:2,blockedLeafCount:2},
    tasks:{C:{knownHorizonFloat:2},K:{knownHorizonFloat:0}},
    partialCriticalTaskIds:['K'],partialCriticalDependencyIds:[],partialCriticalSummaryIds:['P']});
  expect(input.tasks.find(t=>t.id==='D')).toMatchObject({
    inputStart:'2026-10-05',inputFinish:'2026-10-20',durationDays:16,status:'done'});
  expect(r.display.U).toEqual({kind:'conditional',startDate:'2026-10-05',
    finishDate:'2026-10-07',clipped:false});
});
it('marked source still proves raw FS conflict and preserves unavailable plus unknown diagnostics',()=>{
  const input=c17Input();
  input.tasks=input.tasks.map(t=>t.id==='K'?{...t,inputStart:'2026-10-07'}:t);
  const r=calculateSchedule(input);
  expect(r.analysisStatus).toBe('infeasible');expect(r.feasibility).toBe('infeasible');
  if(r.analysisStatus!=='infeasible')throw new Error('Expected infeasible');
  expect(r.coverage).toEqual({knownLeafCount:2,totalLeafCount:4});
  expect(r.partialAnalysis).toBeNull();expect(r.horizonFinishDate).toBeNull();
  expect(r.criticalTaskIds).toEqual([]);expect(r.criticalDependencyIds).toEqual([]);
  expect(r.diagnostics).toEqual([
    {code:'EXPLICIT_PRECEDENCE_CONFLICT',taskIds:['D','K'],dependencyIds:['DK'],
      messageKey:'scheduling.EXPLICIT_PRECEDENCE_CONFLICT'},
    {code:'LEGACY_INTERVAL_UNAVAILABLE',taskIds:['D'],dependencyIds:[],
      messageKey:'scheduling.LEGACY_INTERVAL_UNAVAILABLE'},
    {code:'UNKNOWN_INTERVAL',taskIds:['U'],dependencyIds:[],messageKey:'scheduling.UNKNOWN_INTERVAL'},
  ]);
  expect(r.tasks.D).toMatchObject({startDate:null,finishDate:null});
  expect(r.tasks.K).toMatchObject({startDate:'2026-10-07',finishDate:'2026-10-10',
    projectFloat:null,constraintFloat:null});
  expect(input.dependencies).toEqual([edge('DK','D','K')]);
});
it('ordinary unmarked explicit done retains real pair and structural float',()=>{
  const marked=c17Input();
  const input:OptionalInput={calendarType:marked.calendarType,
    tasks:marked.tasks.filter(t=>t.id!=='U'),dependencies:marked.dependencies};
  const r=calculateSchedule(input);
  if(r.analysisStatus!=='ready')throw new Error('Expected ready');
  expect(r.coverage).toEqual({knownLeafCount:3,totalLeafCount:3});
  expect(r.tasks.D).toEqual({startDate:'2026-10-05',finishDate:'2026-10-07',
    calendarSpanDays:3,projectFloat:1,constraintFloat:0});
  expect(r.tasks.K).toMatchObject({projectFloat:0,constraintFloat:0});
  expect(r.tasks.C).toMatchObject({projectFloat:2,constraintFloat:2});
  expect(r.criticalTaskIds).toEqual(['K']);expect(r.criticalDependencyIds).toEqual([]);
  expect(r.diagnostics).toEqual([]);
});
it('only marked and missing leaves have no Hknown but keep retained-start conditional anchor',()=>{
  const original=c17Input();
  const input:OptionalInput={...original,tasks:original.tasks.filter(t=>['P','D','U'].includes(t.id)),
    dependencies:[]};
  const r=calculateSchedule(input);
  if(r.analysisStatus!=='incomplete')throw new Error('Expected incomplete');
  expect(r.coverage).toEqual({knownLeafCount:0,totalLeafCount:2});
  expect(r.partialAnalysis).toBeNull();expect(r.horizonFinishDate).toBeNull();
  expect(r.summaries.P).toEqual({startDate:null,finishDate:null,calendarSpanDays:null,
    knownLeafCount:0,totalLeafCount:2,containsCritical:null});
  expect(r.display.U).toEqual({kind:'conditional',startDate:'2026-10-05',
    finishDate:'2026-10-07',clipped:false});
});
it('foreign unavailable ID fails closed before analysis',()=>{
  const input:OptionalInput={...c17Input(),unavailableTaskIds:['foreign']};
  const r=calculateSchedule(input);
  expect(r.analysisStatus).toBe('infeasible');
  expect(r.diagnostics).toEqual([{code:'INVALID_UNAVAILABLE_TASK',taskIds:['foreign'],
    dependencyIds:[],messageKey:'scheduling.INVALID_UNAVAILABLE_TASK'}]);
  expect(r.criticalTaskIds).toEqual([]);expect(r.criticalDependencyIds).toEqual([]);
});
```

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

В том же contract test file добавить следующие strict record/count/summary cases. Removed legacy project/task/command fields продолжают проверять accepted Task5 strict suites; frozen pending с feasibility=feasible/coverage1/2 остаётся прежним.

```ts
it.each([
  {...ready,tasks:{bad:{...ready.tasks[A]}}},
  {...ready,tasks:{[A]:{...ready.tasks[A],projectFloat:null}}},
  {...incomplete,summaries:{[A]:{startDate:null,finishDate:null,calendarSpanDays:null,
    knownLeafCount:1,totalLeafCount:2,containsCritical:true}}},
  {...incomplete,partialAnalysis:{...incomplete.partialAnalysis,
    coverage:{analyzedLeafCount:2,blockedLeafCount:0}}},
  {...incomplete,partialAnalysis:{...incomplete.partialAnalysis,partialCriticalTaskIds:[U]}},
])('rejects malformed record keys and incompatible live analysis fields',value=>{
  expect(scheduleResultV2Schema.safeParse(value).success).toBe(false);
});
```

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
  const unavailable=new Set(input.unavailableTaskIds??[]);
  const parents=new Set(input.tasks.flatMap(t=>t.parentId===null?[]:[t.parentId]));
  const leaves=input.tasks.filter(t=>!parents.has(t.id)).toSorted((a,b)=>a.id<b.id?-1:a.id>b.id?1:0);
  const leafIds=leaves.map(t=>t.id);
  const vertices=new Map<string,CpmVertex>();
  for(const t of leaves) {
    if(unavailable.has(t.id)) continue;
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

**Files:** Modify `src/domain/scheduling.ts`, `src/domain/explicit-cpm.ts`, `tests/optional-scheduling.test.ts`; tests из B. B/C — один testable deliverable и один writer/commit.

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

В `projectExplicitSchedule` accepted Task2 body сохраняет iterative graph/summary/display aggregation. Применить **конкретные** source/FS изменения ниже к leaf/edge loops (идентификаторы task/id/edge/diagnostic уже определены в Task2 body):

```ts
// Every leaf source error is incomplete, not a proved scheduling conflict.
diagnostic('INVALID_INTERVAL', [id], [], 'incomplete'); // invalid start or finish syntax
diagnostic('INVALID_DURATION', [id], [], 'incomplete'); // invalid saved duration
// In the full-pair validateSourceInput catch:
diagnostic(error.code, [id], [], 'incomplete');
// Missing pair branch after the full-pair validation branch:
if(real === null && !unavailable.has(id) && (task.inputStart === null || task.inputFinish === null))
  diagnostic('UNKNOWN_INTERVAL', [id], [], 'incomplete');
// FS required-bound validation, replacing NON_WORKING_DATE and caught INVALID_INTERVAL:
diagnostic('INVALID_PRECEDENCE_BOUNDARY', taskIds, [edge.id], 'incomplete');
// Keep UNKNOWN_PRECEDENCE when a required edge bound is absent.
// Keep EXPLICIT_PRECEDENCE_CONFLICT with default error severity when f > successor s.
// Graph diagnostics keep error severity and existing early return before source loops.
// Immediately after Task4 unavailable-ID references are checked:
if(infeasible) return finishResult(); // INVALID_UNAVAILABLE_TASK is a malformed input.
```

`INVALID_INTERVAL`/`INVALID_DURATION` source checks continue once after recording the error, retaining existing valid start anchor and invalidDisplay behavior. Не добавлять UNKNOWN_INTERVAL после этих continue; full invalid pair получает только error.code. Source errors не меняют `infeasible`, поэтому все FS edges продолжают проверяться. Result initializer/finishResult используют ExplicitProjection и не содержат analysisStatus/global IDs. Task4 `unavailable` Set/grouped LEGACY_INTERVAL_UNAVAILABLE/INVALID_UNAVAILABLE_TASK checks сохраняются; real copy condition остаётся `real !== null && !unavailable.has(id)`. KnownStartMin собирается до этой condition и не теряет marked source minima. Raw FS loop никогда не пропускает marked endpoint.

### Адаптация существующего Task2 test suite после live switch

`tests/optional-scheduling.test.ts` сохраняет **все** существующие source/summary/display/FS/graph/calendar/immutability cases принятого Task2 `f0412fd`. Task5 уже перенёс imports в active modules; TaskC добавляет live classification, сохраняя independent literal expected реальных полей. Existing `schedule` helper возвращает LiveResult и вызывает единственный calculateSchedule. Сравнения старых real maps используют явное выделение полей, не урезание production response.

```ts
// Imports in tests/optional-scheduling.test.ts after Task5:
import {calculateSchedule,conditionalFinish} from '../src/domain/scheduling.js';
import {validateDependency} from '../src/domain/planning.js';
import type {LiveResult,RealTask,OptionalSummary,OptionalTask,CalendarType,
  SchedulingDependency} from '../src/domain/scheduling-types.js';
import {frozenPendingScheduleV2Schema,liveScheduleResultV2Schema,
  type FrozenPendingScheduleV2} from '../src/shared/contracts.js';
const schedule=(
  tasks:readonly OptionalTask[],dependencies:readonly SchedulingDependency[]=[],
  calendarType:CalendarType='weekdays',
):LiveResult=>calculateSchedule({calendarType,tasks,dependencies});
const realOnly=(value:RealTask):RealTask=>({
  startDate:value.startDate,finishDate:value.finishDate,calendarSpanDays:value.calendarSpanDays,
});
const summaryOnly=(value:OptionalSummary):OptionalSummary=>({
  ...realOnly(value),knownLeafCount:value.knownLeafCount,totalLeafCount:value.totalLeafCount,
});
const realTaskMap=(result:LiveResult)=>Object.fromEntries(
  Object.entries(result.tasks).map(([id,value])=>[id,realOnly(value)]),
);
const unknownDiagnostics=(ids:readonly string[])=>ids.map(id=>({
  code:'UNKNOWN_INTERVAL',taskIds:[id],dependencyIds:[],messageKey:'scheduling.UNKNOWN_INTERVAL',
}));
```

Точные substitutions в existing assertions: `expect(result.tasks.A).toEqual(unknown)` → `expect(realOnly(result.tasks.A!)).toEqual(unknown)`; все другие full real task equality и `result.tasks` map equality аналогично через realOnly/realTaskMap. Summary equality использует summaryOnly, включая loop глубины; исходные literal даты/counts/span/display expectations сохраняются. Narrow graph validator называется validateDependency после Task5; заменить только импорт/вызов validateOptionalDependency. Result type equality проверяет LiveResult ↔ live schema; OptionalResult ↔ union остаётся в contract suite TaskA.

Обязательные замены status/diagnostic expectations задаёт следующая literal таблица; остальные assertions/fixtures не удалять и не skip:

| Existing test | Live expected adjustment |
|---|---|
| N02 missing C | incomplete/incomplete, UNKNOWN_INTERVAL C, ordinary floats null, summary containsCritical null |
| Full N02 | ready; A float4/4, B0/0, C1/1, critical B only; real span6 unchanged |
| No inferred boundary / done C | incomplete; UNKNOWN_INTERVAL A/B; C remains real/done with ordinary null floats |
| Saved invalid source table | incomplete with the existing INVALID_INTERVAL or DURATION_MISMATCH code only |
| Empty pending result | exact live empty ready object below; frozen empty pending remains separately parsed |
| N03 missing intervals | UNKNOWN_INTERVAL A/B/C sorted; same display/anchor |
| Finish-only B/start-only D | UNKNOWN_INTERVAL B/D; same finish note/display |
| Invalid one-sided finish/duration | preserved INVALID_INTERVAL or INVALID_DURATION, plus UNKNOWN_INTERVAL B; no second source diagnostic on A |
| Root/branch anchor exclusions | UNKNOWN_INTERVAL A/C/D/RootKnown/RootMissing sorted; display still empty |
| Weekend source/display | incomplete; UNKNOWN_INTERVAL A/B; no FS-bound diagnostic without edges |
| Known finish-only/start-only FS | incomplete; UNKNOWN_INTERVAL A/B and no UNKNOWN_PRECEDENCE |
| Unknown A→known B | UNKNOWN_INTERVAL A plus existing UNKNOWN_PRECEDENCE AB |
| Conflict A→B plus U→B | EXPLICIT_PRECEDENCE_CONFLICT AB, UNKNOWN_INTERVAL U, UNKNOWN_PRECEDENCE UB |
| Nonworking required FS bound | incomplete; INVALID_PRECEDENCE_BOUNDARY AB, UNKNOWN_INTERVAL A/B |
| Conditional B with no edge / with AB | UNKNOWN_INTERVAL B / UNKNOWN_INTERVAL B plus UNKNOWN_PRECEDENCE AB |
| Deep missing B | incomplete; UNKNOWN_INTERVAL B; every summary containsCritical null while real fields/counts unchanged |
| Graph malformed/cycle/duplicate snapshots | infeasible live shape (null horizon/partial and ordinary analysis); original graph diagnostics/coverage/real blank maps preserved, no additional source diagnostics |

Следующие runnable tests добавляются в тот же suite; `t`/`n02`/`e` уже определены принятым файлом Task2, а helper names выше заменяют существующие imports/schedule.

```ts
it('retains N02 real projection while asserting live incomplete fields',()=>{
  const r=schedule(n02());
  expect(r.analysisStatus).toBe('incomplete');expect(r.feasibility).toBe('incomplete');
  expect(realOnly(r.tasks.C!)).toEqual({startDate:null,finishDate:null,calendarSpanDays:null});
  expect(summaryOnly(r.summaries.P!)).toEqual({startDate:null,finishDate:null,calendarSpanDays:null,
    knownLeafCount:2,totalLeafCount:3});
  expect(r.summaries.P!.containsCritical).toBeNull();
  expect(r.diagnostics).toEqual(unknownDiagnostics(['C']));
});
it('retains complete N02 dates with independently expected live floats',()=>{
  const tasks=n02();tasks[3]=t('C','P','2026-10-07','2026-10-09',3);
  const r=schedule(tasks);
  if(r.analysisStatus!=='ready') throw new Error('Expected ready');
  expect(r.tasks.A).toMatchObject({projectFloat:4,constraintFloat:4});
  expect(r.tasks.B).toMatchObject({projectFloat:0,constraintFloat:0});
  expect(r.tasks.C).toMatchObject({projectFloat:1,constraintFloat:1});
  expect(r.criticalTaskIds).toEqual(['B']);expect(r.criticalDependencyIds).toEqual([]);
  expect(r.summaries.P!.containsCritical).toBe(true);
});
it('replaces empty current pending with empty live and preserves frozen pending literally',()=>{
  const live={analysisStatus:'ready',feasibility:'feasible',coverage:{knownLeafCount:0,totalLeafCount:0},
    tasks:{},summaries:{},display:{},horizonFinishDate:null,partialAnalysis:null,
    criticalTaskIds:[],criticalDependencyIds:[],diagnostics:[]};
  expect(schedule([])).toEqual(live);
  const frozen:FrozenPendingScheduleV2={analysisStatus:'pending-policy',feasibility:'feasible',
    coverage:{knownLeafCount:0,totalLeafCount:0},tasks:{},summaries:{},display:{},
    criticalTaskIds:[],criticalDependencyIds:[],diagnostics:[]};
  expect(frozenPendingScheduleV2Schema.parse(frozen)).toEqual(frozen);
  expect(liveScheduleResultV2Schema.safeParse(frozen).success).toBe(false);
});
```

Graph expected literals заменяют pending fields на live `analysisStatus:'infeasible'`/`horizonFinishDate:null`/`partialAnalysis:null`; каждая task запись дополняется null projectFloat/constraintFloat, summary — containsCritical:null. Это новые строгие expected snapshots, а не вызов calculator для expected.


```ts
const graphErrors=new Set(['DUPLICATE_TASK_ID','INVALID_PARENT','TREE_CYCLE',
  'DUPLICATE_DEPENDENCY_ID','DEPENDENCY_TASK_NOT_FOUND','SELF_DEPENDENCY',
  'DEPENDENCY_REQUIRES_LEAVES','DUPLICATE_DEPENDENCY','DEPENDENCY_CYCLE',
  'INVALID_PROJECT_CALENDAR','INVALID_UNAVAILABLE_TASK']);
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
  const unavailable=new Set(input.unavailableTaskIds??[]);
  const diagnostics=projection.diagnostics.map(d=>({
    ...d,taskIds:[...d.taskIds].sort(),dependencyIds:[...d.dependencyIds].sort(),
  }));
  const diagnosticKeys=new Set(diagnostics.map(d=>JSON.stringify([d.code,d.taskIds,d.dependencyIds])));
  const sourceErrorIds=new Set(diagnostics.filter(d=>
    ['INVALID_INTERVAL','DURATION_MISMATCH','INVALID_DURATION'].includes(d.code)&&
    d.taskIds.length===1&&d.dependencyIds.length===0).map(d=>d.taskIds[0]!));
  const add=(code:string,id:string) => {
    const key=JSON.stringify([code,[id],[]]);
    if(diagnosticKeys.has(key)) return;
    diagnosticKeys.add(key);
    diagnostics.push({code,taskIds:[id],dependencyIds:[],messageKey:'scheduling.'+code});
  };
  const unavailableLeaves=Object.keys(projection.tasks).filter(id=>unavailable.has(id)).sort();
  if(unavailableLeaves.length&&!diagnostics.some(d=>graphErrors.has(d.code))){
    const key=JSON.stringify(['LEGACY_INTERVAL_UNAVAILABLE',unavailableLeaves,[]]);
    if(!diagnosticKeys.has(key)){
      diagnosticKeys.add(key);
      diagnostics.push({code:'LEGACY_INTERVAL_UNAVAILABLE',taskIds:unavailableLeaves,
        dependencyIds:[],messageKey:'scheduling.LEGACY_INTERVAL_UNAVAILABLE'});
    }
  }
  if(!diagnostics.some(d=>graphErrors.has(d.code))) for(const id of Object.keys(projection.tasks).sort()) {
    if(unavailable.has(id)||sourceErrorIds.has(id)) continue;
    const t=taskById.get(id)!;
    if(realInterval(t,input.calendarType)!==null) continue;
    if(t.inputStart===null||t.inputFinish===null){
      add('UNKNOWN_INTERVAL',id);
    }
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

Projection must emit exactly one source diagnostic per unknown/invalid leaf. It must never add UNKNOWN_INTERVAL alongside INVALID_INTERVAL/DURATION_MISMATCH/INVALID_DURATION for the same invalid source. The constructor builds canonical diagnosticKeys once and deduplicates each add with Set.has; it never scans the growing diagnostics array per leaf. The 10000 independent unknown-leaf test instruments Array.some callback work (at most 20N), so a quadratic deduplication loop fails without a timing-only oracle. Copy diagnostic sort keys use ordinal string comparison. Legacy-specific saved diagnosis can coexist but never supplies a real interval. A partial missing pair retaining finish-only source is unknown even if display is known.

C17 handoff реализуется exact private/pure contract выше: Task4 PrivateSnapshotV2.legacyIntervalUnavailable → Task5 OptionalInput.unavailableTaskIds. Source-only OptionalTask не получает public provenance. Task4 implementation/review и Task5 pass-through/undo/clear persistence обязательны до Task7; новый amended annex требует двух independent reviews. P06/N06-done описывают обычные unmarked explicit done интервалы.

- [ ] **Step 4: Run GREEN.** `npm test -- tests/explicit-cpm-contracts.test.ts tests/explicit-cpm.test.ts tests/calendar.test.ts tests/optional-scheduling.test.ts`; after Task 5 suite name is still `optional-scheduling.test.ts` unless integrator moved it explicitly. Then `npm run typecheck`, `npm run lint`, `npm run test:unit` and independent oracle. No skip/empty suites.
- [ ] **Step 5: Commit B/C together.** Stage `src/domain/explicit-cpm.ts`, `src/domain/scheduling.ts`, fixture/tests and package unit list; staged guard/Gitleaks and normal hooks; commit `feat: analyze explicit task intervals and partial components`. Two independent reviews of this SHA include literal floats/IDs/diagnostics, immutability, complexity and negative-origin invariance.

### Task D: Atomic server result, undo, restart и frozen retry

**Files:** Modify `src/server/repository.ts`, `tests/scheduling-api.test.ts`, `tests/optional-migration.test.ts`; create `tests/explicit-cpm-repository.test.ts`; modify integration list in `package.json`.

**Interfaces:** Consumes Task5 Repository: `createProject(title): Project`, `getTree(projectId,sessionId): ProjectTreeV2`, `getSchedule(projectId): ScheduleResponseV2`, `applyCommand(projectId,CommandEnvelopeV2,sessionId): ProjectTreeV2`, `replayLegacy(projectId,body:unknown,sessionId): ProjectTreeV2` and `openDatabase(path)` for newly created/schema3 synthetic DB. Existing mutate/save/snapshot seams use PrivateSnapshotV2; transaction parses live public response before commit and caches exact result. Command body/header contract remains V2.

- [ ] **Step 1: Write independently expected P04→P05→undo→restart test.** Новый test file целиком создаёт disposable DB; не читает application runtime. Exact task/dependency IDs создаёт Repository; ожидаемые множества берутся по literal titles/from-to mapping, не из calculator.

Current server paths используют **live-only** validators. В `repository.ts` импортировать live schemas/types и union projectTreeV2Schema. Existing safe wrapper сохраняет internal Error (HTTP500), не выбрасывает ZodError для HTTP400:

```ts
function validatedTreeResponse(value:unknown):LiveProjectTreeV2 {
  const parsed=liveProjectTreeV2Schema.safeParse(value);
  if(!parsed.success) throw new Error('Invalid internal tree response');
  return parsed.data;
}
function validatedScheduleResponse(value:unknown):LiveScheduleResponseV2 {
  const parsed=liveScheduleResponseV2Schema.safeParse(value);
  if(!parsed.success) throw new Error('Invalid internal schedule response');
  return parsed.data;
}
function validatedCachedTreeResponse(value:unknown):ProjectTreeV2 {
  const parsed=projectTreeV2Schema.safeParse(value);
  if(!parsed.success) throw new Error('Invalid internal cached tree response');
  return parsed.data;
}
// Replace only this method inside the existing Repository class:
class Repository {
private calculate(snapshot:PrivateSnapshotV2):LiveScheduleResultV2 {
  const parsed=liveScheduleResultV2Schema.safeParse(calculateSchedule({
    calendarType:snapshot.project.calendarType,tasks:snapshot.tasks,
    dependencies:snapshot.dependencies,
    unavailableTaskIds:snapshot.legacyIntervalUnavailable,
  }));
  if(!parsed.success) throw new Error('Invalid internal schedule response');
  return parsed.data;
}
}
```

`private calculate` — method fragment внутри существующего Repository class, не top-level function; `PrivateSnapshotV2` импортируется только из server/optional-snapshot. `getTree` и current mutation response вызывают validatedTreeResponse; `getSchedule`/route используют validatedScheduleResponse. New operation response сохраняется только после этих live validators в той же transaction. `findOperation`/`replayLegacy` проверяют digest и вызывают validatedCachedTreeResponse без solver; union применяется только к stored historical replies/client parsing. Fresh pending result никогда не проходит current precommit boundary.

Task5 уже заменяет snapshot/save/undo на PrivateSnapshotV2 и сохраняет provenance table; Task7 проверяет exact pass-through выше. В существующем getTree нельзя spread private snapshot. Public construction имеет следующую literal форму; canUndo expression использует existing latestUndo:

```ts
return validatedTreeResponse({
  contractVersion:2,
  project:snapshot.project,tasks:snapshot.tasks,dependencies:snapshot.dependencies,
  schedule:this.calculate(snapshot),
  canUndo:this.latestUndo(projectId,sessionId)?.afterRevision===snapshot.project.revision,
});
// Existing getSchedule transaction returns:
return validatedScheduleResponse({
  contractVersion:2,projectId,revision:snapshot.project.revision,
  schedule:this.calculate(snapshot),
});
```

На Task5 task.edit seam source patch извлекается только из defined keys. Следующий exact fragment находится внутри существующего case с task/snapshot/command/timestamp/find/hasChildren; private helper принадлежит Task4, Repository public signature не расширяется:

```ts
const patch:SourcePatch={};
if(command.changes.inputStart!==undefined)patch.inputStart=command.changes.inputStart;
if(command.changes.inputFinish!==undefined)patch.inputFinish=command.changes.inputFinish;
if(command.changes.durationDays!==undefined)patch.durationDays=command.changes.durationDays;
const returnsToWork=task.status==='done'&&
  (command.changes.status==='todo'||command.changes.status==='doing');
if(task.status==='done'&&Object.keys(patch).length&&!returnsToWork)
  throw new DomainError('DONE_PLANNING','Верните завершённую задачу в работу перед изменением сроков.');
if(hasChildren(task.id)&&Object.keys(patch).length)
  throw new DomainError('SUMMARY_DATES','Сводная задача не имеет собственных сроков.');
const marked=new Set(snapshot.legacyIntervalUnavailable);
const reopenedStatus=command.changes.status==='todo'||command.changes.status==='doing'
  ?command.changes.status:undefined;
const outcome=applyPrivateSourcePatch(task,patch,snapshot.project.calendarType,
  marked.has(task.id),reopenedStatus);
Object.assign(task,outcome.task,{updatedAt:timestamp});
if(command.changes.title!==undefined)task.title=command.changes.title;
if(command.changes.description!==undefined)task.description=command.changes.description;
if(command.changes.status!==undefined)task.status=command.changes.status;
if(outcome.unavailable)marked.add(task.id);else marked.delete(task.id);
snapshot.legacyIntervalUnavailable=[...marked].sort();
```

Imports SourcePatch из shared/contracts, applyPrivateSourcePatch/PrivateSnapshotV2/privateSnapshotV2Schema из server/optional-snapshot. Task5 save синхронизирует private marker rows в той же transaction; undo читает privateSnapshotV2Schema и восстанавливает их вместе с tasks. Details/status/calendar/edges не вызывают explicit source acknowledgement; preserveWork переносит marker на work child. SQL/pin/migration acknowledgement/frozen outcome conversion остаются под review Task4 и не дублируются Task7.


```ts
import {afterEach,beforeEach,expect,it,vi} from 'vitest';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {randomUUID,createHash} from 'node:crypto';
import {openDatabase} from '../src/server/database.js';
import {Repository} from '../src/server/repository.js';
import * as scheduling from '../src/domain/scheduling.js';
import {projectTreeV2Schema,snapshotV2Schema,taskV2Schema,commandV2Schema,
  type ProjectTreeV2,type CommandV2} from '../src/shared/contracts.js';
import {privateSnapshotV2Schema} from '../src/server/optional-snapshot.js';
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
it('live calendar change preserves sources, recalculates P10 once and undoes once',()=>{
  const project=repository.createProject('Synthetic calendar CPM');
  let before=repository.getTree(project.id,session);
  before=step(before,{type:'project.schedule',changes:{calendarType:'weekdays'}});
  for(const title of ['A','B']) before=step(before,{type:'task.create',title,parentId:null});
  const by=ids(before);
  before=step(before,{type:'task.edit',taskId:by.A!,
    changes:{inputStart:'2026-10-09',inputFinish:'2026-10-09'}});
  before=step(before,{type:'task.edit',taskId:by.B!,
    changes:{inputStart:'2026-10-12',inputFinish:'2026-10-13'}});
  before=step(before,{type:'dependency.create',predecessorId:by.A!,successorId:by.B!});
  const ab=before.dependencies[0]!.id;
  assertFloats(before,[['A',0,0],['B',0,0]]);
  expect(before.schedule.criticalTaskIds).toEqual([by.A!,by.B!].sort());
  expect(before.schedule.criticalDependencyIds).toEqual([ab]);
  const sources=before.tasks.map(t=>({id:t.id,inputStart:t.inputStart,
    inputFinish:t.inputFinish,durationDays:t.durationDays,status:t.status}));
  const after=step(before,{type:'project.schedule',changes:{calendarType:'all-days'}});
  expect(after.project.revision).toBe(before.project.revision+1);
  expect(after.project.calendarType).toBe('all-days');
  expect(after.tasks.map(t=>({id:t.id,inputStart:t.inputStart,inputFinish:t.inputFinish,
    durationDays:t.durationDays,status:t.status}))).toEqual(sources);
  assertFloats(after,[['A',2,2],['B',0,0]]);
  expect(after.schedule.criticalTaskIds).toEqual([by.B!]);
  expect(after.schedule.criticalDependencyIds).toEqual([]);
  const undone=step(after,{type:'undo'});
  expect(undone.project.revision).toBe(after.project.revision+1);
  expect(undone.project.calendarType).toBe('weekdays');
  expect(undone.tasks).toEqual(before.tasks);
  expect(undone.dependencies).toEqual(before.dependencies);
  expect(undone.schedule).toEqual(before.schedule);
  assertFloats(undone,[['A',0,0],['B',0,0]]);
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

В тот же `tests/explicit-cpm-repository.test.ts` добавить concrete fault tests и done semantics (setup/step/p04 уже определены выше):

```ts
function rawState(projectId:string) {
  return {
    project:db.prepare('SELECT * FROM projects WHERE id=?').get(projectId),
    tasks:db.prepare('SELECT * FROM tasks WHERE projectId=? ORDER BY id').all(projectId),
    dependencies:db.prepare('SELECT * FROM dependencies WHERE projectId=? ORDER BY id').all(projectId),
    operations:db.prepare('SELECT * FROM operations WHERE projectId=? ORDER BY operationId').all(projectId),
    undo:db.prepare('SELECT * FROM undo_snapshots WHERE projectId=? ORDER BY sequence').all(projectId),
    provenance:db.prepare('SELECT p.taskId,p.reason FROM task_schedule_provenance p JOIN tasks t ON t.id=p.taskId WHERE t.projectId=? ORDER BY p.taskId').all(projectId),
  };
}
it.each(['pending','infeasible-with-partial'] as const)('rolls back invalid fresh %s outcome',kind=>{
  const before=p04(),by=ids(before),state=rawState(before.project.id);
  const injected=kind==='pending'?{
    analysisStatus:'pending-policy',feasibility:'feasible',coverage:{knownLeafCount:0,totalLeafCount:0},
    tasks:{},summaries:{},display:{},criticalTaskIds:[],criticalDependencyIds:[],diagnostics:[],
  }:{
    analysisStatus:'infeasible',feasibility:'infeasible',coverage:{knownLeafCount:0,totalLeafCount:0},
    tasks:{},summaries:{},display:{},horizonFinishDate:null,criticalTaskIds:[],criticalDependencyIds:[],
    diagnostics:[],partialAnalysis:{labelKey:'scheduling.PARTIAL_ANALYSIS',knownHorizonFinishDate:'2026-10-11',
      coverage:{analyzedLeafCount:0,blockedLeafCount:0},tasks:{},partialCriticalTaskIds:[],
      partialCriticalDependencyIds:[],partialCriticalSummaryIds:[]},
  };
  const spy=vi.spyOn(scheduling,'calculateSchedule').mockReturnValueOnce(
    injected as unknown as ReturnType<typeof scheduling.calculateSchedule>);
  expect(()=>step(before,{type:'task.edit',taskId:by.A!,changes:{
    title:'Rejected synthetic edit',inputFinish:'2026-10-07',
  }})).toThrow('Invalid internal schedule response');
  spy.mockRestore();
  expect(rawState(before.project.id)).toEqual(state);
  expect(repository.getTree(before.project.id,session)).toEqual(before);
});
it('done keeps structural float and only explicit return permits source edit with undo',()=>{
  const project=repository.createProject('Synthetic done CPM');
  let t=repository.getTree(project.id,session);
  t=step(t,{type:'project.schedule',changes:{calendarType:'all-days'}});
  for(const title of ['A','B','C'])t=step(t,{type:'task.create',title,parentId:null});
  const by=ids(t);
  for(const [name,inputStart,inputFinish] of [
    ['A','2026-10-05','2026-10-06'],['B','2026-10-10','2026-10-10'],
    ['C','2026-10-05','2026-10-14'],
  ] as const)t=step(t,{type:'task.edit',taskId:by[name]!,changes:{inputStart,inputFinish}});
  t=step(t,{type:'dependency.create',predecessorId:by.A!,successorId:by.B!});
  const done=step(t,{type:'task.edit',taskId:by.B!,changes:{status:'done'}});
  assertFloats(done,[['A',7,3],['B',4,0],['C',0,0]]);
  const state=rawState(project.id);
  expect(()=>step(done,{type:'task.edit',taskId:by.B!,changes:{inputFinish:'2026-10-11'}}))
    .toThrowError(expect.objectContaining({code:'DONE_PLANNING'}));
  expect(rawState(project.id)).toEqual(state);
  const working=step(done,{type:'task.edit',taskId:by.B!,changes:{status:'doing',inputFinish:'2026-10-11'}});
  expect(working.project.revision).toBe(done.project.revision+1);
  assertFloats(working,[['A',6,3],['B',3,3],['C',0,0]]);
  const undone=step(working,{type:'undo'});
  expect(undone.tasks).toEqual(done.tasks);expect(undone.schedule).toEqual(done.schedule);
});
```

C17 server regressions добавить в тот же `tests/explicit-cpm-repository.test.ts`. Setup/step/rawState/db/path/repository/session/scheduling/UUID imports определены выше. Marker rows вставляются только в собственную schema3 synthetic DB как literal migrated starting fixture; production migration не запускается.

```ts
function provenance(projectId:string) {
  return db.prepare('SELECT p.taskId,p.reason FROM task_schedule_provenance p JOIN tasks t ON t.id=p.taskId WHERE t.projectId=? ORDER BY p.taskId').all(projectId);
}
function c17Stored() {
  const project=repository.createProject('Synthetic C17 provenance');
  let tree=repository.getTree(project.id,session);
  tree=step(tree,{type:'project.schedule',changes:{calendarType:'all-days'}});
  tree=step(tree,{type:'task.create',title:'P',parentId:null});
  const p=tree.tasks.find(t=>t.title==='P')!.id;
  for(const [title,parentId] of [['D',p],['K',p],['C',null]] as const)
    tree=step(tree,{type:'task.create',title,parentId});
  const by=ids(tree);
  tree=step(tree,{type:'task.edit',taskId:by.D!,changes:{
    inputStart:'2026-10-05',inputFinish:'2026-10-07',durationDays:3,status:'done'}});
  tree=step(tree,{type:'task.edit',taskId:by.K!,changes:{
    inputStart:'2026-10-09',inputFinish:'2026-10-10'}});
  tree=step(tree,{type:'task.edit',taskId:by.C!,changes:{
    inputStart:'2026-10-05',inputFinish:'2026-10-08'}});
  tree=step(tree,{type:'dependency.create',predecessorId:by.D!,successorId:by.K!});
  expect(tree.schedule.analysisStatus).toBe('ready'); // ordinary explicit done control
  db.prepare("INSERT INTO task_schedule_provenance(taskId,reason) VALUES (?, 'legacy-interval-unavailable')").run(by.D!);
  return {tree:repository.getTree(project.id,session),by};
}
function assertC17Unknown(tree:ProjectTreeV2,by:Record<string,string>) {
  expect(tree.schedule.analysisStatus).toBe('incomplete');
  if(tree.schedule.analysisStatus!=='incomplete')throw new Error('Expected incomplete');
  expect(tree.schedule.coverage).toEqual({knownLeafCount:2,totalLeafCount:3});
  expect(tree.schedule.tasks[by.D!]).toEqual({startDate:null,finishDate:null,
    calendarSpanDays:null,projectFloat:null,constraintFloat:null});
  expect(tree.schedule.summaries[by.P!]).toEqual({startDate:null,finishDate:null,
    calendarSpanDays:null,knownLeafCount:1,totalLeafCount:2,containsCritical:null});
  expect(tree.schedule.partialAnalysis).toEqual({labelKey:'scheduling.PARTIAL_ANALYSIS',
    knownHorizonFinishDate:'2026-10-10',coverage:{analyzedLeafCount:1,blockedLeafCount:2},
    tasks:{[by.C!]:{knownHorizonFloat:2}},partialCriticalTaskIds:[],
    partialCriticalDependencyIds:[],partialCriticalSummaryIds:[]});
  expect(tree.schedule.diagnostics).toEqual([{code:'LEGACY_INTERVAL_UNAVAILABLE',
    taskIds:[by.D!],dependencyIds:[],messageKey:'scheduling.LEGACY_INTERVAL_UNAVAILABLE'}]);
  expect(tree.schedule.criticalTaskIds).toEqual([]);expect(tree.schedule.criticalDependencyIds).toEqual([]);
  expect(provenance(tree.project.id)).toEqual([{taskId:by.D!,reason:'legacy-interval-unavailable'}]);
  expect(tree).not.toHaveProperty('legacyIntervalUnavailable');
  expect(tree).not.toHaveProperty('unavailableTaskIds');
  expect(tree.tasks.find(t=>t.id===by.D!)).toMatchObject({
    inputStart:'2026-10-05',inputFinish:'2026-10-07',durationDays:3});
}
it('passes private provenance into every current pure calculation without public leakage',()=>{
  const {tree:before,by}=c17Stored(),state=rawState(before.project.id);
  const spy=vi.spyOn(scheduling,'calculateSchedule');
  const tree=repository.getTree(before.project.id,session);
  assertC17Unknown(tree,by);
  expect(repository.getSchedule(before.project.id).schedule).toEqual(tree.schedule);
  const edited=step(tree,{type:'task.edit',taskId:by.D!,changes:{description:'Synthetic detail'}});
  expect(edited.project.revision).toBe(tree.project.revision+1);assertC17Unknown(edited,by);
  expect(spy).toHaveBeenCalled();
  for(const [input] of spy.mock.calls){
    expect(input.unavailableTaskIds).toEqual([by.D!]);
    expect(input.tasks.find(t=>t.id===by.D!)).toMatchObject({
      inputStart:'2026-10-05',inputFinish:'2026-10-07',durationDays:3,status:'done'});
  }
  expect(rawState(before.project.id).operations).toHaveLength(state.operations.length+1);
  spy.mockRestore();
  db.close();db=openDatabase(path);repository=new Repository(db);
  const reopened=repository.getTree(before.project.id,session);
  expect(reopened.schedule).toEqual(edited.schedule);assertC17Unknown(reopened,by);
});
it('validated equal source acknowledgement requires original done return and undo/reopen restores unknown',()=>{
  const {tree:before,by}=c17Stored(),state=rawState(before.project.id);
  expect(()=>step(before,{type:'task.edit',taskId:by.D!,changes:{inputStart:'2026-10-05'}})).toThrow();
  expect(rawState(before.project.id)).toEqual(state);
  expect(()=>step(before,{type:'task.edit',taskId:by.D!,changes:{
    status:'doing',title:'Rejected invalid source',durationDays:2}})).toThrow();
  expect(rawState(before.project.id)).toEqual(state);
  const acknowledged=step(before,{type:'task.edit',taskId:by.D!,changes:{
    status:'doing',inputStart:'2026-10-05'}});
  expect(acknowledged.project.revision).toBe(before.project.revision+1);
  expect(provenance(before.project.id)).toEqual([]);
  expect(acknowledged.tasks.find(t=>t.id===by.D!)).toMatchObject({
    status:'doing',inputStart:'2026-10-05',inputFinish:'2026-10-07',durationDays:3});
  if(acknowledged.schedule.analysisStatus!=='ready')throw new Error('Expected ready');
  expect(acknowledged.schedule.tasks[by.D!]).toMatchObject({projectFloat:1,constraintFloat:1});
  expect(acknowledged.schedule.criticalTaskIds).toEqual([by.K!]);
  expect(acknowledged.schedule.criticalDependencyIds).toEqual([]);
  const row=db.prepare('SELECT beforeSnapshot FROM undo_snapshots WHERE projectId=? ORDER BY sequence DESC LIMIT 1')
    .get(before.project.id) as {beforeSnapshot:string};
  expect(privateSnapshotV2Schema.parse(JSON.parse(row.beforeSnapshot)).legacyIntervalUnavailable).toEqual([by.D!]);
  const undone=step(acknowledged,{type:'undo'});
  expect(undone.tasks).toEqual(before.tasks);expect(undone.dependencies).toEqual(before.dependencies);
  expect(undone.schedule).toEqual(before.schedule);assertC17Unknown(undone,by);
  db.close();db=openDatabase(path);repository=new Repository(db);
  assertC17Unknown(repository.getTree(before.project.id,session),by);
});
it('status-only calendar and edge commands retain marker and source bytes',()=>{
  const {tree:before,by}=c17Stored();
  const source=before.tasks.find(t=>t.id===by.D!)!;
  const status=step(before,{type:'task.edit',taskId:by.D!,changes:{status:'doing'}});
  assertC17Unknown(status,by);
  const calendar=step(status,{type:'project.schedule',changes:{calendarType:'weekdays'}});
  expect(provenance(before.project.id)).toEqual([{taskId:by.D!,reason:'legacy-interval-unavailable'}]);
  expect(calendar.tasks.find(t=>t.id===by.D!)).toMatchObject({
    inputStart:source.inputStart,inputFinish:source.inputFinish,durationDays:source.durationDays,status:'doing'});
  expect(calendar.schedule.analysisStatus).toBe('incomplete');
  const deleted=step(calendar,{type:'dependency.delete',dependencyId:calendar.dependencies[0]!.id});
  const created=step(deleted,{type:'dependency.create',predecessorId:by.D!,successorId:by.K!});
  expect(provenance(before.project.id)).toEqual([{taskId:by.D!,reason:'legacy-interval-unavailable'}]);
  expect(created.schedule.diagnostics.some(d=>d.code==='LEGACY_INTERVAL_UNAVAILABLE')).toBe(true);
  const weekdayUndo=step(created,{type:'undo'});
  expect(provenance(before.project.id)).toEqual([{taskId:by.D!,reason:'legacy-interval-unavailable'}]);
  expect(weekdayUndo.tasks).toEqual(deleted.tasks);
});
it('marked raw FS conflict commits once, suppresses analysis and undo restores unknown partial',()=>{
  const {tree:before,by}=c17Stored(),state=rawState(before.project.id);
  const after=step(before,{type:'task.edit',taskId:by.K!,changes:{inputStart:'2026-10-07'}});
  expect(after.project.revision).toBe(before.project.revision+1);
  expect(rawState(before.project.id).operations).toHaveLength(state.operations.length+1);
  expect(rawState(before.project.id).undo).toHaveLength(state.undo.length+1);
  if(after.schedule.analysisStatus!=='infeasible')throw new Error('Expected infeasible');
  expect(after.schedule.partialAnalysis).toBeNull();
  expect(after.schedule.criticalTaskIds).toEqual([]);expect(after.schedule.criticalDependencyIds).toEqual([]);
  expect(after.schedule.diagnostics).toEqual([
    {code:'EXPLICIT_PRECEDENCE_CONFLICT',taskIds:[by.D!,by.K!].sort(),
      dependencyIds:[before.dependencies[0]!.id],messageKey:'scheduling.EXPLICIT_PRECEDENCE_CONFLICT'},
    {code:'LEGACY_INTERVAL_UNAVAILABLE',taskIds:[by.D!],dependencyIds:[],
      messageKey:'scheduling.LEGACY_INTERVAL_UNAVAILABLE'},
  ]);
  expect(provenance(before.project.id)).toEqual([{taskId:by.D!,reason:'legacy-interval-unavailable'}]);
  expect(after.tasks.find(t=>t.id===by.D!)).toEqual(before.tasks.find(t=>t.id===by.D!));
  const undone=step(after,{type:'undo'});
  expect(undone.schedule).toEqual(before.schedule);assertC17Unknown(undone,by);
});
it('preserveWork transfers marker to original work child and undo restores original marked leaf',()=>{
  const {tree:before,by}=c17Stored(),original=before.tasks.find(t=>t.id===by.D!)!;
  const parent=step(before,{type:'task.create',title:'New child',parentId:by.D!,preserveWork:true});
  const work=parent.tasks.find(t=>t.parentId===by.D&&t.status==='done'&&t.inputStart==='2026-10-05')!;
  expect(work).toBeDefined();
  expect(work).toMatchObject({inputStart:original.inputStart,inputFinish:original.inputFinish,
    durationDays:original.durationDays,status:'done'});
  expect(provenance(before.project.id)).toEqual([{taskId:work.id,reason:'legacy-interval-unavailable'}]);
  expect(parent.dependencies.find(e=>e.id===before.dependencies[0]!.id))
    .toMatchObject({predecessorId:work.id,successorId:by.K!});
  expect(parent.schedule.tasks[work.id]).toMatchObject({startDate:null,finishDate:null});
  const undone=step(parent,{type:'undo'});
  expect(undone.tasks).toEqual(before.tasks);expect(undone.dependencies).toEqual(before.dependencies);
  expect(undone.schedule).toEqual(before.schedule);assertC17Unknown(undone,by);
});
it('private schema rejects duplicate foreign or cross-project markers and public schemas reject provenance',()=>{
  const {tree,by}=c17Stored();
  const value={project:tree.project,tasks:tree.tasks,dependencies:tree.dependencies,
    legacyIntervalUnavailable:[by.D!]};
  expect(privateSnapshotV2Schema.parse(value)).toEqual(value);
  expect(privateSnapshotV2Schema.safeParse({...value,legacyIntervalUnavailable:[by.D!,by.D!]}).success).toBe(false);
  expect(privateSnapshotV2Schema.safeParse({...value,
    legacyIntervalUnavailable:['99999999-9999-4999-8999-999999999999']}).success).toBe(false);
  expect(privateSnapshotV2Schema.safeParse({...value,tasks:value.tasks.map(t=>t.id===by.D?
    {...t,projectId:'99999999-9999-4999-8999-999999999999'}:t)}).success).toBe(false);
  expect(snapshotV2Schema.safeParse(value).success).toBe(false);
  expect(projectTreeV2Schema.safeParse({...tree,legacyIntervalUnavailable:[by.D!]}).success).toBe(false);
  expect(taskV2Schema.safeParse({...tree.tasks.find(t=>t.id===by.D),unavailable:true}).success).toBe(false);
  expect(commandV2Schema.safeParse({type:'task.edit',taskId:by.D!,
    changes:{unavailableTaskIds:[]}}).success).toBe(false);
});
```

- [ ] **Step 2: Add HTTP tests.** Task5 headers()/send() уже содержат transport/body version2; создать runnable cases ниже.

В существующий `tests/scheduling-api.test.ts` (Task5 setup app/directory/headers/tree/send/step) добавить imports `Database` из better-sqlite3 и `projectTreeV2Schema`/`scheduleResponseV2Schema` из shared/contracts; then append:

```ts
import Database from 'better-sqlite3';
import {projectTreeV2Schema,scheduleResponseV2Schema} from '../src/shared/contracts.js';
function apiState(projectId:string) {
  const read=new Database(join(directory,'synthetic.sqlite'),{readonly:true});
  try{return {
    project:read.prepare('SELECT * FROM projects WHERE id=?').get(projectId),
    tasks:read.prepare('SELECT * FROM tasks WHERE projectId=? ORDER BY id').all(projectId),
    dependencies:read.prepare('SELECT * FROM dependencies WHERE projectId=? ORDER BY id').all(projectId),
    operations:read.prepare('SELECT * FROM operations WHERE projectId=? ORDER BY operationId').all(projectId),
    undo:read.prepare('SELECT * FROM undo_snapshots WHERE projectId=? ORDER BY sequence').all(projectId),
  };}finally{read.close();}
}
async function httpP10() {
  let t=await step(tree(),{type:'project.schedule',changes:{calendarType:'weekdays'}});
  for(const title of ['A','B'])t=await step(t,{type:'task.create',title,parentId:null});
  const by=Object.fromEntries(t.tasks.map(x=>[x.title,x.id]));
  t=await step(t,{type:'task.edit',taskId:by.A!,changes:{inputStart:'2026-10-09',inputFinish:'2026-10-09'}});
  t=await step(t,{type:'task.edit',taskId:by.B!,changes:{inputStart:'2026-10-12',inputFinish:'2026-10-13'}});
  t=await step(t,{type:'dependency.create',predecessorId:by.A!,successorId:by.B!});
  return {t,by};
}
it('HTTP calendar command recalculates P10 in one revision and undo restores it',async()=>{
  const {t:before,by}=await httpP10(),ab=before.dependencies[0]!.id;
  if(before.schedule.analysisStatus!=='ready')throw new Error('Expected ready');
  expect(before.schedule.tasks[by.A!]).toMatchObject({projectFloat:0,constraintFloat:0});
  expect(before.schedule.tasks[by.B!]).toMatchObject({projectFloat:0,constraintFloat:0});
  expect(before.schedule.criticalTaskIds).toEqual([by.A!,by.B!].sort());
  expect(before.schedule.criticalDependencyIds).toEqual([ab]);
  const after=await step(before,{type:'project.schedule',changes:{calendarType:'all-days'}});
  expect(after.project.revision).toBe(before.project.revision+1);
  expect(after.tasks).toEqual(before.tasks);
  if(after.schedule.analysisStatus!=='ready')throw new Error('Expected ready');
  expect(after.schedule.tasks[by.A!]).toMatchObject({projectFloat:2,constraintFloat:2});
  expect(after.schedule.tasks[by.B!]).toMatchObject({projectFloat:0,constraintFloat:0});
  expect(after.schedule.criticalTaskIds).toEqual([by.B!]);
  expect(after.schedule.criticalDependencyIds).toEqual([]);
  const get=await app.inject({url:'/api/projects/'+after.project.id+'/schedule',headers:headers()});
  expect(get.statusCode).toBe(200);
  expect(scheduleResponseV2Schema.parse(get.json()).schedule).toEqual(after.schedule);
  const undone=await step(after,{type:'undo'});
  expect(undone.project.revision).toBe(after.project.revision+1);
  expect(undone.project.calendarType).toBe('weekdays');
  expect(undone.tasks).toEqual(before.tasks);expect(undone.schedule).toEqual(before.schedule);
});
it('fresh pending injection gives internal500 and rolls back HTTP mutation and GETs',async()=>{
  const {t:before,by}=await httpP10(),state=apiState(before.project.id);
  const injected={analysisStatus:'pending-policy',feasibility:'feasible',
    coverage:{knownLeafCount:0,totalLeafCount:0},tasks:{},summaries:{},display:{},
    criticalTaskIds:[],criticalDependencyIds:[],diagnostics:[]};
  const spy=vi.spyOn(scheduling,'calculateSchedule');
  spy.mockReturnValueOnce(injected as unknown as ReturnType<typeof scheduling.calculateSchedule>);
  const response=await send(before,{type:'task.edit',taskId:by.A!,changes:{title:'Rejected internal edit'}});
  expect(response.statusCode).toBe(500);
  expect(response.json()).toEqual({code:'INTERNAL_ERROR',message:'Не удалось выполнить запрос.'});
  expect(apiState(before.project.id)).toEqual(state);
  for(const route of ['tree','schedule']){
    spy.mockReturnValueOnce(injected as unknown as ReturnType<typeof scheduling.calculateSchedule>);
    const get=await app.inject({url:'/api/projects/'+before.project.id+'/'+route,headers:headers()});
    expect(get.statusCode).toBe(500);
    expect(get.json()).toEqual({code:'INTERNAL_ERROR',message:'Не удалось выполнить запрос.'});
    expect(apiState(before.project.id)).toEqual(state);
  }
  spy.mockRestore();
});
it('HTTP conflict plus unknown commits once while invalid user triple rolls back',async()=>{
  let t=await step(tree(),{type:'project.schedule',changes:{calendarType:'all-days'}});
  for(const title of ['A','B','U'])t=await step(t,{type:'task.create',title,parentId:null});
  const by=Object.fromEntries(t.tasks.map(x=>[x.title,x.id]));
  t=await step(t,{type:'task.edit',taskId:by.A!,changes:{inputStart:'2026-10-05',inputFinish:'2026-10-06'}});
  t=await step(t,{type:'task.edit',taskId:by.B!,changes:{inputStart:'2026-10-07',inputFinish:'2026-10-09'}});
  t=await step(t,{type:'dependency.create',predecessorId:by.A!,successorId:by.B!});
  t=await step(t,{type:'dependency.create',predecessorId:by.B!,successorId:by.U!});
  const previous=apiState(t.project.id);
  const after=await step(t,{type:'task.edit',taskId:by.A!,changes:{inputFinish:'2026-10-07'}});
  const ab=after.dependencies.find(e=>e.predecessorId===by.A&&e.successorId===by.B)!.id;
  const bu=after.dependencies.find(e=>e.predecessorId===by.B&&e.successorId===by.U)!.id;
  expect(after.project.revision).toBe(t.project.revision+1);
  expect(apiState(t.project.id).operations).toHaveLength(previous.operations.length+1);
  expect(apiState(t.project.id).undo).toHaveLength(previous.undo.length+1);
  expect(after.schedule.analysisStatus).toBe('infeasible');
  if(after.schedule.analysisStatus!=='infeasible')throw new Error('Expected infeasible');
  expect(after.schedule.partialAnalysis).toBeNull();
  expect(after.schedule.criticalTaskIds).toEqual([]);expect(after.schedule.criticalDependencyIds).toEqual([]);
  expect(after.schedule.diagnostics).toEqual([
    {code:'EXPLICIT_PRECEDENCE_CONFLICT',taskIds:[by.A!,by.B!].sort(),dependencyIds:[ab],messageKey:'scheduling.EXPLICIT_PRECEDENCE_CONFLICT'},
    {code:'UNKNOWN_INTERVAL',taskIds:[by.U!],dependencyIds:[],messageKey:'scheduling.UNKNOWN_INTERVAL'},
    {code:'UNKNOWN_PRECEDENCE',taskIds:[by.B!,by.U!].sort(),dependencyIds:[bu],messageKey:'scheduling.UNKNOWN_PRECEDENCE'},
  ]);
  const state=apiState(t.project.id);
  const rejected=await send(after,{type:'task.edit',taskId:by.A!,changes:{title:'Rejected user edit',durationDays:9}});
  expect(rejected.statusCode).toBe(400);expect(apiState(t.project.id)).toEqual(state);
});
```

Task5 V2 headers/body helpers остаются обязательными; setup авторизует только disposable synthetic SQLite. Existing header426/origin/session tests продолжают выполняться без изменения.

- [ ] **Step 3: Preserve frozen legacy replay.** Добавить runnable durable regression ниже; принятый Task5 M08 продолжает выполняться.

#### Initial migration после подключения live CPM

Cached replies уже frozen и не вызывают math. Отдельно **initial** S2→003 migration/preview должна сохранять exact Task4 pending projection policy: она не вызывает live calculateSchedule или projectExplicitSchedule. Иначе новые UNKNOWN_INTERVAL/severity/C16 fields изменили бы archival conversion outcome. Server-only compatibility helper `projectLegacyPendingSchedule(input:LegacyPendingInput):FrozenPendingScheduleV2` копирует pure pending real/FS/summary/display body Task4, без CPM/Auto selection/product route. Active Repository имеет единственный live calculateSchedule.

**Files в TaskD дополнительно:** Create `src/server/legacy-pending-types.ts`, `legacy-pending-source.ts`, `legacy-pending-projection.ts`; Modify `src/server/legacy-compatibility.ts`/`optional-upgrade.ts`/`optional-migration.ts` и `tests/optional-migration.test.ts`. Frozen date arithmetic использует уже server-only `legacy-calendar.ts` Task3; source validation тоже frozen. В этих модулях нет runtime import active scheduling/planning/calendar. General DomainError class не вычисляет даты/severity; публичный exact frozen schema/type — неизменяемый archive contract.

Literal private type module целиком:

```ts
// src/server/legacy-pending-types.ts: server-only compatibility, not public task fields.
export type CalendarType='weekdays'|'all-days';
export interface SourceFields {
  inputStart:string|null;inputFinish:string|null;durationDays:number|null;
}
export type SourcePatch=Partial<SourceFields>;
export interface OptionalTask extends SourceFields {
  id:string;parentId:string|null;status:'todo'|'doing'|'done';
}
export interface SchedulingDependency {id:string;predecessorId:string;successorId:string}
export interface LegacyPendingInput {
  calendarType:CalendarType;tasks:readonly OptionalTask[];
  dependencies:readonly SchedulingDependency[];unavailableTaskIds?:readonly string[];
}
export interface RealTask {startDate:string|null;finishDate:string|null;calendarSpanDays:number|null}
export interface ConditionalDisplay {
  kind:'conditional';startDate:string;finishDate:string;clipped:boolean;
}
```

После записи types module выполнить следующий точный command из repository root. Он извлекает только public reviewed source blob; не читает .git history transcripts/runtime. `f5e92abf7d2cb9655cfe11e6173f70ae375df857` — Task4 substantive candidate с двумя independent APPROVED (Spec/Standards). Если меняется этот reviewed source body, сначала amend pin/tests и снова review annex. Command полностью создаёт оба frozen implementation modules без runtime live imports/unsafe casts, сохраняет прежнее тело/calculation/diagnostic severity:

```sh
node --input-type=module <<'JS'
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {writeFileSync} from 'node:fs';
const pin='f5e92abf7d2cb9655cfe11e6173f70ae375df857';
const read=path=>execFileSync('git',['show',pin+':'+path],{encoding:'utf8'});
const calendarBody=s=>s.replace(/^\/\/[^\n]*\n/,'').replace(/^import type[^\n]*\n/,'');
assert.equal(calendarBody(read('src/domain/calendar.ts')),
  calendarBody(read('src/server/legacy-calendar.ts')),'Frozen calendar must match Task4 arithmetic');
const header='// Frozen pending projection from '+pin+'; server-only migration compatibility.\n';
let source=read('src/domain/optional-planning.ts')
  .replaceAll("'./scheduling-types.js'","'./legacy-pending-types.js'")
  .replaceAll("'./tree.js'","'../domain/tree.js'")
  .replaceAll("'./calendar.js'","'./legacy-calendar.js'")
  .replaceAll("'../shared/optional-contracts.js'","'./legacy-pending-types.js'");
writeFileSync('src/server/legacy-pending-source.ts',header+source);
let projection=read('src/domain/optional-scheduling.ts');
assert.ok(projection.includes('  OptionalResult,\n'),'Expected Task4 result type import');
projection=projection.replace('  OptionalResult,\n','')
  .replaceAll('OptionalInput','LegacyPendingInput')
  .replaceAll("'./calendar.js'","'./legacy-calendar.js'")
  .replaceAll("'./optional-planning.js'","'./legacy-pending-source.js'")
  .replaceAll("'./optional-scheduling-types.js'","'./legacy-pending-types.js'")
  .replaceAll("'./scheduling-types.js'","'./legacy-pending-types.js'")
  .replaceAll("'./tree.js'","'../domain/tree.js'")
  .replace('export function calculateOptionalSchedule(','export function projectLegacyPendingSchedule(');
writeFileSync('src/server/legacy-pending-projection.ts',header+
  "import type {FrozenPendingScheduleV2 as OptionalResult} from '../shared/contracts.js';\n"+projection);
JS
```

Initial adaptation в existing `adaptLegacyTree` после PRIVATE projectLegacySnapshot использует следующий exact block; imports projectLegacyPendingSchedule из server/legacy-pending-projection и frozenPendingScheduleV2Schema из shared/contracts. Public picker исключает private marker. Его final return не вызывает current Repository:

```ts
const pendingParsed=frozenPendingScheduleV2Schema.safeParse(projectLegacyPendingSchedule({
  calendarType:snapshot.project.calendarType,tasks:snapshot.tasks,
  dependencies:snapshot.dependencies,unavailableTaskIds:snapshot.legacyIntervalUnavailable,
}));
if(!pendingParsed.success)throw new Error('Invalid frozen legacy schedule response');
return projectTreeV2Schema.parse({
  contractVersion:2,project:snapshot.project,tasks:snapshot.tasks,
  dependencies:snapshot.dependencies,canUndo:parsed.data.canUndo,schedule:pendingParsed.data,
});
```

`legacy-compatibility.ts` resolution admission imports realInterval из legacy-pending-source; `optional-upgrade.ts` preview imports realInterval/validateSourceInput оттуда и projectLegacyPendingSchedule из legacy-pending-projection; `optional-migration.ts` validation imports validateSourceInput оттуда. В existing preview loop заменить только call calculateOptionalSchedule на `projectLegacyPendingSchedule` с тем же private IDs input; archive/raw bytes/contextDigest/resolution outcomes не меняются. Strict public frozen DTO остаётся прежним. Эти imports не доходят до browser; active source editor и current scheduler используют active planning.

Следующий полный literal compatibility test file `tests/legacy-pending-projection.test.ts` включить в integration list вместе с optional-migration suite; в TaskD RED/GREEN commands добавить это имя. Expected старых pending результатов записан вручную, active live control отдельно:

```ts
import {expect,it,vi} from 'vitest';
import {projectLegacyPendingSchedule} from '../src/server/legacy-pending-projection.js';
import {adaptLegacyTree,projectLegacySnapshot,resolveLegacySources} from '../src/server/legacy-compatibility.js';
import {frozenPendingScheduleV2Schema,projectTreeV2Schema} from '../src/shared/contracts.js';
import * as scheduling from '../src/domain/scheduling.js';
import type {LegacyPendingInput} from '../src/server/legacy-pending-types.js';
import type {LegacySnapshot} from '../src/server/legacy-contracts.js';
const p='11111111-1111-4111-8111-111111111111';
const a='22222222-2222-4222-8222-222222222222';
const b='22222222-2222-4222-8222-222222222223';
const timestamp='2026-10-07T00:00:00.000Z';
const realNull={startDate:null,finishDate:null,calendarSpanDays:null};
const leaf=(id:string,inputStart:string|null,inputFinish:string|null,durationDays:number|null=null)=>({
  id,parentId:null,status:'todo' as const,inputStart,inputFinish,durationDays});
const pending=(input:LegacyPendingInput,feasibility:'feasible'|'incomplete'|'infeasible',
  tasks:Record<string,{startDate:string|null;finishDate:string|null;calendarSpanDays:number|null}>,
  diagnostics:{code:string;taskIds:string[];dependencyIds:string[];messageKey:string}[])=>({
  analysisStatus:'pending-policy',feasibility,
  coverage:{knownLeafCount:Object.values(tasks).filter(t=>t.startDate!==null).length,totalLeafCount:input.tasks.length},
  tasks,summaries:{},display:{},criticalTaskIds:[],criticalDependencyIds:[],diagnostics});
it('initial frozen validmissing stays feasible while current live is incomplete',()=>{
  const input:LegacyPendingInput={calendarType:'all-days',tasks:[
    leaf(a,'2026-10-05','2026-10-06'),leaf(b,null,null)],dependencies:[]};
  const literal=pending(input,'feasible',{
    [a]:{startDate:'2026-10-05',finishDate:'2026-10-06',calendarSpanDays:2},[b]:realNull},[]);
  expect(projectLegacyPendingSchedule(input)).toEqual(literal);
  expect(frozenPendingScheduleV2Schema.parse(literal)).toEqual(literal);
  const current=scheduling.calculateSchedule(input);
  expect(current.analysisStatus).toBe('incomplete');
  expect(current.diagnostics).toEqual([{code:'UNKNOWN_INTERVAL',taskIds:[b],dependencyIds:[],
    messageKey:'scheduling.UNKNOWN_INTERVAL'}]);
});
it('initial frozen invalid source retains infeasible severity while live is unknown/incomplete',()=>{
  const input:LegacyPendingInput={calendarType:'all-days',
    tasks:[leaf(a,'2026-10-05','2026-10-06',3)],dependencies:[]};
  const diagnostics=[{code:'DURATION_MISMATCH',taskIds:[a],dependencyIds:[],
    messageKey:'scheduling.DURATION_MISMATCH'}];
  expect(projectLegacyPendingSchedule(input)).toEqual(pending(input,'infeasible',{[a]:realNull},diagnostics));
  expect(scheduling.calculateSchedule(input).analysisStatus).toBe('incomplete');
});
it('initial frozen unavailable and raw FS conflict preserve their exact pending outcomes',()=>{
  const unavailable:LegacyPendingInput={calendarType:'all-days',unavailableTaskIds:[a],
    tasks:[{...leaf(a,'2026-10-05','2026-10-07',3),status:'done'}],dependencies:[]};
  const diagnostic={code:'LEGACY_INTERVAL_UNAVAILABLE',taskIds:[a],dependencyIds:[],
    messageKey:'scheduling.LEGACY_INTERVAL_UNAVAILABLE'};
  expect(projectLegacyPendingSchedule(unavailable)).toEqual(pending(unavailable,'incomplete',{[a]:realNull},[diagnostic]));
  const edgeId='33333333-3333-4333-8333-333333333333';
  const conflict:LegacyPendingInput={...unavailable,tasks:[...unavailable.tasks,
    leaf(b,'2026-10-07','2026-10-10')],dependencies:[{id:edgeId,predecessorId:a,successorId:b}]};
  expect(projectLegacyPendingSchedule(conflict)).toEqual(pending(conflict,'infeasible',{
    [a]:realNull,[b]:{startDate:'2026-10-07',finishDate:'2026-10-10',calendarSpanDays:4}},[
    {code:'EXPLICIT_PRECEDENCE_CONFLICT',taskIds:[a,b],dependencyIds:[edgeId],messageKey:'scheduling.EXPLICIT_PRECEDENCE_CONFLICT'},
    diagnostic]));
});
function legacyDone(relative:boolean):LegacySnapshot {
  const project:LegacySnapshot['project']={id:p,title:'Synthetic initial frozen migration',revision:9,startDate:null,
    calendarType:'all-days',timezone:'UTC',createdAt:timestamp,updatedAt:timestamp};
  const task:LegacySnapshot['tasks'][number]={...leaf(a,'2026-10-05','2026-10-07',3),projectId:p,title:'Synthetic D',
    description:'',sortOrder:0,status:'done',planMode:'fixed',notBefore:null,deadline:null,
    completedStart:null,completedFinish:null,completedStartIndex:relative?0:null,
    completedFinishIndex:relative?3:null,createdAt:timestamp,updatedAt:timestamp};
  return {project,tasks:[task],dependencies:[]};
}
it.each([true,false])('post-CPM initial migration consumes only frozen projection; relative=%s',relative=>{
  const legacy=legacyDone(relative),context={kind:'active' as const,key:p};
  const resolutions=resolveLegacySources([{context,snapshot:legacy}]);
  const projected=projectLegacySnapshot(legacy,context,resolutions);
  expect(projected.legacyIntervalUnavailable).toEqual(relative?[a]:[]);
  const originalLive=scheduling.calculateSchedule;
  const spy=vi.spyOn(scheduling,'calculateSchedule').mockImplementation(()=>{throw new Error('Current live solver must not run');});
  let frozen;
  try{
    frozen=adaptLegacyTree({...legacy,canUndo:false,schedule:{
      feasibility:'feasible',originDate:null,projectFinishIndex:null,coverage:{knownLeafCount:0,totalLeafCount:1},
      tasks:{[a]:{ES:null,EF:null,LS:null,LF:null,projectFloat:null,constraintFloat:null,
        startDate:null,finishDate:null,blockedReason:null}},summaries:{},criticalTaskIds:[],
      criticalDependencyIds:[],diagnostics:[]}},context,resolutions);
    expect(spy).not.toHaveBeenCalled();
  }finally{spy.mockRestore();}
  const literal=pending({calendarType:'all-days',tasks:projected.tasks,dependencies:[]},
    relative?'incomplete':'feasible',relative?{[a]:realNull}:{
      [a]:{startDate:'2026-10-05',finishDate:'2026-10-07',calendarSpanDays:3}},
    relative?[{code:'LEGACY_INTERVAL_UNAVAILABLE',taskIds:[a],dependencyIds:[],
      messageKey:'scheduling.LEGACY_INTERVAL_UNAVAILABLE'}]:[]);
  expect(frozen.schedule).toEqual(literal);
  expect(frozen.tasks[0]).toMatchObject({inputStart:'2026-10-05',inputFinish:'2026-10-07',
    durationDays:3,status:'done'});
  expect(frozen).not.toHaveProperty('legacyIntervalUnavailable');
  expect(projectTreeV2Schema.parse(frozen)).toEqual(frozen);
  const current=originalLive({calendarType:'all-days',tasks:projected.tasks,
    dependencies:[],unavailableTaskIds:projected.legacyIntervalUnavailable});
  expect(current.analysisStatus).toBe(relative?'incomplete':'ready');
  if(!relative&&current.analysisStatus==='ready'){
    expect(current.tasks[a]).toMatchObject({projectFloat:0,constraintFloat:0});
    expect(current.criticalTaskIds).toEqual([a]);
  }
});
```

В тот же test file добавить actual SQL003 initial-migration regression. Оно использует legacyDone/pending/leaf/constants выше; :memory: — исключительно disposable synthetic DB, никакого startup/production acknowledgement bypass.

```ts
import Database from 'better-sqlite3';
import {readFileSync} from 'node:fs';
import {canonical} from '../src/shared/canonical.js';
import {loadLegacyContexts,prepareOptionalMigration} from '../src/server/optional-migration.js';
import {previewOptionalUpgrade} from '../src/server/optional-upgrade.js';
it('post-CPM SQL003 creates exact pending cache and durable private marker without live solver',()=>{
  const db=new Database(':memory:');db.pragma('foreign_keys=ON');
  try{
    db.exec('CREATE TABLE migrations(version INTEGER PRIMARY KEY) STRICT');
    for(const [file,version] of [['001-initial.sql',1],['002-scheduling.sql',2]] as const){
      db.exec(readFileSync('migrations/'+file,'utf8'));
      db.prepare('INSERT INTO migrations(version) VALUES (?)').run(version);
    }
    const legacy=legacyDone(true);
    for(const [table,row] of [['projects',legacy.project],['tasks',legacy.tasks[0]!]] as const){
      const fields=Object.keys(row);
      db.prepare('INSERT INTO '+table+' ('+fields.join(',')+') VALUES ('+fields.map(()=>'?').join(',')+')')
        .run(...Object.values(row));
    }
    const operationId='44444444-4444-4444-8444-444444444444';
    const body={expectedRevision:8,operationId,command:{
      type:'task.update',taskId:a,changes:{description:'Synthetic archived detail'}}};
    const payload=canonical(body);
    const originalResponse=JSON.stringify({...legacy,canUndo:false,schedule:{
      feasibility:'feasible',originDate:null,projectFinishIndex:null,coverage:{knownLeafCount:0,totalLeafCount:1},
      tasks:{[a]:{ES:null,EF:null,LS:null,LF:null,projectFloat:null,constraintFloat:null,
        startDate:null,finishDate:null,blockedReason:null}},summaries:{},criticalTaskIds:[],
      criticalDependencyIds:[],diagnostics:[]}});
    db.prepare('INSERT INTO operations(operationId,projectId,sessionId,payload,response) VALUES (?,?,?,?,?)')
      .run(operationId,p,'synthetic-initial-migration-session',payload,originalResponse);
    const resolutions=resolveLegacySources(loadLegacyContexts(db));
    const spy=vi.spyOn(scheduling,'calculateSchedule').mockImplementation(()=>{throw new Error('Live solver must not run during migration');});
    try{
      const preview=previewOptionalUpgrade(db);
      expect(preview.policyId).toBe('legacy-scheduling-v1');
      expect(preview.counts).toEqual({sourceIntervals:0,materializedAuto:0,materializedDone:0,
        unavailableAbsolute:2,replacedDoneSource:0,invalid:0,fsConflicts:0,unavailableHistory:1});
      db.transaction(()=>{
        prepareOptionalMigration(db,readFileSync('migrations/003-optional-scheduling.sql','utf8'),resolutions);
        db.prepare('INSERT INTO migrations(version) VALUES (3)').run();
      }).immediate();
      expect(spy).not.toHaveBeenCalled();
    }finally{spy.mockRestore();}
    expect(db.prepare('SELECT taskId,reason FROM task_schedule_provenance ORDER BY taskId').all())
      .toEqual([{taskId:a,reason:'legacy-interval-unavailable'}]);
    expect(db.prepare('SELECT inputStart,inputFinish,durationDays,status FROM tasks WHERE id=?').get(a))
      .toEqual({inputStart:'2026-10-05',inputFinish:'2026-10-07',durationDays:3,status:'done'});
    const row=db.prepare('SELECT payload,response,responseContractVersion FROM operations WHERE operationId=?')
      .get(operationId) as {payload:string;response:string;responseContractVersion:number};
    expect(row.payload).toBe(payload);expect(row.responseContractVersion).toBe(2);
    const frozen=projectTreeV2Schema.parse(JSON.parse(row.response));
    expect(frozen.schedule).toEqual(pending({calendarType:'all-days',
      tasks:[leaf(a,'2026-10-05','2026-10-07',3)],dependencies:[]},'incomplete',{[a]:realNull},
      [{code:'LEGACY_INTERVAL_UNAVAILABLE',taskIds:[a],dependencyIds:[],
        messageKey:'scheduling.LEGACY_INTERVAL_UNAVAILABLE'}]));
    expect(frozen).not.toHaveProperty('legacyIntervalUnavailable');
    expect(db.prepare("SELECT originalText FROM scheduling_migration_archive WHERE projectId=? AND kind='operation-response' AND recordKey=?")
      .get(p,operationId)).toEqual({originalText:originalResponse});
    const current=scheduling.calculateSchedule({calendarType:'all-days',tasks:frozen.tasks,
      dependencies:frozen.dependencies,unavailableTaskIds:[a]});
    expect(current.analysisStatus).toBe('incomplete');
    expect(current.tasks[a]).toMatchObject({startDate:null,finishDate:null,projectFloat:null,constraintFloat:null});
  }finally{db.close();}
});
```

Concrete legacy replay regression добавить в `tests/explicit-cpm-repository.test.ts`. Дополнительные imports: `Database` from better-sqlite3, `readFileSync` from node:fs (добавить к existing fs import), `canonical` from shared/canonical и `prepareOptionalMigration` from server/optional-migration. Fixture выполняет только reviewed SQL в своём tmpdir; нет production upgrade acknowledgement bypass.

```ts
import Database from 'better-sqlite3';
import {canonical} from '../src/shared/canonical.js';
import {prepareOptionalMigration} from '../src/server/optional-migration.js';
// Add readFileSync to the existing node:fs import.
it('frozen legacy revision9 remains pending after live revision10 and restart without solver',()=>{
  db.close();
  const legacyPath=join(directory,'legacy-synthetic.sqlite');
  db=new Database(legacyPath);db.pragma('foreign_keys=ON');
  db.exec('CREATE TABLE migrations(version INTEGER PRIMARY KEY) STRICT');
  for(const [file,version] of [['001-initial.sql',1],['002-scheduling.sql',2]] as const){
    db.exec(readFileSync('migrations/'+file,'utf8'));
    db.prepare('INSERT INTO migrations(version) VALUES (?)').run(version);
  }
  const projectId='11111111-1111-4111-8111-111111111111';
  const taskId='22222222-2222-4222-8222-222222222222';
  const operationId='33333333-3333-4333-8333-333333333333';
  const timestamp='2026-10-07T00:00:00.000Z';
  const legacyProject={id:projectId,title:'Synthetic legacy CPM',revision:9,
    startDate:'2026-10-05',calendarType:'all-days',timezone:'UTC',createdAt:timestamp,updatedAt:timestamp};
  const legacyTask={id:taskId,projectId,parentId:null,title:'Synthetic archived A',
    description:'',sortOrder:0,status:'todo',inputStart:null,inputFinish:'2026-10-06',
    createdAt:timestamp,updatedAt:timestamp,planMode:'unscheduled',durationDays:null,
    notBefore:null,deadline:'2026-10-20',completedStart:null,completedFinish:null,
    completedStartIndex:null,completedFinishIndex:null};
  for(const [table,row] of [['projects',legacyProject],['tasks',legacyTask]] as const){
    const fields=Object.keys(row);
    db.prepare('INSERT INTO '+table+' ('+fields.join(',')+') VALUES ('+fields.map(()=>'?').join(',')+')')
      .run(...Object.values(row));
  }
  const originalBody={expectedRevision:8,operationId,command:{type:'task.plan',taskId,
    plan:{mode:'unscheduled',inputFinish:'2026-10-06',deadline:'2026-10-20'}}};
  const originalPayload=canonical(originalBody);
  const originalResponse=JSON.stringify({project:legacyProject,tasks:[legacyTask],
    dependencies:[],canUndo:false,schedule:{feasibility:'feasible',originDate:'2026-10-05',
      projectFinishIndex:null,coverage:{knownLeafCount:0,totalLeafCount:1},
      tasks:{[taskId]:{ES:null,EF:null,LS:null,LF:null,projectFloat:null,constraintFloat:null,
        startDate:null,finishDate:null,blockedReason:null}},summaries:{},
      criticalTaskIds:[],criticalDependencyIds:[],diagnostics:[]}});
  db.prepare('INSERT INTO operations(operationId,projectId,sessionId,payload,response) VALUES (?,?,?,?,?)')
    .run(operationId,projectId,session,originalPayload,originalResponse);
  db.transaction(()=>{
    prepareOptionalMigration(db,readFileSync('migrations/003-optional-scheduling.sql','utf8'),new Map());
    db.prepare('INSERT INTO migrations(version) VALUES (3)').run();
  }).immediate();
  const archived=db.prepare('SELECT kind,recordKey,originalText,sha256 FROM scheduling_migration_archive WHERE projectId=? ORDER BY kind,recordKey')
    .all(projectId) as {kind:string;recordKey:string;originalText:string;sha256:string}[];
  expect(archived.find(x=>x.kind==='operation-payload')?.originalText).toBe(originalPayload);
  expect(archived.find(x=>x.kind==='operation-response')?.originalText).toBe(originalResponse);
  // Literal already accepted Task5 outcome; emulates persisted pre-CPM frozen reply.
  const frozen=projectTreeV2Schema.parse({contractVersion:2,
    project:{id:projectId,title:'Synthetic legacy CPM',revision:9,calendarType:'all-days',timezone:'UTC',
      createdAt:timestamp,updatedAt:timestamp},
    tasks:[{id:taskId,projectId,parentId:null,title:'Synthetic archived A',description:'',
      sortOrder:0,status:'todo',inputStart:null,inputFinish:'2026-10-06',durationDays:null,
      createdAt:timestamp,updatedAt:timestamp}],dependencies:[],canUndo:false,schedule:{
      analysisStatus:'pending-policy',feasibility:'feasible',coverage:{knownLeafCount:0,totalLeafCount:1},
      tasks:{[taskId]:{startDate:null,finishDate:null,calendarSpanDays:null}},summaries:{},display:{},
      criticalTaskIds:[],criticalDependencyIds:[],diagnostics:[]}});
  const frozenText=JSON.stringify(frozen),digest=createHash('sha256').update(frozenText).digest('hex');
  db.prepare('UPDATE operations SET response=?,responseContractVersion=2,responseSha256=? WHERE operationId=?')
    .run(frozenText,digest,operationId);
  db.close();db=openDatabase(legacyPath);repository=new Repository(db);
  const current=repository.getTree(projectId,session);
  const latest=step(current,{type:'task.edit',taskId,changes:{
    title:'Synthetic current A',inputStart:'2026-10-05',inputFinish:'2026-10-06'}});
  expect(latest.project.revision).toBe(10);expect(latest.schedule.analysisStatus).toBe('ready');
  db.close();db=openDatabase(legacyPath);repository=new Repository(db);
  const state=rawState(projectId),spy=vi.spyOn(scheduling,'calculateSchedule');
  const replay=repository.replayLegacy(projectId,originalBody,session);
  expect(replay).toEqual(frozen);expect(replay.project.revision).toBe(9);
  expect(replay.schedule.analysisStatus).toBe('pending-policy');
  expect(spy).not.toHaveBeenCalled();expect(rawState(projectId)).toEqual(state);
  expect(db.prepare('SELECT payload FROM operations WHERE operationId=?').get(operationId))
    .toEqual({payload:originalPayload});
  expect(db.prepare('SELECT kind,recordKey,originalText,sha256 FROM scheduling_migration_archive WHERE projectId=? ORDER BY kind,recordKey')
    .all(projectId)).toEqual(archived);
  db.prepare('UPDATE operations SET responseSha256=? WHERE operationId=?').run('0'.repeat(64),operationId);
  const corruptedState=rawState(projectId);
  expect(()=>repository.replayLegacy(projectId,originalBody,session)).toThrow(/Invalid/);
  expect(spy).not.toHaveBeenCalled();expect(rawState(projectId)).toEqual(corruptedState);
  spy.mockRestore();
});
```

Unknown original envelope, changed payload/session/project и digest/JSON corruption остаются в accepted Task5 replay suite; этот новый test выполняет конкретный live-vs-frozen переход после подключения CPM. Production migration/архивные resolution rules не меняются.

- [ ] **Step 4: Run RED.** `npm test -- tests/explicit-cpm-repository.test.ts tests/scheduling-api.test.ts tests/optional-migration.test.ts tests/legacy-pending-projection.test.ts` — перед server union/wiring FAIL wrong status/frozen parse/rollback.
- [ ] **Step 5: Wire server parse before commit.** Live getTree/getSchedule/current mutation используют calculate с liveScheduleResultV2Schema и safe live tree/schedule validators выше. `change` проверяет liveProjectTreeV2Schema до записи operation response/commit; ошибки остаются safe internal500. Replay branch читает response/digest, парсит union через validatedCachedTreeResponse и возвращает результат, без чтения current project schedule. Existing auth/session/revision/idempotency/undo bounds сохраняются.
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
import {afterEach,expect,it,vi} from 'vitest';
afterEach(cleanup);
import {ScheduleStatus} from '../../src/client/ScheduleStatus.js';
import {Dependencies} from '../../src/client/Dependencies.js';
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

Следующий положительный partial-edge fixture и test добавить в тот же client test file; imports Dependencies/vi определены выше.

```tsx
const B='22222222-2222-4222-8222-222222222224';
const C='22222222-2222-4222-8222-222222222225';
const AB='33333333-3333-4333-8333-000000000001';
const BC='33333333-3333-4333-8333-000000000002';
const AC='33333333-3333-4333-8333-000000000003';
const partialEdgeTree=()=>projectTreeV2Schema.parse({
  contractVersion:2,project,canUndo:true,
  tasks:[
    {...task(A,'Работа A','2026-10-05','2026-10-06'),sortOrder:0},
    {...task(B,'Работа B','2026-10-07','2026-10-09'),sortOrder:1},
    {...task(C,'Работа C','2026-10-10','2026-10-11'),sortOrder:2},
    {...task(U,'Работа U',null,null),sortOrder:3}],
  dependencies:[
    {id:AB,projectId,predecessorId:A,successorId:B},
    {id:BC,projectId,predecessorId:B,successorId:C},
    {id:AC,projectId,predecessorId:A,successorId:C}],
  schedule:{
    analysisStatus:'incomplete',feasibility:'incomplete',coverage:{knownLeafCount:3,totalLeafCount:4},
    tasks:{
      [A]:{startDate:'2026-10-05',finishDate:'2026-10-06',calendarSpanDays:2,projectFloat:null,constraintFloat:null},
      [B]:{startDate:'2026-10-07',finishDate:'2026-10-09',calendarSpanDays:3,projectFloat:null,constraintFloat:null},
      [C]:{startDate:'2026-10-10',finishDate:'2026-10-11',calendarSpanDays:2,projectFloat:null,constraintFloat:null},
      [U]:{startDate:null,finishDate:null,calendarSpanDays:null,projectFloat:null,constraintFloat:null}},
    summaries:{},display:{},horizonFinishDate:null,criticalTaskIds:[],criticalDependencyIds:[],
    diagnostics:[{code:'UNKNOWN_INTERVAL',taskIds:[U],dependencyIds:[],messageKey:'scheduling.UNKNOWN_INTERVAL'}],
    partialAnalysis:{labelKey:'scheduling.PARTIAL_ANALYSIS',knownHorizonFinishDate:'2026-10-11',
      coverage:{analyzedLeafCount:3,blockedLeafCount:1},
      tasks:{[A]:{knownHorizonFloat:0},[B]:{knownHorizonFloat:0},[C]:{knownHorizonFloat:0}},
      partialCriticalTaskIds:[A,B,C],partialCriticalDependencyIds:[AB,BC],partialCriticalSummaryIds:[]},
  },
});
it('renders positive partial edges with a partial label and no global edge style',()=>{
  const tree=partialEdgeTree();
  expect(tree.schedule.criticalTaskIds).toEqual([]);
  expect(tree.schedule.criticalDependencyIds).toEqual([]);
  if(tree.schedule.analysisStatus!=='incomplete') throw new Error('Expected incomplete');
  expect(tree.schedule.partialAnalysis?.partialCriticalDependencyIds).toEqual([AB,BC]);
  const props={tree,disabled:false,onCommand:vi.fn().mockResolvedValue(true),
    onSelect:vi.fn(),onShow:vi.fn()};
  const first=render(<Dependencies {...props} task={tree.tasks.find(t=>t.id===B)!}/>);
  for(const id of [AB,BC]){
    const path=first.container.querySelector('[data-dependency-edge="'+id+'"]')!;
    expect(path).toHaveClass('partial-critical');
    expect(path).not.toHaveClass('critical');
    expect(path.querySelector('title')).toHaveTextContent('Критическая связь датированной части');
  }
  expect(screen.getAllByText('Критическая связь датированной части',{exact:true})).toHaveLength(2);
  expect(screen.queryByText('Критическая связь',{exact:true})).not.toBeInTheDocument();
  first.unmount();
  const second=render(<Dependencies {...props} task={tree.tasks.find(t=>t.id===A)!}/>);
  const ac=second.container.querySelector('[data-dependency-edge="'+AC+'"]')!;
  expect(ac).not.toHaveClass('partial-critical');expect(ac).not.toHaveClass('critical');
  expect(ac.querySelector('title')).not.toHaveTextContent('Критическая связь датированной части');
});
```

Use same Vitest jsdom setup/cleanup conventions as existing client suites. Exact copy added in strings:
`scheduling.PARTIAL_ANALYSIS` = «Анализ датированной части; полный критический путь неизвестен»;
`partialCriticalEdge` = «Критическая связь датированной части»; на partial arrow и card используется эта подпись и class `partial-critical`, без class `critical`. Нетесное AC сохраняет обычную подпись A→C без partial indicator.
`knownHorizonFloat` label = «Резерв до известного горизонта»;
global critical label = «Критична для окончания проекта»;
Task7 frozen pending copy = «Сохранённый результат без расчёта критического пути». Task5 intermediate copy до Task7 остаётся «Расчёт критического пути ещё не подключён».
Global/partial styles have separate accessible labels; do not rely on color alone. Ready projectFloat and constraintFloat remain separate lines.

Добавить runnable literal rendering tests ниже; expected DTOs не вызывают calculator.

В том же `tests/client/explicit-cpm.test.tsx` после partialEdgeTree определить следующие literal ready/frozen/summary fixtures и tests; Task5 loading/error/dirty/conditional-gesture suites сохраняются и выполняются через verify.

```tsx
const readyN06Tree=(doneB=false)=>projectTreeV2Schema.parse({
  ...partialEdgeTree(),tasks:[
    task(A,'Работа A','2026-10-05','2026-10-06'),
    {...task(B,'Работа B','2026-10-10','2026-10-10'),status:doneB?'done':'todo'},
    task(C,'Работа C','2026-10-05','2026-10-14')],
  dependencies:[{id:AB,projectId,predecessorId:A,successorId:B}],schedule:{
    analysisStatus:'ready',feasibility:'feasible',coverage:{knownLeafCount:3,totalLeafCount:3},
    tasks:{
      [A]:{startDate:'2026-10-05',finishDate:'2026-10-06',calendarSpanDays:2,projectFloat:7,constraintFloat:3},
      [B]:{startDate:'2026-10-10',finishDate:'2026-10-10',calendarSpanDays:1,projectFloat:4,constraintFloat:doneB?0:4},
      [C]:{startDate:'2026-10-05',finishDate:'2026-10-14',calendarSpanDays:10,projectFloat:0,constraintFloat:0}},
    summaries:{},display:{},horizonFinishDate:'2026-10-14',partialAnalysis:null,
    criticalTaskIds:[C],criticalDependencyIds:[],diagnostics:[]}});
it('renders N06 project/local floats separately and does not promote done to critical',()=>{
  const tree=readyN06Tree();
  render(<ScheduleStatus tree={tree} task={tree.tasks[0]!}/>);
  expect(screen.getByText(/Резерв проекта: 7/)).toBeVisible();
  expect(screen.getByText(/Резерв текущего размещения: 3/)).toBeVisible();
  expect(screen.queryByText('Критична для окончания проекта',{exact:true})).not.toBeInTheDocument();
  cleanup();
  const done=readyN06Tree(true);
  render(<ScheduleStatus tree={done} task={done.tasks[1]!}/>);
  expect(screen.getByText(/Резерв проекта: 4/)).toBeVisible();
  expect(screen.getByText(/Резерв текущего размещения: 0/)).toBeVisible();
  expect(screen.queryByText('Критична для окончания проекта',{exact:true})).not.toBeInTheDocument();
  cleanup();
  render(<ScheduleStatus tree={tree} task={tree.tasks[2]!}/>);
  expect(screen.getByText('Критична для окончания проекта',{exact:true})).toBeVisible();
});
it('ready F03 keeps AC noncritical while tight AB and BC are global critical edges',()=>{
  const base=partialEdgeTree();
  const tree=projectTreeV2Schema.parse({...base,tasks:base.tasks.filter(t=>t.id!==U),schedule:{
    analysisStatus:'ready',feasibility:'feasible',coverage:{knownLeafCount:3,totalLeafCount:3},
    tasks:{
      [A]:{startDate:'2026-10-05',finishDate:'2026-10-06',calendarSpanDays:2,projectFloat:0,constraintFloat:0},
      [B]:{startDate:'2026-10-07',finishDate:'2026-10-09',calendarSpanDays:3,projectFloat:0,constraintFloat:0},
      [C]:{startDate:'2026-10-10',finishDate:'2026-10-11',calendarSpanDays:2,projectFloat:0,constraintFloat:0}},
    summaries:{},display:{},horizonFinishDate:'2026-10-11',partialAnalysis:null,
    criticalTaskIds:[A,B,C],criticalDependencyIds:[AB,BC],diagnostics:[]}});
  const props={tree,disabled:false,onCommand:vi.fn().mockResolvedValue(true),
    onSelect:vi.fn(),onShow:vi.fn()};
  const bView=render(<Dependencies {...props} task={tree.tasks.find(t=>t.id===B)!}/>);
  for(const id of [AB,BC])
    expect(bView.container.querySelector('[data-dependency-edge="'+id+'"]')).toHaveClass('critical');
  bView.unmount();
  const aView=render(<Dependencies {...props} task={tree.tasks.find(t=>t.id===A)!}/>);
  expect(aView.container.querySelector('[data-dependency-edge="'+AC+'"]')).not.toHaveClass('critical');
  expect(screen.queryByText('Критическая связь датированной части',{exact:true})).not.toBeInTheDocument();
});
it('partial summary has a partial descendant label and frozen pending keeps its own copy',()=>{
  const P='22222222-2222-4222-8222-222222222226',base=partialEdgeTree();
  if(base.schedule.analysisStatus!=='incomplete')throw new Error('Expected incomplete');
  const tree=projectTreeV2Schema.parse({...base,tasks:[
    task(P,'Этап P',null,null),...base.tasks.map(t=>({...t,parentId:P}))],
    schedule:{...base.schedule,summaries:{[P]:{startDate:null,finishDate:null,calendarSpanDays:null,
      knownLeafCount:3,totalLeafCount:4,containsCritical:null}},
      partialAnalysis:{...base.schedule.partialAnalysis,partialCriticalSummaryIds:[P]}}});
  render(<ScheduleStatus tree={tree} task={tree.tasks[0]!}/>);
  expect(screen.getByText('Анализ датированной части; полный критический путь неизвестен')).toBeVisible();
  expect(screen.getByText('Содержит критические задачи датированной части',{exact:true})).toBeVisible();
  expect(screen.queryByText('Содержит критические задачи',{exact:true})).not.toBeInTheDocument();
  cleanup();
  const frozen=projectTreeV2Schema.parse({...partialTree(),schedule:{
    analysisStatus:'pending-policy',feasibility:'feasible',coverage:{knownLeafCount:1,totalLeafCount:2},
    tasks:{[A]:{startDate:'2026-10-05',finishDate:'2026-10-06',calendarSpanDays:2},
      [U]:{startDate:null,finishDate:null,calendarSpanDays:null}},summaries:{},display:{},
    criticalTaskIds:[],criticalDependencyIds:[],diagnostics:[]}});
  render(<ScheduleStatus tree={frozen}/>);
  expect(screen.getByText('Сохранённый результат без расчёта критического пути')).toBeVisible();
  expect(screen.queryByText(/Анализ датированной части/)).not.toBeInTheDocument();
  expect(screen.queryByText(/Резерв проекта:/)).not.toBeInTheDocument();
});
```

Exact summary copy: `containsCritical` = «Содержит критические задачи», `partialContainsCritical` = «Содержит критические задачи датированной части». Уже существующий infeasible test выше подавляет все partial labels; server/domain tests сохраняют real bars/intervals при конфликте. `npm test -- tests/client/App.test.tsx tests/client/planning.test.tsx` повторяет accepted Task5 loading/empty/error/dirty/keyboard/conditional-gesture assertions, которые эта задача не переопределяет.


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

Дополнительные browser cases определены кодом после основного case. Все tests выполняются в обоих configured viewports 1440×900 и 1280×800 без viewport override. S4 search/filter control не добавляется: filtered-row contract проверяется literal rendering test ниже, collapse/scale — реальными browser actions.

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

Следующий код добавить в тот же browser file. Он использует readTree/command/test выше. Import Database применяется только к runtime.databasePath собственного synthetic runtime; counters не печатают данные.

```ts
import Database from 'better-sqlite3';
import {commandEnvelopeV2Schema} from '../../src/shared/contracts.js';
async function seedN06(page:Page,runtime:Awaited<ReturnType<typeof syntheticRuntime>>,depth=0) {
  const login=await page.request.post(runtime.origin+'/api/auth/login',{
    headers:{Origin:runtime.origin},data:{password:runtime.password}});
  expect(login.status()).toBe(200);
  const created=await page.request.post(runtime.origin+'/api/projects',{
    headers:{Origin:runtime.origin,'X-Leaf-Contract-Version':'2'},
    data:{title:'Synthetic CPM acceptance'}});
  expect(created.status()).toBe(201);
  let tree=await readTree(page,runtime.origin,(await created.json() as {id:string}).id);
  tree=await command(page,runtime.origin,tree,{type:'project.schedule',changes:{calendarType:'all-days'}});
  let parentId:string|null=null;
  const parents:string[]=[];
  for(let n=0;n<depth;n++){
    tree=await command(page,runtime.origin,tree,{type:'task.create',title:'P'+n,parentId});
    parentId=tree.tasks.find(t=>t.title==='P'+n)!.id;parents.push(parentId);
  }
  for(const title of ['A','B','C'])
    tree=await command(page,runtime.origin,tree,{type:'task.create',title,parentId});
  const by=Object.fromEntries(tree.tasks.map(t=>[t.title,t.id]));
  for(const [title,inputStart,inputFinish] of [
    ['A','2026-10-05','2026-10-06'],['B','2026-10-10','2026-10-10'],
    ['C','2026-10-05','2026-10-14']] as const)
    tree=await command(page,runtime.origin,tree,{type:'task.edit',taskId:by[title]!,changes:{inputStart,inputFinish}});
  tree=await command(page,runtime.origin,tree,{type:'dependency.create',predecessorId:by.A!,successorId:by.B!});
  await page.goto(runtime.origin);
  await expect(page.getByRole('heading',{name:'Synthetic CPM acceptance',exact:true})).toBeVisible();
  return {tree,by,parents,parentId};
}
function runtimeCounts(path:string,projectId:string) {
  const db=new Database(path,{readonly:true});
  try{
    return {
      project:db.prepare('SELECT revision FROM projects WHERE id=?').get(projectId),
      operations:db.prepare('SELECT COUNT(*) AS n FROM operations WHERE projectId=?').get(projectId),
      undo:db.prepare('SELECT COUNT(*) AS n FROM undo_snapshots WHERE projectId=?').get(projectId),
    };
  }finally{db.close();}
}
test('deep update and presentation actions preserve authoritative analysis and keyboard focus',async({page,runtime})=>{
  test.setTimeout(120000);
  const {tree:before,by,parents}=await seedN06(page,runtime,40);
  const row=page.getByRole('tree',{name:'Задачи',exact:true}).getByRole('treeitem',{name:/^C,/});
  await row.focus();await row.press('Enter');
  await expect(page.getByRole('complementary',{name:'Задача',exact:true})).toBeVisible();
  await page.getByLabel('Окончание',{exact:true}).fill('2026-10-08');
  const saved=page.waitForResponse(r=>r.url().endsWith('/commands')&&r.request().method()==='POST');
  await page.getByRole('button',{name:'Сохранить',exact:true}).focus();await page.keyboard.press('Enter');
  expect((await saved).status()).toBe(200);
  const after=await readTree(page,runtime.origin,before.project.id);
  expect(after.project.revision).toBe(before.project.revision+1);
  if(after.schedule.analysisStatus!=='ready')throw new Error('Expected ready');
  expect(after.schedule.horizonFinishDate).toBe('2026-10-10');
  expect(after.schedule.criticalTaskIds).toEqual([by.B!]);expect(after.schedule.criticalDependencyIds).toEqual([]);
  for(const [name,pf,cf] of [['A',3,3],['B',0,0],['C',2,2]] as const)
    expect(after.schedule.tasks[by[name]!]).toMatchObject({projectFloat:pf,constraintFloat:cf});
  for(const id of parents)expect(after.schedule.summaries[id]).toEqual({
    startDate:'2026-10-05',finishDate:'2026-10-10',calendarSpanDays:6,
    knownLeafCount:3,totalLeafCount:3,containsCritical:true});
  await expect(page.locator('[data-gantt-bar="'+by.C+'"]').locator('..'))
    .toHaveAttribute('aria-label',/2026-10-05.*2026-10-08/);
  await page.keyboard.press('Escape');
  await expect(row).toBeFocused();
  const state=runtimeCounts(runtime.databasePath,before.project.id);
  await page.getByRole('button',{name:'Свернуть P0',exact:true}).click();
  await expect(row).toHaveCount(0);
  for(const scale of ['weeks','months','days']){
    await page.getByLabel('Масштаб Ганта',{exact:true}).selectOption(scale);
    const current=await readTree(page,runtime.origin,before.project.id);
    expect(current.schedule).toEqual(after.schedule);expect(current.tasks).toEqual(after.tasks);
    expect(runtimeCounts(runtime.databasePath,before.project.id)).toEqual(state);
  }
  await page.getByRole('button',{name:'Развернуть P0',exact:true}).click();
  await expect(row).toBeVisible();
  const b=page.getByRole('tree',{name:'Задачи',exact:true}).getByRole('treeitem',{name:/^B,/});
  await b.focus();await b.press('Enter');
  await page.getByRole('tab',{name:'Зависимости',exact:true}).click();
  await expect(page.locator('[data-dependency-edge="'+after.dependencies[0]!.id+'"]')).not.toHaveClass(/(^| )critical( |$)/);
  await page.keyboard.press('Escape');await expect(b).toBeFocused();
  const undone=page.waitForResponse(r=>r.url().endsWith('/commands')&&r.request().method()==='POST');
  await page.getByRole('button',{name:'Отменить последнее изменение',exact:true}).focus();
  await page.keyboard.press('Enter');expect((await undone).status()).toBe(200);
  const restored=await readTree(page,runtime.origin,before.project.id);
  expect(restored.tasks).toEqual(before.tasks);expect(restored.schedule).toEqual(before.schedule);
  await expect(page.getByRole('button',{name:'Отменить последнее изменение',exact:true})).toBeFocused();
});
test('conditional unknown keeps partial copy then known FS conflict suppresses all critical styles',async({page,runtime})=>{
  const seeded=await seedN06(page,runtime,1);
  let tree=await command(page,runtime.origin,seeded.tree,{type:'task.create',title:'U',parentId:seeded.parentId});
  const u=tree.tasks.find(t=>t.title==='U')!.id;
  tree=await command(page,runtime.origin,tree,{type:'task.edit',taskId:u,changes:{durationDays:3}});
  expect(tree.schedule.analysisStatus).toBe('incomplete');
  if(tree.schedule.analysisStatus!=='incomplete')throw new Error('Expected incomplete');
  expect(tree.schedule.criticalTaskIds).toEqual([]);expect(tree.schedule.criticalDependencyIds).toEqual([]);
  expect(tree.schedule.partialAnalysis?.partialCriticalTaskIds).toEqual([seeded.by.C!]);
  expect(tree.schedule.tasks[u]).toMatchObject({startDate:null,finishDate:null,projectFloat:null,constraintFloat:null});
  expect(tree.schedule.display[u]).toEqual({kind:'conditional',startDate:'2026-10-05',finishDate:'2026-10-07',clipped:false});
  await page.reload();
  await expect(page.getByText('Анализ датированной части; полный критический путь неизвестен').first()).toBeVisible();
  await expect(page.getByRole('button',{name:/U.*Условное размещение; начало не задано/})).toBeVisible();
  expect(await page.locator('.gantt-work.critical').count()).toBe(0);
  const conflicted=await command(page,runtime.origin,tree,{type:'task.edit',taskId:seeded.by.A!,changes:{inputFinish:'2026-10-10'}});
  expect(conflicted.project.revision).toBe(tree.project.revision+1);
  expect(conflicted.schedule.analysisStatus).toBe('infeasible');
  if(conflicted.schedule.analysisStatus!=='infeasible')throw new Error('Expected infeasible');
  expect(conflicted.schedule.diagnostics.map(d=>d.code)).toEqual(['EXPLICIT_PRECEDENCE_CONFLICT','UNKNOWN_INTERVAL']);
  expect(conflicted.schedule.partialAnalysis).toBeNull();
  expect(conflicted.schedule.criticalTaskIds).toEqual([]);expect(conflicted.schedule.criticalDependencyIds).toEqual([]);
  await page.reload();
  await expect(page.getByText(/Предшественник заканчивается после явного начала/).first()).toBeVisible();
  await expect(page.getByText(/Полная пара дат не задана/).first()).toBeVisible();
  await expect(page.getByText(/Анализ датированной части/)).toHaveCount(0);
  expect(await page.locator('.gantt-work.critical, .gantt-work.partial-critical').count()).toBe(0);
  expect((await readTree(page,runtime.origin,tree.project.id)).tasks.find(t=>t.id===u))
    .toMatchObject({inputStart:null,inputFinish:null,durationDays:3});
});
test('lost committed response retries the exact envelope and frozen revision without another write',async({page,runtime})=>{
  const {tree:before,by}=await seedN06(page,runtime);
  let envelope:ReturnType<typeof commandEnvelopeV2Schema.parse>|undefined;
  let frozen:ProjectTreeV2|undefined;
  await page.route('**/api/projects/'+before.project.id+'/commands',async route=>{
    envelope=commandEnvelopeV2Schema.parse(route.request().postDataJSON());
    const committed=await route.fetch();expect(committed.status()).toBe(200);
    frozen=projectTreeV2Schema.parse(await committed.json());
    await route.abort('failed');
  },{times:1});
  await page.getByRole('tree',{name:'Задачи',exact:true}).getByRole('treeitem',{name:/^C,/}).press('Enter');
  await page.getByLabel('Окончание',{exact:true}).fill('2026-10-08');
  await page.getByRole('button',{name:'Сохранить',exact:true}).click();
  await expect(page.getByRole('button',{name:'Повторить сохранение',exact:true})).toBeVisible();
  if(!envelope||!frozen)throw new Error('Expected captured committed synthetic response');
  expect(frozen.project.revision).toBe(before.project.revision+1);
  const latest=await command(page,runtime.origin,frozen,{
    type:'task.edit',taskId:by.B!,changes:{title:'Latest B',inputFinish:'2026-10-11'}});
  const state=runtimeCounts(runtime.databasePath,before.project.id);
  const retry=page.waitForResponse(r=>r.url().endsWith('/commands')&&r.request().method()==='POST');
  await page.getByRole('button',{name:'Повторить сохранение',exact:true}).click();
  const reply=await retry;expect(reply.status()).toBe(200);
  expect(reply.request().postDataJSON()).toEqual(envelope);
  expect(projectTreeV2Schema.parse(await reply.json())).toEqual(frozen);
  expect(runtimeCounts(runtime.databasePath,before.project.id)).toEqual(state);
  expect(await readTree(page,runtime.origin,before.project.id)).toEqual(latest);
  await page.reload();
  await expect(page.getByRole('tree',{name:'Задачи',exact:true}).getByRole('treeitem',{name:/^Latest B,/})).toBeVisible();
  expect((await readTree(page,runtime.origin,before.project.id)).schedule).toEqual(latest.schedule);
});
```

Diagnostic UI copy for these literal checks: `EXPLICIT_PRECEDENCE_CONFLICT` = «Предшественник заканчивается после явного начала.»; `UNKNOWN_INTERVAL` = «Полная пара дат не задана.». Existing Task5 App stale-revision fixture still checks that frozen revision9 cannot replace already accepted revision10. Browser lost-response case above checks actual original cached reply and zero additional writes, then reads/reloads latest revision.

Filtered-row invariant добавить в client file с imports Gantt/treeRows. Это existing rows contract, без нового S4 поиска:

```tsx
import {Gantt} from '../../src/client/Gantt.js';
import {treeRows} from '../../src/client/tree-view.js';
it('filtered rows and scale do not change the literal authoritative schedule or bypass edges',()=>{
  const tree=partialEdgeTree(),before=structuredClone(tree);
  const rows=treeRows(tree.tasks,new Set<string>()).filter(row=>row.task.id===A||row.task.id===C);
  const props={tree,rows,start:'2026-10-05',today:'2026-10-07',selectedId:null,
    disabled:false,onSelect:vi.fn(),onPlan:vi.fn()};
  const view=render(<Gantt {...props} scale="days"/>);
  expect(view.container.querySelector('[data-gantt-row="'+B+'"]')).toBeNull();
  expect(view.container.querySelectorAll('[data-gantt-edge]')).toHaveLength(1);
  expect(view.container.querySelector('[data-gantt-edge="'+AC+'"]')).not.toHaveClass('critical');
  for(const scale of ['weeks','months','days'] as const){
    view.rerender(<Gantt {...props} scale={scale}/>);
    expect(tree).toEqual(before);
    expect(view.container.querySelectorAll('[data-gantt-edge]')).toHaveLength(1);
    expect(view.container.querySelector('[data-gantt-edge="'+AC+'"]')).not.toHaveClass('critical');
  }
  expect(props.onPlan).not.toHaveBeenCalled();
});
```

C17 client fixture также literal, provenance не добавляется в публичный DTO. Добавить после Gantt imports/test выше:

```tsx
const c17PublicTree=()=>projectTreeV2Schema.parse({
  contractVersion:2,project,canUndo:true,
  tasks:[
    task('22222222-2222-4222-8222-222222222227','Этап C17',null,null),
    {...task(A,'Работа A','2026-10-05','2026-10-07'),durationDays:3,status:'done',
      parentId:'22222222-2222-4222-8222-222222222227'},
    {...task(B,'Работа B','2026-10-09','2026-10-10'),parentId:'22222222-2222-4222-8222-222222222227'},
    task(C,'Работа C','2026-10-05','2026-10-08'),
    {...task(U,'Работа U',null,null),durationDays:3,parentId:'22222222-2222-4222-8222-222222222227'}],
  dependencies:[{id:AB,projectId,predecessorId:A,successorId:B}],
  schedule:{
    analysisStatus:'incomplete',feasibility:'incomplete',coverage:{knownLeafCount:2,totalLeafCount:4},
    tasks:{
      [A]:{startDate:null,finishDate:null,calendarSpanDays:null,projectFloat:null,constraintFloat:null},
      [B]:{startDate:'2026-10-09',finishDate:'2026-10-10',calendarSpanDays:2,projectFloat:null,constraintFloat:null},
      [C]:{startDate:'2026-10-05',finishDate:'2026-10-08',calendarSpanDays:4,projectFloat:null,constraintFloat:null},
      [U]:{startDate:null,finishDate:null,calendarSpanDays:null,projectFloat:null,constraintFloat:null}},
    summaries:{['22222222-2222-4222-8222-222222222227']:{
      startDate:null,finishDate:null,calendarSpanDays:null,knownLeafCount:1,totalLeafCount:3,containsCritical:null}},
    display:{[U]:{kind:'conditional',startDate:'2026-10-05',finishDate:'2026-10-07',clipped:false}},
    horizonFinishDate:null,criticalTaskIds:[],criticalDependencyIds:[],
    diagnostics:[
      {code:'LEGACY_INTERVAL_UNAVAILABLE',taskIds:[A],dependencyIds:[],messageKey:'scheduling.LEGACY_INTERVAL_UNAVAILABLE'},
      {code:'UNKNOWN_INTERVAL',taskIds:[U],dependencyIds:[],messageKey:'scheduling.UNKNOWN_INTERVAL'}],
    partialAnalysis:{labelKey:'scheduling.PARTIAL_ANALYSIS',knownHorizonFinishDate:'2026-10-10',
      coverage:{analyzedLeafCount:1,blockedLeafCount:3},tasks:{[C]:{knownHorizonFloat:2}},
      partialCriticalTaskIds:[],partialCriticalDependencyIds:[],partialCriticalSummaryIds:[]},
  }});
it('C17 valid source remains visible as notes while real bar and ordinary criticality stay absent',()=>{
  const tree=c17PublicTree(),before=structuredClone(tree);
  render(<ScheduleStatus tree={tree} task={tree.tasks.find(t=>t.id===A)!}/>);
  expect(screen.getByText('Прежний интервал недоступен; полный расчёт неизвестен.')).toBeVisible();
  expect(screen.queryByText(/^Резерв проекта:/)).not.toBeInTheDocument();
  expect(screen.queryByText('Критична для окончания проекта',{exact:true})).not.toBeInTheDocument();
  cleanup();
  const gantt=render(<Gantt tree={tree} rows={treeRows(tree.tasks,new Set())}
    start="2026-10-05" today="2026-10-07" scale="days" selectedId={null}
    disabled={false} onSelect={vi.fn()} onPlan={vi.fn()}/>);
  expect(gantt.container.querySelector('[data-gantt-bar="'+A+'"]')).toBeNull();
  expect(screen.getByRole('button',{name:'Работа A, Исходное начало: 2026-10-05'})).toBeVisible();
  expect(screen.getByRole('button',{name:'Работа A, Исходное окончание: 2026-10-07'})).toBeVisible();
  expect(screen.getByRole('button',{name:/Работа U.*Условное размещение; начало не задано/})).toBeVisible();
  gantt.unmount();
  const graph=render(<Dependencies tree={tree} task={tree.tasks.find(t=>t.id===B)!}
    disabled={false} onCommand={vi.fn().mockResolvedValue(true)} onSelect={vi.fn()} onShow={vi.fn()}/>);
  expect(graph.container.querySelector('[data-dependency-edge="'+AB+'"]')).toBeInTheDocument();
  expect(graph.container.querySelector('[data-dependency-edge="'+AB+'"]')).not.toHaveClass('critical');
  expect(graph.container.querySelector('[data-dependency-edge="'+AB+'"]')).not.toHaveClass('partial-critical');
  expect(tree).toEqual(before);expect(tree).not.toHaveProperty('legacyIntervalUnavailable');
});
```

Exact diagnostic copy `LEGACY_INTERVAL_UNAVAILABLE` = «Прежний интервал недоступен; полный расчёт неизвестен.». Client показывает server unknown outcome и retained source notes; не пытается восстановить интервал из valid pair или снять private marker.


- [ ] **Step 5: Run GREEN и full acceptance.** `npm test -- tests/client/explicit-cpm.test.tsx`; `npm run verify`; `npm run format:check`; `npm run test:e2e -- tests/e2e/explicit-cpm.spec.ts tests/e2e/optional-scheduling.spec.ts`; `npm run check:package`; `npm run check:kit`; `git diff --check`. Expect no skipped/retried suites; run all E2E once for integrated Task7. Update affected explicit unit/integration lists. Do not use --if-present.
- [ ] **Step 6: Commit/review/handoff.** Normal staged guard+Gitleaks/hooks, commit `feat: show verified explicit-date critical paths`, two independent reviewers on same SHA. STATUS reports exact passed/failed/not-run and unresolved release work. ADR008 links implementation/checks without changing C16 formula. C05/OS16 complete only with all domain/storage/API/browser acceptance GREEN; V1 remains unfinished pending S4–S6.

## Численная и contract coverage для review

| Требование | Независимый expected / проверка |
|---|---|
| Admission пары, без Auto/duration inference | P11, full pair nullable duration, invalid saved source, C17 valid marked source exclusion/Hknown/rawFS/minima; conditional deep U |
| Entered placement/global horizon/gaps | P01/P02/P03/N06 и done N06 |
| Fork/join/equal paths/critical edge predicate | F01/F02/F03, P04, 60-task/116-edge layer case |
| Done structural/local float separation | P06/N06-done/C17-unmarked control; marked valid done excluded; explicit source acknowledgement+return/undo |
| Incomplete/weak components/global known lower horizon | P07/P08/Hknown-blocked-late/all-blocked/no-known; F03+U positive partial AB/BC, AC noncritical |
| Conflict priority plus unknown | P09 alone/P09+U, finish-only/start-only conflict |
| Calendar adjacency and extremes | P10/P10-all-days independent floats; Repository+HTTP calendar command and undo; full 0001–9999 span |
| Technical origin invariance | Every ready fixture with two origins; literal N06 negative LS/LF |
| Hierarchy/summary/display separation | 40-level complete/incomplete/deep-change, 10000-level summary source ignored |
| Pure/immutable/deterministic/finite output | Reversed input fixtures, source clone equality, no path enumeration; wide10000 unknown leaves with bounded callback work |
| Strict live/frozen union and type consistency | Live-only current safe500; private own-project/unique IDs and no public leakage; stable server-only initial frozen projection; Task2 adaptation |
| Atomic revision/undo/restart/exact retry | P04→P05→undo; C17 equal explicit clear/validation/undo/reopen/preserveWork/private pass-through; frozen retries; rollback injection |
| Frozen historical migration response | Initial pending validmissing/invalid/unavailable/FS controls, post-CPM adapter/migration; Task5 M08 durable replay/restart, no live solver |
| Server-only UI/keyboard/empty/error/loading | Positive partial/global edge and partial-summary literal UI; filtered rows; deep browser collapse/scale/keyboard/undo; lost-response exact replay; Task5 UX regression |

## Gate и исполнение

- [ ] Автор сохраняет annex и scoped local commit с нормальными hooks/security:staged; отчёт отличает документационные проверки от будущих application tests.
- [ ] Reviewer 1 независимо проверяет exact SHA на standards/type consistency/file map/commands/privacy/frozen parsing.
- [ ] Reviewer 2 независимо проверяет exact SHA на C16/owner evidence/numerical matrix/admission/weak components/Hknown/conflict/undo/UI.
- [ ] При CHANGES_REQUIRED исправить technical annex, rerun affected doc/oracle checks и получить **оба** APPROVED нового SHA. Accepted policy не переоткрывать; изменение формулы нельзя скрывать как code detail.
- [ ] Task7 запускается только после Task5 GREEN и двух APPROVED annex. Исполнитель проверяет `git status --short --branch`, читает START_HERE/AGENTS/PRIVACY, использует один worktree writer, Node24.21.0/npm11.19.0 и существующий lockfile.
- [ ] Исполнение A→B/C→D→E использует TDD RED/GREEN и scoped commits/reviews. Нет permission на production migration/push/deploy.
- [ ] Финальный STATUS фиксирует implemented behavior, exact checks, limitations и S4–S6 next work; policy CLOSED и implementation GREEN остаются разными фактами.

## Review metadata — 2026-10-07

Substantive candidate `29f193ea8dcd7ab0213fe84fc7dafa913a4a4b21` получил два независимых verdicts: Spec — **APPROVED**, Standards/executability — **APPROVED**. Scoped re-review проверил исправления шести findings относительно `697e2948c23b14ed58a726e3633242a63e5f32a9` вместе с исходными review reports; application implementation не одобрялось.

Эта последующая запись меняет только review metadata. APPROVED относится к указанному substantive SHA, без переноса verdict на изменённый typed body или реализацию. CPM code ещё не реализован; Task7 требует Task5 GREEN. C17 unavailable-lock handoff остаётся pending Task4/5; любой изменённый scheduling input требует amendment этого annex и двух новых независимых reviews до подключения CPM.

## C17 amendment review status — 2026-10-08

Изменённый private/pure input, marked-leaf admission, stable initial frozen projection и новые runnable regressions требуют двух independent reviews на новый точный SHA. APPROVED29f193e и metadata889cb6a относятся к прежнему substantive body. Task4 source pin f5e92ab получил два APPROVED; его future Task5 integration остаётся обязательным вместе с Task5 GREEN. SQL registry/production execution не разрешены этим annex.
