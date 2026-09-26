import { CheckCircleIcon, InfoIcon, WarningCircleIcon, WarningIcon, type Icon } from "@phosphor-icons/react";
import type { ReactNode } from "react";
import { cn } from "../../lib/cn";
import { TONE_CLASSES } from "./Badge";

type AlertTone = "info" | "success" | "warning" | "danger";

const ALERT_ICONS: Record<AlertTone, Icon> = {
  info: InfoIcon,
  success: CheckCircleIcon,
  warning: WarningIcon,
  danger: WarningCircleIcon,
};

interface AlertProps {
  tone?: AlertTone;
  title?: ReactNode;
  children?: ReactNode;
  className?: string;
}

/** Aviso dentro da página. Erros usam role="alert" para serem anunciados na hora. */
export function Alert({ tone = "info", title, children, className }: AlertProps) {
  const IconComponent = ALERT_ICONS[tone];
  return (
    <div role={tone === "danger" ? "alert" : undefined} className={cn("flex gap-3 rounded-xl p-4 text-sm", TONE_CLASSES[tone], className)}>
      <IconComponent size={20} weight="fill" className="mt-px shrink-0" aria-hidden />
      <div className="min-w-0 space-y-1">
        {title && <p className="font-semibold">{title}</p>}
        {children && <div className="leading-relaxed">{children}</div>}
      </div>
    </div>
  );
}

interface EmptyStateProps {
  icon: Icon;
  title: string;
  description?: ReactNode;
  action?: ReactNode;
  className?: string;
}

export function EmptyState({ icon: IconComponent, title, description, action, className }: EmptyStateProps) {
  return (
    <div
      className={cn(
        "flex animate-fade-in flex-col items-center rounded-2xl border border-dashed border-border-strong px-6 py-12 text-center",
        className,
      )}
    >
      <span className="grid size-14 place-items-center rounded-2xl bg-primary-soft text-primary-soft-foreground">
        <IconComponent size={28} weight="duotone" aria-hidden />
      </span>
      <h3 className="mt-4 text-base font-semibold">{title}</h3>
      {description && <p className="mt-1 max-w-sm text-sm text-muted">{description}</p>}
      {action && <div className="mt-5">{action}</div>}
    </div>
  );
}

export function Skeleton({ className }: { className?: string }) {
  return <div aria-hidden className={cn("animate-pulse rounded-lg bg-surface-muted", className)} />;
}

/** Placeholder de uma lista de cards enquanto carrega (evita a tela "pular"). */
export function CardListSkeleton({ count = 3 }: { count?: number }) {
  return (
    <div className="space-y-3" role="status" aria-label="Carregando">
      {Array.from({ length: count }, (_, i) => (
        <div key={i} className="rounded-2xl border border-border bg-surface p-5">
          <div className="flex items-center gap-4">
            <Skeleton className="size-11 rounded-xl" />
            <div className="flex-1 space-y-2">
              <Skeleton className="h-4 w-1/3" />
              <Skeleton className="h-3 w-1/2" />
            </div>
          </div>
          <Skeleton className="mt-4 h-3 w-4/5" />
        </div>
      ))}
    </div>
  );
}
