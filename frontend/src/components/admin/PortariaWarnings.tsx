import { WarningIcon } from "@phosphor-icons/react";
import { cn } from "../../lib/cn";
import type { PortariaWarning } from "../../lib/portarias";

/**
 * Avisos de regras das portarias que o SAD está passando por cima. Não
 * bloqueiam: dizem qual portaria e artigo está sendo violado.
 */
export function PortariaWarnings({
  warnings,
  title = "Fora das portarias",
  description = "Como SAD, você pode seguir mesmo assim.",
  className,
}: {
  warnings: PortariaWarning[];
  title?: string;
  description?: string;
  className?: string;
}) {
  if (warnings.length === 0) return null;
  return (
    <div role="status" className={cn("rounded-xl border border-warning-foreground/30 bg-warning-soft p-4 text-sm text-warning-foreground", className)}>
      <p className="flex items-center gap-2 font-semibold">
        <WarningIcon size={18} weight="fill" className="shrink-0" aria-hidden />
        {title}
      </p>
      {description && <p className="mt-0.5 text-xs opacity-90">{description}</p>}
      <ul className="mt-2.5 space-y-1.5">
        {warnings.map((w) => (
          <li key={`${w.rule}-${w.message}`}>
            <strong className="font-semibold">{w.rule}:</strong> {w.message}
          </li>
        ))}
      </ul>
    </div>
  );
}
