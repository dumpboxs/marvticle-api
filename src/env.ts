import 'dotenv/config'
import { createEnv } from '@t3-oss/env-core'
import { z } from 'zod'

export const env = createEnv({
  server: {
    DATABASE_URL: z.url(),
    PORT: z.coerce.number().int().min(0).max(65535),
    BETTER_AUTH_SECRET: z.string().trim().min(32),
    BETTER_AUTH_URL: z.url(),
    VIEWER_IP_HASH_SALT: z.string().trim().min(16).optional(),
  },
  runtimeEnv: process.env,
  emptyStringAsUndefined: true,
})
