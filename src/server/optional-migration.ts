import type Database from 'better-sqlite3';
import { createHash } from 'node:crypto';
import { z } from 'zod';
import { canonical } from '../shared/canonical.js';
import { DomainError } from '../domain/tree.js';
import { validateSourceInput } from './legacy-pending-source.js';
import {
  LegacyProjectSchema,
  LegacyTaskSchema,
  LegacyDependencySchema,
  LegacySnapshotSchema,
  LegacyTreeSchema,
  LegacyOperationPayloadSchema,
} from './legacy-contracts.js';
import {
  adaptLegacyTree,
  projectLegacySnapshot,
  resolutionKey,
  type ResolutionIndex,
  type SnapshotContext,
} from './legacy-compatibility.js';

export interface LegacyContextRecord {
  context: SnapshotContext;
  snapshot: z.infer<typeof LegacySnapshotSchema>;
}
const projectColumns =
  'id,title,revision,startDate,calendarType,timezone,createdAt,updatedAt';
const taskColumns =
  'id,projectId,parentId,title,description,sortOrder,status,planMode,inputStart,inputFinish,durationDays,notBefore,deadline,completedStart,completedFinish,completedStartIndex,completedFinishIndex,createdAt,updatedAt';
const operationSchema = z.strictObject({
  operationId: z.uuid(),
  projectId: z.uuid(),
  payload: z.string(),
  response: z.string(),
});
const undoSchema = z.strictObject({
  sequence: z.number().int().positive(),
  projectId: z.uuid(),
  beforeSnapshot: z.string(),
  afterRevision: z.number().int().nonnegative(),
});
const sha = (text: string): string =>
  createHash('sha256').update(text).digest('hex');
const sqlDigest =
  'daf89b5c9459da428ae10f74368ba19e9530a7f34bc6d63d9a69566868085191';
function invalidSnapshot(): never {
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
function parse<T>(schema: z.ZodType<T>, value: unknown): T {
  const result = schema.safeParse(value);
  if (!result.success) invalidSnapshot();
  return result.data;
}
function json(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return invalidSnapshot();
  }
}
export function loadLegacyOriginals(db: Database.Database) {
  const projects = parse(
    z.array(LegacyProjectSchema),
    db.prepare(`SELECT ${projectColumns} FROM projects ORDER BY id`).all(),
  );
  const tasks = parse(
    z.array(LegacyTaskSchema),
    db
      .prepare(
        `SELECT ${taskColumns} FROM tasks ORDER BY projectId,parentId,sortOrder,id`,
      )
      .all(),
  );
  const dependencies = parse(
    z.array(LegacyDependencySchema),
    db
      .prepare(
        'SELECT id,projectId,predecessorId,successorId FROM dependencies ORDER BY projectId,id',
      )
      .all(),
  );
  const operations = parse(
    z.array(operationSchema),
    db
      .prepare(
        'SELECT operationId,projectId,payload,response FROM operations ORDER BY operationId',
      )
      .all(),
  );
  const undo = parse(
    z.array(undoSchema),
    db
      .prepare(
        'SELECT sequence,projectId,beforeSnapshot,afterRevision FROM undo_snapshots ORDER BY sequence',
      )
      .all(),
  );
  const projectIds = new Set(projects.map((project) => project.id));
  if (
    [...tasks, ...dependencies, ...operations, ...undo].some(
      (row) => !projectIds.has(row.projectId),
    )
  )
    invalidSnapshot();
  return { projects, tasks, dependencies, operations, undo };
}
function contexts(
  rows: ReturnType<typeof loadLegacyOriginals>,
): LegacyContextRecord[] {
  const result: LegacyContextRecord[] = rows.projects.map((project) => ({
    context: { kind: 'active', key: project.id },
    snapshot: {
      project,
      tasks: rows.tasks.filter((task) => task.projectId === project.id),
      dependencies: rows.dependencies.filter(
        (edge) => edge.projectId === project.id,
      ),
    },
  }));
  for (const operation of rows.operations) {
    const payload = parse(
      LegacyOperationPayloadSchema,
      json(operation.payload),
    );
    if (payload.operationId !== operation.operationId) invalidSnapshot();
    const tree = parse(LegacyTreeSchema, json(operation.response));
    if (tree.project.id !== operation.projectId) invalidSnapshot();
    result.push({
      context: { kind: 'operation', key: operation.operationId },
      snapshot: {
        project: tree.project,
        tasks: tree.tasks,
        dependencies: tree.dependencies,
      },
    });
  }
  for (const undo of rows.undo) {
    const snapshot = parse(LegacySnapshotSchema, json(undo.beforeSnapshot));
    if (snapshot.project.id !== undo.projectId) invalidSnapshot();
    result.push({
      context: { kind: 'undo', key: String(undo.sequence) },
      snapshot,
    });
  }
  for (const { snapshot } of result)
    if (
      [...snapshot.tasks, ...snapshot.dependencies].some(
        (row) => row.projectId !== snapshot.project.id,
      )
    )
      invalidSnapshot();
  return result;
}
export function loadLegacyContexts(
  db: Database.Database,
): LegacyContextRecord[] {
  return contexts(loadLegacyOriginals(db));
}
export function migrationCategoryCounts(db: Database.Database): {
  auto: number;
  completedAbsolute: number;
  completedRelative: number;
  inconsistent: number;
} {
  const counts = {
    auto: 0,
    completedAbsolute: 0,
    completedRelative: 0,
    inconsistent: 0,
  };
  // Counts include every historical occurrence, including deleted tasks.
  for (const { snapshot } of loadLegacyContexts(db)) {
    for (const task of snapshot.tasks) {
      if (task.planMode === 'auto') counts.auto++;
      const absolute =
        task.status === 'done' &&
        (task.completedStart !== null || task.completedFinish !== null);
      const relative =
        task.status === 'done' &&
        (task.completedStartIndex !== null ||
          task.completedFinishIndex !== null);
      if (absolute) counts.completedAbsolute++;
      if (relative) counts.completedRelative++;
      let inconsistent = task.planMode === 'auto' && task.durationDays === null;
      try {
        validateSourceInput(task, snapshot.project.calendarType);
        if (absolute) {
          if (task.completedStart === null || task.completedFinish === null)
            inconsistent = true;
          else
            validateSourceInput(
              {
                inputStart: task.completedStart,
                inputFinish: task.completedFinish,
                durationDays: task.durationDays,
              },
              snapshot.project.calendarType,
            );
        }
      } catch (error) {
        if (!(error instanceof DomainError)) throw error;
        inconsistent = true;
      }
      if (
        relative &&
        (task.completedStartIndex === null ||
          task.completedFinishIndex === null ||
          task.completedFinishIndex <= task.completedStartIndex)
      )
        inconsistent = true;
      if (inconsistent) counts.inconsistent++;
    }
  }
  return counts;
}

// Preparation is deliberately inactive. Task 5 registers this only after the
// accepted policy resolver and preview acknowledgement have passed review.
export function prepareOptionalMigration(
  db: Database.Database,
  migrationSql: string,
  resolutions: ResolutionIndex,
): void {
  if (!db.inTransaction)
    throw new Error('Optional migration requires an outer transaction');
  const parts = migrationSql.split('\n-- APPLY_AFTER_ARCHIVE\n');
  if (parts.length !== 2 || sha(migrationSql) !== sqlDigest)
    throw new Error('Invalid optional migration SQL');
  const versions = parse(
    z.array(z.strictObject({ version: z.number().int() })),
    db.prepare('SELECT version FROM migrations ORDER BY version').all(),
  );
  if (
    versions.length < 2 ||
    versions.length > 3 ||
    versions.some((row, index) => row.version !== index + 1)
  )
    throw new Error('Unsupported database schema');
  if (versions.length === 3) return;
  const rows = loadLegacyOriginals(db);
  const legacyContexts = contexts(rows);
  const validResolutionKeys = new Set(
    legacyContexts.flatMap(({ context, snapshot }) =>
      snapshot.tasks.map((task) => resolutionKey(context, task.id)),
    ),
  );
  for (const [key, resolution] of resolutions)
    if (
      !validResolutionKeys.has(key) ||
      key !== resolutionKey(resolution.context, resolution.taskId)
    )
      policyRequired();
  // Parse all originals and finish every projection before any DDL or writes.
  for (const operation of rows.operations) {
    const payload = parse(
      LegacyOperationPayloadSchema,
      json(operation.payload),
    );
    if (payload.operationId !== operation.operationId) invalidSnapshot();
  }
  const snapshots = new Map(
    legacyContexts.map(({ context, snapshot }) => [
      resolutionKey(context, ''),
      projectLegacySnapshot(snapshot, context, resolutions),
    ]),
  );
  const responses = rows.operations.map((operation) => ({
    operationId: operation.operationId,
    response: JSON.stringify(
      adaptLegacyTree(
        json(operation.response),
        { kind: 'operation', key: operation.operationId },
        resolutions,
      ),
    ),
  }));
  const undos = rows.undo.map((undo) => ({
    sequence: undo.sequence,
    beforeSnapshot: JSON.stringify(
      snapshots.get(
        resolutionKey({ kind: 'undo', key: String(undo.sequence) }, ''),
      )!,
    ),
  }));

  db.exec(parts[0]!);
  const insert = db.prepare(
    'INSERT INTO scheduling_migration_archive(projectId,kind,recordKey,sourceSchemaVersion,originalText,sha256) VALUES (?,?,?,2,?,?)',
  );
  const archive = (
    projectId: string,
    kind: string,
    key: string,
    text: string,
  ) => insert.run(projectId, kind, key, text, sha(text));
  for (const project of rows.projects)
    archive(project.id, 'project', project.id, JSON.stringify(project));
  for (const task of rows.tasks)
    archive(task.projectId, 'task', task.id, JSON.stringify(task));
  for (const operation of rows.operations) {
    archive(
      operation.projectId,
      'operation-payload',
      operation.operationId,
      operation.payload,
    );
    archive(
      operation.projectId,
      'operation-response',
      operation.operationId,
      operation.response,
    );
  }
  for (const undo of rows.undo)
    archive(
      undo.projectId,
      'undo-snapshot',
      String(undo.sequence),
      undo.beforeSnapshot,
    );
  for (const { context, snapshot } of legacyContexts)
    for (const task of snapshot.tasks) {
      const key = resolutionKey(context, task.id);
      const resolution = resolutions.get(key);
      if (resolution)
        archive(snapshot.project.id, 'resolution', key, canonical(resolution));
    }
  db.exec(parts[1]!);
  const updateSource = db.prepare(
    'UPDATE tasks SET inputStart=@inputStart,inputFinish=@inputFinish,durationDays=@durationDays WHERE id=@id AND projectId=@projectId',
  );
  for (const { context } of legacyContexts) {
    if (context.kind !== 'active') continue;
    for (const task of snapshots.get(resolutionKey(context, ''))!.tasks)
      updateSource.run(task);
  }
  const insertProvenance = db.prepare(
    "INSERT INTO task_schedule_provenance(taskId,reason) VALUES (?, 'legacy-interval-unavailable')",
  );
  for (const { context } of legacyContexts) {
    if (context.kind !== 'active') continue;
    for (const id of snapshots.get(resolutionKey(context, ''))!
      .legacyIntervalUnavailable)
      insertProvenance.run(id);
  }
  const updateResponse = db.prepare(
    'UPDATE operations SET response=?,responseContractVersion=2,responseSha256=? WHERE operationId=?',
  );
  for (const { operationId, response } of responses)
    updateResponse.run(response, sha(response), operationId);
  const updateUndo = db.prepare(
    'UPDATE undo_snapshots SET beforeSnapshot=? WHERE sequence=?',
  );
  for (const undo of undos) updateUndo.run(undo.beforeSnapshot, undo.sequence);
}
