export type AuthenticatedUser = {
  id: string
  role?: unknown
  [key: string]: unknown
}

const ADMIN_ROLE_NAMES = new Set(['admin', 'superadmin'])

const getNormalizedRole = (role: unknown) => {
  if (typeof role !== 'string') return null

  const normalizedRole = role.trim().toLowerCase()

  return normalizedRole.length > 0 ? normalizedRole : null
}

export const isAdminUser = (
  user: Pick<AuthenticatedUser, 'role'> | null | undefined
) => {
  const normalizedRole = getNormalizedRole(user?.role)

  return normalizedRole ? ADMIN_ROLE_NAMES.has(normalizedRole) : false
}

export const canManageOwnedResource = (
  user: AuthenticatedUser,
  ownerId: string
) => user.id === ownerId || isAdminUser(user)
