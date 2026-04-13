import { describe, expect, it } from 'bun:test'
import { openapi } from '@elysiajs/openapi'
import { Elysia } from 'elysia'
import { z } from 'zod'

import {
  createOpenApiConfig,
  OPENAPI_DOCS_PATH,
  OPENAPI_INFO,
} from '#/lib/openapi'
import { apiErrorPlugin } from '#/plugins/api-error.plugin'
import {
  createPostRoutes,
  type CreatePostRoutesDeps,
} from '#/routes/post.route'
import { InvalidCursorError } from '#/services/post.service'

const validRequestBody = {
  title: 'Post title',
  slug: 'post-title',
  content: 'Post content',
  coverImage: 'https://example.com/post.jpg',
  published: true,
}

const createdPost = {
  id: '550e8400-e29b-41d4-a716-446655440000',
  title: validRequestBody.title,
  slug: validRequestBody.slug,
  content: validRequestBody.content,
  coverImage: validRequestBody.coverImage,
  published: validRequestBody.published,
  authorId: '550e8400-e29b-41d4-a716-446655440001',
  createdAt: new Date('2026-04-11T00:00:00.000Z'),
  updatedAt: new Date('2026-04-11T00:00:00.000Z'),
}

const buildApp = (deps: CreatePostRoutesDeps = {}) => {
  const defaultDeps: CreatePostRoutesDeps = {
    authorizeCreatePost: async () => true,
    createPost: async () => createdPost,
    findPostById: async () => createdPost,
    getSession: async () => ({
      session: { id: 'session-id' },
      user: { id: createdPost.authorId },
    }),
    isRateLimited: async () => false,
    listPosts: async () => ({
      items: [createdPost],
      nextCursor: 'next-cursor-token',
      hasMore: true,
    }),
  }

  return new Elysia()
    .use(openapi(createOpenApiConfig()))
    .use(apiErrorPlugin)
    .use(createPostRoutes({ ...defaultDeps, ...deps }))
    .get(
      '/__test/custom-403',
      ({ status }) => status(403, { message: 'Custom forbidden' }),
      {
        response: {
          403: z.object({ message: z.string() }),
        },
      }
    )
    .get('/__test/custom-429', ({ status }) => status(429, 'Rate limited'), {
      response: {
        429: z.string(),
      },
    })
    .get(
      '/__test/business-object',
      () => ({
        code: 404,
        response: { message: 'Business object, not HTTP wrapper' },
      }),
      {
        response: z.object({
          code: z.number(),
          response: z.object({
            message: z.string(),
          }),
        }),
      }
    )
    .get(
      '/__test/custom-404',
      ({ status }) => status(404, 'Missing resource'),
      {
        response: {
          404: z.string(),
        },
      }
    )
}

const getOpenApiSpecRequest = () =>
  new Request(`http://localhost${OPENAPI_DOCS_PATH}/json`)

const postRequest = (payload: unknown) =>
  new Request('http://localhost/api/posts', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
    },
    body: JSON.stringify(payload),
  })

const getPostsRequest = (query?: URLSearchParams) =>
  new Request(
    `http://localhost/api/posts${query ? `?${query.toString()}` : ''}`
  )

const getPostByIdRequest = (id: string) =>
  new Request(`http://localhost/api/posts/${id}`)

describe('post.route response contract', () => {
  it('returns 200 on get posts with cursor pagination payload', async () => {
    const app = buildApp()
    const response = await app.handle(
      getPostsRequest(
        new URLSearchParams({
          limit: '10',
        })
      )
    )
    const body = (await response.json()) as Record<string, unknown>

    expect(response.status).toBe(200)
    expect(body['success']).toBe(true)
    expect(body['message']).toBe('Posts fetched successfully')

    const data = body['data'] as Record<string, unknown>
    expect(Array.isArray(data['items'])).toBe(true)
    expect(data['nextCursor']).toBe('next-cursor-token')
    expect(data['hasMore']).toBe(true)
  })

  it('returns 400 on invalid cursor for get posts', async () => {
    const app = buildApp({
      listPosts: async () => {
        throw new InvalidCursorError()
      },
    })
    const response = await app.handle(
      getPostsRequest(
        new URLSearchParams({
          cursor: 'invalid-cursor',
        })
      )
    )
    const body = (await response.json()) as Record<string, unknown>

    expect(response.status).toBe(400)
    expect(body['success']).toBe(false)
    expect(body['code']).toBe('BAD_REQUEST')
    expect(body['message']).toBe('Invalid cursor')
  })

  it('returns 200 on get one post by id', async () => {
    const app = buildApp()
    const response = await app.handle(getPostByIdRequest(createdPost.id))
    const body = (await response.json()) as Record<string, unknown>

    expect(response.status).toBe(200)
    expect(body['success']).toBe(true)
    expect(body['message']).toBe('Post fetched successfully')

    const data = body['data'] as Record<string, unknown>
    expect(data['id']).toBe(createdPost.id)
  })

  it('returns 404 on get one post by id when not found', async () => {
    const app = buildApp({
      findPostById: async () => null,
    })
    const response = await app.handle(getPostByIdRequest(createdPost.id))
    const body = (await response.json()) as Record<string, unknown>

    expect(response.status).toBe(404)
    expect(body['success']).toBe(false)
    expect(body['code']).toBe('NOT_FOUND')
    expect(body['message']).toBe('Post not found')
  })

  it('returns 200 on successful create', async () => {
    const app = buildApp()
    const response = await app.handle(postRequest(validRequestBody))
    const body = (await response.json()) as Record<string, unknown>

    expect(response.status).toBe(200)
    expect(body['success']).toBe(true)
    expect(body['message']).toBe('Post created successfully')
    expect((body['data'] as Record<string, unknown>)['createdAt']).toBe(
      '2026-04-11T00:00:00.000Z'
    )
  })

  it('returns 401 when session does not exist', async () => {
    const app = buildApp({
      getSession: async () => null,
    })
    const response = await app.handle(postRequest(validRequestBody))
    const body = (await response.json()) as Record<string, unknown>

    expect(response.status).toBe(401)
    expect(body['success']).toBe(false)
    expect(body['code']).toBe('UNAUTHORIZED')
    expect(body['message']).toBe('Unauthorized')
  })

  it('returns 403 when authorization check fails', async () => {
    const app = buildApp({
      authorizeCreatePost: async () => false,
    })
    const response = await app.handle(postRequest(validRequestBody))
    const body = (await response.json()) as Record<string, unknown>

    expect(response.status).toBe(403)
    expect(body['success']).toBe(false)
    expect(body['code']).toBe('FORBIDDEN')
  })

  it('returns 404 for missing resource', async () => {
    const app = buildApp()
    const response = await app.handle(
      new Request('http://localhost/__test/custom-404')
    )
    const body = (await response.json()) as Record<string, unknown>

    expect(response.status).toBe(404)
    expect(body['success']).toBe(false)
    expect(body['code']).toBe('NOT_FOUND')
  })

  it('returns 422 for invalid body', async () => {
    const app = buildApp()
    const response = await app.handle(
      postRequest({
        ...validRequestBody,
        title: 'a',
        slug: 'b',
      })
    )
    const body = (await response.json()) as Record<string, unknown>

    expect(response.status).toBe(422)
    expect(body['success']).toBe(false)
    expect(body['code']).toBe('VALIDATION_ERROR')
    expect(body['errors']).toBeDefined()
    const errors = body['errors'] as Record<string, unknown>
    expect(typeof errors['title']).toBe('string')
    expect(typeof errors['slug']).toBe('string')
  })

  it('returns 429 when rate limited', async () => {
    const app = buildApp({
      isRateLimited: async () => true,
    })
    const response = await app.handle(postRequest(validRequestBody))
    const body = (await response.json()) as Record<string, unknown>

    expect(response.status).toBe(429)
    expect(body['success']).toBe(false)
    expect(body['code']).toBe('TOO_MANY_REQUESTS')
  })

  it('returns 400 for predictable domain error', async () => {
    const app = buildApp({
      createPost: async () => {
        throw {
          code: '23505',
          constraint: 'posts_slug_key',
        }
      },
    })
    const response = await app.handle(postRequest(validRequestBody))
    const body = (await response.json()) as Record<string, unknown>

    expect(response.status).toBe(400)
    expect(body['success']).toBe(false)
    expect(body['code']).toBe('BAD_REQUEST')
    expect(body['message']).toBe('Slug already exists')
  })

  it('returns 500 for unexpected error', async () => {
    const app = buildApp({
      createPost: async () => {
        throw new Error('Unexpected error')
      },
    })
    const response = await app.handle(postRequest(validRequestBody))
    const body = (await response.json()) as Record<string, unknown>

    expect(response.status).toBe(500)
    expect(body['success']).toBe(false)
    expect(body['code']).toBe('INTERNAL_SERVER_ERROR')
  })

  it('normalizes custom numeric error response payloads', async () => {
    const app = buildApp()

    const forbiddenResponse = await app.handle(
      new Request('http://localhost/__test/custom-403')
    )
    const forbiddenBody = (await forbiddenResponse.json()) as Record<
      string,
      unknown
    >

    const rateLimitResponse = await app.handle(
      new Request('http://localhost/__test/custom-429')
    )
    const rateLimitBody = (await rateLimitResponse.json()) as Record<
      string,
      unknown
    >

    expect(forbiddenResponse.status).toBe(403)
    expect(forbiddenBody['code']).toBe('FORBIDDEN')

    expect(rateLimitResponse.status).toBe(429)
    expect(rateLimitBody['code']).toBe('TOO_MANY_REQUESTS')
    expect(rateLimitBody['message']).toBe('Rate limited')
  })

  it('does not treat ordinary business objects as status wrappers', async () => {
    const app = buildApp()
    const response = await app.handle(
      new Request('http://localhost/__test/business-object')
    )
    const body = (await response.json()) as Record<string, unknown>

    expect(response.status).toBe(200)
    expect(body).toEqual({
      code: 404,
      response: {
        message: 'Business object, not HTTP wrapper',
      },
    })
  })

  it('serves OpenAPI UI and exposes the custom API info document', async () => {
    const app = buildApp()

    const docsResponse = await app.handle(
      new Request(`http://localhost${OPENAPI_DOCS_PATH}`)
    )
    const specResponse = await app.handle(getOpenApiSpecRequest())
    const spec = (await specResponse.json()) as {
      info?: Record<string, unknown>
    }

    expect(docsResponse.status).toBe(200)
    expect(docsResponse.headers.get('content-type')).toContain('text/html')

    expect(specResponse.status).toBe(200)
    expect(spec.info).toMatchObject(OPENAPI_INFO)
  })

  it('exposes 200/400/401/403/404/422/429/500 in OpenAPI post responses', async () => {
    const app = buildApp()
    const response = await app.handle(getOpenApiSpecRequest())
    const spec = (await response.json()) as {
      paths?: Record<string, { post?: { responses?: Record<string, unknown> } }>
    }

    const postPathKey = Object.keys(spec.paths ?? {}).find(
      (path) => path === '/api/posts' || path === '/api/posts/'
    )
    const responses =
      (postPathKey ? spec.paths?.[postPathKey]?.post?.responses : undefined) ??
      {}

    expect(Object.keys(responses)).toEqual(
      // eslint-disable-next-line @typescript-eslint/no-unsafe-argument
      expect.arrayContaining([
        '200',
        '400',
        '401',
        '403',
        '404',
        '422',
        '429',
        '500',
      ])
    )
  })

  it('exposes OpenAPI detail metadata for post endpoints', async () => {
    const app = buildApp()
    const response = await app.handle(getOpenApiSpecRequest())
    const spec = (await response.json()) as {
      paths?: Record<
        string,
        {
          get?: {
            summary?: string
            description?: string
            tags?: string[]
            operationId?: string
          }
          post?: {
            summary?: string
            description?: string
            tags?: string[]
            operationId?: string
          }
        }
      >
    }

    const listPathKey = Object.keys(spec.paths ?? {}).find(
      (path) => path === '/api/posts' || path === '/api/posts/'
    )
    const postByIdPathKey = Object.keys(spec.paths ?? {}).find(
      (path) => path.includes('/api/posts') && path.includes('id')
    )

    expect(listPathKey).toBeDefined()
    expect(postByIdPathKey).toBeDefined()

    expect(spec.paths?.[listPathKey!]?.get).toMatchObject({
      summary: 'List all posts',
      description:
        'Retrieve a paginated list of published posts with cursor-based pagination.',
      tags: ['Posts'],
      operationId: 'listPosts',
    })

    expect(spec.paths?.[listPathKey!]?.post).toMatchObject({
      summary: 'Create a new post',
      description: 'Create a new blog post. Requires authentication.',
      tags: ['Posts'],
      operationId: 'createPost',
    })

    expect(spec.paths?.[postByIdPathKey!]?.get).toMatchObject({
      summary: 'Get post by ID',
      description: 'Retrieve a single published post by its ID.',
      tags: ['Posts'],
      operationId: 'getPostById',
    })
  })
})
