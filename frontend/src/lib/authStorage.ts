import type { User } from "./api";

const TOKEN_KEY = "kavach_jwt";
const USER_KEY = "kavach_user";

export interface StoredAuth {
  token: string;
  user: User;
}

/** Decode JWT `exp` (seconds since epoch) without a library. */
export function getJwtExpiryUnix(token: string): number | null {
  try {
    const part = token.split(".")[1];
    if (!part) return null;
    const json = atob(part.replace(/-/g, "+").replace(/_/g, "/"));
    const payload = JSON.parse(json) as { exp?: unknown };
    return typeof payload.exp === "number" ? payload.exp : null;
  } catch {
    return null;
  }
}

export function isJwtExpired(token: string, skewSeconds = 30): boolean {
  const exp = getJwtExpiryUnix(token);
  if (exp == null) return true;
  return Date.now() >= (exp - skewSeconds) * 1000;
}

export function loadAuth(): StoredAuth | null {
  try {
    const token = localStorage.getItem(TOKEN_KEY);
    const rawUser = localStorage.getItem(USER_KEY);
    if (!token || !rawUser) return null;
    if (isJwtExpired(token)) {
      clearAuth();
      return null;
    }
    const user = JSON.parse(rawUser) as User;
    if (!user?.id || !user?.email) {
      clearAuth();
      return null;
    }
    return { token, user };
  } catch {
    clearAuth();
    return null;
  }
}

export function saveAuth(token: string, user: User): void {
  localStorage.setItem(TOKEN_KEY, token);
  localStorage.setItem(USER_KEY, JSON.stringify(user));
}

export function clearAuth(): void {
  localStorage.removeItem(TOKEN_KEY);
  localStorage.removeItem(USER_KEY);
}
