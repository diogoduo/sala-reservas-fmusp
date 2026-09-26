import { CircleNotchIcon, type Icon } from "@phosphor-icons/react";
import type { ButtonHTMLAttributes } from "react";
import { cn } from "../../lib/cn";

type Variant = "primary" | "secondary" | "ghost" | "danger" | "danger-soft";
type Size = "sm" | "md" | "lg";

const VARIANTS: Record<Variant, string> = {
  primary: "bg-primary text-primary-foreground shadow-sm hover:bg-primary-hover",
  secondary: "border border-border-strong bg-surface text-foreground shadow-xs hover:bg-surface-muted",
  ghost: "text-muted hover:bg-surface-muted hover:text-foreground",
  danger: "bg-danger text-white shadow-sm hover:bg-danger-hover",
  "danger-soft": "text-danger-foreground hover:bg-danger-soft",
};

// md/lg têm 44px+ de altura: alvo de toque confortável no celular.
const SIZES: Record<Size, string> = {
  sm: "h-9 gap-1.5 px-3 text-sm",
  md: "h-11 gap-2 px-4 text-sm",
  lg: "h-12 gap-2 px-6 text-base",
};

const ICON_SIZES: Record<Size, number> = { sm: 16, md: 18, lg: 20 };

export function Spinner({ size = 18, className }: { size?: number; className?: string }) {
  return <CircleNotchIcon size={size} weight="bold" className={cn("animate-spin", className)} aria-hidden />;
}

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant;
  size?: Size;
  /** Mostra um spinner e desabilita o botão durante uma ação assíncrona. */
  loading?: boolean;
  icon?: Icon;
  iconRight?: Icon;
}

export function Button({
  variant = "primary",
  size = "md",
  loading = false,
  icon: LeadingIcon,
  iconRight: TrailingIcon,
  className,
  children,
  disabled,
  type = "button",
  ...props
}: ButtonProps) {
  const iconSize = ICON_SIZES[size];
  return (
    <button
      type={type}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      className={cn(
        "inline-flex shrink-0 items-center justify-center rounded-lg font-medium whitespace-nowrap select-none",
        "transition-[background-color,color,box-shadow,transform] duration-150 active:scale-[0.98]",
        "disabled:pointer-events-none disabled:opacity-50",
        VARIANTS[variant],
        SIZES[size],
        className,
      )}
      {...props}
    >
      {loading ? <Spinner size={iconSize} /> : LeadingIcon && <LeadingIcon size={iconSize} weight="bold" aria-hidden />}
      {children}
      {TrailingIcon && !loading && <TrailingIcon size={iconSize} weight="bold" aria-hidden />}
    </button>
  );
}

interface IconButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  icon: Icon;
  /** Nome acessível — obrigatório, já que o botão não tem texto visível. */
  label: string;
  variant?: "ghost" | "secondary" | "danger-soft";
  size?: "sm" | "md";
}

export function IconButton({ icon: IconComponent, label, variant = "ghost", size = "md", className, type = "button", ...props }: IconButtonProps) {
  return (
    <button
      type={type}
      aria-label={label}
      title={label}
      className={cn(
        "inline-grid shrink-0 place-items-center rounded-lg transition-[background-color,color,transform] duration-150 active:scale-95",
        "disabled:pointer-events-none disabled:opacity-50",
        VARIANTS[variant],
        size === "md" ? "size-11" : "size-9",
        className,
      )}
      {...props}
    >
      <IconComponent size={size === "md" ? 20 : 18} aria-hidden />
    </button>
  );
}
