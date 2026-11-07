import { ArrowsInSimpleIcon, ArrowsOutSimpleIcon, XIcon } from "@phosphor-icons/react";
import { useEffect, useId, useRef, useState, type CSSProperties, type KeyboardEvent, type PointerEvent, type ReactNode } from "react";
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

// Painel lateral com largura ajustável: arrastando a borda esquerda, pelas setas
// do teclado nessa borda ou pelo botão de ampliar. A largura escolhida fica
// guardada neste navegador e vale para todos os painéis.
const DRAWER_WIDTH_KEY = "painel-lateral-largura";
const DRAWER_MIN = 420;
const DRAWER_WIDE = 1100;
const DRAWER_STEP = 64;

const clampWidth = (px: number) => Math.round(Math.max(DRAWER_MIN, Math.min(px, window.innerWidth)));

function savedDrawerWidth(): number | null {
  try {
    const value = Number(localStorage.getItem(DRAWER_WIDTH_KEY));
    return Number.isFinite(value) && value >= DRAWER_MIN ? value : null;
  } catch {
    return null;
  }
}

function saveDrawerWidth(px: number | null) {
  try {
    if (px === null) localStorage.removeItem(DRAWER_WIDTH_KEY);
    else localStorage.setItem(DRAWER_WIDTH_KEY, String(px));
  } catch {
    // Sem acesso ao armazenamento: a largura vale só até fechar.
  }
}

/**
 * Diálogo/painel sobre o <dialog> nativo: Esc fecha, o foco fica preso dentro
 * dele e o resto da página fica inerte enquanto está aberto. Clicar no fundo
 * também fecha.
 */
export function Dialog({ open, onClose, title, description, children, footer, variant = "modal", size = "md" }: DialogProps) {
  const ref = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  const descriptionId = useId();
  const drawer = variant === "drawer";
  // null = largura padrão (36rem).
  const [width, setWidth] = useState<number | null>(() => (drawer ? savedDrawerWidth() : null));
  // Soltar o mouse fora do painel depois de arrastar não pode contar como "clicar no fundo".
  const justResized = useRef(false);

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

  function applyWidth(px: number | null) {
    setWidth(px);
    saveDrawerWidth(px);
  }

  function startResize(event: PointerEvent<HTMLDivElement>) {
    event.preventDefault();
    const handle = event.currentTarget;
    handle.setPointerCapture(event.pointerId);
    let latest = width;
    const move = (e: globalThis.PointerEvent) => {
      latest = clampWidth(window.innerWidth - e.clientX);
      setWidth(latest);
    };
    const stop = () => {
      handle.removeEventListener("pointermove", move);
      handle.removeEventListener("pointerup", stop);
      handle.removeEventListener("pointercancel", stop);
      saveDrawerWidth(latest);
      justResized.current = true;
      setTimeout(() => (justResized.current = false), 0);
    };
    handle.addEventListener("pointermove", move);
    handle.addEventListener("pointerup", stop);
    handle.addEventListener("pointercancel", stop);
  }

  function resizeWithKeys(event: KeyboardEvent<HTMLDivElement>) {
    const current = width ?? ref.current?.offsetWidth ?? 576;
    if (event.key === "ArrowLeft") applyWidth(clampWidth(current + DRAWER_STEP));
    else if (event.key === "ArrowRight") applyWidth(clampWidth(current - DRAWER_STEP));
    else return;
    event.preventDefault();
  }

  const wide = width !== null && width >= Math.min(DRAWER_WIDE, window.innerWidth) - 1;

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
        if (event.target === event.currentTarget && !justResized.current) onClose();
      }}
      style={drawer ? ({ "--drawer-w": width === null ? "36rem" : `min(${width}px, 100vw)` } as CSSProperties) : undefined}
      className={cn(
        "bg-surface p-0 text-foreground shadow-2xl shadow-slate-950/20",
        variant === "modal"
          ? cn("m-auto max-h-[85dvh] w-[calc(100%-2rem)] rounded-2xl border border-border open:animate-scale-in", MODAL_SIZES[size])
          : "my-0 mr-0 ml-auto h-dvh max-h-none w-full max-w-none border-border open:animate-slide-in-right sm:w-(--drawer-w) sm:border-l",
      )}
    >
      {open && drawer && (
        <div
          role="separator"
          aria-orientation="vertical"
          aria-label="Ajustar a largura do painel (setas para os lados)"
          aria-valuenow={width ?? undefined}
          aria-valuemin={DRAWER_MIN}
          aria-valuemax={window.innerWidth}
          tabIndex={0}
          onPointerDown={startResize}
          onKeyDown={resizeWithKeys}
          onDoubleClick={() => applyWidth(null)}
          title="Arraste para ajustar a largura · duplo clique volta ao padrão"
          className="group absolute inset-y-0 left-0 z-10 hidden w-3 cursor-col-resize touch-none focus-visible:outline-none sm:block"
        >
          <span className="absolute inset-y-0 left-0 w-1 bg-transparent transition-colors group-hover:bg-primary/40 group-focus-visible:bg-primary group-active:bg-primary" />
          {/* Alça sempre visível, para mostrar que a borda arrasta. */}
          <span className="absolute top-1/2 left-1 h-10 w-1 -translate-y-1/2 rounded-full bg-border transition-colors group-hover:bg-primary" />
        </div>
      )}
      {open && (
        <div className={cn("flex flex-col", drawer ? "h-full" : "max-h-[85dvh]")}>
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
            <div className="-mt-1 -mr-2 flex shrink-0 items-center gap-1">
              {drawer && (
                <IconButton
                  icon={wide ? ArrowsInSimpleIcon : ArrowsOutSimpleIcon}
                  label={wide ? "Voltar o painel ao tamanho normal" : "Ampliar o painel"}
                  onClick={() => applyWidth(wide ? null : clampWidth(DRAWER_WIDE))}
                  className="hidden sm:inline-flex"
                />
              )}
              <IconButton icon={XIcon} label="Fechar" onClick={onClose} />
            </div>
          </header>
          {/* `relative`: inputs `sr-only` (position: absolute) dentro do conteúdo ficam presos
              aqui e não esticam o <dialog> — sem isso o painel inteiro rolava junto. */}
          {children && <div className="relative min-h-0 flex-1 overflow-y-auto px-5 py-5 sm:px-6">{children}</div>}
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
