# Render Demo Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Подготовить leaf к бесплатному Render Docker demo с явным входом без пароля и новым синтетическим примером при каждом запуске.

**Architecture:** Отдельный server runtime выделяет собственную временную SQLite, затем existing Repository атомарно создаёт seed до readiness. Demo-only session route использует обычные opaque cookies и строгий origin, клиент показывает общий характер данных и сброс; normal storage/auth остаются прежними.

**Tech Stack:** TypeScript, Node 24.21.0, npm 11.19.0, React/Vite, Fastify, better-sqlite3, Vitest, Playwright, Docker, Render Blueprint. Новых зависимостей нет.

**Spec:** [2026-10-09-render-demo-design.md](../specs/2026-10-09-render-demo-design.md). Читать полностью перед каждым блоком. [ADR 013](../../adr/013-isolated-public-demo.md), [DECISIONS](../../DECISIONS.md), [DEPLOYMENT](../../DEPLOYMENT.md), [PRIVACY](../../PRIVACY.md).

## Global Constraints

- Имя продукта — `leaf`; интерфейс русский, идентификаторы и commit subjects английские.
- Один TypeScript package, React/Vite, Fastify, SQLite, один production-контейнер; Node 24.21.0 и npm 11.19.0, существующий lockfile и pinned Docker base сохраняются.
- Никаких новых runtime-зависимостей, ORM, облачной БД, очередей, telemetry, CDN, AI API или секретов агента.
- Только синтетические данные; не читать реальные базы, `.env`, backups, exports, credentials, browser sessions или истории агентов.
- `LEAF_DEMO_MODE=1` — единственный переключатель демо; обычный режим остаётся fail closed и сохраняет прежнюю password authentication.
- Демо всегда создаёт новую временную БД вне checkout; существующий `LEAF_DATA_DIR` не читается, не очищается и не используется даже при явно заданном пути.
- `trustProxy: false`, точный configured origin, JSON mutation requests, HttpOnly/SameSite=Strict cookie и Secure при HTTPS сохраняются.
- Все authoritative writes, FS cascade, пересчёт и undo проходят существующие серверные транзакции; C11–C27 и optional source semantics сохраняются.
- Три PNG из `design/README.md` остаются единственными утверждёнными UI-референсами; excluded subtask layout не используется.
- Один worktree на агента; один writer на shared contracts; каждый блок и вся ветка проходят независимое review; коммит только после положительного review соответствующего diff.
- Нет push, publication, deployment, remote changes или изменения security policy; эти действия требуют отдельного разрешения владельца.
- Демо не означает завершения S4–S6, production readiness или первого релиза.


---

## Порядок и владение

Владелец уже поручил исполнение отдельными агентами: coordinator выдаёт каждый блок отдельному implementer в отдельном worktree, затем независимому reviewer. Только после положительных spec и quality reviews точного diff coordinator разрешает локальный commit. Review docs/spec/plan также предшествует их коммиту. Исправления возвращаются исходному implementer и повторному reviewer. Блоки последовательны: shared contracts принадлежат Task1, клиент читает их в Task2, финальная упаковка Task3. Не создавать параллельных writers в одном worktree.

Изменения STATUS — факты своего блока, без стирания существующих записей. Временные БД, keys TLS smoke, logs и screenshots — только в собственном disposable каталоге вне checkout, без вывода bodies/cookies/ключей. Новые tests добавлять в явные npm test:unit/test:integration lists по их назначению; `npm test` уже собирает Vitest tests. Не использовать skip/retry/--if-present для green результата.

### Task 1: Изолированный runtime, seed и demo session

**Files:**

- Create: `src/server/demo-runtime.ts` — fresh temp lifecycle/Render origin resolution.
- Create: `src/server/demo-seed.ts` — synthetic hierarchy/calendar/FS seed.
- Create: `src/server/demo-limits.ts` — bounded in-memory admission counters.
- Modify: `src/server/main.ts` — runtime preparation, startup and close/error cleanup.
- Modify: `src/server/app.ts` — demo initialization before routes/listen, auth route and guarded mutations.
- Modify: `src/server/auth.ts` — guarded guest session issuance, existing session reuse/expiry and bounded session count.
- Modify: `src/shared/contracts.ts` — optional demoMode in sessionSchema only.
- Test: `tests/demo-runtime.test.ts`, `tests/demo-api.test.ts`, `tests/demo-seed.test.ts`; extend `tests/runtime.test.ts` only for normal regression if needed.
- Modify: `package.json` — list new meaningful test files in unit/integration scripts; no dependency/lockfile change.
- Modify: `docs/STATUS.md` — actual checks, review status and limitations.

**Interfaces:**

```ts
// src/server/demo-runtime.ts
export interface ServerRuntime extends RuntimeConfig {
  demoMode: boolean;
  cleanup(): void;
}
export function prepareServerRuntime(
  environment: Record<string, string | undefined> = process.env,
): ServerRuntime;

// src/server/app.ts: additive, normal defaults false
export interface BuildAppOptions {
  databasePath: string;
  publicOrigin: string;
  staticRoot?: string;
  now?: () => number;
  demoMode?: boolean;
}

// src/server/demo-seed.ts: called only for a newly created demo DB
export function seedDemo(
  db: Database.Database,
  repository: Repository,
  now: () => number,
): void;

// src/server/demo-limits.ts
export class DemoLimits {
  constructor(now?: () => number);
  admitSession(): void;
  admitMutation(body: unknown): void;
}
// Throws DomainError('DEMO_LIMIT', exact spec message, 429).
// Auth constructor gains third optional demoMode=false parameter.
// Auth.enterDemo(existingToken?: string): string returns existing valid
// token or inserts a freshly generated token hash; rejects if !demoMode.
```

Normal `loadConfig` остаётся entrypoint CLI; `prepareServerRuntime` используется main и synthetic tests. Внутренние runtime interfaces не становятся клиентским API. Seed не меняет shared domain contracts/CPM. Guest admission counter вызывается только при необходимости новой сессии.

- [x] **1.1 Write runtime failures first.** Создать только synthetic sentinel в mkdtemp; передать его как LEAF_DATA_DIR в demo, сохранить bytes/mode и проверить после cleanup. Отдельные случаи: symlink sentinel, unsafe TMPDIR внутри checkout, invalid flag/origin/hostname, Render without hostname, malformed host, cleanup twice, два запуска с разными databasePath; normal defaults/symlink rejection остаются.

```ts
it('never uses an existing data directory in demo mode', () => {
  const sentinel = mkdtempSync(join(tmpdir(), 'leaf-sentinel-'));
  writeFileSync(join(sentinel, 'sentinel.txt'), 'synthetic untouched');
  const runtime = prepareServerRuntime({
    LEAF_DEMO_MODE: '1', LEAF_DATA_DIR: sentinel,
    LEAF_PUBLIC_ORIGIN: 'http://127.0.0.1:3000',
  });
  try {
    expect(runtime.databasePath.startsWith(sentinel + '/')).toBe(false);
    expect(readFileSync(join(sentinel, 'sentinel.txt'), 'utf8'))
      .toBe('synthetic untouched');
  } finally {
    runtime.cleanup();
    rmSync(sentinel, { recursive: true, force: true });
  }
});
```

- [x] **1.2 Run RED.** `npx vitest run tests/demo-runtime.test.ts` ожидаемо падает из-за отсутствующего helper; зафиксировать причину, без ослабления assertions.
- [x] **1.3 Implement runtime.** Нормальная ветка вызывает loadConfig; demo валидирует env, создаёт только собственный temp вне checkout, закрывает cleanup над этим путём. При любом loadConfig failure удаляет собственный temp. Strict hostname regex для single DNS label с допустимыми дефисами и длиной1–63, suffix `.onrender.com`; Render requires HTTPS. Explicit origin имеет приоритет, чужие headers не читаются.

```ts
const config = loadConfig({
  ...environment,
  LEAF_DATA_DIR: ownedDirectory,
  LEAF_PUBLIC_ORIGIN: resolvedOrigin,
});
return { ...config, demoMode: true, cleanup: removeOwnedDirectory };
// main: prepare -> await buildApp(...demoMode) -> listen.
// onClose: close SQLite first, then runtime.cleanup().
// build/listen failure: await app?.close(), finally runtime.cleanup().
```

- [x] **1.4 Write API/seed failures.** Tests use app.inject over own temporary DB. Normal route404/no account401; demo GET unauthenticated true flag; missing/foreign Origin403, non-JSON415, extras400; successful cookie HttpOnly/SameSite/HTTPS Secure. Two tokens share tree but logout/undo independent; expiry; repeated existing-token entry does not allocate. Demo password route403 without scrypt. Mock/fake now exercises rate/session/lifetime/byte bounds and proves request denied before repository rows/revision change. Forwarded headers cannot bypass limits/origin. Direct Auth.enterDemo with default mode rejects.

```ts
const denied = await app.inject({ method: 'POST', url: '/api/auth/demo', payload: {} });
expect(denied.statusCode).toBe(403);
const entered = await app.inject({
  method: 'POST', url: '/api/auth/demo',
  headers: { origin: 'https://demo.example.test' }, payload: {},
});
expect(entered.json()).toEqual({
  authenticated: true, setupRequired: false, demoMode: true,
});
expect(String(entered.headers['set-cookie'])).toContain('Secure');
// Keep cookie only in test memory; do not print response headers/body.
```

- [x] **1.5 Seed via current commands.** Generate one internal random account password in memory, await Auth.setup before seed. Inside outer db.transaction(...).immediate create project then task.create and dependency.create envelopes using fresh UUID/expectedRevision and one private seed session identifier. Build table from spec §5 with existing calendar helpers and explicit UTC/weekday semantics. Remove seed history within transaction; assert current tree/schedule validators before returning. Inject a command failure to prove rollback and startup failure cleanup. Fixed Friday/weekend/date-boundary clocks validate workday offsets/null fields, depth>=3, critical branch/partial result and dependencies independently of seed helper calculations.

```ts
const envelope: CommandEnvelope = {
  contractVersion: 2,
  expectedRevision: tree.project.revision,
  operationId: randomUUID(),
  command: {
    type: 'dependency.create',
    predecessorId: planTaskId,
    successorId: implementationTaskId,
  },
};
tree = repository.applyCommand(projectId, envelope, seedSessionId);
```

- [x] **1.6 Implement session and limits.** Optional demoMode schema; conditional route uses z.strictObject({}); normal route code preserved. Demo Auth guard, hashed sessions and SESSION_SECONDS; no user-provided password or bypass of session lookup. In-memory fixed windows lazily reset; enforce 60 new-entry attempts/min,100 sessions,120 mutation attempts/min,200 per process and256 KiB JSON bytes. All limits checked before increments/Repository; exact spec429 copy. Preserve API no-store and normal auth regression.
- [x] **1.7 Run GREEN.** `npx vitest run tests/demo-runtime.test.ts tests/demo-api.test.ts tests/demo-seed.test.ts tests/api.test.ts tests/runtime.test.ts tests/admin.test.ts`; then `npm run typecheck`, `npm run lint`, `npm run test:unit`, `npm run test:integration`, `npm run format:check`, `npm run check:kit`. Repair failures caused by this block and rerun affected checks.
- [x] **1.8 Update STATUS and review.** Report exact counts, no live deployment. Independent reviewer examines spec A1–A5, normal auth, temp ownership/error cleanup, limits and truthful CPM. Fix findings, rerun checks, obtain positive review of final diff.
- [x] **1.9 Commit only after approval.** Stage only Task1 files; run staged guard; subject `feat: add isolated synthetic demo runtime and sessions`. Coordinator records exact commit and hands interfaces to Task2.

### Task 2: Вход и предупреждение в клиенте, настоящий browser E2E

**Files:**

- Modify: `src/client/api.ts`, `src/client/App.tsx`, `src/client/strings.ts`, `src/client/styles/app.css` — demo notice styling without unrelated layout rewrite.
- Test: `tests/client/demo.test.tsx`, `tests/client/App.test.tsx` — demo branch and ordinary auth regression.
- Create: `scripts/e2e-demo-server.ts` — dedicated own-temp demo runtime helper, actual compiled main, restart/close.
- Create: `tests/e2e/demo.spec.ts` — entry, editable shared seed, logout and process restart.
- Modify: `docs/UI.md`, `docs/STATUS.md` — visible demo-only notice and checks.
- Modify: `package.json` — include `scripts/e2e-demo-server.ts` in existing explicit lint/format commands; no dependency change.

**Interfaces:** consumes Task1 `AuthSession.demoMode?: boolean`, GET session and POST `/api/auth/demo`; produces `api.enterDemo(): Promise<AuthSession>`. The helper returns `{ origin: string; restart(): Promise<void>; close(): Promise<void> }`; no password field. Existing syntheticRuntime remains normal and unaffected.

- [x] **2.1 Read UI and inspect all three PNGs.** Keep current compact workspace. Использовать существующий `src/client/styles/app.css` для demo notice.
- [x] **2.2 Write client RED.** Mock existing api boundary: unauthenticated demo flag displays button/notice, password field absent; click/keyboard Enter enters and loads project. Assert loading disabled, rejected entry role=alert/retry, session-fetch failure retry, logout keeps demo flag, missing flag renders normal password/setup. Server DEMO_LIMIT message remains visible, reads still work.

```tsx
vi.spyOn(api, 'session').mockResolvedValue({
  authenticated: false, setupRequired: false, demoMode: true,
});
render(<App />);
const button = await screen.findByRole('button', { name: 'Открыть демо' });
expect(screen.queryByLabelText('Пароль')).not.toBeInTheDocument();
expect(screen.getByText(strings.demoNotice)).toBeVisible();
await user.click(button);
expect(api.enterDemo).toHaveBeenCalledOnce();
```

- [x] **2.3 Run RED.** `npx vitest run tests/client/demo.test.tsx`; new demo tests fail for missing API/UI.
- [x] **2.4 Implement compatible client branch.** Add centralized strings with exact spec notice and button copy. Reuse login busy/error/session loading flow, explicit api.enterDemo, preserve flag on logout/auth expiry, conditional top notice in login/workspace. Normal responses without flag mean false; do not infer demo from URL or process.env. No fetch-on-render auto-entry, no local seed/reset, no new browser persistence.

```ts
enterDemo: () => request('/auth/demo', sessionSchema, 'POST', {}),
```

```tsx
{session?.demoMode && <p className="demo-notice">{strings.demoNotice}</p>}
// Entry handler sets pending, awaits api.enterDemo(), then existing
// project loading; catch uses existing error rendering, finally clears pending.
```

- [x] **2.5 Implement actual-server helper and E2E.** Start compiled main via child_process with LEAF_DEMO_MODE=1/explicit loopback origin/own env and stdio ignore. Allocate random loopback port; wait readyz with bounded timeout; stop SIGTERM with timeout/error handling before removing only own helper resources. restart creates fresh runtime. No HTTP project/auth mocks in acceptance browser scenario; route delays are allowed only for separately named loading/error UI tests.

```ts
test('demo explicitly opens a shared example and resets on restart', async ({ page }) => {
  const runtime = await syntheticDemoRuntime();
  try {
    await page.goto(runtime.origin);
    await page.getByRole('button', { name: 'Открыть демо' }).click();
    await expect(page.getByText('Демо-проект', { exact: true })).toBeVisible();
    const input = page.getByLabel('Новая задача', { exact: true });
    await input.fill('Синтетическая проверка демо');
    await input.press('Enter');
    await expect(page.getByRole('treeitem', { name: /Синтетическая проверка демо/ })).toBeVisible();
    await runtime.restart();
    await page.reload();
    await expect(page.getByRole('button', { name: 'Открыть демо' })).toBeVisible();
    await page.getByRole('button', { name: 'Открыть демо' }).click();
    await expect(page.getByRole('treeitem', { name: /Синтетическая проверка демо/ })).toHaveCount(0);
  } finally { await runtime.close(); }
});
```

- [x] **2.6 Extend browser coverage.** Assert initial three tree levels, dates near today, Gantt conditional bars/dependency arrows/critical labels; enter via keyboard; edit and undo before restart; reload preserves edits before restart. Second browser context sees shared change after refresh, stale revision gives409 recovery, independent logout does not log out first visitor. Notice remains visible, normal task-tree/password regression passes. Both configured viewport projects run, no skips/retries.
- [x] **2.7 Run GREEN.** `npx vitest run tests/client/demo.test.tsx tests/client/App.test.tsx`; `npm run typecheck`, `npm run lint`, `npm run test:unit`, `npm run test:integration`, `npm run build`, `npm run format:check`; `npx playwright test tests/e2e/demo.spec.ts tests/e2e/task-tree.spec.ts`; `npm run check:kit`. Screenshots only synthetic, outside checkout, never publish raw artifacts.
- [x] **2.8 Update UI/STATUS and review.** Independent spec/quality review covers A6, focus/loading/error/empty states, existing references and real browser assertions. Resolve findings and obtain positive final-diff review.
- [x] **2.9 Commit only after approval.** Stage Task2 files, staged checks; subject `feat: expose explicit public demo entry and notice`.

### Task 3: Render Blueprint, Docker and deployment verification

**Files:**

- Create: `render.yaml` — single free service with manual deploy trigger.
- Modify: `Dockerfile` — remove default public origin that would mask safe Render fallback; retain base/user/build allowlist/healthcheck.
- Modify: `docs/DEPLOYMENT.md`, `README.md`, `docs/STATUS.md` — local demo and manual Render steps/limits.
- Test: `tests/demo-runtime.test.ts` (extend exact env precedence cases), `tests/render-config.test.ts` (assert local YAML contract without new YAML dependency), `tests/demo-https.test.ts` (synthetic loopback TLS proxy and cookies/origin if suitable in Vitest).
- Modify: `package.json` only to include meaningful new tests in explicit script lists; `.dockerignore` and security policy stay unchanged.

**Interfaces:** consumes prepareServerRuntime and main startup, exposes PORT=LEAF_PORT=3000 plus `/readyz`. No new application API. Explicit public origin override and validated Render hostname fallback are Task1 contracts.

- [x] **3.1 Write configuration RED.** Verify exact blueprint free/docker/single-service/manual/no-disk settings; Docker no baked-in origin; origin tests validate RENDER=true + hostname fallback, explicit HTTPS custom origin precedence, missing/malformed hostname failure, explicit HTTP rejection on Render and normal defaults.
- [x] **3.2 Add Blueprint.** No actual service creation or remote CLI invocation.

```yaml
services:
  - type: web
    name: leaf-demo
    runtime: docker
    plan: free
    dockerfilePath: ./Dockerfile
    dockerContext: .
    healthCheckPath: /readyz
    autoDeployTrigger: off
    envVars:
      - key: LEAF_DEMO_MODE
        value: '1'
      - key: LEAF_HOST
        value: 0.0.0.0
      - key: LEAF_PORT
        value: '3000'
      - key: PORT
        value: '3000'
```

- [x] **3.3 Align Docker defaults.** Remove only LEAF_PUBLIC_ORIGIN from ENV; normal loadConfig computes same loopback default, Compose retains explicit origin. Keep pinned digest, USER node, native SQLite probe, no shell startup, no build-time seed/runtime files. `render.yaml` does not need inclusion in .dockerignore allowlist or runtime layers.
- [ ] **3.4 Run synthetic container smoke.** Build reviewed source; create disposable container/resources with unique names and cleanup ownership. Normal mode before setup401/route404; normal CLI synthetic setup/login, edit/restart persistence; demo startup without CLI, readyz, SPA, passwordless session, seed/edit/restart reset and old-cookie rejection. Test read-only root plus tmpfs `/tmp`, no mounted private data. Check Docker healthcheck and SIGTERM exit; remove only created containers/volumes.
- [x] **3.5 Verify HTTPS locally.** Temporary self-signed test certificate created outside checkout; local TLS reverse proxy forwards to actual server with configured HTTPS origin. Use only test client trust override scoped to this fixture; never change app TLS/security settings. Assert Secure/HttpOnly/SameSite cookie, same-origin entry/edit/logout, foreign/missing Origin403, spoofed Forwarded/X-Forwarded-Host ignored. Do not print cookie/key/body. Run real Render only after separate owner authorization, not in this plan.

```ts
expect(httpsEntry.headers.get('set-cookie')).toMatch(/; Secure(?:;|$)/i);
expect(foreignOrigin.status).toBe(403);
expect(spoofedForwardedOrigin.status).toBe(403);
// A correct Origin with forwarded junk still follows configured origin.
// Assert actual persisted revision through authenticated API after HTTPS edit.
```

- [x] **3.6 Write deployment instructions.** Clearly label free/shared/reset; public notice/no personal data; local LEAF_DEMO_MODE command with exact origin; Render manual Blueprint or Dashboard workflow, no credentials in source. Explain HOST/PORT pair, fallback hostname, explicit custom-domain HTTPS origin, readyz, cold start/quotas, automatic restart/reset, manual deploy setting and no shell/setup requirement. Mention stop/restart affects all visitors. Link primary Render docs and checked date; no invented live URL or success claim.
- [x] **3.7 Run all final checks.** `npm run verify`, `npm run format:check`, `npm run test:unit`, `npm run test:integration`, `npm run test:e2e`, `npm run check:kit`, `npm run check:package`, `npm run preflight`, `git diff --check`. Reuse already-passed unchanged checks within block; repeat only after relevant changes. Preflight includes real scanner/metadata and must not silently skip missing tooling. If linked-worktree policy rejects .git pointer, report limitation and ask coordinator to perform equivalent ordinary-checkout gates without changing guard policy.
- [x] **3.8 Task3 review then commit.** STATUS separates passed/failed/not run, local TLS/Docker smoke from real Render. Independent reviewer validates spec A7–A8 and no privacy changes; fix findings, rerun affected checks; positive final-diff review before `feat: prepare free Render demo deployment` commit.
- [x] **3.9 Whole-branch independent review.** Review exact reviewed commits from pre-task base, contracts crossing server/client/container, restart/expiry/normal-mode regression, docs truthfulness and all A1–A8. Findings return to original block implementer and new scoped approval before corrective commit. Coordinator runs remaining root gates preserving unrelated owner changes; final report contains local commit IDs, passed checks, limitations, and explicit no publication.

## Coverage self-review

Spec §§1/7 →Task3; §2 →Task1 runtime/seed error and restart tests plus Task3 Docker; §§3/4 →Task1 API/limits and Task2 entry/429; §5 →Task1 semantic fixture assertions and Task2 real Gantt; §6 →Task2 component/browser; §8/global constraints →all review gates and Task3 whole-branch review. The three tasks use identical optional demoMode, POST /api/auth/demo and runtime ownership contracts. No scheduler behavior, real data or publication is delegated implicitly.
