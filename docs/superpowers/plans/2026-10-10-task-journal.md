# Task Journal Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Реализовать сохраняемый датированный plain-text журнал проекта и конкретной задачи с отдельными CRUD/retry, безопасным lifecycle/Undo плана и полным рабочим клиентским сценарием.

**Architecture:** Один package React/Vite + Fastify + SQLite. Отдельные journal revision, repository и durable replay не вызывают scheduler; existing planning transaction использует небольшой journal lifecycle seam и адресное task save. Клиент хранит drafts/navigation только в памяти, отдельно согласует task metadata и JournalPage по project revision и не меняет planning baselines фоновым чтением.

**Tech Stack:** Existing TypeScript, React 19, Fastify 5, better-sqlite3, Zod, Vitest/Testing Library, Playwright. `.nvmrc`: Node 24.21.0; existing pinned package/lockfile сохраняются.

**Spec:** [Принятая спецификация журнала](../specs/2026-10-10-task-journal-design.md), [ADR 014](../../adr/014-task-journal.md), D21 в [DECISIONS](../../DECISIONS.md). Прочитать их целиком вместе с START_HERE/AGENTS. Stage 1 принят после независимых requirements/spec и technical/standards reviews; исходная точка — `6a7bc09`. План сохраняет C11–C28. Working boundary уточнение D21 после server review: cursor cap 4096 вместо2048 для полного JSON-escaped query; body/query well-formed Unicode, malformed surrogate 400, valid NUL сохраняется; NUL-safe SQL UTF-8 byte-bound 1…30000 дополняет exact 10000 UTF-16 validation. Это техническое уточнение, не новое C-решение.

## Global Constraints

Следующие binding формулировки дословно перенесены из спецификации; применяются к каждому Task:

- «Журнал — датированные пользовательские текстовые записи о работе по задаче, не автоматический audit log.»
- «Один объект доступен в ленте проекта и своей задачи.»
- «Любая существующая задача, включая родителя, `done` и работу без дат, принимает записи.»
- «Ни запись, ни её дата не меняют статус, исходные сроки, FS, календарь или CPM.»
- «Не входят глобальный журнал, часы/таймеры, категории, вложения, Markdown/HTML, реакции, упоминания, AI, отчёты, события Ганта, доска и реализация S5 import/export.»
- «Один writer изменяет миграцию, shared journal contracts и repository save/undo.»
- «Новый state framework, ORM, сервис или пакет не требуется.»
- «Task save refactor ограничен сохранением стабильных task IDs и provenance; scheduling behavior не меняется.»
- «Existing historical `beforeSnapshot`, migration archive и cached tree responses не переписывать/расширять.»
- «Никакой localStorage/sessionStorage/автосохранения несохранённого текста на сервер.»
- «Background refresh никогда не изменяет baseline editor/delete confirmation (§4).»
- «Publishing coherent page требует **равных** metadata и page projectRevision.»
- «Не понижать уже известные revisions.»
- «Утверждёнными визуальными референсами остаются только исходные три PNG.»
- «Журнал — private пользовательские данные наравне с tasks/descriptions.»
- «Не логировать journal body/title/query/workDate, route querystrings, raw requests/responses, cookies, session IDs или replay payload.»
- «Only safe error code/request ID.»
- «Fixtures/E2E/screenshots только synthetic; не добавлять PNG архива как approved assets.»
- «Новые journal writes вызывают existing demoLimits admission после strict parse, до repository; все retries в demo учитываются как attempts по D20.»
- «Normal mode не получает новых quotas.»
- «Никаких installs, новых credentials, remote push/deploy или changes scanner policy.»
- «production migration этим поручением не разрешена.»
- «Каждый этап коммитится только после положительного review.»

Один последовательный writer на Task 1 и shared interfaces. Task 2 начинается после принятия Task 1, Task 3 — после Task 2. Каждый implementer работает в отдельном worktree; reviewers получают один immutable candidate tree/commit и independently проверяют spec и standards. Полный цикл и subagent execution уже разрешены владельцем: нового permission checkpoint для локальных исправлений/проверок нет. Commit делает координатор после положительных reviews; remote actions остаются вне scope. Не читать private runtime paths, env, credentials или production data. Для нового теста сначала RED, затем GREEN; полные application suites не подменяются empty/skipped tests.

## File Map and Acceptance Ownership

| Unit | Responsibility / files | Owner |
|---|---|---|
| Public journal schemas | `src/shared/journal-contracts.ts`; imports only existing UUID/date/canonical utilities, no tree V2 extensions | Task 1 |
| Durable storage | `migrations/004-task-journal.sql`, `src/server/database.ts`, `src/server/journal-repository.ts` | Task 1 |
| Private lifecycle | `src/server/journal-lifecycle.ts`; integrate `src/server/repository.ts` save/mutate/latestUndo/createProject | Task 1 |
| HTTP | `src/server/app.ts`; existing policy and demo admission reused | Task 1 |
| Package / suites | `.dockerignore`, `scripts/package-check.mjs`, `package.json`; migration allowlist and explicitly enumerated tests | Task 1 |
| Journal state | `src/client/journal-state.ts`, `src/client/use-journal.ts`; keys, immutable pending envelope, pinned baselines, coherent reads | Task 2 |
| Components | `JournalFeed.tsx`, `JournalEditor.tsx`, `JournalTaskPicker.tsx`, `ProjectJournal.tsx`, `TaskJournal.tsx`, `ProjectViewTabs.tsx`, `journal.css` under `src/client/` | Task 2 |
| Navigation / integration | `src/client/workspace-navigation.ts`, `App.tsx`, `TaskPanel.tsx`, `TaskTree.tsx`, `TaskTimeline.tsx`, `api.ts`, `strings.ts`, `styles/app.css`, `styles/planning.css` | Task 2 |
| Acceptance / handoff | `tests/e2e/task-journal.spec.ts`, `tests/e2e/journal-navigation.spec.ts`, `tests/e2e/journal-drafts.spec.ts`, `tests/helpers/journal-e2e.ts`; README/docs | Task 3 |

| Acceptance | Primary executable evidence |
|---|---|
| J01–J04 | `tests/journal-contracts.test.ts`, `tests/journal-repository.test.ts`, `tests/client/journal.test.tsx` for safe text/date display |
| J05–J07 | `tests/journal-api.test.ts`, `tests/journal-replay.test.ts`, `tests/client/journal-drafts.test.tsx` for pinned edit/delete; solver isolation |
| J08–J10 | `tests/journal-lifecycle.test.ts`, existing repository/FS/CPM/provenance suites |
| J11 | `tests/journal-migration.test.ts`, migration/optional-upgrade/backup/legacy suites |
| J12 | `tests/journal-pagination.test.ts`, client append/stale tests |
| J13 | `tests/client/journal-navigation.test.tsx`, `tests/client/journal-coherence.test.tsx`, browser navigation suite |
| J14 | `tests/client/journal.test.tsx`, tree/panel regression suites, browser journal suite |
| J15 | `tests/client/journal-drafts.test.tsx`, coherence tests, browser draft suite |
| J16 | client states, `tests/demo-api.test.ts`, browser journal suite, package/privacy gates |

Read [ARCHITECTURE](../../ARCHITECTURE.md), [PRIVACY](../../PRIVACY.md), [UI](../../UI.md), [AGENT_WORKFLOW](../../AGENT_WORKFLOW.md), [BOOTSTRAP](../../BOOTSTRAP.md), [design/README](../../../design/README.md). Actually inspect all three approved PNGs before Task 2; the excluded subtask comparison and proposal archive are not implementation assets.

---

### Task 1: Journal Contracts, Durable CRUD, Migration and Safe Planning Lifecycle

**Deliverable:** Working authenticated server API covering J01–J12, independent of scheduler/revision/Undo for journal CRUD; task deletion/Undo correctly handles bounded private sidecar. This is one substantial review unit because migration/FK/save/undo must land together.

**Files:**

- Create: `migrations/004-task-journal.sql`, `src/shared/journal-contracts.ts`, `src/server/journal-repository.ts`, `src/server/journal-lifecycle.ts`.
- Modify: `src/server/database.ts:31`, `src/server/repository.ts:83` (project initialization), `:145` (latestUndo metadata), `:336` (mutate), `:437` (save), `src/server/app.ts:22` (decorate/routes).
- Modify: `.dockerignore`, `scripts/package-check.mjs`, `package.json` (test script file lists only; no dependencies/lockfile changes).
- Create tests: `tests/journal-contracts.test.ts`, `tests/journal-repository.test.ts`, `tests/journal-api.test.ts`, `tests/journal-replay.test.ts`, `tests/journal-lifecycle.test.ts`, `tests/journal-migration.test.ts`, `tests/journal-pagination.test.ts`, `tests/helpers/journal-fixture.ts`.
- Modify tests: `tests/migration.test.ts`, `tests/optional-migration.test.ts`, `tests/optional-upgrade.test.ts`, `tests/backup.test.ts`, `tests/demo-api.test.ts`, `tests/legacy-compatibility.test.ts`, `tests/repository.test.ts` as needed for current schema4 expectations and regression assertions. Preserve schema2/3 historical fixtures as historical inputs.
- Modify docs: `docs/STATUS.md`, `docs/ARCHITECTURE.md` (storage/lifecycle facts).

**Interfaces — exact public exports from `src/shared/journal-contracts.ts`:**

```ts
import type { z } from 'zod';
export type JournalEntry = {
  id: string; projectId: string; taskId: string; workDate: string;
  body: string; createdAt: string; updatedAt: string;
};
export type JournalCreate = {
  journalContractVersion: 1; operationId: string;
  expectedJournalRevision: number; taskId: string; workDate: string; body: string;
};
export type JournalUpdate = Omit<JournalCreate, 'taskId'>;
export type JournalDelete = Pick<JournalCreate,
  'journalContractVersion' | 'operationId' | 'expectedJournalRevision'>;
export type JournalMutation =
  | { journalContractVersion: 1; kind: 'saved'; projectId: string;
      journalRevision: number; entry: JournalEntry }
  | { journalContractVersion: 1; kind: 'deleted'; projectId: string;
      journalRevision: number; deletedEntryId: string };
export type JournalPage = {
  journalContractVersion: 1; projectId: string; taskId: string | null;
  journalRevision: number; projectRevision: number;
  entries: JournalEntry[]; nextCursor: string | null;
};
export type JournalEntryRead = {
  journalContractVersion: 1; projectId: string; journalRevision: number;
  projectRevision: number; entry: JournalEntry;
};
export type JournalProjectQuery = {
  q?: string; from?: string; to?: string; limit?: number; cursor?: string;
};
export type JournalTaskQuery = { limit?: number; cursor?: string };
// Export strict runtime schemas alongside these types:
// journalEntrySchema: z.ZodType<JournalEntry>
// journalCreateSchema: z.ZodType<JournalCreate>
// journalUpdateSchema: z.ZodType<JournalUpdate>
// journalDeleteSchema: z.ZodType<JournalDelete>
// journalMutationSchema: z.ZodType<JournalMutation>
// journalPageSchema: z.ZodType<JournalPage>
// journalEntryReadSchema: z.ZodType<JournalEntryRead>
// journalProjectQuerySchema / journalTaskQuerySchema accept HTTP string query
// and produce JournalProjectQuery / JournalTaskQuery respectively.
```

Schemas use `z.strictObject`, existing `uuidSchema` and `calendarDateSchema`, `z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER)`. UTC timestamp validation requires canonical `new Date(value).toISOString() === value` as well as ISO validity; client cannot supply timestamps. Body `z.string().min(1).max(10000).refine(value => value.trim().length > 0)` additionally requires well-formed Unicode and explicit `value.length <= 10000` UTF-16 bound; it saves the original string including NUL. Query also requires well-formed Unicode before and after normalization with explicit 300-unit bounds; malformed surrogate input is400. Query has trimmed NFC/lowercase `ru` normalization, max 300 code units, optional inclusive from/to and `from <= to`; HTTP limit accepts only decimal integer text in 1–100 (reject empty, fractions, signed/exponent/unknown fields). No-query entry GET rejects all unknown query keys. Task query rejects q/from/to.

**Interfaces — server seams consumed by later tasks:**

```ts
// journal-repository.ts; public class methods return validated DTOs only.
import type Database from 'better-sqlite3';
import type { JournalCreate, JournalUpdate, JournalDelete, JournalPage,
  JournalEntryRead, JournalMutation, JournalProjectQuery, JournalTaskQuery
} from '../shared/journal-contracts.js';
export interface JournalRepositoryContract {
  getProjectPage(projectId: string, query: JournalProjectQuery): JournalPage;
  getTaskPage(projectId: string, taskId: string, query: JournalTaskQuery): JournalPage;
  getEntry(projectId: string, entryId: string): JournalEntryRead;
  create(projectId: string, input: JournalCreate, sessionId: string): JournalMutation;
  update(projectId: string, entryId: string, input: JournalUpdate,
    sessionId: string): JournalMutation;
  delete(projectId: string, entryId: string, input: JournalDelete,
    sessionId: string): JournalMutation;
}
// Implement export class JournalRepository implements JournalRepositoryContract
// with constructor(db: Database.Database, now: () => number = Date.now).
// app.journalRepository uses the same connection and now as app.repository.

// journal-lifecycle.ts; all methods require db.inTransaction and never start
// or commit a transaction, read a tree, or call planning/cascade/solver.
import type { JournalEntry } from '../shared/journal-contracts.js';
export interface JournalLifecycleContract {
  captureDeletion(undoSequence: number, projectId: string,
    removedTaskIds: readonly string[]): number; // writes v1 manifest, returns count
  validateUndo(undoSequence: number, projectId: string,
    lifecycleVersion: 0 | 1, targetTaskIds: readonly string[],
    removedTaskIds: readonly string[]): JournalEntry[]; // validates before save
  finishDeletion(projectId: string, removedEntryCount: number): void;
  restore(projectId: string, entries: readonly JournalEntry[]): void;
}
// Implement export class JournalLifecycle implements JournalLifecycleContract
// with constructor(db: Database.Database).
```

`captureDeletion` writes mandatory manifest even for empty removedTaskIds; every new before-snapshot is lifecycle1. `finishDeletion` bumps journal revision once iff count>0 after FK deletion; `restore` bumps once iff nonempty. `validateUndo` checks manifest/sidecar/count/digest/scope/active collisions/target IDs first, then active entries on removedTaskIds; valid later entries yield `UNDO_JOURNAL_CONFLICT`409. Corruption yields safe 500, even when syntactically valid body/date changed. Every sidecar task must belong to `targetTaskIds` minus current DB task IDs (restored tasks), rather than merely any target task. Historical version0 accepts no sidecar/manifest, rejects any unexpected data. No new fields in privateSnapshotV2Schema, tree V2, legacy validators or archive.

- [ ] **Step 1: Register independent tests and write contract/storage RED tests.**

Append `tests/journal-contracts.test.ts` to `test:unit` and all six server journal test files to `test:integration`; `npm test` already discovers them. `tests/helpers/journal-fixture.ts` owns only synthetic setup/cleanup and planning command convenience; expected data is hand-authored, never computed using journal code. Start with this complete fixture and regression in `tests/journal-repository.test.ts`:

```ts
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { expect, it } from 'vitest';
import { openDatabase } from '../src/server/database.js';
import { Repository } from '../src/server/repository.js';
import { JournalRepository } from '../src/server/journal-repository.js';

it('keeps a journal entry and plan revision across rename and exact retry', () => {
  const dir = mkdtempSync(join(tmpdir(), 'leaf-journal-synthetic-'));
  const db = openDatabase(join(dir, 'synthetic.sqlite'));
  try {
    const now = () => Date.parse('2026-10-10T12:00:00.000Z');
    const plan = new Repository(db, now);
    const journal = new JournalRepository(db, now);
    const project = plan.createProject('Synthetic journal project');
    const tree = plan.applyCommand(project.id, {
      contractVersion: 2, operationId: randomUUID(), expectedRevision: 0,
      command: { type: 'task.create', title: 'Parent', parentId: null },
    }, 'synthetic-session');
    const taskId = tree.tasks[0]!.id;
    const envelope = { journalContractVersion: 1 as const,
      operationId: randomUUID(), expectedJournalRevision: 0, taskId,
      workDate: '2024-02-29', body: '  Первая строка\nВторая строка  ' };
    const saved = journal.create(project.id, envelope, 'synthetic-session');
    if (saved.kind !== 'saved') throw new Error('Expected saved fixture');
    expect(plan.getTree(project.id, 'synthetic-session')).toEqual(tree);
    // Abort any accidental deletion of the surviving task, even if reinserted.
    db.exec(`CREATE TRIGGER synthetic_survivor_guard BEFORE DELETE ON tasks
      BEGIN SELECT RAISE(ABORT, 'Synthetic task churn'); END`);
    plan.applyCommand(project.id, { contractVersion: 2,
      expectedRevision: 1, operationId: randomUUID(),
      command: { type: 'task.edit', taskId, changes: { title: 'Renamed' } },
    }, 'synthetic-session');
    expect(journal.getProjectPage(project.id, {}).entries).toEqual([saved.entry]);
    expect(journal.getTaskPage(project.id, taskId, {}).entries).toEqual([saved.entry]);
    expect(journal.create(project.id, envelope, 'synthetic-session')).toEqual(saved);
    expect(journal.getProjectPage(project.id, {}).journalRevision).toBe(1);
    expect(db.prepare('SELECT COUNT(*) AS n FROM journal_operations').get())
      .toEqual({ n: 1 });
  } finally { db.close(); rmSync(dir, { recursive: true, force: true }); }
});
```

Run `npx vitest run tests/journal-contracts.test.ts tests/journal-repository.test.ts`; RED is a missing module/table or survivor trigger failing on old delete-all save. Then add body/date/strict-union/unknown-field contract fixtures (whitespace-only, 10000/10001 UTF-16 units, leap/nonleap, year0001/9999, canonical/noncanonical UTC, unsafe revision, both entry/deletedEntryId). Contract errors must never echo submitted text.

- [ ] **Step 2: Write migration/backup RED tests and implement additive schema4.**

`tests/journal-migration.test.ts`: build raw synthetic schema3 from existing SQL/prepareOptionalMigration fixtures; hash archive originalText/sha256, operation payload/response/digests and beforeSnapshot strings before/after. Test fresh1→2→3→4, schema3→4, schema4 reopen no DDL, schema2 unapproved refusal before pragma/DDL, approved003→004, unsupported1/gap/future, and trigger abort `BEFORE INSERT ON migrations WHEN NEW.version=4` leaves schema3/tables/history unchanged. Existing schema3 snapshot fixture must survive with lifecycle0. Never alter historical migration003 bytes to manufacture schema4.

SQL core of `004-task-journal.sql` (include project/state initializer trigger and both paging indexes):

```sql
CREATE TABLE journal_state (
  projectId TEXT PRIMARY KEY REFERENCES projects(id) ON DELETE CASCADE,
  revision INTEGER NOT NULL CHECK(revision >= 0)
) STRICT;
INSERT INTO journal_state(projectId,revision) SELECT id,0 FROM projects;
CREATE TRIGGER journal_state_new_project AFTER INSERT ON projects
BEGIN INSERT INTO journal_state(projectId,revision) VALUES (NEW.id,0); END;
CREATE TABLE journal_entries (
  id TEXT PRIMARY KEY,
  projectId TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  taskId TEXT NOT NULL,
  workDate TEXT NOT NULL CHECK(length(workDate)=10),
  body TEXT NOT NULL CHECK(length(CAST(body AS BLOB)) BETWEEN 1 AND 30000),
  createdAt TEXT NOT NULL, updatedAt TEXT NOT NULL,
  FOREIGN KEY(projectId,taskId) REFERENCES tasks(projectId,id) ON DELETE CASCADE
) STRICT;
CREATE INDEX journal_project_order
  ON journal_entries(projectId,workDate DESC,createdAt DESC,id DESC);
CREATE INDEX journal_task_order
  ON journal_entries(projectId,taskId,workDate DESC,createdAt DESC,id DESC);
CREATE TABLE journal_operations (
  operationId TEXT PRIMARY KEY,
  projectId TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  sessionId TEXT NOT NULL, payload TEXT NOT NULL, response TEXT NOT NULL,
  responseSha256 TEXT NOT NULL,
  contractVersion INTEGER NOT NULL CHECK(contractVersion=1)
) STRICT;
ALTER TABLE undo_snapshots ADD COLUMN journalLifecycleVersion INTEGER NOT NULL
  DEFAULT 0 CHECK(journalLifecycleVersion IN (0,1));
CREATE TABLE undo_journal_entries (
  undoSequence INTEGER NOT NULL REFERENCES undo_snapshots(sequence) ON DELETE CASCADE,
  id TEXT NOT NULL, projectId TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  taskId TEXT NOT NULL, workDate TEXT NOT NULL CHECK(length(workDate)=10),
  body TEXT NOT NULL CHECK(length(CAST(body AS BLOB)) BETWEEN 1 AND 30000),
  createdAt TEXT NOT NULL, updatedAt TEXT NOT NULL,
  PRIMARY KEY(undoSequence,id)
) STRICT;
CREATE TABLE undo_journal_manifest (
  undoSequence INTEGER PRIMARY KEY REFERENCES undo_snapshots(sequence) ON DELETE CASCADE,
  entryCount INTEGER NOT NULL CHECK(entryCount>=0), entriesSha256 TEXT NOT NULL
) STRICT;
```

Initializer trigger is the sole future-project initializer; do not also insert state in Repository.createProject/demo seed. Validate state row exists on read/write, safe 500 on corrupt missing row rather than lazy reset. SQLite text length stops at NUL; `length(CAST(body AS BLOB))` counts UTF-8 bytes including NUL. The 1…30000 byte bound admits every validated well-formed 10000-unit body; explicit JavaScript length refinement enforces UTF-16 before storage (installed Zod `.max` alone does not). Dates/timestamps require server validation beyond SQL length.

In openDatabase extend continuous supported maximum3 to4 and migration array by004; leave schema2 approval before chmod/pragma/DDL and optional003 prepare unchanged. Add explicit `!migrations/004-task-journal.sql` to `.dockerignore` and exact expected list in package checker immediately so server build contains004. Update current max-version expectations in migration/backup tests; retain historical raw schema2/3 builders. Extend backup test to populate active entries/state/replay and deletion sidecar/manifest, backup via `backupDatabase` to a fresh external temp destination, open readonly copy and compare independent rows/integrity. Test reopening backup using schema4 binary. Run migration/optional-upgrade/backup/new migration tests.

- [ ] **Step 3: Implement solver-free CRUD/replay and independent conflict/rollback tests.**

Use class interfaces above; register deterministic SQLite function `leaf_journal_contains(value, query)` on its connection:

```ts
const normalized = (text: string) => text.normalize('NFC').toLocaleLowerCase('ru');
db.function('leaf_journal_contains', { deterministic: true },
  (value, query) => normalized(String(value)).includes(String(query)) ? 1 : 0);
```

Each new CRUD `db.transaction(fn).immediate()`: parse strict input; canonical payload `{method, projectId, entryId:null|string, input}` using existing `canonical`; lookup journal_operations by operationId before state/scoped entity/current revision. Compare projectId/sessionId/contractVersion/payload; exact reuse validates response hex SHA256, strict union, project identity, result kind, update/delete entry ID, create taskId and submitted date/body. Do not compare frozen ack to current rows. Recover status from verb (POST201, PATCH/DELETE200), not client fields. Digest or shape/scope corruption throws safe internal error with no write. Changed payload, session or project gives `OPERATION_REUSED`409 without prior content.

For new operation: verify project, scoped task/entry, state; mismatch gives `JOURNAL_REVISION_CONFLICT`409; create server UUID and canonical timestamp, update original createdAt and server updatedAt (even equal fields), delete scoped ID. Increment journal state once. Strict-validate DTO, JSON serialize/digest and persist operation in same transaction. SQL uses parameters, no raw input names/interpolation. `getEntry` is one read transaction with both revisions, strict output and no solver.

J06/J07 tests inject row/state/operation failures with synthetic SQL triggers and compare all affected table rows before/after; use monotonic test clock for timestamps. Two JournalRepository instances/connections share synthetic DB: both submit revision5, one success6, other409. Exact create/update/delete retries survive close/reopen, later update/delete/task deletion; no new ID/timestamp/revision. Damage replay JSON, digest, valid-but-wrong DTO/project/entry/kind and contract version; safe 500/rollback. Spy on planning `getTree`, scheduler `calculateSchedule` and `cascadeFs` after setup; every journal read/new write/replay leaves spies uncalled. Compare raw project/tasks/dependencies/provenance/undo_snapshots/operations and plan canUndo before/after. Use independent fixed accepted acknowledgement fixtures for replay validator, rather than generating all malformed responses from its own serializer.

- [ ] **Step 4: Write keyset/filter RED scenarios and implement one-transaction paging.**

Internal cursor strict type (server-only, not tree contract):

```ts
export type JournalCursor = {
  version: 1; projectId: string; taskId: string | null;
  q: string; from: string | null; to: string | null; limit: number;
  journalRevision: number; projectRevision: number;
  last: { workDate: string; createdAt: string; id: string };
};
```

`getProjectPage`/`getTaskPage` read project/journal state and rows in one deferred transaction. Task feed verifies task scope even when empty. Normalize q once. SQL joins tasks on both projectId/id; body OR current title substring predicate, inclusive optional dates AND, direct task equality only. Limit50 default, limit+1 selection, descending tuple comparison `(workDate,createdAt,id)<(?,?,?)`. Encode canonical strict cursor with UTF8 base64url; cap raw input4096, validate encoding/JSON/strict types/last tuple and full route+normalized-filter scope independently before trusting position. Wrong scope400; either revision differs409 `JOURNAL_CURSOR_STALE`.

Independent fixture: 125 hand-written entries, all same createdAt, stable ascending UUID suffixes, 65 on2024-02-29 and60 on2024-02-28; first50 IDs125→76, second50 IDs75→26, final25 IDs25→1. Group boundary and tie ID expectations are arithmetic fixture constants, not journal comparator output. Table-driven Russian `Ё/ё`, composed/decomposed NFC, literal `%`, `_`, newline/HTML, body OR renamed title, inclusive/open-ended dates, no hidden period/status filter, full ancestor/direct-only feeds. After each of journal mutation/title rename/task delete/Undo, old cursor returns409 and fresh pages reflect current membership; forged project/task/query/date/limit returns400. Read/replay should not refresh tree. Run pagination/repository/replay tests GREEN.

- [ ] **Step 5: Implement targeted save and lifecycle with destructive-operation RED guards.**

In planning mutate record `beforeTaskIds` before change, compute target IDs after change or decoded Undo. Preserve cached planning/legacy replay early return before all lifecycle effects. Extend latestUndo record with `journalLifecycleVersion`; never alter beforeSnapshot JSON.

For new command: insert before-snapshot with lifecycle1; obtain `lastInsertRowid`; call `captureDeletion(sequence, projectId, before-minus-next)` before save, writing sidecar+manifest for every snapshot. Compute digest with existing canonical over `{undoSequence,projectId,entries}` where entries use all seven fields and are ID-sorted. Validate count/digest/schema/project/task membership prior to storage. Existing twenty-item pruning remains inside transaction, cascades exact sidecars/manifests. Save deletes dependencies, inserts new tasks, updates surviving tasks by projectId/id, deletes only removed IDs, then syncs provenance to next snapshot explicitly and reinserts dependencies. Deferred parent FK remains; `REPLACE` and bulk task delete are prohibited. For moved/promoted work IDs follow existing snapshot IDs/provenance resolution, with no ID renaming by save. Add this focused helper inside repository.ts (caller already cleared dependencies and owns the IMMEDIATE transaction):

```ts
import type Database from 'better-sqlite3';
import type { Task } from '../shared/contracts.js';
function reconcileTasks(db: Database.Database, projectId: string, next: readonly Task[]) {
  const existing = new Set((db.prepare('SELECT id FROM tasks WHERE projectId=?')
    .all(projectId) as { id: string }[]).map(row => row.id));
  const nextIds = new Set(next.map(task => task.id));
  const insert = db.prepare(`INSERT INTO tasks(id,projectId,parentId,title,description,
    sortOrder,status,inputStart,inputFinish,createdAt,updatedAt,durationDays)
    VALUES (@id,@projectId,@parentId,@title,@description,@sortOrder,@status,
      @inputStart,@inputFinish,@createdAt,@updatedAt,@durationDays)`);
  const update = db.prepare(`UPDATE tasks SET parentId=@parentId,title=@title,
    description=@description,sortOrder=@sortOrder,status=@status,inputStart=@inputStart,
    inputFinish=@inputFinish,createdAt=@createdAt,updatedAt=@updatedAt,
    durationDays=@durationDays WHERE projectId=@projectId AND id=@id`);
  for (const task of next) if (!existing.has(task.id)) insert.run(task);
  for (const task of next) if (existing.has(task.id)) update.run(task);
  const remove = db.prepare('DELETE FROM tasks WHERE projectId=? AND id=?');
  for (const id of existing) if (!nextIds.has(id)) remove.run(projectId, id);
}
```

Sync provenance from validated `snapshot.legacyIntervalUnavailable`: remove only rows no longer in that set and insert missing rows with fixed reason; do not rely on surviving task cascade to clear old reasons. Lifecycle digest has this exact representation, including empty arrays:

```ts
import { createHash } from 'node:crypto';
import { canonical } from '../shared/canonical.js';
import type { JournalEntry } from '../shared/journal-contracts.js';
function sidecarDigest(undoSequence: number, projectId: string,
  entries: readonly JournalEntry[]): string {
  const ordered = [...entries].sort((a, b) => a.id.localeCompare(b.id));
  return createHash('sha256').update(canonical({
    undoSequence, projectId, entries: ordered,
  })).digest('hex');
}
```

`finishDeletion` follows cascade deletion before response/replay persistence.

For Undo: decode existing snapshot; call `validateUndo` before save, snapshot deletion or any project update. Removed current IDs with active notes yield409, retaining top undo eligibility. Insert restored tasks through save, restore validated sidecar rows exactly, bump once iff restored notes, then delete latest snapshot and update previous contiguous afterRevision using existing rule. AfterRevision is excluded from digest. Failure of restore/collision/digest/manifest/transaction preserves tasks, journal, project revision, snapshots, operations. Schedule/cascade remain solely current plan path.

J08: trigger abort on any DELETE of surviving task; rename/move/status/source/FS/project settings and each Undo preserve journal raw row bytes; independent provenance fixture checks reason/task IDs through source adoption and work-preserving promotion. J09 fixture: branchA→childA2→nestedA3 + siblingB, notes on each; deletingA removes exactly three notes with one revision increase, leavesB; after B edit/create/delete, Undo restores exactA IDs/date/body/timestamps and currentB rows. Inject failure after capture/task delete/restore and compare raw tables.

J10 matrix builds a fresh deletion fixture for each corruption, never reuses damaged state: delete one/all sidecar rows; missing manifest; alter valid body/date; wrong count/digest; valid foreign scope/task or surviving target task instead of restored task; active ID collision; v0 unexpected sidecar. Each Undo safe 500, all rows/state/snapshots/operations unchanged. v1 zero-entry manifest and historicalv0 accepted. Create task→journal later→Undo409 unchanged→explicit journal delete→new planning operationId Undo succeeds. Twenty-two new snapshots retain exactly last20 manifests/sidecars; no unrelated sequence removal. Frozen planning delete/retry after restore and frozen legacy/current replies must return original bytes without lifecycle/solver/current journal changes.

Run `npx vitest run tests/journal-lifecycle.test.ts tests/repository.test.ts tests/fs-cascade-repository.test.ts tests/explicit-cpm-repository.test.ts tests/legacy-compatibility.test.ts tests/optional-upgrade.test.ts`.

- [ ] **Step 6: Add authenticated routes and complete API/demo/privacy tests.**

Decorate app.journalRepository using same db/now, extend Fastify type. Six routes exactly from spec§4; reuse requireSession/requireContractVersion(false), onRequest policy/bodyLimit/no-store/error handler. Strict route params project/task/entry UUID, strict query and JSON envelope; API calls session after authentication only. Journal writes admitMutation after parse before repository, including exact retries. Return POST201 or PATCH/DELETE200; entry GET/list200; 404 for cross-project IDs, 400 invalid fields/cursor,401 auth,403 Origin,415 JSON,426 contract,413 body limit,409 conflicts, safe 500 corruption. Foreign/not found errors reveal no journal data. No request logger added.

API tests use `buildApp` with isolated synthetic.sqlite and app.inject, existing test-only login pattern. Assert every route unauthorized; writes wrong/missing Origin/content type/version/legacy replay; query unknown on entry/task; foreign project/task/entry; huge body; no-store headers on success/errors. Raw synthetic table snapshots prove rejected requests do not mutate state/history. Demo fixtures show all three CRUD and retries count attempts, rollback on admission, normal server no new quota and seed/reset still works without journal requirement. Assert response union never includes session/payload/schedule/tree. Capture only synthetic logging channels to assert sentinel body/query/workDate absent; do not print request/response dumps in assertions.

- [ ] **Step 7: Run server acceptance, update handoff, freeze candidate for reviews.**

Run `npm run typecheck`, `npm run lint`, then `npx vitest run tests/journal-contracts.test.ts tests/journal-repository.test.ts tests/journal-api.test.ts tests/journal-replay.test.ts tests/journal-lifecycle.test.ts tests/journal-migration.test.ts tests/journal-pagination.test.ts tests/migration.test.ts tests/optional-migration.test.ts tests/optional-upgrade.test.ts tests/backup.test.ts tests/demo-api.test.ts tests/legacy-compatibility.test.ts tests/repository.test.ts tests/fs-cascade-repository.test.ts tests/explicit-cpm-repository.test.ts`. Run `npm run build`, `npm run format:check`, `npm run check:kit`, `npm run check:package`, `git diff --check`. Verify package scripts include every new file; full application regression belongs to Task3 after UI integration. Update ARCHITECTURE and STATUS with schema4/API/lifecycle facts, J01–J12 coverage/counts, PASS/FAIL/NOT RUN and client not yet implemented. Stage explicit Task1 paths; run `npm run security:staged`; freeze `git write-tree` for both independent reviewers. Resolve review failures/retest affected seams; only then coordinator commits `feat: add durable task journal and reversible lifecycle`. No client/UI completion claims.

### Task 2: Working Journal UI, Coherent Metadata, Drafts and Session Navigation

**Deliverable:** Project feed and task journal perform real CRUD through Task1 API; navigation/filters/scroll/focus work and all drafts survive specified transitions, conflict and uncertainty. Server/shared contract files are consumed, not redesigned.

**Files:**

- Create: `src/client/journal-state.ts`, `src/client/use-journal.ts`, `src/client/workspace-navigation.ts`, `src/client/ProjectViewTabs.tsx`, `src/client/JournalFeed.tsx`, `src/client/JournalEditor.tsx`, `src/client/JournalTaskPicker.tsx`, `src/client/ProjectJournal.tsx`, `src/client/TaskJournal.tsx`, `src/client/styles/journal.css`.
- Modify: `src/client/api.ts`, `App.tsx`, `TaskPanel.tsx`, `TaskTree.tsx`, `TaskTimeline.tsx`, `strings.ts`, `styles/app.css`, `styles/planning.css`.
- Create tests: `tests/client/journal-api.test.ts`, `tests/client/journal-state.test.ts`, `tests/client/journal.test.tsx`, `tests/client/journal-drafts.test.tsx`, `tests/client/journal-coherence.test.tsx`, `tests/client/journal-navigation.test.tsx`, `tests/client/journal-context.test.tsx`, `tests/client/journal-fixtures.ts`.
- Extend: existing client App/planning/tree/inline-add tests for unchanged planning baseline and shared-menu keyboard behavior. `tests/client` is already included by test:unit, no dependency or test runner changes.
- Modify: `docs/STATUS.md`, `docs/UI.md` with delivered behavior and limitations.

**Interfaces — consumes Task1 DTOs and produces API methods in existing `api`:**

```ts
journalProject(projectId: string, query: JournalProjectQuery): Promise<JournalPage>;
journalTask(projectId: string, taskId: string, query: JournalTaskQuery): Promise<JournalPage>;
journalEntry(projectId: string, entryId: string): Promise<JournalEntryRead>;
journalCreate(projectId: string, input: JournalCreate): Promise<JournalMutation>;
journalUpdate(projectId: string, entryId: string, input: JournalUpdate): Promise<JournalMutation>;
journalDelete(projectId: string, entryId: string, input: JournalDelete): Promise<JournalMutation>;
```

Use existing request strict parser/ApiError timeout/uncertain semantics, contract header2 and same-origin credentials. URLSearchParams serializes query fields; no body/search in browser navigation URLs. No legacy replay header for journal.

**Interfaces — journal-state.ts and use-journal.ts:**

```ts
import type { Task, ProjectTree } from '../shared/contracts.js';
import type { JournalEntry, JournalPage, JournalEntryRead,
  JournalCreate, JournalUpdate, JournalDelete, JournalProjectQuery
} from '../shared/journal-contracts.js';
export type JournalDraftKey =
  | `project:${string}:task:${string}:create`
  | `project:${string}:modal:create`
  | `project:${string}:entry:${string}:edit`;
export type JournalDraft = {
  key: JournalDraftKey; projectId: string; taskId: string | null;
  entryId: string | null; body: string; workDate: string;
  dateTouched: boolean; dirty: boolean;
  baselineEntry: JournalEntry | null;
  baselineJournalRevision: number; // pinned for edit; create pins at send
};
export type JournalPending =
  | { key: JournalDraftKey; method: 'POST'; projectId: string;
      input: JournalCreate; sentDraft: JournalDraft }
  | { key: JournalDraftKey; method: 'PATCH'; projectId: string;
      entryId: string; input: JournalUpdate; sentDraft: JournalDraft }
  | { key: JournalDraftKey; method: 'DELETE'; projectId: string;
      entryId: string; input: JournalDelete; baselineEntry: JournalEntry };
export type JournalDeleteConfirmation = {
  projectId: string; entry: JournalEntry; baselineJournalRevision: number;
};
export type JournalMetadata = {
  projectId: string; revision: number; tasks: readonly Task[];
};
export type JournalFeedState = {
  scope: { projectId: string; taskId: string | null; query: JournalProjectQuery };
  page: JournalPage | null; metadata: JournalMetadata | null;
  pendingPage: JournalPage | null;
  phase: 'loading' | 'ready' | 'empty' | 'no-match' | 'error' |
    'loading-more' | 'more-error' | 'stale' | 'metadata-error';
  error: string | null; // safe display string, no HTTP dumps
};
export type JournalController = {
  active: boolean; projectFeed: JournalFeedState | null; taskFeed: JournalFeedState | null;
  drafts: ReadonlyMap<JournalDraftKey, JournalDraft>;
  pending: JournalPending | null; writing: boolean; uncertain: boolean;
  deleteConfirmation: JournalDeleteConfirmation | null;
  hasDirtyDrafts: boolean; unavailableTaskIds: ReadonlySet<string>;
  mutationError: string | null; notice: string | null;
  activeConflictKey: JournalDraftKey | null;
  conflictCurrent: JournalEntryRead | null; conflictRemoved: boolean;
  getDraft(key: JournalDraftKey): JournalDraft | undefined;
  openCreate(projectId: string, taskId: string | null, today: string): JournalDraftKey | null;
  openEdit(entry: JournalEntry, journalRevision: number): JournalDraftKey | null;
  changeDraft(key: JournalDraftKey,
    fields: Partial<Pick<JournalDraft, 'body' | 'workDate' | 'taskId'>>): void;
  clearDraft(key: JournalDraftKey): void; // caller confirms nonempty loss
  submit(key: JournalDraftKey): Promise<boolean>;
  retry(): Promise<boolean>;
  askDelete(entry: JournalEntry, journalRevision: number): void;
  cancelDelete(): void;
  confirmDelete(): Promise<boolean>;
  showCurrent(): Promise<void>;
  acceptCurrent(key: JournalDraftKey, mode: 'replace' | 'keep-own'): void;
  refresh(): Promise<void>;
  loadMore(scope: 'project' | 'task'): Promise<void>;
  clearPrivateState(): void;
};
export type JournalActiveContext = {
  status: 'active'; // App session authenticated, matching project tree loaded
  projectId: string; taskId: string | null; today: string;
  projectQuery: JournalProjectQuery; planningTree: ProjectTree;
  planningDirty: boolean; planningUncertain: boolean; planningBusy: boolean;
  applyCleanTree: (tree: ProjectTree) => boolean;
  onAuthRequired: () => void;
};
export type JournalInactiveContext = {
  status: 'inactive';
  reason: 'auth-loading' | 'signed-out' | 'no-projects' |
    'project-loading' | 'project-unavailable';
  onAuthRequired: () => void;
};
export type JournalContext = JournalActiveContext | JournalInactiveContext;
// export function useJournal(context: JournalContext): JournalController;
```

`useJournal` is called unconditionally in App before all authentication/loading/empty-project returns. App supplies inactive context while session is loading/signed-out, tree is null, project list is empty or project loading/unavailable; active context requires authenticated session and a matching loaded tree. Do not invent a tree or use non-null assertions. `useProjectToday` can remain unconditional with `tree?.project.timezone ?? 'UTC'`; its fallback is never submitted while inactive.

Inactive context sets controller.active=false and returns null current feeds; it cancels read/focus publication by advancing generation (including late tree GET) and starts no journal GET/write. `submit`/`retry`/`confirmDelete` resolve false, `refresh`/`loadMore`/`showCurrent` resolve without requests; `openCreate`/`openEdit` return null and callers do not open an editor, other editor mutation actions are no-ops. `getDraft`, dirty indication and explicit `clearPrivateState` remain available. Pending envelopes, pinned baselines and all project-keyed drafts/caches survive project-loading/null transitions; returning to a project reloads current feeds and exposes that project's original draft. Inactivity alone never discards RAM drafts. Normal project navigation already blocks unresolved writes; forced inactive/auth transitions cannot publish their late responses. Completed confirmed logout or401 explicitly calls clearPrivateState (advance private-session generation, invalidate all pending callbacks, wipe drafts/cache/pending) before signed-out UI. Initial signed-out state merely gates access; no draft is shown without authentication. App login/project loading never conditionally mounts the hook.

`useJournal` stores drafts/revisions/pending/read-only metadata in memory above project/task view switches (App-owned hook stays mounted). `journal-state.ts` contains pure key/order/group/merge/pinned-draft helpers. Keep delete confirmation across close/reopen and Back until explicit cancel/new confirmation; ordinary GET cannot move baseline. `showCurrent` uses entry GET only for explicit conflict resolution; keep-own adopts shown current baseline and retains own body/date, separate submit creates new UUID. Removed404 permits copy, blocks update/delete, never recreate. `clearPrivateState` wipes pending/caches/drafts after completed logout/401. Component props use the same controller; editor must never send POST/PATCH/DELETE directly.

**Interfaces — small component/navigation contracts:**

```ts
export type ProjectView = 'tasks' | 'journal';
export type WorkspaceVisit = {
  projectId: string; view: ProjectView; taskId: string | null;
  panel: 'details' | 'subtasks' | 'dependencies' | 'journal';
};
export type WorkspaceHistoryState = { leaf: { version: 1; visitId: string } };
// workspace-navigation.ts exports:
// parseWorkspaceUrl(url: URL): WorkspaceVisit | null
// workspaceUrl(visit: WorkspaceVisit): string
// writeWorkspaceVisit(visit: WorkspaceVisit, visitId: string,
//   mode: 'push' | 'replace'): void
// URL only the four allowed parameters; history only version+visitId.
// App keeps Map<visitId, session view state>, never draft/text in history.

// JournalEditor props:
// { draft: JournalDraft; controller: JournalController; disabled: boolean;
//   onSaved: () => void; onCancel?: () => void; taskPicker?: React.ReactNode }
// JournalFeed props:
// { state: JournalFeedState; controller: JournalController;
//   onOpenTask: (task: Task, trigger: HTMLElement) => void; showTaskTitles: boolean }
// JournalTaskPicker props:
// { metadata: JournalMetadata; value: string | null;
//   onChange: (taskId: string) => void; disabled: boolean }
// ProjectJournal/TaskJournal consume controller and these common components.
// TaskPanel adds journalContent?: React.ReactNode, PanelTab += 'journal'.
// TaskTree and TaskTimeline add onJournal?: (task: Task, trigger: HTMLElement) => void.
```

`TaskTimeline` stays mounted hidden for project view switch; avoid a second scheduler/display implementation. For Back/Forward per-visit period/scale/width/filter-collapse/scroll restoration add these minimal exported hooks to existing Timeline props: `onViewState?: (state: TimelineViewState) => void`, `restoreViewState?: TimelineViewState`; define `TimelineViewState = {scale: Scale; start: string; width: number; filteredCollapse: {key: string; ids: string[]}; scrollTop: number; scrollLeft: number}` with existing `Scale` from gantt-view. App also stores showGantt/collapse/taskFilter/selection/panelTab/project feed anchor per visit. Capture before switching, restore after layout and rows available; use restoration generation token to cancel late focus/scroll after explicit navigation/user focus. Preserve existing quick drafts in App memory map.

- [ ] **Step 1: Write API/pinned-baseline RED fixtures before UI.**

Independent `journal-fixtures.ts` imports existing `task(n)`/project from client fixtures, defines literal journal5/page5/read6 and renamed metadata. Do not call server/domain journal code to construct expected responses. A concrete pinned baseline test in `tests/client/journal-state.test.ts`:

```ts
import { expect, it } from 'vitest';
import { openEditDraft } from '../../src/client/journal-state.js';
import { project, task } from './fixtures.js';
import type { JournalEntry } from '../../src/shared/journal-contracts.js';
const entry: JournalEntry = {
  id: '33333333-3333-4333-8333-333333333333', projectId: project.id,
  taskId: task(1).id, workDate: '2024-02-29', body: 'Original synthetic text',
  createdAt: '2026-10-10T10:00:00.000Z', updatedAt: '2026-10-10T10:00:00.000Z',
};
it('reopening an edit keeps the first baseline and own text', () => {
  const first = openEditDraft(undefined, entry, 5);
  const own = { ...first, body: 'Own draft', dirty: true };
  const reopened = openEditDraft(own, { ...entry, body: 'Remote text' }, 6);
  expect(reopened.body).toBe('Own draft');
  expect(reopened.baselineEntry).toEqual(entry);
  expect(reopened.baselineJournalRevision).toBe(5);
});
```

Define `openEditDraft(existing: JournalDraft | undefined, entry: JournalEntry, journalRevision: number): JournalDraft` in journal-state; returns existing unchanged when same entry key, otherwise creates edit key and captures an immutable copy of entry and revision. Never mutate a cached entry object to hold own draft. Unit tests must additionally exercise `useJournal` through rendered App: open edit/delete on5; remote PATCH gives6; focus GET receives6; close/reopen and Back return own draft; submit/confirm request still sends5 and409. Only explicit show-current/accept action or newly opened confirmation moves6, with a new operationId and separate submit. API tests use mocked fetch and assert strict output rejection, contract2 header, literal URL encoding, entry GET absence of search, uncertain write envelope preserved. Run `npx vitest run tests/client/journal-api.test.ts tests/client/journal-state.test.ts tests/client/journal-context.test.tsx` RED. In journal-context.test.tsx use renderHook with rerender of exact JournalContext union and independent literal empty page0/tree0 fixtures:

```ts
const inactive = (reason: JournalInactiveContext['reason']): JournalContext => ({
  status: 'inactive', reason, onAuthRequired: vi.fn(),
});
const active = (tree: ProjectTree): JournalContext => ({
  status: 'active', projectId: tree.project.id, taskId: null,
  today: '2026-10-09', projectQuery: {}, planningTree: tree,
  planningDirty: false, planningUncertain: false, planningBusy: false,
  applyCleanTree: vi.fn(() => true), onAuthRequired: vi.fn(),
});
const view = renderHook(({ context }: { context: JournalContext }) => useJournal(context),
  { initialProps: { context: inactive('auth-loading') } });
view.rerender({ context: inactive('signed-out') });
view.rerender({ context: inactive('no-projects') });
expect(api.journalProject).not.toHaveBeenCalled();
view.rerender({ context: active(treeA) });
await waitFor(() => expect(view.result.current.projectFeed?.page?.projectId).toBe(treeA.project.id));
let key: JournalDraftKey | null = null;
act(() => {
  key = view.result.current.openCreate(treeA.project.id, treeA.tasks[0]!.id, '2026-10-09');
});
if (!key) throw new Error('Expected active synthetic draft key');
act(() => view.result.current.changeDraft(key!, { body: 'Synthetic A draft' }));
const calls = vi.mocked(api.journalProject).mock.calls.length;
view.rerender({ context: inactive('project-loading') });
expect(view.result.current.active).toBe(false);
expect(view.result.current.getDraft(key)?.body).toBe('Synthetic A draft');
await act(async () => expect(await view.result.current.submit(key!)).toBe(false));
expect(vi.mocked(api.journalProject).mock.calls).toHaveLength(calls);
expect(api.journalCreate).not.toHaveBeenCalled();
view.rerender({ context: active(treeB) });
await waitFor(() => expect(view.result.current.projectFeed?.page?.projectId).toBe(treeB.project.id));
view.rerender({ context: inactive('project-loading') });
view.rerender({ context: active(treeA) });
expect(view.result.current.getDraft(key)?.body).toBe('Synthetic A draft');
act(() => view.result.current.clearPrivateState());
view.rerender({ context: inactive('signed-out') });
expect(view.result.current.drafts.size).toBe(0);
expect(view.result.current.pending).toBeNull();
```

Snippet imports renderHook/act/waitFor from Testing Library, vi/expect from Vitest, api/useJournal/types from the specified files. `treeA` is literal existing optionalTreeFixture at revision0; `treeB` is a copy with distinct project UUID and all task projectIds updated, not derived by journal code. Mock api.journalProject with literal empty JournalPage for the supplied ID at revisions0; mock journalCreate and tree reads with spies. Add deferred response A completing after inactive/B and after clearPrivateState: neither publishes a feed/focus or recreates drafts. Rendered App fixture independently exercises login with no projects → create/loadA → draftA → null loadingB → B → A, confirmed/canceled logout, and authenticated401; canceled logout preserves state, confirmed/401 wipes it without Hooks warnings or stale authenticated content. Assertions include edit/delete pinned baselines as well as create draft text.


- [ ] **Step 2: Implement RAM draft store, locked mutation/retry and shared invalidation.**

Start journal-state/useJournal with keyed drafts: task/create, project modal/create, entry/edit; no storage APIs. Untouched date initializes project today, never schedule; dateTouched/dirty prevents midnight rollover replacement. Clear nonempty requires existing confirmation UI. Submit button and Ctrl/Cmd+Enter call same handler; validate via Task1 shared schemas before generating operation UUID. Saved draft snapshot, full exact envelope, method/route and key enter pending before request. Writing disables duplicate/competing journal/planning writes/delete/Undo for current project; planningBusy/uncertain disables starting a competing journal write. Dirty planning draft alone may remain while same-task journal is used. Existing entry taskId is immutable in changeDraft and validated before submit; create taskId must be in revision-matched metadata. Any uncertain error keeps pending immutable, editor mutation and task/project navigation blocked, explicit retry uses original envelope. Ordinary400/409 retain text/date;409 loads current info without auto rebase. Ack clears only matching sent draft; later data gets GET, never insert old frozen ack/current revision downgrade. Project and task feed share invalidation generation after ack/lifecycle. App calls refresh after successful current planning writes/Undo so branch deletion/restoration invalidates both feeds; frozen planning replay is also followed by current journal read. No journal write itself calls planning tree reload; metadata mismatch may trigger separate guarded read. 401/completed logout clear private state.

J02 independent timezone fixture in journal.test.tsx uses existing useProjectToday and `vi.useFakeTimers()`/`vi.setSystemTime`, not production todayInZone as expected-value oracle. Set the unit fixture's browser/default zone with `vi.stubEnv('TZ', 'UTC')` and assert `Intl.DateTimeFormat().resolvedOptions().timeZone === 'UTC'` and project `Europe/Moscow`; at fixed `2026-10-08T22:30:00Z`, both task-create and project-modal-create default literally `2026-10-09`. Use a Date.toISOString/server-independent assertion to verify body submits workDate09, never UTC08. At `2026-10-09T22:30:00Z` dispatch window focus/visibility; untouched empty drafts become literally `2026-10-10`. On independent drafts set explicit date `2024-02-29`, dirty body with initial date09, and cleared date `''`; after the same boundary they respectively remain `2024-02-29`, `2026-10-09`, and `''` (clearing sets dateTouched=true and blocks submit). Changing project timezone to UTC at fixed `2026-10-09T22:30:00Z` gives untouched default `2026-10-09`, while touched/dirty/cleared dates stay unchanged. Explicit confirmed «Очистить черновик» removes that key; reopening starts a new untouched draft at current project today. Separate browser case sets Playwright context timezone `America/Los_Angeles` with project Moscow and `page.clock.install({time: new Date('2026-10-08T22:30:00Z')})`; expected date09 proves project timezone rather than browser08. Restore fake timers and `vi.unstubAllEnvs()` after each fixture.

Tests cover isolated key drafts through tabs/dialogs/projects; after lost response retry same JSON/ID; edited other draft not erased; frozen ack older known revision does not resurrect deleted entry. Assert create/edit errors, detached task, pending locked navigation/Undo, beforeunload/logout loss confirmation and caches cleared. Spy localStorage/sessionStorage setters; URL/history contain IDs only; textarea Enter newline and Cmd/Ctrl+Enter validation; no plan command requested by journal. Run draft/state/API suites GREEN.

- [ ] **Step 3: Implement revision-matched guarded reads without changing dirty plan baselines.**

Each GET carries identity `{projectId,taskId,normalizedFilters,generation}`; latest request token wins, canceled identities never publish or restore focus. Maintain monotonic known journal and project revisions. Page+metadata equality gates cards/title buttons/paths/picker/task header; unknown IDs at unequal revisions are pending, not deleted. At equal revision unknown ID gives integrity metadata-error, no blank title/current link. Journal repository read never invokes tree; client mismatch fetches existing api.tree separately.

Reconciliation sequence: keep pendingPage; if planningTree revision equals page and not below known revision, use its tasks. Otherwise guarded tree GET; preserve fetched `{projectId,revision,tasks}` as read-only metadata if planningDirty/uncertain, leaving App treeRef, selected dirty task, TaskPanel baseline/submitted envelopes and quick drafts untouched. Clean apply uses applyCleanTree without project-switch reset. If metadata newer, discard pending page/cursor and refetch first page with same filters; if metadata older refetch tree. Initial attempt plus at most two additional reconciliation attempts; continued race marks last coherent feed stale with «Данные изменились; обновите журнал», links/picker disabled. Initial mismatch/errors keep pendingPage, drafts and show loading/metadata-error; explicit refresh restarts. Do not blend revisions or lower known state.

Refresh stores first-visible ID/group/offset and both scroll axes; may load successive pages until old anchor recovered, then restore nearest surviving group/start when absent, filters unchanged. Append requires same revisions/scope, dedup ID, join overlapping date groups. Stale cursor preserves current rows and offers refresh; load-more error preserves visible entries. Remote removed selected dirty task uses existing removed state and copyable text, clean removed selection clears without moving feed. Window focus/visibility refresh journals; no cross-tab push.

Independent coherence fixture table in `journal-coherence.test.tsx`: remote rename/move with dirty planning draft; nested new task+entry unknown old tree; page6/tree7→new page7; page7/tree6→new tree7; delete between reads; tree error; three-attempt race; equal revision missing task; late previous-project/filter response. Assert matched title/path/picker and headers only, exact original plan/journal baselines/envelopes, selection/filter/collapse/scroll preserved, no plan command issued; editor/delete pinned5 despite page6. Component tests use literal fixtures/deferred promises, not scheduler output.

- [ ] **Step 4: Build feeds/editor/picker with distinct usable states.**

Shared JournalFeed date groups render full workDate as calendar day without timezone parse/time; cards render plain escaped React text with `white-space: pre-wrap; overflow-wrap: anywhere`. Date/body edit does not alter createdAt-based ordering except date group. Project shows current task-title button and edit/delete menu; TaskJournal only direct entries, body/date editor and load-more. ProjectJournal controls search/period (clearable inclusive from/to) and add dialog picker; no task statuses/dates cutoff. Show empty project disabled add explanation; distinguish empty feed/no-match/loading/initial error/more-error/stale/metadata-error/removed/conflict/uncertain. Filtered success states «Запись сохранена; она не подходит под фильтр», retains filters. Constant copy: «Записи редактируются и удаляются отдельно; отмена в шапке относится к плану».

JournalTaskPicker searches current title/full ancestor path from matched metadata, includes summary/done/undated; same titles have unique paths. Bounded list keyboard ArrowUp/Down/Enter, Escape returns trigger; picker/menu/delete events stop row selection/drag bubbling. Editor date uses existing CalendarDateInput/calendar schema and useProjectToday. Aria-describedby validation + live status; no interpretation of links/HTML. Dialog native showModal/focus trap/aria-modal/role; Cancel/Escape preserves drafts, restores trigger/add fallback. Modal locks only appropriate body overflow with scrollbar compensation (save/restore inline previous styles; no scroll-to-top); background feed remains mounted. Successful refresh restores anchor/offset before closing returns focus; delete confirms one entry and returns next/previous menu/add.

Implement scoped CSS following existing light tokens/compact right panel, four tabs one accessible overflowing row. Component tests cover 10001 units, whitespace, safe HTML/Unicode/newlines, period bounds, all states and disabled semantics, Ctrl+Enter, focus trap/return, full path and no accidental submission. Browser geometry is asserted in Task3; jsdom geometry is not proof.

- [ ] **Step 5: Integrate stable project tabs, common row menu and navigation.**

ProjectViewTabs under header: «Задачи / Журнал» tablist, ArrowLeft/Right/Home/End, controls row equal reserved height in both views, active panel relationship. Existing task filter/list-Gantt control remains in tasks; journal search/period occupies same header/controls space. Keep Undo in both views and rename accessible label/tooltip to «Отменить изменение плана»; Ctrl/Cmd+Z outside inputs uses existing planning path, inside textarea native undo. TaskPanel fourth tab `journal` uses journalContent while its existing detail/source/predecessor state stays mounted on same task. Existing selected task/project dirty guards still control navigation to different IDs; changing tab on same task does not discard or rebase detail plan. TaskTree sibling ⋯ reserves space without title movement; hover/focus-within and no-hover rules mirror ProjectSidebar. Menu «Открыть задачу», «Добавить запись», «Добавить подзадачу»; no menu for draftTaskId; original Shift+Enter and add action remain. Pass onJournal through main Timeline and shared panel subtask tree; closes menu and opens task/journal textarea with guarded focus.

Update the existing common branch-delete action in App.tsx:806 and strings.deleteConfirm; both main TaskTree and panel shared subtask tree use this same guarded action. Confirmation copy is exactly «Удалить задачу и все её подзадачи, включая записи журнала этой ветки? Записи можно восстановить доступной отменой плана. Восстановление недоступно после удаления истории отмены или изменений плана другой сессией». Do not add a journal count endpoint. Keep native window.confirm (current behavior): Cancel/Escape returns focus to initiating tree/menu action, sends no plan/journal request and retains branch/notes/selection/drafts; Enter confirmation invokes one task.delete through existing command/retry path. Client tests spy window.confirm for both tree paths, assert exact warning, false produces zero mutations and focus/keyboard actions remain usable. Browser task-journal suite triggers deletion from the focused tree/menu with its keyboard action and handles native dialog Cancel/Escape semantics via dismiss, verifies return focus and zero writes, then accepts confirmed nested delete→eligible plan Undo restores original entry IDs/date/body; a surviving task's later note remains. Assert warning mentions bounded eligibility, never unconditional restoration.

Use timeline mounted hidden for task/journal switch (hide DOM with hidden/inert as needed so it is not keyboard accessible). Export/restoration TimelineViewState only for visit history, preserving current period/scale/start/width/filter-collapse/scroll. App session visit map stores collapse/filter/showGantt/selection/tab, panel origin trigger and first-visible journal anchor, not browser storage. Explicit project switch new default tasks; Back/Forward stored visit restores filters/scroll and surviving task. Project title link opens task journal panel atop unchanged project feed; close returns origin title if present. Unknown/foreign task URL never selects another project task; unknown project safe unavailable/return-to-projects state; initial URL validates UUIDs/enums and loads only after authenticated session.

History writes namespaced version1/visitId only; URL same-origin `?project=UUID&view=tasks|journal&task=UUID&panel=details|subtasks|dependencies|journal`. Dirty planning or unresolved journal popstate restores previous URL/history position, shows unsaved/retry, retains all baselines. Ordinary journal dirty draft remains RAM across visits. Use visit index in RAM to reverse a disallowed Back/Forward, suppress matching restoration popstate to avoid loops; no draft/body/query/credentials in state. Explicit navigation/manual focus cancels late async restoration.

Independent navigation tests assert normalized URL validation, auth gating, unknown IDs, project defaults, nested visits Back/Forward, blocked popstate restores position, mounted quick draft, Gantt two axes/filter collapse/scale, title opens panel on same journal, close origin focus, stale async focus cancellation. Update existing mocked fetch setups only with legitimate empty journal DTOs when called; do not mask unexpected requests. Run all client suites.

- [ ] **Step 6: Run client/server regression and freeze Task2 candidate.**

Run `npm run typecheck`, `npm run lint`, `npx vitest run tests/client`, `npm run format:check`, `npm run check:kit`, `git diff --check`. Rerun server seam tests only if this task changes server/shared files. Full verify/build/E2E/package regression belongs to Task3. Record implemented J13–J16 client fixtures in UI/STATUS, and browser acceptance still NOT RUN until Task3. Stage explicit Task2 files, run staged privacy, freeze immutable candidate; independent spec/standards reviews examine pinned revision and dirty planning cache seams as well as UI/keyboard states. Fix/retest reviewed findings, coordinator commit `feat: add task and project journal workspace`. No new shared/server contract fields without coordinated Task1-compatible correction.

### Task 3: Browser Acceptance, Full Regression, Privacy and Final Handoff

**Deliverable:** Browser evidence at both required resolutions, complete application/package/privacy gates, final reviewed implementation and honest documentation. No new feature scope, production migration, deployment or public export format.

**Files:**

- Create: `tests/helpers/journal-e2e.ts`, `tests/e2e/task-journal.spec.ts`, `tests/e2e/journal-navigation.spec.ts`, `tests/e2e/journal-drafts.spec.ts`.
- Extend affected tests/components only for reproducible acceptance failures; changes to shared/schema/storage use same writer/coordinator and rerun Task1 seam tests.
- Modify: `README.md`, `docs/UI.md`, `docs/ARCHITECTURE.md`, `docs/ACCEPTANCE.md`, `docs/STATUS.md`, `docs/BOOTSTRAP.md` only where current schema/API/run instructions require it. ADR014/DECISIONS retain D21 working status; do not recast it as a new C decision.
- Existing test infra: `scripts/e2e-server.ts`, `tests/helpers/optional-e2e.ts`, `playwright.config.ts`, Dockerfile; do not weaken retries/workers/trace/privacy policy.

**Interfaces:** Consumes Task1 public schemas/routes and Task2 accessible controls/navigation. `tests/helpers/journal-e2e.ts` exports `createJournalEntry(page: Page, origin: string, projectId: string, taskId: string, revision: number, body: string, workDate: string): Promise<JournalMutation>` and `readJournalPage(page: Page, origin: string, projectId: string): Promise<JournalPage>`; tests use actual authenticated syntheticRuntime and return DTOs, not journal DOM reconstruction. Browser fixtures must never use production sessions/storage; each closes runtime in finally. Public screenshots/assets are not added.

- [ ] **Step 1: Add real browser CRUD/reopen/geometry tests, observe RED before fixes.**

Seed using syntheticRuntime/seedOptionalRuntime and authenticated API to create summary/done/undated/deep tasks and125 records. Exercise UI task create, project edit/date movement/delete, persisted after reload/server reopen, search Russian text/current title/literal `%/_`, inclusive period, load-more/group boundary, removed task, and no current tree date/status/revision/CPM changes from journal write. API helpers include Origin + contract2, use server UUID, no raw cookie output. Test runtime teardown mirrors existing fixture.

Representative complete modal-geometry assertion body (test defines `runtime`, seeds entries and navigates to project journal first):

```ts
import { expect, type Page } from '@playwright/test';
async function feedGeometry(page: Page) {
  return page.getByRole('tabpanel', { name: 'Журнал проекта' }).evaluate((node) => {
    const scroll = node.querySelector<HTMLElement>('[data-journal-scroll]');
    const first = node.querySelector<HTMLElement>('[data-journal-entry-id]');
    if (!scroll || !first) throw new Error('Missing synthetic journal DOM');
    const r = first.getBoundingClientRect();
    return { top: scroll.scrollTop, left: scroll.scrollLeft,
      x: r.x, y: r.y, width: r.width };
  });
}
async function assertModalKeepsPosition(page: Page) {
  const feed = page.getByRole('tabpanel', { name: 'Журнал проекта' });
  await feed.locator('[data-journal-scroll]').evaluate((node) => { node.scrollTop = 720; });
  const before = await feedGeometry(page);
  await page.getByRole('button', { name: 'Добавить запись', exact: true }).click();
  await expect(page.getByRole('dialog', { name: 'Добавить запись' })).toBeVisible();
  expect(await feedGeometry(page)).toEqual(before);
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog', { name: 'Добавить запись' })).toBeHidden();
  expect(await feedGeometry(page)).toEqual(before);
}
```

Task2 adds stable `data-journal-scroll` and `data-journal-entry-id` markers for anchor/geometry semantics. Also measure header/controls/card bounding boxes; repeat Cancel, Escape and successful save on a long scrolled feed at both Playwright projects. For save prepends shifting DOM, compare first-visible entry ID and viewport offset, not raw scrollTop alone; toolbar/card width unchanged. Verify panel narrow/long paths/body wrapping, tab overflow keyboard, native dialog trap/focus return, menu/picker Arrow/Escape, add from nested subtask menu and no accidental drag/selection.

Run `npm run test:e2e -- tests/e2e/task-journal.spec.ts`; acceptance failures are fixed with client/server regression tests first, then browser rerun. No skipped scenarios/retries introduced.

- [ ] **Step 2: Add navigation/two-client conflict/uncertainty browser acceptance.**

Journal navigation browser tests store task/Gantt/filter/scale/period/collapse/two-axis scroll → project journal → open title panel → close → tasks; compare stable vertical header geometry and restored state. Use a second authenticated synthetic context to rename/move/create nested task+entry, refresh first via focus while its plan/detail draft dirty, assert coherent labels/path/picker and original draft/baseline/selected task unchanged. Exercise tree/page interleaving via bounded route delay with actual server responses (no production data); mismatch/delete/error/race keep correct stale/error state, draft and anchors, no plan writes. Back/Forward restores visits and refuses dirty planning/unresolved operation navigation without losing history position; reload validates URLs, auth denies journal.

Pinned browser fixture: contextA opens entry at journal5, edits own text/date; contextB writes6; focusA GET6; close/reopen and Back restore original pinned5; A submit409 leaves B body intact and own draft. Repeat delete confirmation5 after background6; explicit fresh confirmation/keep-own action moves baseline only after user choice. Lost-response route lets POST/PATCH/DELETE reach server then drops first response; retry same operation UUID produces one effect after reopen, including later remote deletion/frozen ack; UI current list never resurrects stale object. Mutation locks Undo/other write/navigation, Ack clears matching draft only. Draft RAM isolation/modal/tab/project, clear confirmation, beforeunload/logout confirmation and private state erased after logout/401; assert no body/date/search/draft in browser storage/URL/history.

Run targeted navigation/draft specs in both resolutions; the single full `test:e2e` run is Step3 after final fixes/docs. Existing Gantt/FS/optional migration/legacy client/demo scenarios remain required; no chart/scheduler regressions accepted.

- [ ] **Step 3: Finish docs and run full fixed-candidate checks.**

Document journal routes/schema4, separate plan Undo label/branch deletion limits, RAM drafts/exact retry/pinned revision, search/date/page behavior and future S5 active-journal export requirement. SQL backup private includes active journal/state/replay/sidecar; no public export implemented. Update acceptance with J01–J16 executable evidence paths/results. STATUS lists actual touched areas/test counts/PASS/FAIL/NOT RUN and limitations, not transcripts/private paths. S4–S6 remain unfinished; do not claim first release/demo deployment.

Run on final implementation candidate:

```sh
npm run verify
npm run test:e2e
npm run format:check
npm run check:kit
npm run check:package
npm run security:workspace
npm run security:staged
npm run security:history
npm run preflight
git diff --check
```

`verify` includes typecheck/lint/all unit+integration/build. Check `test:unit`/`test:integration` file lists against the new test filenames; there is no need to repeat the same green full suites solely for script registration. Task3 runs one full verify and one full E2E on the final new state; rerun only after changes/failures. Use pinned runtime from .nvmrc; no install. Stage explicit changed paths before staged scans. Linked worktree preflight may reject its `.git` pointer: record FAIL/environment limitation and run ordinary checkout preflight through coordinator, never weaken guard. If Docker daemon is available, build existing production container locally and synthetic fresh/reopen schema4 runtime smoke; otherwise state NOT RUN/Docker unavailable, no invented pass. No browser artifacts committed. No remote pushes/deployments.

- [ ] **Step 4: Freeze final candidate, reviews, commit and owner handoff.**

Freeze tree/commit after checks; independent spec and standards reviews cover entire diff and J01–J16 evidence, with focused scrutiny on lifecycle digest completeness, pinned baseline, coherent metadata/dirty plan, security and modal geometry. Repair/retest findings without new approval; repeat impacted checks only. Coordinator commits `test: verify task journal browser acceptance and handoff` after Task3 reviews PASS, then whole-branch reviewers assess immutable final candidate. If reviews cause changes, rerun affected application/privacy checks, update factual STATUS, freeze again. Ordinary checkout final preflight and staged/history gates must be reported distinctly from linked-worktree limitation. Final Russian handoff: implemented behavior, commits, passed checks, failed/not-run constraints, next S4 work; no runtime/publication authorization implied.

## Plan Self-Review and Execution Handoff

Coverage: Task1 owns J01–J12 plus demo server portion J16; Task2 owns full working J13–J16 and client portion J02/J04/J07/J12; Task3 independently proves browser geometry/navigation/drafts and complete regression/privacy. Inactive/auth/project-loading/null transitions have an explicit discriminated hook context, no conditional hooks or fake tree, and preserve RAM drafts until explicit logout/401 clearing. Common branch-delete warning covers main/subtask trees and bounded journal restore. J02 specifies literal Moscow dates at UTC/browser-zone boundaries, including untouched/touched/dirty/cleared drafts. Public DTOs use journalContractVersion1 beside transport contract2; TaskPanel union/history panel values consistently include journal; controller keys and sent envelopes stay independent of planning. Snapshot lifecycle version0/1, mandatory zero-entry manifest, exact digest/count and current surviving notes are explicit. Fresh/schema3/schema2 gate/future/gap, archive/frozen byte preservation, package allowlist and test registration have concrete owners.

Implementation order is Task1→Task2→Task3 with separate independent spec/standards review gates. The owner already chose subagent-driven execution and authorized the full local cycle; coordinator proceeds using that skill without asking the execution-choice question again. This plan does not itself assert application completion or executable test success.
