import { CheckIcon, ClockIcon } from "@phosphor-icons/react";
import { useEffect, useId, useMemo, useRef, useState, type KeyboardEvent } from "react";
import { cn } from "../../lib/cn";
import { formatMinutes } from "../../lib/reservations";
import { controlClass, describedBy, FieldShell, type FieldProps } from "./Field";

const toMinutes = (t: string) => Number(t.slice(0, 2)) * 60 + Number(t.slice(3, 5));
const fromMinutes = (m: number) => `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;

/**
 * O que a pessoa digitou, como "hh:mm": "8" → 08:00, "8h30", "8:30" e "830" → 08:30,
 * "1415" → 14:15. Devolve null quando não é um horário.
 */
export function parseTime(text: string): string | null {
  const t = text.trim().toLowerCase().replace(/\s+/g, "");
  if (!t) return null;
  let hours: number;
  let minutes: number;
  const split = t.match(/^(\d{1,2})(?:[:h.](\d{1,2})?)?$/);
  const joined = t.match(/^\d{3,4}$/);
  if (split) {
    hours = Number(split[1]);
    minutes = split[2] ? Number(split[2].padEnd(2, "0")) : 0;
  } else if (joined) {
    const d = t.padStart(4, "0");
    hours = Number(d.slice(0, 2));
    minutes = Number(d.slice(2));
  } else {
    return null;
  }
  if (hours > 23 || minutes > 59) return null;
  return fromMinutes(hours * 60 + minutes);
}

interface TimeInputProps extends FieldProps {
  value: string;
  onChange: (value: string) => void;
  required?: boolean;
  disabled?: boolean;
  id?: string;
  "aria-label"?: string;
  /** A primeira e a última opção da lista. Um horário digitado fora disso também vale. */
  from?: string;
  to?: string;
  stepMinutes?: number;
  /** Para o término: a lista começa depois deste horário e mostra a duração. */
  after?: string;
}

interface Row {
  value: string;
  note: string | null;
  /** Horário digitado que não está na lista. */
  custom?: boolean;
}

/**
 * Campo de horário: ao clicar, abre a lista de 30 em 30 minutos; dá para digitar
 * qualquer outro horário (08:15, 8h45, 1310…), que vale ao sair do campo ou com Enter.
 */
export function TimeInput({
  label,
  hint,
  error,
  containerClassName,
  value,
  onChange,
  required,
  disabled,
  id: idProp,
  "aria-label": ariaLabel,
  from = "07:00",
  to = "22:00",
  stepMinutes = 30,
  after,
}: TimeInputProps) {
  const autoId = useId();
  const id = idProp ?? autoId;
  const listId = `${id}-opcoes`;
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLUListElement>(null);
  const [text, setText] = useState(value);
  const [open, setOpen] = useState(false);
  const [typing, setTyping] = useState(false);
  const [active, setActive] = useState(-1);
  const [invalid, setInvalid] = useState(false);

  // O valor mudou por fora (rascunho carregado, outro campo): o texto acompanha.
  useEffect(() => {
    setText((current) => (parseTime(current) === value ? current : value));
    if (value) setInvalid(false);
  }, [value]);

  useEffect(() => {
    inputRef.current?.setCustomValidity(invalid ? "Digite um horário, por exemplo 08:30." : "");
  }, [invalid]);

  const afterMinutes = after && parseTime(after) ? toMinutes(parseTime(after)!) : null;
  const options = useMemo<Row[]>(() => {
    const list: Row[] = [];
    for (let m = toMinutes(from); m <= toMinutes(to); m += stepMinutes) {
      if (afterMinutes !== null && m <= afterMinutes) continue;
      list.push({ value: fromMinutes(m), note: afterMinutes !== null ? formatMinutes(m - afterMinutes) : null });
    }
    return list;
  }, [from, to, stepMinutes, afterMinutes]);

  // Digitando: a lista mostra só o que começa com os números digitados ("14" → 14:00, 14:30)
  // e, se o horário digitado não está nela, oferece usar ele mesmo.
  const rows = useMemo<Row[]>(() => {
    if (!typing) return options;
    const digits = text.replace(/\D/g, "");
    const matching = digits ? options.filter((o) => o.value.replace(":", "").startsWith(digits) || o.value.replace(":", "").startsWith(`0${digits}`)) : options;
    const typed = parseTime(text);
    if (typed && !matching.some((o) => o.value === typed)) {
      const note = afterMinutes !== null && toMinutes(typed) > afterMinutes ? formatMinutes(toMinutes(typed) - afterMinutes) : null;
      return [{ value: typed, note, custom: true }, ...matching];
    }
    return matching;
  }, [typing, text, options, afterMinutes]);

  // Ao abrir sem digitar: marca o horário escolhido (ou o mais perto) e rola até ele.
  useEffect(() => {
    if (!open) return;
    if (typing) {
      setActive(rows.length ? 0 : -1);
      return;
    }
    const current = parseTime(text);
    const index = current ? rows.findIndex((r) => toMinutes(r.value) >= toMinutes(current)) : -1;
    setActive(index);
    if (index >= 0) listRef.current?.children[index]?.scrollIntoView({ block: "center" });
    else listRef.current?.scrollTo({ top: 0 });
  }, [open, typing, rows]);

  useEffect(() => {
    if (open && active >= 0) listRef.current?.children[active]?.scrollIntoView({ block: "nearest" });
  }, [open, active]);

  const choose = (v: string) => {
    setText(v);
    setInvalid(false);
    setTyping(false);
    setOpen(false);
    if (v !== value) onChange(v);
  };

  /** Fecha a lista e vale o que foi digitado. */
  const commit = () => {
    setOpen(false);
    setTyping(false);
    if (!text.trim()) {
      setInvalid(false);
      if (value) onChange("");
      return;
    }
    const parsed = parseTime(text);
    if (parsed) choose(parsed);
    else {
      setInvalid(true);
      if (value) onChange("");
    }
  };

  const onKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      if (!open) {
        setOpen(true);
        return;
      }
      const delta = e.key === "ArrowDown" ? 1 : -1;
      setActive((i) => Math.min(rows.length - 1, Math.max(0, i + delta)));
    } else if (e.key === "Enter") {
      e.preventDefault();
      const row = open ? rows[active] : undefined;
      if (row) choose(row.value);
      else commit();
    } else if (e.key === "Escape" && open) {
      e.preventDefault();
      e.stopPropagation();
      setOpen(false);
      setTyping(false);
    }
  };

  const shownError = error ?? (invalid ? "Horário inválido. Digite, por exemplo, 08:30." : undefined);
  const optionId = (i: number) => `${id}-opcao-${i}`;

  return (
    <FieldShell id={id} label={label} required={required} hint={hint} error={shownError} containerClassName={containerClassName}>
      <div className="relative">
        <input
          ref={inputRef}
          id={id}
          type="text"
          inputMode="numeric"
          autoComplete="off"
          placeholder="hh:mm"
          maxLength={8}
          role="combobox"
          aria-label={ariaLabel}
          aria-expanded={open}
          aria-controls={listId}
          aria-autocomplete="list"
          aria-activedescendant={open && active >= 0 ? optionId(active) : undefined}
          aria-invalid={shownError ? true : undefined}
          aria-describedby={describedBy(id, hint, shownError)}
          required={required}
          disabled={disabled}
          value={text}
          onChange={(e) => {
            const next = e.target.value;
            setText(next);
            setTyping(true);
            setOpen(true);
            setInvalid(false);
            // Já é um horário completo ("08:15"): vale na hora, sem esperar sair do campo.
            if (/^\d{2}:\d{2}$/.test(next) && parseTime(next) && parseTime(next) !== value) onChange(parseTime(next)!);
          }}
          onFocus={(e) => {
            e.target.select();
            setTyping(false);
            setOpen(true);
          }}
          onClick={() => setOpen(true)}
          onBlur={commit}
          onKeyDown={onKeyDown}
          className={cn(controlClass, "h-11 pr-9 tabular-nums")}
        />
        <button
          type="button"
          tabIndex={-1}
          aria-label="Mostrar os horários"
          disabled={disabled}
          onMouseDown={(e) => {
            e.preventDefault();
            if (document.activeElement !== inputRef.current) inputRef.current?.focus();
            else setOpen((o) => !o);
          }}
          className="absolute top-1/2 right-1.5 grid size-8 -translate-y-1/2 place-items-center rounded-md text-muted hover:text-foreground disabled:opacity-50"
        >
          <ClockIcon size={16} weight="bold" aria-hidden />
        </button>
        {open && !disabled && (
          <div
            className="absolute top-full left-0 z-30 mt-1 w-full min-w-44 overflow-hidden rounded-lg border border-border bg-surface shadow-lg"
            onMouseDown={(e) => e.preventDefault()}
          >
            <ul ref={listRef} id={listId} role="listbox" aria-label={typeof label === "string" ? label : ariaLabel} className="max-h-60 overflow-y-auto py-1">
              {rows.map((row, i) => {
                const selected = row.value === value;
                return (
                  <li
                    key={`${row.custom ? "digitado-" : ""}${row.value}`}
                    id={optionId(i)}
                    role="option"
                    aria-selected={selected}
                    onClick={() => choose(row.value)}
                    onMouseEnter={() => setActive(i)}
                    className={cn(
                      "flex cursor-pointer items-center gap-2 px-3 py-1.5 text-sm tabular-nums",
                      i === active ? "bg-primary/10 text-foreground" : "text-foreground",
                      selected && "font-semibold text-primary",
                    )}
                  >
                    <span>{row.custom ? `Usar ${row.value}` : row.value}</span>
                    {row.note && <span className="text-xs font-normal text-muted">{row.note}</span>}
                    {selected && <CheckIcon size={14} weight="bold" aria-hidden className="ml-auto" />}
                  </li>
                );
              })}
              {rows.length === 0 && <li className="px-3 py-2 text-sm text-muted">Nenhum horário da lista começa assim.</li>}
            </ul>
            <p className="border-t border-border px-3 py-1.5 text-xs text-muted">Outro horário? É só digitar, por exemplo 08:15.</p>
          </div>
        )}
      </div>
    </FieldShell>
  );
}
