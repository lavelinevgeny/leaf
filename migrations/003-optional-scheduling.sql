CREATE TABLE scheduling_migration_archive (
  projectId TEXT NOT NULL,
  kind TEXT NOT NULL CHECK(kind IN ('project','task','operation-payload','operation-response','undo-snapshot')),
  recordKey TEXT NOT NULL,
  sourceSchemaVersion INTEGER NOT NULL CHECK(sourceSchemaVersion = 2),
  originalText TEXT NOT NULL,
  sha256 TEXT NOT NULL,
  PRIMARY KEY(projectId,kind,recordKey)
) STRICT;
ALTER TABLE operations ADD COLUMN contractVersion INTEGER NOT NULL DEFAULT 1 CHECK(contractVersion IN (1,2));
ALTER TABLE operations ADD COLUMN responseContractVersion INTEGER NOT NULL DEFAULT 2 CHECK(responseContractVersion = 2);
ALTER TABLE operations ADD COLUMN responseSha256 TEXT NOT NULL DEFAULT '';
-- APPLY_AFTER_ARCHIVE
ALTER TABLE tasks DROP COLUMN planMode;
ALTER TABLE tasks DROP COLUMN notBefore;
ALTER TABLE tasks DROP COLUMN deadline;
ALTER TABLE tasks DROP COLUMN completedStart;
ALTER TABLE tasks DROP COLUMN completedFinish;
ALTER TABLE tasks DROP COLUMN completedStartIndex;
ALTER TABLE tasks DROP COLUMN completedFinishIndex;
ALTER TABLE projects DROP COLUMN startDate;
