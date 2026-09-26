import type { Icon } from "@phosphor-icons/react";
import { cn } from "../../lib/cn";

interface Option<T extends string> {
  value: T;
  label: string;
  count?: number;
  icon?: Icon;
}

interface SegmentedControlProps<T extends string> {
  value: T;
  onChange: (value: T) => void;
  options: Option<T>[];
  label: string;
  className?: string;
}

/** Filtro de opções exclusivas (ex.: Pendentes/Aprovadas). Rola na horizontal se não couber. */
export function SegmentedControl<T extends string>({ value, onChange, options, label, className }: SegmentedControlProps<T>) {
  return (
    <div role="group" aria-label={label} className={cn("max-w-full overflow-x-auto scrollbar-none", className)}>
      <div className="inline-flex gap-1 rounded-xl bg-surface-muted p-1">
        {options.map((option) => {
          const active = option.value === value;
          const OptionIcon = option.icon;
          return (
            <button
              key={option.value}
              type="button"
              aria-pressed={active}
              onClick={() => onChange(option.value)}
              className={cn(
                "inline-flex h-9 shrink-0 items-center gap-2 rounded-lg px-3 text-sm font-medium transition-[background-color,color,box-shadow] duration-150",
                active ? "bg-surface text-foreground shadow-sm" : "text-muted hover:text-foreground",
              )}
            >
              {OptionIcon && <OptionIcon size={16} weight={active ? "fill" : "regular"} aria-hidden />}
              {option.label}
              {option.count !== undefined && (
                <span
                  className={cn(
                    "min-w-6 rounded-full px-1.5 py-0.5 text-xs tabular-nums",
                    active ? "bg-primary-soft text-primary-soft-foreground" : "bg-surface text-muted",
                  )}
                >
                  {option.count}
                </span>
              )}
            </button>
          );
        })}
      </div>
    </div>
  );
}
