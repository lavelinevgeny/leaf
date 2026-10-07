# Repository harness hardening implementation plan

> **For agentic workers:** Use writing-plans and execute these approved tasks inline, one writer for security policy. No concurrent agents or automatic publication.

**Goal:** Close the four reproduced publication gaps and provide explicit local preflight and agent safety checks.

**Architecture:** Keep dependency-free Node scripts and Git hooks. Share asset validation and Git metadata collection between the guard and Gitleaks. Distinguish deterministic repository checks from runtime sandbox checks and model behavior evaluations.

**Tech Stack:** Node 22+ standard library, Git, Gitleaks 8.30.1, existing Codex/Claude Code runtimes.

**Spec:** [Repository privacy policy](../../PRIVACY.md) and [audit results](../../STATUS.md).

## Constraints

- Only synthetic fixtures; no credential, production data, environment or transcript inspection.
- Preserve the existing STATUS audit entry and the three approved reference bytes.
- Do not implement the leaf application, install packages or change remote settings.
- Do not store public identity values or local runtime configuration in Git.

## Task 1: Publication regressions

Files: `scripts/security.test.mjs`, `scripts/security-check.mjs`, `scripts/public-assets.mjs`, `scripts/git-metadata.mjs`, `scripts/run-gitleaks.mjs`, `config/public-assets.json`, `scripts/check-kit.mjs`.

- [x] Add failing tests for commit/tag metadata, ASCII PDF and disguised PDF, historical asset approvals, forbidden path reads and symlinked manifests.
- [x] Run `npm run test:kit`; verify new assertions fail before implementing behavior.
- [x] Implement metadata collection without printing values; inspect messages and identities, including nested annotated tags.
- [x] Classify reviewed assets by extension/signature as well as encoding. Current and historical approvals are separate lists; history can use both.
- [x] Reject workspace private paths before file reads and directory traversal. Validate manifests and current asset reads without following symlinks.
- [x] Run affected unit tests and real Gitleaks positive/negative controls using temporary synthetic repositories.

## Task 2: Hooks and reproducible preflight

Files: `scripts/harness.test.mjs`, `scripts/doctor.mjs`, `scripts/preflight.mjs`, `scripts/install-hooks.mjs`, `.githooks/commit-msg`, `package.json`, `.github/workflows/kit-checks.yml`.

- [x] Add integration tests for missing Gitleaks, synthetic secret rejection/redaction, hook installation conflicts, and commit-message rejection.
- [x] Add a commit-message hook; extend the installer without overwriting existing hooks.
- [x] Add read-only doctor checks for root, versions, configured executable hooks and agent safety settings.
- [x] Add one preflight command for kit validation, tests, workspace/metadata checks and Gitleaks; include uncommitted changes without modifying the index.
- [x] Install Gitleaks before integration tests in CI; preserve pinned Actions and read-only permissions.
- [x] Run the complete harness tests and preflight.

## Task 3: Agent instructions and safety profiles

Files: `AGENTS.md`, `CLAUDE.md`, `START_HERE.md`, `.claude/settings.json`, `config/agents/`, `scripts/agent-sandbox.mjs`, `docs/AGENT_WORKFLOW.md`, `docs/BOOTSTRAP.md`, `docs/PRIVACY.md`, `docs/adr/001-repository-harness.md`, `fixtures/agents/`.

- [x] Make START_HERE task-driven and authorize routine disposable-fixture checks explicitly.
- [x] Enable strict Claude sandbox settings, expand private read denials and keep command/network approval boundaries.
- [x] Provide versioned credential-free Codex permission definitions and a synthetic OS sandbox smoke command; do not claim configured isolation is verified until that command succeeds.
- [x] Define a small model behavior scenario set with observable acceptance criteria; raw traces remain private and no paid model evaluation runs automatically.
- [x] Document external push protection/ruleset setup as owner work, plus an S0 application verify contract that requires real checks.
- [x] Update STATUS with actual verification outcomes and remaining external/runtime limits; run `git diff --check` and final privacy checks.

## Verified outcome

All local implementation tasks are complete. The real scanner/hook suite passes 35 tests without skips. Publication preflight correctly refuses the existing commit identity findings; they were neither allowlisted nor rewritten. The Codex OS probe was run and refused this runtime, so isolation and model launch are not reported as passing. Claude runtime, model behavior scenarios and external hosting protections remain explicitly unverified. See STATUS for the final handoff.

Follow-up on 2026-10-07: the Codex runtime/profile integration was corrected and its real OS probe now passes. The suite has 41 passing tests; the existing identity publication gate remains. See SANDBOX-FIX in STATUS for the verified scope and limits.

Later on 2026-10-07, the owner approved the public commit identity email. Indexed reviews reference the two immutable source objects without copying addresses; only matching commit email fields are exempted. All 45 tests and the full local preflight pass. History and Git identity remain unchanged; no external publication occurred. See PUBLIC-IDENTITY-REVIEW in STATUS.
