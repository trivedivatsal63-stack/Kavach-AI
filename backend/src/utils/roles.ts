export const USER_ROLE = {
  USER: "user",
  SUPERADMIN: "superadmin",
} as const;

export type UserRole = (typeof USER_ROLE)[keyof typeof USER_ROLE];

export const USER_STATUS = {
  ACTIVE: "active",
  PAUSED: "paused",
  BLOCKED: "blocked",
} as const;

export type UserStatus = (typeof USER_STATUS)[keyof typeof USER_STATUS];

export const ADMIN_ACTION = {
  PAUSE: "pause",
  UNPAUSE: "unpause",
  BLOCK: "block",
  UNBLOCK: "unblock",
  SOFT_DELETE: "soft_delete",
  RESTORE: "restore",
  REVOKE_KEY: "revoke_key",
  REVOKE_ALL_KEYS: "revoke_all_keys",
} as const;

export function isSuperadmin(role: string): boolean {
  return role === USER_ROLE.SUPERADMIN;
}

export function isActiveStatus(status: string): boolean {
  return status === USER_STATUS.ACTIVE;
}
