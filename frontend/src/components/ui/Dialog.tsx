import { XIcon } from "@phosphor-icons/react";
import { useEffect, useId, useRef, type ReactNode } from "react";
import { cn } from "../../lib/cn";
import { IconButton } from "./Button";

interface DialogProps {
  open: boolean;
  onClose: () => void;
  title: ReactNode;
  description?: ReactNode;
  children?: ReactNode;
  /** Ações fixas no rodapé (sempre visíveis, mesmo com o conteúdo rolando). */
  footer?: ReactNode;
  /** "modal" centralizado, ou "drawer": painel lateral (tela cheia no celular). */
  variant?: "modal" | "drawer";
  size?: "sm" | "md" | "lg";
}

const MODAL_SIZES = { sm: "max-w-md", md: "max-w-lg", lg: "max-w-2xl" };

/**
 * Diálogo/painel sobre o <dialog> nativo: Esc fecha, o foco fica preso dentro
 * dele e o resto da página fica inerte enquanto está aberto. Clicar no fundo
 * também fecha.
 */
export function Dialog({ open, onClose, title, description, children, footer, variant = "modal", size = "md" }: DialogProps) {
  const ref = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  const descriptionId = useId();

  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    if (open && !dialog.open) {
      dialog.showModal();
      // O autoFocus do React roda antes do showModal (diálogo ainda invisível);
      // quem quiser o foco inicial marca o elemento com data-autofocus.
      dialog.querySelector<HTMLElement>("[data-autofocus]")?.focus();
    }
    if (!open && dialog.open) dialog.close();
  }, [open]);

  return (
    <dialog
      ref={ref}
      aria-labelledby={titleId}
      aria-describedby={description ? descriptionId : undefined}
      onCancel={(event) => {
        event.preventDefault();
        onClose();
      }}
      onClick={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
      className={cn(
        "bg-surface p-0 text-foreground shadow-2xl shadow-slate-950/20",
        variant === "modal"
          ? cn("m-auto max-h-[85dvh] w-[calc(100%-2rem)] rounded-2xl border border-border open:animate-scale-in", MODAL_SIZES[size])
          : "my-0 mr-0 ml-auto h-dvh max-h-none w-full max-w-none border-border open:animate-slide-in-right sm:w-[36rem] sm:border-l",
      )}
    >
      {open && (
        <div className={cn("flex flex-col", variant === "drawer" ? "h-full" : "max-h-[85dvh]")}>
          <header className="flex items-start justify-between gap-4 border-b border-border px-5 py-4 sm:px-6">
            <div className="min-w-0 pt-1">
              <h2 id={titleId} className="text-lg leading-tight font-semibold">
                {title}
              </h2>
              {description && (
                <div id={descriptionId} className="mt-1 text-sm text-muted">
                  {description}
                </div>
              )}
            </div>
            <IconButton icon={XIcon} label="Fechar" onClick={onClose} className="-mt-1 -mr-2" />
          </header>
          {children && <div className="flex-1 overflow-y-auto px-5 py-5 sm:px-6">{children}</div>}
          {footer && (
            <footer className="flex flex-col-reverse gap-2 border-t border-border bg-surface px-5 py-4 pb-[max(1rem,env(safe-area-inset-bottom))] sm:flex-row sm:items-center sm:justify-end sm:px-6">
              {footer}
            </footer>
          )}
        </div>
      )}
    </dialog>
  );
}
