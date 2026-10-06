# Security policy

leaf is at the repository-starter stage. No released application is declared secure by this package.

Never attach real projects, database dumps, session cookies, tokens or production screenshots to public issues. Use a synthetic reproduction. For a sensitive report, use the hosting provider's private vulnerability reporting if enabled; otherwise ask the maintainer for a private channel without disclosing the sensitive details publicly. No personal contact address is invented here.

Before development or publication read [docs/PRIVACY.md](docs/PRIVACY.md). If a credential leaks, stop publication and revoke/rotate it; deleting the file alone is insufficient. History rewrites and destructive cleanup require owner authorization.

Local hooks, a privacy guard, Gitleaks integration and read-only CI are included. They are defense in depth, not a guarantee or a replacement for sandboxing, least privilege and manual review. Hooks must be installed per clone. GitHub repository security settings must be enabled by the owner.
