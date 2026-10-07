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
