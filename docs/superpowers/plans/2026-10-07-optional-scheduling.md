# Optional Scheduling Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use `subagent-driven-development` or `executing-plans` to implement this plan task-by-task. The owner requires separate agents for authoring, implementation and independent review. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Адаптировать leaf к C11–C17: независимые необязательные сроки, полный summary, условные полосы, совместимая legacy конвертация/undo/replay и настоящий CPM по принятой политике введённых интервалов.

**Architecture:** Один пакет, существующий Fastify/SQLite transaction boundary и React/SVG. Сначала подготовить чистые target contracts, проекции и compatibility adapter без подключения к работающему приложению; затем одним проверенным checkpoint заменить прежние helpers/API/UI. Сервер рассчитывает реальные интервалы, FS, summary и отдельный display. C16/C17 закрывают выбор политики; registry требует проверенных resolution rules и explicit preview acknowledgement, CPM — технического annex и review.

**Tech Stack:** TypeScript strict, React 19.3.0/Vite 8.3.3, Fastify 5.12.5, better-sqlite3 13.0.3, Zod 4.6.5, Vitest 5.0.3, Playwright 1.63.0; существующий exact lockfile.

**Spec:** [Optional scheduling design](../specs/2026-10-07-optional-scheduling-design.md), базовая проверенная ревизия `69b05dca5cf0c2c248eb9843b38f4f5b6f91c857`, дополненная [принятым владельцем нормативным приложением C16/C17](../specs/2026-10-07-optional-scheduling-policy-proposal.md). Два spec APPROVED относятся к базовой ревизии; новые изменения не наследуют их автоматически. [DECISIONS](../../DECISIONS.md), [ADR 007](../../adr/007-legacy-scheduling-migration.md), [ADR 008](../../adr/008-explicit-date-cpm.md), [ACCEPTANCE](../../ACCEPTANCE.md), [PRIVACY](../../PRIVACY.md), [AGENT_WORKFLOW](../../AGENT_WORKFLOW.md) читаются вместе со спецификацией.

## Global Constraints

- C11–C17 подтверждены владельцем. D13 и другие D — рабочие defaults. C16 сохраняет W01 допуск только валидных пар; C17 дополняет W06 однократной конвертацией и exact archive. Остальные W — технические предложения, не отдельные owner decisions.
- Конечная задача содержит `inputStart: CalendarDate | null`, `inputFinish: CalendarDate | null`, `durationDays: positive integer | null`.
- Пропуск поля в patch сохраняет прежнее значение; явный `null` очищает только его.
- `CalendarDate` — валидная строка `YYYY-MM-DD` в существующем диапазоне 0001–9999. Окончание включительно.
- Календарь проекта сохраняется: `all-days` или `weekdays` (пн–пт), default D04; timezone нужен для «Сегодня», не для арифметики дат.
- Целевой публичный DTO не содержит `deadline`, `notBefore`, `planMode`, `project.startDate` и relative completed indices.
- До реализации нового CPM intermediate `analysisStatus = pending-policy`, floats отсутствуют, criticalTaskIds/criticalDependencyIds пусты; UI объясняет «Расчёт критического пути ещё не подключён», а не отсутствие принятой политики. Frozen replies сохраняют прежний status/outcome после Task 7.
- Авторитетные записи, проверка графа, пересчёт, result и undo — одна SQLite-транзакция с `expectedRevision`/`operationId`.
- При отсутствии/неподдерживаемой версии сервер возвращает HTTP 426 и прежний strict error DTO `{code,message}` до project mutation, target DTO и cached response.
- Для точного повтора legacy envelope target-aware клиент передаёт transport headers `X-Leaf-Contract-Version: 2` и `X-Leaf-Legacy-Replay: 1`, сохраняя оригинальный body и archival canonical payload.
- Не очищать operations/undo_snapshots при этой адаптации. Deadline не переносится в finish; notBefore не переносится в start; project.startDate не назначает даты задач.
- C17 разрешает использовать абсолютную опору того же legacy context только для однократного восстановления существующего Auto/done интервала. Нет опоры — сохранить source/status и unknown с диагностикой; не брать Today/current project для historical context.
- Existing БД с pending 003 не изменяется обычным startup без explicit `{policyId:'legacy-scheduling-v1',previewDigest}`; digest всех scheduling originals перепроверяется внутри immediate transaction до writes. Новый пустой экземпляр и уже применённая 003 не требуют legacy acknowledgement.
- Граф остаётся DAG с leaf-only FS, lag=0, внутри одного проекта; parentId не создаёт precedence.
- Один writer одновременно меняет shared contracts, schema, migration и scheduling semantics. Каждый concurrent agent использует свой worktree.
- Только disposable synthetic fixtures. Не читать production DB, backups, `.env`, реальные экспорты, credential stores или истории агента. Не логировать archive/raw bodies/cookies.
- Не менять стек, lockfile, scanner policy, Git identity или hooks. Без ORM, платного Gantt, graph editor, облаков, CDN, telemetry, AI API, очередей и ресурсов.
- Только три PNG из [design/README](../../../design/README.md); исключённый коллаж не использовать. Русский UI, English identifiers/commit subjects.
- Push, deploy, release и production migration требуют отдельного поручения владельца. Положительное ревью плана этого разрешения не даёт.

## Готовность и зависимости

Базовая ревизия получила два независимых APPROVED на `c4c8193ed82c464998f16bd163def93c22a22fe2`. Владелец отдельно принял C16/C17: G-CPM/O06 и G-MIGRATION CLOSED как выбор политики. Ни одна application task этим изменением не реализована. Для новых плановых изменений отдельные independent APPROVED пока не заявляются; technical annex/review/test dependencies сохраняются.

| Task | Вход | Проверяемый выход | Возможность исполнения |
|---|---|---|---|
| 1 | Approved spec; implementation requested отдельно | Неактивные target schemas и source validator | Независимая подготовка в рамках W01/W02/W05 |
| 2 | Task 1 contracts | Pure real/FS/summary/display, pending-policy | Независимая подготовка W01–W04; без CPM |
| 3 | Task 1/2, frozen S2 schemas | Archive integrity и mapper на synthetic данных; registry не подключён | Независимая preparation; неоднозначные legacy cases fail closed |
| 4 | C17/ADR 007 и synthetic category matrix Task 3 | Исполнимые resolution rules, preview/acknowledgement и tests | Owner policy CLOSED; implementation и independent GREEN/review ещё нужны |
| 5 | Task 1–3 GREEN и закрытый G-MIGRATION | Работающее target приложение, миграция/history/retry/undo/UI, pending-policy | Заблокировано до Task 4; один writer, единый интеграционный checkpoint |
| 6 | C16/ADR 008, P01–P11/N06 | Typed implementation annex с runnable tests и двумя independent APPROVED | Owner policy CLOSED; technical annex/review ещё не выполнены |
| 7 | Approved annex Task 6; target приложение Task 5 | Реальный CPM и полная сквозная приёмка C11–C15 | Заблокировано до Task 6; не заменять annex старым Auto |

Task 1–3 могут закончиться reviewable commit при работающем прежнем приложении: они не меняют активный `Task`, не регистрируют migration 003, не подключают новый route и не переключают `Repository.calculate`. Это подготовка замены, не второй продуктовый scheduler/API. Task 5 переносит эти реализации в существующие `contracts.ts`, `planning.ts`, `scheduling-types.ts`, `scheduling.ts` и удаляет промежуточные optional modules после исправления imports. Compatibility layer остаётся только для архивных форм. Нет режима выбора между двумя действующими планировщиками.

После Task 5 допустим только промежуточный synthetic developer build с честным пояснением отсутствующей реализации CPM. C05, OS16, полная адаптация и V1 ещё не приняты. Task 4 implementation/review и acknowledgement находятся перед добавлением SQL в `openDatabase`, поскольку registry применяется при запуске. Policy gates уже закрыты; Task 6 технический annex может готовиться независимо от Task 4/5, но Task 7 требует обоих результатов.

## Карта файлов и целевых интерфейсов

| Ответственность | Preparation files | Итоговое место / существующие потребители |
|---|---|---|
| Strict target DTO/commands | `src/shared/optional-contracts.ts` | `src/shared/contracts.ts`; API/client/types |
| Source patch/validation/done | `src/domain/optional-planning.ts` | `src/domain/planning.ts`; Repository |
| Real/FS/summary/display | `src/domain/optional-scheduling-types.ts`, `optional-scheduling.ts` | `src/domain/scheduling-types.ts`, `scheduling.ts`; один `calculateSchedule` |
| Frozen legacy parsing/projection | `src/server/legacy-contracts.ts`, `legacy-compatibility.ts` | Только migration/replay; не экспортируется в client |
| Legacy conversion/upgrade acknowledgement | `src/server/legacy-scheduling.ts`, `optional-upgrade.ts`; accepted resolver в `legacy-compatibility.ts` | Frozen legacy calculator для восстановления собственного historical state; preview/digest до migration writes, server-only |
| Exact canonical comparison | `src/shared/canonical.ts` | Repository и compatibility; идентичная прежней `canonical` функция |
| Archive+projection migration | `src/server/optional-migration.ts`, `migrations/003-optional-scheduling.sql` | `database.ts` registry после G-MIGRATION |
| Atomic writes/undo/replay | Existing `src/server/repository.ts`, `app.ts` | Замена старых branches с сохранением revision/idempotency/auth/origin |
| UI/real labels/gestures | Existing `PlanFields.tsx`, `TaskPanel.tsx`, `ProjectPlan.tsx`, `planning-view.ts`, `api.ts`, `App.tsx`, `ScheduleStatus.tsx`, `strings.ts` | Три nullable поля, настройки calendar/timezone, 426 message, pending-policy |
| SVG и graph | Existing `Gantt.tsx`, `gantt-view.ts`, `TaskTimeline.tsx`, `TaskTree.tsx`, `Dependencies.tsx`, `styles/planning.css` | Готовый server display отдельно от real labels/arrow endpoints |
| Build boundary | `.dockerignore`, `scripts/package-check.mjs`, `src/server/database.ts` | Exact migration input/registry; без расширения allowlist на каталоги |
| Tests | New `tests/optional-planning.test.ts`, `optional-scheduling.test.ts`, `legacy-compatibility.test.ts`, `optional-migration.test.ts`, `optional-upgrade.test.ts`, `optional-api.test.ts`; existing client/E2E/storage suites | Внести новые suites в explicit `test:unit`/`test:integration`; полный `npm test` сохраняется |
| Decisions/handoff | New `docs/adr/006-optional-scheduling-contract.md`; existing `007-legacy-scheduling-migration.md`, `008-explicit-date-cpm.md`; technical CPM annex | C16/C17 evidence, technical contracts, factual status; никаких transcripts |

Номера ADR перед созданием проверить `rg --files docs/adr`: если уже заняты другим завершённым изменением, выбрать следующие свободные номера и обновить ссылки этого плана; не перезаписывать чужой ADR.

## Протокол исполнения и review

- [ ] Координатор перед Task 1 проверяет `git status --short --branch`, читает START_HERE/AGENTS/PRIVACY, проверяет approved spec/plan SHA и выделяет отдельный worktree writer. Автор настоящего плана ничего из implementation не запускает.
- [ ] Использовать Node 24.21.0 / npm 11.19.0 из `.nvmrc`/packageManager. Проверить `node --version`, `npm --version`, `npm run doctor`; mismatch исправлять выбором установленной требуемой версии, не снижением pins. `npm ci --strict-allow-scripts --no-audit --no-fund` — только по проверенному lockfile, без новых packages.
- [ ] Для каждой задачи: добавить независимые failing tests, увидеть конкретный RED, минимально реализовать, получить GREEN и affected checks. Не использовать `.skip`, пустые tests, `--if-present` или сравнение solver с собой.
- [ ] Один worker создаёт scoped локальный commit. Независимые reviewer agents оценивают один точный SHA: Standards/безопасность/исполняемость и Spec/числа/поведение. На CHANGES_REQUIRED worker исправляет тот же scope, reruns affected checks и создаёт новый SHA. Оба reviewer повторяют проверку нового SHA; переход допустим только при двух APPROVED и отсутствии открытых blockers.
- [ ] Policy evidence уже есть: C16/C17 и accepted normative annex от 2026-10-07. Не запрашивать повторный выбор этих политик. Task 4/6 реализуют и уточняют technical contracts в этих границах; новую противоречащую политику не вводить под видом implementation choice.
- [ ] Перед commit: `git diff --check`, scoped diff review, `git add --` только task files, `npm run security:staged`, `git diff --cached --check`, затем обычный `git commit -m '...'` с действующими hooks. Не менять identity и не обходить hook отказ.
- [ ] После каждого accepted commit: factual STATUS — touched areas, passed/failed/not run, pending gates, следующий task. Общая интеграция и public workspace/preflight выполняются отдельным integrator в обычном checkout; linked `.git` pointer guard нельзя ослаблять.

## Task 1: Неактивный nullable контракт и patch validator

**Files:** Create `src/shared/optional-contracts.ts`, `src/domain/optional-planning.ts`, `tests/optional-planning.test.ts`, `docs/adr/006-optional-scheduling-contract.md`; modify `package.json` только список `test:unit`. Active contracts/code и lockfile не менять.

**Interfaces:** SourceFields/SourcePatch экспортировать из `src/shared/optional-contracts.ts`; функции — из `src/domain/optional-planning.ts`, который импортирует эти типы и CalendarType/DomainError/calendar helpers по существующим относительным путям.

```ts
export type SourceFields = {
  inputStart: string | null;
  inputFinish: string | null;
  durationDays: number | null;
};
export type SourcePatch = Partial<SourceFields>;
export function applySourcePatch<T extends SourceFields>(
  task: T, patch: SourcePatch, calendar: CalendarType,
): T;
export function realInterval(
  source: SourceFields, calendar: CalendarType,
): { startDate: string; finishDate: string; calendarSpanDays: number } | null;
export function validateSourceInput(source: SourceFields, calendar: CalendarType): void;
```

В `optional-planning.ts` импортировать `CalendarType` из `./scheduling-types.js`, `DomainError` из `./tree.js`, `isWorkingDay`/`workingDaysInclusive` из `./calendar.js`, SourceFields/SourcePatch из `../shared/optional-contracts.js`. `applySourcePatch` сохраняет omission и проверяет новый source только при изменении поля; обычный text/status save legacy/calendar-invalid source не должен случайно отклоняться. `validateSourceInput` используется для нового срока; `realInterval` используется чтением и возвращает null для отсутствующей/невалидной пары. Невалидный сохранённый source анализирует Task 2 через diagnostics.

- [ ] **Step 1: Добавить восемь nullable сочетаний и patch тесты.** Следующий независимый пример N01 не вычисляет expected date через тестируемую функцию:

```ts
import { describe, expect, it } from 'vitest';
import { applySourcePatch, realInterval } from '../src/domain/optional-planning.js';
import { sourcePatchSchema } from '../src/shared/optional-contracts.js';

describe('optional source fields', () => {
  it.each([
    [null, null, null], ['2026-10-09', null, null],
    [null, '2026-10-12', null], [null, null, 2],
    ['2026-10-09', null, 2], [null, '2026-10-12', 2],
    ['2026-10-09', '2026-10-12', null],
    ['2026-10-09', '2026-10-12', 2],
  ] as const)('stores %s / %s / %s independently', (inputStart, inputFinish, durationDays) => {
    const source = { inputStart, inputFinish, durationDays };
    expect(applySourcePatch({ inputStart: null, inputFinish: null, durationDays: null }, source, 'weekdays')).toEqual(source);
  });
  it('clears only finish and retains nullable duration after a date pair', () => {
    const a = { inputStart: '2026-10-09', inputFinish: '2026-10-12', durationDays: null };
    expect(realInterval(a, 'weekdays')).toEqual({ startDate: '2026-10-09', finishDate: '2026-10-12', calendarSpanDays: 2 });
    expect(a.durationDays).toBeNull();
    expect(applySourcePatch(a, { inputFinish: null }, 'weekdays')).toEqual({ inputStart: '2026-10-09', inputFinish: null, durationDays: null });
    expect(applySourcePatch(a, { durationDays: 2 }, 'weekdays').durationDays).toBe(2);
    expect(() => applySourcePatch(a, { durationDays: 3 }, 'weekdays')).toThrowError(expect.objectContaining({ code: 'DURATION_MISMATCH' }));
    expect(sourcePatchSchema.safeParse({ deadline: '2026-10-20' }).success).toBe(false);
  });
});
```

Дополнительные отдельные cases: duration=0/-1/1.5/1000001 и empty-string date отклоняются; максимальная вводимая duration=1000000 сохраняется; производный span пары 0001-01-01–9999-12-31 не ограничивается этим input cap; one-sided weekend разрешён, новый полный weekend/reversed pair отклонён; omission duration сохраняет предыдущее число. Проверка `realInterval` не должна бросать на saved invalid source.

- [ ] **Step 2: Run RED.** `npm test -- tests/optional-planning.test.ts` — FAIL: отсутствуют новые modules/exports. После появления schema новые поведенческие tests должны падать на конкретных null/mismatch assertions до реализации validator.

- [ ] **Step 3: Записать ADR W05 и schemas.** ADR прямо сохраняет W01–W06 как proposals, открытые G gates, header version=2, source patch и frozen replay. Новый target envelope содержит `contractVersion: 2` в body для новой canonical формы; header отдельно обязателен. Legacy replay body этого поля не получает.

```ts
import { z } from 'zod';
import { calendarDateSchema, uuidSchema, taskTitleSchema } from './contracts.js';

export const sourceFieldsSchema = z.strictObject({
  inputStart: calendarDateSchema.nullable(),
  inputFinish: calendarDateSchema.nullable(),
  durationDays: z.number().int().min(1).max(1000000).nullable(),
});
export const sourcePatchSchema = sourceFieldsSchema.partial();
export const optionalEditSchema = z.strictObject({
  type: z.literal('task.edit'), taskId: uuidSchema,
  changes: z.strictObject({
    title: taskTitleSchema.optional(), description: z.string().max(10000).optional(),
    status: z.enum(['todo', 'doing', 'done']).optional(),
    inputStart: calendarDateSchema.nullable().optional(),
    inputFinish: calendarDateSchema.nullable().optional(),
    durationDays: z.number().int().min(1).max(1000000).nullable().optional(),
  }).refine(value => Object.keys(value).length > 0, 'Empty changes'),
});
```

Продолжение **того же** `src/shared/optional-contracts.ts`: полные exported forms, которые употребляют следующие tasks. Импортировать также существующие `projectTitleSchema`, `calendarTypeSchema`, `timezoneSchema` из contracts. Input cap не применяется к stored Task duration, поэтому legacy Fixed span больше 1000000 сохраняется в response. При переносе в active contracts Task 5 убрать self-import primitives; сами определения primitive schema остаются прежними.

```ts
const statusV2Schema = z.enum(['todo', 'doing', 'done']);
const timestampV2Schema = z.iso.datetime();
export const projectV2Schema = z.strictObject({
  id: uuidSchema, title: projectTitleSchema, revision: z.number().int().nonnegative(),
  calendarType: calendarTypeSchema, timezone: timezoneSchema,
  createdAt: timestampV2Schema, updatedAt: timestampV2Schema,
});
export const taskV2Schema = z.strictObject({
  id: uuidSchema, projectId: uuidSchema, parentId: uuidSchema.nullable(),
  title: taskTitleSchema, description: z.string().max(10000), sortOrder: z.number().int().nonnegative(),
  status: statusV2Schema, inputStart: calendarDateSchema.nullable(), inputFinish: calendarDateSchema.nullable(),
  durationDays: z.number().int().positive().nullable(), createdAt: timestampV2Schema, updatedAt: timestampV2Schema,
});
export const dependencyV2Schema = z.strictObject({
  id: uuidSchema, projectId: uuidSchema, predecessorId: uuidSchema, successorId: uuidSchema,
});
const realTaskV2Schema = z.strictObject({ startDate: calendarDateSchema.nullable(),
  finishDate: calendarDateSchema.nullable(), calendarSpanDays: z.number().int().positive().nullable() });
export const scheduleResultV2Schema = z.strictObject({
  analysisStatus: z.literal('pending-policy'), feasibility: z.enum(['feasible', 'incomplete', 'infeasible']),
  coverage: z.strictObject({ knownLeafCount: z.number().int().nonnegative(), totalLeafCount: z.number().int().nonnegative() }),
  tasks: z.record(uuidSchema, realTaskV2Schema),
  summaries: z.record(uuidSchema, realTaskV2Schema.extend({
    knownLeafCount: z.number().int().nonnegative(), totalLeafCount: z.number().int().nonnegative() })),
  display: z.record(uuidSchema, z.strictObject({ kind: z.literal('conditional'), startDate: calendarDateSchema,
    finishDate: calendarDateSchema, clipped: z.boolean() })),
  criticalTaskIds: z.array(uuidSchema).length(0), criticalDependencyIds: z.array(uuidSchema).length(0),
  diagnostics: z.array(z.strictObject({ code: z.string(), taskIds: z.array(uuidSchema),
    dependencyIds: z.array(uuidSchema), messageKey: z.string() })),
});
export const snapshotV2Schema = z.strictObject({ project: projectV2Schema,
  tasks: z.array(taskV2Schema), dependencies: z.array(dependencyV2Schema) });
export const projectTreeV2Schema = snapshotV2Schema.extend({
  contractVersion: z.literal(2), canUndo: z.boolean(), schedule: scheduleResultV2Schema });
export const scheduleResponseV2Schema = z.strictObject({ contractVersion: z.literal(2),
  projectId: uuidSchema, revision: z.number().int().nonnegative(), schedule: scheduleResultV2Schema });
const detailsPatchV2Schema = z.strictObject({ title: taskTitleSchema.optional(),
  description: z.string().max(10000).optional(), status: statusV2Schema.optional() })
  .refine(value => Object.keys(value).length > 0, 'Empty changes');
export const commandV2Schema = z.discriminatedUnion('type', [
  optionalEditSchema,
  z.strictObject({ type: z.literal('task.update'), taskId: uuidSchema, changes: detailsPatchV2Schema }),
  z.strictObject({ type: z.literal('task.create'), title: taskTitleSchema, parentId: uuidSchema.nullable(),
    afterId: uuidSchema.optional(), preserveWork: z.boolean().optional() }),
  z.strictObject({ type: z.literal('task.move'), taskId: uuidSchema, parentId: uuidSchema.nullable(),
    position: z.number().int().nonnegative(), preserveWork: z.boolean().optional() }),
  z.strictObject({ type: z.literal('task.delete'), taskId: uuidSchema }),
  z.strictObject({ type: z.literal('dependency.create'), predecessorId: uuidSchema, successorId: uuidSchema }),
  z.strictObject({ type: z.literal('dependency.delete'), dependencyId: uuidSchema }),
  z.strictObject({ type: z.literal('undo') }),
  z.strictObject({ type: z.literal('project.schedule'), changes: z.strictObject({
    calendarType: calendarTypeSchema.optional(), timezone: timezoneSchema.optional(),
  }).refine(value => Object.keys(value).length > 0, 'Empty changes') }),
]);
export const commandEnvelopeV2Schema = z.strictObject({ contractVersion: z.literal(2),
  expectedRevision: z.number().int().nonnegative(), operationId: uuidSchema, command: commandV2Schema });
export const renameV2Schema = z.strictObject({ contractVersion: z.literal(2),
  title: projectTitleSchema, expectedRevision: z.number().int().nonnegative(), operationId: uuidSchema });
export type ProjectV2 = z.infer<typeof projectV2Schema>;
export type TaskV2 = z.infer<typeof taskV2Schema>;
export type DependencyV2 = z.infer<typeof dependencyV2Schema>;
export type SnapshotV2 = z.infer<typeof snapshotV2Schema>;
export type ProjectTreeV2 = z.infer<typeof projectTreeV2Schema>;
export type CommandV2 = z.infer<typeof commandV2Schema>;
export type CommandEnvelopeV2 = z.infer<typeof commandEnvelopeV2Schema>;
export type RenameV2 = z.infer<typeof renameV2Schema>;
```

`OptionalResult` Task 2 должен совпадать с `z.infer<typeof scheduleResultV2Schema>`; добавить compile-time assignment test через `const result: OptionalResult = scheduleResultV2Schema.parse(literalResult)`. Task 7 заменяет pending-only analysis schema утверждённым union и сохраняет parse исторических frozen pending replies; не переписывает cached outcome новой математикой. Вход новых `task.plan`, `project.schedule.startDate`, `deadline`, `planMode`, `notBefore` отклоняется strict union. Создание задаёт три null сервером.

- [ ] **Step 4: Реализовать validator и omission.** Проверка пары использует прежнюю calendar арифметику; единственная дата не нормализуется. Ошибки DomainError с safe Russian copy.

```ts
export function validateSourceInput(source: SourceFields, calendar: CalendarType): void {
  if (source.inputStart === null || source.inputFinish === null) return;
  let span: number;
  try { span = workingDaysInclusive(source.inputStart, source.inputFinish, calendar); }
  catch { throw new DomainError('INVALID_INTERVAL', 'Укажите допустимый полный интервал.'); }
  if (source.durationDays !== null && source.durationDays !== span)
    throw new DomainError('DURATION_MISMATCH', 'Длительность не совпадает с интервалом. Измените или очистите её.');
}
export function applySourcePatch<T extends SourceFields>(task: T, patch: SourcePatch, calendar: CalendarType): T {
  const next = { ...task, ...patch };
  if (Object.keys(patch).some(key => next[key as keyof SourceFields] !== task[key as keyof SourceFields]))
    validateSourceInput(next, calendar);
  return next;
}
```

Schema проверяется до вызова, поэтому `undefined`, malformed даты и duration не доходят как runtime source. `realInterval` возвращает null, если пары нет или validator сообщил invalid/mismatch; иначе явные даты и calendar span. Функция не изменяет source.

- [ ] **Step 5: Run GREEN и commit.** `npm test -- tests/optional-planning.test.ts tests/domain.test.ts tests/calendar.test.ts`; `npm run typecheck`; `npm run lint`; `npm run check:kit`; format новых TS. Expect PASS, существующее приложение компилируется прежними contracts. Добавить новый файл в явный `test:unit` список, `test:unit` выполнить. Commit `feat: prepare nullable scheduling source contract`; независимый review точного SHA по общему протоколу.

## Task 2: Pure real/FS/summary/display без новой CPM политики

**Files:** Create `src/domain/optional-scheduling-types.ts`, `src/domain/optional-scheduling.ts`, `tests/optional-scheduling.test.ts`; modify `package.json` unit listing. Active `calculateSchedule` пока не переключать.

**Interfaces:** В `optional-scheduling-types.ts` импортировать SourceFields из `../shared/optional-contracts.js`, CalendarType/SchedulingDependency/ScheduleDiagnostic из `./scheduling-types.js`; эти три простых type definitions сохраняются при замене active types в Task 5. В `optional-scheduling.ts` импортировать новые types из `./optional-scheduling-types.js`, `realInterval` из `./optional-planning.js` и calendar helpers из `./calendar.js`. Leaf-only graph validation копирует текущий проверенный алгоритм в неактивную функцию с узким типом; существующий validator пока требует legacy SchedulingTask, поэтому OptionalTask не передавать ему через unsafe cast. При Task 5 эта функция заменяет существующие `validateDependency/validateDependencies`, не оставляя дубль. Produces:

```ts
export interface OptionalTask extends SourceFields {
  id: string; parentId: string | null; status: 'todo' | 'doing' | 'done';
}
export interface OptionalInput {
  calendarType: CalendarType; tasks: readonly OptionalTask[];
  dependencies: readonly SchedulingDependency[];
}
export interface RealTask {
  startDate: string | null; finishDate: string | null; calendarSpanDays: number | null;
}
export interface OptionalSummary extends RealTask {
  knownLeafCount: number; totalLeafCount: number;
}
export interface ConditionalDisplay {
  kind: 'conditional'; startDate: string; finishDate: string; clipped: boolean;
}
export interface OptionalResult {
  analysisStatus: 'pending-policy'; feasibility: 'feasible' | 'incomplete' | 'infeasible';
  coverage: { knownLeafCount: number; totalLeafCount: number };
  tasks: Record<string, RealTask>; summaries: Record<string, OptionalSummary>;
  display: Record<string, ConditionalDisplay>;
  criticalTaskIds: string[]; criticalDependencyIds: string[];
  diagnostics: ScheduleDiagnostic[];
}
export function calculateOptionalSchedule(input: OptionalInput): OptionalResult;
export function conditionalFinish(anchor: string, duration: number | null, calendar: CalendarType): { finishDate: string; clipped: boolean };
export function validateOptionalDependency(tasks: readonly Pick<OptionalTask, 'id' | 'parentId'>[], dependencies: readonly SchedulingDependency[], predecessorId: string, successorId: string): void;
```

Никаких ES/EF/LS/LF/float или общего прогнозного projectFinish в pending result. Feasibility здесь — проверка исходных данных/FS, analysisStatus — отсутствие выбранного CPM. Summary counts не заменяют coverage и не делают неизвестное нулём. Display вложен отдельно и не экспортируется в real labels.

- [ ] **Step 1: Написать независимый N02.**

```ts
const t = (id: string, parentId: string | null, inputStart: string | null, inputFinish: string | null, durationDays: number | null): OptionalTask =>
  ({ id, parentId, inputStart, inputFinish, durationDays, status: 'todo' });
it('keeps summary unknown while displaying C from the sibling anchor', () => {
  const tasks = [t('P', null, null, null, null),
    t('A', 'P', '2026-10-05', '2026-10-06', null),
    t('B', 'P', '2026-10-09', '2026-10-12', null),
    t('C', 'P', null, null, 3)];
  const before = structuredClone(tasks);
  const result = calculateOptionalSchedule({ calendarType: 'weekdays', tasks, dependencies: [] });
  expect(result.coverage).toEqual({ knownLeafCount: 2, totalLeafCount: 3 });
  expect(result.summaries.P).toEqual({ startDate: null, finishDate: null, calendarSpanDays: null, knownLeafCount: 2, totalLeafCount: 3 });
  expect(result.display.C).toEqual({ kind: 'conditional', startDate: '2026-10-05', finishDate: '2026-10-07', clipped: false });
  expect(result.tasks.C).toEqual({ startDate: null, finishDate: null, calendarSpanDays: null });
  expect(result.analysisStatus).toBe('pending-policy');
  expect(result.criticalTaskIds).toEqual([]);
  expect(result.criticalDependencyIds).toEqual([]);
  expect(tasks).toEqual(before);
});
```

Отдельные tests с literal expected: C.duration=null → display 5 октября; C=7–9 октября/duration3 → P=5–12 октября, span6; B.finish=null → P оба null. Не сравнивать sum(children) с engine output как единственный oracle.

- [ ] **Step 2: Написать N03/N04 и глубокие cases.** `P→Q→A(start-only 5 октября)`, B без начала под P, C под Q: обоим displayStart=5 октября, P/Q summary null. Удаление A.start убирает обе display. B.finish=2 октября и sibling D=9 октября: B real pair null, display 9 октября, finish note=2 октября сохранён. Root leaves не получают display. N04 FS A Friday9→B Monday12 valid; B Friday9 conflict; all-days B Saturday10 valid; A.finish-only/B.start-only достаточно для FS, coverage0. Неизвестная граница → UNKNOWN_PRECEDENCE; известный successor сохраняет source/real dates. Conflict+unknown → infeasible с обеими diagnostics.

40-level tree с одним missing leaf: все 40 summary границ null, coverage независим от collapse (input не имеет collapse). 10000-level synthetic chain тестирует iterative traversal; permutation tasks/dependencies даёт одинаковый sorted result; source immutable; parent hierarchy не FS. Graph invalid cases — self/duplicate/summary/foreign/cycle до сохранения; pure result возвращает safe diagnostics, Repository по-прежнему rejects malformed graph.

- [ ] **Step 3: Run RED.** `npm test -- tests/optional-scheduling.test.ts` — FAIL missing implementation, затем конкретные N02/N04 ожидаемые outputs.

- [ ] **Step 4: Реализовать раздельную агрегацию и calendar display.** Leaf-to-root ordering переиспользует существующую iterative идею; distinct maps: valid real intervals, `knownStartMin` из inputStart конечных потомков, leaf counts. Summary публикует min/max только при `known === total`; FS conflict не убирает валидную пару. Invalid saved source даёт diagnostics+null real pair; source не меняется.

```ts
export function conditionalFinish(anchor: string, duration: number | null, calendar: CalendarType) {
  const count = duration ?? 1;
  if (count === 1) return { finishDate: anchor, clipped: false };
  try {
    const base = nextWorkingDay(anchor, calendar);
    const offset = isWorkingDay(anchor, calendar) ? count - 1 : count - 2;
    return { finishDate: indexToDate(offset, base, calendar), clipped: false };
  } catch (error) {
    if (!(error instanceof RangeError) || error.message !== 'CALENDAR_RANGE_EXCEEDED') throw error;
    return { finishDate: '9999-12-31', clipped: true };
  }
}
```

Это W04: субботний anchor/duration1 занимает субботу, duration2 заканчивается в понедельник. Test отдельно проверяет Friday2=Monday, Saturday2=Monday, Saturday3=Tuesday, fallback1=anchor, overflow clipped без изменения duration. Одиночный нерабочий anchor допустим только display, не FS.

```ts
// Для известной рабочей пары краёв FS; origin — технический день, не Project input.
const finishExclusive = dateToIndex(predecessor.inputFinish, '0001-01-01', calendar) + 1;
const successorStart = dateToIndex(successor.inputStart, '0001-01-01', calendar);
if (successorStart < finishExclusive)
  diagnostics.push({ code: 'EXPLICIT_PRECEDENCE_CONFLICT', taskIds: [predecessor.id, successor.id].sort(), dependencyIds: [edge.id], messageKey: 'scheduling.EXPLICIT_PRECEDENCE_CONFLICT' });
```

Перед этой arithmetic проверить именно необходимые края через `isWorkingDay`; absent → UNKNOWN_PRECEDENCE, non-working → calendar diagnostic. Эта проверка не использует display, duration, completed locks или project origin. Feasibility priority: invalid/conflict → infeasible; иначе unknown linked → incomplete; иначе feasible. Pending analysis независимо от feasibility.

- [ ] **Step 5: Run GREEN и commit.** `npm test -- tests/optional-planning.test.ts tests/optional-scheduling.test.ts tests/calendar.test.ts`; `npm run typecheck`; `npm run lint`; `npm run test:unit`. Expect PASS; old app/domain suites остаются active и проходят. Commit `feat: prepare explicit intervals and conditional Gantt projection`; оба независимых reviews.

## Task 3: Legacy archive, frozen mapper и synthetic migration preparation

**Files:** Create `src/server/legacy-contracts.ts`, `legacy-compatibility.ts`, `optional-migration.ts`, `src/shared/canonical.ts`, `migrations/003-optional-scheduling.sql`, `tests/legacy-compatibility.test.ts`, `tests/optional-migration.test.ts`; modify `package.json` integration listing. **Не** добавлять migration в `database.ts`, `.dockerignore`/package allowlist на этом шаге; Task 5 делает все три вместе после gate.

**Interfaces:** `LegacySnapshotSchema` фиксирует текущие Project/Task/dependency fields из S2, `LegacyTreeSchema` — snapshot+canUndo+старый schedule. Они не используют будущий target Task schema; неизвестная версия/JSON fail closed. Новый `canonical(value: unknown): string` переносит существующее тело из Repository без изменения байтов результата, пока Repository import не переключён.

```ts
export type SnapshotContext = { kind: 'active' | 'operation' | 'undo'; key: string };
export type LegacyResolution = {
  context: SnapshotContext; taskId: string; legacyDigest: string; source: SourceFields;
};
export type ResolutionIndex = ReadonlyMap<string, LegacyResolution>;
export function resolutionKey(context: SnapshotContext, taskId: string): string;
export function projectLegacySnapshot(value: unknown, context: SnapshotContext, resolutions: ResolutionIndex): SnapshotV2;
export function adaptLegacyTree(value: unknown, context: SnapshotContext, resolutions: ResolutionIndex): ProjectTreeV2;
export function replayLegacyOperation(db: Database.Database, projectId: string, sessionId: string, body: unknown): ProjectTreeV2;
export function prepareOptionalMigration(db: Database.Database, migrationSql: string, resolutions: ResolutionIndex): void;
export interface LegacyContextRecord { context: SnapshotContext; snapshot: z.infer<typeof LegacySnapshotSchema> }
export function loadLegacyContexts(db: Database.Database): LegacyContextRecord[];
export function migrationCategoryCounts(db: Database.Database): { auto: number; completedAbsolute: number; completedRelative: number; inconsistent: number };
```

SnapshotV2/ProjectTreeV2 импортировать из Task 1 optional-contracts; после Task 5 — из active contracts. Mapper копирует только target allowlist; done без locks и обычный source сохраняются. Каждый legacy Auto и каждый done с completed dates/indices требует context-specific resolution с digest соответствующего original task, включая approved source-preserving unknown outcome C17. Один taskId в current/history может иметь разные locks: нельзя использовать одну current-row resolution для всех снимков. При отсутствующей resolution бросать safe `MIGRATION_POLICY_REQUIRED`; unknown версии/невалидный JSON — `INVALID_LEGACY_SNAPSHOT`. Synthetic resolutions проверяют сохранность выбранной C17 политики; production execution ими не разрешается.

**Durable replay choice W05/W06:** migration один раз адаптирует каждый original operations.response при accepted context resolution и сохраняет frozen target JSON в существующем `operations.response`. Добавить `responseContractVersion=2` и `responseSha256` для version/digest проверки. `operations.contractVersion=1` обозначает original payload format; original canonical payload остаётся в payload и archive. Original response остаётся exact в archive. Runtime replay после restart читает только frozen target response, проверяет digest/schema и не требует ResolutionIndex; context resolutions нужны только migration projections и архивным checks. Пока schema3 зарегистрирована, повторный startup не выполняет migration/resolution. Ни current project/revision/calendar, ни новая CPM policy не перерасчитывают старый outcome; historical pending result остаётся pending и принимается target parser даже после Task 7.

- [ ] **Step 1: Создать disposable S2 fixture через reviewed SQL.** Не использовать `openDatabase` для автозапуска 003. В `tests/optional-migration.test.ts` собрать временную БД с `better-sqlite3`, `001`+`002` и migrations 1/2, синтетическими account/session по existing migration test setup, проект revision10, parent/order/dependencies, legacy tasks A/B, удалённую D только в undo, Auto и done-relative examples. `try/finally` закрывает db и удаляет только собственный tmpdir. Raw содержимое не выводится.

```ts
const originalResponse = JSON.stringify({ ...legacyTreeFixture, project: { ...legacyTreeFixture.project, revision: 9 } });
const legacyBody = { expectedRevision: 8, operationId, command: {
  type: 'task.plan', taskId: aId, plan: { mode: 'unscheduled', inputFinish: '2026-10-06', deadline: '2026-10-20' },
} };
const originalPayload = canonical(legacyBody);
db.prepare('INSERT INTO operations(operationId,projectId,sessionId,payload,response) VALUES (?,?,?,?,?)')
  .run(operationId, projectId, sessionId, originalPayload, originalResponse);
const beforeCounts = ['tasks', 'dependencies', 'operations', 'undo_snapshots'].map(table =>
  db.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get());
db.transaction(() => {
  prepareOptionalMigration(db, readFileSync('migrations/003-optional-scheduling.sql', 'utf8'), syntheticResolutions);
  db.prepare('INSERT INTO migrations(version) VALUES (3)').run();
}).immediate();
const afterCounts = ['tasks', 'dependencies', 'operations', 'undo_snapshots'].map(table =>
  db.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get());
expect(afterCounts).toEqual(beforeCounts);
expect(readArchiveText(db, 'operation-response', operationId)).toBe(originalResponse);
expect(readArchiveText(db, 'operation-payload', operationId)).toBe(originalPayload);
expect(readArchiveDigest(db, 'operation-response', operationId)).toBe(createHash('sha256').update(originalResponse).digest('hex'));
```

Literal fixture и local archive helpers для этого test файла; `aId`, `projectId`, `sessionId`, `operationId` заданы в этом коде, frozen schema не берёт fixture из target mapper:

```ts
const projectId = '11111111-1111-4111-8111-111111111111';
const aId = '22222222-2222-4222-8222-222222222222';
const operationId = '33333333-3333-4333-8333-333333333333';
const sessionId = 'synthetic-compatibility-session';
const timestamp = '2026-10-07T00:00:00.000Z';
const legacyTaskFixture = {
  id: aId, projectId, parentId: null, title: 'Synthetic A', description: '', sortOrder: 0,
  status: 'todo' as const, planMode: 'unscheduled' as const,
  inputStart: null, inputFinish: '2026-10-06', durationDays: null,
  notBefore: null, deadline: '2026-10-20', completedStart: null, completedFinish: null,
  completedStartIndex: null, completedFinishIndex: null, createdAt: timestamp, updatedAt: timestamp,
};
const legacyTreeFixture = {
  project: { id: projectId, title: 'Synthetic project', revision: 10, startDate: '2026-10-05',
    calendarType: 'all-days' as const, timezone: 'UTC', createdAt: timestamp, updatedAt: timestamp },
  tasks: [legacyTaskFixture], dependencies: [], canUndo: true,
  schedule: { feasibility: 'feasible' as const, originDate: '2026-10-05', projectFinishIndex: null,
    coverage: { knownLeafCount: 0, totalLeafCount: 1 },
    tasks: { [aId]: { ES: null, EF: null, LS: null, LF: null, projectFloat: null, constraintFloat: null,
      startDate: null, finishDate: null, blockedReason: null } }, summaries: {},
    criticalTaskIds: [], criticalDependencyIds: [], diagnostics: [] },
};
function readArchiveText(db: Database.Database, kind: string, key: string): string {
  const row = db.prepare('SELECT originalText FROM scheduling_migration_archive WHERE projectId=? AND kind=? AND recordKey=?')
    .get(projectId, kind, key) as { originalText: string };
  return row.originalText;
}
function readArchiveDigest(db: Database.Database, kind: string, key: string): string {
  const row = db.prepare('SELECT sha256 FROM scheduling_migration_archive WHERE projectId=? AND kind=? AND recordKey=?')
    .get(projectId, kind, key) as { sha256: string };
  return row.sha256;
}
```

Расширять fixture отдельными B/deleted D/Auto/done cases буквальными изменениями, а не production projection. Для приведённой одной unscheduled A `syntheticResolutions = new Map()`; ambiguity cases получают context-specific synthetic source из category matrix. Helpers не добавляются в app API. Assertions A.finish=6 октября сохраняется; B.finish=null остаётся null при deadline20 октября; neither DTO содержит deadline/notBefore/mode/startDate. Account/session bytes и relations равны before. Deleted D архивируется из beforeSnapshot и после undo возвращается с source-only shape.

- [ ] **Step 2: Добавить replay и rollback RED tests.** После migration/revision10 legacy replay X возвращает adapted revision9/canUndo исходного response; текущая БД остаётся10, counts операций/undo не меняются. Same operationId+другой payload/project/session → OPERATION_REUSED409. Unknown original envelope → `LEGACY_REPLAY_NOT_FOUND`409 без выполнения. Headers не участвуют в original canonical. Обычный version2 payload с X → OPERATION_REUSED, а не принятие новой команды. Для new payload `contractVersion:2` входит в canonical.

Отдельно: missing Auto/lock resolution, digest mismatch, malformed archived JSON/unknown schema → fail closed, ни одного DDL/active/history изменения. Inject trigger abort при insert migrations3 откатывает archive, source projections и history. Второе применение записанной3 не меняет counts/digests. Удаление active task после migration не удаляет archive. Synthetic старый бинарник с registry1/2 отклоняет schema3. Run `npm test -- tests/legacy-compatibility.test.ts tests/optional-migration.test.ts` — FAIL до реализации.

- [ ] **Step 3: Реализовать private archive schema и atomic mapper.** DDL содержит exact reviewed table allowlist; archive без FK cascade от active Task:

```sql
CREATE TABLE scheduling_migration_archive (
  projectId TEXT NOT NULL,
  kind TEXT NOT NULL CHECK(kind IN ('project','task','operation-payload','operation-response','undo-snapshot')),
  recordKey TEXT NOT NULL,
  sourceSchemaVersion INTEGER NOT NULL CHECK(sourceSchemaVersion = 2),
  originalText TEXT NOT NULL,
  sha256 TEXT NOT NULL,
  PRIMARY KEY(projectId,kind,recordKey)
) STRICT;
ALTER TABLE operations ADD COLUMN contractVersion INTEGER NOT NULL DEFAULT 1 CHECK(contractVersion IN (1,2));
ALTER TABLE operations ADD COLUMN responseContractVersion INTEGER NOT NULL DEFAULT 2 CHECK(responseContractVersion = 2);
ALTER TABLE operations ADD COLUMN responseSha256 TEXT NOT NULL DEFAULT '';
-- APPLY_AFTER_ARCHIVE
ALTER TABLE tasks DROP COLUMN planMode;
ALTER TABLE tasks DROP COLUMN notBefore;
ALTER TABLE tasks DROP COLUMN deadline;
ALTER TABLE tasks DROP COLUMN completedStart;
ALTER TABLE tasks DROP COLUMN completedFinish;
ALTER TABLE tasks DROP COLUMN completedStartIndex;
ALTER TABLE tasks DROP COLUMN completedFinishIndex;
ALTER TABLE projects DROP COLUMN startDate;
```

`prepareOptionalMigration` получает exact reviewed SQL и делит его по одному literal `\n-- APPLY_AFTER_ARCHIVE\n`; если частей не две, fail closed. Сначала валидировать legacy schema/JSON/resolutions и собрать target projections в памяти. Затем первая часть SQL создаёт archive table и version column, helper вставляет original rows/JSON с digest, вторая часть удаляет legacy columns, helper сохраняет target projections. Version3 вставляет outer caller только после успеха. Никаких SQL drops до archive inserts.

До drop архивируются projects/tasks scheduling rows и exact исходные JSON-тексты payload/response/undo; для row JSON lossless string/numeric/null values, отдельно digest raw JSON history. Project/task archive kind не содержит account/session material. В одной outer `db.transaction(...).immediate()` выполняются archive inserts, SQL drops, source updates, frozen target operations.response с SHA256 и migrated undo snapshots, migration version3. Legacy operations.payload остаётся original canonical; `contractVersion=1` отличает replay-only record от новых2. Frozen response рассчитывается только из original archived response snapshot и соответствующего historical context, не из latest tree. `UPDATE operations SET response=?,responseContractVersion=2,responseSha256=? WHERE operationId=?` сохраняет project/session/payload. New target mutation тоже пишет responseSha256. В migration registry Task 5 outer transaction принадлежит `openDatabase`; helper не commit independently. `loadLegacyContexts` читает explicit current project/tasks/dependencies, original operations.response и undo.beforeSnapshot; одна запись на active project и каждый historical snapshot, ключ operationId/undo sequence хранится раздельно.

```ts
const source = {
  inputStart: legacyTask.inputStart,
  inputFinish: legacyTask.inputFinish,
  durationDays: legacyTask.durationDays,
};
const ambiguous = legacyTask.planMode === 'auto' ||
  (legacyTask.status === 'done' && [legacyTask.completedStart, legacyTask.completedFinish,
    legacyTask.completedStartIndex, legacyTask.completedFinishIndex].some(value => value !== null));
const resolution = resolutions.get(resolutionKey(context, legacyTask.id));
if (ambiguous && (!resolution || resolution.legacyDigest !== digestLegacyTask(legacyTask)))
  throw new DomainError('MIGRATION_POLICY_REQUIRED', 'Требуется согласованная политика переноса прежнего плана.');
const targetSource = resolution?.source ?? source;
```

`digestLegacyTask` — SHA256 canonical frozen task, module-private; `resolutionKey` canonical tuple `[context.kind,context.key,taskId]`, без склейки с неоднозначными разделителями. Не применять W02 input rejection к уже сохранённому invalid source: сохранить scalar source, Task 2 вернёт diagnostic. В target allowlist нет legacy поля; archive не доступен из client bundle или future export. Размер/число context resolutions проверять на всю БД и историю; не только current rows.

- [ ] **Step 4: Реализовать lookup-only replay перед target parse.**

```ts
const legacyReplayIdentitySchema = z.object({ operationId: uuidSchema }).passthrough();
const identity = legacyReplayIdentitySchema.parse(body); // только безопасный lookup key, canonical сравнивает body целиком
const row = findOperation(db, identity.operationId);
if (!row || row.contractVersion !== 1)
  throw new DomainError('LEGACY_REPLAY_NOT_FOUND', 'Прежняя операция не найдена. Проверьте актуальный проект.', 409);
if (row.projectId !== projectId || row.sessionId !== sessionId || row.payload !== canonical(body))
  throw new DomainError('OPERATION_REUSED', 'Идентификатор операции уже использован.', 409);
if (row.responseContractVersion !== 2 || createHash('sha256').update(row.response).digest('hex') !== row.responseSha256)
  throw new Error('Invalid frozen operation response');
const parsed = projectTreeV2Schema.safeParse(JSON.parse(row.response));
if (!parsed.success) throw new Error('Invalid frozen operation response');
return parsed.data;
```

Для command/rename replay extracts UUID operationId без normalization/stripping original body. Дополнительное изменённое поле не игнорируется: canonical полного body не совпадёт и даст409. `findOperation` — private prepared SELECT `projectId,sessionId,payload,contractVersion,response,responseContractVersion,responseSha256 WHERE operationId=?`; target parse failure преобразовать во внутренний Error500, не пользовательский ZodError400. No row — завершить branch; нет fallthrough к `applyCommand` или `change()`. Проверка transport version будет в Task 5 **до** вызова helper. Replay не вызывает adaptLegacyTree или resolution loader.

- [ ] **Step 5: Run GREEN и commit.** `npm test -- tests/legacy-compatibility.test.ts tests/optional-migration.test.ts tests/migration.test.ts tests/scheduling-repository.test.ts`; `npm run test:integration`; typecheck/lint/format/check:kit. Expect PASS и исходный `openDatabase` по-прежнему применяет только1/2. Commit `feat: prepare lossless scheduling migration and replay adapter`; independent review. Task 3 не разрешает запуск 003 на пользовательской БД.

## Task 4: Реализовать выбранную C17 conversion policy и preview acknowledgement

**Files:** Create `src/server/legacy-scheduling.ts`, `src/server/optional-upgrade.ts`, `tests/optional-upgrade.test.ts`; modify `src/server/legacy-compatibility.ts`, `tests/legacy-compatibility.test.ts`, `tests/optional-migration.test.ts`, `package.json` explicit integration list. Existing [ADR 007](../../adr/007-legacy-scheduling-migration.md), DECISIONS и normative annex уже содержат принятое решение. Registry/API/UI подключаются только в Task 5 после GREEN/review.

**Inputs:** C17/ADR 007; Task 3 aggregate counts всех active/history contexts, exact source/digest archive contract; normative M01–M10. Owner approval получено 2026-10-07; повторный выбор политики не требуется.

- [ ] **Step 1: Превратить принятую матрицу M01–M10 в literal synthetic RED cases.**

| Legacy category | Synthetic input | Принятый C17 outcome | Проверка |
|---|---|---|---|
| Auto | source null, duration3; корректный old interval5–7 октября | source pair5–7, duration3; originals archived | M01; Auto без абсолютной опоры — M02 source unchanged/unknown |
| Absolute done lock | input pair5–7, completed pair6–8, duration3 | active6–8, done; archive обеих пар | M03/M07; replacement category в preview |
| Relative done lock | indices[0,3), origin9 октября, weekdays | active9–13 октября; без опоры — source unchanged/unknown | M04/M05; не подставлять нынешний origin в history |
| Deleted historical task | done/Auto только в undo/operation response | projection по собственному historical state, deleted ID сохранён | M08/M09; revision9 replay при current10 без mutations |
| Invalid/calendar mismatch/FS | saved invalid pair/duration mismatch; либо пересекающаяся FS | originals сохраняются, invalid/FS diagnostic, без normalization | M10; валидная pair остаётся видимой при infeasible |

- [x] **Step 2: Зафиксировать owner decision.** C17 и ADR 007 от 2026-10-07 содержат принятую однократную конвертацию, сохранность и explicit preview. Закрыт policy gate, а не application acceptance этого Task.

- [ ] **Step 3: Реализовать deterministic resolver и acknowledgement с RED/GREEN.** Task 3 определяет LegacyContextRecord/ResolutionIndex и loader. Frozen server-only `calculateLegacySchedule` воспроизводит алгоритм исходного S3 `6317791dff9dc944de3a1676effebcf1322b2ff6` на полном собственном legacy snapshot; после переключения не импортирует mutable target scheduling types/solver. Это compatibility implementation для migration, без второго active product scheduler. Сохранённый historical schedule используется только с проверенным соответствующим context; отсутствие необходимых источников даёт approved source-preserving unknown, а не выдуманную опору. Каждая resolution содержит digest оригинала. Отсутствующий/mismatched resolution record по-прежнему fail closed.

```ts
// legacy-scheduling.ts; LegacySnapshotSchema/LegacyTreeSchema из frozen legacy-contracts.ts
export function calculateLegacySchedule(snapshot: z.infer<typeof LegacySnapshotSchema>):
  z.infer<typeof LegacyTreeSchema>['schedule'];
// legacy-compatibility.ts, по M01–M10; unknown также явный resolved outcome
export function resolveLegacySources(contexts: readonly LegacyContextRecord[]): ResolutionIndex;
// optional-upgrade.ts: никаких active writes в preview
export type OptionalUpgradeApproval = { policyId: 'legacy-scheduling-v1'; previewDigest: string };
export type OptionalUpgradePreview = OptionalUpgradeApproval & { counts: {
  sourceIntervals: number; materializedAuto: number; materializedDone: number;
  unavailableAbsolute: number; replacedDoneSource: number; invalid: number;
  fsConflicts: number; unavailableHistory: number;
} };
export function previewOptionalUpgrade(db: Database.Database): OptionalUpgradePreview;
export function requireOptionalUpgradeApproval(db: Database.Database,
  approval: OptionalUpgradeApproval | undefined): void;
```

Preview digest включает exact архивируемые project/task scheduling sources, edges, raw payload/response/undo и их ключи/версии в детерминированном порядке, без auth/session bytes. `requireOptionalUpgradeApproval` повторяет preview на locked state внутри migration transaction: missing/wrong-policy → MIGRATION_APPROVAL_REQUIRED, другой digest → MIGRATION_PREVIEW_CHANGED. Ни один из этих отказов не пишет DDL/archive/source/history. Невосстановимые интервалы дают отдельную preview category и unknown diagnostic целевой проекции; archive сохраняет причину/originals, а source pair не дополняется.

```ts
it('requires the exact preview before migration writes', () => {
  const preview = previewOptionalUpgrade(db);
  const before = db.prepare('SELECT version FROM migrations ORDER BY version').all();
  expect(() => requireOptionalUpgradeApproval(db, undefined)).toThrow('MIGRATION_APPROVAL_REQUIRED');
  expect(() => requireOptionalUpgradeApproval(db, { ...preview, previewDigest: '0'.repeat(64) }))
    .toThrow('MIGRATION_PREVIEW_CHANGED');
  expect(db.prepare('SELECT version FROM migrations ORDER BY version').all()).toEqual(before);
  expect(() => requireOptionalUpgradeApproval(db, preview)).not.toThrow();
});
```

Дополнительно literal tests меняют source/calendar/edge и raw historical payload после preview: старое подтверждение отклоняется; auth/session bytes не входят в preview output. Run `npm test -- tests/legacy-compatibility.test.ts tests/optional-migration.test.ts tests/optional-upgrade.test.ts`: RED до реализации helper/resolver, затем GREEN на независимой M матрице. Archive original остаётся immutable.

- [ ] **Step 4: Independent review и synthetic GREEN.** `npm test -- tests/legacy-compatibility.test.ts tests/optional-migration.test.ts tests/optional-upgrade.test.ts`; `npm run verify`, `npm run check:kit`, `git diff --check`. Два reviewers проверяют C17 evidence, M01–M10, temporal context mapping, frozen calculator boundary и digest acknowledgement. Commit `feat: prepare approved legacy scheduling conversion` после GREEN/review. Новые технические contracts не получают прежних APPROVED автоматически.

**Acceptance:** C17 policy уже CLOSED; Task 4 GREEN только при exact active/deleted/history representation, frozen compatibility, acknowledgement/rollback tests и двух independent approvals. Production execution всё ещё требует отдельного поручения; policy choice не permission deploy.

## Task 5: Единый атомарный переход API, storage и UI

**Files:** Modify `src/shared/contracts.ts`, `src/shared/work-preservation.ts`, `src/domain/planning.ts`, `scheduling-types.ts`, `scheduling.ts`, `src/server/database.ts`, `migrate.ts`, `repository.ts`, `app.ts`, `.dockerignore`, `scripts/package-check.mjs`, all client files из карты, existing application fixtures/tests и `scripts/e2e-server.ts` (возврат только собственного synthetic databasePath); create `tests/optional-api.test.ts`, `tests/helpers/optional-api-fixtures.ts`, `tests/helpers/pinned-s3.ts`, `tests/client/optional-api.test.ts`, `tests/e2e/optional-scheduling.spec.ts`, `tests/e2e/legacy-client-upgrade.spec.ts`; update package test lists и README/BOOTSTRAP/STATUS. Preparation optional modules удалить после переноса их реализаций/imports. Frozen legacy contracts/compatibility/archive остаются server-only.

**Entry:** Task 1–3 approved exact SHAs, Task 4 CLOSED с policy ADR. Один writer держит все общие контракты. Этот task имеет один интеграционный commit после всех steps и полного GREEN: backend target без совместимого client не считается завершённым deliverable.

**Interfaces:** Active `Task`/Project/Command становятся V2 aliases; `calculateSchedule(input: OptionalInput): OptionalResult` заменяет прежнюю Auto функцию. `Repository.applyCommand(projectId, envelope: CommandEnvelopeV2, sessionId)` получает strict new versioned body. Separate `Repository.replayLegacy(projectId, body: unknown, sessionId): ProjectTreeV2` вызывает lookup-only adapter; new replay не проходит target command parse. `Repository.renameProject` принимает RenameV2; `getTree/getSchedule/list/create` выдают target schemas. `project.schedule` сохраняет только calendar/timezone. Client `api.replayLegacy(id, originalBody, kind:'command'|'rename')` передаёт unchanged body с transport headers, без автоматики придумывания missing envelope.

- [ ] **Step 1: Добавить HTTP/version boundary RED для всех routes.**

Определить `tests/helpers/optional-api-fixtures.ts` и импортировать helpers в `tests/optional-api.test.ts` как `./helpers/optional-api-fixtures.js`. Все чтения относятся к disposable synthetic db данного test:

```ts
import type Database from 'better-sqlite3';
export function rawSyntheticCountsAndRevision(db: Database.Database, projectId: string) {
  return {
    revision: (db.prepare('SELECT revision FROM projects WHERE id=?').get(projectId) as { revision: number }).revision,
    counts: ['projects', 'tasks', 'dependencies', 'operations', 'undo_snapshots'].map(table =>
      (db.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get() as { n: number }).n),
  };
}
export function validLegacyBodyForRoute(method: string, url: string) {
  if (method === 'POST' && url === '/api/projects') return { title: 'Synthetic legacy project' };
  if (method === 'PATCH') return { title: 'Synthetic rename', expectedRevision: 0,
    operationId: '33333333-3333-4333-8333-333333333333' };
  return { expectedRevision: 0, operationId: '44444444-4444-4444-8444-444444444444',
    command: { type: 'task.create', title: 'Synthetic legacy task', parentId: null } };
}
```

```ts
it.each([
  ['GET', '/api/projects'], ['POST', '/api/projects'],
  ['PATCH', `/api/projects/${projectId}`], ['GET', `/api/projects/${projectId}/tree`],
  ['GET', `/api/projects/${projectId}/schedule`], ['POST', `/api/projects/${projectId}/commands`],
] as const)('rejects unversioned %s %s before project access', async (method, url) => {
  const before = rawSyntheticCountsAndRevision(db, projectId);
  const response = await app.inject({ method, url, headers: { origin, cookie: syntheticCookie, 'content-type': 'application/json' },
    ...(method === 'GET' ? {} : { payload: validLegacyBodyForRoute(method, url) }) });
  expect(response.statusCode).toBe(426);
  expect(response.json()).toEqual({ code: 'CONTRACT_VERSION_CONFLICT', message: 'Версия приложения устарела. Обновите страницу для продолжения. Этот запрос не изменил данные.' });
  expect(rawSyntheticCountsAndRevision(db, projectId)).toEqual(before);
});
```

Helpers строят body по literal existing S3 commands/rename/create; не используют target schema для old client fixture. Spy Repository getTree/listProjects/create/rename/apply/replay показывает ноль вызовов при426. Unsupported header=1/3 тоже426. No session401 и wrong origin403 сохраняют приоритет перед version. Auth/session/login/logout не требуют contract header. Настоящий неизменённый S3 build и ApiError проверяет отдельный Step 8a ниже; copied decoder или S3-shaped fetch его не заменяет.

- [ ] **Step 2: Добавить atomic source/done/graph/replay/undo RED tests.** Repository+HTTP cases: N01 mismatch вместе с title/status — rollback всех tasks/project/edges/operations/undo; omitted/null patch; pair/null duration; new calendar-invalid input reject, calendar settings change сохраняет source с diagnostic; done source edit rejected, task.edit statusdoing+source succeeds одной revision и undo. Incomplete done allowed без lock materialization. duration-only preserveWork требует подтверждение, work-child получает source и оба endpoints, parent триnull; delete last child оставляет parent триnull; undo восстанавливает целиком. Unknown/foreign/cycle/self/duplicate/summary edges rejected before commit.

OS12: actual HTTP target-aware replay headers+original legacy body возвращают revision9 после latest10; unknown body no writes; reused ID/new versioned payload409; target exact retry исходный response после later mutations; wrong session/project rejected. OS13: premigration undo с deleted task, stale undo after another session409, injected response-schema/save failure откатывает все active/history fields. Tests используют новую disposable SQLite, никакой real DB. Run targeted API/storage tests — FAIL на отсутствие target headers/mutation/mapper.

Обязательная буквальная durable regression в `tests/optional-migration.test.ts` после integration Task 5: использовать S2 fixture Task 3, изменив только initial active revision с10 на9; X original body/reply revision9 и source finish6 октября остаются прежними. В test-scoped setup получить path/projectId/sessionId/aId/operationId из literal fixture; `legacyBody` — исходный объект из Task 3 originalPayload до canonical serialization:

```ts
db.transaction(() => {
  prepareOptionalMigration(db, readFileSync('migrations/003-optional-scheduling.sql', 'utf8'), syntheticResolutions);
  db.prepare('INSERT INTO migrations(version) VALUES (3)').run();
}).immediate();
const frozen = (db.prepare('SELECT response FROM operations WHERE operationId=?').get(operationId) as { response: string }).response;
db.close();
db = openDatabase(path); // schema3: migration/resolutions не вызываются второй раз
const repository = new Repository(db);
const after = repository.applyCommand(projectId, {
  contractVersion: 2, expectedRevision: 9,
  operationId: '55555555-5555-4555-8555-555555555555',
  command: { type: 'task.edit', taskId: aId, changes: { title: 'Synthetic Y' } },
}, sessionId);
expect(after.project.revision).toBe(10);
const beforeReplay = rawSyntheticCountsAndRevision(db, projectId);
const replay = repository.replayLegacy(projectId, legacyBody, sessionId);
expect(replay).toEqual(JSON.parse(frozen));
expect(replay.project.revision).toBe(9);
expect(replay.tasks[0]!.inputFinish).toBe('2026-10-06');
expect(replay.tasks[0]!.title).toBe('Synthetic A');
expect(rawSyntheticCountsAndRevision(db, projectId)).toEqual(beforeReplay);
expect(JSON.stringify(replay)).not.toContain('deadline');
expect((db.prepare('SELECT payload FROM operations WHERE operationId=?').get(operationId) as { payload: string }).payload).toBe(originalPayload);
expect(readArchiveText(db, 'operation-payload', operationId)).toBe(originalPayload);
```

Import raw helper from `./helpers/optional-api-fixtures.js`; no runtime ResolutionIndex в Repository.replayLegacy. Отдельный corruption test меняет frozen response/digest на собственном synthetic db: safe500/no writes, а не пересчёт из latest. Для preparation Task 3 выполнять тот же reopen через `new Database(path)` без подключения active registry; Task 5 повторяет именно через `openDatabase` и актуальную Repository.

- [ ] **Step 3: Перенести целевые модули и подключить migration после gate.** Тела Task 1/2 становятся существующими domain/contracts; old helpers `applyTaskPlan`, `completedInterval`, `fixedDuration`, plan modes и старый `ScheduleResult` заменяются новыми exports. `validateDependency/validateDependencies` принимает только необходимые id/parent fields и edges, не требует mode. Frozen schemas не импортируют mutable target schemas. Удалить optional modules и обновить все imports, без оставления второго active solver.

`database.ts` migration registry меняется на records `{version,file,prepare?}`; 003 prepare выполняется внутри существующей immediate migration transaction до version insert. Task 4 implementation/review подтверждён до изменения registry. `openDatabase` получает optional typed `optionalUpgrade: OptionalUpgradeApproval`; обычный startup его не передаёт. `isFreshDatabase` фиксируется по отсутствию исходной схемы до любых migration writes. Existing БД с pending003 без подтверждения отказывает до изменяющих PRAGMA/DDL; неподдерживаемая source schema отклоняется до промежуточных migrations. `.dockerignore` и expected allowlist `scripts/package-check.mjs` добавляют только `!migrations/003-optional-scheduling.sql`. Synthetic package check, unknown schema/downgrade, no-ack startup и failed version insertion tests обязательно проходят.

```ts
const migrations: { file: string; prepare?: (db: Database.Database, sql: string) => void }[] = [
  { file: '001-initial.sql' }, { file: '002-scheduling.sql' },
  { file: '003-optional-scheduling.sql', prepare: (db, sql) => {
      if (!isFreshDatabase) requireOptionalUpgradeApproval(db, optionalUpgrade);
      prepareOptionalMigration(db, sql, resolveLegacySources(loadLegacyContexts(db)));
    } },
];
// В существующем transaction callback, а не второй commit:
if (entry.prepare) entry.prepare(db, migrationSql);
else db.exec(migrationSql);
db.prepare('INSERT INTO migrations(version) VALUES (?)').run(index + 1);
```

`resolveLegacySources` и `requireOptionalUpgradeApproval` — конкретные reviewed exports Task 4, не env/global flag. До Task 4 GREEN этот step запрещён. Helper получает reviewed SQL exact input; не выполнять arbitrary path/script из manifest. В `migrate.ts` будущий `--preview` открывает existing БД readonly напрямую, без automatic migrations, и выводит только policy/counts/digest; будущий `--confirm-preview=<digest>` передаёт typed approval в `openDatabase`. Эти flags пока не реализованы. Внутри transaction preview перепроверяется до writes; stale/missing acknowledgement полностью откатывает upgrade. На production agent это не запускает.

Synthetic integration tests через реальный CLI/server: preview не меняет исходные bytes/versions/counts; обычный startup schema2 без approval отказывает; confirmed upgrade сохраняет accounts/history; changed source после preview блокирует apply; новый пустой экземпляр создаётся; restart schema3 без повторного approval проходит. Дополнить BOOTSTRAP процедурой backup/preview/explicit apply и честным отсутствием разрешения production execution.

- [ ] **Step 4: Заменить Repository projections/writes и отдельный replay.** `SELECT *` для active project/task заменить explicit target columns; insert/save исключают legacy поля и сохраняют независимую duration. operations explicit `contractVersion`, payload/response; new version=2 canonical whole new envelope. Target parsed response validated до commit. Undo использует migrated V2 beforeSnapshot и existing session/revision/20-record bounds; archival originals остаются immutable. Перенести прежний canonical в shared function и regression подтвердить равенство literal old/new output. Replay version1 не меняет archived payload и не читает latest project вместо cached outcome.

```ts
case 'task.edit': {
  const task = find(command.taskId);
  const sourceKeys = ['inputStart', 'inputFinish', 'durationDays'] as const;
  const patch = Object.fromEntries(sourceKeys.filter(key => key in command.changes)
    .map(key => [key, command.changes[key]])) as SourcePatch;
  const detailKeys = ['title', 'description', 'status'] as const;
  const details = Object.fromEntries(detailKeys.filter(key => key in command.changes)
    .map(key => [key, command.changes[key]])) as Partial<Pick<Task, 'title' | 'description' | 'status'>>;
  const returnsToWork = task.status === 'done' && details.status !== undefined && details.status !== 'done';
  if (task.status === 'done' && Object.keys(patch).length && !returnsToWork)
    throw new DomainError('DONE_PLANNING', 'Верните завершённую задачу в работу перед изменением сроков.');
  if (hasChildren(task.id) && Object.keys(patch).length)
    throw new DomainError('SUMMARY_DATES', 'Сводная задача не имеет собственных сроков.');
  Object.assign(task, applySourcePatch(task, patch, snapshot.project.calendarType), details, { updatedAt: timestamp });
  break;
}
```

Done без source changes допускает statusdone и incomplete source. Calendar change не вызывает старую fixedDuration и не переписывает source. `requiresWorkPreservation` проверяет dates/duration/statusdone/incident dependencies, а не archive:

```ts
return task.inputStart !== null || task.inputFinish !== null || task.durationDays !== null ||
  task.status === 'done' || dependencies.some(edge => edge.predecessorId === task.id || edge.successorId === task.id);
```

- [ ] **Step 5: Добавить transport guard и lookup-only branch.** После существующих auth/origin/content-type checks каждая project route проверяет header. Guard не должен быть только в POST commands. Список/create/rename/tree/schedule также защищён. До schema parse target payload выбрать replay; headers never merged into archival payload.

```ts
function requireContractVersion(request: FastifyRequest): void {
  if (request.headers['x-leaf-contract-version'] !== '2')
    throw new DomainError('CONTRACT_VERSION_CONFLICT', 'Версия приложения устарела. Обновите страницу для продолжения. Этот запрос не изменил данные.', 426);
}
app.post('/api/projects/:id/commands', request => {
  const sessionId = requireSession(request);
  requireContractVersion(request);
  const { id } = projectParamsSchema.parse(request.params);
  if (request.headers['x-leaf-legacy-replay'] === '1')
    return app.repository.replayLegacy(id, request.body, sessionId);
  return app.repository.applyCommand(id, commandEnvelopeV2Schema.parse(request.body), sessionId);
});
```

Та же dispatch для PATCH rename. Unexpected replay header значения → safe schema/contract refusal; GET/create с replay header не выполняет legacy mutation. Target DTO всегда contractVersion2 проверяется client перед revision guard.

- [ ] **Step 6: Добавить client/gesture RED tests с literal server fixture.** `tests/client/optional-api.test.ts` проверяет headers для GET project list/tree и POST/PATCH, auth без версии, original legacy replay JSON bytes semantically unchanged, new canonical envelope version2. Existing App tests проверяют stale version2 revision9 после10 не заменяет fresh tree; contract426 message виден и retry не считается uncertain mutation; network lost response сохраняет exact new envelope. Fixture server schedule содержит real/display отдельно; tests не вызывают calculator для expected UI.

PlanFields tests: три optional input, duration empty→null, editing start/finish не создаёт соседнее значение; invalid duration/triple server failure сохраняет title/date draft; summary с null boundaries не показывает disabled filled interval; done explicit return scenario. Нет режимов/deadline/notBefore/project start field. Calendar/timezone доступны в переименованных настройках проекта с прежней dirty protection.

```ts
it('renders a conditional bar without promoting it to task dates', () => {
  const tree = optionalTreeFixture(); // literal P/A/C, N02 display C=5–7 октября
  const props = { tree, selectedId: null, collapsed: new Set<string>(), onToggle: vi.fn(),
    onSelect: vi.fn(), onAction: vi.fn(), onPlan: vi.fn(), disabled: false, show: true, reveal: null };
  render(<TaskTimeline {...props} />);
  const bar = screen.getByRole('button', { name: /Работа C.*Условное размещение; начало не задано/ });
  expect(bar).toBeVisible();
  expect(screen.queryByText('2026-10-05 – 2026-10-07')).not.toBeInTheDocument();
  fireEvent.keyDown(bar, { key: 'ArrowRight' });
  expect(props.onPlan).not.toHaveBeenCalled();
});
```

Определить и экспортировать `optionalTreeFixture` в existing `tests/client/fixtures.ts`; импортировать его из `./fixtures.js`. Это literal server result, не вызов production solver:

```ts
export const optionalIds = { project: '11111111-1111-4111-8111-111111111111',
  p: '22222222-2222-4222-8222-222222222221', a: '22222222-2222-4222-8222-222222222222',
  c: '22222222-2222-4222-8222-222222222223' };
export function optionalTreeFixture(): ProjectTreeV2 {
  const timestamp = '2026-10-07T00:00:00.000Z';
  const project: ProjectV2 = { id: optionalIds.project, title: 'Демо-проект', revision: 0,
    calendarType: 'weekdays', timezone: 'UTC', createdAt: timestamp, updatedAt: timestamp };
  const task = (id: string, title: string, sortOrder: number, parentId: string | null): TaskV2 => ({
    id, projectId: project.id, parentId, title, description: '', sortOrder, status: 'todo',
    inputStart: null, inputFinish: null, durationDays: null, createdAt: timestamp, updatedAt: timestamp });
  return { contractVersion: 2, project, canUndo: false, dependencies: [], tasks: [
    task(optionalIds.p, 'Этап P', 0, null),
    { ...task(optionalIds.a, 'Работа A', 0, optionalIds.p), inputStart: '2026-10-05', inputFinish: '2026-10-06' },
    { ...task(optionalIds.c, 'Работа C', 1, optionalIds.p), durationDays: 3 }],
    schedule: { analysisStatus: 'pending-policy', feasibility: 'feasible',
      coverage: { knownLeafCount: 1, totalLeafCount: 2 },
      tasks: { [optionalIds.a]: { startDate: '2026-10-05', finishDate: '2026-10-06', calendarSpanDays: 2 },
        [optionalIds.c]: { startDate: null, finishDate: null, calendarSpanDays: null } },
      summaries: { [optionalIds.p]: { startDate: null, finishDate: null, calendarSpanDays: null, knownLeafCount: 1, totalLeafCount: 2 } },
      display: { [optionalIds.c]: { kind: 'conditional', startDate: '2026-10-05', finishDate: '2026-10-07', clipped: false } },
      criticalTaskIds: [], criticalDependencyIds: [], diagnostics: [] } };
}
```

Task 5 imports these types из active contracts (до переноса — optional-contracts). Дополнительно pointer drag/resize conditional/done/summary не выдаёт command; Enter открывает task; source marker tests ниже сохраняют отдельно finish2 октября при display9. Real arrow отсутствует при unknown edge, но Dependencies сохраняет graph edge. Sparse/deep/filtered rows не меняют input display.

- [ ] **Step 7: Реализовать UI replacement и маленькие helper contracts.**

```ts
export function sourceOf(task: Task): SourceFields {
  return { inputStart: task.inputStart, inputFinish: task.inputFinish, durationDays: task.durationDays };
}
export function realLabel(task: Task, schedule: OptionalResult): string;
export function ganttInterval(task: Task, schedule: OptionalResult):
  { start: string; finish: string; kind: 'work' | 'summary' | 'conditional'; clipped: boolean } | null;
export type SourceMarker = { taskId: string; kind: 'source-start' | 'source-finish'; date: string };
export function sourceMarkers(task: Task, schedule: OptionalResult): SourceMarker[];
export function gesturePatch(task: Task, calendar: CalendarType, kind: 'move' | 'resize', target: string):
  { patch: SourcePatch; requiresDurationChoice: boolean };
```

Эти helpers заменяют `planOf`, `planForGesture`, `intervalOf`; `computedDateLabel`/`compactDateLabel` используют **только** real/source dates. `ganttInterval` consume server display; не вычисляет anchor в React. `realLabel` full valid pair из schedule, single input markers из source, summary missing → empty. Dependencies/tooltip не получают условный диапазон как реальный. TaskTimeline initial/reveal window может выбрать displayStart только для просмотра SVG, не source label или «начала проекта».

SourceMarker projection в `src/client/gantt-view.ts` копирует **исходную** известную дату. Она независима от conditionalStart/Finish и не вычисляет scheduler data:

```ts
export function sourceMarkers(task: Task, schedule: OptionalResult): SourceMarker[] {
  if (schedule.summaries[task.id]) return [];
  const real = schedule.tasks[task.id];
  if (real?.startDate && real.finishDate) return [];
  const markers: SourceMarker[] = [];
  if (task.inputStart !== null) markers.push({ taskId: task.id, kind: 'source-start', date: task.inputStart });
  if (task.inputFinish !== null) markers.push({ taskId: task.id, kind: 'source-finish', date: task.inputFinish });
  return markers;
}
```

Gantt для каждой строки независимо рендерит `ganttInterval` **и** `sourceMarkers`; отсутствие interval не прерывает marker render. Для marker SVG `line` на `dateX(marker.date,start,dayWidth)+dayWidth/2`, `data-gantt-marker={task.id+':'+marker.kind}`, `role=button`, tabIndex0, aria-label `Работа C, Исходное окончание: 2026-10-02` или `Исходное начало`. Enter/Space открывает panel; pointer move/resize handler отсутствует. Marker вне visible window не рисуется в SVG, но исходная дата всегда остаётся в tree/graph/panel label. Conditional aria-label/title явно содержит «Условное размещение; начало не задано»; marker finish не получает conditionalFinish. Valid real pair рисует work bar, а lone start не создаёт bar.

Literal RED/GREEN tests в `tests/client/gantt.test.tsx`: импортировать `Gantt` из `../../src/client/Gantt.js`, `treeRows` из `../../src/client/tree-view.js`, `optionalTreeFixture`/`optionalIds` из `./fixtures.js`, ProjectTreeV2 из active contracts. Existing render/screen/vi imports остаются. Render Gantt window начинается1 октября, чтобы исходное окончание2 и conditional9 оба попали на шкалу:

```ts
function renderMarkerTree(tree: ProjectTreeV2) {
  return render(<Gantt tree={tree} rows={treeRows(tree.tasks, new Set())} start="2026-10-01" scale="days"
    today="2026-10-07" selectedId={null} disabled={false} onSelect={vi.fn()} onPlan={vi.fn()} />);
}
it('shows start-only as a source marker without a bar', () => {
  const tree = optionalTreeFixture(); const c = tree.tasks.find(t => t.id === optionalIds.c)!;
  c.inputStart = '2026-10-09'; tree.schedule.display = {};
  const { container } = renderMarkerTree(tree);
  expect(screen.getByRole('button', { name: 'Работа C, Исходное начало: 2026-10-09' })).toBeVisible();
  expect(container.querySelector(`[data-gantt-bar="${c.id}"]`)).toBeNull();
});
it('shows finish-only without anchor, then keeps finish2 separate from conditional9', () => {
  const tree = optionalTreeFixture(); const a = tree.tasks.find(t => t.id === optionalIds.a)!;
  const c = tree.tasks.find(t => t.id === optionalIds.c)!;
  a.inputStart = null; a.inputFinish = null; c.inputFinish = '2026-10-02'; c.durationDays = null;
  tree.schedule.tasks[a.id] = { startDate: null, finishDate: null, calendarSpanDays: null };
  tree.schedule.coverage.knownLeafCount = 0; tree.schedule.summaries[optionalIds.p]!.knownLeafCount = 0;
  tree.schedule.display = {};
  const { container, rerender } = renderMarkerTree(tree);
  expect(screen.getByRole('button', { name: 'Работа C, Исходное окончание: 2026-10-02' })).toBeVisible();
  expect(container.querySelector(`[data-gantt-bar="${c.id}"]`)).toBeNull();
  a.inputStart = '2026-10-09'; a.inputFinish = '2026-10-09';
  tree.schedule.tasks[a.id] = { startDate: '2026-10-09', finishDate: '2026-10-09', calendarSpanDays: 1 };
  tree.schedule.coverage.knownLeafCount = 1; tree.schedule.summaries[optionalIds.p]!.knownLeafCount = 1;
  tree.schedule.display[c.id] = { kind: 'conditional', startDate: '2026-10-09', finishDate: '2026-10-09', clipped: false };
  rerender(<Gantt tree={tree} rows={treeRows(tree.tasks,new Set())} start="2026-10-01" scale="days"
    today="2026-10-07" selectedId={null} disabled={false} onSelect={vi.fn()} onPlan={vi.fn()} />);
  expect(screen.getByRole('button', { name: 'Работа C, Исходное окончание: 2026-10-02' })).toBeVisible();
  expect(screen.getByRole('button', { name: /Работа C.*2026-10-09.*Условное размещение; начало не задано/ })).toBeVisible();
  expect(c.inputFinish).toBe('2026-10-02');
});
```

PlanFields редактирует SourceFields; TaskPanel Draft содержит source поля, onSave отправляет один changes patch (diff baseline), summary source не отправляет. App new envelope имеет contractVersion2; retry сохраняет исходный body/operationId. ProjectPlan переименовать в project settings display, убрать startDate и copy «План проекта», сохранить calendar/timezone/dirty protection. `ScheduleStatus` pending-policy copy «Критический путь ожидает выбора правил расчёта»; убрать missingOrigin/deadline/old floats, coverage и FS diagnostics показывать независимо.

Nullable-safe gesture sketch; source duration не используется для вычисления второй границы:

```ts
export function gesturePatch(task: Task, calendar: CalendarType, kind: 'move' | 'resize', target: string) {
  const interval = realInterval(task, calendar);
  if (task.status === 'done' || !interval) throw new RangeError('LOCKED_PLAN');
  if (kind === 'resize') {
    const span = workingDaysInclusive(interval.startDate, target, calendar);
    return { patch: { inputFinish: target } as SourcePatch,
      requiresDurationChoice: task.durationDays !== null && task.durationDays !== span };
  }
  const shift = dateToIndex(target, interval.startDate, calendar);
  return { patch: { inputStart: target,
    inputFinish: indexToDate(shift, interval.finishDate, calendar) } as SourcePatch,
    requiresDurationChoice: false };
}
```

W05 move только real valid todo/doing pair: сдвинуть оба края на одинаковое число рабочих дней, duration сохраняется. Resize задаёт finish, при заданной duration и несовпадении — явный choice «Синхронно изменить длительность»/«Очистить длительность»/«Отмена» до отправки; cancellation ноль mutation. При выбранной синхронизации отправить `{inputFinish:target,durationDays:workingDaysInclusive(start,target,calendar)}`, при очистке `{inputFinish:target,durationDays:null}`. Summary/done/conditional/incomplete locked вызывающей Gantt; standalone helper принимает только leaf. Keyboard exact same intent, pointer Esc preview cancel. Пример weekday pair9–12 октября move+1 →12–13 октября, null duration сохраняется; resize finish13 с duration2 требует explicit duration3 либоnull. No notBefore/neighbor autoslide. Обновить все direct `page.request` project calls existing E2E helpers: header `X-Leaf-Contract-Version:2` и new body version2; auth requests остаются прежними.

- [ ] **Step 8: Browser E2E, старые suites и build GREEN.** Новые OS cases через `syntheticRuntime()` с собственным temporary DB, реальный built server, оба viewport1440×900/1280×800. N01→N02→source correction→FS conflict→one undo→reload→actual restart. Network interception after real committed save проверяет exact retry/no duplicate. Separate route test реального unversioned S3-shaped fetch получает426; target-aware original replay source fixture migration возвращает revision9 после10. Keyboard Tab/Esc/open/close focus, pending-policy message, project empty/loading/offline/error проверяются фактическими actions.

- [ ] **Step 8a: Проверить настоящий pinned unchanged S3 против upgraded server.** Provenance — локальный immutable `6317791dff9dc944de3a1676effebcf1322b2ff6`, по которому изучался S3. Не брать старый client из current source и не переписывать decoder. Создать `tests/helpers/pinned-s3.ts` с helpers ниже. Archive включает только перечисленные public build inputs этого SHA, без `.git`, private/runtime, agent settings или exports. Lockfile install offline, Node/npm те же pinned версии; при missing cached package suite fails и сообщает ограничение, без skipped/mock replacement. Source snapshot не меняется; API probe — отдельная сборка **того же** старого `src/client/api.ts`, browser app — обычный pinned `npm run build`.

```ts
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdtemp, rm, readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { tmpdir } from 'node:os';
import { join, resolve, sep } from 'node:path';
import { pathToFileURL } from 'node:url';
import type { Page } from '@playwright/test';
const execFileAsync = promisify(execFile);
export const PINNED_S3_SHA = '6317791dff9dc944de3a1676effebcf1322b2ff6';
export async function buildPinnedS3() {
  const root = await mkdtemp(join(tmpdir(), 'leaf-pinned-s3-'));
  try {
    const archive = join(root, 'source.tar');
    await execFileAsync('git', ['archive', '--format=tar', `--output=${archive}`, PINNED_S3_SHA, '--',
      'package.json', 'package-lock.json', 'tsconfig.json', 'tsconfig.server.json', 'vite.config.ts',
      'index.html', 'src', 'migrations'], { cwd: process.cwd() });
    await execFileAsync('tar', ['-xf', archive, '-C', root]);
    for (const path of ['src/client/api.ts', 'src/client/App.tsx']) {
      const original = (await execFileAsync('git', ['show', `${PINNED_S3_SHA}:${path}`], { cwd: process.cwd() })).stdout;
      const extracted = await readFile(join(root, path));
      if (createHash('sha256').update(original).digest('hex') !== createHash('sha256').update(extracted).digest('hex'))
        throw new Error('Pinned source provenance mismatch');
    }
    const userConfig = join(root, 'npm-user.conf'); const globalConfig = join(root, 'npm-global.conf');
    await writeFile(userConfig, ''); await writeFile(globalConfig, '');
    const configArgs = [`--userconfig=${userConfig}`, `--globalconfig=${globalConfig}`];
    await execFileAsync('npm', [...configArgs, 'ci', '--offline', '--ignore-scripts', '--strict-allow-scripts', '--no-audit', '--no-fund'],
      { cwd: root, maxBuffer: 4 * 1024 * 1024 });
    await execFileAsync('npm', [...configArgs, 'run', 'build'], { cwd: root, maxBuffer: 4 * 1024 * 1024 });
    await execFileAsync(process.execPath, ['--input-type=module', '-e',
      "import {build} from 'vite'; await build({configFile:false,build:{outDir:'probe',lib:{entry:'src/client/api.ts',formats:['es'],fileName:()=> 'old-api-probe.mjs'}}});"],
      { cwd: root, maxBuffer: 4 * 1024 * 1024 });
    return { root, clientRoot: join(root, 'dist/client'),
      apiProbeUrl: pathToFileURL(join(root, 'probe/old-api-probe.mjs')).href,
      close: () => rm(root, { recursive: true, force: true }) };
  } catch (error) { await rm(root, { recursive: true, force: true }); throw error; }
}
export async function mountPinnedS3(page: Page, origin: string, clientRoot: string) {
  await page.route('**/*', async route => {
    const url = new URL(route.request().url());
    if (url.origin !== origin) return route.abort();
    if (url.pathname.startsWith('/api/') || ['/healthz','/readyz'].includes(url.pathname))
      return route.continue(); // настоящий upgraded server, API не mocked
    if (url.pathname !== '/' && !url.pathname.startsWith('/assets/')) return route.abort();
    const file = resolve(clientRoot, url.pathname === '/' ? 'index.html' : `.${decodeURIComponent(url.pathname)}`);
    if (!file.startsWith(resolve(clientRoot) + sep)) return route.abort();
    await route.fulfill({ path: file }); // только реально собранный pinned HTML/JS/CSS
  });
}
```

В dedicated test вызвать `test.setTimeout(120000)` для offline install/build; app actions остаются обычными. Helpers удаляют только свой temp root. Продолжительность setup не превращается в skipped test. `scripts/e2e-server.ts` возвращает `databasePath: join(directory,'leaf.sqlite')` в test-only runtime handle; путь не логировать. Для counters открыть **этот** собственный disposable synthetic SQLite read-only, закрыть в finally. Два разных empty config paths предотвращают npm double-loading; personal user/global config не читаются. Только pinned build fixture использует `--ignore-scripts`: старый server/native SQLite не запускается, Vite использует cached platform esbuild package из lockfile, install hooks не делают remote prebuild download. Active package installation остаётся strict по BOOTSTRAP. При отсутствии cached package/binary — FAIL, не online fallback. Build запустить из credential-free execution context, не печатая environment.

`tests/e2e/legacy-client-upgrade.spec.ts` импортирует `syntheticRuntime` из `../../scripts/e2e-server.js`, pinned helpers из `../helpers/pinned-s3.js`, raw counters из `../helpers/optional-api-fixtures.js`, `Database` из better-sqlite3 и test/expect из Playwright. Код test собирает source snapshot и обслуживает старые assets по origin настоящего нового server. До `page.goto` server подготовлен target-aware request; проект существует, поэтому отказ проверяется на настоящем upgraded data contract:

```ts
test('unchanged S3 shows the upgrade refusal without uncertain mutation', async ({ page }) => {
  test.setTimeout(120000);
  const pinned = await buildPinnedS3();
  const runtime = await syntheticRuntime().catch(async error => { await pinned.close(); throw error; });
  try {
    const login = await page.request.post(`${runtime.origin}/api/auth/login`, {
      headers: { Origin: runtime.origin }, data: { password: runtime.password } });
    expect(login.ok()).toBe(true); // cookies только своего synthetic browser context
    const created = await page.request.post(`${runtime.origin}/api/projects`, {
      headers: { Origin: runtime.origin, 'X-Leaf-Contract-Version': '2' }, data: { title: 'Synthetic upgrade' } });
    expect(created.status()).toBe(201);
    const projectId = (await created.json()).id as string;
    const inspect = () => {
      const db = new Database(runtime.databasePath, { readonly: true });
      try { return rawSyntheticCountsAndRevision(db, projectId); } finally { db.close(); }
    };
    const before = inspect();
    await mountPinnedS3(page, runtime.origin, pinned.clientRoot);
    const refused = page.waitForResponse(response => response.url() === `${runtime.origin}/api/projects` && response.status() === 426);
    await page.goto(runtime.origin);
    const response = await refused;
    expect(response.request().headers()['x-leaf-contract-version']).toBeUndefined();
    const message = 'Версия приложения устарела. Обновите страницу для продолжения. Этот запрос не изменил данные.';
    await expect(page.getByText(message, { exact: true })).toBeVisible();
    await expect(page.getByText('INVALID_RESPONSE', { exact: true })).toHaveCount(0);
    await expect(page.getByText('Проект изменён в другой сессии. Загрузите актуальный проект; черновик останется в панели.', { exact: true })).toHaveCount(0);
    const old = await import(pinned.apiProbeUrl); // Vite output старого неизменённого api.ts
    const cookies = await page.context().cookies(runtime.origin);
    const cookie = cookies.map(item => `${item.name}=${item.value}`).join(';');
    const savedFetch = globalThis.fetch;
    globalThis.fetch = (input, init) => {
      const headers = new Headers(init?.headers); headers.set('Cookie', cookie);
      return savedFetch(new URL(String(input), runtime.origin), { ...init, headers });
    };
    try {
      await expect(old.api.projects()).rejects.toMatchObject({ code: 'CONTRACT_VERSION_CONFLICT',
        status: 426, uncertain: false, message });
    } finally { globalThis.fetch = savedFetch; }
    expect(inspect()).toEqual(before); // revision + ops + undo + tasks unchanged
  } finally { try { await runtime.close(); } finally { await pinned.close(); } }
});
```

Helper сравнивает extracted `src/client/api.ts`/`App.tsx` SHA256 с `git show PINNED_S3_SHA:<path>` bytes без печати bytes: это не копия target decoder. Не модифицировать pinned App/api, headers или error branch. Browser test в обеих configured viewport. Run: `npm run build`, затем `npm run test:e2e -- tests/e2e/legacy-client-upgrade.spec.ts` — RED до426 boundary, GREEN после. Отдельные target-aware replay assertions остаются Step2: pinned old App не обещает новый replay или сохранение draft после reload.

- [ ] **Step 8b: Удалить выбранную задачу с открытой панелью и принять fresh snapshot.** Existing `tests/client/App.test.tsx` test `retains a draft if a conflict reload reveals the selected task was deleted` сохранить и адаптировать к V2 fixture/headers; existing local `open`, `fetchMock`, `json`, `tree` helpers этого файла уже существуют. Расширить assertions: source draft не становится фиктивной persisted задачей, save/move/dependency actions disabled, исчезла Gantt row/markers. После «Отбросить изменения» и Escape selection/panel закрыты, `Новая задача` имеет focus. Чистая выбранная задача при обычном confirmed delete не оставляет tombstone; принятый snapshot закрывает panel и requestAnimationFrame переводит focus на quick input либо сохранившийся соседний row. Dirty external deletion сохраняет readable disabled tombstone до discard/close, а не молча теряет draft.

Seed helper определить в `tests/e2e/optional-scheduling.spec.ts`; imports Page/expect из Playwright, randomUUID из node:crypto, CommandV2/ProjectTreeV2 из `../../src/shared/contracts.js`, syntheticRuntime из `../../scripts/e2e-server.js`. Fixture runtime создаётся/удаляется по существующему `tests/e2e/planning-ui.spec.ts` pattern. Все UUID берутся из реального synthetic server:

```ts
async function seedOptionalRuntime(page: Page, runtime: Awaited<ReturnType<typeof syntheticRuntime>>): Promise<ProjectTreeV2> {
  const login = await page.request.post(`${runtime.origin}/api/auth/login`, {
    headers: { Origin: runtime.origin }, data: { password: runtime.password } });
  expect(login.status()).toBe(200);
  const headers = { Origin: runtime.origin, 'X-Leaf-Contract-Version': '2' };
  const created = await page.request.post(`${runtime.origin}/api/projects`, { headers, data: { title: 'Демо-проект' } });
  expect(created.status()).toBe(201);
  const projectId = (await created.json()).id as string;
  const loaded = await page.request.get(`${runtime.origin}/api/projects/${projectId}/tree`, { headers });
  expect(loaded.status()).toBe(200);
  let current = await loaded.json() as ProjectTreeV2;
  async function send(command: CommandV2) {
    const response = await page.request.post(`${runtime.origin}/api/projects/${projectId}/commands`, { headers,
      data: { contractVersion: 2, expectedRevision: current.project.revision, operationId: randomUUID(), command } });
    expect(response.status()).toBe(200); current = await response.json() as ProjectTreeV2;
  }
  await send({ type: 'task.create', title: 'Этап P', parentId: null });
  const parentId = current.tasks.find(task => task.title === 'Этап P')!.id;
  await send({ type: 'task.create', title: 'Работа A', parentId });
  await send({ type: 'task.create', title: 'Работа C', parentId });
  const aId = current.tasks.find(task => task.title === 'Работа A')!.id;
  const cId = current.tasks.find(task => task.title === 'Работа C')!.id;
  await send({ type: 'task.edit', taskId: aId, changes: { inputStart: '2026-10-05', inputFinish: '2026-10-06' } });
  await send({ type: 'task.edit', taskId: cId, changes: { durationDays: 3 } });
  return current;
}
```

Literal E2E deletion case, после получения tree открыть новый target UI (api реально работает, tree не mocked):

```ts
const tree = await seedOptionalRuntime(page, runtime);
await page.goto(runtime.origin);
const selectedId = tree.tasks.find(task => task.title === 'Работа C')!.id;
await page.getByRole('treeitem', { name: /Работа C,/ }).click();
await page.getByLabel('Описание', { exact: true }).fill('Синтетический черновик');
const deleted = await page.request.post(`${runtime.origin}/api/projects/${tree.project.id}/commands`, {
  headers: { Origin: runtime.origin, 'X-Leaf-Contract-Version': '2' },
  data: { contractVersion: 2, expectedRevision: tree.project.revision, operationId: randomUUID(),
    command: { type: 'task.delete', taskId: selectedId } },
});
expect(deleted.status()).toBe(200);
await page.getByRole('button', { name: 'Сохранить', exact: true }).click(); // cached revision конфликтует
await page.getByRole('button', { name: 'Загрузить актуальный проект', exact: true }).click();
await expect(page.getByText(/Выбранная задача удалена/)).toBeVisible();
await expect(page.getByLabel('Описание', { exact: true })).toHaveValue('Синтетический черновик');
await expect(page.getByRole('button', { name: 'Сохранить', exact: true })).toBeDisabled();
await expect(page.locator(`[data-gantt-row="${selectedId}"]`)).toHaveCount(0);
await page.getByRole('button', { name: 'Отбросить изменения', exact: true }).click();
await page.keyboard.press('Escape');
await expect(page.getByRole('complementary', { name: 'Задача', exact: true })).toHaveCount(0);
await expect(page.getByLabel('Новая задача', { exact: true })).toBeFocused();
```

E2E seed создаёт задачу с серверным UUID, поэтому используется selectedId из accepted tree; literal optionalIds только client fixture. Это OS17 на actual accepted newer revision, не визуальная моковая tombstone. После reload/restart удалённая задача остаётся отсутствующей; undo восстанавливает исходный source одной командой.

Существующие `tests/domain.test.ts`, `repository.test.ts`, `api.test.ts`, `scheduling.test.ts`, `scheduling-repository.test.ts`, `scheduling-api.test.ts`, `migration.test.ts`, client/E2E fixtures обновить к целевым contracts. Старые Auto numerical fixtures остаются historical kit evidence и frozen compatibility samples; не отключать существующий suite и не объявлять прежние T=8/10 целевым CPM. Действующие schedule suites теперь проверяют literal N01–N05 и pending boundary; настоящий CPM добавит Task 7.

Run последовательно:

```sh
npm test -- tests/optional-planning.test.ts tests/optional-scheduling.test.ts tests/legacy-compatibility.test.ts tests/optional-migration.test.ts tests/optional-api.test.ts tests/scheduling-repository.test.ts tests/scheduling-api.test.ts tests/client
npm run verify
npm run format:check
npm run check:package
npm run test:e2e -- tests/e2e/optional-scheduling.spec.ts tests/e2e/task-tree.spec.ts tests/e2e/scheduling.spec.ts tests/e2e/planning-ui.spec.ts
npm run test:e2e -- tests/e2e/legacy-client-upgrade.spec.ts
npm run check:kit
```

Expect все реальные suites PASS, no skipped. Synthetic screenshots outside checkout открыть и сверить все три PNG/два viewport; images не добавлять в public manifest. Migration003 application build/container synthetic smoke проверяет exact packaged input, SQLite native DROP support, non-root/read-only, restart/backup; только новые synthetic volume/path, no real backup reading. Test migrations1→2→3 и2→3, rollback и repeated run.

- [ ] **Step 9: Commit и независимый интеграционный review.** `feat: adapt optional scheduling with lossless legacy compatibility`. Acceptance OS01–OS15/OS17, за исключением настоящего OS16 и полной C05; STATUS прямо указывает C16 policy CLOSED и CPM implementation pending. Review all target schema, private archive, explicit preview/digest acknowledgement, headers/replay order, source/display separation, counts/digests, invalid/error/loading/keyboard и package boundary. Два APPROVED на точном SHA; main integrator repeats affected checks/staged/history/public workspace/preflight без отключения guards. Приложение на checkpoint работает на target contract; V1 ещё не готова.

## Task 6: Создать технический implementation annex принятой C16 политики

**Files:** Existing `docs/DECISIONS.md`, `docs/adr/008-explicit-date-cpm.md` и [нормативное приложение](../specs/2026-10-07-optional-scheduling-policy-proposal.md) уже содержат C16; create `docs/superpowers/plans/2026-10-07-explicit-date-cpm.md` с typed contracts, runnable tests и exact file map. До GREEN/review annex Task 7 не запускается; формулы уже выбраны и повторного owner approval не требуют.

**Inputs:** Пять принятых решений spec §9/C16, ADR 008, P01–P11 и N06. Выбран observed-interval анализ; relative longest path и analytic earliest не выбраны. Gate CLOSED относится к policy, а не готовности implementation annex.

- [x] **Step 1: Подготовить policy decision packet.** Принятое нормативное приложение задаёт точную семантику пяти решений и независимые expected cases:

| Решение | Проверяемый вопрос | Независимый пример для выбора |
|---|---|---|
| Admission | Только pair либо duration с отсутствующими краями? | duration3 без дат; start5 октября+duration3; finish9 октября+duration3 |
| Date meaning | Наблюдаемое положение, release/lock или справочная calendar date? | N06 A0–2/B5–6/C0–10, A→B |
| Horizon/gaps | Общий обратный horizon и смысл waiting days? | N06 gap3; отдельные компоненты длиной3/10 |
| Floats/locks/done | ProjectFloat vs constraintFloat; неизменяемость не критичность? | B hard start5, done variant, независимая C10 |
| Unknown/infeasible | Partial critical sets/labels допустимы? | known A→unknown U→dated B + independent C; conflict+unknown |

- [x] **Step 2: Получить и записать actual owner decision.** C16/ADR 008 приняты 2026-10-07; O06/G-CPM CLOSED как выбор математической политики. W01 сохраняется, отсутствующие границы не выводятся. C05/OS16 остаются implementation/acceptance work.

- [ ] **Step 3: Создать implementation annex по принятому ADR 008.** Математический ADR и P01–P11 уже существуют. Technical annex определяет signatures конечного `calculateSchedule`, полный typed DTO/strict schemas, domain analysis types, H/Hknown, critical-edge predicate, exact independent expected arrays/floats/diagnostics и Runnable RED/GREEN commands. Ready: ordinary projectFloat/constraintFloat и global IDs; incomplete: ordinary floats null, global IDs empty, отдельный partialAnalysis по полностью известным weak components; infeasible: no normal/partial floats/IDs. Partial содержит knownHorizonFloat и отдельно подписанные partial critical sets, без подмены global. Frozen pending replies парсятся и сохраняют outcome. Добавить к P01–P11 literal fork/join, deep-summary, conflict+unknown, undo/restart и invariance к смещению технической опоры. Формулы и запрет Auto не пересматривать.

N06 по выбранной C16 политике имеет projectFloat A/B/C=7/4/0, constraintFloat=3/4/0 и critical только C; done variant B меняет только её constraintFloat на0. Это accepted target expectation вместе с P01–P11. Каждое numeric expected рассчитывается независимо от production solver (ручная арифметика/отдельный проверенный oracle fixture), с датами и объяснением технической опоры; display inputs запрещены.

- [ ] **Step 4: Цикл ревью technical annex до двух APPROVED.** Separate plan author и два reviewers на exact SHA проверяют соответствие принятой C16, отсутствие скрытого Auto, type consistency, числовую матрицу, task file map/TDD/commands и owner evidence. На замечаниях исправлять technical annex; противоречащую принятой политику не вводить скрыто. Commit `docs: define approved explicit-date critical path plan` после review. Этот step — конкретная dependency Task 7; прежние approvals базового плана его не закрывают.

**Acceptance:** Policy G-CPM уже CLOSED, решение владельца и accepted formulas существуют. Task 6 GREEN требует отдельного численно исполнимого technical annex с двумя independent APPROVED; он ещё не подготовлен. No deadline/project-start возвращения в active model.

## Task 7: Выполнить approved CPM annex и полную приёмку адаптации

**Files:** Точные изменяемые signatures/formulas/tests определяет accepted annex Task 6; существующие `src/domain/scheduling.ts`, `scheduling-types.ts`, `src/shared/contracts.ts`, `ScheduleStatus.tsx`, Gantt/Dependencies critical styling, numerical target fixtures/tests и E2E входят в единственный активный target path. Lockfile/schema не менять без отдельной причины/ADR.

**Entry:** Actual G-CPM CLOSED и annex APPROVED; Task 5 GREEN с G-MIGRATION CLOSED. Нет выполнения algorithm steps без annex. Это dependency-controlled execution существующего обязательного C05, не разрешение придумывать алгоритм.

- [ ] **Step 1: Исполнитель прочитывает exact annex SHA и выбранные independent expected vectors.** Создать fresh worker worktree, проверить current target files, зафиксировать один writer math/contracts. При новом противоречии policy вернуться к review Task 6, не менять формулы в React.
- [ ] **Step 2: Выполнить TDD tasks accepted annex.** Сначала literal expected RED для всех OS16 cases, затем чистое deterministic server implementation и GREEN. В этом документе нет фиктивного CPM skeleton с return empty arrays: в Task 5 это только честный pending-policy; после Task 7 analysisStatus переходит в approved analysis states и actual critical sets.
- [ ] **Step 3: Добавить сквозной OS16 acceptance.** Date change глубокой work, смена критической ветви, равенство ветвей, disconnected component, gap/tight edges, done/lock, unknown/infeasible, один undo и actual restart. Expected IDs/numbers берутся из independent accepted vectors, не из label summary max finish и не старого Auto solver. Ни display fallback/anchor, ни summary вершины не входят в CPM.
- [ ] **Step 4: Полная regression и public package проверка.** Run `npm run verify`, `npm run test:unit`, `npm run test:integration`, `npm run format:check`, `npm run check:package`, `npm run test:e2e`, `npm run check:kit`, `npm run test:kit`, staged/history scans и root preflight. Повторные suites здесь justified новой CPM math/contracts, а не ради повторного GREEN. Проверить no skips и самостоятельные numerical target fixtures; kit не заменяет их.
- [ ] **Step 5: Independent final review и factual STATUS.** Два reviewers на едином SHA оценивают всю адаптацию и accepted annex; цикл fixes/re-review до двух APPROVED. Commit subject по фактическому annex component, например `feat: calculate approved critical paths for explicit schedules`. STATUS различает завершённые OS01–OS17, failed/not-run, remaining S4/S5/S6 и отсутствие publication permission. Full adaptation принимается только после OS16; первый релиз ещё требует S4–S6.

## Traceability и обязательные тестовые границы

| Requirement | Task / независимый пример | Test layers / завершённость |
|---|---|---|
| OS01 / C13 | 1+5, eight combinations/N01 | source schema/domain, SQLite/API, client/E2E |
| OS02 / C11 | 1+2+5, duration-only/project-empty | no Auto/no project origin, pending result, source unchanged |
| OS03 / W02 | 1+2+5, Friday–Monday pair and duration mismatch | invalid write rollback; saved/calendar-invalid diagnostic |
| OS04 | 3+4+5, done absolute/relative/incomplete | context resolution gate, atomic return/edit, no hidden shift |
| OS05 / C12 | 2+5, N02/N03/40 levels | summary both null across tree/panel/graph/Gantt; input all leaves |
| OS06 | 2+5, summary span6 not7/preserveWork | FS conflict dates retained; duration-only predicate; source/edges/undo |
| OS07 / C14/D13/W04 | 2+5, N02–N04/weekend/overflow/root и source marker tests | start-only marker/no bar; finish-only/no anchor; finish2 + conditional9 раздельно, accessibility |
| OS08 | 2+5, full sibling anchor and nested knownStartMin | order/collapse/filter/scale no source changes; anchor update display only |
| OS09 | 2+5 | conditional gesture lock/no fake timeline arrow; graph relationship remains |
| OS10 / C15 | 1+3+5 | no legacy fields in target schemas/UI/bundle/Network; finish nullable |
| OS11 / C17/W06 | 3+4+5, M01–M10/N05/current/deleted/history | exact raw archive+digests/counts; approved pair materialization; no deadline/notBefore reassignment |
| OS12 | 3+5 Steps2/8a | six project routes426 before lookup; pinned unchanged S3 source/build/browser + original ApiError probe; transport-only frozen legacy replay после restart; stale response/no duplicate |
| OS13 | 3+4+5 | pre-migration undo, stale409, repeated migration, DDL+archive rollback, downgrade/invalid JSON, missing/stale preview acknowledgement и no-write startup |
| OS14 | 2+5, N04 | known FS ends without pair; unknown !=0, non-working diagnostic, cycle rollback |
| OS15 | 2+5 | intermediate pending-policy объясняет отсутствующую реализацию; C16 принят, C05 unmet |
| OS16 / C05/C16 | 6+7, P01–P11/N06 | Owner policy CLOSED; technical annex/review и actual math/IDs/tight/partial tests pending |
| OS17 | 5 Steps6/8b +7 | dirty/loading/error/offline/focus/Tab/Esc/keyboard; selected task delete→fresh snapshot→disabled readable draft→discard/close/focus; exact retry/undo, both viewports |

## Историческая авторская проверка и review базовой ревизии

- [x] Coverage: каждый spec section/C11–C15/OS01–OS17 сопоставлен строкам выше; W01–W06 не стали C, G-MIGRATION стоит до registry, G-CPM не заменён набором пустых critical IDs.
- [x] Placeholder scan: в implementation steps нет скрытых незаполненных решений. Блокированные policy задачи имеют перечисленные входы/проверяемые выходы и отдельный review gate; формулы неизвестного CPM не выдуманы.
- [x] Types: source/duration cap различает new input и legacy response; SnapshotContext в current/operation/undo; new canonical version2 vs transport-only legacy replay; один OptionalResult shape и eventual active calculateSchedule.
- [x] Commands: новые suites перечислены для explicit package scripts при реализации; `npm test -- <paths>` соответствует Vitest script; Playwright только после build; Node exact pin не заменён установленной старой версией.
- [x] Scope: первый кандидат затронул plan, IMPLEMENTATION_PLAN/STATUS и factual spec review footer; исправления раунда 1 меняют только plan/STATUS. Ни application source, ни schema/fixtures не изменены.
- [x] Document-only `npm run check:kit`, `git diff --check`, `git diff --cached --check`, staged guard/Gitleaks и history scans прошли для второго кандидата. Обычные hooks включены. Root integrator отдельно проверяет public workspace/preflight; linked-worktree pointer refusal не обходить.
- [x] Два независимых plan reviewer проверили один candidate SHA `c4c8193ed82c464998f16bd163def93c22a22fe2`: соответствие спецификации — APPROVED; исполнимость/standards — APPROVED. Пять blockers первого раунда закрыты; review metadata зафиксировано после получения обоих вердиктов.

План не начинает реализацию автоматически. При поручении кода координатор выполняет preparation задачи отдельными worker agents, продолжая independent review цикл. C16/C17 уже приняты; technical/test dependencies Tasks 4–7 и отдельное разрешение production operation сохраняются.

Раунд 1 независимого plan review на `1a151c29c81d78096b634eb7e2458443f5a61c51`: соответствие спецификации — CHANGES_REQUIRED; исполнимость/standards — CHANGES_REQUIRED. Закрыты пять blockers: source marker projection/render/tests, настоящий pinned unchanged S3 upgrade check, selected task deletion recovery, durable frozen replay после restart и полные schemas/helper definitions. Раунд 2 на `c4c8193ed82c464998f16bd163def93c22a22fe2`: соответствие спецификации — APPROVED; исполнимость/standards — APPROVED. На той ревизии базовая spec не менялась, policy gates были открыты, implementation не начиналась. Изменения после принятия C16/C17 закрывают выбор политик и синхронизируют technical tasks; новых independent verdicts на эти изменения пока нет.
