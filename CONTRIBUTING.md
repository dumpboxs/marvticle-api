# Contributing to marvticle-api

This document explains the patterns already used in this codebase. Follow these conventions when adding or changing backend features. If an example here conflicts with the current implementation, treat the current implementation as the source of truth and update this file in the same pull request.

## Project Structure

The backend is organized around domain-oriented database schemas, thin HTTP routes, and service-layer business logic.

```text
.
├── docs/
│   └── frontend-api-guide.md    # Frontend-facing API usage notes; not backend implementation guidance
├── src/
│   ├── db/
│   │   ├── migrations/          # Generated Drizzle SQL migrations
│   │   ├── schemas/             # Table definitions, relations, and barrel exports
│   │   ├── index.ts             # pg Pool + Drizzle connection
│   │   └── query-logger.ts      # Database query instrumentation
│   ├── lib/
│   │   ├── auth/                # Better Auth configuration and helpers
│   │   ├── logger/              # Shared logging infrastructure
│   │   ├── openapi.ts           # OpenAPI configuration
│   │   └── viewer-ip.ts         # Anonymous viewer IP hashing
│   ├── plugins/
│   │   ├── api-error.plugin.ts
│   │   └── request-logger.plugin.ts
│   ├── routes/
│   │   ├── engagement.route.ts
│   │   └── post.route.ts
│   ├── schemas/
│   │   ├── api-response.schema.ts
│   │   ├── drizzle-zod.ts
│   │   ├── engagement.schema.ts
│   │   └── post.schema.ts
│   ├── services/
│   │   ├── engagement.service.ts
│   │   └── post.service.ts
│   ├── env.ts                   # Environment validation
│   └── index.ts                 # Application entry point
├── test/                        # Route and infrastructure tests
├── .env.example
├── README.md
└── tsconfig.json
```

### Rules

- Keep business logic in `src/services/`, not in route handlers.
- Keep route definitions in `src/routes/`.
- Keep request and response validation schemas in `src/schemas/`.
- Keep Drizzle table definitions in `src/db/schemas/`.
- Keep all Drizzle relations in `src/db/schemas/relations.ts`.
- Export folder-level public APIs through barrel files where the repo already does so, especially `src/db/schemas/index.ts`.
- Do not add new top-level source folders without discussion.

### Do / Don't

- Do add backend features by touching `schemas`, `services`, and `routes` together when the change crosses those layers.
- Don't put data access, pagination, or domain decisions directly inside Elysia route handlers.
- Do treat `docs/frontend-api-guide.md` as frontend documentation only.
- Don't mix frontend guidance into this backend contribution guide.

## Database Patterns

Use the files under `src/db/schemas/` as the reference for database structure:

- `auth.ts` for Better Auth tables
- `post.ts` for a simple domain table
- `comments.ts` for self-referential relationships
- `views.ts` for privacy-aware viewer tracking
- `relations.ts` for centralized Drizzle relations

### Creating New Tables

The repo consistently uses:

- `uuid(...).default(sql\`pg_catalog.gen_random_uuid()\`).primaryKey()` for primary keys
- snake_case database column names
- camelCase TypeScript property names
- `text(...)` for string columns
- `.references(..., { onDelete: 'cascade' })` for cascading foreign keys where appropriate
- timestamp columns named `created_at` and `updated_at` where the table needs them

Not every table needs both `createdAt` and `updatedAt`. For example, `views` currently stores only `createdAt`.

```ts
// File: src/db/schemas/example.ts
import { sql } from 'drizzle-orm'
import { index, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core'

import { userTable } from './auth'

export const exampleTable = pgTable(
  'examples',
  {
    id: uuid('id')
      .default(sql`pg_catalog.gen_random_uuid()`)
      .primaryKey(),
    userId: uuid('user_id')
      .notNull()
      .references(() => userTable.id, { onDelete: 'cascade' }),
    title: text('title').notNull(),
    metadata: text('metadata'),
    createdAt: timestamp('created_at').defaultNow().notNull(),
    updatedAt: timestamp('updated_at')
      .defaultNow()
      .$onUpdate(() => /* @__PURE__ */ new Date()),
  },
  (table) => ({
    userIdIdx: index('example_user_id_idx').on(table.userId),
  })
)
```

### Accepted `pgTable` Styles in This Repo

This repo already uses multiple valid `pgTable` styles. Match the style that fits the table you are adding instead of forcing one callback form everywhere.

1. Inline object only, no third callback:

```ts
export const postTable = pgTable('posts', {
  id: uuid('id')
    .default(sql`pg_catalog.gen_random_uuid()`)
    .primaryKey(),
  title: text('title').notNull(),
  createdAt: timestamp('created_at').defaultNow().notNull(),
})
```

2. Callback returning an object of indexes or checks:

```ts
export const viewTable = pgTable(
  'views',
  {
    id: uuid('id')
      .default(sql`pg_catalog.gen_random_uuid()`)
      .primaryKey(),
    postId: uuid('post_id').notNull(),
    createdAt: timestamp('created_at').defaultNow().notNull(),
  },
  (table) => ({
    postIdIdx: index('view_post_id_idx').on(table.postId),
  })
)
```

3. Callback returning an array:

```ts
export const sessionTable = pgTable(
  'session',
  {
    id: uuid('id')
      .default(sql`pg_catalog.gen_random_uuid()`)
      .primaryKey(),
    userId: uuid('user_id').notNull(),
  },
  (table) => [index('session_userId_idx').on(table.userId)]
)
```

### Self-Referential Relationships

Comments use a self-reference for replies. Use `AnyPgColumn` when a table needs to reference itself.

```ts
import {
  type AnyPgColumn,
  pgTable,
  text,
  timestamp,
  uuid,
} from 'drizzle-orm/pg-core'

export const commentTable = pgTable('comments', {
  id: uuid('id').primaryKey(),
  parentId: uuid('parent_id').references((): AnyPgColumn => commentTable.id, {
    onDelete: 'cascade',
  }),
  content: text('content').notNull(),
  createdAt: timestamp('created_at').defaultNow().notNull(),
})
```

### Adding Relations

All Drizzle relations belong in `src/db/schemas/relations.ts`. Do not define `relations()` inside individual schema files.

The current file uses alias imports, so follow that import style when adding new relations there.

```ts
// File: src/db/schemas/relations.ts
import { relations } from 'drizzle-orm'

import { postTable } from '#/db/schemas/post'
import { tagTable, postTagTable } from '#/db/schemas/tag'

export const postRelations = relations(postTable, ({ many }) => ({
  tags: many(postTagTable),
}))

export const tagRelations = relations(tagTable, ({ many }) => ({
  posts: many(postTagTable),
}))
```

### Migrations

Use the existing Bun scripts from `package.json`.

```bash
# Generate migration files after schema changes
bun run db:generate

# Apply migrations to the configured database
bun run db:migrate

# Push schema changes directly (development-oriented workflow)
bun run db:push

# Open Drizzle Studio
bun run db:studio

# Start the local database stack
bun run db:start

# Run the local database stack in the foreground
bun run db:watch

# Stop the local database containers
bun run db:stop

# Tear down the local database containers
bun run db:down
```

### Migration Rules

- Run `bun run db:generate` after changing schema files.
- Commit generated migration files to Git.
- Validate schema changes locally before pushing.
- Do not hand-edit generated migration files as normal workflow.
- Only make manual migration edits when there is an exceptional, reviewed reason.

### Viewer IP Privacy

Anonymous post views do not store plaintext IP addresses.

- Store `viewer_ip_hash`, not raw IP values.
- `VIEWER_IP_HASH_SALT` is the preferred salt source.
- `BETTER_AUTH_SECRET` is the fallback salt source when `VIEWER_IP_HASH_SALT` is unset.

### Do / Don't

- Do add new table exports to `src/db/schemas/index.ts` when they are part of the public schema surface.
- Don't add `relations()` calls to `post.ts`, `comments.ts`, or other individual schema files.
- Do use snake_case database columns and camelCase TypeScript properties.
- Don't store anonymous viewer IPs in plaintext.

## API Patterns

Route behavior is defined primarily in:

- `src/routes/post.route.ts`
- `src/routes/engagement.route.ts`
- `src/plugins/api-error.plugin.ts`
- `src/schemas/api-response.schema.ts`

### Route Factory Pattern

Routes are created through factory functions with dependency injection. The factory defines default dependencies, merges overrides, creates auth macros locally, and returns a configured Elysia instance.

```ts
// File: src/routes/example.route.ts
import Elysia, { status as elysiaStatus } from 'elysia'
import { z } from 'zod'

import { getRequestAuthSession } from '#/lib/auth'
import {
  ApiSuccessSchema,
  createErrorResponse,
  withStandardResponses,
} from '#/schemas/api-response.schema'
import { exampleService } from '#/services/example.service'
import {
  createExampleBodySchema,
  type CreateExampleBodySchema,
} from '#/schemas/example.schema'

type AuthenticatedUser = {
  id: string
  [key: string]: unknown
}

type AuthenticatedSession = {
  session: Record<string, unknown>
  user: AuthenticatedUser
} | null

const exampleResponseSchema = ApiSuccessSchema(
  z.object({
    id: z.string().uuid(),
    title: z.string(),
  })
).extend({
  message: z.literal('Example created successfully'),
})

type ExampleRoutesDeps = {
  createExample: (
    data: CreateExampleBodySchema,
    userId: string
  ) => Promise<{ id: string; title: string }>
  getSession: (request: Request) => Promise<AuthenticatedSession>
}

export type CreateExampleRoutesDeps = Partial<ExampleRoutesDeps>

const defaultExampleRoutesDeps: ExampleRoutesDeps = {
  createExample: (data, userId) => exampleService.create(data, userId),
  getSession: async (request) => {
    const session = await getRequestAuthSession(request)

    if (!session) return null

    return {
      session: session.session,
      user: session.user,
    }
  },
}

export const createExampleRoutes = (deps: CreateExampleRoutesDeps = {}) => {
  const runtimeDeps = {
    ...defaultExampleRoutesDeps,
    ...deps,
  } satisfies ExampleRoutesDeps

  const authMacro = new Elysia({ name: 'example-auth-macro' }).macro({
    requiredAuth: {
      async resolve({ request }) {
        const session = await runtimeDeps.getSession(request)

        if (!session) {
          return elysiaStatus(401, createErrorResponse(401))
        }

        return {
          session: session.session,
          user: session.user,
        }
      },
    },
  })

  return new Elysia({ prefix: '/api/examples' }).use(authMacro).post(
    '/',
    async ({ body, user }) => {
      const item = await runtimeDeps.createExample(body, user.id)

      return {
        success: true,
        message: 'Example created successfully',
        data: item,
      }
    },
    {
      requiredAuth: true,
      body: createExampleBodySchema,
      response: withStandardResponses({
        200: exampleResponseSchema,
      }),
      detail: {
        summary: 'Create example',
        description: 'Create a new example record.',
        tags: ['Examples'],
        operationId: 'createExample',
      },
    }
  )
}

export const exampleRoutes = createExampleRoutes()
```

### Route Rules

- Use factory functions such as `createPostRoutes` and `createEngagementRoutes`.
- Define a default dependency object, then merge overrides with `Partial<...>` inputs.
- Create auth macros inside the route factory.
- Resolve auth through `getRequestAuthSession`.
- Keep route handlers thin; services own business logic.
- Normalize `Date` values to ISO strings in routes before returning them.
- Include OpenAPI `detail` metadata with `summary`, `description`, `tags`, and `operationId`.

### Response Schema Pattern

Success responses are built in two layers:

1. Create a success envelope schema with `ApiSuccessSchema(...)`.
2. Wrap route responses with `withStandardResponses({ 200: ... })`.

That two-step pattern is what the current repo uses. Do not collapse those into a single invented helper.

```ts
// File: src/schemas/example.schema.ts
import { z } from 'zod'

import { ApiSuccessSchema, withStandardResponses } from './api-response.schema'

export const createExampleBodySchema = z.object({
  title: z.string().trim().min(1).max(255),
})

export type CreateExampleBodySchema = z.infer<typeof createExampleBodySchema>

export const exampleItemSchema = z.object({
  id: z.string().uuid(),
  title: z.string(),
  createdAt: z.string(),
  updatedAt: z.string().nullable(),
})

export const createExampleSuccessSchema = ApiSuccessSchema(
  exampleItemSchema
).extend({
  message: z.literal('Example created successfully'),
})

export const createExampleRouteResponses = withStandardResponses({
  200: createExampleSuccessSchema,
})
```

### Error Handling Pattern

There are two layers of error handling:

1. Services throw domain errors.
2. Routes or `apiErrorPlugin` convert them into standard API error responses.

Use `createErrorResponse(...)` for predictable error payloads and `elysiaStatus(...)` to attach the correct status code.

```ts
import Elysia, { status as elysiaStatus } from 'elysia'

import { createErrorResponse } from '#/schemas/api-response.schema'
import { InvalidCursorError, postService } from '#/services/post.service'

const app = new Elysia().get('/posts', async ({ query }) => {
  try {
    const result = await postService.listPublishedWithCursor(query)

    return {
      success: true,
      message: 'Posts fetched successfully',
      data: result,
    }
  } catch (error) {
    if (error instanceof InvalidCursorError) {
      return elysiaStatus(
        400,
        createErrorResponse(400, {
          message: 'Invalid cursor',
        })
      )
    }

    throw error
  }
})
```

`apiErrorPlugin` normalizes:

- Elysia validation errors to `422`
- parse and invalid-cookie-style framework errors to `400`
- standard numeric custom status wrappers to the repo's standard error shape
- uncaught internal errors to `500`

### Do / Don't

- Do return `{ success: true, message, data }` for successful responses.
- Don't invent ad hoc success payload shapes.
- Do map predictable domain failures with `elysiaStatus(code, createErrorResponse(...))`.
- Don't manually duplicate global validation or framework error formatting in every route.

## Service Patterns

Use `src/services/post.service.ts` and `src/services/engagement.service.ts` as the main references.

### Service Shape

Services in this repo are plain exported objects with async methods. They use structured logging, throw domain errors, and return domain data instead of HTTP response wrappers.

```ts
// File: src/services/example.service.ts
import { eq } from 'drizzle-orm'

import { db } from '#/db'
import { exampleTable } from '#/db/schemas'
import { createServiceLogger } from '#/lib/logger'
import type { CreateExampleBodySchema } from '#/schemas/example.schema'

const logger = createServiceLogger('exampleService')

export class ExampleNotFoundError extends Error {
  constructor() {
    super('Example not found')
    this.name = 'ExampleNotFoundError'
  }
}

export const exampleService = {
  create: async (data: CreateExampleBodySchema, userId: string) => {
    const startedAt = performance.now()

    logger.info({
      message: 'Creating example',
      metadata: {
        userId,
        title: data.title,
      },
    })

    try {
      const [inserted] = await db
        .insert(exampleTable)
        .values({
          ...data,
          userId,
        })
        .returning()

      logger.info({
        message: 'Example created successfully',
        metadata: {
          exampleId: inserted?.id ?? null,
          userId,
        },
        duration: performance.now() - startedAt,
      })

      return inserted ?? null
    } catch (error) {
      logger.error({
        message: 'Create example failed',
        metadata: {
          userId,
          title: data.title,
        },
        error,
        duration: performance.now() - startedAt,
      })

      throw error
    }
  },

  findById: async (id: string) => {
    const startedAt = performance.now()

    logger.debug({
      message: 'Finding example by id',
      metadata: {
        exampleId: id,
      },
    })

    try {
      const item = await db.query.exampleTable.findFirst({
        where: eq(exampleTable.id, id),
      })

      logger.info({
        message: item ? 'Example found' : 'Example not found',
        metadata: {
          exampleId: id,
          found: Boolean(item),
        },
        duration: performance.now() - startedAt,
      })

      return item ?? null
    } catch (error) {
      logger.error({
        message: 'Find example failed',
        metadata: {
          exampleId: id,
        },
        error,
        duration: performance.now() - startedAt,
      })

      throw error
    }
  },
}
```

### Service Rules

- Export a plain object such as `postService` or `engagementService`.
- Define custom error classes near the top of the file.
- Use `createServiceLogger(...)`.
- Log the start of important operations and the success or error outcome.
- Include `duration` when measuring operations.
- Throw domain errors instead of returning API-shaped error payloads.
- Return domain data or `null`; let routes map `null` to HTTP responses when needed.

### Cursor Pagination

Cursor pagination belongs in the service layer. The current `postService` shows the expected pattern:

- define encode/decode helpers
- validate and parse the cursor payload
- use deterministic ordering
- fetch `limit + 1` rows to determine `hasMore`
- return `{ items, nextCursor, hasMore }`

### Do / Don't

- Do keep cursor parsing, ordering, and data fetching in services.
- Don't build HTTP responses in services.
- Do throw custom domain errors for predictable business failures.
- Don't return raw error objects to routes.

## Naming Conventions

Use names that match the current codebase.

| What                   | Pattern                                           | Example                                                                         | Where                       |
| ---------------------- | ------------------------------------------------- | ------------------------------------------------------------------------------- | --------------------------- |
| Schema file            | `[domain].ts`                                     | `post.ts`, `comments.ts`, `views.ts`                                            | `src/db/schemas/`           |
| Table variable         | `[domain]Table`                                   | `postTable`, `commentTable`, `viewTable`, `userTable`                           | DB schema files             |
| Validation schema file | `[domain].schema.ts`                              | `post.schema.ts`, `engagement.schema.ts`                                        | `src/schemas/`              |
| Request body schema    | `[action][Domain]BodySchema`                      | `createPostBodySchema`, `toggleLikeBodySchema`                                  | Schema files                |
| Query / params schema  | `[action][Domain]QuerySchema` or descriptive name | `getPostsQuerySchema`, `getPostByIdParamsSchema`, `postIdQuerySchema`           | Schema files                |
| Service object         | `[domain]Service`                                 | `postService`, `engagementService`                                              | Service files               |
| Service method         | Verb phrase                                       | `create`, `findPublishedById`, `listPublishedWithCursor`                        | Service object              |
| Route factory          | `create[Domain]Routes`                            | `createPostRoutes`, `createEngagementRoutes`                                    | Route files                 |
| Route instance         | `[domain]Routes`                                  | `postRoutes`, `engagementRoutes`                                                | Route files                 |
| Error class            | `[Description]Error`                              | `InvalidCursorError`, `PostNotFoundError`, `ParentCommentNotFoundError`         | Service files               |
| Logger name            | `createServiceLogger('...')`                      | `createServiceLogger('postService')`, `createServiceLogger('engagementRoutes')` | Services, routes, utilities |

## Environment Setup

Environment variables are validated in `src/env.ts` and illustrated in `.env.example`.

| Variable                    | Required | Description                              | Validation / Default                                                      | Example                                                       |
| --------------------------- | -------- | ---------------------------------------- | ------------------------------------------------------------------------- | ------------------------------------------------------------- |
| `DATABASE_URL`              | Yes      | PostgreSQL connection string             | Must be a valid URL                                                       | `postgresql://postgres:password@localhost:5432/marvticle-api` |
| `PORT`                      | Yes      | HTTP server port                         | Integer `0-65535`                                                         | `3000`                                                        |
| `CORS_ORIGIN`               | Yes      | Allowed browser origin                   | Must be a valid URL                                                       | `http://localhost:3001`                                       |
| `BETTER_AUTH_SECRET`        | Yes      | Better Auth signing secret               | Minimum 32 characters                                                     | `openssl rand -hex 32`                                        |
| `BETTER_AUTH_URL`           | Yes      | Public auth base URL                     | Must be a valid URL                                                       | `http://localhost:3000`                                       |
| `VIEWER_IP_HASH_SALT`       | No       | Salt for anonymous viewer IP hashing     | Minimum 16 characters if set; falls back to `BETTER_AUTH_SECRET`          | `openssl rand -hex 16`                                        |
| `LOG_LEVEL`                 | No       | Logger level                             | One of `trace`, `debug`, `info`, `warn`, `error`, `fatal`; default `info` | `debug`                                                       |
| `LOG_FORMAT`                | No       | Logger output format                     | `pretty` outside production, `json` in production                         | `pretty`                                                      |
| `LOG_INCLUDE_DB_QUERIES`    | No       | Enable DB query logging                  | String boolean, default `false`                                           | `false`                                                       |
| `LOG_INCLUDE_AUTH_EVENTS`   | No       | Enable auth event logging                | String boolean, default `true`                                            | `true`                                                        |
| `LOG_INCLUDE_REQUEST_BODY`  | No       | Include request bodies in logs           | String boolean, default `false`                                           | `false`                                                       |
| `LOG_INCLUDE_RESPONSE_BODY` | No       | Include response bodies in logs          | String boolean, default `false`                                           | `false`                                                       |
| `LOG_SENSITIVE_FIELDS`      | No       | Comma-separated fields to redact in logs | Defaults to `password,token,secret,authorization,cookie`                  | `password,token,secret,authorization,cookie`                  |

### Environment Notes

- Boolean log flags are parsed from string values such as `true` and `false`.
- Empty strings are treated as undefined by the env parser.
- `LOG_FORMAT` automatically defaults based on `NODE_ENV`.

## Complete Example: Adding a Feature

The following walkthrough is illustrative. `Tags` is not a current feature in this repo, but the example shows how to add a new feature using the same patterns already used by the codebase.

### Step 1: Create `src/db/schemas/tag.ts`

```ts
// File: src/db/schemas/tag.ts
import { sql } from 'drizzle-orm'
import { index, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core'

import { postTable } from './post'

export const tagTable = pgTable(
  'tags',
  {
    id: uuid('id')
      .default(sql`pg_catalog.gen_random_uuid()`)
      .primaryKey(),
    name: text('name').notNull().unique(),
    slug: text('slug').notNull().unique(),
    createdAt: timestamp('created_at').defaultNow().notNull(),
    updatedAt: timestamp('updated_at')
      .defaultNow()
      .$onUpdate(() => /* @__PURE__ */ new Date()),
  },
  (table) => ({
    slugIdx: index('tag_slug_idx').on(table.slug),
  })
)

export const postTagTable = pgTable(
  'post_tags',
  {
    id: uuid('id')
      .default(sql`pg_catalog.gen_random_uuid()`)
      .primaryKey(),
    postId: uuid('post_id')
      .notNull()
      .references(() => postTable.id, { onDelete: 'cascade' }),
    tagId: uuid('tag_id')
      .notNull()
      .references(() => tagTable.id, { onDelete: 'cascade' }),
    createdAt: timestamp('created_at').defaultNow().notNull(),
  },
  (table) => [
    index('post_tag_post_id_idx').on(table.postId),
    index('post_tag_tag_id_idx').on(table.tagId),
  ]
)
```

### Step 2: Export from `src/db/schemas/index.ts`

```ts
// File: src/db/schemas/index.ts
export * from './auth'
export * from './comments'
export * from './likes'
export * from './post'
export * from './relations'
export * from './tag'
export * from './views'
```

### Step 3: Update `src/db/schemas/relations.ts`

```ts
// File: src/db/schemas/relations.ts
import { relations } from 'drizzle-orm'

import { commentTable } from '#/db/schemas/comments'
import { likeTable } from '#/db/schemas/likes'
import { postTable } from '#/db/schemas/post'
import { tagTable, postTagTable } from '#/db/schemas/tag'
import { userTable } from '#/db/schemas/auth'
import { viewTable } from '#/db/schemas/views'

export const postRelations = relations(postTable, ({ one, many }) => ({
  author: one(userTable, {
    fields: [postTable.authorId],
    references: [userTable.id],
  }),
  likes: many(likeTable),
  comments: many(commentTable),
  views: many(viewTable),
  tags: many(postTagTable),
}))

export const tagRelations = relations(tagTable, ({ many }) => ({
  posts: many(postTagTable),
}))

export const postTagRelations = relations(postTagTable, ({ one }) => ({
  post: one(postTable, {
    fields: [postTagTable.postId],
    references: [postTable.id],
  }),
  tag: one(tagTable, {
    fields: [postTagTable.tagId],
    references: [tagTable.id],
  }),
}))
```

### Step 4: Create `src/schemas/tag.schema.ts`

```ts
// File: src/schemas/tag.schema.ts
import { z } from 'zod'

import { ApiSuccessSchema, withStandardResponses } from './api-response.schema'

export const createTagBodySchema = z.object({
  name: z.string().trim().min(1).max(50),
  slug: z
    .string()
    .trim()
    .min(1)
    .max(50)
    .regex(/^[a-z0-9-]+$/),
})

export type CreateTagBodySchema = z.infer<typeof createTagBodySchema>

export const tagResponseDataSchema = z.object({
  id: z.string().uuid(),
  name: z.string(),
  slug: z.string(),
  createdAt: z.string(),
  updatedAt: z.string().nullable(),
})

export const createTagSuccessSchema = ApiSuccessSchema(
  tagResponseDataSchema
).extend({
  message: z.literal('Tag created successfully'),
})

export const createTagRouteResponses = withStandardResponses({
  200: createTagSuccessSchema,
})
```

### Step 5: Create `src/services/tag.service.ts`

```ts
// File: src/services/tag.service.ts
import { db } from '#/db'
import { tagTable } from '#/db/schemas'
import { createServiceLogger } from '#/lib/logger'
import type { CreateTagBodySchema } from '#/schemas/tag.schema'

const logger = createServiceLogger('tagService')

export class TagAlreadyExistsError extends Error {
  constructor() {
    super('Tag already exists')
    this.name = 'TagAlreadyExistsError'
  }
}

export const tagService = {
  create: async (data: CreateTagBodySchema) => {
    const startedAt = performance.now()

    logger.info({
      message: 'Creating tag',
      metadata: {
        slug: data.slug,
      },
    })

    try {
      const [tag] = await db.insert(tagTable).values(data).returning()

      logger.info({
        message: 'Tag created successfully',
        metadata: {
          tagId: tag?.id ?? null,
          slug: data.slug,
        },
        duration: performance.now() - startedAt,
      })

      return tag ?? null
    } catch (error) {
      logger.error({
        message: 'Create tag failed',
        metadata: {
          slug: data.slug,
        },
        error,
        duration: performance.now() - startedAt,
      })

      throw error
    }
  },
}
```

### Step 6: Create `src/routes/tag.route.ts`

```ts
// File: src/routes/tag.route.ts
import Elysia, { status as elysiaStatus } from 'elysia'

import { getRequestAuthSession } from '#/lib/auth'
import {
  createErrorResponse,
  withStandardResponses,
} from '#/schemas/api-response.schema'
import {
  createTagBodySchema,
  type CreateTagBodySchema,
  createTagSuccessSchema,
} from '#/schemas/tag.schema'
import { tagService } from '#/services/tag.service'

type AuthenticatedUser = {
  id: string
  [key: string]: unknown
}

type AuthenticatedSession = {
  session: Record<string, unknown>
  user: AuthenticatedUser
} | null

type CreateTagResult = Awaited<ReturnType<typeof tagService.create>>

type TagRoutesDeps = {
  createTag: (body: CreateTagBodySchema) => Promise<CreateTagResult>
  getSession: (request: Request) => Promise<AuthenticatedSession>
}

export type CreateTagRoutesDeps = Partial<TagRoutesDeps>

const defaultTagRoutesDeps: TagRoutesDeps = {
  createTag: (body) => tagService.create(body),
  getSession: async (request) => {
    const session = await getRequestAuthSession(request)

    if (!session) return null

    return {
      session: session.session,
      user: session.user,
    }
  },
}

const toDateString = (value: Date | string) =>
  value instanceof Date ? value.toISOString() : value

export const createTagRoutes = (deps: CreateTagRoutesDeps = {}) => {
  const runtimeDeps = {
    ...defaultTagRoutesDeps,
    ...deps,
  } satisfies TagRoutesDeps

  const authMacro = new Elysia({ name: 'tag-auth-macro' }).macro({
    requiredAuth: {
      async resolve({ request }) {
        const session = await runtimeDeps.getSession(request)

        if (!session) {
          return elysiaStatus(401, createErrorResponse(401))
        }

        return {
          session: session.session,
          user: session.user,
        }
      },
    },
  })

  return new Elysia({ prefix: '/api/tags' }).use(authMacro).post(
    '/',
    async ({ body }) => {
      const tag = await runtimeDeps.createTag(body)

      if (!tag) {
        return elysiaStatus(500, createErrorResponse(500))
      }

      return {
        success: true,
        message: 'Tag created successfully',
        data: {
          id: tag.id,
          name: tag.name,
          slug: tag.slug,
          createdAt: toDateString(tag.createdAt),
          updatedAt: tag.updatedAt ? toDateString(tag.updatedAt) : null,
        },
      }
    },
    {
      requiredAuth: true,
      body: createTagBodySchema,
      response: withStandardResponses({
        200: createTagSuccessSchema,
      }),
      detail: {
        summary: 'Create tag',
        description: 'Create a new tag.',
        tags: ['Tags'],
        operationId: 'createTag',
      },
    }
  )
}

export const tagRoutes = createTagRoutes()
```

### Step 7: Register `tagRoutes` in `src/index.ts`

```ts
// File: src/index.ts
import { tagRoutes } from '#/routes/tag.route'

const app = new Elysia()
  .use(apiErrorPlugin)
  .use(requestLoggerPlugin)
  .mount('/auth', auth.handler)
  .use(postRoutes)
  .use(engagementRoutes)
  .use(tagRoutes)
```

### Step 8: Generate a Migration

```bash
bun run db:generate
```

## Verification Checklist

Before opening a pull request, verify these points:

- A new contributor can identify where to place schemas, services, and routes.
- New table examples follow current Drizzle patterns from this repo.
- Route examples use dependency injection, auth macros, and standard response helpers.
- Services use structured logging and return domain data, not HTTP response wrappers.
- Naming examples match current exported identifiers.
- Environment variable descriptions match `src/env.ts` and `.env.example`.
