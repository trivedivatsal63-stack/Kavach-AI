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

export function AuthProvider({ children }: { children: ReactNode }) {
  const [token, setToken] = useState<string | null>(null);
  const [user, setUser] = useState<User | null>(null);
  const [ready, setReady] = useState(false);

  const logout = useCallback(() => {
    clearAuth();
    setToken(null);
    setUser(null);
  }, []);

  // Hydrate from localStorage once on mount.
  useEffect(() => {
    const stored = loadAuth();
    if (stored) {
      setToken(stored.token);
      setUser(stored.user);
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
    saveAuth(newToken, newUser);
    setToken(newToken);
    setUser(newUser);
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
