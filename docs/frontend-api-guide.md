# Frontend API Call Guide dengan `fetch` dan TanStack React Query

## Ringkasan

Guide ini adalah acuan implementasi frontend untuk konsumsi endpoint `marvticle-api` dengan `fetch`, `zod`, dan TanStack React Query pada frontend `TanStack Start`.

Scope guide ini sengaja sempit:

- hanya untuk endpoint `/api/*`
- fokus pada pola `client-first`
- semua request API memakai satu helper yang sama
- semua response `/api/*` harus divalidasi dengan satu envelope contract yang sama

Guide ini tidak membahas endpoint `/auth/*` dari Better Auth sebagai bagian dari helper utama, karena kontrak response-nya berbeda dan tidak boleh dipaksa masuk ke wrapper `/api/*`.

## Inventory Endpoint Backend

Endpoint `/api/*` yang saat ini tersedia di backend:

- `GET /api/posts`
- `GET /api/posts/:id`
- `POST /api/posts`
- `PUT /api/posts/:id`
- `DELETE /api/posts/:id`
- `POST /api/engagement/likes`
- `GET /api/engagement/likes/count`
- `GET /api/engagement/comments`
- `POST /api/engagement/comments`
- `PUT /api/engagement/comments/:id`
- `DELETE /api/engagement/comments/:id`
- `GET /api/engagement/comments/count`
- `POST /api/engagement/views`
- `GET /api/engagement/views/count`

Auth route Better Auth ada di bawah `/auth/*` dan harus dianggap sebagai integration terpisah.

## Kontrak Response Backend

Backend ini sudah men-standardisasi response success dan error melalui schema terpusat dan error plugin global.

Semua endpoint `/api/*` harus mengikuti envelope ini:

### Success

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

Shape final:

```ts
type ApiSuccessResponse<T> = {
  success: true
  message: string
  data: T
}
```

### Error

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

Shape final:

```ts
type ApiErrorResponse = {
  success: false
  code: string
  message: string
  errors?: Record<string, string>
}
```

### Aturan yang wajib diikuti di frontend

- frontend tidak boleh parse shape response tiap endpoint secara manual
- semua endpoint `/api/*` wajib divalidasi dengan envelope yang sama
- perbedaan antar endpoint hanya ada di `data`
- response sukses harus lolos validasi envelope success dan schema `data`
- response error harus lolos validasi envelope error sebelum dilempar sebagai exception

## Struktur Folder yang Direkomendasikan

Gunakan struktur seperti ini agar implementasi tetap rapi dan tidak tercampur:

```txt
src/
  lib/
    api/
      api-contract.ts
      api-error.ts
      api-client.ts
      query-client.tsx
      query-keys.ts
  features/
    posts/
      posts.schemas.ts
      posts.api.ts
      posts.queries.ts
    engagement/
      engagement.schemas.ts
      engagement.api.ts
      engagement.queries.ts
```

Fungsi tiap file:

- `api-contract.ts`: schema dan type shared untuk envelope API
- `api-error.ts`: class error standar yang dilempar helper
- `api-client.ts`: helper `fetch` utama
- `query-client.tsx`: setup `QueryClient` dan provider
- `query-keys.ts`: query key factory terpusat
- `posts.schemas.ts` dan `engagement.schemas.ts`: schema `zod` per domain
- `posts.api.ts` dan `engagement.api.ts`: wrapper request per endpoint
- `posts.queries.ts` dan `engagement.queries.ts`: hook React Query

## Shared API Contract dengan Zod

File: `src/lib/api/api-contract.ts`

```ts
import { z } from 'zod'

export const fieldErrorMapSchema = z.record(z.string(), z.string())

export type FieldErrorMap = Record<string, string>

export const apiErrorSchema = z.object({
  success: z.literal(false),
  code: z.string(),
  message: z.string(),
  errors: fieldErrorMapSchema.optional(),
})

export const createApiSuccessSchema = <TSchema extends z.ZodTypeAny>(
  dataSchema: TSchema
) =>
  z.object({
    success: z.literal(true),
    message: z.string(),
    data: dataSchema,
  })

export type ApiErrorResponse = z.infer<typeof apiErrorSchema>

export type ApiSuccessResponse<T> = {
  success: true
  message: string
  data: T
}
```

Keputusan implementasi:

- success schema dibuat generik terhadap `dataSchema`
- error schema tunggal dipakai untuk semua error backend
- semua response parsing harus lewat contract ini, bukan `z.any()`

## Model Error Frontend

File: `src/lib/api/api-error.ts`

```ts
export const UNKNOWN_API_ERROR = 'UNKNOWN_API_ERROR'
export const INVALID_RESPONSE_SCHEMA = 'INVALID_RESPONSE_SCHEMA'

type ApiClientErrorOptions = {
  status: number
  code: string
  message: string
  fieldErrors?: Record<string, string>
  raw?: unknown
}

export class ApiClientError extends Error {
  status: number
  code: string
  fieldErrors?: Record<string, string>
  raw?: unknown

  constructor(options: ApiClientErrorOptions) {
    super(options.message)
    this.name = 'ApiClientError'
    this.status = options.status
    this.code = options.code
    this.fieldErrors = options.fieldErrors
    this.raw = options.raw
  }
}
```

Aturan error handling:

- jika HTTP status non-2xx dan payload cocok `apiErrorSchema`, lempar `ApiClientError`
- jika HTTP status non-2xx tapi payload tidak cocok schema, lempar `ApiClientError` fallback dengan `code = UNKNOWN_API_ERROR`
- jika HTTP 2xx tetapi response success tidak cocok schema, lempar `ApiClientError` dengan `code = INVALID_RESPONSE_SCHEMA`
- network error native dari `fetch` dibiarkan bubble up supaya UI bisa membedakan masalah transport vs masalah contract API

## Helper `fetch` yang Final

File: `src/lib/api/api-client.ts`

```ts
import { z } from 'zod'

import { apiErrorSchema, createApiSuccessSchema } from './api-contract'
import {
  ApiClientError,
  INVALID_RESPONSE_SCHEMA,
  UNKNOWN_API_ERROR,
} from './api-error'

type PrimitiveQueryValue = string | number | boolean | null | undefined

type ApiRequestOptions<TSchema extends z.ZodTypeAny> = {
  path: string
  method?: 'GET' | 'POST' | 'PUT' | 'DELETE'
  schema: TSchema
  query?: Record<string, PrimitiveQueryValue>
  body?: unknown
  headers?: HeadersInit
  signal?: AbortSignal
}

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL

const isJsonBody = (value: unknown) =>
  value !== undefined &&
  value !== null &&
  !(value instanceof FormData) &&
  !(value instanceof URLSearchParams) &&
  !(value instanceof Blob)

const buildUrl = (
  path: string,
  query?: Record<string, PrimitiveQueryValue>
) => {
  const url = new URL(path, API_BASE_URL)

  if (query) {
    for (const [key, value] of Object.entries(query)) {
      if (value === undefined || value === null) continue
      url.searchParams.set(key, String(value))
    }
  }

  return url
}

const parseJsonSafely = async (response: Response) => {
  const contentType = response.headers.get('content-type') ?? ''
  if (!contentType.includes('application/json')) return undefined

  try {
    return await response.json()
  } catch {
    return undefined
  }
}

export const apiFetch = async <TSchema extends z.ZodTypeAny>({
  path,
  method = 'GET',
  schema,
  query,
  body,
  headers,
  signal,
}: ApiRequestOptions<TSchema>): Promise<{
  data: z.infer<TSchema>
  message: string
}> => {
  const url = buildUrl(path, query)
  const hasJsonBody = isJsonBody(body)

  const response = await fetch(url, {
    method,
    credentials: 'include',
    signal,
    headers: {
      ...(hasJsonBody ? { 'Content-Type': 'application/json' } : {}),
      ...headers,
    },
    body:
      body === undefined
        ? undefined
        : hasJsonBody
          ? JSON.stringify(body)
          : (body as BodyInit),
  })

  const payload = await parseJsonSafely(response)

  if (!response.ok) {
    const parsedError = apiErrorSchema.safeParse(payload)

    if (parsedError.success) {
      throw new ApiClientError({
        status: response.status,
        code: parsedError.data.code,
        message: parsedError.data.message,
        fieldErrors: parsedError.data.errors,
        raw: payload,
      })
    }

    throw new ApiClientError({
      status: response.status,
      code: UNKNOWN_API_ERROR,
      message: response.statusText || 'Unknown API error',
      raw: payload,
    })
  }

  const successSchema = createApiSuccessSchema(schema)
  const parsedSuccess = successSchema.safeParse(payload)

  if (!parsedSuccess.success) {
    throw new ApiClientError({
      status: response.status,
      code: INVALID_RESPONSE_SCHEMA,
      message: 'Response success schema mismatch',
      raw: payload,
    })
  }

  return {
    data: parsedSuccess.data.data,
    message: parsedSuccess.data.message,
  }
}
```

Kenapa helper ini me-return `{ data, message }` dan bukan raw envelope:

- komponen hampir selalu butuh `data` langsung
- `message` tetap tersedia untuk toast atau snackbar
- envelope backend tetap tervalidasi penuh sebelum di-unwarp

Aturan penting:

- helper ini dipakai untuk semua endpoint `/api/*`
- helper ini tidak dipakai untuk `/auth/*`
- `credentials: 'include'` wajib jadi default karena backend mengaktifkan CORS credentials dan session auth berbasis cookie

## Schema per Resource

### Posts

File: `src/features/posts/posts.schemas.ts`

```ts
import { z } from 'zod'

export const postAuthorSchema = z.object({
  id: z.string().uuid(),
  name: z.string(),
  username: z.string().nullable(),
  image: z.string().nullable(),
})

export const postSchema = z.object({
  id: z.string().uuid(),
  title: z.string(),
  slug: z.string(),
  content: z.string().nullable(),
  coverImage: z.string().nullable(),
  published: z.boolean(),
  author: postAuthorSchema,
  createdAt: z.string(),
  updatedAt: z.string().nullable(),
})

export const postListSchema = z.object({
  items: z.array(postSchema),
  nextCursor: z.string().nullable(),
  hasMore: z.boolean(),
})

export const createPostInputSchema = z.object({
  title: z.string().min(3),
  slug: z.string().min(3),
  content: z.string().min(1).nullable().optional(),
  coverImage: z.string().url().nullable().optional(),
  published: z.boolean().optional(),
})

export const updatePostInputSchema = z
  .object({
    title: z.string().min(3).optional(),
    content: z.string().min(1).nullable().optional(),
    coverImage: z.string().url().nullable().optional(),
    published: z.boolean().optional(),
  })
  .refine((data) => Object.keys(data).length > 0, {
    message: 'At least one field is required',
    path: ['root'],
  })

export type Post = z.infer<typeof postSchema>
export type PostList = z.infer<typeof postListSchema>
export type CreatePostInput = z.infer<typeof createPostInputSchema>
export type UpdatePostInput = z.infer<typeof updatePostInputSchema>
```

Catatan:

- `GET /api/posts` memakai cursor pagination
- bentuk `data` harus `{ items, nextCursor, hasMore }`
- `GET /api/posts/:id` memakai `postSchema`
- `POST /api/posts` menerima payload sesuai `createPostInputSchema`
- `PUT /api/posts/:id` menerima payload parsial sesuai `updatePostInputSchema`
- `DELETE /api/posts/:id` mengembalikan `{ deleted: true }`
- slug tidak berubah lewat endpoint update saat ini
- response post sekarang mengembalikan objek `author`, bukan `authorId`
- `content` bisa bernilai `null`, jadi frontend tidak boleh mengasumsikan string
  selalu ada
- field author yang tersedia adalah `id`, `name`, `username`, dan `image`
- `username` dan `image` sebaiknya diperlakukan nullable di frontend karena schema backend mengizinkan nilai `null`
- update dan delete post butuh auth; backend mengembalikan `403` bila user bukan
  owner post dan bukan admin

### Engagement

File: `src/features/engagement/engagement.schemas.ts`

```ts
import { z } from 'zod'

export const countSchema = z.object({
  count: z.number().int().nonnegative(),
})

export const toggleLikeInputSchema = z.object({
  postId: z.string().uuid(),
})

export const toggleLikeResultSchema = z.object({
  liked: z.boolean(),
  likesCount: z.number().int().nonnegative(),
})

const commentUserSchema = z.object({
  id: z.string().uuid(),
  username: z.string().nullable(),
  displayName: z.string().nullable(),
})

export type CommentNode = {
  id: string
  content: string
  parentId: string | null
  createdAt: string
  updatedAt: string | null
  user: z.infer<typeof commentUserSchema>
  replies: CommentNode[]
  repliesCount: number
}

export const commentSchema: z.ZodType<CommentNode> = z.lazy(() =>
  z.object({
    id: z.string().uuid(),
    content: z.string(),
    parentId: z.string().uuid().nullable(),
    createdAt: z.string(),
    updatedAt: z.string().nullable(),
    user: commentUserSchema,
    replies: z.array(commentSchema),
    repliesCount: z.number().int().nonnegative(),
  })
)

export const commentListSchema = z.object({
  items: z.array(commentSchema),
  total: z.number().int().nonnegative(),
  page: z.number().int().min(1),
  limit: z.number().int().min(1),
})

export const createCommentInputSchema = z.object({
  postId: z.string().uuid(),
  content: z.string().min(1).max(2000),
  parentId: z.string().uuid().optional(),
})

export const createCommentResultSchema = z.object({
  id: z.string().uuid(),
  content: z.string(),
  parentId: z.string().uuid().nullable(),
  createdAt: z.string(),
  updatedAt: z.string().nullable(),
})

export const updateCommentInputSchema = z.object({
  content: z.string().min(1).max(2000),
})

export const updateCommentResultSchema = z.object({
  id: z.string().uuid(),
  content: z.string(),
  updatedAt: z.string().nullable(),
})

export const deleteCommentResultSchema = z.object({
  deleted: z.boolean(),
})

export const trackViewInputSchema = z.object({
  postId: z.string().uuid(),
})

export const trackViewResultSchema = z.object({
  viewsCount: z.number().int().nonnegative(),
})
```

Catatan:

- `GET /api/engagement/comments` memakai `page` dan `limit`
- `items` adalah nested comment tree, bukan flat list
- semua endpoint count memakai `countSchema`

## API Module per Domain

Pisahkan request wrapper per domain. Jangan satukan semua endpoint ke satu file besar.

### Posts API

File: `src/features/posts/posts.api.ts`

```ts
import { z } from 'zod'

import { apiFetch } from '@/lib/api/api-client'

import {
  createPostInputSchema,
  postListSchema,
  postSchema,
  type CreatePostInput,
  type UpdatePostInput,
  updatePostInputSchema,
} from './posts.schemas'

type GetPostsParams = {
  limit?: number
  cursor?: string
}

export const getPosts = async (
  params: GetPostsParams = {},
  signal?: AbortSignal
) =>
  apiFetch({
    path: '/api/posts',
    method: 'GET',
    schema: postListSchema,
    query: {
      limit: params.limit ?? 10,
      cursor: params.cursor,
    },
    signal,
  })

export const getPostById = async (id: string, signal?: AbortSignal) =>
  apiFetch({
    path: `/api/posts/${id}`,
    method: 'GET',
    schema: postSchema,
    signal,
  })

export const createPost = async (payload: CreatePostInput) => {
  createPostInputSchema.parse(payload)

  return apiFetch({
    path: '/api/posts',
    method: 'POST',
    schema: postSchema,
    body: payload,
  })
}

export const updatePost = async (id: string, payload: UpdatePostInput) => {
  updatePostInputSchema.parse(payload)

  return apiFetch({
    path: `/api/posts/${id}`,
    method: 'PUT',
    schema: postSchema,
    body: payload,
  })
}

export const deletePost = async (id: string) =>
  apiFetch({
    path: `/api/posts/${id}`,
    method: 'DELETE',
    schema: z.object({
      deleted: z.literal(true),
    }),
  })
```

### Engagement API

File: `src/features/engagement/engagement.api.ts`

```ts
import { apiFetch } from '@/lib/api/api-client'

import {
  commentListSchema,
  countSchema,
  createCommentInputSchema,
  createCommentResultSchema,
  deleteCommentResultSchema,
  toggleLikeInputSchema,
  toggleLikeResultSchema,
  trackViewInputSchema,
  trackViewResultSchema,
  updateCommentInputSchema,
  updateCommentResultSchema,
} from './engagement.schemas'

type GetCommentsParams = {
  postId: string
  page?: number
  limit?: number
}

export const toggleLike = async (payload: { postId: string }) => {
  toggleLikeInputSchema.parse(payload)

  return apiFetch({
    path: '/api/engagement/likes',
    method: 'POST',
    schema: toggleLikeResultSchema,
    body: payload,
  })
}

export const getLikesCount = async (postId: string, signal?: AbortSignal) =>
  apiFetch({
    path: '/api/engagement/likes/count',
    method: 'GET',
    schema: countSchema,
    query: { postId },
    signal,
  })

export const getComments = async (
  params: GetCommentsParams,
  signal?: AbortSignal
) =>
  apiFetch({
    path: '/api/engagement/comments',
    method: 'GET',
    schema: commentListSchema,
    query: {
      postId: params.postId,
      page: params.page ?? 1,
      limit: params.limit ?? 20,
    },
    signal,
  })

export const createComment = async (payload: {
  postId: string
  content: string
  parentId?: string
}) => {
  createCommentInputSchema.parse(payload)

  return apiFetch({
    path: '/api/engagement/comments',
    method: 'POST',
    schema: createCommentResultSchema,
    body: payload,
  })
}

export const updateComment = async (
  id: string,
  payload: { content: string }
) => {
  updateCommentInputSchema.parse(payload)

  return apiFetch({
    path: `/api/engagement/comments/${id}`,
    method: 'PUT',
    schema: updateCommentResultSchema,
    body: payload,
  })
}

export const deleteComment = async (id: string) =>
  apiFetch({
    path: `/api/engagement/comments/${id}`,
    method: 'DELETE',
    schema: deleteCommentResultSchema,
  })

export const getCommentsCount = async (postId: string, signal?: AbortSignal) =>
  apiFetch({
    path: '/api/engagement/comments/count',
    method: 'GET',
    schema: countSchema,
    query: { postId },
    signal,
  })

export const trackView = async (payload: { postId: string }) => {
  trackViewInputSchema.parse(payload)

  return apiFetch({
    path: '/api/engagement/views',
    method: 'POST',
    schema: trackViewResultSchema,
    body: payload,
  })
}

export const getViewsCount = async (postId: string, signal?: AbortSignal) =>
  apiFetch({
    path: '/api/engagement/views/count',
    method: 'GET',
    schema: countSchema,
    query: { postId },
    signal,
  })
```

Aturan implementasi:

- setiap function harus memanggil `apiFetch`
- setiap function harus mengirim schema `zod` yang spesifik
- tiap payload input yang berasal dari UI sebaiknya divalidasi dulu di client sebelum request dikirim
- endpoint `PUT` dan `DELETE /api/posts/:id` harus diperlakukan sebagai
  authenticated mutation yang bisa gagal dengan `403`

## Query Keys

File: `src/lib/api/query-keys.ts`

```ts
export const queryKeys = {
  posts: {
    all: ['posts'] as const,
    list: (params: { limit: number }) => ['posts', 'list', params] as const,
    detail: (id: string) => ['posts', 'detail', id] as const,
  },
  engagement: {
    likesCount: (postId: string) =>
      ['engagement', 'likes-count', postId] as const,
    comments: (params: { postId: string; page: number; limit: number }) =>
      ['engagement', 'comments', params] as const,
    commentsCount: (postId: string) =>
      ['engagement', 'comments-count', postId] as const,
    viewsCount: (postId: string) =>
      ['engagement', 'views-count', postId] as const,
  },
}
```

Prinsip query key:

- key harus stabil
- params yang masuk ke key harus minimal dan serializable
- invalidation mutation harus selalu mengacu ke key factory ini
- hindari string hardcoded yang tersebar di banyak file

Catatan khusus untuk infinite query posts:

- untuk `useInfiniteQuery`, gunakan key yang tidak memasukkan `cursor`
- `cursor` adalah mekanisme pagination internal, bukan identitas query dasar
- key cukup merepresentasikan filter yang stabil, misalnya hanya `limit`

## Setup TanStack Query di TanStack Start

Fokus guide ini adalah `client-first`, jadi cukup pasang `QueryClient` di provider client component.

File: `src/lib/api/query-client.tsx`

```tsx
'use client'

import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { ReactQueryDevtools } from '@tanstack/react-query-devtools'
import { useState } from 'react'

export function AppQueryProvider({ children }: { children: React.ReactNode }) {
  const [queryClient] = useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: {
            retry: 1,
            refetchOnWindowFocus: false,
            staleTime: 30_000,
          },
          mutations: {},
        },
      })
  )

  return (
    <QueryClientProvider client={queryClient}>
      {children}
      <ReactQueryDevtools initialIsOpen={false} />
    </QueryClientProvider>
  )
}
```

Penempatan provider:

- letakkan provider ini di root layout atau app shell TanStack Start
- semua page dan component yang memakai React Query harus berada di bawah provider ini

Contoh penempatan:

```tsx
import { Outlet } from '@tanstack/react-router'

import { AppQueryProvider } from '@/lib/api/query-client'

export function RootLayout() {
  return (
    <AppQueryProvider>
      <Outlet />
    </AppQueryProvider>
  )
}
```

Catatan:

- `retry: 1` cukup aman untuk query biasa
- `refetchOnWindowFocus: false` menghindari refetch yang terasa agresif
- `staleTime` bisa diubah per query jika ada kebutuhan berbeda
- error mutation lebih baik ditangani di hook atau component, bukan di global default
- bila nanti butuh SSR atau hydration, pola ini bisa diperluas tanpa mengubah contract helper API

## Contoh Hook Query dan Mutation

### Posts Queries

File: `src/features/posts/posts.queries.ts`

```ts
import {
  useInfiniteQuery,
  useMutation,
  useQuery,
  useQueryClient,
} from '@tanstack/react-query'

import { queryKeys } from '@/lib/api/query-keys'

import {
  createPost,
  deletePost,
  getPostById,
  getPosts,
  updatePost,
} from './posts.api'

export const usePostsInfiniteQuery = (limit = 10) =>
  useInfiniteQuery({
    queryKey: queryKeys.posts.list({ limit }),
    initialPageParam: undefined as string | undefined,
    queryFn: ({ pageParam, signal }) =>
      getPosts(
        {
          limit,
          cursor: pageParam,
        },
        signal
      ).then((result) => result.data),
    getNextPageParam: (lastPage) =>
      lastPage.hasMore ? (lastPage.nextCursor ?? undefined) : undefined,
  })

export const usePostDetailQuery = (id: string) =>
  useQuery({
    queryKey: queryKeys.posts.detail(id),
    queryFn: ({ signal }) =>
      getPostById(id, signal).then((result) => result.data),
    enabled: Boolean(id),
  })

export const useCreatePostMutation = () => {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: createPost,
    onSuccess: async () => {
      await queryClient.invalidateQueries({
        queryKey: queryKeys.posts.all,
      })
    },
  })
}

export const useUpdatePostMutation = (id: string) => {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: (payload: {
      title?: string
      content?: string | null
      coverImage?: string | null
      published?: boolean
    }) => updatePost(id, payload),
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({
          queryKey: queryKeys.posts.detail(id),
        }),
        queryClient.invalidateQueries({
          queryKey: queryKeys.posts.all,
        }),
      ])
    },
  })
}

export const useDeletePostMutation = () => {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: deletePost,
    onSuccess: async (_result, id) => {
      await Promise.all([
        queryClient.invalidateQueries({
          queryKey: queryKeys.posts.all,
        }),
        queryClient.removeQueries({
          queryKey: queryKeys.posts.detail(id),
        }),
      ])
    },
  })
}
```

Catatan:

- `pageParam` diisi `cursor`
- `getNextPageParam` mengambil `nextCursor`
- infinite query berhenti saat `hasMore` false atau `nextCursor` null
- update post invalidate detail dan list posts
- delete post invalidate list dan hapus cached detail post

### Engagement Queries

File: `src/features/engagement/engagement.queries.ts`

```ts
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'

import { queryKeys } from '@/lib/api/query-keys'

import {
  createComment,
  deleteComment,
  getComments,
  getCommentsCount,
  getLikesCount,
  getViewsCount,
  toggleLike,
  trackView,
  updateComment,
} from './engagement.api'

export const useCommentsQuery = (postId: string, page = 1, limit = 20) =>
  useQuery({
    queryKey: queryKeys.engagement.comments({ postId, page, limit }),
    queryFn: ({ signal }) =>
      getComments({ postId, page, limit }, signal).then(
        (result) => result.data
      ),
    enabled: Boolean(postId),
  })

export const useLikesCountQuery = (postId: string) =>
  useQuery({
    queryKey: queryKeys.engagement.likesCount(postId),
    queryFn: ({ signal }) =>
      getLikesCount(postId, signal).then((result) => result.data),
    enabled: Boolean(postId),
    staleTime: 15_000,
  })

export const useViewsCountQuery = (postId: string) =>
  useQuery({
    queryKey: queryKeys.engagement.viewsCount(postId),
    queryFn: ({ signal }) =>
      getViewsCount(postId, signal).then((result) => result.data),
    enabled: Boolean(postId),
    staleTime: 15_000,
  })

export const useToggleLikeMutation = (postId: string) => {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: () => toggleLike({ postId }),
    onSuccess: async () => {
      await queryClient.invalidateQueries({
        queryKey: queryKeys.engagement.likesCount(postId),
      })

      await queryClient.invalidateQueries({
        queryKey: queryKeys.posts.all,
      })

      await queryClient.invalidateQueries({
        queryKey: queryKeys.posts.detail(postId),
      })
    },
  })
}

export const useCreateCommentMutation = (
  postId: string,
  page = 1,
  limit = 20
) => {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: createComment,
    onSuccess: async () => {
      await queryClient.invalidateQueries({
        queryKey: queryKeys.engagement.comments({ postId, page, limit }),
      })

      await queryClient.invalidateQueries({
        queryKey: queryKeys.engagement.commentsCount(postId),
      })
    },
  })
}

export const useUpdateCommentMutation = (
  postId: string,
  page = 1,
  limit = 20
) => {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: ({ id, content }: { id: string; content: string }) =>
      updateComment(id, { content }),
    onSuccess: async () => {
      await queryClient.invalidateQueries({
        queryKey: queryKeys.engagement.comments({ postId, page, limit }),
      })
    },
  })
}

export const useDeleteCommentMutation = (
  postId: string,
  page = 1,
  limit = 20
) => {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: deleteComment,
    onSuccess: async () => {
      await queryClient.invalidateQueries({
        queryKey: queryKeys.engagement.comments({ postId, page, limit }),
      })

      await queryClient.invalidateQueries({
        queryKey: queryKeys.engagement.commentsCount(postId),
      })
    },
  })
}

export const useTrackViewMutation = (postId: string) => {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: () => trackView({ postId }),
    onSuccess: async () => {
      await queryClient.invalidateQueries({
        queryKey: queryKeys.engagement.viewsCount(postId),
      })
    },
  })
}
```

Aturan invalidation:

- toggle like invalidate likes count dan post list/detail bila UI menampilkannya
- create, update, dan delete comment invalidate comments list
- create dan delete comment invalidate comments count
- track view invalidate views count bila angka view ditampilkan real-time
- create post invalidate posts list

## Error Handling di UI

Contoh helper sederhana:

```ts
import { ApiClientError } from '@/lib/api/api-error'

export const getErrorMessage = (error: unknown) => {
  if (error instanceof ApiClientError) return error.message
  if (error instanceof Error) return error.message
  return 'Unexpected error'
}
```

Contoh pemakaian pada form:

```tsx
import { useState } from 'react'

import { ApiClientError } from '@/lib/api/api-error'

export function CreateCommentForm() {
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({})
  const mutation = useCreateCommentMutation('post-id')

  const handleSubmit = async () => {
    setFieldErrors({})

    try {
      await mutation.mutateAsync({
        postId: 'post-id',
        content: '',
      })
    } catch (error) {
      if (
        error instanceof ApiClientError &&
        error.code === 'VALIDATION_ERROR'
      ) {
        setFieldErrors(error.fieldErrors ?? {})
        return
      }

      console.error(error)
    }
  }

  return (
    <div>
      <button onClick={handleSubmit}>Submit</button>
      {fieldErrors.content ? <p>{fieldErrors.content}</p> : null}
    </div>
  )
}
```

Aturan di UI:

- cek `error instanceof ApiClientError` untuk error dari backend API
- baca `error.code` untuk branching logic seperti `VALIDATION_ERROR`, `UNAUTHORIZED`, atau `NOT_FOUND`
- baca `error.fieldErrors` untuk memetakan error form
- gunakan `error.message` untuk toast atau snackbar
- untuk network error native, fallback ke pesan umum seperti `Tidak dapat terhubung ke server`
- untuk schema mismatch, log detail error dan tampilkan pesan aman ke user

## Anti-Pattern yang Harus Dihindari

- jangan `await response.json()` langsung di komponen
- jangan parse `success` manual di banyak tempat
- jangan membuat query key hardcoded tersebar
- jangan memakai satu schema `z.any()` untuk semua endpoint
- jangan memakai helper `/api/*` untuk endpoint Better Auth `/auth/*`
- jangan mengembalikan raw `Response` dari layer API ke layer UI

## Public API dan Interface yang Harus Menjadi Standar

Kontrak frontend yang harus dijaga konsisten:

- `apiErrorSchema`
- `createApiSuccessSchema<TSchema>()`
- `ApiErrorResponse`
- `ApiSuccessResponse<T>`
- `FieldErrorMap`
- `ApiRequestOptions<TSchema>`
- `ApiClientError`
- `apiFetch<TSchema>(options)`
- `queryKeys`
- `getPosts`, `getPostById`, `createPost`, `updatePost`, `deletePost`
- `toggleLike`, `getLikesCount`, `getComments`, `createComment`, `updateComment`, `deleteComment`, `getCommentsCount`, `trackView`, `getViewsCount`
- `usePostsInfiniteQuery`, `usePostDetailQuery`, `useCreatePostMutation`, `useUpdatePostMutation`, `useDeletePostMutation`
- `useCommentsQuery`, `useLikesCountQuery`, `useViewsCountQuery`
- `useToggleLikeMutation`, `useCreateCommentMutation`, `useUpdateCommentMutation`, `useDeleteCommentMutation`, `useTrackViewMutation`

Keputusan interface:

- helper menerima `schema` per request, bukan registry global
- helper return `{ data, message }`, bukan raw envelope
- error backend selalu dilempar sebagai `ApiClientError`
- endpoint auth tidak memakai helper ini

## Verifikasi Implementasi

Skenario yang harus diuji setelah implementasi:

### 1. Success response valid

- panggil `GET /api/posts`
- backend mengembalikan envelope success valid
- helper berhasil parse dan return `data` bertipe benar

### 2. Error response valid

- kirim request invalid ke endpoint yang memicu `422`
- helper melempar `ApiClientError`
- `fieldErrors` terisi dari `errors`

### 3. Success shape mismatch

- simulasi backend mengembalikan response 200 dengan shape `data` yang salah
- helper melempar `ApiClientError`
- `error.code === 'INVALID_RESPONSE_SCHEMA'`

### 4. Error non-JSON atau shape error salah

- backend mengembalikan error non-JSON atau JSON yang tidak cocok `apiErrorSchema`
- helper tetap melempar `ApiClientError`
- `error.code === 'UNKNOWN_API_ERROR'`

### 5. Authenticated endpoint dengan cookie session

- panggil `POST /api/posts` atau `POST /api/engagement/comments`
- pastikan request otomatis memakai `credentials: 'include'`

### 6. Infinite query posts

- `nextCursor` dipakai sebagai `pageParam`
- infinite query berhenti saat `hasMore` false atau `nextCursor` null

### 7. Mutation invalidation

- create dan delete comment me-refresh comments list dan comments count
- toggle like me-refresh likes count
- update post me-refresh post detail dan post list
- delete post me-refresh post list dan menghapus cache detail post

### 8. Form validation

- `VALIDATION_ERROR` bisa dipetakan ke field form
- `fieldErrors.content` atau key lain bisa langsung dipakai di UI

### 9. Ownership / admin authorization

- panggil `PUT /api/posts/:id` atau `DELETE /api/posts/:id` sebagai user yang
  bukan owner dan bukan admin
- helper melempar `ApiClientError`
- `error.status === 403`
- `error.code === 'FORBIDDEN'`

### 10. Network failure

- matikan backend atau ubah base URL
- pastikan komponen menampilkan fallback message yang aman

## Checklist Implementasi

- [ ] buat `api-contract.ts`
- [ ] buat `api-error.ts`
- [ ] buat `api-client.ts`
- [ ] buat schema `zod` per resource
- [ ] buat API module per domain
- [ ] buat `queryKeys`
- [ ] pasang `QueryClientProvider`
- [ ] buat query dan mutation hooks
- [ ] tangani `fieldErrors` di form
- [ ] pastikan semua endpoint `/api/*` memakai helper yang sama
- [ ] pastikan `/auth/*` tidak memakai helper yang sama
- [ ] tangani `403 FORBIDDEN` untuk mutation post update/delete

## Asumsi dan Default yang Dikunci

- file guide ini ditulis untuk `TanStack Start`
- pendekatan yang dipakai adalah `client-first`
- scope hanya endpoint `/api/*`
- endpoint `/auth/*` hanya disebut sebagai pengecualian
- contoh kode memakai TypeScript
- React Query yang dipakai adalah pola v5
- auth frontend ke backend memakai cookie session
- default helper adalah `credentials: 'include'`
- versi pertama tidak memakai OpenAPI codegen
- guide ini tidak memasukkan flow SSR atau hydration penuh
