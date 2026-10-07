import { z } from 'zod';
import {
  calendarDateSchema,
  uuidSchema,
  taskTitleSchema,
  projectTitleSchema,
  calendarTypeSchema,
  timezoneSchema,
} from './contracts.js';

export type SourceFields = {
  inputStart: string | null;
  inputFinish: string | null;
  durationDays: number | null;
};
export type SourcePatch = Partial<SourceFields>;

export const sourceFieldsSchema = z.strictObject({
  inputStart: calendarDateSchema.nullable(),
  inputFinish: calendarDateSchema.nullable(),
  durationDays: z.number().int().min(1).max(1000000).nullable(),
});
export const sourcePatchSchema = sourceFieldsSchema.partial();
export const optionalEditSchema = z.strictObject({
  type: z.literal('task.edit'),
  taskId: uuidSchema,
  changes: z
    .strictObject({
      title: taskTitleSchema.optional(),
      description: z.string().max(10000).optional(),
      status: z.enum(['todo', 'doing', 'done']).optional(),
      inputStart: calendarDateSchema.nullable().optional(),
      inputFinish: calendarDateSchema.nullable().optional(),
      durationDays: z.number().int().min(1).max(1000000).nullable().optional(),
    })
    .refine((value) => Object.keys(value).length > 0, 'Empty changes'),
});

const statusV2Schema = z.enum(['todo', 'doing', 'done']);
const timestampV2Schema = z.iso.datetime();
export const projectV2Schema = z.strictObject({
  id: uuidSchema,
  title: projectTitleSchema,
  revision: z.number().int().nonnegative(),
  calendarType: calendarTypeSchema,
  timezone: timezoneSchema,
  createdAt: timestampV2Schema,
  updatedAt: timestampV2Schema,
});
export const taskV2Schema = z.strictObject({
  id: uuidSchema,
  projectId: uuidSchema,
  parentId: uuidSchema.nullable(),
  title: taskTitleSchema,
  description: z.string().max(10000),
  sortOrder: z.number().int().nonnegative(),
  status: statusV2Schema,
  inputStart: calendarDateSchema.nullable(),
  inputFinish: calendarDateSchema.nullable(),
  durationDays: z.number().int().positive().nullable(),
  createdAt: timestampV2Schema,
  updatedAt: timestampV2Schema,
});
export const dependencyV2Schema = z.strictObject({
  id: uuidSchema,
  projectId: uuidSchema,
  predecessorId: uuidSchema,
  successorId: uuidSchema,
});
const realTaskV2Schema = z.strictObject({
  startDate: calendarDateSchema.nullable(),
  finishDate: calendarDateSchema.nullable(),
  calendarSpanDays: z.number().int().positive().nullable(),
});
export const scheduleResultV2Schema = z.strictObject({
  analysisStatus: z.literal('pending-policy'),
  feasibility: z.enum(['feasible', 'incomplete', 'infeasible']),
  coverage: z.strictObject({
    knownLeafCount: z.number().int().nonnegative(),
    totalLeafCount: z.number().int().nonnegative(),
  }),
  tasks: z.record(uuidSchema, realTaskV2Schema),
  summaries: z.record(
    uuidSchema,
    realTaskV2Schema.extend({
      knownLeafCount: z.number().int().nonnegative(),
      totalLeafCount: z.number().int().nonnegative(),
    }),
  ),
  display: z.record(
    uuidSchema,
    z.strictObject({
      kind: z.literal('conditional'),
      startDate: calendarDateSchema,
      finishDate: calendarDateSchema,
      clipped: z.boolean(),
    }),
  ),
  criticalTaskIds: z.array(uuidSchema).length(0),
  criticalDependencyIds: z.array(uuidSchema).length(0),
  diagnostics: z.array(
    z.strictObject({
      code: z.string(),
      taskIds: z.array(uuidSchema),
      dependencyIds: z.array(uuidSchema),
      messageKey: z.string(),
    }),
  ),
});
export const snapshotV2Schema = z.strictObject({
  project: projectV2Schema,
  tasks: z.array(taskV2Schema),
  dependencies: z.array(dependencyV2Schema),
});
export const projectTreeV2Schema = snapshotV2Schema.extend({
  contractVersion: z.literal(2),
  canUndo: z.boolean(),
  schedule: scheduleResultV2Schema,
});
export const scheduleResponseV2Schema = z.strictObject({
  contractVersion: z.literal(2),
  projectId: uuidSchema,
  revision: z.number().int().nonnegative(),
  schedule: scheduleResultV2Schema,
});
const detailsPatchV2Schema = z
  .strictObject({
    title: taskTitleSchema.optional(),
    description: z.string().max(10000).optional(),
    status: statusV2Schema.optional(),
  })
  .refine((value) => Object.keys(value).length > 0, 'Empty changes');
export const commandV2Schema = z.discriminatedUnion('type', [
  optionalEditSchema,
  z.strictObject({
    type: z.literal('task.update'),
    taskId: uuidSchema,
    changes: detailsPatchV2Schema,
  }),
  z.strictObject({
    type: z.literal('task.create'),
    title: taskTitleSchema,
    parentId: uuidSchema.nullable(),
    afterId: uuidSchema.optional(),
    preserveWork: z.boolean().optional(),
  }),
  z.strictObject({
    type: z.literal('task.move'),
    taskId: uuidSchema,
    parentId: uuidSchema.nullable(),
    position: z.number().int().nonnegative(),
    preserveWork: z.boolean().optional(),
  }),
  z.strictObject({ type: z.literal('task.delete'), taskId: uuidSchema }),
  z.strictObject({
    type: z.literal('dependency.create'),
    predecessorId: uuidSchema,
    successorId: uuidSchema,
  }),
  z.strictObject({
    type: z.literal('dependency.delete'),
    dependencyId: uuidSchema,
  }),
  z.strictObject({ type: z.literal('undo') }),
  z.strictObject({
    type: z.literal('project.schedule'),
    changes: z
      .strictObject({
        calendarType: calendarTypeSchema.optional(),
        timezone: timezoneSchema.optional(),
      })
      .refine((value) => Object.keys(value).length > 0, 'Empty changes'),
  }),
]);
export const commandEnvelopeV2Schema = z.strictObject({
  contractVersion: z.literal(2),
  expectedRevision: z.number().int().nonnegative(),
  operationId: uuidSchema,
  command: commandV2Schema,
});
export const renameV2Schema = z.strictObject({
  contractVersion: z.literal(2),
  title: projectTitleSchema,
  expectedRevision: z.number().int().nonnegative(),
  operationId: uuidSchema,
});
export type ProjectV2 = z.infer<typeof projectV2Schema>;
export type TaskV2 = z.infer<typeof taskV2Schema>;
export type DependencyV2 = z.infer<typeof dependencyV2Schema>;
export type SnapshotV2 = z.infer<typeof snapshotV2Schema>;
export type ProjectTreeV2 = z.infer<typeof projectTreeV2Schema>;
export type CommandV2 = z.infer<typeof commandV2Schema>;
export type CommandEnvelopeV2 = z.infer<typeof commandEnvelopeV2Schema>;
export type RenameV2 = z.infer<typeof renameV2Schema>;
