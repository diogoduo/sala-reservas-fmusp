import { useEffect, useState } from "react";
import { api } from "../lib/api";
import { useAuth } from "../lib/auth";

interface MockUser {
  id: string;
  name: string;
  email: string;
  role: "USER" | "ADMIN";
}

/** Tela de login do "Dev Mode": escolher uma conta de teste ou digitar um e-mail @usp.br novo. */
function MockLogin() {
  const { refresh } = useAuth();
  const [users, setUsers] = useState<MockUser[]>([]);
  const [email, setEmail] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    api<{ users: MockUser[] }>("/auth/mock/users").then((res) => setUsers(res.users));
  }, []);

  async function login(targetEmail: string) {
    setBusy(true);
    setError(null);
    try {
      await api("/auth/mock/login", { method: "POST", body: JSON.stringify({ email: targetEmail }) });
      await refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Falha ao entrar.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="mx-auto max-w-md p-8">
      <h1 className="text-xl font-semibold">Entrar (Dev Mode — Mock USP)</h1>
      <p className="mt-1 text-sm text-slate-500">
        Simula a Senha Única USP para desenvolvimento local. Não disponível em produção.
      </p>

      <div className="mt-6 space-y-2">
        {users.map((u) => (
          <button
            key={u.id}
            disabled={busy}
            onClick={() => login(u.email)}
            className="w-full rounded-md border border-slate-200 p-3 text-left hover:bg-slate-50 disabled:opacity-50"
          >
            <div className="font-medium">{u.name}</div>
            <div className="text-sm text-slate-500">
              {u.email} · {u.role === "ADMIN" ? "Administrador" : "Solicitante"}
            </div>
          </button>
        ))}
      </div>

      <div className="mt-6 border-t border-slate-200 pt-4">
        <label className="block text-sm font-medium text-slate-700">Ou simular um e-mail novo</label>
        <div className="mt-2 flex gap-2">
          <input
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="nome@usp.br"
            className="flex-1 rounded-md border border-slate-300 px-3 py-2 text-sm"
          />
          <button
            disabled={busy || !email}
            onClick={() => login(email)}
            className="rounded-md bg-slate-900 px-4 py-2 text-sm text-white disabled:opacity-50"
          >
            Entrar
          </button>
        </div>
      </div>

      {error && <p className="mt-4 text-sm text-red-600">{error}</p>}
    </div>
  );
}

/** Login real: redireciona para o back-end, que conduz o fluxo OAuth 1.0a com a USP. */
function SenhaUnicaLogin() {
  return (
    <div className="mx-auto max-w-md p-8 text-center">
      <h1 className="text-xl font-semibold">Reserva de Salas — FMUSP</h1>
      <p className="mt-2 text-slate-600">Entre com sua conta USP.</p>
      <a href="/api/auth/senhaunica/login" className="mt-6 inline-block rounded-md bg-slate-900 px-6 py-3 text-white">
        Entrar com a Senha Única USP
      </a>
    </div>
  );
}

export function Login() {
  const { authMode } = useAuth();

  if (authMode === "senhaunica") return <SenhaUnicaLogin />;
  if (authMode === "oidc") {
    return <p className="p-8 text-center text-slate-600">Login via OIDC ainda não implementado.</p>;
  }
  // authMode === "mock" ou ainda carregando: mostra o Dev Mode por padrão
  return <MockLogin />;
}
