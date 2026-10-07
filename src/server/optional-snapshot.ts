import { z } from 'zod';
import {
  snapshotV2Schema,
  sourcePatchSchema,
  type SourcePatch,
  type TaskV2,
} from '../shared/optional-contracts.js';
import {
  applySourcePatch,
  validateSourceInput,
} from '../domain/optional-planning.js';
import type { CalendarType } from '../domain/scheduling-types.js';
import { DomainError } from '../domain/tree.js';

// Private persistence only. Never spread this object into a public tree DTO.
export const privateSnapshotV2Schema = snapshotV2Schema
  .extend({
    legacyIntervalUnavailable: z.array(z.uuid()),
  })
  .superRefine((snapshot, ctx) => {
    const ids = new Set(snapshot.tasks.map((task) => task.id));
    if (
      new Set(snapshot.legacyIntervalUnavailable).size !==
        snapshot.legacyIntervalUnavailable.length ||
      snapshot.legacyIntervalUnavailable.some((id) => !ids.has(id)) ||
      snapshot.tasks.some((task) => task.projectId !== snapshot.project.id) ||
      snapshot.dependencies.some(
        (edge) => edge.projectId !== snapshot.project.id,
      )
    )
      ctx.addIssue({
        code: 'custom',
        message: 'Invalid private scheduling provenance',
      });
  });
export type PrivateSnapshotV2 = z.infer<typeof privateSnapshotV2Schema>;

// Task 5 uses this at the validated source-edit seam, inside its transaction.
// Equal explicit values still acknowledge a previously unavailable interval.
export function applyPrivateSourcePatch(
  task: TaskV2,
  patch: SourcePatch,
  calendar: CalendarType,
  unavailable: boolean,
  reopenedStatus?: 'todo' | 'doing',
): { task: TaskV2; unavailable: boolean } {
  const value = sourcePatchSchema.parse(patch);
  const parsed: SourcePatch = {};
  if (value.inputStart !== undefined) parsed.inputStart = value.inputStart;
  if (value.inputFinish !== undefined) parsed.inputFinish = value.inputFinish;
  if (value.durationDays !== undefined)
    parsed.durationDays = value.durationDays;
  const explicit = Object.keys(parsed).length > 0;
  if (explicit && task.status === 'done' && reopenedStatus === undefined)
    throw new DomainError(
      'DONE_PLAN_LOCKED',
      'Сначала верните завершённую работу в работу.',
    );
  const next = applySourcePatch(task, parsed, calendar);
  if (unavailable && explicit) validateSourceInput(next, calendar);
  return {
    task: { ...next, ...(reopenedStatus ? { status: reopenedStatus } : {}) },
    unavailable: unavailable && !explicit,
  };
}
