# Marvticle API

`marvticle-api` is a Bun + Elysia backend for a blog-style application. It
provides post publishing, engagement APIs, Better Auth integration, OpenAPI
documentation, structured logging, and PostgreSQL persistence through
Drizzle ORM.

This README is the high-level operational guide for the repo. For
implementation conventions, read [CONTRIBUTING.md](./CONTRIBUTING.md). For
frontend consumption patterns, read
[docs/frontend-api-guide.md](./docs/frontend-api-guide.md).

## What the API currently does

- Publishes and lists blog posts with cursor-based pagination
- Fetches a single published post by ID
- Creates posts for authenticated users
- Updates posts for the owning author or an admin
- Deletes posts for the owning author or an admin
- Tracks engagement:
  - likes
  - comments and nested replies
  - comment update and delete
  - post views for authenticated and anonymous visitors
- Exposes Better Auth endpoints under `/auth/api/*`
- Serves OpenAPI docs for both app routes and Better Auth routes
- Emits structured request, database, and auth logs with redaction support

## Stack

- Runtime: Bun
- HTTP framework: Elysia
- Database: PostgreSQL
- ORM / migrations: Drizzle ORM + drizzle-kit
- Auth: Better Auth
- Validation: Zod + drizzle-zod
- Logging: Pino
- Testing: `bun test`

## API surface

### Application routes

| Method   | Path                             | Auth     | Notes                                                  |
| -------- | -------------------------------- | -------- | ------------------------------------------------------ |
| `GET`    | `/`                              | Public   | Returns a basic server response                        |
| `GET`    | `/api/posts`                     | Public   | Published posts with cursor pagination                 |
| `GET`    | `/api/posts/:id`                 | Public   | Single published post                                  |
| `POST`   | `/api/posts`                     | Required | Create a post                                          |
| `PUT`    | `/api/posts/:id`                 | Required | Update a post owned by the current user or an admin    |
| `DELETE` | `/api/posts/:id`                 | Required | Delete a post owned by the current user or an admin    |
| `POST`   | `/api/engagement/likes`          | Required | Toggle like on a published post                        |
| `GET`    | `/api/engagement/likes/count`    | Public   | Count likes for a published post                       |
| `GET`    | `/api/engagement/comments`       | Public   | Paginated root comments with nested replies            |
| `POST`   | `/api/engagement/comments`       | Required | Create a comment or reply                              |
| `PUT`    | `/api/engagement/comments/:id`   | Required | Update own comment                                     |
| `DELETE` | `/api/engagement/comments/:id`   | Required | Delete own comment                                     |
| `GET`    | `/api/engagement/comments/count` | Public   | Count comments including replies                       |
| `POST`   | `/api/engagement/views`          | Optional | Tracks a view; requires auth or a resolvable client IP |
| `GET`    | `/api/engagement/views/count`    | Public   | Count views for a published post                       |

### Auth routes

Better Auth is mounted at `/auth` with `basePath: '/api'`, so auth endpoints
live under:

- `/auth/api/sign-in/*`
- `/auth/api/sign-up/*`
- `/auth/api/sign-out`
- `/auth/api/get-session`
- other Better Auth plugin routes

The auth OpenAPI schema is merged into the main OpenAPI document and tagged as
`Better Auth`.

### OpenAPI docs

- UI: `/docs`
- JSON: `/docs/json`

## Response contract

All `/api/*` routes use the same success and error envelope.

### Success shape

```json
{
  "success": true,
  "message": "Posts fetched successfully",
  "data": {
    "items": [],
    "nextCursor": null,
    "hasMore": false
  }
}
```

### Error shape

```json
{
  "success": false,
  "code": "VALIDATION_ERROR",
  "message": "Validation error",
  "errors": {
    "postId": "Invalid uuid"
  }
}
```

This contract is centralized in `src/schemas/api-response.schema.ts` and
normalized globally by `src/plugins/api-error.plugin.ts`.

## Architecture overview

```text
src/
├── db/
│   ├── migrations/          # Generated SQL migrations
│   ├── schemas/             # Table definitions and centralized relations
│   ├── index.ts             # Database bootstrap
│   └── query-logger.ts      # pg query instrumentation
├── lib/
│   ├── auth/                # Better Auth setup and auth helpers
│   ├── logger/              # Shared logger, context, redaction, serialization
│   ├── openapi.ts           # OpenAPI configuration
│   └── viewer-ip.ts         # Viewer IP hashing
├── plugins/
│   ├── api-error.plugin.ts
│   └── request-logger.plugin.ts
├── routes/                  # Thin HTTP layer
├── schemas/                 # Zod request/response schemas
├── services/                # Domain logic and data access orchestration
├── env.ts                   # Environment validation
└── index.ts                 # App bootstrap
```

Current backend domains:

- `posts`
- `engagement`
- `auth`
- `logging / observability`

## Local development

### Prerequisites

- Bun installed
- Docker available for local PostgreSQL

### 1. Install dependencies

```bash
bun install
```

### 2. Create your environment file

Use `.env.example` as the base.

```bash
cp .env.example .env
```

### 3. Start PostgreSQL

```bash
bun run db:start
```

This uses [`docker-compose.yml`](./docker-compose.yml) and starts:

- database: `marvticle-api`
- username: `postgres`
- password: `password`
- port: `5432`

### 4. Apply migrations

```bash
bun run db:migrate
```

### 5. Start the API

```bash
bun run dev
```

Default local addresses:

- API server: `http://localhost:3000`
- OpenAPI UI: `http://localhost:3000/docs`
- OpenAPI JSON: `http://localhost:3000/docs/json`

## Environment variables

All variables are validated in [`src/env.ts`](./src/env.ts) and example values
are provided in [`.env.example`](./.env.example).

| Variable                    | Required | Description                          | Validation / Default                                             |
| --------------------------- | -------- | ------------------------------------ | ---------------------------------------------------------------- |
| `DATABASE_URL`              | Yes      | PostgreSQL connection string         | Must be a valid URL                                              |
| `PORT`                      | Yes      | HTTP port                            | Integer `0-65535`                                                |
| `CORS_ORIGIN`               | Yes      | Allowed browser origin               | Must be a valid URL                                              |
| `BETTER_AUTH_SECRET`        | Yes      | Better Auth secret                   | Minimum 32 characters                                            |
| `BETTER_AUTH_URL`           | Yes      | Public auth base URL                 | Must be a valid URL                                              |
| `VIEWER_IP_HASH_SALT`       | No       | Salt for anonymous viewer IP hashing | Minimum 16 characters if set; falls back to `BETTER_AUTH_SECRET` |
| `LOG_LEVEL`                 | No       | Logger level                         | Defaults to `info`                                               |
| `LOG_FORMAT`                | No       | Logger format                        | Defaults to `pretty` outside production and `json` in production |
| `LOG_INCLUDE_DB_QUERIES`    | No       | Enable DB query logging              | String boolean, default `false`                                  |
| `LOG_INCLUDE_AUTH_EVENTS`   | No       | Enable auth event logging            | String boolean, default `true`                                   |
| `LOG_INCLUDE_REQUEST_BODY`  | No       | Include request bodies in logs       | String boolean, default `false`                                  |
| `LOG_INCLUDE_RESPONSE_BODY` | No       | Include response bodies in logs      | String boolean, default `false`                                  |
| `LOG_SENSITIVE_FIELDS`      | No       | Comma-separated fields to redact     | Defaults to `password,token,secret,authorization,cookie`         |

## Scripts

| Command               | Purpose                                         |
| --------------------- | ----------------------------------------------- |
| `bun run dev`         | Start the Bun dev server with watch mode        |
| `bun run test`        | Run the test suite                              |
| `bun run db:start`    | Start PostgreSQL with Docker Compose            |
| `bun run db:watch`    | Run Docker Compose in the foreground            |
| `bun run db:stop`     | Stop the PostgreSQL service                     |
| `bun run db:down`     | Tear down the PostgreSQL service                |
| `bun run db:generate` | Generate Drizzle migrations from schema changes |
| `bun run db:migrate`  | Apply generated migrations                      |
| `bun run db:push`     | Push schema changes directly                    |
| `bun run db:studio`   | Open Drizzle Studio                             |

Recommended local verification commands:

```bash
bun run test
bunx tsc --noEmit
bunx prettier --check .
```

## Observability, logging, and privacy

### Request logging

`src/plugins/request-logger.plugin.ts` logs:

- request start
- request completion or failure
- request ID propagation via `x-request-id`
- sanitized headers
- optional request and response bodies
- hashed client IP when resolvable

### Database query logging

`src/db/query-logger.ts` wraps the `pg` pool and can log:

- query text
- sanitized params
- duration
- row count
- slow query warnings
- query failures

### Auth event logging

`src/lib/auth/index.ts` logs:

- sign-in and sign-up flows
- session creation, update, validation, and invalidation
- verification lifecycle events
- auth request and response metadata

### Viewer IP hashing

Anonymous views never store plaintext IP addresses. The app stores
`viewer_ip_hash` as `v1:<hex>` using HMAC-SHA256.

- Primary salt: `VIEWER_IP_HASH_SALT`
- Fallback salt: `BETTER_AUTH_SECRET`
- Rotating the salt changes all future hashes

Historical note:

- migration `0002` removes legacy plaintext IP data from `views`
- legacy anonymous rows are preserved with `legacy:redacted`

## Better Auth configuration

Current auth capabilities configured in `src/lib/auth/index.ts`:

- email and password auth
- username plugin
- bearer token plugin
- multi-session plugin
- admin plugin
- Better Auth OpenAPI plugin
- auth event logging hooks

Trusted provider account linking is enabled for:

- GitHub
- Google

## Testing

Current tests cover:

- `test/post.route.test.ts`
- `test/engagement.route.test.ts`
- `test/logger.test.ts`

These tests validate:

- response contracts
- route behavior
- OpenAPI metadata exposure
- request logging behavior
- validation handling
- database and logger infrastructure behavior

## Documentation map

Use the right file for the right kind of update:

- [`README.md`](./README.md): project overview, setup, runtime behavior,
  operational checklist
- [`CONTRIBUTING.md`](./CONTRIBUTING.md): implementation patterns and repo
  conventions
- [`docs/frontend-api-guide.md`](./docs/frontend-api-guide.md): frontend
  contract and API consumption guidance

## When you change the codebase

This is the most important maintenance section in the repo. When a feature is
added, removed, or changed, do not stop at the code that makes the behavior
work. Update the surrounding contract, documentation, schema, and tests that
make the feature maintainable.

### Always review these files

For any non-trivial backend change, review whether these files also need an
update:

- [`README.md`](./README.md)
  Why: this file documents runtime capabilities, setup, and operational impact.
- [`CONTRIBUTING.md`](./CONTRIBUTING.md)
  Why: update it if the repo’s recommended implementation pattern changes.
- [`docs/frontend-api-guide.md`](./docs/frontend-api-guide.md)
  Why: update it if `/api/*` request or response behavior changes.
- [`test/`](./test)
  Why: every behavior change should be protected by tests.

### 1. If you add or change a public API endpoint

You usually need to update:

- `src/routes/*.route.ts`
  Add or modify the HTTP endpoint.
- `src/schemas/*.schema.ts`
  Define request, params, query, and response envelope data schemas.
- `src/services/*.service.ts`
  Move business logic and persistence orchestration here.
- `src/plugins/api-error.plugin.ts`
  Review only if the new endpoint introduces a new cross-cutting error pattern.
- `src/index.ts`
  Register a new route module if you created one.
- `test/*.test.ts`
  Add route contract tests and behavior tests.
- `docs/frontend-api-guide.md`
  Update the endpoint inventory and any frontend parsing guidance.
- `README.md`
  Update the API surface table if the endpoint is public or changes behavior.

You must also verify:

- the route has `detail.summary`, `detail.description`, `detail.tags`, and
  `detail.operationId`
- the route uses `ApiSuccessSchema(...)` and
  `withStandardResponses({ 200: ... })`
- predictable domain failures are mapped with
  `elysiaStatus(code, createErrorResponse(...))`

### 2. If you add or change database tables or relations

You usually need to update:

- `src/db/schemas/*.ts`
  Add or modify table definitions.
- `src/db/schemas/relations.ts`
  Add or modify Drizzle relations in the centralized relations file.
- `src/db/schemas/index.ts`
  Export new schema modules from the barrel file when applicable.
- `src/db/migrations/*`
  Generate and commit the migration files with `bun run db:generate`.
- `src/services/*.service.ts`
  Update queries and domain behavior that depend on the schema.
- `test/*.test.ts`
  Update behavior tests when schema changes affect runtime behavior.
- `README.md`
  Update feature or setup sections if the schema change affects public behavior.
- `CONTRIBUTING.md`
  Update only if schema patterns or recommended table conventions changed.

You must also verify:

- no new `relations()` definitions were placed in individual schema files
- migrations were generated instead of silently changing schema files only
- the public API and docs still reflect the new persistence behavior

### 3. If you add a new environment variable

You must update:

- `src/env.ts`
  Add validation and default handling.
- `.env.example`
  Add the variable with a safe example value or blank placeholder.
- `README.md`
  Add it to the environment table and explain what it controls.

You should also review:

- `CONTRIBUTING.md`
  Update if contributor setup expectations changed.
- relevant runtime files
  Wire the variable into the code that uses it.
- tests
  Add or update tests if the variable changes behavior materially.

### 4. If you change authentication behavior

You usually need to update:

- `src/lib/auth/index.ts`
  Change Better Auth configuration, hooks, providers, or plugins.
- `.env.example`
  Add provider secrets or auth-related config if newly required.
- `src/env.ts`
  Validate any new auth env variables.
- `README.md`
  Update the auth capabilities section and environment table.
- `docs/frontend-api-guide.md`
  Update only if auth affects how frontend should call backend APIs.
- tests
  Add or update tests around route auth behavior or auth integration.

Examples:

- new auth provider
- changed session lifetime
- new plugin
- changed auth route behavior

### 5. If you change the response contract

This is a high-impact change. You must update all contract surfaces together.

Required updates:

- `src/schemas/api-response.schema.ts`
- `src/plugins/api-error.plugin.ts`
- affected `src/routes/*.route.ts`
- `test/*.test.ts`
- `docs/frontend-api-guide.md`
- `README.md`

Why this matters:

- frontend parsing depends on the envelope
- route tests lock the API contract
- OpenAPI descriptions become misleading if the schema contract drifts

### 6. If you add a new domain or feature module

A typical backend feature addition may require:

- `src/db/schemas/<domain>.ts`
- `src/db/schemas/relations.ts`
- `src/db/schemas/index.ts`
- `src/schemas/<domain>.schema.ts`
- `src/services/<domain>.service.ts`
- `src/routes/<domain>.route.ts`
- `src/index.ts`
- generated migration files
- new tests in `test/`
- `README.md`
- `CONTRIBUTING.md`
- `docs/frontend-api-guide.md`

If the feature is public-facing, also update:

- API inventory in this README
- frontend integration guide
- any examples or sample payloads that mention affected domains

### 7. If you change logging, redaction, or observability behavior

You usually need to update:

- `src/lib/logger/*`
- `src/plugins/request-logger.plugin.ts`
- `src/db/query-logger.ts`
- `src/lib/auth/index.ts`
- `src/env.ts`
- `.env.example`
- `README.md`
- `test/logger.test.ts`

Examples:

- new sensitive fields
- different request/response body logging policy
- changed query logging toggle
- changed request ID behavior

### 8. If you change viewer IP handling or privacy behavior

You must review:

- `src/lib/viewer-ip.ts`
- `src/routes/engagement.route.ts`
- `src/db/schemas/views.ts`
- migrations if storage changes
- `README.md`
- `CONTRIBUTING.md`
- tests that cover anonymous or authenticated view tracking

Why:

- this area affects privacy guarantees, not just implementation detail

### 9. If you add or change package scripts or tooling

You usually need to update:

- `package.json`
- `README.md`
- possibly `CONTRIBUTING.md`

Examples:

- new verification command
- new migration workflow
- changed dev startup command

## Change review checklist

Before merging a feature change, ask these questions:

- Did the public API inventory in this README become outdated?
- Did any setup step, env var, or script change?
- Did the frontend integration guide become inaccurate?
- Did a repo convention change enough to require a `CONTRIBUTING.md` update?
- Did the test suite gain coverage for the new behavior?
- Did the OpenAPI docs stay accurate?
- If persistence changed, were migrations generated and committed?
- If privacy or logging changed, did the docs explain the new behavior clearly?

## Development expectations

- Keep routes thin.
- Keep business logic in services.
- Keep relations centralized in `src/db/schemas/relations.ts`.
- Keep response envelopes standardized.
- Keep docs synchronized with behavior changes.
- Do not treat README updates as optional when runtime behavior changes.
