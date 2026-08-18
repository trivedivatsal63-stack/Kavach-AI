import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import type { User } from "../lib/api";
import { fetchMe } from "../lib/api";
import {
  clearAuth,
  getJwtExpiryUnix,
  isJwtExpired,
  loadAuth,
  saveAuth,
} from "../lib/authStorage";

interface AuthContextValue {
  token: string | null;
  user: User | null;
  /** True after localStorage hydrate on first paint. */
  ready: boolean;
  setAuth: (token: string, user: User) => void;
  updateUser: (user: User) => void;
  logout: () => void;
}

const AuthContext = createContext<AuthContextValue | undefined>(undefined);

function normalizeUser(user: User): User {
  return {
    ...user,
    role: user.role === "superadmin" ? "superadmin" : "user",
    status:
      user.status === "paused" || user.status === "blocked"
        ? user.status
        : "active",
  };
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [token, setToken] = useState<string | null>(null);
  const [user, setUser] = useState<User | null>(null);
  const [ready, setReady] = useState(false);

  const logout = useCallback(() => {
    clearAuth();
    setToken(null);
    setUser(null);
  }, []);

  // Hydrate from localStorage once on mount, then refresh role/status from
  // the live user row so a promotion or pause is visible without re-login.
  useEffect(() => {
    const stored = loadAuth();
    if (stored) {
      setToken(stored.token);
      setUser(normalizeUser(stored.user));
      void fetchMe(stored.token)
        .then((fresh) => {
          setUser(fresh);
          saveAuth(stored.token, fresh);
        })
        .catch(() => {
          // Keep the stored user if /auth/me fails for a transient reason;
          // 401/blocked is handled by the unauthorized listener.
        });
    }
    setReady(true);
  }, []);

  // Auto-logout when the JWT reaches its 7h expiry.
  useEffect(() => {
    if (!token) return;
    if (isJwtExpired(token)) {
      logout();
      return;
    }
    const exp = getJwtExpiryUnix(token);
    if (exp == null) {
      logout();
      return;
    }
    const ms = exp * 1000 - Date.now();
    const id = window.setTimeout(() => logout(), Math.max(ms, 0));
    return () => window.clearTimeout(id);
  }, [token, logout]);

  // Backend 401 → clear stored JWT and bounce to login.
  useEffect(() => {
    function onUnauthorized() {
      logout();
    }
    window.addEventListener("kavach:unauthorized", onUnauthorized);
    return () =>
      window.removeEventListener("kavach:unauthorized", onUnauthorized);
  }, [logout]);

  const setAuth = useCallback((newToken: string, newUser: User) => {
    const fresh = normalizeUser(newUser);
    saveAuth(newToken, fresh);
    setToken(newToken);
    setUser(fresh);
  }, []);

  const updateUser = useCallback(
    (newUser: User) => {
      setUser(newUser);
      if (token) saveAuth(token, newUser);
    },
    [token]
  );

  const value = useMemo(
    () => ({ token, user, ready, setAuth, updateUser, logout }),
    [token, user, ready, setAuth, updateUser, logout]
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within AuthProvider");
  return ctx;
}
