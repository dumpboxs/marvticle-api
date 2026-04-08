import { Elysia } from 'elysia'
import { env } from '#/env'
import { auth, OpenAPI } from '#/lib/auth'
import { openapi } from '@elysiajs/openapi'
import { cors } from '@elysiajs/cors'

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
    openapi({
      documentation: {
        // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
        components: await OpenAPI.components,
        // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
        paths: await OpenAPI.getPaths(),
      },
    })
  )
  .mount('/auth', auth.handler)
  .get('/', () => 'Hello Elysia')
  .listen(env.PORT)

console.log(
  `🦊 Elysia is running at ${app.server?.hostname}:${app.server?.port}`
)
