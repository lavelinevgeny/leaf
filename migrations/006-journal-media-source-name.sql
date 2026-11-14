-- Preserve the immutable safe source name independently of normalized WebP names.
-- Schema005 had no upload route; an existing row can only be backfilled from its
-- saved name. No reconstruction of historical source names is claimed.
ALTER TABLE journal_media ADD COLUMN sourceFileName TEXT NOT NULL DEFAULT 'attachment'
  CHECK(length(CAST(sourceFileName AS BLOB)) BETWEEN 1 AND 255);
UPDATE journal_media SET sourceFileName=fileName;
