# Journal Media Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Реализовать компактный редактор журнала с картинками между абзацами, ссылками и скачиваемыми файлами с сохранением данных при ошибках и plan Undo.

**Architecture:** Ограниченный rich JSON проверяется независимо сервером; Tiptap используется только в editor adapter, лента выводится React renderer. BLOB, references, upload identity, replay и Undo находятся в одной SQLite. Upload и journal publication разделены; solver не участвует.

**Tech Stack:** TypeScript, React19/Vite, Fastify5, better-sqlite3, Zod; Tiptap3.34.0 MIT, @fastify/multipart10.1.8 MIT, sharp0.35.5 Apache-2.0. Exact versions получены из официального npm registry 2026-11-14; перед установкой проверить pack metadata/scripts и полную зависимую лицензионную цепочку.

**Spec:** [C34/D29](../specs/2026-11-14-journal-media-design.md), [ADR016](../../adr/016-journal-rich-content-media.md). Спецификация прошла независимые Standards/Spec/Technical PASS на615bbe7 и итоговом2b99234; владелец поручил продолжить реализацию.

## Global Constraints

- Один writer, текущая ветка `feat/journal-media`, без дополнительных worktree, push/merge/deploy.
- Node24.21.0/npm11.19.0; один пакет, React19/Fastify5/SQLite, без облака/telemetry/CDN/AI/ORM/state framework.
- Source картинки10MiB; файл25MiB; output25MiB;20M pixels/16384px; один статический PNG/JPEG/WebP преобразуется в lossless WebP без metadata.
- До10 различных файлов/50MiB на запись; staged64MiB на session/project; install512MiB;TTL24h; upload concurrency2/60 attempts per minute; чтение30s/decode10s.
- Multipart один file/два fields/три parts, fieldName32/fieldValue64/headerPairs32; aggregate25MiB+16KiB. Auth/origin/admission до bytes; остальные routes JSON-only64KiB.
- Документ48KiB/1000nodes/depth12/list nesting4; projection10000UTF16/30000UTF8; только paragraph/text/hardBreak/bulletList/orderedList/listItem/journalImage/journalFile, marks bold/link HTTP(S).
- Никаких произвольных HTML/src/data/base64 в authoritative content; safe React renderer и scoped cookie-auth binary GET/no-store/nosniff; CSP только self/blob images.
- Existing plain bytes, frozen v1 payload/response/digest, lifecycle0/1 и C17 gate сохраняются; live journal2/новый cursor2, lifecycle2/manifest/retention/GC и одна backup.
- RAM-only draft/File/Blob, exact immutable retry, guards и две coherent ленты. Нет изменения scheduler/planning DTO или описания задачи.
- Demo upload403 до bytes; прежние JSON budgets. Видеоплеер/link previews/колонки/resize вне объёма.
- Только synthetic runtime/tests. Не читать private runtime/credentials/истории. Не добавлять tracked binary fixtures, не отключать hooks/scanners/skips.

## File Structure

Shared: `journal-content.ts` — bounded schema/projection/adapter; `journal-media-contracts.ts` — metadata/upload limits; `journal-contracts-v2.ts` — новые transport schemas. Existing `journal-contracts.ts` остаётся точным v1 compatibility.

Server: `journal-media-repository.ts` — stage/ownership/relations/GC; `journal-media-routes.ts` — bounded streaming/auth/download; `journal-image.ts` — bounded decode/normalization; `journal-repository-v2.ts` — live rich CRUD/read/replay; existing `journal-repository.ts` — v1 compatibility; `journal-lifecycle.ts` — общий versioned lifecycle seam. Migration005/database startup и packaging подключаются отдельно от старых миграций.

Client: `JournalRichEditor.tsx` — Tiptap adapter; `journal-upload-state.ts` — RAM upload records/identity; `JournalRichBody.tsx` — safe renderer/preview/viewer; `JournalEditor.tsx` — общий composer/date/actions. Existing controller/feed/focus seams расширяются адресно; второй controller не создаётся.

Tests: новые suites `journal-content.test.ts`, `journal-media.test.ts`, `journal-media-api.test.ts`, `journal-v2.test.ts`, `journal-media-lifecycle.test.ts`, `journal-media-migration.test.ts`, client `journal-rich.test.tsx`/`journal-uploads.test.tsx`, E2E `journal-media.spec.ts`.

### Task 1: Bounded content, contracts, dependencies and additive storage

**Files:** Create shared `journal-content.ts`, `journal-media-contracts.ts`, `journal-contracts-v2.ts`, `migrations/005-journal-media.sql`, `tests/journal-content.test.ts`, `tests/journal-media-migration.test.ts`. Modify `package.json`, `package-lock.json`, `src/server/database.ts`, `.dockerignore`, `scripts/package-check.mjs`, existing migration fixtures only where current schema count changes.

**Interfaces:** Produces `JournalContent`, `JournalDocument`, `JournalNode`, `JournalMedia`, `journalContentSchema`, `journalDocumentSchema`, `journalMediaSchema`, `journalCreateV2Schema`, `journalUpdateV2Schema`, `journalDeleteV2Schema`, `journalEntryV2Schema`, `journalMutationV2Schema`, `journalPageV2Schema`, `journalEntryReadV2Schema`; inferred matching types. Pure helpers `collectJournalMediaIds(content): string[]`, `projectJournalContent(content, media): string`, `plainTextToJournalDocument(text): JournalDocument`. New005 active at startup; v1 runtime remains intact until Task3.

- [x] Write RED tests for rich media-only validity, malformed nodes/attrs/depth/URL/Unicode/size, literal projection and legacy conversion; test migration exact bytes/history and schema5 reopen.

```ts
expect(projectJournalContent({format:'rich-text',documentVersion:1,doc:{type:'doc',content:[{type:'paragraph',content:[{type:'text',text:'Проверка'}]}]}}, [])).toBe('Проверка');
expect(journalContentSchema.safeParse({format:'rich-text',documentVersion:1,doc:{type:'doc',content:[{type:'iframe'}]}}).success).toBe(false);
```

- [x] Run `npx vitest run tests/journal-content.test.ts tests/journal-media-migration.test.ts`; preserve RED evidence.
- [x] Review registry package metadata/licenses/scripts, pin Tiptap core/react/pm/starter-kit3.34.0 and necessary OSS extensions at same version, multipart10.1.8/sharp0.35.5; install via reviewed npm policy, no broad script allow. Confirm native decoder on a generated1×1image.
- [x] Implement strict schemas with prewalk limits and deterministic projection; keep unknown fields rejected and v1 validators unchanged. Media node UUID references resolve only through supplied server metadata; missing metadata is an error, not a silent omission.

```ts
export type JournalContent = {format:'plain-text';text:string} | {format:'rich-text';documentVersion:1;doc:JournalDocument};
// Live mutation accepts content, never a client-authored search projection.
const envelope = {journalContractVersion:z.literal(2),operationId:uuidSchema,expectedJournalRevision:z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER)};
```

- [x] Add005 columns/media tables/live relations/Undo relations/tombstone fields and version2 manifest fields. Rebuild journal_operations CHECK to accept1/2 while byte-copying old rows. Media task scope has no cascade FK to tasks; project deletion cascades, active/Undo relations pin BLOB. Advance database supported count and packaging allowlist to005. New snapshots still lifecycle1 until Task3.
- [x] Run typecheck/lint, focused tests and full unit/integration once; preserve historical fixtures as literal old SQL, change only expected current migration count. New suites explicitly included in npm scripts. Update STATUS and commit scoped deliverable.

### Task 2: Bounded upload, private downloads and media lifetime

**Files:** Create `src/server/journal-media-repository.ts`, `journal-media-routes.ts`, `journal-image.ts`, `tests/journal-media.test.ts`, `tests/journal-media-api.test.ts`. Modify `src/server/app.ts`, `package.json`, STATUS; no journal2 switch yet.

**Interfaces:** Consumes Task1 content/metadata/005. Produces `JournalMediaRepository(db, now?)`, `stage({projectId,taskId,sessionId,uploadId,kind,fileName,bytes}): Promise<JournalMedia>`, `read(projectId,taskId,mediaId,sessionId): {media:JournalMedia;bytes:Buffer}|undefined`, `metadataForEntry(entryId): JournalMedia[]`, `attach(entry:{id:string;projectId:string;taskId:string},content:JournalContent,sessionId:string): JournalMedia[]` inside caller transaction, `collectGarbage():number`. Upload ready metadata includes mediaContractVersion1/uploadId separately from public JournalMedia. Capture/verify helpers for Task3 may be exported from media repository with concrete types documented in task report.

- [x] Write RED independent DB/API tests for one stage+same retry, different retry409, stage TTL410, cross-scope reads404, home-entry reuse refusal, quota/concurrency/streamlimits and auth/origin before body.

```ts
const a = await media.stage({...scope,uploadId,kind:'file',fileName:'example.txt',bytes:Buffer.from('synthetic')});
const b = await media.stage({...scope,uploadId,kind:'file',fileName:'example.txt',bytes:Buffer.from('synthetic')});
expect(b.id).toBe(a.id);
expect(db.prepare('SELECT count(*) AS n FROM journal_media WHERE bytes IS NOT NULL').get()).toEqual({n:1});
```

- [x] Run focused RED. Implement image normalization with magic/format/pixels/dimensions/animation validation, sharp timeout10s and lossless WebP/auto-orientation/no metadata. Generic files remain exact bytes/octet-stream.
- [x] Implement stage with bounded immutable source identity, decode outside write transaction, task/session recheck+quota in IMMEDIATE, one BLOB, tombstone410 and hash verification; no journal/planning revision writes. Attach validates all IDs before atomically reconciling live references/home entry. GC checks live/Undo references and24h in one transaction.

```ts
if (existing && existing.sourceSha256 !== sourceSha256) throw new DomainError('MEDIA_UPLOAD_REUSED','Идентификатор загрузки уже использован.',409);
if (existing && existing.bytes === null) throw new DomainError('MEDIA_UPLOAD_EXPIRED','Загрузка устарела. Повторите прикрепление файла.',410);
```

- [x] Register multipart encapsulated routes `/api/projects/:id/tasks/:taskId/journal-media` and GET media/download; exact route exception to JSON-only guard, session+origin+contract+admission onRequest, explicit aggregate counting including chunked, timeout/part limits, no temporary path writes. Add only CSP img self/blob. Demo403 before bytes. Download no contract header, private ACL, safe headers/names and no SPA fallback.
- [x] Run typecheck/lint/focused tests and full unit/integration once, existing API/security/demo regressions. Update STATUS and commit. Preserve test evidence without raw cookies/file contents/logs.

### Task 3: Live journal2, historical replay, lifecycle2 and backup

**Files:** Create `src/server/journal-repository-v2.ts`, `tests/journal-v2.test.ts`, `tests/journal-media-lifecycle.test.ts`. Modify `src/server/app.ts`, `journal-repository.ts` only frozen compatibility seam, `journal-lifecycle.ts`, `repository.ts`, backup tests and existing journal API fixtures/headers with explicit v1 compatibility cases preserved.

**Interfaces:** Consumes media stage/attach/metadata/GC. Produces `JournalRepositoryV2(db, now?)` getProjectPage/getTaskPage/getEntry/create/update/delete matching existing signatures with V2 DTO/types. Lifecycle supports0|1|2 and full content/media sidecars. Existing direct v1 repository may remain for historical tests/compatibility but HTTP new effects require2; there is no active v1 UI path.

- [x] RED tests: media-only entry, missing last media rollback, projection/name search, stale conflict, replay after restart/edit/delete, v1 frozen retry vs new v1 mutation426; exact legacy date-only body and cursor2.

```ts
expect(after.projectRevision).toBe(before.projectRevision);
expect(after.journalRevision).toBe(before.journalRevision+1);
expect(retried).toEqual(firstAcknowledgement);
```

- [x] Implement V2 CRUD/read/replay in IMMEDIATE/read transactions. Derive body and media refs server-side, publish one revision, strict validate frozen acknowledgements without consulting current media. V1 replay lookup retains original canonical input/digest validation before current-row lookup; new v1 effects426. Dispatch six routes by x-leaf-journal-contract-version2 with matching mutation version; API GET old header426, binary GET unchanged.
- [x] RED tests for task delete/Undo exact content/bytes, surviving journal edit, media-only late-entry conflict, missing/changed BLOB/sidecar/empty manifest, historical0/1 restore and pruning/GC. Synthetic backup includes live/staged/Undo and is reopened independently.

```ts
expect(restoredEntry.content).toEqual(originalEntry.content);
expect(restoredBytes).toEqual(originalBytes);
expect(() => repository.mutate(projectId,undoCommand,sessionId)).toThrow();
expect(readAllRelevantRows()).toEqual(beforeFailedUndo);
```

- [x] Implement lifecycle2 manifest and precise private media snapshots, active relations capture/restore, pinning and actual BLOB hash verification. New planning snapshots version2, old0/1 digest untouched. No solver changes or media in frozen plan DTO. Task deletion/Undo updates journal revision under existing rules.
- [x] Run focused tests then full unit/integration/typecheck/lint. Until Task4 UI switches, retain a clearly documented temporary migration boundary in STATUS; do not claim feature complete. Commit server deliverable.

### Task 4: Compact rich editor, RAM uploads, both feeds and focus

**Files:** Create `src/client/JournalRichEditor.tsx`, `journal-upload-state.ts`, `JournalRichBody.tsx`, client rich/upload tests. Modify `journal-state.ts`, `use-journal.ts`, `api.ts`, `JournalEditor.tsx`, `JournalFeed.tsx`, `TaskJournal.tsx`, `TaskPanel.tsx`, `ProjectJournal.tsx`, journal CSS and affected synthetic client fixtures.

**Interfaces:** Consumes strict V2 JSON API and scoped binary upload. Produces shared `JournalEditorHandle {root:HTMLElement;focus():void}`; draft content+RAM upload record generation and source File/Blob owned by existing controller; safe read renderer consumes content/media. Keep old v1 response support only for frozen acknowledgements and exact plain baselines. Body may remain derived convenience for old callers, not a second authoritative rich state.

- [x] Inspect three approved PNG; RED tests for plain date-only baseline, rich draft dirty/submit, upload error/retry/uncertain/late generation, separate tasks, removal+local Undo, clear/401/logout, duplicate file+HTML, image-only, clipboard/drop order and no external fetch.

```ts
expect(controller.getDraft(key)?.content).toEqual(contentBeforeFailure);
expect(controller.getDraft(otherKey)?.content).toEqual(otherContent);
expect(uploadRequestAfterTimeout.uploadId).toBe(uploadRequestBeforeTimeout.uploadId);
```

- [x] Add API V2 header/validators, upload FormData transport and safe status handling. Extend controller immutable snapshot/draft equality/pending/conflict handling to document and upload state. Publish upload result only when private generation/draft/upload block still match; keep File across hidden/remount; clean private resources on clear/401/logout.
- [x] Build Tiptap restricted schema from explicit OSS extensions or disabled StarterKit capabilities; custom atomic journalImage/journalFile nodes with IDs, not persisted src. Plain JSON adapter avoids HTML parsing. Local upload placeholders live in adapter/controller RAM and never reach server schema; replacing ready state does not add a user Undo step.
- [x] Add keyboard/floating toolbar and accessible fallback Format button, title+href popup, attachment button, paste/drop/file chooser and image viewer. Disable Save with visible reason for pending/error uploads; preserve selections and two-row idle/autogrow/date/actions. Prevent editor Z/Tab/IME from reaching plan shortcuts; layered Escape and no stale focus stealing.

```ts
if (event.nativeEvent.isComposing) return;
if ((event.ctrlKey || event.metaKey) && event.key === 'Enter') {
  event.preventDefault();
  if (allUploadsReady) void submit();
}
```

- [x] Safe React rich renderer with deterministic prefix preview4text lines/first media160px, full-order expansion, reserved image dimensions, retry errors and no HTML. Extend existing scroll anchor/focus handles without resetting task/planning drafts or hidden editor state. Demo visibly disables uploads.
- [x] Update client fixtures to valid live V2, keep explicit frozen1 tests. Run focused RED→GREEN, all unit/integration/typecheck/lint/build; address actual regressions, not weaken assertions. Commit functional client.

### Task 5: Browser acceptance, packaging and final validation

**Files:** Create `tests/e2e/journal-media.spec.ts`; extend synthetic helpers only as needed; modify `docs/ACCEPTANCE.md`, `STATUS.md`, `START_HERE.md`, UI/architecture/ADR/decisions to reflect actual implementation; plan checkboxes updated from evidence.

**Interfaces:** End-to-end public API/UI only, actual Fastify/SQLite and generated assets. Consumes all prior tasks; produces factual JM01–JM22 evidence and final immutable candidate.

- [x] Write actual-server browser cases for persisted interleaving/media-only, real paste event file+HTML, links/title/bold/list, drop/picker, reload/download, failed upload/Save response,409, two tasks/drafts, delete/Undo, malformed/unauth/quota boundaries and loading/error/empty. Fixtures literal and isolated, no production data.

```ts
await expect(page.getByRole('button',{name:'Сохранить запись',exact:true})).toBeDisabled();
await expect(page.locator('[data-journal-entry] img')).toHaveCount(1);
await page.reload();
await expect(page.locator('[data-journal-entry] img')).toHaveCount(1);
```

- [x] Run profile in both configured viewports plus375×812/short viewport and keyboard/touch/focus. Native OS clipboard and genuine browser zoom200% use new isolated synthetic profile; report separately from simulated paste/deviceScaleFactor. Physical IME if unavailable remains explicitly unverified.
- [ ] Run `npm run verify`, `npm run format:check`, full `npm run test:e2e`, `npm run check:kit`, `npm run check:package`, staged guard/Gitleaks. Production container build/runtime must exercise sharp/migration005 and backup; if Docker genuinely unavailable record exact limitation without claiming that gate passed.
- [ ] Reconcile JM01–JM22 with exact tests/results, resolve findings, update current docs factually and keep historical failures. One broad final exact-SHA review covers full implementation against spec after task gates. Commit final changes; no push/deploy/merge or branch deletion without owner action.

### Evidence and remaining gates, 2026-11-15

Tasks1–4 выполнены и независимо reviewed PASS: contracts/migration `b14d56b`, media `5415881` + multipart fix `819c6a9`, journal2/lifecycle2 `6cca945` + error-classification fix `770adc2`, editor `bc6853d` + session/paste/Escape fixes `b750053`/`d0b722d`. Исторические RED/GREEN и scoped проверки сохранены в STATUS. Additive006/sourceFileName уточняет original005; SQL history не переписывался. Checkbox implementation не заменяет финальную runtime приёмку.

Task5: новые media browser cases18/18 PASS; actual OS CtrlV и browser zoom200% в fresh headful Chromium/Xvfb PASS. Немедленный Remove→Undo найден RED и исправлен явной границей history; соседний текст и redo проверены. Матрица [JM01–JM22](../../ACCEPTANCE.md#журнал-с-медиа-c34d29--jm01jm22) разделяет слои, browser и ограничения.

- [ ] Production-container build/runtime: native sharp, migration005/006 и backup. NOT RUN: Docker в WSL недоступен; оба явно проверенных Windows engine named pipes отсутствуют. Локальные build/decoder/backup не заменяют этот gate.
- [ ] Physical OS IME. NOT RUN: аппаратная IME недоступна; synthetic isComposing проверяет только guard.
- [ ] Independent Task5 and whole-branch exact-SHA review after final immutable candidate; координатор выполнит отдельно.

## Coverage and Execution

Spec§§1–4/7: Tasks1/3/4; §5: Tasks2/4; §6: Tasks1/2/3; §8: Tasks2/3/4; §9JM01–JM22: Task5 over layer tests in1–4. All tasks consume Global Constraints and the spec; specific omitted values resolve to the spec, not a new interpretation. Rulings about implementation choices remain scoped and recorded as factual work notes, not owner decisions.

Execution is already authorized. Use sequential implementers in this checkout, task-scoped spec+quality review, fixes before the next task, and one whole-branch review. No additional execution-mode question is needed.
