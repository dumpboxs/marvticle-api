import { Elysia } from 'elysia'
import { openapi } from '@elysiajs/openapi'
import { cors } from '@elysiajs/cors'

import { env } from '#/env'
import { auth, OpenAPI } from '#/lib/auth'
import { createOpenApiConfig } from '#/lib/openapi'
import { apiErrorPlugin } from '#/plugins/api-error.plugin'
import { postRoutes } from '#/routes/post.route'

const app = new Elysia()
  .use(
    cors({
      origin: 'http://localhost:3001',
      methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
      credentials: true,
      allowedHeaders: ['Content-Type', 'Authorization'],
    })
  )
  .use(
    openapi(
      createOpenApiConfig({
        // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
        components: await OpenAPI.components,
        // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
        paths: await OpenAPI.getPaths(),
      })
    )
  )
  .use(apiErrorPlugin)
  .mount('/auth', auth.handler)
  .use(postRoutes)
  .get('/', () => 'Hello Elysia')
  .listen(env.PORT)

console.log(
  `🦊 Elysia is running at ${app.server?.hostname}:${app.server?.port}`
)
