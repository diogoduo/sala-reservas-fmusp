import type { Icon } from "@phosphor-icons/react";
import type { ReactNode } from "react";
import { cn } from "../../lib/cn";

export type Tone = "neutral" | "primary" | "success" | "warning" | "danger" | "info";

export const TONE_CLASSES: Record<Tone, string> = {
  neutral: "bg-neutral-soft text-neutral-foreground",
  primary: "bg-primary-soft text-primary-soft-foreground",
  success: "bg-success-soft text-success-foreground",
  warning: "bg-warning-soft text-warning-foreground",
  danger: "bg-danger-soft text-danger-foreground",
  info: "bg-info-soft text-info-foreground",
};

interface BadgeProps {
  tone?: Tone;
  icon?: Icon;
  children: ReactNode;
  className?: string;
}

/** Selo de status/categoria. Sempre com texto (e ícone), nunca só cor. */
export function Badge({ tone = "neutral", icon: IconComponent, children, className }: BadgeProps) {
  return (
    <span
      className={cn(
        "inline-flex shrink-0 items-center gap-1 rounded-full px-2.5 py-1 text-xs leading-none font-medium whitespace-nowrap",
        TONE_CLASSES[tone],
        className,
      )}
    >
      {IconComponent && <IconComponent size={14} weight="bold" aria-hidden />}
      {children}
    </span>
  );
}
