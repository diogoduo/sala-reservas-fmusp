import { CaretDownIcon, WarningCircleIcon } from "@phosphor-icons/react";
import { useId, type InputHTMLAttributes, type ReactNode, type SelectHTMLAttributes, type TextareaHTMLAttributes } from "react";
import { cn } from "../../lib/cn";

// text-base no celular (16px evita o zoom automático do iOS ao focar), text-sm a partir de sm.
const controlClass = cn(
  "w-full rounded-lg border border-border-strong bg-surface px-3 text-base text-foreground shadow-xs sm:text-sm",
  "transition-[border-color,box-shadow] duration-150 placeholder:text-muted/70",
  "focus:border-primary focus:ring-4 focus:ring-primary/15 focus:outline-none",
  "disabled:cursor-not-allowed disabled:bg-surface-muted disabled:text-muted",
  "aria-[invalid=true]:border-danger aria-[invalid=true]:focus:ring-danger/15",
);

interface FieldProps {
  label?: ReactNode;
  hint?: ReactNode;
  error?: string;
  containerClassName?: string;
}

function describedBy(id: string, hint: ReactNode, error: string | undefined) {
  if (error) return `${id}-erro`;
  return hint ? `${id}-dica` : undefined;
}

function FieldShell({
  id,
  label,
  required,
  hint,
  error,
  containerClassName,
  children,
}: FieldProps & { id: string; required?: boolean; children: ReactNode }) {
  return (
    <div className={cn("flex min-w-0 flex-col gap-1.5", containerClassName)}>
      {label && (
        <label htmlFor={id} className="text-sm font-medium text-foreground">
          {label}
          {required && (
            <span aria-hidden className="ml-0.5 text-danger-foreground">
              *
            </span>
          )}
        </label>
      )}
      {children}
      {error ? (
        <p id={`${id}-erro`} className="flex items-center gap-1 text-xs font-medium text-danger-foreground">
          <WarningCircleIcon size={14} weight="bold" aria-hidden />
          {error}
        </p>
      ) : (
        hint && (
          <p id={`${id}-dica`} className="text-xs text-muted">
            {hint}
          </p>
        )
      )}
    </div>
  );
}

type InputProps = FieldProps & InputHTMLAttributes<HTMLInputElement>;

export function Input({ label, hint, error, containerClassName, className, id: idProp, ...props }: InputProps) {
  const autoId = useId();
  const id = idProp ?? autoId;
  return (
    <FieldShell id={id} label={label} required={props.required} hint={hint} error={error} containerClassName={containerClassName}>
      <input
        id={id}
        aria-invalid={error ? true : undefined}
        aria-describedby={describedBy(id, hint, error)}
        className={cn(controlClass, "h-11", className)}
        {...props}
      />
    </FieldShell>
  );
}

type SelectProps = FieldProps & SelectHTMLAttributes<HTMLSelectElement>;

export function Select({ label, hint, error, containerClassName, className, id: idProp, children, ...props }: SelectProps) {
  const autoId = useId();
  const id = idProp ?? autoId;
  return (
    <FieldShell id={id} label={label} required={props.required} hint={hint} error={error} containerClassName={containerClassName}>
      <div className="relative">
        <select
          id={id}
          aria-invalid={error ? true : undefined}
          aria-describedby={describedBy(id, hint, error)}
          className={cn(controlClass, "h-11 appearance-none pr-10", className)}
          {...props}
        >
          {children}
        </select>
        <CaretDownIcon
          size={16}
          weight="bold"
          aria-hidden
          className="pointer-events-none absolute top-1/2 right-3 -translate-y-1/2 text-muted"
        />
      </div>
    </FieldShell>
  );
}

type TextareaProps = FieldProps & TextareaHTMLAttributes<HTMLTextAreaElement>;

export function Textarea({ label, hint, error, containerClassName, className, id: idProp, ...props }: TextareaProps) {
  const autoId = useId();
  const id = idProp ?? autoId;
  return (
    <FieldShell id={id} label={label} required={props.required} hint={hint} error={error} containerClassName={containerClassName}>
      <textarea
        id={id}
        aria-invalid={error ? true : undefined}
        aria-describedby={describedBy(id, hint, error)}
        className={cn(controlClass, "min-h-24 py-2.5 leading-relaxed", className)}
        {...props}
      />
    </FieldShell>
  );
}

interface SwitchProps {
  checked: boolean;
  onChange: (checked: boolean) => void;
  label: ReactNode;
  description?: ReactNode;
  disabled?: boolean;
}

/** Liga/desliga com role="switch" — para opções que valem na hora (ex.: "Repetir esta reserva"). */
export function Switch({ checked, onChange, label, description, disabled }: SwitchProps) {
  const id = useId();
  return (
    <div className="flex items-start justify-between gap-4">
      <div className="min-w-0">
        <label htmlFor={id} className="text-sm font-medium text-foreground">
          {label}
        </label>
        {description && <p className="mt-0.5 text-xs text-muted">{description}</p>}
      </div>
      <button
        id={id}
        type="button"
        role="switch"
        aria-checked={checked}
        disabled={disabled}
        onClick={() => onChange(!checked)}
        className={cn(
          "relative inline-flex h-7 w-12 shrink-0 items-center rounded-full transition-colors duration-200 disabled:opacity-50",
          checked ? "bg-primary" : "bg-border-strong",
        )}
      >
        <span
          aria-hidden
          className={cn(
            "inline-block size-5 rounded-full bg-white shadow-sm transition-transform duration-200",
            checked ? "translate-x-6" : "translate-x-1",
          )}
        />
      </button>
    </div>
  );
}
