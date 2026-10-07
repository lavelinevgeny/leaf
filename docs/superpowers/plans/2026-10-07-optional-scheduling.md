# Optional Scheduling Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use `subagent-driven-development` or `executing-plans` to implement this plan task-by-task. The owner requires separate agents for authoring, implementation and independent review. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Адаптировать leaf к C11–C15: независимые необязательные сроки, полный summary, условные полосы и совместимая отмена/replay без отдельного дедлайна; настоящий CPM завершить только после решения O06.

**Architecture:** Один пакет, существующий Fastify/SQLite transaction boundary и React/SVG. Сначала подготовить чистые target contracts, проекции и compatibility adapter без подключения к работающему приложению; затем одним проверенным checkpoint заменить прежние helpers/API/UI. Сервер рассчитывает реальные интервалы, FS, summary и отдельный display; CPM policy и активное представление legacy Auto/done ограничены явными gates.

**Tech Stack:** TypeScript strict, React 19.3.0/Vite 8.3.3, Fastify 5.12.5, better-sqlite3 13.0.3, Zod 4.6.5, Vitest 5.0.3, Playwright 1.63.0; существующий exact lockfile.

**Spec:** [Optional scheduling design](../specs/2026-10-07-optional-scheduling-design.md), нормативная ревизия `69b05dca5cf0c2c248eb9843b38f4f5b6f91c857`. На этой ревизии оба независимых spec reviewer дали APPROVED во втором раунде. [DECISIONS](../../DECISIONS.md), [ACCEPTANCE](../../ACCEPTANCE.md), [PRIVACY](../../PRIVACY.md), [AGENT_WORKFLOW](../../AGENT_WORKFLOW.md) читаются вместе со спецификацией.

## Global Constraints

- C11–C15 подтверждены владельцем. D13 и другие D — рабочие defaults. Правила W01–W06 ниже — технические предложения этой спецификации, допускающие отдельный пересмотр; они не добавляют записи C и не закрывают O06.
- Конечная задача содержит `inputStart: CalendarDate | null`, `inputFinish: CalendarDate | null`, `durationDays: positive integer | null`.
- Пропуск поля в patch сохраняет прежнее значение; явный `null` очищает только его.
- `CalendarDate` — валидная строка `YYYY-MM-DD` в существующем диапазоне 0001–9999. Окончание включительно.
- Календарь проекта сохраняется: `all-days` или `weekdays` (пн–пт), default D04; timezone нужен для «Сегодня», не для арифметики дат.
- Целевой публичный DTO не содержит `deadline`, `notBefore`, `planMode`, `project.startDate` и relative completed indices.
- До G-CPM `analysisStatus = pending-policy`, floats отсутствуют, criticalTaskIds/criticalDependencyIds пусты; UI объясняет отсутствие расчёта.
- Авторитетные записи, проверка графа, пересчёт, result и undo — одна SQLite-транзакция с `expectedRevision`/`operationId`.
- При отсутствии/неподдерживаемой версии сервер возвращает HTTP 426 и прежний strict error DTO `{code,message}` до project mutation, target DTO и cached response.
- Для точного повтора legacy envelope target-aware клиент передаёт transport headers `X-Leaf-Contract-Version: 2` и `X-Leaf-Legacy-Replay: 1`, сохраняя оригинальный body и archival canonical payload.
- Не очищать operations/undo_snapshots при этой адаптации. Deadline не переносится в finish; notBefore не переносится в start; project.startDate не назначает даты задач.
- Граф остаётся DAG с leaf-only FS, lag=0, внутри одного проекта; parentId не создаёт precedence.
- Один writer одновременно меняет shared contracts, schema, migration и scheduling semantics. Каждый concurrent agent использует свой worktree.
- Только disposable synthetic fixtures. Не читать production DB, backups, `.env`, реальные экспорты, credential stores или истории агента. Не логировать archive/raw bodies/cookies.
- Не менять стек, lockfile, scanner policy, Git identity или hooks. Без ORM, платного Gantt, graph editor, облаков, CDN, telemetry, AI API, очередей и ресурсов.
- Только три PNG из [design/README](../../../design/README.md); исключённый коллаж не использовать. Русский UI, English identifiers/commit subjects.
- Push, deploy, release и production migration требуют отдельного поручения владельца. Положительное ревью плана этого разрешения не даёт.

## Готовность и зависимости

Этот документ — кандидат исполнимого плана с ограниченными policy-зависимостями. Приложение пока соответствует S2–S3; ни одна задача ниже не выполнена этим документом. Одобрение плана означает качество подготовки, а не закрытие G-CPM/G-MIGRATION.

| Task | Вход | Проверяемый выход | Возможность исполнения |
|---|---|---|---|
| 1 | Approved spec; implementation requested отдельно | Неактивные target schemas и source validator | Независимая подготовка в рамках W01/W02/W05 |
| 2 | Task 1 contracts | Pure real/FS/summary/display, pending-policy | Независимая подготовка W01–W04; без CPM |
| 3 | Task 1/2, frozen S2 schemas | Archive integrity и mapper на synthetic данных; registry не подключён | Независимая preparation; неоднозначные legacy cases fail closed |
| 4 | Synthetic category matrix Task 3 | Фактическое решение G-MIGRATION, ADR и resolution rules | Вход владельца отсутствует; gate открыт |
| 5 | Task 1–3 GREEN и закрытый G-MIGRATION | Работающее target приложение, миграция/history/retry/undo/UI, pending-policy | Заблокировано до Task 4; один writer, единый интеграционный checkpoint |
| 6 | Пять решений из spec §9 и owner decision | Математический ADR, независимые expected vectors и approved CPM annex | G-CPM/O06 открыт; новое математическое поведение не разрешено |
| 7 | Approved annex Task 6; target приложение Task 5 | Реальный CPM и полная сквозная приёмка C11–C15 | Заблокировано до Task 6; не заменять annex старым Auto |

Task 1–3 могут закончиться reviewable commit при работающем прежнем приложении: они не меняют активный `Task`, не регистрируют migration 003, не подключают новый route и не переключают `Repository.calculate`. Это подготовка замены, не второй продуктовый scheduler/API. Task 5 переносит эти реализации в существующие `contracts.ts`, `planning.ts`, `scheduling-types.ts`, `scheduling.ts` и удаляет промежуточные optional modules после исправления imports. Compatibility layer остаётся только для архивных форм. Нет режима выбора между двумя действующими планировщиками.

После Task 5 допустим только промежуточный synthetic developer build с честным pending-policy. C05, OS16, полная адаптация и V1 ещё не приняты. G-MIGRATION находится перед добавлением SQL в `openDatabase`, поскольку registry автоматически применяется при запуске, а не только перед UI/deploy. G-CPM может быть закрыт до Task 4 или после Task 5: gates независимы.

## Карта файлов и целевых интерфейсов

| Ответственность | Preparation files | Итоговое место / существующие потребители |
|---|---|---|
| Strict target DTO/commands | `src/shared/optional-contracts.ts` | `src/shared/contracts.ts`; API/client/types |
| Source patch/validation/done | `src/domain/optional-planning.ts` | `src/domain/planning.ts`; Repository |
| Real/FS/summary/display | `src/domain/optional-scheduling-types.ts`, `optional-scheduling.ts` | `src/domain/scheduling-types.ts`, `scheduling.ts`; один `calculateSchedule` |
| Frozen legacy parsing/projection | `src/server/legacy-contracts.ts`, `legacy-compatibility.ts` | Только migration/replay; не экспортируется в client |
| Exact canonical comparison | `src/shared/canonical.ts` | Repository и compatibility; идентичная прежней `canonical` функция |
| Archive+projection migration | `src/server/optional-migration.ts`, `migrations/003-optional-scheduling.sql` | `database.ts` registry после G-MIGRATION |
| Atomic writes/undo/replay | Existing `src/server/repository.ts`, `app.ts` | Замена старых branches с сохранением revision/idempotency/auth/origin |
| UI/real labels/gestures | Existing `PlanFields.tsx`, `TaskPanel.tsx`, `ProjectPlan.tsx`, `planning-view.ts`, `api.ts`, `App.tsx`, `ScheduleStatus.tsx`, `strings.ts` | Три nullable поля, настройки calendar/timezone, 426 message, pending-policy |
| SVG и graph | Existing `Gantt.tsx`, `gantt-view.ts`, `TaskTimeline.tsx`, `TaskTree.tsx`, `Dependencies.tsx`, `styles/planning.css` | Готовый server display отдельно от real labels/arrow endpoints |
| Build boundary | `.dockerignore`, `scripts/package-check.mjs`, `src/server/database.ts` | Exact migration input/registry; без расширения allowlist на каталоги |
| Tests | New `tests/optional-planning.test.ts`, `optional-scheduling.test.ts`, `legacy-compatibility.test.ts`, `optional-migration.test.ts`, `optional-api.test.ts`; existing client/E2E/storage suites | Внести новые suites в explicit `test:unit`/`test:integration`; полный `npm test` сохраняется |
| Decisions/handoff | New `docs/adr/006-optional-scheduling-contract.md`, `007-legacy-scheduling-migration.md`, `008-explicit-date-cpm.md`; optional CPM annex | W proposals, gate evidence, revised status; никаких transcripts |

Номера ADR перед созданием проверить `rg --files docs/adr`: если уже заняты другим завершённым изменением, выбрать следующие свободные номера и обновить ссылки этого плана; не перезаписывать чужой ADR.

## Протокол исполнения и review

- [ ] Координатор перед Task 1 проверяет `git status --short --branch`, читает START_HERE/AGENTS/PRIVACY, проверяет approved spec/plan SHA и выделяет отдельный worktree writer. Автор настоящего плана ничего из implementation не запускает.
- [ ] Использовать Node 24.21.0 / npm 11.19.0 из `.nvmrc`/packageManager. Проверить `node --version`, `npm --version`, `npm run doctor`; mismatch исправлять выбором установленной требуемой версии, не снижением pins. `npm ci --strict-allow-scripts --no-audit --no-fund` — только по проверенному lockfile, без новых packages.
- [ ] Для каждой задачи: добавить независимые failing tests, увидеть конкретный RED, минимально реализовать, получить GREEN и affected checks. Не использовать `.skip`, пустые tests, `--if-present` или сравнение solver с собой.
- [ ] Один worker создаёт scoped локальный commit. Независимые reviewer agents оценивают один точный SHA: Standards/безопасность/исполняемость и Spec/числа/поведение. На CHANGES_REQUIRED worker исправляет тот же scope, reruns affected checks и создаёт новый SHA. Оба reviewer повторяют проверку нового SHA; переход допустим только при двух APPROVED и отсутствии открытых blockers.
- [ ] Gate решение проверяется по документальному evidence, не по времени ожидания и не по review approval. Task 4/6 не исполнять по догадке. Не спрашивать о permission, когда пользователь уже поручил конкретный локальный шаг.
- [ ] Перед commit: `git diff --check`, scoped diff review, `git add --` только task files, `npm run security:staged`, `git diff --cached --check`, затем обычный `git commit -m '...'` с действующими hooks. Не менять identity и не обходить hook отказ.
- [ ] После каждого accepted commit: factual STATUS — touched areas, passed/failed/not run, pending gates, следующий task. Общая интеграция и public workspace/preflight выполняются отдельным integrator в обычном checkout; linked `.git` pointer guard нельзя ослаблять.

## Task 1: Неактивный nullable контракт и patch validator

**Files:** Create `src/shared/optional-contracts.ts`, `src/domain/optional-planning.ts`, `tests/optional-planning.test.ts`, `docs/adr/006-optional-scheduling-contract.md`; modify `package.json` только список `test:unit`. Active contracts/code и lockfile не менять.

**Interfaces:**

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

Здесь `CalendarType` берётся из существующего domain type; `DomainError` и calendar functions переиспользуются. `applySourcePatch` сохраняет omission и проверяет новый source только при изменении поля; обычный text/status save legacy/calendar-invalid source не должен случайно отклоняться. `validateSourceInput` используется для нового срока; `realInterval` используется чтением и возвращает null для отсутствующей/невалидной пары. Невалидный сохранённый source анализирует Task 2 через diagnostics.

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

Target Task DTO duration schema отдельно допускает положительное сохранённое legacy число больше input cap: input cap нельзя применить к migration/response и потерять полный старый Fixed span. ProjectV2 исключает startDate; TaskV2 явно перечисляет id/projectId/parentId/title/description/sortOrder/status/timestamps и SourceFields, без spread legacy row. Dependency shape сохраняется. CommandsV2 содержит `task.edit`, `task.create/move/delete`, `dependency.create/delete`, `undo`, `project.schedule {changes:{calendarType?,timezone?}}`; старый `task.update` допускает только text/status как explicit compatibility alias нового body, dates идут через task.edit; `task.plan` отсутствует. RenameV2 добавляет contractVersion=2. Весь union strict. Создание заполняет три null сервером.

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

**Interfaces:** Consume SourceFields и CalendarType. Leaf-only graph validation копирует текущий проверенный алгоритм в неактивную функцию с узким типом; существующий validator пока требует legacy SchedulingTask, поэтому OptionalTask не передавать ему через unsafe cast. При Task 5 эта функция заменяет существующие `validateDependency/validateDependencies`, не оставляя дубль. Produces:

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
export function replayLegacyOperation(db: Database.Database, projectId: string, sessionId: string, body: unknown, resolutions: ResolutionIndex): ProjectTreeV2;
export function prepareOptionalMigration(db: Database.Database, migrationSql: string, resolutions: ResolutionIndex): void;
export interface LegacyContextRecord { context: SnapshotContext; snapshot: z.infer<typeof LegacySnapshotSchema> }
export function loadLegacyContexts(db: Database.Database): LegacyContextRecord[];
export function migrationCategoryCounts(db: Database.Database): { auto: number; completedAbsolute: number; completedRelative: number; inconsistent: number };
```

`SnapshotV2={project:ProjectV2,tasks:TaskV2[],dependencies:Dependency[]}`. `ProjectTreeV2=SnapshotV2 & {contractVersion:2,canUndo:boolean,schedule:OptionalResult}`; schedule response тоже version2/projectId/revision. Mapper копирует только target allowlist; done без locks и обычный source сохраняются. Каждый legacy Auto и каждый done с completed dates/indices требует context-specific resolution с digest соответствующего original task. Один taskId в current/history может иметь разные locks: нельзя использовать одну current-row resolution для всех снимков. При отсутствующей resolution бросать safe `MIGRATION_POLICY_REQUIRED`; unknown версии/невалидный JSON — `INVALID_LEGACY_SNAPSHOT`. Синтетические resolutions в tests не являются решением G-MIGRATION.

- [ ] **Step 1: Создать disposable S2 fixture через reviewed SQL.** Не использовать `openDatabase` для автозапуска 003. В `tests/optional-migration.test.ts` собрать временную БД с `better-sqlite3`, `001`+`002` и migrations 1/2, account/session placeholder, проект revision10, parent/order/dependencies, legacy tasks A/B, удалённую D только в undo, Auto и done-relative examples. `try/finally` закрывает db и удаляет только собственный tmpdir. Raw содержимое не выводится.

```ts
const originalResponse = JSON.stringify({ ...legacyTreeFixture, project: { ...legacyTreeFixture.project, revision: 9 } });
const originalPayload = canonical({ expectedRevision: 8, operationId, command: {
  type: 'task.plan', taskId: aId, plan: { mode: 'unscheduled', inputFinish: '2026-10-06', deadline: '2026-10-20' },
} });
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

До drop архивируются projects/tasks scheduling rows и exact исходные JSON-тексты payload/response/undo; для row JSON lossless string/numeric/null values, отдельно digest raw JSON history. Project/task archive kind не содержит account/session material. В одной outer `db.transaction(...).immediate()` выполняются archive inserts, SQL drops, source updates, adapted operations.response/undo snapshots, migration version3. Legacy operations.payload остаётся original canonical; `contractVersion=1` отличает replay-only record от новых2. Adapter outcome рассчитывается из оригинального archived response snapshot, не из latest tree. В migration registry Task 5 outer transaction принадлежит `openDatabase`; helper не commit independently. `loadLegacyContexts` читает explicit current project/tasks/dependencies, original operations.response и undo.beforeSnapshot; одна запись на active project и каждый historical snapshot, ключ operationId/undo sequence хранится раздельно.

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
return adaptLegacyTree(readOriginalResponse(db, projectId, identity.operationId), { kind: 'operation', key: identity.operationId }, resolutions);
```

Для command/rename replay extracts UUID operationId без normalization/stripping original body. Дополнительное изменённое поле не игнорируется: canonical полного body не совпадёт и даст409. `findOperation` и `readOriginalResponse` — private prepared SELECT по explicit columns `projectId,sessionId,payload,contractVersion` и `originalText` соответственно. No row — завершить branch; нет fallthrough к `applyCommand` или `change()`. Проверка transport version будет в Task 5 **до** вызова helper.

- [ ] **Step 5: Run GREEN и commit.** `npm test -- tests/legacy-compatibility.test.ts tests/optional-migration.test.ts tests/migration.test.ts tests/scheduling-repository.test.ts`; `npm run test:integration`; typecheck/lint/format/check:kit. Expect PASS и исходный `openDatabase` по-прежнему применяет только1/2. Commit `feat: prepare lossless scheduling migration and replay adapter`; independent review. Task 3 не разрешает запуск 003 на пользовательской БД.

## Task 4: Закрыть G-MIGRATION по явным решениям

**Files:** Create `docs/adr/007-legacy-scheduling-migration.md`; modify `docs/DECISIONS.md`, spec gate/status только по фактическому owner decision; update `tests/optional-migration.test.ts` synthetic policy matrix. До решения implementation registry/API/UI остаётся прежним.

**Inputs:** Task 3 aggregate counts всех active/history contexts и synthetic examples; exact source/digest archive contract; W06 source-preserving proposal. Owner approval в этой сессии отсутствует.

- [ ] **Step 1: Подготовить конкретную decision matrix без доступа к real runtime.**

| Legacy category | Synthetic input | Разрешённый консервативный outcome для обсуждения | Нужное решение |
|---|---|---|---|
| Auto | source dates null, duration3; old cached computed5–7 октября | source dates null/duration3; old result archive-only | Согласовать потерю активной видимости прежнего Auto interval либо отдельную confirmed conversion |
| Absolute done lock | input pair5–6 октября, completed pair9–12 октября | archive сохраняет обе пары | Какая pair остаётся активной и почему; нельзя выбрать скрыто |
| Relative done lock | input dates null, completed indices0/2, project.startDate null | archive сохраняет indices; нельзя придумать CalendarDate | Явное incomplete active representation либо подтверждённая отдельная calendar anchor/conversion |
| Deleted historical task | done/Auto только в undo/operation response | archive/context mapping сохраняет deleted ID/source | Та же policy применяется к соответствующему historical context, а не current taskId |
| Invalid/calendar mismatch | saved Saturday pair либо duration mismatch | source unchanged, diagnostic, invalid real pair null | Подтвердить отсутствие normalization/deletion |

- [ ] **Step 2: Получить owner decision по категориям.** Зафиксировать actual decision ID/дату/почему в DECISIONS и ADR; не записывать вопрос/переписку или personal paths. Если решения нет, отметить G-MIGRATION OPEN и завершить этот task без запуска зависимого Task 5. Сам spec/plan APPROVED не решение policy.

- [ ] **Step 3: Сделать утверждённую conversion rule исполнимой.** ADR определяет deterministic `resolveLegacySources(contexts: readonly LegacyContextRecord[]): ResolutionIndex` либо эту же функцию над explicit confirmed conversion manifest с exact context/digest/source. Реализация rule появляется только после решения; Task 3 уже определяет LegacyContextRecord/ResolutionIndex и loader. Для relative context без approved anchor rule должен refuse, а не брать Today/project start случайно. Синтетические expected выходы каждого выбранного category записать literal в tests; archive original остаётся immutable. Пока категории не разрешены, helper Task 3 выдаёт MIGRATION_POLICY_REQUIRED и fail closed.

- [ ] **Step 4: Независимое review gate evidence и synthetic GREEN.** `npm test -- tests/legacy-compatibility.test.ts tests/optional-migration.test.ts`; `npm run check:kit`; `git diff --check`. Два reviewers проверяют owner evidence, category completeness и temporal context mapping. Commit `docs: define approved legacy scheduling migration policy` допустим только при фактическом решении. Если owner отказал source-preserving W06/выбрал другой policy, revise spec+affected tasks и повторить spec/plan review до integration.

**Acceptance:** G-MIGRATION закрыт записью решения; active/deleted/history Auto и обе категории done locks имеют exact expected representation и rollback tests. Production execution всё ещё требует отдельного поручения; закрытый policy gate не permission deploy.

## Task 5: Единый атомарный переход API, storage и UI

**Files:** Modify `src/shared/contracts.ts`, `src/shared/work-preservation.ts`, `src/domain/planning.ts`, `scheduling-types.ts`, `scheduling.ts`, `src/server/database.ts`, `repository.ts`, `app.ts`, `.dockerignore`, `scripts/package-check.mjs`, all client files из карты, existing application fixtures/tests; create `tests/optional-api.test.ts`, `tests/client/optional-api.test.ts`, `tests/e2e/optional-scheduling.spec.ts`; update package test lists и README/BOOTSTRAP/STATUS. Preparation optional modules удалить после переноса их реализаций/imports. Frozen legacy contracts/compatibility/archive остаются server-only.

**Entry:** Task 1–3 approved exact SHAs, Task 4 CLOSED с policy ADR. Один writer держит все общие контракты. Этот task имеет один интеграционный commit после всех steps и полного GREEN: backend target без совместимого client не считается завершённым deliverable.

**Interfaces:** Active `Task`/Project/Command становятся V2 aliases; `calculateSchedule(input: OptionalInput): OptionalResult` заменяет прежнюю Auto функцию. `Repository.applyCommand(projectId, envelope: CommandEnvelopeV2, sessionId)` получает strict new versioned body. Separate `Repository.replayLegacy(projectId, body: unknown, sessionId): ProjectTreeV2` вызывает lookup-only adapter; new replay не проходит target command parse. `Repository.renameProject` принимает RenameV2; `getTree/getSchedule/list/create` выдают target schemas. `project.schedule` сохраняет только calendar/timezone. Client `api.replayLegacy(id, originalBody, kind:'command'|'rename')` передаёт unchanged body с transport headers, без автоматики придумывания missing envelope.

- [ ] **Step 1: Добавить HTTP/version boundary RED для всех routes.**

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

Local helpers строят body по literal existing S3 commands/rename/create; не используют target schema для old client fixture. Spy Repository getTree/listProjects/create/rename/apply/replay показывает ноль вызовов при426. Unsupported header=1/3 тоже426. No session401 и wrong origin403 сохраняют приоритет перед version. Auth/session/login/logout не требуют contract header. Старый unchanged `request` behavior проверяется fixture fetch decoder `{code,message}` → ApiError426/uncertain=false; App display содержит upgrade message, нет generic409/INVALID_RESPONSE.

- [ ] **Step 2: Добавить atomic source/done/graph/replay/undo RED tests.** Repository+HTTP cases: N01 mismatch вместе с title/status — rollback всех tasks/project/edges/operations/undo; omitted/null patch; pair/null duration; new calendar-invalid input reject, calendar settings change сохраняет source с diagnostic; done source edit rejected, task.edit statusdoing+source succeeds одной revision и undo. Incomplete done allowed без lock materialization. duration-only preserveWork требует подтверждение, work-child получает source и оба endpoints, parent триnull; delete last child оставляет parent триnull; undo восстанавливает целиком. Unknown/foreign/cycle/self/duplicate/summary edges rejected before commit.

OS12: actual HTTP target-aware replay headers+original legacy body возвращают revision9 после latest10; unknown body no writes; reused ID/new versioned payload409; target exact retry исходный response после later mutations; wrong session/project rejected. OS13: premigration undo с deleted task, stale undo after another session409, injected response-schema/save failure откатывает все active/history fields. Tests используют новую disposable SQLite, никакой real DB. Run targeted API/storage tests — FAIL на отсутствие target headers/mutation/mapper.

- [ ] **Step 3: Перенести целевые модули и подключить migration после gate.** Тела Task 1/2 становятся существующими domain/contracts; old helpers `applyTaskPlan`, `completedInterval`, `fixedDuration`, plan modes и старый `ScheduleResult` заменяются новыми exports. `validateDependency/validateDependencies` принимает только необходимые id/parent fields и edges, не требует mode. Frozen schemas не импортируют mutable target schemas. Удалить optional modules и обновить все imports, без оставления второго active solver.

`database.ts` migration registry меняется на records `{version,file,prepare?}`; 003 prepare выполняется внутри существующей immediate migration transaction до version insert. Gate Task 4 подтверждён до изменения registry. `.dockerignore` и expected allowlist `scripts/package-check.mjs` добавляют только `!migrations/003-optional-scheduling.sql`. Synthetic package check, unknown schema/downgrade и failed version insertion tests обязательно проходят.

```ts
const migrations: { file: string; prepare?: (db: Database.Database, sql: string) => void }[] = [
  { file: '001-initial.sql' }, { file: '002-scheduling.sql' },
  { file: '003-optional-scheduling.sql', prepare: (db, sql) =>
      prepareOptionalMigration(db, sql, resolveLegacySources(loadLegacyContexts(db))) },
];
// В существующем transaction callback, а не второй commit:
if (entry.prepare) entry.prepare(db, migrationSql);
else db.exec(migrationSql);
db.prepare('INSERT INTO migrations(version) VALUES (?)').run(index + 1);
```

`resolveLegacySources` — конкретный reviewed export accepted Task 4 ADR, не env/global flag. До Task 4 этот dependency отсутствует и этот step запрещён. Helper получает reviewed SQL exact input; не выполнять arbitrary path/script из manifest. На production agent это не запускает; runtime migration закрывается fail-closed при неполном resolution.

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

`optionalTreeFixture` в client tests задаёт literal UUID Task/ProjectV2 и server result N02; не рассчитывает expected display production solver. Дополнительно pointer drag/resize conditional/done/summary не выдаёт command; Enter открывает task; finish-only note остаётся отдельно доступным 2 октября при display 9 октября. Real arrow отсутствует при unknown edge, но Dependencies сохраняет graph edge. Sparse/deep/filtered rows не меняют input display.

- [ ] **Step 7: Реализовать UI replacement и маленькие helper contracts.**

```ts
export function sourceOf(task: Task): SourceFields {
  return { inputStart: task.inputStart, inputFinish: task.inputFinish, durationDays: task.durationDays };
}
export function realLabel(task: Task, schedule: OptionalResult): string;
export function ganttInterval(task: Task, schedule: OptionalResult):
  { start: string; finish: string; kind: 'work' | 'summary' | 'conditional'; clipped: boolean } | null;
export function gesturePatch(task: Task, calendar: CalendarType, kind: 'move' | 'resize', target: string):
  { patch: SourcePatch; requiresDurationChoice: boolean };
```

Эти helpers заменяют `planOf`, `planForGesture`, `intervalOf`; `computedDateLabel`/`compactDateLabel` используют **только** real/source dates. `ganttInterval` consume server display; не вычисляет anchor в React. `realLabel` full valid pair из schedule, single input markers из source, summary missing → empty. Dependencies/tooltip не получают условный диапазон как реальный. TaskTimeline initial/reveal window может выбрать displayStart только для просмотра SVG, не source label или «начала проекта».

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

Существующие `tests/domain.test.ts`, `repository.test.ts`, `api.test.ts`, `scheduling.test.ts`, `scheduling-repository.test.ts`, `scheduling-api.test.ts`, `migration.test.ts`, client/E2E fixtures обновить к целевым contracts. Старые Auto numerical fixtures остаются historical kit evidence и frozen compatibility samples; не отключать существующий suite и не объявлять прежние T=8/10 целевым CPM. Действующие schedule suites теперь проверяют literal N01–N05 и pending boundary; настоящий CPM добавит Task 7.

Run последовательно:

```sh
npm test -- tests/optional-planning.test.ts tests/optional-scheduling.test.ts tests/legacy-compatibility.test.ts tests/optional-migration.test.ts tests/optional-api.test.ts tests/scheduling-repository.test.ts tests/scheduling-api.test.ts tests/client
npm run verify
npm run format:check
npm run check:package
npm run test:e2e -- tests/e2e/optional-scheduling.spec.ts tests/e2e/task-tree.spec.ts tests/e2e/scheduling.spec.ts tests/e2e/planning-ui.spec.ts
npm run check:kit
```

Expect все реальные suites PASS, no skipped. Synthetic screenshots outside checkout открыть и сверить все три PNG/два viewport; images не добавлять в public manifest. Migration003 application build/container synthetic smoke проверяет exact packaged input, SQLite native DROP support, non-root/read-only, restart/backup; только новые synthetic volume/path, no real backup reading. Test migrations1→2→3 и2→3, rollback и repeated run.

- [ ] **Step 9: Commit и независимый интеграционный review.** `feat: adapt optional scheduling with lossless legacy compatibility`. Acceptance OS01–OS15/OS17, за исключением настоящего OS16 и полной C05; STATUS прямо pending-policy/G-CPM OPEN. Review all target schema, private archive, headers/replay order, source/display separation, counts/digests, invalid/error/loading/keyboard и package boundary. Два APPROVED на точном SHA; main integrator repeats affected checks/staged/history/public workspace/preflight без отключения guards. Приложение на checkpoint работает на target contract; V1 ещё не готова.

## Task 6: Закрыть G-CPM/O06 и создать численно исполнимый annex

**Files:** `docs/DECISIONS.md`, `docs/adr/008-explicit-date-cpm.md`, new `docs/superpowers/plans/2026-10-07-explicit-date-cpm.md`; при фактическом решении согласовать spec W01/OS examples. До решения Task 7 не имеет разрешения на выбор формул и не запускается.

**Inputs:** Пять решений spec §9; N06 различает observed intervals, relative longest path и analytic earliest variants. Recommendation spec не выбранный вариант.

- [ ] **Step 1: Подготовить owner decision packet из синтетической матрицы.** Для каждого пункта нужен exact output contract, а не «CPM как обычно»:

| Решение | Проверяемый вопрос | Независимый пример для выбора |
|---|---|---|
| Admission | Только pair либо duration с отсутствующими краями? | duration3 без дат; start5 октября+duration3; finish9 октября+duration3 |
| Date meaning | Наблюдаемое положение, release/lock или справочная calendar date? | N06 A0–2/B5–6/C0–10, A→B |
| Horizon/gaps | Общий обратный horizon и смысл waiting days? | N06 gap3; отдельные компоненты длиной3/10 |
| Floats/locks/done | ProjectFloat vs constraintFloat; неизменяемость не критичность? | B hard start5, done variant, независимая C10 |
| Unknown/infeasible | Partial critical sets/labels допустимы? | known A→unknown U→dated B + independent C; conflict+unknown |

- [ ] **Step 2: Получить и записать actual owner decision.** Не назначать правила по рекомендации spec или approvals reviewers. Если ответ отсутствует, G-CPM OPEN, Task 5 pending-policy сохраняется; C05/OS16 не выполнены. Если выбран аналитический вывод отсутствующей границы, revise W01/N cases и повторить independent spec/affected plan review до использования.

- [ ] **Step 3: Создать математический ADR и implementation annex на выбранных формулах.** Annex должен определять signatures конечного `calculateSchedule`, domain analysis types, horizon/critical-edge predicate, exact independent expected arrays/floats/diagnostics и Runnable RED/GREEN commands. Записать **выбранные** outputs для fork/join, switch, equal paths, disconnected, release gap, locks/done, unknown, infeasible, parent containsCritical. До выбора в настоящий документ нельзя вставлять придуманные CPM assertions.

N06 числовые варианты из spec — только comparison packet: observed hypothetical float7/4/0 и constraint3 не целевой expected test. Annex не может использовать их как утверждённую математику без решения. Каждое numeric expected рассчитывается независимо от production solver (ручная арифметика/отдельный проверенный oracle fixture), с датами и объяснением выбора origin; display inputs запрещены.

- [ ] **Step 4: Цикл ревью annex до двух APPROVED.** Separate plan author и два reviewers на exact SHA проверяют отсутствие скрытого Auto, type consistency, числовую матрицу, task file map/TDD/commands и owner evidence. На замечаниях revise annex+ADR/affected spec и повторить. Commit `docs: define approved explicit-date critical path plan` только после фактического решения. Этот step — обязательная конкретная dependency Task 7, не готовая неизвестная implementation.

**Acceptance:** G-CPM CLOSED, решение владельца и accepted formulas существуют; отдельный численно исполнимый annex с двумя независимыми approvals. Этот план не выдает открытый gate за READY; no deadline/project-start возвращения в active model.

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
| OS07 / C14/D13/W04 | 2+5, N02–N04/weekend/overflow/root | conditional separate, original finish note, accessibility |
| OS08 | 2+5, full sibling anchor and nested knownStartMin | order/collapse/filter/scale no source changes; anchor update display only |
| OS09 | 2+5 | conditional gesture lock/no fake timeline arrow; graph relationship remains |
| OS10 / C15 | 1+3+5 | no legacy fields in target schemas/UI/bundle/Network; finish nullable |
| OS11 / W06 | 3+4+5, N05/current/deleted/history | exact raw archive+digests/counts; no field reassignment |
| OS12 | 3+5 | six project routes426 before lookup; unmodified old parser; transport-only legacy replay; stale response/no duplicate |
| OS13 | 3+4+5 | pre-migration undo, stale409, repeated migration, DDL+archive rollback, downgrade/invalid JSON |
| OS14 | 2+5, N04 | known FS ends without pair; unknown !=0, non-working diagnostic, cycle rollback |
| OS15 | 2+5 | pending-policy visible, floats absent, critical IDs empty with explanation; C05 unmet |
| OS16 / C05/O06 | 6+7 only, actual selected vectors | BLOCKED G-CPM; true math/IDs/tight edges after approved annex |
| OS17 | 5+7 | dirty/loading/error/offline/focus/Tab/Esc/keyboard, exact retry/undo, both viewports |

## Авторская проверка и документальный review этого плана

- [x] Coverage: каждый spec section/C11–C15/OS01–OS17 сопоставлен строкам выше; W01–W06 не стали C, G-MIGRATION стоит до registry, G-CPM не заменён набором пустых critical IDs.
- [x] Placeholder scan: в implementation steps нет скрытых незаполненных решений. Блокированные policy задачи имеют перечисленные входы/проверяемые выходы и отдельный review gate; формулы неизвестного CPM не выдуманы.
- [x] Types: source/duration cap различает new input и legacy response; SnapshotContext в current/operation/undo; new canonical version2 vs transport-only legacy replay; один OptionalResult shape и eventual active calculateSchedule.
- [x] Commands: новые suites перечислены для explicit package scripts при реализации; `npm test -- <paths>` соответствует Vitest script; Playwright только после build; Node exact pin не заменён установленной старой версией.
- [x] Scope: в текущей документальной задаче changed files только plan, IMPLEMENTATION_PLAN/STATUS и factual spec review footer. Ни application source, ни schema/fixtures не изменены.
- [ ] Запустить document-only `npm run check:kit`, `git diff --check`, staged guard/Gitleaks и history scans; обычные hooks. Root integrator отдельно проверяет public workspace/preflight; linked-worktree pointer refusal не обходить.
- [ ] Два новых независимых plan reviewer проверяют один candidate SHA. До получения вердиктов plan review PENDING; исправления имеют новый SHA и повторный цикл до двух APPROVED. Точное metadata записать только после результата.

План не начинает реализацию автоматически. Когда владелец поручит код, координатор выполняет разрешённые preparation задачи отдельными worker agents, продолжая независимый review цикл; policy gates сохраняют перечисленные ограничения.
