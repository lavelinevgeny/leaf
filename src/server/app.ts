import { randomBytes } from 'node:crypto';
import { seedDemo } from './demo-seed.js';
import { DemoLimits } from './demo-limits.js';
import Fastify, { type FastifyInstance, type FastifyRequest } from 'fastify';
import cookie from '@fastify/cookie';
import staticPlugin from '@fastify/static';
import { z, ZodError } from 'zod';
import { DomainError } from '../domain/tree.js';
import {
  commandEnvelopeSchema,
  createProjectSchema,
  loginSchema,
  renameProjectSchema,
  liveScheduleResponseV2Schema,
  uuidSchema,
} from '../shared/contracts.js';
import { Auth, SESSION_SECONDS } from './auth.js';
import { openDatabase } from './database.js';
import { Repository } from './repository.js';

export interface BuildAppOptions {
  databasePath: string;
  publicOrigin: string;
  staticRoot?: string;
  now?: () => number;
  demoMode?: boolean;
}
declare module 'fastify' {
  interface FastifyInstance {
    auth: Auth;
    repository: Repository;
  }
}
export type LeafApp = FastifyInstance;
const projectParamsSchema = z.strictObject({ id: uuidSchema });
function requireContractVersion(
  request: FastifyRequest,
  replayAllowed = false,
): void {
  if (request.headers['x-leaf-contract-version'] !== '2')
    throw new DomainError(
      'CONTRACT_VERSION_CONFLICT',
      'Версия приложения устарела. Обновите страницу для продолжения. Этот запрос не изменил данные.',
      426,
    );
  const replay = request.headers['x-leaf-legacy-replay'];
  if (replay !== undefined && (!replayAllowed || replay !== '1'))
    throw new DomainError('INVALID_REQUEST', 'Проверьте поля запроса.');
}
export async function buildApp(options: BuildAppOptions): Promise<LeafApp> {
  const parsedOrigin = new URL(options.publicOrigin);
  if (
    parsedOrigin.origin !== options.publicOrigin ||
    !['http:', 'https:'].includes(parsedOrigin.protocol)
  )
    throw new Error('Public origin must be an exact HTTP origin');
  const db = openDatabase(options.databasePath);
  const app = Fastify({
    logger: false,
    bodyLimit: 64 * 1024,
    trustProxy: false,
  });
  app.decorate('auth', new Auth(db, options.now, options.demoMode));
  app.decorate('repository', new Repository(db, options.now));
  app.addHook('onClose', () => {
    db.close();
  });
  const cookieOptions = {
    httpOnly: true,
    sameSite: 'strict' as const,
    secure: parsedOrigin.protocol === 'https:',
    path: '/',
    maxAge: SESSION_SECONDS,
  };
  const demoLimits = options.demoMode ? new DemoLimits(options.now) : undefined;
  const demoSession = options.demoMode ? { demoMode: true } : {};
  try {
    if (options.demoMode) {
      await app.auth.setup(randomBytes(32).toString('base64url'));
      seedDemo(db, app.repository, options.now ?? Date.now);
    }
    await app.register(cookie);
    app.addHook('onRequest', async (request, reply) => {
      reply
        .header('X-Content-Type-Options', 'nosniff')
        .header('Referrer-Policy', 'no-referrer')
        .header(
          'Content-Security-Policy',
          "default-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'",
        );
      // Fastify resolves percent-encoded paths before selecting a route.
      // Apply API policy to that registered route, never the raw URL.
      const isApiRoute = request.routeOptions.url?.startsWith('/api/') ?? false;
      if (isApiRoute) reply.header('Cache-Control', 'no-store');
      if (
        ['POST', 'PATCH', 'DELETE', 'PUT'].includes(request.method) &&
        isApiRoute
      ) {
        if (request.headers.origin !== options.publicOrigin)
          throw new DomainError(
            'ORIGIN_REJECTED',
            'Источник запроса не разрешён.',
            403,
          );
        if (
          request.headers['content-type']
            ?.split(';')[0]
            ?.trim()
            .toLowerCase() !== 'application/json'
        )
          throw new DomainError('JSON_REQUIRED', 'Требуется JSON.', 415);
      }
    });
    const requireSession = (request: FastifyRequest): string => {
      const session = app.auth.session(request.cookies.leaf_session);
      if (!session)
        throw new DomainError('AUTH_REQUIRED', 'Требуется вход.', 401);
      return session;
    };
    app.setErrorHandler((error, _request, reply) => {
      if (error instanceof DomainError)
        return reply
          .code(error.statusCode)
          .send({ code: error.code, message: error.message });
      if (error instanceof ZodError)
        return reply.code(400).send({
          code: 'INVALID_REQUEST',
          message: 'Проверьте поля запроса.',
        });
      const statusCode = (error as { statusCode?: number }).statusCode;
      if (statusCode && statusCode >= 400 && statusCode < 500)
        return reply.code(statusCode).send({
          code: statusCode === 413 ? 'BODY_TOO_LARGE' : 'INVALID_REQUEST',
          message:
            statusCode === 413
              ? 'Запрос слишком большой.'
              : 'Некорректный запрос.',
        });
      return reply.code(500).send({
        code: 'INTERNAL_ERROR',
        message: 'Не удалось выполнить запрос.',
      });
    });
    app.get('/healthz', () => ({ ok: true }));
    app.get('/readyz', (_request, reply) => {
      try {
        db.prepare('SELECT 1').get();
        return { ok: true };
      } catch {
        return reply.code(503).send({ ok: false });
      }
    });
    app.get('/api/auth/session', (request) => ({
      authenticated: Boolean(app.auth.session(request.cookies.leaf_session)),
      setupRequired: !app.auth.hasAccount(),
      ...demoSession,
    }));
    if (options.demoMode)
      app.post('/api/auth/demo', (request, reply) => {
        z.strictObject({}).parse(request.body);
        const token = app.auth.enterDemo(request.cookies.leaf_session);
        reply.setCookie('leaf_session', token, cookieOptions);
        return { authenticated: true, setupRequired: false, ...demoSession };
      });
    app.post('/api/auth/login', async (request, reply) => {
      if (options.demoMode)
        throw new DomainError(
          'DEMO_PASSWORD_DISABLED',
          'В демо вход по паролю отключён.',
          403,
        );
      const input = loginSchema.parse(request.body);
      const token = await app.auth.login(input.password, request.ip);
      reply.setCookie('leaf_session', token, cookieOptions);
      return { authenticated: true, setupRequired: false };
    });
    app.post('/api/auth/logout', (request, reply) => {
      requireSession(request);
      z.strictObject({}).parse(request.body);
      app.auth.logout(request.cookies.leaf_session);
      reply.clearCookie('leaf_session', cookieOptions);
      return {
        authenticated: false,
        setupRequired: !app.auth.hasAccount(),
        ...demoSession,
      };
    });
    app.get('/api/projects', (request) => {
      requireSession(request);
      requireContractVersion(request);
      return app.repository.listProjects();
    });
    app.post('/api/projects', (request, reply) => {
      requireSession(request);
      requireContractVersion(request);
      const input = createProjectSchema.parse(request.body);
      demoLimits?.admitMutation(request.body);
      return reply.code(201).send(app.repository.createProject(input.title));
    });
    app.patch('/api/projects/:id', (request) => {
      const session = requireSession(request);
      requireContractVersion(request, true);
      const { id } = projectParamsSchema.parse(request.params);
      if (request.headers['x-leaf-legacy-replay'] === '1') {
        if (demoLimits) z.object({}).parse(request.body);
        demoLimits?.admitMutation(request.body);
        return app.repository.replayLegacy(id, request.body, session);
      }
      const input = renameProjectSchema.parse(request.body);
      demoLimits?.admitMutation(request.body);
      return app.repository.renameProject(id, input, session);
    });
    app.get('/api/projects/:id/tree', (request) => {
      const session = requireSession(request);
      requireContractVersion(request);
      const { id } = projectParamsSchema.parse(request.params);
      return app.repository.getTree(id, session);
    });
    app.get('/api/projects/:id/schedule', (request) => {
      requireSession(request);
      requireContractVersion(request);
      const { id } = projectParamsSchema.parse(request.params);
      const parsed = liveScheduleResponseV2Schema.safeParse(
        app.repository.getSchedule(id),
      );
      if (!parsed.success)
        throw new Error('Invalid internal schedule response');
      return parsed.data;
    });
    app.post('/api/projects/:id/commands', (request) => {
      const session = requireSession(request);
      requireContractVersion(request, true);
      const { id } = projectParamsSchema.parse(request.params);
      if (request.headers['x-leaf-legacy-replay'] === '1') {
        if (demoLimits) z.object({}).parse(request.body);
        demoLimits?.admitMutation(request.body);
        return app.repository.replayLegacy(id, request.body, session);
      }
      const input = commandEnvelopeSchema.parse(request.body);
      demoLimits?.admitMutation(request.body);
      return app.repository.applyCommand(id, input, session);
    });
    if (options.staticRoot) {
      await app.register(staticPlugin, {
        root: options.staticRoot,
        redirect: false,
        index: 'index.html',
      });
      app.setNotFoundHandler((request, reply) => {
        if (
          request.method !== 'GET' ||
          request.url.startsWith('/api/') ||
          request.url.startsWith('/healthz') ||
          request.url.startsWith('/readyz') ||
          request.url.split('?')[0]?.includes('.')
        )
          return reply
            .code(404)
            .send({ code: 'NOT_FOUND', message: 'Страница не найдена.' });
        return reply.type('text/html').sendFile('index.html');
      });
    } else {
      app.setNotFoundHandler((_request, reply) =>
        reply
          .code(404)
          .send({ code: 'NOT_FOUND', message: 'Страница не найдена.' }),
      );
    }
    await app.ready();
    return app;
  } catch (error) {
    await app.close();
    throw error;
  }
}
