# Backend API Roadmap

> Project: marvticle-api  
> Framework: Elysia + Drizzle ORM + PostgreSQL + Better Auth  
> Scope: backend roadmap synchronized with the current codebase

---

## Progress Overview

- [x] Backend foundation
- [x] Auth integration
- [x] Posts read + create + update + delete
- [x] Engagement APIs
- [x] OpenAPI + logging + request tracing
- [ ] Discovery and editorial expansion
- [ ] User-facing convenience features
- [ ] SEO / feed / admin surfaces

**Current baseline:** the backend is already usable for frontend integration on
posts, comments, likes, views, auth, and standardized `/api/*` response
contracts.

---

## Already Implemented

### Core application

- [x] `GET /api/posts`
- [x] `GET /api/posts/:id`
- [x] `POST /api/posts`
- [x] `PUT /api/posts/:id`
- [x] `DELETE /api/posts/:id`
- [x] Cursor pagination for public post listing
- [x] Standard API response envelope for `/api/*`
- [x] OpenAPI docs for app routes and Better Auth routes

### Authorization and auth foundation

- [x] Better Auth integration mounted under `/auth/api/*`
- [x] Cookie/session-based authenticated routes
- [x] Shared ownership/admin authorization helper for author-managed resources
- [x] Post update/delete allowed for post owner or admin

### Engagement

- [x] `POST /api/engagement/likes`
- [x] `GET /api/engagement/likes/count`
- [x] `GET /api/engagement/comments`
- [x] `POST /api/engagement/comments`
- [x] `PUT /api/engagement/comments/:id`
- [x] `DELETE /api/engagement/comments/:id`
- [x] `GET /api/engagement/comments/count`
- [x] `POST /api/engagement/views`
- [x] `GET /api/engagement/views/count`

### Observability and safety

- [x] Request logging with `x-request-id`
- [x] Database query logging and slow-query warnings
- [x] Auth event logging
- [x] Viewer IP hashing for anonymous view tracking
- [x] Route contract tests and logging tests

---

## Next Priorities

The order below reflects what is most useful for this codebase now, not the old
assumption that the backend was still empty.

### P1. Full-Text Search

**Status:** ⏳ Next  
**Why first:** highest product value for discovery with relatively small surface
area.  
**Files to Create/Modify:**

- `src/db/migrations/*`
- `src/routes/post.route.ts`
- `src/services/post.service.ts`
- `src/schemas/post.schema.ts`
- `test/post.route.test.ts`
- `docs/frontend-api-guide.md`
- `README.md`

**Detail:**

- [ ] Add PostgreSQL `tsvector` search support for `posts.title` and
      `posts.content`
- [ ] Add `GET /api/posts/search?q=:query`
- [ ] Support pagination
- [ ] Sort by relevance
- [ ] Document the response contract for frontend consumption

---

### P2. User Profile and Posts by User

**Status:** ⏳ Next  
**Why second:** useful for author pages and profile screens without changing the
post data model.  
**Files to Create/Modify:**

- `src/routes/user.route.ts`
- `src/services/user.service.ts`
- `src/schemas/user.schema.ts`
- `src/index.ts`
- `test/`
- `docs/frontend-api-guide.md`
- `README.md`

**Detail:**

- [ ] `GET /api/users/:id/profile`
- [ ] `GET /api/users/:id/posts`
- [ ] `GET /api/me`
- [ ] Include profile stats:
  - total posts
  - total views received
  - total likes received

---

### P3. Tags

**Status:** ⏳ Next  
**Why third:** unlocks filtering, related posts, and SEO keywords.  
**Files to Create/Modify:**

- `src/db/schemas/tag.ts`
- `src/db/schemas/index.ts`
- `src/db/schemas/relations.ts`
- `src/db/migrations/*`
- `src/routes/tag.route.ts`
- `src/services/tag.service.ts`
- `src/schemas/tag.schema.ts`
- `src/routes/post.route.ts`
- `src/services/post.service.ts`
- `src/schemas/post.schema.ts`
- `test/`
- `docs/frontend-api-guide.md`
- `README.md`
- `CONTRIBUTING.md`

**Detail:**

- [ ] Add tags table
- [ ] Add post-tag relation table
- [ ] `GET /api/tags`
- [ ] `POST /api/tags`
- [ ] Add `?tag=:slug` filter to `GET /api/posts`
- [ ] Decide whether categories are truly needed or tags alone are enough

---

### P4. Draft Management and Editorial Status

**Status:** ⏳ Planned  
**Blocked by:** product decision on status model  
**Why after tags/search:** current schema only has boolean `published`; this
requires a deliberate content lifecycle redesign.

**Detail:**

- [ ] Decide between:
  - keep boolean `published` and add publish/unpublish endpoints only
  - migrate to explicit status values such as `draft`, `published`, `scheduled`
- [ ] Add editor-facing status filters
- [ ] Add publish/unpublish operations
- [ ] Update frontend guide after contract settles

---

### P5. Image Upload

**Status:** ⏳ Planned  
**Blocked by:** storage provider decision

**Detail:**

- [ ] Choose provider: Cloudinary, S3-compatible storage, or local dev storage
- [ ] Add multipart upload endpoint
- [ ] Validate type and size
- [ ] Return stable public URL shape
- [ ] Document auth and storage env vars

---

### P6. Filtering and Sorting Posts

**Status:** ⏳ Planned  
**Depends on:** search and/or tags decisions

**Detail:**

- [ ] Add stable query params for list sorting:
  - `sort=latest|oldest|popular`
  - `author=:userId`
  - `date_from`
  - `date_to`
- [ ] Keep query builder logic in `post.service.ts`
- [ ] Update query key guidance in frontend docs

---

### P7. Bookmark / Save Posts

**Status:** ⏳ Planned  
**Why before comment likes:** simpler and more directly useful for end users.

**Detail:**

- [ ] Add bookmarks table
- [ ] `POST /api/bookmarks`
- [ ] `DELETE /api/bookmarks/:postId`
- [ ] `GET /api/bookmarks`

---

### P8. Comment Likes

**Status:** ⏳ Planned

**Detail:**

- [ ] Add comment likes table
- [ ] `POST /api/engagement/comments/:id/like`
- [ ] `GET /api/engagement/comments/:id/likes/count`

---

### P9. Related Posts

**Status:** ⏳ Planned  
**Depends on:** tags

**Detail:**

- [ ] `GET /api/posts/:id/related`
- [ ] Exclude current post
- [ ] Ranking heuristic:
  - same tags
  - same author
  - latest published fallback

---

### P10. SEO / Distribution Surfaces

**Status:** ⏳ Planned  
**Depends on:** stable post metadata and possibly tags

**Detail:**

- [ ] `GET /api/posts/:id/seo`
- [ ] `GET /feed.xml`
- [ ] `GET /sitemap.xml`
- [ ] Define canonical base URL strategy before implementation

---

### P11. Admin Statistics and Moderation

**Status:** ⏳ Planned  
**Blocked by:** stronger app-level admin authorization patterns

**Detail:**

- [ ] `GET /api/admin/stats`
- [ ] Report / moderation system
- [ ] Admin-facing aggregated metrics
- [ ] Explicit admin route policy helpers if current ownership/admin helper is
      no longer enough

---

## Open Decisions

These are real blockers and should not stay implicit:

1. **Search approach**
   - PostgreSQL full-text only
   - external search engine later if needed

2. **Editorial lifecycle**
   - boolean `published`
   - or explicit content status model

3. **Image storage**
   - Cloudinary
   - S3-compatible
   - local development only

4. **Taxonomy scope**
   - tags only
   - tags + categories

---

## Rules for Updating This File

- When a task ships, move it to `Already Implemented`.
- Do not keep completed backend features under `Pending`.
- If a task depends on a product decision, mark the decision explicitly.
- If a change alters public API contracts, update:
  - `README.md`
  - `docs/frontend-api-guide.md`
  - tests
- If a change alters repo conventions, update `CONTRIBUTING.md`.

Last Updated: 2026-04-16
