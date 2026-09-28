import { LockKeyIcon, SignInIcon } from "@phosphor-icons/react";
import { useEffect, useState, type FormEvent, type ReactNode } from "react";
import { ACCESS_REQUIRED_EVENT, api, ApiError } from "../lib/api";
import { ThemeCycleButton } from "./layout/ThemeToggle";
import { Button } from "./ui/Button";
import { Input } from "./ui/Field";
import { Logo } from "./ui/Logo";
import { Card, IconTile } from "./ui/Surface";

function AccessCodeScreen({ onGranted }: { onGranted: () => void }) {
  const [code, setCode] = useState("");
  const [error, setError] = useState<string | undefined>();
  const [sending, setSending] = useState(false);

  async function submit(event: FormEvent) {
    event.preventDefault();
    setSending(true);
    setError(undefined);
    try {
      await api("/access", { method: "POST", body: JSON.stringify({ code }) });
      onGranted();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Não foi possível verificar o código.");
      setSending(false);
    }
  }

  return (
    <main className="flex min-h-dvh flex-col bg-background px-4 py-6 sm:px-8">
      <div className="flex items-center justify-between">
        <Logo />
        <ThemeCycleButton />
      </div>
      <div className="flex flex-1 items-center justify-center py-10">
        <Card className="w-full max-w-sm animate-fade-in-up p-6 sm:p-8">
          <IconTile icon={LockKeyIcon} size="lg" />
          <h1 className="mt-5 text-2xl font-bold tracking-tight">Acesso restrito</h1>
          <p className="mt-2 text-sm text-muted">
            Esta é uma demonstração do sistema de reserva de salas da FMUSP. Digite o código de acesso que você recebeu.
          </p>
          <form onSubmit={(e) => void submit(e)} className="mt-6 space-y-4">
            <Input
              label="Código de acesso"
              type="password"
              autoComplete="off"
              autoFocus
              required
              value={code}
              onChange={(e) => setCode(e.target.value)}
              error={error}
            />
            <Button type="submit" icon={SignInIcon} loading={sending} className="w-full">
              Entrar
            </Button>
          </form>
        </Card>
      </div>
    </main>
  );
}

/**
 * Pede o código de acesso (ACCESS_CODE do servidor) antes de mostrar o app.
 * Sem código configurado, não aparece. Se o código mudar com o app aberto, a
 * API responde ACCESS_CODE_REQUIRED e a tela volta a pedir.
 */
export function AccessGate({ children }: { children: ReactNode }) {
  const [state, setState] = useState<"checking" | "locked" | "open">("checking");

  useEffect(() => {
    api<{ required: boolean; granted: boolean }>("/access")
      .then(({ required, granted }) => setState(!required || granted ? "open" : "locked"))
      .catch(() => setState("open"));
    const lock = () => setState("locked");
    window.addEventListener(ACCESS_REQUIRED_EVENT, lock);
    return () => window.removeEventListener(ACCESS_REQUIRED_EVENT, lock);
  }, []);

  if (state === "checking") return <div className="min-h-dvh bg-background" />;
  if (state === "locked") return <AccessCodeScreen onGranted={() => setState("open")} />;
  return <>{children}</>;
}
