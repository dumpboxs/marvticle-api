import { sql } from 'drizzle-orm'
import {
  check,
  index,
  pgTable,
  text,
  timestamp,
  uuid,
} from 'drizzle-orm/pg-core'

import { userTable } from './auth'
import { postTable } from './post'

export const viewTable = pgTable(
  'views',
  {
    id: uuid('id')
      .default(sql`pg_catalog.gen_random_uuid()`)
      .primaryKey(),
    postId: uuid('post_id')
      .notNull()
      .references(() => postTable.id, { onDelete: 'cascade' }),
    userId: uuid('user_id').references(() => userTable.id, {
      onDelete: 'cascade',
    }),
    viewerIpHash: text('viewer_ip_hash'),
    createdAt: timestamp('created_at').defaultNow().notNull(),
  },
  (table) => ({
    postIdIdx: index('view_post_id_idx').on(table.postId),
    actorRequired: check(
      'view_actor_required_check',
      sql`${table.userId} is not null or ${table.viewerIpHash} is not null`
    ),
  })
)

export type View = typeof viewTable.$inferSelect
export type NewView = typeof viewTable.$inferInsert
