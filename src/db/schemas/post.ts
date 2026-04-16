import { sql } from 'drizzle-orm'
import {
  boolean,
  customType,
  index,
  pgTable,
  text,
  timestamp,
  uuid,
} from 'drizzle-orm/pg-core'
import { userTable } from './auth'

const tsvector = customType<{ data: string }>({
  dataType() {
    return 'tsvector'
  },
})

export const postTable = pgTable(
  'posts',
  {
    id: uuid('id')
      .default(sql`pg_catalog.gen_random_uuid()`)
      .primaryKey(),
    title: text('title').notNull(),
    slug: text('slug').notNull().unique(),
    content: text('content'),
    coverImage: text('cover_image'),
    published: boolean('published').default(false).notNull(),
    authorId: uuid('author_id')
      .notNull()
      .references(() => userTable.id, { onDelete: 'cascade' }),
    searchVector: tsvector('search_vector').generatedAlwaysAs(sql`
      setweight(to_tsvector('english', coalesce(${sql.identifier('title')}, '')), 'A') ||
      setweight(to_tsvector('english', coalesce(${sql.identifier('content')}, '')), 'B')
    `),
    createdAt: timestamp('created_at').defaultNow().notNull(),
    updatedAt: timestamp('updated_at')
      .defaultNow()
      .$onUpdate(() => /* @__PURE__ */ new Date()),
  },
  (table) => ({
    searchIdx: index('idx_posts_search').using('gin', table.searchVector),
  })
)

export const publicPostSelection = {
  id: postTable.id,
  title: postTable.title,
  slug: postTable.slug,
  content: postTable.content,
  coverImage: postTable.coverImage,
  published: postTable.published,
  authorId: postTable.authorId,
  createdAt: postTable.createdAt,
  updatedAt: postTable.updatedAt,
} as const

export type PublicPost = Omit<typeof postTable.$inferSelect, 'searchVector'>
