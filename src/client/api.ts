import {
  errorSchema,
  projectSchema,
  projectTreeSchema,
  sessionSchema,
  type CommandEnvelope,
  type RenameProject,
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
): Promise<T> {
  const controller = new AbortController();
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
        ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
        ...(replay ? { 'X-Leaf-Legacy-Replay': '1' } : {}),
      },
      ...(body === undefined
        ? {}
        : {
            body: JSON.stringify(body),
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
  }
}
export const api = {
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
