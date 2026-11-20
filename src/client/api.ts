import {
  journalPageV2Schema,
  journalEntryReadV2Schema,
  journalMutationV2Schema,
  type JournalCreateV2,
  type JournalUpdateV2,
  type JournalDeleteV2,
} from '../shared/journal-contracts-v2.js';
import {
  journalMutationSchema,
  journalCreateSchema,
  journalUpdateSchema,
  journalDeleteSchema,
  type JournalCreate,
  type JournalUpdate,
  type JournalDelete,
  type JournalProjectQuery,
  type JournalTaskQuery,
} from '../shared/journal-contracts.js';
import { journalUploadReadySchema } from '../shared/journal-media-contracts.js';
import { journalMediaUrl, type JournalUpload } from './journal-upload-state.js';
import {
  errorSchema,
  projectSchema,
  projectTreeSchema,
  sessionSchema,
  type CommandEnvelope,
  type RenameProject,
  uuidSchema,
} from '../shared/contracts.js';
import { z } from 'zod';
import { strings } from './strings.js';

export class ApiError extends Error {
  constructor(
    public readonly code: string,
    message: string,
    public readonly status: number | null = null,
    public readonly uncertain = false,
  ) {
    super(message);
  }
}
async function request<T>(
  path: string,
  schema: z.ZodType<T>,
  method = 'GET',
  body?: unknown,
  replay = false,
  uploadSignal?: AbortSignal,
  journalContract: 1 | 2 = 2,
): Promise<T> {
  const controller = new AbortController();
  const cancel = () => controller.abort();
  uploadSignal?.addEventListener('abort', cancel, { once: true });
  if (uploadSignal?.aborted) cancel();
  const timer = setTimeout(() => controller.abort(), 20000);
  try {
    const response = await fetch(`/api${path}`, {
      method,
      credentials: 'same-origin',
      signal: controller.signal,
      headers: {
        ...(path.startsWith('/projects')
          ? { 'X-Leaf-Contract-Version': '2' }
          : {}),
        ...(path.includes('/journal') && journalContract === 2
          ? { 'X-Leaf-Journal-Contract-Version': '2' }
          : {}),
        ...(body === undefined || body instanceof FormData
          ? {}
          : { 'Content-Type': 'application/json' }),
        ...(replay ? { 'X-Leaf-Legacy-Replay': '1' } : {}),
      },
      ...(body === undefined
        ? {}
        : {
            body: body instanceof FormData ? body : JSON.stringify(body),
          }),
    });
    let value: unknown;
    try {
      value = await response.json();
    } catch {
      throw new ApiError(
        'INVALID_RESPONSE',
        strings.genericError,
        response.status,
        response.ok,
      );
    }
    if (!response.ok) {
      const error = errorSchema.safeParse(value);
      throw new ApiError(
        error.success ? error.data.code : 'REQUEST_FAILED',
        error.success ? error.data.message : strings.genericError,
        response.status,
        method !== 'GET' && response.status >= 500,
      );
    }
    const result = schema.safeParse(value);
    if (!result.success)
      throw new ApiError(
        'INVALID_RESPONSE',
        strings.genericError,
        response.status,
        method !== 'GET',
      );
    return result.data;
  } catch (error) {
    if (error instanceof ApiError) throw error;
    throw new ApiError('NETWORK_ERROR', strings.network, null, true);
  } finally {
    clearTimeout(timer);
    uploadSignal?.removeEventListener('abort', cancel);
  }
}
function journalQuery(query: JournalProjectQuery | JournalTaskQuery) {
  const fields = new URLSearchParams();
  for (const [key, value] of Object.entries(query))
    if (value !== undefined) fields.set(key, String(value));
  return fields.size ? `?${fields}` : '';
}
export type LegacyJournalRetry =
  | { method: 'POST'; input: JournalCreate }
  | { method: 'PATCH'; entryId: string; taskId: string; input: JournalUpdate }
  | { method: 'DELETE'; entryId: string; input: JournalDelete };

// Only an original v1 operation can use this compatibility path. Its frozen
// acknowledgement is separate from live2 pending writes and current GET state.
async function journalReplayLegacy(id: string, original: LegacyJournalRetry) {
  uuidSchema.parse(id);
  const retry = {
    ...original,
    input: { ...original.input },
  } as LegacyJournalRetry;
  if (retry.method !== 'POST') uuidSchema.parse(retry.entryId);
  if (retry.method === 'PATCH') uuidSchema.parse(retry.taskId);
  const schema =
    retry.method === 'POST'
      ? journalCreateSchema
      : retry.method === 'PATCH'
        ? journalUpdateSchema
        : journalDeleteSchema;
  // Validate without normalizing or rebuilding the original wire payload.
  schema.parse(retry.input);
  const result = await request(
    `/projects/${id}/journal${retry.method === 'POST' ? '' : `/${retry.entryId}`}`,
    journalMutationSchema,
    retry.method,
    retry.input,
    false,
    undefined,
    1,
  );
  const matches =
    result.projectId === id &&
    result.journalRevision === retry.input.expectedJournalRevision + 1 &&
    (retry.method === 'DELETE'
      ? result.kind === 'deleted' && result.deletedEntryId === retry.entryId
      : result.kind === 'saved' &&
        result.entry.projectId === id &&
        result.entry.taskId ===
          (retry.method === 'POST' ? retry.input.taskId : retry.taskId) &&
        (retry.method === 'POST' || result.entry.id === retry.entryId) &&
        result.entry.workDate === retry.input.workDate &&
        result.entry.body === retry.input.body);
  if (!matches)
    throw new ApiError('INVALID_RESPONSE', strings.genericError, 200, true);
  return result;
}
export const api = {
  journalReplayLegacy,
  journalMediaRead: async (
    projectId: string,
    taskId: string,
    mediaId: string,
    download = false,
    signal?: AbortSignal,
  ): Promise<Blob> => {
    const response = await fetch(
      journalMediaUrl(projectId, taskId, mediaId, download),
      { credentials: 'same-origin', ...(signal ? { signal } : {}) },
    );
    if (!response.ok)
      throw new ApiError(
        'MEDIA_READ_FAILED',
        'Вложение недоступно.',
        response.status,
      );
    return response.blob();
  },
  journalUpload: async (
    id: string,
    taskId: string,
    upload: Pick<JournalUpload, 'uploadId' | 'kind' | 'file'>,
    signal?: AbortSignal,
  ) => {
    const form = new FormData();
    form.set('uploadId', upload.uploadId);
    form.set('kind', upload.kind);
    form.set('file', upload.file);
    const result = await request(
      `/projects/${id}/tasks/${taskId}/journal-media`,
      journalUploadReadySchema,
      'POST',
      form,
      false,
      signal,
    );
    if (
      result.uploadId !== upload.uploadId ||
      result.media.kind !== upload.kind
    )
      throw new ApiError('INVALID_RESPONSE', strings.genericError, 201, true);
    return result;
  },
  journalProject: (id: string, query: JournalProjectQuery) =>
    request(
      `/projects/${id}/journal${journalQuery(query)}`,
      journalPageV2Schema,
    ),
  journalTask: (id: string, taskId: string, query: JournalTaskQuery) =>
    request(
      `/projects/${id}/tasks/${taskId}/journal${journalQuery(query)}`,
      journalPageV2Schema,
    ),
  journalEntry: (id: string, entryId: string) =>
    request(`/projects/${id}/journal/${entryId}`, journalEntryReadV2Schema),
  journalCreate: (id: string, input: JournalCreateV2) =>
    request(`/projects/${id}/journal`, journalMutationV2Schema, 'POST', input),
  journalUpdate: (id: string, entryId: string, input: JournalUpdateV2) =>
    request(
      `/projects/${id}/journal/${entryId}`,
      journalMutationV2Schema,
      'PATCH',
      input,
    ),
  journalDelete: (id: string, entryId: string, input: JournalDeleteV2) =>
    request(
      `/projects/${id}/journal/${entryId}`,
      journalMutationV2Schema,
      'DELETE',
      input,
    ),
  replayLegacy: (
    id: string,
    originalBody: unknown,
    kind: 'command' | 'rename',
  ) =>
    request(
      `/projects/${id}${kind === 'command' ? '/commands' : ''}`,
      projectTreeSchema,
      kind === 'command' ? 'POST' : 'PATCH',
      originalBody,
      true,
    ),
  session: () => request('/auth/session', sessionSchema),
  enterDemo: () => request('/auth/demo', sessionSchema, 'POST', {}),
  login: (password: string) =>
    request('/auth/login', sessionSchema, 'POST', { password }),
  logout: () => request('/auth/logout', z.unknown(), 'POST', {}),
  projects: () => request('/projects', z.array(projectSchema)),
  createProject: (title: string) =>
    request('/projects', projectSchema, 'POST', { title }),
  tree: (id: string) => request(`/projects/${id}/tree`, projectTreeSchema),
  command: (id: string, envelope: CommandEnvelope) =>
    request(`/projects/${id}/commands`, projectTreeSchema, 'POST', envelope),
  rename: (id: string, envelope: RenameProject) =>
    request(`/projects/${id}`, projectTreeSchema, 'PATCH', envelope),
};
