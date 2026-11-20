-- Startup applies this migration alone with FK enforcement temporarily disabled,
-- then checks all foreign keys before commit and restores enforcement immediately.
ALTER TABLE journal_entries ADD COLUMN contentJson TEXT;
ALTER TABLE undo_journal_entries ADD COLUMN contentJson TEXT;
CREATE TABLE journal_operations_v2 (
  operationId TEXT PRIMARY KEY,
  projectId TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  sessionId TEXT NOT NULL, payload TEXT NOT NULL, response TEXT NOT NULL,
  responseSha256 TEXT NOT NULL,
  contractVersion INTEGER NOT NULL CHECK(contractVersion IN (1,2))
) STRICT;
INSERT INTO journal_operations_v2 SELECT * FROM journal_operations;
DROP TABLE journal_operations;
ALTER TABLE journal_operations_v2 RENAME TO journal_operations;
-- Preserve the AUTOINCREMENT high-water mark even after snapshot pruning.
CREATE TEMP TABLE journal_media_sequence (seq INTEGER NOT NULL) STRICT;
INSERT INTO journal_media_sequence SELECT seq FROM sqlite_sequence WHERE name='undo_snapshots';
CREATE TABLE undo_snapshots_v2 (
  sequence INTEGER PRIMARY KEY AUTOINCREMENT,
  projectId TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  sessionId TEXT NOT NULL, afterRevision INTEGER NOT NULL, beforeSnapshot TEXT NOT NULL,
  journalLifecycleVersion INTEGER NOT NULL DEFAULT 0 CHECK(journalLifecycleVersion IN (0,1,2))
) STRICT;
INSERT INTO undo_snapshots_v2 SELECT * FROM undo_snapshots;
DROP TABLE undo_snapshots;
ALTER TABLE undo_snapshots_v2 RENAME TO undo_snapshots;
UPDATE sqlite_sequence SET seq=max(seq,coalesce((SELECT max(seq) FROM journal_media_sequence),0)) WHERE name='undo_snapshots';
DROP TABLE journal_media_sequence;
CREATE INDEX undo_session_project ON undo_snapshots(projectId,sessionId,sequence DESC);
ALTER TABLE undo_journal_manifest ADD COLUMN mediaCount INTEGER CHECK(mediaCount>=0);
ALTER TABLE undo_journal_manifest ADD COLUMN payloadSha256 TEXT;
CREATE TABLE journal_media (
  id TEXT PRIMARY KEY,
  uploadId TEXT NOT NULL UNIQUE,
  projectId TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  taskId TEXT NOT NULL,
  homeEntryId TEXT,
  sessionId TEXT NOT NULL,
  fileName TEXT NOT NULL CHECK(length(CAST(fileName AS BLOB)) BETWEEN 1 AND 255),
  kind TEXT NOT NULL CHECK(kind IN ('image','file')),
  mediaType TEXT NOT NULL,
  sourceByteLength INTEGER NOT NULL CHECK(sourceByteLength BETWEEN 1 AND 26214400),
  sourceSha256 TEXT NOT NULL CHECK(length(sourceSha256)=64),
  byteLength INTEGER NOT NULL CHECK(byteLength BETWEEN 1 AND 26214400),
  storedSha256 TEXT NOT NULL CHECK(length(storedSha256)=64),
  width INTEGER, height INTEGER,
  createdAt TEXT NOT NULL,
  unreferencedAt TEXT,
  bytes BLOB,
  CHECK(bytes IS NULL OR length(bytes)=byteLength),
  CHECK((kind='image' AND mediaType='image/webp' AND width IS NOT NULL AND height IS NOT NULL AND width BETWEEN 1 AND 16384 AND height BETWEEN 1 AND 16384 AND width*height<=20000000) OR
    (kind='file' AND mediaType='application/octet-stream' AND width IS NULL AND height IS NULL))
) STRICT;
CREATE INDEX journal_media_scope ON journal_media(projectId,taskId);
CREATE INDEX journal_media_staged ON journal_media(projectId,sessionId) WHERE bytes IS NOT NULL;
CREATE INDEX journal_media_gc ON journal_media(unreferencedAt) WHERE bytes IS NOT NULL;
CREATE TABLE journal_entry_media (
  entryId TEXT NOT NULL REFERENCES journal_entries(id) ON DELETE CASCADE,
  mediaId TEXT NOT NULL REFERENCES journal_media(id),
  PRIMARY KEY(entryId,mediaId)
) STRICT;
CREATE INDEX journal_entry_media_pin ON journal_entry_media(mediaId);
CREATE TABLE undo_journal_media (
  undoSequence INTEGER NOT NULL,
  entryId TEXT NOT NULL,
  mediaId TEXT NOT NULL REFERENCES journal_media(id),
  PRIMARY KEY(undoSequence,entryId,mediaId),
  FOREIGN KEY(undoSequence,entryId) REFERENCES undo_journal_entries(undoSequence,id) ON DELETE CASCADE
) STRICT;
CREATE INDEX undo_journal_media_pin ON undo_journal_media(mediaId);
