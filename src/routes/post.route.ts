import Elysia, { status as elysiaStatus } from 'elysia'
import { z } from 'zod'

import { auth } from '#/lib/auth'
import {
  ApiSuccessSchema,
  createErrorResponse,
  withStandardResponses,
} from '#/schemas/api-response.schema'
import { selectPostSchema } from '#/schemas/drizzle-zod'
import {
  createPostBodySchema,
  type CreatePostBodySchema,
  getPostByIdParamsSchema,
  getPostsQuerySchema,
  type GetPostsQuerySchema,
} from '#/schemas/post.schema'
import {
  InvalidCursorError,
  postService,
} from '#/services/post.service'

type AuthenticatedUser = {
  id: string
  [key: string]: unknown
}

type AuthenticatedSession = {
  session: Record<string, unknown>
  user: AuthenticatedUser
} | null

type CreatePostResult = Awaited<ReturnType<typeof postService.create>>
type ListPostsResult = Awaited<
  ReturnType<typeof postService.listPublishedWithCursor>
>
type FindPostByIdResult = Awaited<
  ReturnType<typeof postService.findPublishedById>
>

type AuthorizeCreatePostInput = {
  body: CreatePostBodySchema
  user: AuthenticatedUser
}

type PostRoutesDeps = {
  authorizeCreatePost: (input: AuthorizeCreatePostInput) => Promise<boolean>
  createPost: (
    data: CreatePostBodySchema,
    authorId: string
  ) => Promise<CreatePostResult | null | undefined>
  findPostById: (id: string) => Promise<FindPostByIdResult | null | undefined>
  getSession: (request: Request) => Promise<AuthenticatedSession>
  isRateLimited: (input: AuthorizeCreatePostInput) => Promise<boolean>
  listPosts: (query: GetPostsQuerySchema) => Promise<ListPostsResult>
}

export type CreatePostRoutesDeps = Partial<PostRoutesDeps>

const postResponseDataSchema = selectPostSchema
  .omit({
    createdAt: true,
    updatedAt: true,
  })
  .extend({
    createdAt: z.string(),
    updatedAt: z.string().nullable(),
  })

const createPostResponseSchema = ApiSuccessSchema(
  postResponseDataSchema
).extend({
  message: z.literal('Post created successfully'),
})

const getPostByIdResponseSchema = ApiSuccessSchema(
  postResponseDataSchema
).extend({
  message: z.literal('Post fetched successfully'),
})

const getPostsResponseSchema = ApiSuccessSchema(
  z.object({
    items: z.array(postResponseDataSchema),
    nextCursor: z.string().nullable(),
    hasMore: z.boolean(),
  })
).extend({
  message: z.literal('Posts fetched successfully'),
})

const defaultPostRoutesDeps: PostRoutesDeps = {
  authorizeCreatePost: async () => true,
  createPost: (data, authorId) => postService.create(data, authorId),
  findPostById: (id) => postService.findPublishedById(id),
  getSession: async (request) => {
    const session = await auth.api.getSession({
      headers: request.headers,
    })

    if (!session) return null

    return {
      session: session.session,
      user: session.user,
    }
  },
  isRateLimited: async () => false,
  listPosts: (query) => postService.listPublishedWithCursor(query),
}

const isUniqueConstraintError = (
  error: unknown
): error is {
  code: '23505'
  constraint?: string
  detail?: string
} => {
  if (!error || typeof error !== 'object') return false

  return (error as { code?: unknown }).code === '23505'
}

const toDateString = (value: unknown) => {
  if (value instanceof Date) return value.toISOString()
  if (typeof value === 'string') return value

  return new Date(String(value)).toISOString()
}

const mapPostResponse = <
  T extends {
    createdAt: unknown
    updatedAt: unknown
  },
>(
  post: T
) => ({
  ...post,
  createdAt: toDateString(post.createdAt),
  updatedAt: post.updatedAt ? toDateString(post.updatedAt) : null,
})

/**
 * Post Routes
 */
export const createPostRoutes = (deps: CreatePostRoutesDeps = {}) => {
  const runtimeDeps = {
    ...defaultPostRoutesDeps,
    ...deps,
  } satisfies PostRoutesDeps

  const authMacro = new Elysia({ name: 'post-auth-macro' }).macro({
    optionalAuth: {
      async resolve({ request }) {
        const session = await runtimeDeps.getSession(request)

        if (!session) return

        return {
          session: session.session,
          user: session.user,
        }
      },
    },

    requiredAuth: {
      async resolve({ request }) {
        const session = await runtimeDeps.getSession(request)

        if (!session) return elysiaStatus(401, createErrorResponse(401))

        return {
          session: session.session,
          user: session.user,
        }
      },
    },
  })

  return new Elysia({ prefix: '/api/posts' })
    .use(authMacro)
    .get(
      '/',
      async ({ query }) => {
        try {
          const posts = await runtimeDeps.listPosts(query)

          return {
            success: true,
            message: 'Posts fetched successfully',
            data: {
              items: posts.items.map((post) => mapPostResponse(post)),
              nextCursor: posts.nextCursor,
              hasMore: posts.hasMore,
            },
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
      },
      {
        query: getPostsQuerySchema,
        response: withStandardResponses({
          200: getPostsResponseSchema,
        }),
        detail: {
          summary: 'List all posts',
          description:
            'Retrieve a paginated list of published posts with cursor-based pagination.',
          tags: ['Posts'],
          operationId: 'listPosts',
        },
      }
    )
    .get(
      '/:id',
      async ({ params }) => {
        const post = await runtimeDeps.findPostById(params.id)

        if (!post) {
          return elysiaStatus(
            404,
            createErrorResponse(404, {
              message: 'Post not found',
            })
          )
        }

        return {
          success: true,
          message: 'Post fetched successfully',
          data: mapPostResponse(post),
        }
      },
      {
        params: getPostByIdParamsSchema,
        response: withStandardResponses({
          200: getPostByIdResponseSchema,
        }),
        detail: {
          summary: 'Get post by ID',
          description: 'Retrieve a single published post by its ID.',
          tags: ['Posts'],
          operationId: 'getPostById',
        },
      }
    )
    .post(
      '/',
      async ({ body, user }) => {
        if (!(await runtimeDeps.authorizeCreatePost({ body, user }))) {
          return elysiaStatus(403, createErrorResponse(403))
        }

        if (await runtimeDeps.isRateLimited({ body, user })) {
          return elysiaStatus(429, createErrorResponse(429))
        }

        try {
          const post = await runtimeDeps.createPost(body, user.id)

          if (!post) return elysiaStatus(500, createErrorResponse(500))

          return {
            success: true,
            message: 'Post created successfully',
            data: mapPostResponse(post),
          }
        } catch (error) {
          if (isUniqueConstraintError(error)) {
            const isSlugConstraint =
              error.constraint?.includes('slug') ??
              error.detail?.includes('slug')

            return elysiaStatus(
              400,
              createErrorResponse(400, {
                message: isSlugConstraint ? 'Slug already exists' : 'Bad request',
              })
            )
          }

          throw error
        }
      },
      {
        requiredAuth: true,
        body: createPostBodySchema,
        response: withStandardResponses({
          200: createPostResponseSchema,
        }),
        detail: {
          summary: 'Create a new post',
          description: 'Create a new blog post. Requires authentication.',
          tags: ['Posts'],
          operationId: 'createPost',
        },
      }
    )
}

export const postRoutes = createPostRoutes()
