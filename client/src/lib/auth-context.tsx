"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useState,
  ReactNode,
} from "react";
import { api, getToken, setToken } from "./api";

export interface SessionUser {
  id: number;
  username: string;
  email?: string;
  balance_cents: number;
  total_earned_cents: number;
  is_admin: boolean;
  email_verified_at: string | null;
  created_at?: string;
}

interface AuthContextValue {
  user: SessionUser | null;
  loading: boolean;
  login: (username: string, password: string) => Promise<void>;
  register: (username: string, email: string, password: string, ref?: string) => Promise<void>;
  logout: () => void;
  refresh: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<SessionUser | null>(null);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    if (!getToken()) {
      setUser(null);
      setLoading(false);
      return;
    }
    try {
      const data = await api<{ user: SessionUser }>("/api/auth/me");
      setUser(data.user);
    } catch {
      setToken(null);
      setUser(null);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    (async () => {
      await refresh();
    })();
  }, [refresh]);

  const login = useCallback(async (username: string, password: string) => {
    const data = await api<{ token: string }>("/api/auth/login", {
      method: "POST",
      body: { username, password },
      auth: false,
    });
    setToken(data.token);
    await refresh();
  }, [refresh]);

  const register = useCallback(
    async (username: string, email: string, password: string, ref?: string) => {
      const data = await api<{ token: string }>("/api/auth/register", {
        method: "POST",
        body: { username, email, password, ...(ref ? { ref } : {}) },
        auth: false,
      });
      setToken(data.token);
      await refresh();
    },
    [refresh]
  );

  const logout = useCallback(() => {
    setToken(null);
    setUser(null);
  }, []);

  return (
    <AuthContext.Provider value={{ user, loading, login, register, logout, refresh }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within AuthProvider");
  return ctx;
}
