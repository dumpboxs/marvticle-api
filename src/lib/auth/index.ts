import { betterAuth } from 'better-auth'
import { drizzleAdapter } from 'better-auth/adapters/drizzle'
import {
  admin as adminPlugin,
  bearer as bearerPlugin,
  multiSession as multiSessionPlugin,
  openAPI as openAPIPlugin,
  username as usernamePlugin,
} from 'better-auth/plugins'
import { createAuthMiddleware } from '@better-auth/core/api'

import { db } from '#/db'
import * as schema from '#/db/schemas'
import { env } from '#/env'
import { getRequestContext } from '#/lib/logger/context'
import { createServiceLogger } from '#/lib/logger'
import {
  parseSensitiveFieldConfig,
  sanitizeForLogging,
} from '#/lib/logger/redaction'
import { hashViewerIp } from '#/lib/viewer-ip'

const authLogger = createServiceLogger('auth')
const sensitiveFields = parseSensitiveFieldConfig(env.LOG_SENSITIVE_FIELDS)

const getClientIp = (headers: Headers | undefined) => {
  const forwardedFor = headers?.get('x-forwarded-for')
  if (forwardedFor) {
    const [first] = forwardedFor.split(',')
    if (first?.trim()) return first.trim()
  }

  const realIp = headers?.get('x-real-ip')
  if (realIp?.trim()) return realIp.trim()

  return undefined
}

const getHashedClientIp = (headers: Headers | undefined) =>
  hashViewerIp(getClientIp(headers) ?? '')

const asString = (value: unknown) =>
  typeof value === 'string' && value.trim().length > 0 ? value : undefined

const getAuthEventName = (path: string | undefined) => {
  if (!path) return 'auth'
  const normalizedPath = path.replace(/^\/auth\/api/, '').replace(/^\/api/, '')

  if (normalizedPath.startsWith('/sign-in')) return 'signIn'
  if (normalizedPath.startsWith('/sign-out')) return 'signOut'
  if (normalizedPath.startsWith('/sign-up')) return 'signUp'
  if (normalizedPath.startsWith('/verify-email')) return 'verifyEmail'
  if (normalizedPath.startsWith('/change-password')) return 'changePassword'
  if (normalizedPath.startsWith('/reset-password')) return 'resetPassword'
  if (normalizedPath.startsWith('/get-session')) return 'session'
  if (normalizedPath.startsWith('/update-session')) return 'session'
  if (normalizedPath.startsWith('/list-sessions')) return 'session'
  if (normalizedPath.startsWith('/revoke-session')) return 'session'
  if (normalizedPath.startsWith('/revoke-sessions')) return 'session'
  if (normalizedPath.startsWith('/revoke-other-sessions')) return 'session'
  if (normalizedPath.startsWith('/callback')) return 'oauth'

  return 'auth'
}

const getAuthProvider = (path: string | undefined, body: unknown) => {
  if (path?.startsWith('/callback')) return 'oauth'
  if (path?.includes('/email')) return 'email'

  if (body && typeof body === 'object') {
    const provider = (body as Record<string, unknown>)['provider']
    if (typeof provider === 'string') return provider
  }

  return undefined
}

const getAuthState = (context: Record<string, unknown>) => {
  const newSession = context['newSession'] as
    | {
        session?: { id?: unknown }
        user?: { id?: unknown }
      }
    | undefined
  const session = context['session'] as { id?: unknown } | undefined
  const user = context['user'] as { id?: unknown } | undefined

  return {
    sessionId: asString(newSession?.session?.id) ?? asString(session?.id),
    userId: asString(newSession?.user?.id) ?? asString(user?.id),
  }
}

const createAuthLoggingPlugin = () => ({
  id: 'auth-logging',
  hooks: {
    before: [
      {
        matcher: () => env.LOG_INCLUDE_AUTH_EVENTS,
        handler: createAuthMiddleware(async (ctx) => {
          const event = getAuthEventName(ctx.path)

          authLogger.info({
            message: 'Authentication request started',
            metadata: {
              event,
              provider: getAuthProvider(ctx.path, ctx.body),
              path: ctx.path,
              ipAddress: getHashedClientIp(ctx.headers),
              userAgent: ctx.headers?.get('user-agent') ?? undefined,
              ...(env.LOG_INCLUDE_REQUEST_BODY
                ? {
                    body: sanitizeForLogging(ctx.body, sensitiveFields),
                  }
                : {}),
            },
          })
        }),
      },
    ],
    after: [
      {
        matcher: () => env.LOG_INCLUDE_AUTH_EVENTS,
        handler: createAuthMiddleware(async (ctx) => {
          const event = getAuthEventName(ctx.path)
          const authState = getAuthState(
            ctx.context as unknown as Record<string, unknown>
          )

          authLogger.info({
            message: 'Authentication event completed',
            metadata: {
              event,
              provider: getAuthProvider(ctx.path, ctx.body),
              path: ctx.path,
              ipAddress: getHashedClientIp(ctx.headers),
              userAgent: ctx.headers?.get('user-agent') ?? undefined,
              userId: authState.userId,
              sessionId: authState.sessionId,
              ...(env.LOG_INCLUDE_RESPONSE_BODY
                ? {
                    response: sanitizeForLogging(
                      (ctx.context as { returned?: unknown }).returned,
                      sensitiveFields
                    ),
                  }
                : {}),
            },
          })
        }),
      },
    ],
  },
  async onResponse(response: Response) {
    if (!env.LOG_INCLUDE_AUTH_EVENTS) return

    authLogger.debug({
      message: 'Authentication response sent',
      metadata: {
        event: getAuthEventName(getRequestContext()?.path),
        path: getRequestContext()?.path,
        statusCode: response.status,
      },
    })
  },
})

export const auth = betterAuth({
  account: {
    accountLinking: {
      enabled: true,
      trustedProviders: ['github', 'google'],
    },
    encryptOAuthTokens: true,
  },
  advanced: {
    database: {
      generateId: 'uuid',
    },
  },
  baseURL: env.BETTER_AUTH_URL,
  basePath: '/api',
  database: drizzleAdapter(db, {
    provider: 'pg',
    schema: {
      user: schema.userTable,
      account: schema.accountTable,
      session: schema.sessionTable,
      verification: schema.verificationTable,
    },
  }),
  databaseHooks: {
    session: {
      create: {
        async after(session, context) {
          if (!env.LOG_INCLUDE_AUTH_EVENTS) return

          authLogger.info({
            message: 'Auth session created',
            metadata: {
              event: 'session',
              action: 'create',
              sessionId: session.id,
              userId: session.userId,
              path: context?.path,
            },
          })
        },
      },
      update: {
        async after(session, context) {
          if (!env.LOG_INCLUDE_AUTH_EVENTS) return

          authLogger.info({
            message: 'Auth session updated',
            metadata: {
              event: 'session',
              action: 'update',
              sessionId: session.id,
              userId: session.userId,
              path: context?.path,
            },
          })
        },
      },
      delete: {
        async after(session, context) {
          if (!env.LOG_INCLUDE_AUTH_EVENTS) return

          authLogger.info({
            message: 'Auth session invalidated',
            metadata: {
              event: 'session',
              action: 'delete',
              sessionId: session.id,
              userId: session.userId,
              path: context?.path,
            },
          })
        },
      },
    },
    verification: {
      create: {
        async after(verification, context) {
          if (!env.LOG_INCLUDE_AUTH_EVENTS) return

          authLogger.debug({
            message: 'Auth verification created',
            metadata: {
              event: 'verification',
              action: 'create',
              verificationId: verification.id,
              path: context?.path,
            },
          })
        },
      },
      delete: {
        async after(verification, context) {
          if (!env.LOG_INCLUDE_AUTH_EVENTS) return

          authLogger.debug({
            message: 'Auth verification invalidated',
            metadata: {
              event: 'verification',
              action: 'delete',
              verificationId: verification.id,
              path: context?.path,
            },
          })
        },
      },
    },
  },
  emailAndPassword: {
    enabled: true,
    autoSignIn: false,
    minPasswordLength: 8,
    maxPasswordLength: 128,
  },
  onAPIError: {
    async onError(error) {
      if (!env.LOG_INCLUDE_AUTH_EVENTS) return

      authLogger.warn({
        message: 'Authentication failed',
        metadata: {
          event: getAuthEventName(getRequestContext()?.path),
          path: getRequestContext()?.path,
          ipAddress: undefined,
        },
        error,
      })
    },
  },
  plugins: [
    adminPlugin(),
    bearerPlugin(),
    multiSessionPlugin(),
    openAPIPlugin(),
    usernamePlugin(),
    createAuthLoggingPlugin(),
  ],
  secret: env.BETTER_AUTH_SECRET,
  session: {
    expiresIn: 60 * 60 * 24 * 3,
  },
  trustedOrigins: [env.CORS_ORIGIN],
})

export const getRequestAuthSession = async (request: Request) => {
  try {
    const session = await auth.api.getSession({
      headers: request.headers,
    })

    if (env.LOG_INCLUDE_AUTH_EVENTS) {
      authLogger.debug({
        message: session ? 'Auth session validated' : 'Auth session missing',
        metadata: {
          event: 'session',
          action: 'validate',
          authenticated: Boolean(session),
          userId: session?.user.id,
          sessionId: session?.session.id,
          ipAddress: getHashedClientIp(request.headers),
          userAgent: request.headers.get('user-agent') ?? undefined,
        },
      })
    }

    return session
  } catch (error) {
    if (env.LOG_INCLUDE_AUTH_EVENTS) {
      authLogger.warn({
        message: 'Auth session validation failed',
        metadata: {
          event: 'session',
          action: 'validate',
          ipAddress: getHashedClientIp(request.headers),
          userAgent: request.headers.get('user-agent') ?? undefined,
        },
        error,
      })
    }

    throw error
  }
}

let _schema: ReturnType<typeof auth.api.generateOpenAPISchema>
const getSchema = async () => (_schema ??= auth.api.generateOpenAPISchema())
export const OpenAPI = {
  getPaths: (prefix = '/auth/api') =>
    // eslint-disable-next-line @typescript-eslint/no-unnecessary-type-assertion
    getSchema().then(({ paths }) => {
      const schemaPaths = paths ?? {}
      // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
      const reference: Record<string, unknown> = Object.create(null)

      for (const path of Object.keys(schemaPaths)) {
        const key = prefix + path
        const operations = schemaPaths[path] ?? {}

        reference[key] = operations
        for (const method of Object.keys(operations)) {
          // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-explicit-any
          const operation = (reference[key] as any)[method]
          // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
          operation.tags = ['Better Auth']
        }
      }
      return reference
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    }) as Promise<any>,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unnecessary-type-assertion
  components: getSchema().then(({ components }) => components) as Promise<any>,
} as const

export * from './authorization'
