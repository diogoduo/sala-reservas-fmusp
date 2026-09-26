import { MinusIcon, PlusIcon } from "@phosphor-icons/react";

interface QuantityStepperProps {
  value: string;
  onChange: (value: string) => void;
  /** Nome acessível do campo, ex.: "Quantidade de Chromebook". */
  label: string;
}

/** Campo numérico com botões − / + (dá para digitar também). */
export function QuantityStepper({ value, onChange, label }: QuantityStepperProps) {
  const n = Number(value) || 1;
  return (
    <div className="inline-flex h-10 shrink-0 items-center rounded-lg border border-border-strong bg-surface">
      <button
        type="button"
        aria-label={`Diminuir ${label.toLowerCase()}`}
        disabled={n <= 1}
        onClick={() => onChange(String(n - 1))}
        className="grid size-10 place-items-center rounded-l-lg text-muted hover:bg-surface-muted hover:text-foreground disabled:opacity-40"
      >
        <MinusIcon size={16} weight="bold" aria-hidden />
      </button>
      <input
        type="number"
        min={1}
        required
        aria-label={label}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="h-full w-14 border-x border-border-strong bg-transparent text-center text-sm font-semibold tabular-nums [appearance:textfield] focus:outline-none [&::-webkit-inner-spin-button]:appearance-none"
      />
      <button
        type="button"
        aria-label={`Aumentar ${label.toLowerCase()}`}
        onClick={() => onChange(String(n + 1))}
        className="grid size-10 place-items-center rounded-r-lg text-muted hover:bg-surface-muted hover:text-foreground"
      >
        <PlusIcon size={16} weight="bold" aria-hidden />
      </button>
    </div>
  );
}
