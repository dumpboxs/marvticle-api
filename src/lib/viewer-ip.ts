import { createHmac } from 'node:crypto'

import { env } from '#/env'

const VIEWER_IP_HASH_VERSION = 'v1'

const getViewerIpHashSalt = () => env.VIEWER_IP_HASH_SALT ?? env.BETTER_AUTH_SECRET

/**
 * Store viewer IPs as HMAC-SHA256 digests instead of plaintext.
 * The salt should come from VIEWER_IP_HASH_SALT; BETTER_AUTH_SECRET is the fallback.
 * Rotating the salt changes all future hashes, so historical anonymous hashes should
 * be purged if cross-period matching is no longer acceptable.
 */
export const hashViewerIp = (viewerIp: string) => {
  const normalizedViewerIp = viewerIp.trim()
  if (!normalizedViewerIp) return undefined

  const digest = createHmac('sha256', getViewerIpHashSalt())
    .update(normalizedViewerIp)
    .digest('hex')

  return `${VIEWER_IP_HASH_VERSION}:${digest}`
}
