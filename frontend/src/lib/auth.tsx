import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import { api, ApiError } from "./api";
import type { Permission, UserRole } from "./permissions";

export interface AuthUser {
  id: string;
  name: string;
  email: string;
  role: UserRole;
  /** O que a pessoa pode pedir além do básico (Fase 9). */
  permissions: Permission[];
}

interface AuthContextValue {
  user: AuthUser | null;
  loading: boolean;
  authMode: "mock" | "senhaunica" | "oidc" | null;
  /** Demonstração online (DEMO_MODE): o login de teste está liberado em produção. */
  demo: boolean;
  refresh: () => Promise<void>;
  logout: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [authMode, setAuthMode] = useState<AuthContextValue["authMode"]>(null);
  const [demo, setDemo] = useState(false);
  const [loading, setLoading] = useState(true);

  const refresh = async () => {
    setLoading(true);
    try {
      const { user: current } = await api<{ user: AuthUser }>("/auth/me");
      setUser(current);
    } catch (error) {
      if (error instanceof ApiError && error.status === 401) {
        setUser(null);
      } else {
        console.error(error);
      }
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    api<{ mode: AuthContextValue["authMode"]; demo?: boolean }>("/auth/config")
      .then((res) => {
        setAuthMode(res.mode);
        setDemo(Boolean(res.demo));
      })
      .catch(() => setAuthMode(null));
    void refresh();
  }, []);

  const logout = async () => {
    await api("/auth/logout", { method: "POST" });
    setUser(null);
  };

  return (
    <AuthContext.Provider value={{ user, loading, authMode, demo, refresh, logout }}>{children}</AuthContext.Provider>
  );
}

/** O SAD age (aprova, reserva, altera, cancela); o NUCEV só acompanha. */
export function useCanManage(): boolean {
  return useAuth().user?.role === "ADMIN";
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth precisa estar dentro de <AuthProvider>");
  return ctx;
}
