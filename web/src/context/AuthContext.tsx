import { createContext, useContext, useState, type ReactNode } from "react";
import type { User } from "../lib/api";

// Deliberately in-memory only — no localStorage/sessionStorage. A page
// reload logs the user out and they land back on /login. This trades UX
// (session doesn't survive a refresh) for real XSS resistance: a script
// injected anywhere on the page cannot read the JWT out of storage, since
// there's no storage to read. See the README for why this was chosen over
// an httpOnly cookie (the actually-ideal option, but one that requires
// api/ to set the cookie itself — out of scope for this phase).
interface AuthContextValue {
  token: string | null;
  user: User | null;
  setAuth: (token: string, user: User) => void;
  updateUser: (user: User) => void;
  logout: () => void;
}

const AuthContext = createContext<AuthContextValue | undefined>(undefined);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [token, setToken] = useState<string | null>(null);
  const [user, setUser] = useState<User | null>(null);

  function setAuth(newToken: string, newUser: User) {
    setToken(newToken);
    setUser(newUser);
  }

  function updateUser(newUser: User) {
    setUser(newUser);
  }

  function logout() {
    setToken(null);
    setUser(null);
  }

  return (
    <AuthContext.Provider value={{ token, user, setAuth, updateUser, logout }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within AuthProvider");
  return ctx;
}
