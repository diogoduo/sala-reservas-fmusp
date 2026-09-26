import { useEffect, useState } from "react";
import { AdminPanel } from "./components/admin/AdminPanel";
import { Login } from "./components/Login";
import { RequesterPanel } from "./components/solicitante/RequesterPanel";
import { api } from "./lib/api";
import { useAuth } from "./lib/auth";

interface Health {
  status: string;
  database: string;
}

function Dashboard() {
  const { user, logout } = useAuth();
  const [health, setHealth] = useState<Health | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api<Health>("/health").then(setHealth).catch((e: Error) => setError(e.message));
  }, []);

  return (
    <main className="mx-auto max-w-4xl p-8">
      <header className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold">Reserva de Salas — FMUSP</h1>
          <p className="text-sm text-slate-500">
            {user?.name} · {user?.email} · {user?.role === "ADMIN" ? "Administrador" : "Solicitante"}
          </p>
        </div>
        <button onClick={() => void logout()} className="rounded-md border border-slate-300 px-3 py-1.5 text-sm">
          Sair
        </button>
      </header>

      <section className="mt-6 rounded-lg border border-slate-200 p-4">
        <h2 className="font-medium">Status da API</h2>
        {error && <p className="mt-2 text-red-600">Falha ao contatar a API: {error}</p>}
        {!error && !health && <p className="mt-2 text-slate-500">Verificando…</p>}
        {health && (
          <p className="mt-2">
            API: <strong>{health.status}</strong> · Banco: <strong>{health.database}</strong>
          </p>
        )}
      </section>

      {user?.role === "ADMIN" ? (
        <AdminPanel />
      ) : (
        <RequesterPanel />
      )}
    </main>
  );
}

export default function App() {
  const { user, loading } = useAuth();

  if (loading) return <p className="p-8 text-center text-slate-500">Carregando…</p>;
  return user ? <Dashboard /> : <Login />;
}
