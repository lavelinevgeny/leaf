CREATE TABLE projects (
  id TEXT PRIMARY KEY, title TEXT NOT NULL,
  revision INTEGER NOT NULL DEFAULT 0 CHECK(revision >= 0),
  createdAt TEXT NOT NULL, updatedAt TEXT NOT NULL
) STRICT;
CREATE TABLE tasks (
  id TEXT PRIMARY KEY, projectId TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  parentId TEXT, title TEXT NOT NULL, description TEXT NOT NULL,
  sortOrder INTEGER NOT NULL CHECK(sortOrder >= 0),
  status TEXT NOT NULL CHECK(status IN ('todo','doing','done')),
  inputStart TEXT, inputFinish TEXT, createdAt TEXT NOT NULL, updatedAt TEXT NOT NULL,
  UNIQUE(projectId,id),
  FOREIGN KEY(projectId,parentId) REFERENCES tasks(projectId,id) DEFERRABLE INITIALLY DEFERRED
) STRICT;
CREATE INDEX tasks_parent_order ON tasks(projectId,parentId,sortOrder);
CREATE TABLE account (
  id INTEGER PRIMARY KEY CHECK(id = 1), passwordHash TEXT NOT NULL
) STRICT;
CREATE TABLE sessions (
  id TEXT PRIMARY KEY, expiresAt INTEGER NOT NULL
) STRICT;
CREATE TABLE operations (
  operationId TEXT PRIMARY KEY,
  projectId TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  sessionId TEXT NOT NULL, payload TEXT NOT NULL, response TEXT NOT NULL
) STRICT;
CREATE TABLE undo_snapshots (
  sequence INTEGER PRIMARY KEY AUTOINCREMENT,
  projectId TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  sessionId TEXT NOT NULL, afterRevision INTEGER NOT NULL, beforeSnapshot TEXT NOT NULL
) STRICT;
CREATE INDEX undo_session_project ON undo_snapshots(projectId,sessionId,sequence DESC);
