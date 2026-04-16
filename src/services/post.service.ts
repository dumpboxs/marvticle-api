import { and, desc, eq, lt, or } from 'drizzle-orm'

import {
  type CreatePostBodySchema,
  type GetPostsQuerySchema,
  type UpdatePostBodySchema,
} from '#/schemas/post.schema'

import { db } from '#/db'
import { postTable, userTable } from '#/db/schemas'
import { createServiceLogger } from '#/lib/logger'

type CursorPayload = {
  createdAt: string
  id: string
}

type PostRecord = typeof postTable.$inferSelect

type PostAuthor = {
  id: string
  name: string
  username: string | null
  image: string | null
}

type PostWithAuthor = PostRecord & {
  author: PostAuthor
}

type PostWithAuthorRow = {
  post: PostRecord
  author: PostAuthor
}

const logger = createServiceLogger('postService')

const encodeCursor = (payload: CursorPayload) =>
  Buffer.from(JSON.stringify(payload), 'utf8').toString('base64url')

const decodeCursor = (cursor: string): CursorPayload => {
  try {
    const decoded = Buffer.from(cursor, 'base64url').toString('utf8')
    const parsed = JSON.parse(decoded) as CursorPayload

    if (typeof parsed.createdAt !== 'string' || typeof parsed.id !== 'string') {
      throw new InvalidCursorError()
    }

    const createdAt = new Date(parsed.createdAt)
    if (Number.isNaN(createdAt.getTime())) throw new InvalidCursorError()

    return parsed
  } catch {
    logger.warn({
      message: 'Invalid cursor received',
      metadata: {
        cursor,
      },
    })
    throw new InvalidCursorError()
  }
}

const toCursorDate = (value: Date | string) =>
  value instanceof Date ? value : new Date(value)

const postWithAuthorSelection = {
  post: postTable,
  author: {
    id: userTable.id,
    name: userTable.name,
    username: userTable.username,
    image: userTable.image,
  },
} as const

const mapPostWithAuthorRow = (row: PostWithAuthorRow): PostWithAuthor => ({
  ...row.post,
  author: row.author,
})

export class InvalidCursorError extends Error {
  constructor() {
    super('Invalid cursor')
    this.name = 'InvalidCursorError'
  }
}

export const postService = {
  create: async (data: CreatePostBodySchema, authorId: string) => {
    const startedAt = performance.now()

    logger.info({
      message: 'Creating new post',
      metadata: {
        authorId,
        slug: data.slug,
        title: data.title,
      },
    })

    try {
      const [insertedPost] = await db
        .insert(postTable)
        .values({
          ...data,
          authorId,
        })
        .returning()

      if (!insertedPost) {
        logger.error({
          message: 'Create post did not return inserted row',
          metadata: {
            authorId,
            slug: data.slug,
          },
          duration: performance.now() - startedAt,
        })

        return null
      }

      const [row] = await db
        .select(postWithAuthorSelection)
        .from(postTable)
        .innerJoin(userTable, eq(postTable.authorId, userTable.id))
        .where(eq(postTable.id, insertedPost.id))
        .limit(1)

      const post = row ? mapPostWithAuthorRow(row) : null

      logger.info({
        message: 'Post created successfully',
        metadata: {
          postId: post?.id ?? insertedPost.id,
          slug: post?.slug ?? insertedPost.slug,
        },
        duration: performance.now() - startedAt,
      })

      return post
    } catch (error) {
      logger.error({
        message: 'Create post failed',
        metadata: {
          authorId,
          slug: data.slug,
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
      message: 'Fetching post by id for management',
      metadata: {
        postId: id,
      },
    })

    try {
      const [row] = await db
        .select(postWithAuthorSelection)
        .from(postTable)
        .innerJoin(userTable, eq(postTable.authorId, userTable.id))
        .where(eq(postTable.id, id))
        .limit(1)

      const post = row ? mapPostWithAuthorRow(row) : null

      logger.info({
        message: post ? 'Post found for management' : 'Post not found',
        metadata: {
          postId: id,
          found: Boolean(post),
        },
        duration: performance.now() - startedAt,
      })

      return post
    } catch (error) {
      logger.error({
        message: 'Fetch post for management failed',
        metadata: {
          postId: id,
        },
        error,
        duration: performance.now() - startedAt,
      })

      throw error
    }
  },

  findPublishedById: async (id: string) => {
    const startedAt = performance.now()

    logger.debug({
      message: 'Fetching published post by id',
      metadata: {
        postId: id,
      },
    })

    try {
      const [row] = await db
        .select(postWithAuthorSelection)
        .from(postTable)
        .innerJoin(userTable, eq(postTable.authorId, userTable.id))
        .where(and(eq(postTable.id, id), eq(postTable.published, true)))
        .limit(1)

      const post = row ? mapPostWithAuthorRow(row) : null

      logger.info({
        message: post ? 'Published post found' : 'Published post not found',
        metadata: {
          postId: id,
          found: Boolean(post),
        },
        duration: performance.now() - startedAt,
      })

      return post
    } catch (error) {
      logger.error({
        message: 'Fetch published post failed',
        metadata: {
          postId: id,
        },
        error,
        duration: performance.now() - startedAt,
      })

      throw error
    }
  },

  update: async (id: string, data: UpdatePostBodySchema) => {
    const startedAt = performance.now()

    logger.info({
      message: 'Updating post',
      metadata: {
        postId: id,
        fields: Object.keys(data),
      },
    })

    try {
      const [updatedPost] = await db
        .update(postTable)
        .set({
          ...data,
          updatedAt: new Date(),
        })
        .where(eq(postTable.id, id))
        .returning()

      if (!updatedPost) {
        logger.warn({
          message: 'Post update target not found',
          metadata: {
            postId: id,
          },
          duration: performance.now() - startedAt,
        })

        return null
      }

      const [row] = await db
        .select(postWithAuthorSelection)
        .from(postTable)
        .innerJoin(userTable, eq(postTable.authorId, userTable.id))
        .where(eq(postTable.id, updatedPost.id))
        .limit(1)

      const post = row ? mapPostWithAuthorRow(row) : null

      logger.info({
        message: 'Post updated successfully',
        metadata: {
          postId: updatedPost.id,
          fields: Object.keys(data),
        },
        duration: performance.now() - startedAt,
      })

      return post
    } catch (error) {
      logger.error({
        message: 'Update post failed',
        metadata: {
          postId: id,
          fields: Object.keys(data),
        },
        error,
        duration: performance.now() - startedAt,
      })

      throw error
    }
  },

  delete: async (id: string) => {
    const startedAt = performance.now()

    logger.info({
      message: 'Deleting post',
      metadata: {
        postId: id,
      },
    })

    try {
      const deletedPost = await db
        .delete(postTable)
        .where(eq(postTable.id, id))
        .returning({ id: postTable.id })
        .then((rows) => rows[0])

      if (!deletedPost) {
        logger.warn({
          message: 'Post delete target not found',
          metadata: {
            postId: id,
          },
          duration: performance.now() - startedAt,
        })

        return null
      }

      logger.info({
        message: 'Post deleted successfully',
        metadata: {
          postId: id,
        },
        duration: performance.now() - startedAt,
      })

      return { deleted: true }
    } catch (error) {
      logger.error({
        message: 'Delete post failed',
        metadata: {
          postId: id,
        },
        error,
        duration: performance.now() - startedAt,
      })

      throw error
    }
  },

  listPublishedWithCursor: async ({ cursor, limit }: GetPostsQuerySchema) => {
    const startedAt = performance.now()

    logger.debug({
      message: 'Listing published posts with cursor',
      metadata: {
        cursorProvided: Boolean(cursor),
        limit,
      },
    })

    try {
      const parsedCursor = cursor ? decodeCursor(cursor) : null
      const cursorDate = parsedCursor
        ? toCursorDate(parsedCursor.createdAt)
        : null

      if (parsedCursor) {
        logger.debug({
          message: 'Decoded posts cursor',
          metadata: {
            cursor: parsedCursor,
          },
        })
      }

      const whereCondition =
        parsedCursor && cursorDate
          ? and(
              eq(postTable.published, true),
              or(
                lt(postTable.createdAt, cursorDate),
                and(
                  eq(postTable.createdAt, cursorDate),
                  lt(postTable.id, parsedCursor.id)
                )
              )
            )
          : eq(postTable.published, true)

      const rows = await db
        .select(postWithAuthorSelection)
        .from(postTable)
        .innerJoin(userTable, eq(postTable.authorId, userTable.id))
        .where(whereCondition)
        .orderBy(desc(postTable.createdAt), desc(postTable.id))
        .limit(limit + 1)

      const hasMore = rows.length > limit
      const items = (hasMore ? rows.slice(0, limit) : rows).map(
        mapPostWithAuthorRow
      )
      const lastItem = items.at(-1)

      const nextCursor =
        hasMore && lastItem
          ? encodeCursor({
              createdAt: toCursorDate(lastItem.createdAt).toISOString(),
              id: lastItem.id,
            })
          : null

      if (nextCursor) {
        logger.debug({
          message: 'Encoded posts cursor',
          metadata: {
            nextCursor,
          },
        })
      }

      logger.info({
        message: 'Published posts fetched successfully',
        metadata: {
          count: items.length,
          hasMore,
          nextCursor,
        },
        duration: performance.now() - startedAt,
      })

      return {
        items,
        nextCursor,
        hasMore,
      }
    } catch (error) {
      logger.error({
        message: 'List published posts failed',
        metadata: {
          cursorProvided: Boolean(cursor),
          limit,
        },
        error,
        duration: performance.now() - startedAt,
      })

      throw error
    }
  },
}
