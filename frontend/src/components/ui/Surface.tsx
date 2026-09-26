import type { Icon } from "@phosphor-icons/react";
import type { HTMLAttributes, ReactNode } from "react";
import { cn } from "../../lib/cn";
import { TONE_CLASSES, type Tone } from "./Badge";

export function Card({ className, children, ...props }: HTMLAttributes<HTMLDivElement>) {
  return (
    <div className={cn("rounded-2xl border border-border bg-surface shadow-sm shadow-slate-900/[0.03]", className)} {...props}>
      {children}
    </div>
  );
}

interface PageHeaderProps {
  title: ReactNode;
  description?: ReactNode;
  actions?: ReactNode;
}

export function PageHeader({ title, description, actions }: PageHeaderProps) {
  return (
    <div className="flex animate-fade-in flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
      <div className="min-w-0">
        <h1 className="text-2xl font-bold tracking-tight text-foreground sm:text-3xl">{title}</h1>
        {description && <p className="mt-1.5 max-w-2xl text-sm text-muted sm:text-base">{description}</p>}
      </div>
      {actions && <div className="flex shrink-0 flex-wrap gap-2">{actions}</div>}
    </div>
  );
}

interface StatCardProps {
  label: string;
  value: ReactNode;
  icon: Icon;
  tone?: Tone;
  hint?: ReactNode;
}

export function StatCard({ label, value, icon: IconComponent, tone = "primary", hint }: StatCardProps) {
  return (
    <Card className="flex items-center gap-4 p-4">
      <span className={cn("grid size-11 shrink-0 place-items-center rounded-xl", TONE_CLASSES[tone])}>
        <IconComponent size={22} weight="duotone" aria-hidden />
      </span>
      <div className="min-w-0">
        <p className="text-2xl leading-none font-bold tabular-nums">{value}</p>
        <p className="mt-1 text-sm leading-snug text-muted">{label}</p>
        {hint && <p className="text-xs text-muted">{hint}</p>}
      </div>
    </Card>
  );
}

/** Quadrado colorido com um ícone — identidade visual de atividades, salas e recursos. */
export function IconTile({ icon: IconComponent, tone = "primary", size = "md" }: { icon: Icon; tone?: Tone; size?: "sm" | "md" | "lg" }) {
  const box = { sm: "size-9 rounded-lg", md: "size-11 rounded-xl", lg: "size-14 rounded-2xl" }[size];
  const iconSize = { sm: 18, md: 22, lg: 28 }[size];
  return (
    <span className={cn("grid shrink-0 place-items-center", box, TONE_CLASSES[tone])}>
      <IconComponent size={iconSize} weight="duotone" aria-hidden />
    </span>
  );
}
