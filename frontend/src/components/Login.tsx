import {
  ArrowRightIcon,
  BellRingingIcon,
  CodeIcon,
  ListChecksIcon,
  SignInIcon,
  SparkleIcon,
  type Icon,
} from "@phosphor-icons/react";
import { useEffect, useState } from "react";
import { api } from "../lib/api";
import { useAuth } from "../lib/auth";
import { ThemeCycleButton } from "./layout/ThemeToggle";
import { Avatar } from "./ui/Avatar";
import { Badge } from "./ui/Badge";
import { Button, Spinner } from "./ui/Button";
import { Alert } from "./ui/Feedback";
import { Input } from "./ui/Field";
import { Logo } from "./ui/Logo";
import { Card } from "./ui/Surface";

interface MockUser {
  id: string;
  name: string;
  email: string;
  role: "USER" | "ADMIN";
}

const HIGHLIGHTS: { icon: Icon; title: string; text: string }[] = [
  { icon: ListChecksIcon, title: "Formulário certo para cada atividade", text: "Graduação, pós, extensão, concursos e defesas." },
  { icon: SparkleIcon, title: "A sala mais adequada", text: "A Secretaria aloca pela capacidade, agenda e recursos." },
  { icon: BellRingingIcon, title: "Avisos por e-mail", text: "Você sabe na hora quando o pedido é aprovado." },
];

/** Tela de login do "Dev Mode": escolher uma conta de teste ou digitar um e-mail @usp.br novo. */
function MockLogin() {
  const { refresh } = useAuth();
  const [users, setUsers] = useState<MockUser[] | null>(null);
  const [email, setEmail] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pendingEmail, setPendingEmail] = useState<string | null>(null);

  useEffect(() => {
    api<{ users: MockUser[] }>("/auth/mock/users")
      .then((res) => setUsers(res.users))
      .catch(() => setUsers([]));
  }, []);

  async function login(targetEmail: string) {
    setPendingEmail(targetEmail);
    setError(null);
    try {
      await api("/auth/mock/login", { method: "POST", body: JSON.stringify({ email: targetEmail }) });
      await refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Falha ao entrar.");
      setPendingEmail(null);
    }
  }

  return (
    <>
      <div className="flex flex-wrap items-center gap-2">
        <h1 className="text-2xl font-bold tracking-tight sm:text-3xl">Entrar</h1>
        <Badge tone="warning" icon={CodeIcon}>
          Dev Mode
        </Badge>
      </div>
      <p className="mt-2 text-sm text-muted">
        Simula a Senha Única USP para desenvolvimento local. Escolha uma conta de teste:
      </p>

      <ul className="mt-6 space-y-2">
        {users === null &&
          Array.from({ length: 4 }, (_, i) => <li key={i} className="h-[4.25rem] animate-pulse rounded-xl bg-surface-muted" />)}
        {users?.map((u, i) => (
          <li key={u.id} className="animate-fade-in-up" style={{ animationDelay: `${i * 40}ms` }}>
            <button
              type="button"
              disabled={pendingEmail !== null}
              onClick={() => void login(u.email)}
              className="group flex w-full items-center gap-3 rounded-xl border border-border bg-surface p-3 text-left transition-[border-color,box-shadow,background-color] duration-150 hover:border-primary/50 hover:bg-primary-soft/40 hover:shadow-sm disabled:opacity-60"
            >
              <Avatar name={u.name} />
              <div className="min-w-0 flex-1">
                {/* Nome e papel quebram de linha no celular em vez de cortar o nome. */}
                <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                  <p className="font-semibold">{u.name}</p>
                  <Badge tone={u.role === "ADMIN" ? "primary" : "neutral"}>{u.role === "ADMIN" ? "Admin" : "Solicitante"}</Badge>
                </div>
                <p className="truncate text-sm text-muted">{u.email}</p>
              </div>
              {pendingEmail === u.email ? (
                <Spinner className="text-primary" />
              ) : (
                <ArrowRightIcon
                  size={18}
                  aria-hidden
                  className="text-muted transition-transform duration-150 group-hover:translate-x-0.5 group-hover:text-primary"
                />
              )}
            </button>
          </li>
        ))}
      </ul>

      <div className="my-6 flex items-center gap-3 text-xs text-muted">
        <span className="h-px flex-1 bg-border" />
        ou simule o primeiro acesso de um e-mail novo
        <span className="h-px flex-1 bg-border" />
      </div>

      <form
        onSubmit={(e) => {
          e.preventDefault();
          void login(email);
        }}
        className="flex flex-col gap-2 sm:flex-row sm:items-end"
      >
        <Input
          label="E-mail USP"
          type="email"
          autoComplete="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          placeholder="nome@usp.br"
          containerClassName="flex-1"
        />
        <Button type="submit" disabled={!email} loading={pendingEmail === email && email !== ""} iconRight={SignInIcon}>
          Entrar
        </Button>
      </form>

      {error && (
        <Alert tone="danger" className="mt-4">
          {error}
        </Alert>
      )}
    </>
  );
}

/** Login real: redireciona para o back-end, que conduz o fluxo OAuth 1.0a com a USP. */
function SenhaUnicaLogin() {
  return (
    <>
      <h1 className="text-2xl font-bold tracking-tight sm:text-3xl">Entrar</h1>
      <p className="mt-2 text-sm text-muted">Use sua conta USP para solicitar e acompanhar reservas.</p>
      <a
        href="/api/auth/senhaunica/login"
        className="mt-8 inline-flex h-12 w-full items-center justify-center gap-2 rounded-lg bg-primary px-6 font-medium text-primary-foreground shadow-sm transition-colors hover:bg-primary-hover"
      >
        <SignInIcon size={20} weight="bold" aria-hidden />
        Entrar com a Senha Única USP
      </a>
    </>
  );
}

export function Login() {
  const { authMode } = useAuth();

  return (
    <div className="min-h-dvh lg:grid lg:grid-cols-[minmax(0,5fr)_minmax(0,6fr)]">
      {/* Painel da marca (computador) */}
      <aside className="relative hidden overflow-hidden bg-linear-to-br from-teal-700 via-teal-800 to-emerald-900 p-12 text-white lg:flex lg:flex-col">
        <div
          aria-hidden
          className="absolute inset-0 opacity-20"
          style={{ backgroundImage: "radial-gradient(circle at 1px 1px, rgb(255 255 255 / 0.5) 1px, transparent 0)", backgroundSize: "24px 24px" }}
        />
        <div aria-hidden className="absolute -right-24 -bottom-24 size-96 rounded-full bg-teal-400/20 blur-3xl" />
        <Logo inverted className="relative" />
        <div className="relative mt-auto max-w-md">
          <p className="font-display text-4xl leading-tight font-bold tracking-tight text-balance">
            Reserve salas da Faculdade de Medicina em poucos cliques.
          </p>
          <ul className="mt-10 space-y-5">
            {HIGHLIGHTS.map(({ icon: HighlightIcon, title, text }) => (
              <li key={title} className="flex gap-4">
                <span className="grid size-10 shrink-0 place-items-center rounded-xl bg-white/10 ring-1 ring-white/20">
                  <HighlightIcon size={22} weight="duotone" aria-hidden />
                </span>
                <div>
                  <p className="font-semibold">{title}</p>
                  <p className="text-sm text-teal-100">{text}</p>
                </div>
              </li>
            ))}
          </ul>
        </div>
        <p className="relative mt-12 text-xs text-teal-200">Faculdade de Medicina da Universidade de São Paulo</p>
      </aside>

      <main className="flex min-h-dvh flex-col px-4 py-6 sm:px-8">
        <div className="flex items-center justify-between lg:justify-end">
          <Logo className="lg:hidden" />
          <ThemeCycleButton />
        </div>
        <div className="flex flex-1 items-center justify-center py-10">
          <Card className="w-full max-w-md animate-fade-in-up p-6 sm:p-8">
            {authMode === "senhaunica" ? (
              <SenhaUnicaLogin />
            ) : authMode === "oidc" ? (
              <Alert tone="info">Login via OIDC ainda não implementado.</Alert>
            ) : (
              // authMode === "mock" ou ainda carregando: mostra o Dev Mode por padrão
              <MockLogin />
            )}
          </Card>
        </div>
      </main>
    </div>
  );
}
