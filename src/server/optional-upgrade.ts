import type Database from 'better-sqlite3';
import { createHash } from 'node:crypto';
import { canonical } from '../shared/canonical.js';
import { DomainError } from '../domain/tree.js';
import { realInterval, validateSourceInput } from '../domain/planning.js';
import { calculateSchedule } from '../domain/scheduling.js';
import {
  loadLegacyContexts,
  loadLegacyOriginals,
} from './optional-migration.js';
import {
  projectLegacySnapshot,
  resolveLegacySources,
  resolutionKey,
} from './legacy-compatibility.js';

export type OptionalUpgradeApproval = {
  policyId: 'legacy-scheduling-v1';
  previewDigest: string;
};
export type OptionalUpgradePreview = OptionalUpgradeApproval & {
  counts: {
    sourceIntervals: number;
    materializedAuto: number;
    materializedDone: number;
    unavailableAbsolute: number;
    replacedDoneSource: number;
    invalid: number;
    fsConflicts: number;
    unavailableHistory: number;
  };
};

function preview(db: Database.Database): OptionalUpgradePreview {
  const versions = db
    .prepare('SELECT version FROM migrations ORDER BY version')
    .all() as { version: number }[];
  if (canonical(versions) !== canonical([{ version: 1 }, { version: 2 }]))
    throw new Error('Unsupported database schema for legacy preview');
  const originals = loadLegacyOriginals(db);
  const contexts = loadLegacyContexts(db);
  const resolutions = resolveLegacySources(contexts);
  const counts: OptionalUpgradePreview['counts'] = {
    sourceIntervals: 0,
    materializedAuto: 0,
    materializedDone: 0,
    unavailableAbsolute: 0,
    replacedDoneSource: 0,
    invalid: 0,
    fsConflicts: 0,
    unavailableHistory: 0,
  };
  for (const { context, snapshot } of contexts) {
    const projected = projectLegacySnapshot(snapshot, context, resolutions);
    for (const task of snapshot.tasks) {
      const resolution = resolutions.get(resolutionKey(context, task.id))!;
      if (
        resolution.outcome === 'source' &&
        realInterval(resolution.source, snapshot.project.calendarType) !== null
      )
        counts.sourceIntervals++;
      if (resolution.outcome === 'materialized-auto') counts.materializedAuto++;
      if (resolution.outcome === 'materialized-done') {
        counts.materializedDone++;
        if (
          (task.inputStart !== null || task.inputFinish !== null) &&
          (task.inputStart !== resolution.source.inputStart ||
            task.inputFinish !== resolution.source.inputFinish)
        )
          counts.replacedDoneSource++;
      }
      if (resolution.outcome === 'unavailable') {
        counts.unavailableAbsolute++;
        if (context.kind !== 'active') counts.unavailableHistory++;
      }
      let invalid = false;
      for (const source of [task, resolution.source]) {
        try {
          validateSourceInput(source, snapshot.project.calendarType);
        } catch (error) {
          if (!(error instanceof DomainError)) throw error;
          invalid = true;
        }
      }
      if (
        task.status === 'done' &&
        ((task.completedStart === null) !== (task.completedFinish === null) ||
          (task.completedStartIndex === null) !==
            (task.completedFinishIndex === null) ||
          (task.completedStartIndex !== null &&
            task.completedFinishIndex !== null &&
            task.completedFinishIndex <= task.completedStartIndex))
      )
        invalid = true;
      if (task.planMode === 'auto' && task.durationDays === null)
        invalid = true;
      if (invalid) counts.invalid++;
    }
    const result = calculateSchedule({
      calendarType: projected.project.calendarType,
      tasks: projected.tasks,
      dependencies: projected.dependencies,
      unavailableTaskIds: projected.legacyIntervalUnavailable,
    });
    counts.fsConflicts += result.diagnostics.filter(
      (item) => item.code === 'EXPLICIT_PRECEDENCE_CONFLICT',
    ).length;
  }
  return {
    policyId: 'legacy-scheduling-v1',
    previewDigest: createHash('sha256')
      .update(
        canonical({ policyId: 'legacy-scheduling-v1', versions, ...originals }),
      )
      .digest('hex'),
    counts,
  };
}
// Transaction gives a consistent original snapshot without DDL or active writes.
export function previewOptionalUpgrade(
  db: Database.Database,
): OptionalUpgradePreview {
  return db.inTransaction ? preview(db) : db.transaction(() => preview(db))();
}
// Caller must own the IMMEDIATE migration transaction; this function never
// commits it. Invoke before prepareOptionalMigration and before any other DDL.
export function requireOptionalUpgradeApproval(
  db: Database.Database,
  approval: OptionalUpgradeApproval | undefined,
): void {
  if (!db.inTransaction)
    throw new Error('Optional upgrade requires an outer immediate transaction');
  if (!approval || approval.policyId !== 'legacy-scheduling-v1')
    throw new DomainError(
      'MIGRATION_APPROVAL_REQUIRED',
      'MIGRATION_APPROVAL_REQUIRED: Требуется подтверждение предварительного просмотра миграции.',
    );
  if (previewOptionalUpgrade(db).previewDigest !== approval.previewDigest)
    throw new DomainError(
      'MIGRATION_PREVIEW_CHANGED',
      'MIGRATION_PREVIEW_CHANGED: Данные изменились после предварительного просмотра.',
    );
}
