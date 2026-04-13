import { describe, expect, it } from 'bun:test'
import { openapi } from '@elysiajs/openapi'
import { Elysia } from 'elysia'
import { z } from 'zod'

import {
  createOpenApiConfig,
  OPENAPI_DOCS_PATH,
} from '#/lib/openapi'
import { hashViewerIp } from '#/lib/viewer-ip'
import { apiErrorPlugin } from '#/plugins/api-error.plugin'
import {
  createEngagementRoutes,
  type CreateEngagementRoutesDeps,
} from '#/routes/engagement.route'
import {
  InvalidCommentParentError,
  ParentCommentNotFoundError,
  PostNotFoundError,
} from '#/services/engagement.service'

const postId = '550e8400-e29b-41d4-a716-446655440100'
const userId = '550e8400-e29b-41d4-a716-446655440101'
const otherUserId = '550e8400-e29b-41d4-a716-446655440102'
const rootCommentId = '550e8400-e29b-41d4-a716-446655440103'
const replyCommentId = '550e8400-e29b-41d4-a716-446655440104'
const nestedReplyCommentId = '550e8400-e29b-41d4-a716-446655440105'

const defaultSession = {
  session: { id: 'session-id' },
  user: { id: userId },
}

const createdComment = {
  id: rootCommentId,
  postId,
  userId,
  parentId: null,
  content: 'Root comment',
  createdAt: new Date('2026-04-12T10:00:00.000Z'),
  updatedAt: null,
}

const updatedComment = {
  ...createdComment,
  content: 'Updated comment',
  updatedAt: new Date('2026-04-12T11:00:00.000Z'),
}

const commentsTree = {
  items: [
    {
      id: rootCommentId,
      content: 'Root comment',
      parentId: null,
      createdAt: new Date('2026-04-12T10:00:00.000Z'),
      updatedAt: null,
      user: {
        id: userId,
        username: 'author',
        displayName: 'Author Name',
      },
      repliesCount: 1,
      replies: [
        {
          id: replyCommentId,
          content: 'Reply comment',
          parentId: rootCommentId,
          createdAt: new Date('2026-04-12T10:30:00.000Z'),
          updatedAt: null,
          user: {
            id: otherUserId,
            username: 'reader',
            displayName: 'Reader Name',
          },
          repliesCount: 1,
          replies: [
            {
              id: nestedReplyCommentId,
              content: 'Nested reply comment',
              parentId: replyCommentId,
              createdAt: new Date('2026-04-12T10:45:00.000Z'),
              updatedAt: null,
              user: {
                id: userId,
                username: 'author',
                displayName: 'Author Name',
              },
              repliesCount: 0,
              replies: [],
            },
          ],
        },
      ],
    },
  ],
  total: 1,
  page: 1,
  limit: 20,
}

const buildApp = (deps: CreateEngagementRoutesDeps = {}) => {
  let likesCount = 0
  let liked = false
  const trackedViews: Array<{
    postId: string
    userId?: string
    viewerIpHash?: string
  }> = []

  const defaultDeps: CreateEngagementRoutesDeps = {
    toggleLike: async () => {
      liked = !liked
      likesCount += liked ? 1 : -1

      return {
        liked,
        likesCount,
      }
    },
    getLikesCount: async () => likesCount,
    hasUserLiked: async () => liked,
    createComment: async ({ content, parentId }) => ({
      ...createdComment,
      content,
      parentId: parentId ?? null,
    }),
    getCommentsByPost: async () => commentsTree,
    updateComment: async () => updatedComment,
    deleteComment: async () => ({ deleted: true }),
    getCommentsCount: async () => 3,
    trackView: async (viewPostId, trackedUserId, viewerIpHash) => {
      trackedViews.push({
        postId: viewPostId,
        userId: trackedUserId,
        viewerIpHash,
      })
    },
    getViewsCount: async () => trackedViews.length,
    getSession: async () => defaultSession,
    getClientIp: (request) => {
      const forwardedFor = request.headers.get('x-forwarded-for')
      if (forwardedFor) {
        const [first] = forwardedFor.split(',')
        return first?.trim()
      }

      return request.headers.get('x-real-ip') ?? undefined
    },
  }

  return new Elysia()
    .use(openapi(createOpenApiConfig()))
    .use(apiErrorPlugin)
    .use(createEngagementRoutes({ ...defaultDeps, ...deps }))
    .get(
      '/__test/custom-403',
      ({ status }) => status(403, { message: 'Custom forbidden' }),
      {
        response: {
          403: z.object({ message: z.string() }),
        },
      }
    )
}

const getOpenApiSpecRequest = () =>
  new Request(`http://localhost${OPENAPI_DOCS_PATH}/json`)

const postJsonRequest = (
  path: string,
  payload: unknown,
  headers?: Record<string, string>
) =>
  new Request(`http://localhost${path}`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      ...headers,
    },
    body: JSON.stringify(payload),
  })

const putJsonRequest = (path: string, payload: unknown) =>
  new Request(`http://localhost${path}`, {
    method: 'PUT',
    headers: {
      'content-type': 'application/json',
    },
    body: JSON.stringify(payload),
  })

describe('engagement.route response contract', () => {
  it('toggles like state across repeated requests and exposes updated count', async () => {
    const app = buildApp()

    const firstResponse = await app.handle(
      postJsonRequest('/api/engagement/likes', { postId })
    )
    const firstBody = (await firstResponse.json()) as Record<string, unknown>

    const secondResponse = await app.handle(
      postJsonRequest('/api/engagement/likes', { postId })
    )
    const secondBody = (await secondResponse.json()) as Record<string, unknown>

    const countResponse = await app.handle(
      new Request(`http://localhost/api/engagement/likes/count?postId=${postId}`)
    )
    const countBody = (await countResponse.json()) as Record<string, unknown>

    expect(firstResponse.status).toBe(200)
    expect((firstBody['data'] as Record<string, unknown>)['liked']).toBe(true)
    expect((firstBody['data'] as Record<string, unknown>)['likesCount']).toBe(1)

    expect(secondResponse.status).toBe(200)
    expect((secondBody['data'] as Record<string, unknown>)['liked']).toBe(false)
    expect((secondBody['data'] as Record<string, unknown>)['likesCount']).toBe(0)

    expect(countResponse.status).toBe(200)
    expect((countBody['data'] as Record<string, unknown>)['count']).toBe(0)
  })

  it('returns 401 on auth-required engagement endpoints without a session', async () => {
    const app = buildApp({
      getSession: async () => null,
    })

    const likeResponse = await app.handle(
      postJsonRequest('/api/engagement/likes', { postId })
    )
    const createCommentResponse = await app.handle(
      postJsonRequest('/api/engagement/comments', {
        postId,
        content: 'Root comment',
      })
    )
    const updateCommentResponse = await app.handle(
      putJsonRequest(`/api/engagement/comments/${rootCommentId}`, {
        content: 'Updated comment',
      })
    )
    const deleteCommentResponse = await app.handle(
      new Request(`http://localhost/api/engagement/comments/${rootCommentId}`, {
        method: 'DELETE',
      })
    )

    expect(likeResponse.status).toBe(401)
    expect(createCommentResponse.status).toBe(401)
    expect(updateCommentResponse.status).toBe(401)
    expect(deleteCommentResponse.status).toBe(401)
  })

  it('returns 422 for invalid engagement payloads and queries', async () => {
    const app = buildApp()

    const invalidLikeResponse = await app.handle(
      postJsonRequest('/api/engagement/likes', { postId: 'invalid-id' })
    )
    const invalidCommentResponse = await app.handle(
      postJsonRequest('/api/engagement/comments', {
        postId,
        content: '',
      })
    )
    const invalidReplyResponse = await app.handle(
      postJsonRequest('/api/engagement/comments', {
        postId,
        content: 'Valid comment',
        parentId: 'invalid-id',
      })
    )
    const invalidCommentsQueryResponse = await app.handle(
      new Request(
        `http://localhost/api/engagement/comments?postId=${postId}&page=0&limit=101`
      )
    )

    expect(invalidLikeResponse.status).toBe(422)
    expect(invalidCommentResponse.status).toBe(422)
    expect(invalidReplyResponse.status).toBe(422)
    expect(invalidCommentsQueryResponse.status).toBe(422)
  })

  it('creates root comments and replies successfully', async () => {
    const app = buildApp()

    const rootResponse = await app.handle(
      postJsonRequest('/api/engagement/comments', {
        postId,
        content: 'Root comment',
      })
    )
    const rootBody = (await rootResponse.json()) as Record<string, unknown>

    const replyResponse = await app.handle(
      postJsonRequest('/api/engagement/comments', {
        postId,
        content: 'Reply comment',
        parentId: rootCommentId,
      })
    )
    const replyBody = (await replyResponse.json()) as Record<string, unknown>

    expect(rootResponse.status).toBe(200)
    expect((rootBody['data'] as Record<string, unknown>)['parentId']).toBe(null)

    expect(replyResponse.status).toBe(200)
    expect((replyBody['data'] as Record<string, unknown>)['parentId']).toBe(
      rootCommentId
    )
  })

  it('returns 404 when reply parent comment does not exist', async () => {
    const app = buildApp({
      createComment: async () => {
        throw new ParentCommentNotFoundError()
      },
    })

    const response = await app.handle(
      postJsonRequest('/api/engagement/comments', {
        postId,
        content: 'Reply comment',
        parentId: rootCommentId,
      })
    )
    const body = (await response.json()) as Record<string, unknown>

    expect(response.status).toBe(404)
    expect(body['message']).toBe('Parent comment not found')
  })

  it('returns 400 when reply parent belongs to a different post', async () => {
    const app = buildApp({
      createComment: async () => {
        throw new InvalidCommentParentError()
      },
    })

    const response = await app.handle(
      postJsonRequest('/api/engagement/comments', {
        postId,
        content: 'Reply comment',
        parentId: rootCommentId,
      })
    )
    const body = (await response.json()) as Record<string, unknown>

    expect(response.status).toBe(400)
    expect(body['message']).toBe('Parent comment does not belong to this post')
  })

  it('returns recursive comment trees and preserves root totals separately from total comment count', async () => {
    const app = buildApp()

    const commentsResponse = await app.handle(
      new Request(
        `http://localhost/api/engagement/comments?postId=${postId}&page=1&limit=20`
      )
    )
    const commentsBody = (await commentsResponse.json()) as Record<string, unknown>

    const countResponse = await app.handle(
      new Request(
        `http://localhost/api/engagement/comments/count?postId=${postId}`
      )
    )
    const countBody = (await countResponse.json()) as Record<string, unknown>

    const data = commentsBody['data'] as Record<string, unknown>
    const items = data['items'] as Array<Record<string, unknown>>
    const firstRoot = items[0]!
    const firstReply = (firstRoot['replies'] as Array<Record<string, unknown>>)[0]!
    const nestedReply = (firstReply['replies'] as Array<Record<string, unknown>>)[0]!

    expect(commentsResponse.status).toBe(200)
    expect(data['total']).toBe(1)
    expect(firstRoot['repliesCount']).toBe(1)
    expect((firstRoot['user'] as Record<string, unknown>)['displayName']).toBe(
      'Author Name'
    )
    expect(firstReply['id']).toBe(replyCommentId)
    expect(nestedReply['id']).toBe(nestedReplyCommentId)
    expect((nestedReply['replies'] as Array<unknown>).length).toBe(0)
    expect(firstRoot['createdAt']).toBe('2026-04-12T10:00:00.000Z')

    expect(countResponse.status).toBe(200)
    expect((countBody['data'] as Record<string, unknown>)['count']).toBe(3)
  })

  it('returns 404 when updating or deleting a missing or unauthorized comment', async () => {
    const app = buildApp({
      updateComment: async () => null,
      deleteComment: async () => null,
    })

    const updateResponse = await app.handle(
      putJsonRequest(`/api/engagement/comments/${rootCommentId}`, {
        content: 'Updated comment',
      })
    )
    const deleteResponse = await app.handle(
      new Request(`http://localhost/api/engagement/comments/${rootCommentId}`, {
        method: 'DELETE',
      })
    )

    expect(updateResponse.status).toBe(404)
    expect(deleteResponse.status).toBe(404)
  })

  it('tracks views for authenticated and anonymous users and parses forwarded IPs', async () => {
    const trackedViews: Array<{
      postId: string
      userId?: string
      viewerIpHash?: string
    }> = []

    const app = buildApp({
      trackView: async (trackedPostId, trackedUserId, viewerIpHash) => {
        trackedViews.push({
          postId: trackedPostId,
          userId: trackedUserId,
          viewerIpHash,
        })
      },
      getViewsCount: async () => trackedViews.length,
      getSession: async (request) =>
        request.headers.get('authorization') === 'Bearer auth'
          ? defaultSession
          : null,
    })

    const authenticatedResponse = await app.handle(
      postJsonRequest(
        '/api/engagement/views',
        { postId },
        {
          authorization: 'Bearer auth',
          'x-forwarded-for': '203.0.113.10, 10.0.0.1',
        }
      )
    )
    const anonymousResponse = await app.handle(
      postJsonRequest(
        '/api/engagement/views',
        { postId },
        {
          'x-real-ip': '203.0.113.11',
        }
      )
    )

    expect(authenticatedResponse.status).toBe(200)
    expect(anonymousResponse.status).toBe(200)
    expect(trackedViews).toEqual([
      {
        postId,
        userId,
        viewerIpHash: hashViewerIp('203.0.113.10'),
      },
      {
        postId,
        userId: undefined,
        viewerIpHash: hashViewerIp('203.0.113.11'),
      },
    ])
  })

  it('returns 404 when engagement targets a missing or unpublished post', async () => {
    const app = buildApp({
      getLikesCount: async () => {
        throw new PostNotFoundError()
      },
    })

    const response = await app.handle(
      new Request(`http://localhost/api/engagement/likes/count?postId=${postId}`)
    )
    const body = (await response.json()) as Record<string, unknown>

    expect(response.status).toBe(404)
    expect(body['message']).toBe('Post not found')
  })

  it('exposes engagement endpoints and OpenAPI metadata in the generated spec', async () => {
    const app = buildApp()
    const response = await app.handle(getOpenApiSpecRequest())
    const spec = (await response.json()) as {
      paths?: Record<
        string,
        {
          get?: { operationId?: string; responses?: Record<string, unknown> }
          post?: { operationId?: string; responses?: Record<string, unknown> }
          put?: { operationId?: string; responses?: Record<string, unknown> }
          delete?: { operationId?: string; responses?: Record<string, unknown> }
        }
      >
    }

    const commentPath = spec.paths?.['/api/engagement/comments']
    const commentItemPath =
      spec.paths?.['/api/engagement/comments/{id}'] ??
      spec.paths?.['/api/engagement/comments/:id']

    expect(spec.paths?.['/api/engagement/likes']?.post?.operationId).toBe(
      'toggleLike'
    )
    expect(spec.paths?.['/api/engagement/likes/count']?.get?.operationId).toBe(
      'getLikesCount'
    )
    expect(commentPath?.get?.operationId).toBe('getComments')
    expect(commentPath?.post?.operationId).toBe('createComment')
    expect(commentItemPath?.put?.operationId).toBe('updateComment')
    expect(commentItemPath?.delete?.operationId).toBe('deleteComment')
    expect(spec.paths?.['/api/engagement/comments/count']?.get?.operationId).toBe(
      'getCommentsCount'
    )
    expect(spec.paths?.['/api/engagement/views']?.post?.operationId).toBe(
      'trackView'
    )
    expect(spec.paths?.['/api/engagement/views/count']?.get?.operationId).toBe(
      'getViewsCount'
    )

    expect(
      Object.keys(commentPath?.get?.responses ?? {})
    ).toEqual(
      expect.arrayContaining(['200', '400', '401', '403', '404', '422', '429', '500'])
    )
  })
})
