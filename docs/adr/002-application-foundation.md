# ADR 002: application foundation and transactional S1 tree

Status: accepted implementation default, 2026-10-07.

## Context

S0/S1 needs a locally runnable task tree with durable state, optional input
calendar dates, authentication and reversible server commands. Scheduling and
Gantt remain later stages; S1 is not the first usable complete release.

## Decision

Use one TypeScript package, React/Vite, Fastify and better-sqlite3. Domain tree
functions are iterative and import only transport types. The server owns writes,
revision checks, branch conversion and undo inside immediate SQLite transactions.
Foreign keys, WAL and a five-second busy timeout protect local storage. SQL
migrations are versioned application build inputs. There is no ORM or additional
state framework.

UUID operation IDs store canonical validated payloads and their original results.
Repeats from the same session/project return the saved result; reuse with another
payload or context is rejected. Revision checking happens after deduplication.
Each successful task or project rename command raises the revision. Undo keeps at
most twenty before-snapshots per project/session and is eligible only when its
after-revision matches the current project. After undo, only the immediately
contiguous earlier command of that session becomes eligible. An intervening
session write cannot be erased after refresh.

A first child on a dated leaf requires explicit preserveWork confirmation; a new
work-child retains its title, description, status and original dates. The parent
loses its own dates and resets status to todo. Summary date edits are rejected.
Unscheduled children remain undated. This implements the written tree conversion
rules without introducing scheduling into S1.

Local account setup requires a TTY with hidden password input and confirmation.
There is no network setup endpoint. Node crypto.scrypt uses N=131072, r=8, p=1,
64-byte output, a unique random salt and 256 MiB maximum memory. Opaque random
session tokens are stored only as SHA-256 identifiers, expire after seven days,
and are revoked at logout. Cookies are HttpOnly, SameSite=Strict and Secure for
HTTPS. Mutations require the exact configured origin and JSON. Login has five
attempts per minute per direct peer address, a bounded address map and two
concurrent hash operations. API body size is limited to 64 KiB; error responses
do not reveal SQL, stack traces or paths. Request bodies/cookies are never logged.

Runtime requires an explicit absolute LEAF_DATA_DIR outside the application tree;
symlink resolution is checked before creating it. Tests own disposable synthetic
SQLite files outside checkout. One production Fastify process serves dist/client
and closes the database on termination. Development defaults are loopback API
3000 and Vite 5173 with a same-origin proxy. Kit scripts and hooks remain active.

## Dependency verification

Node 24.21.0 and npm 11.19.0 were verified against the official Node distribution
by the integration controller. Dependencies have exact direct pins and a registry
integrity lockfile. TypeScript 6.0.3 is used because typescript-eslint 8.71.1 declares
support below 6.1; the registry's TypeScript 7 line is outside that peer range.
better-sqlite3 13.0.3 supplies Node-API arm64 prebuilds inside its integrity-checked
npm tarball. npm 11.19 still executes implicit node-gyp rebuild from binding.gyp
during a clean install; reviewed GYP selects empty targets when the bundled
prebuild exists. Clean install therefore needs Python/make even without native
compilation. Its binding selection and GYP build input were reviewed. esbuild 0.28.2's postinstall validates its platform
binary and was reviewed before an explicit rebuild. npm allowScripts permits only
the exact reviewed esbuild and better-sqlite3 versions; optional macOS fsevents
is denied. npm ci --strict-allow-scripts was validated with lifecycle scripts
enabled. A container using ignore-scripts must separately load-test the bundled
native binding rather than claim a compiled driver.

Sources: [Node releases](https://nodejs.org/dist/index.json),
[npm registry](https://registry.npmjs.org/),
[Vite guide](https://vite.dev/guide/),
[Fastify LTS](https://fastify.dev/docs/latest/Reference/LTS/),
[better-sqlite3](https://github.com/WiseLibs/better-sqlite3),
[npm lifecycle policy](https://docs.npmjs.com/cli/v11/using-npm/config/),
[OWASP password storage](https://cheatsheetseries.owasp.org/cheatsheets/Password_Storage_Cheat_Sheet.html).

## Consequences

Snapshots and stored idempotent results trade storage for simple reliable command
semantics. Undo snapshots are bounded; stored operation responses currently have
no retention policy. SQLite synchronous writes suit a small single-owner planner;
large projects and lifecycle maintenance need later measurement. The packaging follow-up adds native consistent SQLite backup and a non-root
production image with a deny-default build context. Restore, scheduling,
import/export and complete release functionality are not implemented.
