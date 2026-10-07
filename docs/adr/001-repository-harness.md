# ADR 001 — Local repository harness and publication inputs

Status: accepted (repository tooling)

## Context

The synthetic audit reproduced four gaps: commit/tag messages escaped scanners, ASCII PDF bypassed asset approval, historical hashes conflicted with current validation, and workspace checks read private paths before refusal. The owner requested the proposed local hardening.

## Decision

Keep dependency-free Node scripts, Git hooks and Gitleaks. Scan full changed index blobs and raw commit/annotated-tag objects, reporting only object IDs/rules and safe summaries. Commit-msg checks pending messages. Private workspace paths fail before reads or traversal; public input reads reject symlinks.

Manifest v2 separates `assets` from `historicalAssets`. Current validation checks only current bytes; history uses both lists. V1 remains readable for existing index content. Documents, images and archives require exact approval based on extensions/signatures or binary encoding.

Doctor checks tooling/configuration; preflight includes real scanner integration tests and uncommitted public text without staging. Codex permission profiles and strict Claude settings are explicit; runtime probes are separate from configuration checks. No model API calls, remote setup or deployment run automatically.

## Alternatives and consequences

A custom agent framework or DLP service would add dependencies without resolving manual identity/image review. Text scanners remain incomplete; classification cannot detect every encoded format. Local hooks are bypassable, so remote push protection and owner review remain required. Nonpublic email in existing metadata blocks history/preflight until the owner resolves the public identity policy; no automatic history rewrite or identity allowlist is introduced.

Codex profiles require a current CLI; Claude strict sandbox settings require a supported runtime/OS. Unsupported isolation refuses agent launch. Configured settings alone are not a proof of enforcement.

### Runtime correction — 2026-10-07

The Linux probe found three issues in the initial Codex integration: the home-installed native helper was unreadable inside the sandbox, directory-only globs did not deny their contents, and CLI 0.153.0 suppressed command stdout. Resolve npm/native installations without inspecting auth; add read-only grants for the exact Node and native Codex files in memory. Root directory denials and nested content globs avoid overlapping mounts; `.codex` content denial retains the built-in directory write protection. Require a nonce proof file written only after every boundary check, as well as a successful process exit. No directory-wide tool grant, package installation or model call is required.

### Owner-reviewed public Git identity — 2026-10-07

The owner explicitly approved publication of the existing commit identity email. Record immutable source commit IDs and reviewed `author`/`committer` fields in `config/public-git-metadata.json`, without copying identity values or email hashes. Resolve those exact addresses in memory from reachable commits and permit them only in matching email fields, including future commits. Read reviews from the index so unstaged policy cannot widen approval. Names, messages, files and tags retain email review; all secret rules and raw Gitleaks scans remain intact. This consent does not authorize a push or history rewrite.

## Verification

### Publication scan correction — 2026-10-07

A scanner-only synthetic token staged and then removed from the working copy passed preflight because only the local guard inspected the index. Add a separate Gitleaks staged scan. Exercise the real publication subprocesses through an importable preflight runner, with host setup and recursive suite execution isolated in tests; preserve the index and stop before downstream readers when workspace privacy fails.

Snapshot `.gitleaks.toml` from the index for staged/history/pending-message scans, and from the working tree for workspace scans. Require a regular, unmerged index entry; never fall back to an unstaged policy. Pass the snapshot and an empty ignore-file directory explicitly to Gitleaks. Validate the scanner configuration even for an empty staged diff. Distinguish findings from scanner errors with a dedicated internal finding exit code, mapping them to wrapper exits 1 and 2. Remove snapshots in `finally`, including message refusals and scanner errors. No scanner output or credential data is persisted.

`test:kit` covers guard regressions, historical approvals, nested tags, real Gitleaks positive/negative controls, output suppression and hooks. `doctor`, `preflight` and `agent:sandbox` report distinct outcomes. Agent behavior scenarios are maintained separately and are not counted as executed model evaluations.

Rollback changes scripts/configuration and removes the new commit-msg hook from the local setup through a reviewed change. It must not remove scanner safeguards or approvals to allow publication; legacy assets remain readable.
