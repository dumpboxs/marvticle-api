import { betterAuth } from 'better-auth'
import { drizzleAdapter } from 'better-auth/adapters/drizzle'
import {
  admin as adminPlugin,
  bearer as bearerPlugin,
  multiSession as multiSessionPlugin,
  openAPI as openAPIPlugin,
  username as usernamePlugin,
} from 'better-auth/plugins'

import { db } from '#/db'
import { env } from '#/env'
import * as schema from '#/db/schemas'

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
  emailAndPassword: {
    enabled: true,
    autoSignIn: false,
    minPasswordLength: 8,
    maxPasswordLength: 128,
  },
  plugins: [
    adminPlugin(),
    bearerPlugin(),
    multiSessionPlugin(),
    openAPIPlugin(),
    usernamePlugin(),
  ],
  secret: env.BETTER_AUTH_SECRET,
  session: {
    expiresIn: 60 * 60 * 24 * 3,
  },
})

let _schema: ReturnType<typeof auth.api.generateOpenAPISchema>
const getSchema = async () => (_schema ??= auth.api.generateOpenAPISchema())
export const OpenAPI = {
  getPaths: (prefix = '/auth/api') =>
    // eslint-disable-next-line @typescript-eslint/no-unnecessary-type-assertion
    getSchema().then(({ paths }) => {
      // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
      const reference: typeof paths = Object.create(null)
      for (const path of Object.keys(paths)) {
        const key = prefix + path
        reference[key] = paths[path]
        for (const method of Object.keys(paths[path])) {
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
