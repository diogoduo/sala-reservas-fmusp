import { cn } from "../../lib/cn";

/** Marca do sistema: calendário com check (mesmo desenho do favicon). */
export function LogoMark({ className, inverted = false }: { className?: string; inverted?: boolean }) {
  return (
    <svg viewBox="0 0 64 64" aria-hidden className={cn("size-10 shrink-0", className)}>
      {/* Sobre fundo verde (inverted), um quadrado translúcido; senão, o verde da marca. */}
      <rect width="64" height="64" rx="16" className={inverted ? "fill-white/15" : "fill-teal-700 dark:fill-teal-500"} />
      <rect x="15" y="18" width="34" height="30" rx="5" fill="none" stroke="#fff" strokeWidth="4" />
      <path d="M15 27h34M24 13v9M40 13v9" stroke="#fff" strokeWidth="4" strokeLinecap="round" />
      <path d="m25 37 5 5 9-9" fill="none" stroke="#99f6e4" strokeWidth="4" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

export function Logo({ className, inverted = false }: { className?: string; inverted?: boolean }) {
  return (
    <div className={cn("flex items-center gap-3", className)}>
      <LogoMark inverted={inverted} />
      <div className="leading-tight">
        <p className={cn("font-display text-base font-bold", inverted ? "text-white" : "text-foreground")}>Reserva de Salas</p>
        <p className={cn("text-xs font-medium", inverted ? "text-teal-100" : "text-muted")}>Faculdade de Medicina · USP</p>
      </div>
    </div>
  );
}
