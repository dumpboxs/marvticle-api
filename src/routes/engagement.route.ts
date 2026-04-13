import Elysia, { status as elysiaStatus } from 'elysia'
import { z } from 'zod'

import { auth } from '#/lib/auth'
import { hashViewerIp } from '#/lib/viewer-ip'
import {
  ApiSuccessSchema,
  createErrorResponse,
  withStandardResponses,
} from '#/schemas/api-response.schema'
import {
  commentParamsSchema,
  createCommentBodySchema,
  getCommentsQuerySchema,
  postIdQuerySchema,
  trackViewBodySchema,
  type UpdateCommentBodySchema,
  updateCommentBodySchema,
  toggleLikeBodySchema,
  type ToggleLikeBodySchema,
  type CreateCommentBodySchema,
} from '#/schemas/engagement.schema'
import {
  engagementService,
  InvalidCommentParentError,
  ParentCommentNotFoundError,
  PostNotFoundError,
  type CommentTreeNode,
} from '#/services/engagement.service'

type AuthenticatedUser = {
  id: string
  [key: string]: unknown
}

type AuthenticatedSession = {
  session: Record<string, unknown>
  user: AuthenticatedUser
} | null

type ToggleLikeResult = Awaited<ReturnType<typeof engagementService.toggleLike>>
type CreateCommentResult = Awaited<ReturnType<typeof engagementService.createComment>>
type GetCommentsResult = Awaited<
  ReturnType<typeof engagementService.getCommentsByPost>
>
type UpdateCommentResult = Awaited<ReturnType<typeof engagementService.updateComment>>
type DeleteCommentResult = Awaited<ReturnType<typeof engagementService.deleteComment>>

type EngagementRoutesDeps = {
  toggleLike: (
    data: ToggleLikeBodySchema,
    userId: string
  ) => Promise<ToggleLikeResult>
  getLikesCount: (postId: string) => Promise<number>
  hasUserLiked: (postId: string, userId: string) => Promise<boolean>
  createComment: (
    data: CreateCommentBodySchema,
    userId: string
  ) => Promise<CreateCommentResult>
  getCommentsByPost: (
    postId: string,
    page: number,
    limit: number
  ) => Promise<GetCommentsResult>
  updateComment: (
    commentId: string,
    data: UpdateCommentBodySchema,
    userId: string
  ) => Promise<UpdateCommentResult>
  deleteComment: (
    commentId: string,
    userId: string
  ) => Promise<DeleteCommentResult>
  getCommentsCount: (postId: string) => Promise<number>
  trackView: (postId: string, userId?: string, viewerIpHash?: string) => Promise<void>
  getViewsCount: (postId: string) => Promise<number>
  getSession: (request: Request) => Promise<AuthenticatedSession>
  getClientIp: (request: Request) => string | undefined
}

export type CreateEngagementRoutesDeps = Partial<EngagementRoutesDeps>

type CommentResponseNode = {
  id: string
  content: string
  parentId: string | null
  createdAt: string
  updatedAt: string | null
  user: {
    id: string
    username: string | null
    displayName: string | null
  }
  replies: CommentResponseNode[]
  repliesCount: number
}

const toDateString = (value: unknown) => {
  if (value instanceof Date) return value.toISOString()
  if (typeof value === 'string') return value

  return new Date(String(value)).toISOString()
}

const mapCommentTree = (comment: CommentTreeNode): CommentResponseNode => ({
  id: comment.id,
  content: comment.content,
  parentId: comment.parentId,
  createdAt: toDateString(comment.createdAt),
  updatedAt: comment.updatedAt ? toDateString(comment.updatedAt) : null,
  user: comment.user,
  replies: comment.replies.map(mapCommentTree),
  repliesCount: comment.repliesCount,
})

const parseForwardedIp = (value: string | null) => {
  if (!value) return undefined

  const first = value
    .split(',')
    .map((item) => item.trim())
    .find(Boolean)

  return first || undefined
}

const defaultDeps: EngagementRoutesDeps = {
  toggleLike: (data, userId) => engagementService.toggleLike(data, userId),
  getLikesCount: (postId) => engagementService.getLikesCount(postId),
  hasUserLiked: (postId, userId) => engagementService.hasUserLiked(postId, userId),
  createComment: (data, userId) => engagementService.createComment(data, userId),
  getCommentsByPost: (postId, page, limit) =>
    engagementService.getCommentsByPost(postId, page, limit),
  updateComment: (commentId, data, userId) =>
    engagementService.updateComment(commentId, data, userId),
  deleteComment: (commentId, userId) =>
    engagementService.deleteComment(commentId, userId),
  getCommentsCount: (postId) => engagementService.getCommentsCount(postId),
  trackView: (postId, userId, viewerIpHash) =>
    engagementService.trackView(postId, userId, viewerIpHash),
  getViewsCount: (postId) => engagementService.getViewsCount(postId),
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
  getClientIp: (request) =>
    parseForwardedIp(request.headers.get('x-forwarded-for')) ??
    parseForwardedIp(request.headers.get('x-real-ip')),
}

const toggleLikeResponseSchema = ApiSuccessSchema(
  z.object({
    liked: z.boolean(),
    likesCount: z.number().int().nonnegative(),
  })
).extend({
  message: z.literal('Like toggled successfully'),
})

const countResponseSchema = ApiSuccessSchema(
  z.object({
    count: z.number().int().nonnegative(),
  })
)

const commentUserSchema = z.object({
  id: z.string().uuid(),
  username: z.string().nullable(),
  displayName: z.string().nullable(),
})

const commentNodeSchema: z.ZodType<CommentResponseNode> = z.lazy(() =>
  z.object({
    id: z.string().uuid(),
    content: z.string(),
    parentId: z.string().uuid().nullable(),
    createdAt: z.string(),
    updatedAt: z.string().nullable(),
    user: commentUserSchema,
    replies: z.array(commentNodeSchema),
    repliesCount: z.number().int().nonnegative(),
  })
)

const getCommentsResponseSchema = ApiSuccessSchema(
  z.object({
    items: z.array(commentNodeSchema),
    total: z.number().int().nonnegative(),
    page: z.number().int().min(1),
    limit: z.number().int().min(1),
  })
).extend({
  message: z.literal('Comments fetched successfully'),
})

const createCommentResponseSchema = ApiSuccessSchema(
  z.object({
    id: z.string().uuid(),
    content: z.string(),
    parentId: z.string().uuid().nullable(),
    createdAt: z.string(),
    updatedAt: z.string().nullable(),
  })
).extend({
  message: z.literal('Comment created successfully'),
})

const updateCommentResponseSchema = ApiSuccessSchema(
  z.object({
    id: z.string().uuid(),
    content: z.string(),
    updatedAt: z.string().nullable(),
  })
).extend({
  message: z.literal('Comment updated successfully'),
})

const deleteCommentResponseSchema = ApiSuccessSchema(
  z.object({
    deleted: z.boolean(),
  })
).extend({
  message: z.literal('Comment deleted successfully'),
})

const trackViewResponseSchema = ApiSuccessSchema(
  z.object({
    viewsCount: z.number().int().nonnegative(),
  })
).extend({
  message: z.literal('View tracked successfully'),
})

const toRouteErrorResponse = (error: unknown) => {
  if (error instanceof PostNotFoundError) {
    return elysiaStatus(
      404,
      createErrorResponse(404, {
        message: error.message,
      })
    )
  }

  if (error instanceof ParentCommentNotFoundError) {
    return elysiaStatus(
      404,
      createErrorResponse(404, {
        message: error.message,
      })
    )
  }

  if (error instanceof InvalidCommentParentError) {
    return elysiaStatus(
      400,
      createErrorResponse(400, {
        message: error.message,
      })
    )
  }

  throw error
}

export const createEngagementRoutes = (
  deps: CreateEngagementRoutesDeps = {}
) => {
  const runtimeDeps = {
    ...defaultDeps,
    ...deps,
  } satisfies EngagementRoutesDeps

  const authMacro = new Elysia({ name: 'engagement-auth-macro' }).macro({
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

  return new Elysia({ prefix: '/api/engagement' })
    .use(authMacro)
    .post(
      '/likes',
      async ({ body, user }) => {
        try {
          const result = await runtimeDeps.toggleLike(body, user.id)

          return {
            success: true,
            message: 'Like toggled successfully',
            data: result,
          }
        } catch (error) {
          return toRouteErrorResponse(error)
        }
      },
      {
        requiredAuth: true,
        body: toggleLikeBodySchema,
        response: withStandardResponses({
          200: toggleLikeResponseSchema,
        }),
        detail: {
          summary: 'Toggle like on a post',
          description:
            'Like a post if it is not liked yet, or unlike it if it already is.',
          tags: ['Engagement', 'Likes'],
          operationId: 'toggleLike',
        },
      }
    )
    .get(
      '/likes/count',
      async ({ query }) => {
        try {
          const count = await runtimeDeps.getLikesCount(query.postId)

          return {
            success: true,
            message: 'Likes count fetched successfully',
            data: { count },
          }
        } catch (error) {
          return toRouteErrorResponse(error)
        }
      },
      {
        query: postIdQuerySchema,
        response: withStandardResponses({
          200: countResponseSchema.extend({
            message: z.literal('Likes count fetched successfully'),
          }),
        }),
        detail: {
          summary: 'Get likes count for a post',
          description: 'Get the total number of likes for a published post.',
          tags: ['Engagement', 'Likes'],
          operationId: 'getLikesCount',
        },
      }
    )
    .get(
      '/comments',
      async ({ query }) => {
        try {
          const result = await runtimeDeps.getCommentsByPost(
            query.postId,
            query.page,
            query.limit
          )

          return {
            success: true,
            message: 'Comments fetched successfully',
            data: {
              items: result.items.map(mapCommentTree),
              total: result.total,
              page: result.page,
              limit: result.limit,
            },
          }
        } catch (error) {
          return toRouteErrorResponse(error)
        }
      },
      {
        query: getCommentsQuerySchema,
        response: withStandardResponses({
          200: getCommentsResponseSchema,
        }),
        detail: {
          summary: 'Get comments for a post',
          description:
            'Get paginated root comments for a published post, with nested replies attached recursively.',
          tags: ['Engagement', 'Comments'],
          operationId: 'getComments',
        },
      }
    )
    .post(
      '/comments',
      async ({ body, user }) => {
        try {
          const comment = await runtimeDeps.createComment(body, user.id)
          if (!comment) return elysiaStatus(500, createErrorResponse(500))

          return {
            success: true,
            message: 'Comment created successfully',
            data: {
              id: comment.id,
              content: comment.content,
              parentId: comment.parentId,
              createdAt: toDateString(comment.createdAt),
              updatedAt: comment.updatedAt ? toDateString(comment.updatedAt) : null,
            },
          }
        } catch (error) {
          return toRouteErrorResponse(error)
        }
      },
      {
        requiredAuth: true,
        body: createCommentBodySchema,
        response: withStandardResponses({
          200: createCommentResponseSchema,
        }),
        detail: {
          summary: 'Create a comment or reply',
          description:
            'Create a new comment on a published post, or create a nested reply when parentId is provided.',
          tags: ['Engagement', 'Comments'],
          operationId: 'createComment',
        },
      }
    )
    .put(
      '/comments/:id',
      async ({ params, body, user }) => {
        try {
          const comment = await runtimeDeps.updateComment(params.id, body, user.id)

          if (!comment) {
            return elysiaStatus(
              404,
              createErrorResponse(404, {
                message: 'Comment not found or unauthorized',
              })
            )
          }

          return {
            success: true,
            message: 'Comment updated successfully',
            data: {
              id: comment.id,
              content: comment.content,
              updatedAt: comment.updatedAt ? toDateString(comment.updatedAt) : null,
            },
          }
        } catch (error) {
          return toRouteErrorResponse(error)
        }
      },
      {
        requiredAuth: true,
        params: commentParamsSchema,
        body: updateCommentBodySchema,
        response: withStandardResponses({
          200: updateCommentResponseSchema,
        }),
        detail: {
          summary: 'Update a comment',
          description:
            'Update the content of a comment owned by the current user.',
          tags: ['Engagement', 'Comments'],
          operationId: 'updateComment',
        },
      }
    )
    .delete(
      '/comments/:id',
      async ({ params, user }) => {
        try {
          const result = await runtimeDeps.deleteComment(params.id, user.id)

          if (!result) {
            return elysiaStatus(
              404,
              createErrorResponse(404, {
                message: 'Comment not found or unauthorized',
              })
            )
          }

          return {
            success: true,
            message: 'Comment deleted successfully',
            data: result,
          }
        } catch (error) {
          return toRouteErrorResponse(error)
        }
      },
      {
        requiredAuth: true,
        params: commentParamsSchema,
        response: withStandardResponses({
          200: deleteCommentResponseSchema,
        }),
        detail: {
          summary: 'Delete a comment',
          description:
            'Delete a comment owned by the current user. Child replies are removed via cascade.',
          tags: ['Engagement', 'Comments'],
          operationId: 'deleteComment',
        },
      }
    )
    .get(
      '/comments/count',
      async ({ query }) => {
        try {
          const count = await runtimeDeps.getCommentsCount(query.postId)

          return {
            success: true,
            message: 'Comments count fetched successfully',
            data: { count },
          }
        } catch (error) {
          return toRouteErrorResponse(error)
        }
      },
      {
        query: postIdQuerySchema,
        response: withStandardResponses({
          200: countResponseSchema.extend({
            message: z.literal('Comments count fetched successfully'),
          }),
        }),
        detail: {
          summary: 'Get comments count for a post',
          description:
            'Get the total number of comments for a published post, including nested replies.',
          tags: ['Engagement', 'Comments'],
          operationId: 'getCommentsCount',
        },
      }
    )
    .post(
      '/views',
      async ({ body, request, user }) => {
        try {
          const clientIp = runtimeDeps.getClientIp(request)
          const viewerIpHash = clientIp ? hashViewerIp(clientIp) : undefined

          await runtimeDeps.trackView(body.postId, user?.id, viewerIpHash)

          return {
            success: true,
            message: 'View tracked successfully',
            data: {
              viewsCount: await runtimeDeps.getViewsCount(body.postId),
            },
          }
        } catch (error) {
          return toRouteErrorResponse(error)
        }
      },
      {
        optionalAuth: true,
        body: trackViewBodySchema,
        response: withStandardResponses({
          200: trackViewResponseSchema,
        }),
        detail: {
          summary: 'Track a post view',
          description:
            'Track a published post view from an authenticated or anonymous visitor.',
          tags: ['Engagement', 'Views'],
          operationId: 'trackView',
        },
      }
    )
    .get(
      '/views/count',
      async ({ query }) => {
        try {
          const count = await runtimeDeps.getViewsCount(query.postId)

          return {
            success: true,
            message: 'Views count fetched successfully',
            data: { count },
          }
        } catch (error) {
          return toRouteErrorResponse(error)
        }
      },
      {
        query: postIdQuerySchema,
        response: withStandardResponses({
          200: countResponseSchema.extend({
            message: z.literal('Views count fetched successfully'),
          }),
        }),
        detail: {
          summary: 'Get views count for a post',
          description: 'Get the total number of views for a published post.',
          tags: ['Engagement', 'Views'],
          operationId: 'getViewsCount',
        },
      }
    )
}

export const engagementRoutes = createEngagementRoutes()
