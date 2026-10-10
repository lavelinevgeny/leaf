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
