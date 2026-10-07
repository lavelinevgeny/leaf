import type Database from 'better-sqlite3';
import { createHash } from 'node:crypto';
import { z } from 'zod';
import {
  projectTreeV2Schema,
  frozenPendingScheduleV2Schema,
  taskV2Schema,
  type ProjectTreeV2,
  type SourceFields,
} from '../shared/contracts.js';
import { canonical } from '../shared/canonical.js';
import { projectLegacyPendingSchedule } from './legacy-pending-projection.js';
import { realInterval } from './legacy-pending-source.js';
import {
  privateSnapshotV2Schema,
  type PrivateSnapshotV2,
} from './optional-snapshot.js';
import type { LegacyContextRecord } from './optional-migration.js';
import { calculateLegacySchedule } from './legacy-scheduling.js';
import { indexToDate, nextWorkingDay } from './legacy-calendar.js';
import { DomainError } from '../domain/tree.js';
import {
  LegacySnapshotSchema,
  LegacyTreeSchema,
  type LegacyTask,
} from './legacy-contracts.js';

export type SnapshotContext = {
  kind: 'active' | 'operation' | 'undo';
  key: string;
};
export type LegacyResolution = {
  context: SnapshotContext;
  taskId: string;
  legacyDigest: string;
  contextDigest: string;
  source: SourceFields;
  outcome: 'source' | 'materialized-auto' | 'materialized-done' | 'unavailable';
};
export type ResolutionIndex = ReadonlyMap<string, LegacyResolution>;

export function resolutionKey(
  context: SnapshotContext,
  taskId: string,
): string {
  return canonical([context.kind, context.key, taskId]);
}
function digestLegacyTask(task: LegacyTask): string {
  return createHash('sha256').update(canonical(task)).digest('hex');
}
function invalidLegacySnapshot(): never {
  throw new DomainError(
    'INVALID_LEGACY_SNAPSHOT',
    'Неверный прежний снимок плана.',
  );
}
function policyRequired(): never {
  throw new DomainError(
    'MIGRATION_POLICY_REQUIRED',
    'Требуется согласованная политика переноса прежнего плана.',
  );
}
function ambiguous(task: LegacyTask): boolean {
  return (
    task.planMode === 'auto' ||
    (task.status === 'done' &&
      [
        task.completedStart,
        task.completedFinish,
        task.completedStartIndex,
        task.completedFinishIndex,
      ].some((value) => value !== null))
  );
}
function sourceFor(
  task: LegacyTask,
  context: SnapshotContext,
  resolutions: ResolutionIndex,
  contextDigest: string,
): SourceFields {
  const resolution = resolutions.get(resolutionKey(context, task.id));
  if (!resolution) {
    if (ambiguous(task)) policyRequired();
    return {
      inputStart: task.inputStart,
      inputFinish: task.inputFinish,
      durationDays: task.durationDays,
    };
  }
  if (
    resolution.context.kind !== context.kind ||
    resolution.context.key !== context.key ||
    resolution.taskId !== task.id ||
    resolution.legacyDigest !== digestLegacyTask(task) ||
    resolution.contextDigest !== contextDigest ||
    ![
      'source',
      'materialized-auto',
      'materialized-done',
      'unavailable',
    ].includes(resolution.outcome)
  )
    policyRequired();
  // Scalar validation only: historical calendar/source contradictions are
  // preserved and diagnosed by scheduling, rather than rejected as new input.
  const source = taskV2Schema
    .pick({ inputStart: true, inputFinish: true, durationDays: true })
    .safeParse(resolution.source);
  if (
    !source.success ||
    source.data.durationDays !== task.durationDays ||
    ((resolution.outcome === 'unavailable' || !ambiguous(task)) &&
      (source.data.inputStart !== task.inputStart ||
        source.data.inputFinish !== task.inputFinish))
  )
    policyRequired();
  return source.data;
}
// A full own-context recomputation avoids trusting a cached result whose
// provenance cannot be proved. In particular, current origins never enter history.
export function resolveLegacySources(
  contexts: readonly LegacyContextRecord[],
): ResolutionIndex {
  const index = new Map<string, LegacyResolution>();
  for (const { context, snapshot } of contexts) {
    const legacy = LegacySnapshotSchema.parse(snapshot);
    const schedule = calculateLegacySchedule(legacy);
    const contextDigest = createHash('sha256')
      .update(canonical(legacy))
      .digest('hex');
    for (const task of legacy.tasks) {
      let source: SourceFields = {
        inputStart: task.inputStart,
        inputFinish: task.inputFinish,
        durationDays: task.durationDays,
      };
      let outcome: LegacyResolution['outcome'] = 'source';
      const absoluteDone =
        task.status === 'done' &&
        (task.completedStart !== null || task.completedFinish !== null);
      const relativeDone =
        task.status === 'done' &&
        (task.completedStartIndex !== null ||
          task.completedFinishIndex !== null);
      if (absoluteDone) {
        if (task.completedStart !== null && task.completedFinish !== null) {
          source = {
            ...source,
            inputStart: task.completedStart,
            inputFinish: task.completedFinish,
          };
          outcome = 'materialized-done';
        } else outcome = 'unavailable';
      } else if (relativeDone) {
        outcome = 'unavailable';
        if (
          legacy.project.startDate !== null &&
          task.completedStartIndex !== null &&
          task.completedFinishIndex !== null &&
          task.completedFinishIndex > task.completedStartIndex
        ) {
          try {
            const origin = nextWorkingDay(
              legacy.project.startDate,
              legacy.project.calendarType,
            );
            source = {
              ...source,
              inputStart: indexToDate(
                task.completedStartIndex,
                origin,
                legacy.project.calendarType,
              ),
              inputFinish: indexToDate(
                task.completedFinishIndex - 1,
                origin,
                legacy.project.calendarType,
              ),
            };
            outcome = 'materialized-done';
          } catch (error) {
            if (!(error instanceof RangeError)) throw error;
          }
        }
      } else if (task.planMode === 'auto') {
        const old = schedule.tasks[task.id];
        const candidate = {
          ...source,
          inputStart: old?.startDate ?? null,
          inputFinish: old?.finishDate ?? null,
        };
        if (realInterval(candidate, legacy.project.calendarType) !== null) {
          source = candidate;
          outcome = 'materialized-auto';
        } else outcome = 'unavailable';
      }
      const key = resolutionKey(context, task.id);
      if (index.has(key)) policyRequired();
      index.set(key, {
        context,
        taskId: task.id,
        legacyDigest: digestLegacyTask(task),
        contextDigest,
        source,
        outcome,
      });
    }
  }
  return index;
}

export function projectLegacySnapshot(
  value: unknown,
  context: SnapshotContext,
  resolutions: ResolutionIndex,
): PrivateSnapshotV2 {
  const parsed = LegacySnapshotSchema.safeParse(value);
  if (!parsed.success) invalidLegacySnapshot();
  const { project, tasks, dependencies } = parsed.data;
  const contextDigest = createHash('sha256')
    .update(canonical(parsed.data))
    .digest('hex');
  if (
    tasks.some((task) => task.projectId !== project.id) ||
    dependencies.some((edge) => edge.projectId !== project.id)
  )
    invalidLegacySnapshot();
  return privateSnapshotV2Schema.parse({
    legacyIntervalUnavailable: tasks
      .filter(
        (task) =>
          resolutions.get(resolutionKey(context, task.id))?.outcome ===
          'unavailable',
      )
      .map((task) => task.id)
      .sort(),
    project: {
      id: project.id,
      title: project.title,
      revision: project.revision,
      calendarType: project.calendarType,
      timezone: project.timezone,
      createdAt: project.createdAt,
      updatedAt: project.updatedAt,
    },
    tasks: tasks.map((task) => ({
      id: task.id,
      projectId: task.projectId,
      parentId: task.parentId,
      title: task.title,
      description: task.description,
      sortOrder: task.sortOrder,
      status: task.status,
      ...sourceFor(task, context, resolutions, contextDigest),
      createdAt: task.createdAt,
      updatedAt: task.updatedAt,
    })),
    dependencies: dependencies.map((edge) => ({
      id: edge.id,
      projectId: edge.projectId,
      predecessorId: edge.predecessorId,
      successorId: edge.successorId,
    })),
  });
}
export function adaptLegacyTree(
  value: unknown,
  context: SnapshotContext,
  resolutions: ResolutionIndex,
): ProjectTreeV2 {
  const parsed = LegacyTreeSchema.safeParse(value);
  if (!parsed.success) invalidLegacySnapshot();
  const { project, tasks, dependencies } = parsed.data;
  const snapshot = projectLegacySnapshot(
    { project, tasks, dependencies },
    context,
    resolutions,
  );
  const pendingParsed = frozenPendingScheduleV2Schema.safeParse(
    projectLegacyPendingSchedule({
      calendarType: snapshot.project.calendarType,
      tasks: snapshot.tasks,
      dependencies: snapshot.dependencies,
      unavailableTaskIds: snapshot.legacyIntervalUnavailable,
    }),
  );
  if (!pendingParsed.success)
    throw new Error('Invalid frozen legacy schedule response');
  return projectTreeV2Schema.parse({
    contractVersion: 2,
    project: snapshot.project,
    tasks: snapshot.tasks,
    dependencies: snapshot.dependencies,
    canUndo: parsed.data.canUndo,
    schedule: pendingParsed.data,
  });
}

const legacyReplayIdentitySchema = z
  .object({ operationId: z.uuid() })
  .passthrough();
const frozenOperationSchema = z.strictObject({
  projectId: z.string(),
  sessionId: z.string(),
  payload: z.string(),
  contractVersion: z.number().int(),
  response: z.string(),
  responseContractVersion: z.number().int(),
  responseSha256: z.string(),
});
function findOperation(db: Database.Database, operationId: string) {
  const row = db
    .prepare(
      'SELECT projectId,sessionId,payload,contractVersion,response,responseContractVersion,responseSha256 FROM operations WHERE operationId=?',
    )
    .get(operationId);
  if (row === undefined) return undefined;
  const parsed = frozenOperationSchema.safeParse(row);
  if (!parsed.success) throw new Error('Invalid frozen operation response');
  return parsed.data;
}
export function replayLegacyOperation(
  db: Database.Database,
  projectId: string,
  sessionId: string,
  body: unknown,
): ProjectTreeV2 {
  const identity = legacyReplayIdentitySchema.parse(body);
  const row = findOperation(db, identity.operationId);
  if (!row || row.contractVersion !== 1)
    throw new DomainError(
      'LEGACY_REPLAY_NOT_FOUND',
      'Прежняя операция не найдена. Проверьте актуальный проект.',
      409,
    );
  if (
    row.projectId !== projectId ||
    row.sessionId !== sessionId ||
    row.payload !== canonical(body)
  )
    throw new DomainError(
      'OPERATION_REUSED',
      'Идентификатор операции уже использован.',
      409,
    );
  if (
    row.responseContractVersion !== 2 ||
    createHash('sha256').update(row.response).digest('hex') !==
      row.responseSha256
  )
    throw new Error('Invalid frozen operation response');
  let response: unknown;
  try {
    response = JSON.parse(row.response);
  } catch {
    throw new Error('Invalid frozen operation response');
  }
  const parsed = projectTreeV2Schema.safeParse(response);
  if (!parsed.success) throw new Error('Invalid frozen operation response');
  return parsed.data;
}
