import { CheckCircleIcon, InfoIcon, WarningCircleIcon, XIcon } from "@phosphor-icons/react";
import { createContext, useCallback, useContext, useMemo, useRef, useState, type ReactNode } from "react";
import { cn } from "./cn";

type ToastTone = "success" | "error" | "info";

interface ToastItem {
  id: number;
  tone: ToastTone;
  title: string;
  description?: string;
}

interface ToastApi {
  success: (title: string, description?: string) => void;
  error: (title: string, description?: string) => void;
  info: (title: string, description?: string) => void;
}

const ToastContext = createContext<ToastApi | null>(null);

const TONES = {
  success: { icon: CheckCircleIcon, className: "text-success-foreground" },
  error: { icon: WarningCircleIcon, className: "text-danger-foreground" },
  info: { icon: InfoIcon, className: "text-info-foreground" },
} as const;

/**
 * Avisos flutuantes para o resultado de uma ação (aprovou, cancelou, falhou…).
 * Somem sozinhos (erros ficam mais tempo), não roubam o foco e são anunciados
 * por leitores de tela via aria-live.
 */
export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<ToastItem[]>([]);
  const nextId = useRef(0);

  const dismiss = useCallback((id: number) => setToasts((list) => list.filter((t) => t.id !== id)), []);

  const push = useCallback(
    (tone: ToastTone, title: string, description?: string) => {
      const id = ++nextId.current;
      setToasts((list) => [...list.slice(-2), { id, tone, title, description }]);
      window.setTimeout(() => dismiss(id), tone === "error" ? 7000 : 4500);
    },
    [dismiss],
  );

  const api = useMemo<ToastApi>(
    () => ({
      success: (title, description) => push("success", title, description),
      error: (title, description) => push("error", title, description),
      info: (title, description) => push("info", title, description),
    }),
    [push],
  );

  return (
    <ToastContext.Provider value={api}>
      {children}
      <div
        aria-live="polite"
        className="pointer-events-none fixed inset-x-0 top-0 z-[100] flex flex-col items-center gap-2 p-4 sm:inset-x-auto sm:top-auto sm:right-0 sm:bottom-0 sm:items-end sm:p-6"
      >
        {toasts.map((toast) => {
          const { icon: Icon, className } = TONES[toast.tone];
          return (
            <div
              key={toast.id}
              role="status"
              className="pointer-events-auto flex w-full max-w-sm animate-fade-in-up items-start gap-3 rounded-xl border border-border bg-surface p-4 shadow-lg shadow-slate-900/10"
            >
              <Icon size={22} weight="fill" className={cn("mt-px shrink-0", className)} aria-hidden />
              <div className="min-w-0 flex-1">
                <p className="text-sm font-semibold text-foreground">{toast.title}</p>
                {toast.description && <p className="mt-0.5 text-sm text-muted">{toast.description}</p>}
              </div>
              <button
                type="button"
                onClick={() => dismiss(toast.id)}
                aria-label="Fechar aviso"
                className="-m-1 grid size-8 shrink-0 place-items-center rounded-md text-muted transition-colors hover:bg-surface-muted hover:text-foreground"
              >
                <XIcon size={16} aria-hidden />
              </button>
            </div>
          );
        })}
      </div>
    </ToastContext.Provider>
  );
}

export function useToast(): ToastApi {
  const ctx = useContext(ToastContext);
  if (!ctx) throw new Error("useToast precisa estar dentro de <ToastProvider>");
  return ctx;
}
