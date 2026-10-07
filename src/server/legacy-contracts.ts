// Frozen S2 serialization. Keep independent of active and target contracts.
import { z } from 'zod';

const calendarDateSchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/)
  .refine((value) => {
    const year = Number(value.slice(0, 4));
    const month = Number(value.slice(5, 7));
    const day = Number(value.slice(8, 10));
    const leap = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
    const days = [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
    return (
      year >= 1 &&
      month >= 1 &&
      month <= 12 &&
      day >= 1 &&
      day <= (days[month - 1] ?? 0)
    );
  }, 'Invalid calendar date');
const uuidSchema = z.uuid();
// Validate the original title constraints without normalizing saved bytes.
const taskTitleSchema = z
  .string()
  .refine((value) => value.trim().length >= 1 && value.trim().length <= 300);
const projectTitleSchema = z
  .string()
  .refine((value) => value.trim().length >= 1 && value.trim().length <= 120);
const calendarTypeSchema = z.enum(['weekdays', 'all-days']);
const timezoneSchema = z
  .string()
  .max(100)
  .refine((value) => {
    try {
      new Intl.DateTimeFormat('en', { timeZone: value });
      return true;
    } catch {
      return false;
    }
  }, 'Invalid timezone');
const durationSchema = z.number().int().positive();
export const LegacyProjectSchema = z.strictObject({
  id: uuidSchema,
  title: projectTitleSchema,
  revision: z.number().int().nonnegative(),
  startDate: calendarDateSchema.nullable(),
  calendarType: calendarTypeSchema,
  timezone: timezoneSchema,
  createdAt: z.iso.datetime(),
  updatedAt: z.iso.datetime(),
});
export const LegacyTaskSchema = z.strictObject({
  id: uuidSchema,
  projectId: uuidSchema,
  parentId: uuidSchema.nullable(),
  title: taskTitleSchema,
  description: z.string().max(10000),
  sortOrder: z.number().int().nonnegative(),
  status: z.enum(['todo', 'doing', 'done']),
  planMode: z.enum(['unscheduled', 'auto', 'fixed']),
  durationDays: durationSchema.nullable(),
  notBefore: calendarDateSchema.nullable(),
  deadline: calendarDateSchema.nullable(),
  completedStart: calendarDateSchema.nullable(),
  completedFinish: calendarDateSchema.nullable(),
  completedStartIndex: z.number().int().nullable(),
  completedFinishIndex: z.number().int().nullable(),
  inputStart: calendarDateSchema.nullable(),
  inputFinish: calendarDateSchema.nullable(),
  createdAt: z.iso.datetime(),
  updatedAt: z.iso.datetime(),
});
export const LegacyDependencySchema = z.strictObject({
  id: uuidSchema,
  projectId: uuidSchema,
  predecessorId: uuidSchema,
  successorId: uuidSchema,
});
const nullableIndex = z.number().int().nullable();
const scheduleResultSchema = z.strictObject({
  feasibility: z.enum(['feasible', 'incomplete', 'infeasible']),
  originDate: calendarDateSchema.nullable(),
  projectFinishIndex: nullableIndex,
  coverage: z.strictObject({
    knownLeafCount: z.number().int().nonnegative(),
    totalLeafCount: z.number().int().nonnegative(),
  }),
  tasks: z.record(
    uuidSchema,
    z.strictObject({
      ES: nullableIndex,
      EF: nullableIndex,
      LS: nullableIndex,
      LF: nullableIndex,
      projectFloat: nullableIndex,
      constraintFloat: nullableIndex,
      startDate: calendarDateSchema.nullable(),
      finishDate: calendarDateSchema.nullable(),
      blockedReason: z.string().nullable(),
    }),
  ),
  summaries: z.record(
    uuidSchema,
    z.strictObject({
      start: nullableIndex,
      finish: nullableIndex,
      startDate: calendarDateSchema.nullable(),
      finishDate: calendarDateSchema.nullable(),
      partial: z.boolean(),
      containsCritical: z.boolean(),
    }),
  ),
  criticalTaskIds: z.array(uuidSchema),
  criticalDependencyIds: z.array(uuidSchema),
  diagnostics: z.array(
    z.strictObject({
      code: z.string(),
      taskIds: z.array(uuidSchema),
      dependencyIds: z.array(uuidSchema),
      messageKey: z.string(),
    }),
  ),
});

export const LegacySnapshotSchema = z.strictObject({
  project: LegacyProjectSchema,
  tasks: z.array(LegacyTaskSchema),
  dependencies: z.array(LegacyDependencySchema),
});
export const LegacyTreeSchema = LegacySnapshotSchema.extend({
  canUndo: z.boolean(),
  schedule: scheduleResultSchema,
});
export type LegacyTask = z.infer<typeof LegacyTaskSchema>;
export type LegacySnapshot = z.infer<typeof LegacySnapshotSchema>;
export type LegacyTree = z.infer<typeof LegacyTreeSchema>;

// Frozen request validation checks the original envelope without normalizing
// titles, stripping fields or substituting the target command vocabulary.
const LegacyTaskPlanSchema = z.discriminatedUnion('mode', [
  z.strictObject({
    mode: z.literal('unscheduled'),
    inputStart: calendarDateSchema.nullable().optional(),
    inputFinish: calendarDateSchema.nullable().optional(),
    deadline: calendarDateSchema.nullable().optional(),
  }),
  z.strictObject({
    mode: z.literal('auto'),
    durationDays: durationSchema.max(1000000),
    notBefore: calendarDateSchema.nullable().optional(),
    deadline: calendarDateSchema.nullable().optional(),
  }),
  z.strictObject({
    mode: z.literal('fixed'),
    inputStart: calendarDateSchema,
    inputFinish: calendarDateSchema,
    deadline: calendarDateSchema.nullable().optional(),
  }),
]);
const LegacyTaskChangesSchema = z
  .strictObject({
    title: taskTitleSchema.optional(),
    description: z.string().max(10000).optional(),
    status: z.enum(['todo', 'doing', 'done']).optional(),
    inputStart: calendarDateSchema.nullable().optional(),
    inputFinish: calendarDateSchema.nullable().optional(),
  })
  .refine((changes) => Object.keys(changes).length > 0, 'Empty changes');
const LegacyCommandSchema = z.discriminatedUnion('type', [
  z
    .strictObject({
      type: z.literal('task.edit'),
      taskId: uuidSchema,
      changes: z.strictObject({
        title: taskTitleSchema.optional(),
        description: z.string().max(10000).optional(),
        status: z.enum(['todo', 'doing', 'done']).optional(),
      }),
      plan: LegacyTaskPlanSchema.optional(),
    })
    .refine(
      (edit) => edit.plan !== undefined || Object.keys(edit.changes).length > 0,
      'Empty edit',
    ),
  z.strictObject({
    type: z.literal('project.schedule'),
    changes: z
      .strictObject({
        startDate: calendarDateSchema.nullable().optional(),
        calendarType: calendarTypeSchema.optional(),
        timezone: timezoneSchema.optional(),
      })
      .refine((changes) => Object.keys(changes).length > 0, 'Empty changes'),
  }),
  z.strictObject({
    type: z.literal('task.plan'),
    taskId: uuidSchema,
    plan: LegacyTaskPlanSchema,
  }),
  z.strictObject({
    type: z.literal('dependency.create'),
    predecessorId: uuidSchema,
    successorId: uuidSchema,
  }),
  z.strictObject({
    type: z.literal('dependency.delete'),
    dependencyId: uuidSchema,
  }),
  z.strictObject({
    type: z.literal('task.create'),
    title: taskTitleSchema,
    parentId: uuidSchema.nullable(),
    afterId: uuidSchema.optional(),
    preserveWork: z.boolean().optional(),
  }),
  z.strictObject({
    type: z.literal('task.update'),
    taskId: uuidSchema,
    changes: LegacyTaskChangesSchema,
  }),
  z.strictObject({
    type: z.literal('task.move'),
    taskId: uuidSchema,
    parentId: uuidSchema.nullable(),
    position: z.number().int().nonnegative(),
    preserveWork: z.boolean().optional(),
  }),
  z.strictObject({ type: z.literal('task.delete'), taskId: uuidSchema }),
  z.strictObject({ type: z.literal('undo') }),
]);
export const LegacyCommandEnvelopeSchema = z.strictObject({
  expectedRevision: z.number().int().nonnegative(),
  operationId: uuidSchema,
  command: LegacyCommandSchema,
});
export const LegacyRenameEnvelopeSchema = z.strictObject({
  title: projectTitleSchema,
  expectedRevision: z.number().int().nonnegative(),
  operationId: uuidSchema,
});
export const LegacyOperationPayloadSchema = z.union([
  LegacyCommandEnvelopeSchema,
  LegacyRenameEnvelopeSchema,
]);
