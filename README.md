# Elysia with Bun runtime

## Getting Started
To get started with this template, simply paste this command into your terminal:
```bash
bun create elysia ./elysia-example
```

## Development
To start the development server run:
```bash
bun run dev
```

Open http://localhost:3000/ with your browser to see the result.

## Viewer IP Hashing
Anonymous post views do not store plaintext IP addresses. The app stores
`viewer_ip_hash` as `v1:<hex>` using HMAC-SHA256.

- Salt source: `VIEWER_IP_HASH_SALT`
- Fallback salt: `BETTER_AUTH_SECRET`
- Rotation note: rotating the salt changes all future hashes; if you need a clean
  boundary, purge historical anonymous view hashes after rotating.
- Retention note: migration `0002` removes legacy plaintext IP values from the
  existing `views` table before the hashed column is enforced. Authenticated
  legacy rows have the old IP nulled; anonymous legacy rows are deleted because
  their only actor identifier was raw IP.
