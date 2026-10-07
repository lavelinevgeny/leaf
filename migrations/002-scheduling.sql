ALTER TABLE projects ADD COLUMN startDate TEXT;
ALTER TABLE projects ADD COLUMN calendarType TEXT NOT NULL DEFAULT 'weekdays' CHECK(calendarType IN ('weekdays','all-days'));
ALTER TABLE projects ADD COLUMN timezone TEXT NOT NULL DEFAULT 'UTC';
ALTER TABLE tasks ADD COLUMN planMode TEXT NOT NULL DEFAULT 'unscheduled' CHECK(planMode IN ('unscheduled','auto','fixed'));
ALTER TABLE tasks ADD COLUMN durationDays INTEGER CHECK(durationDays > 0);
ALTER TABLE tasks ADD COLUMN notBefore TEXT;
ALTER TABLE tasks ADD COLUMN deadline TEXT;
ALTER TABLE tasks ADD COLUMN completedStart TEXT;
ALTER TABLE tasks ADD COLUMN completedFinish TEXT;
ALTER TABLE tasks ADD COLUMN completedStartIndex INTEGER;
ALTER TABLE tasks ADD COLUMN completedFinishIndex INTEGER;
CREATE TABLE dependencies (
  id TEXT PRIMARY KEY,
  projectId TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  predecessorId TEXT NOT NULL,
  successorId TEXT NOT NULL,
  CHECK(predecessorId <> successorId),
  UNIQUE(projectId,predecessorId,successorId),
  FOREIGN KEY(projectId,predecessorId) REFERENCES tasks(projectId,id) DEFERRABLE INITIALLY DEFERRED,
  FOREIGN KEY(projectId,successorId) REFERENCES tasks(projectId,id) DEFERRABLE INITIALLY DEFERRED
) STRICT;
CREATE INDEX dependencies_project ON dependencies(projectId);
DELETE FROM operations;
DELETE FROM undo_snapshots;
