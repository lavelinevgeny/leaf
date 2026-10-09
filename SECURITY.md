# Security policy

leaf is under active development. The first usable release is not complete; publication of the source code does not declare the application production-ready or independently security-audited.

Never attach real projects, database dumps, session cookies, tokens or production screenshots to public issues. Use a synthetic reproduction. For a sensitive report, use [GitHub private vulnerability reporting](https://github.com/lavelinevgeny/leaf/security/advisories/new), enabled for this repository. Do not disclose sensitive details in a public issue.

Before development or publication read [docs/PRIVACY.md](docs/PRIVACY.md). If a credential leaks, stop publication and revoke/rotate it; deleting the file alone is insufficient. History rewrites and destructive cleanup require owner authorization.

Local hooks, a privacy guard, Gitleaks integration and read-only CI are included. They are defense in depth, not a guarantee or a replacement for sandboxing, least privilege and manual review. Hooks must be installed per clone. GitHub repository security settings must be enabled by the owner.
