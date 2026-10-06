# Contributing to leaf

Start with [START_HERE.md](START_HERE.md) and [AGENTS.md](AGENTS.md). Keep leaf small and do not expand scope from incidental mockup elements.

Use one focused branch/task; preserve unrelated edits. One concurrent agent per worktree. Schema, lockfile, shared contracts and security controls require coordinated changes. New architecture decisions go into `docs/adr/` using the template.

Run the kit checks and staged/history privacy checks. Once application tooling exists, run real typecheck, lint, unit/integration, build and relevant E2E. Include verified outcomes in the PR. Do not suppress failing tests to get a green check.

Install local hooks explicitly with `npm run hooks:install`; install Gitleaks first. Never use real task exports as fixtures. Public binary assets require human review and exact-hash approval. Do not include personal Git identity in repository config.

No automatic remote push, registry publication or production deployment. Ask the owner for authorization. License choice is pending; see [LICENSE-NOTE.md](LICENSE-NOTE.md).
