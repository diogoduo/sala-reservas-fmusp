import { CalculatorIcon, PlusIcon, TrashIcon } from "@phosphor-icons/react";
import { useState } from "react";
import { api, ApiError } from "../../lib/api";
import type { PriceCategory, QuoteDayInput, QuoteEstimate } from "../../lib/types";
import { QuoteBreakdown } from "../quotes/QuoteBreakdown";
import { Button, IconButton } from "../ui/Button";
import { Alert } from "../ui/Feedback";
import { Input, Select, Switch } from "../ui/Field";
import { Card } from "../ui/Surface";

interface SimItem {
  /** "c:<id>" = categoria; "r:<id>" = sala específica. */
  ref: string;
  count: string;
  coffeeInRoom: boolean;
}

const inDays = (n: number) => new Date(Date.now() + n * 86_400_000).toLocaleDateString("en-CA");

/**
 * Simulador de orçamento (Fase 10): o SAD e o NUCEV montam um evento de teste
 * (dias, espaços, coffee, desconto, isenção) e veem o cálculo da Portaria 2794.
 */
export function QuoteSimulator({ categories }: { categories: PriceCategory[] }) {
  // Começa pela categoria com mais espaços (as salas de aula).
  const firstDidactic = [...categories].sort((x, y) => y.rooms.length - x.rooms.length)[0];
  const [days, setDays] = useState<QuoteDayInput[]>([{ date: inDays(30), start: "08:00", end: "18:00" }]);
  const [items, setItems] = useState<SimItem[]>(firstDidactic ? [{ ref: `c:${firstDidactic.id}`, count: "1", coffeeInRoom: false }] : []);
  const [institutional, setInstitutional] = useState(false);
  const [exempt, setExempt] = useState(false);
  const [reason, setReason] = useState("");
  const [estimate, setEstimate] = useState<QuoteEstimate | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const rooms = categories.flatMap((c) => c.rooms.filter((r) => r.status === "ACTIVE")).sort((a, b) => a.name.localeCompare(b.name, "pt-BR"));
  const setDay = (i: number, patch: Partial<QuoteDayInput>) => setDays((all) => all.map((d, j) => (j === i ? { ...d, ...patch } : d)));
  const setItem = (i: number, patch: Partial<SimItem>) => setItems((all) => all.map((it, j) => (j === i ? { ...it, ...patch } : it)));

  async function calculate() {
    setLoading(true);
    setError(null);
    try {
      const res = await api<QuoteEstimate>("/quotes/estimate", {
        method: "POST",
        body: JSON.stringify({
          days,
          items: items.map((it) => ({
            ...(it.ref.startsWith("c:") ? { categoryId: it.ref.slice(2) } : { roomId: it.ref.slice(2) }),
            count: Math.max(1, Number(it.count) || 1),
            coffeeInRoom: it.ref.startsWith("r:") && it.coffeeInRoom,
          })),
          institutional,
          exemptionReason: exempt ? reason : undefined,
        }),
      });
      setEstimate(res);
    } catch (e) {
      setEstimate(null);
      setError(e instanceof ApiError ? e.message : "Não foi possível calcular.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <Card className="p-4 sm:p-6">
      <h2 className="text-lg font-semibold">Simular orçamento</h2>
      <p className="text-sm text-muted">Monte um evento de teste e veja o cálculo pela tabela que vale na data. Nada é gravado.</p>

      <section className="mt-5">
        <h3 className="text-sm font-semibold">Dias do evento</h3>
        <p className="text-xs text-muted">Horário de uso dos espaços em cada dia, já com a montagem e a desmontagem.</p>
        <ul className="mt-2 space-y-2">
          {days.map((d, i) => (
            <li key={i} className="flex flex-wrap items-end gap-2">
              <Input label={i === 0 ? "Data" : undefined} aria-label={`Data do dia ${i + 1}`} type="date" value={d.date} onChange={(e) => setDay(i, { date: e.target.value })} containerClassName="w-40" />
              <Input label={i === 0 ? "Início" : undefined} aria-label={`Início do dia ${i + 1}`} type="time" step={900} value={d.start} onChange={(e) => setDay(i, { start: e.target.value })} containerClassName="w-28" />
              <Input label={i === 0 ? "Término" : undefined} aria-label={`Término do dia ${i + 1}`} type="time" step={900} value={d.end} onChange={(e) => setDay(i, { end: e.target.value })} containerClassName="w-28" />
              {days.length > 1 && <IconButton icon={TrashIcon} label={`Tirar o dia ${i + 1}`} onClick={() => setDays((all) => all.filter((_, j) => j !== i))} />}
            </li>
          ))}
        </ul>
        <Button
          variant="ghost"
          size="sm"
          icon={PlusIcon}
          className="mt-2"
          onClick={() => {
            const last = days.at(-1)!;
            const next = new Date(`${last.date}T12:00:00`);
            next.setDate(next.getDate() + 1);
            setDays([...days, { ...last, date: next.toLocaleDateString("en-CA") }]);
          }}
        >
          Mais um dia
        </Button>
      </section>

      <section className="mt-5">
        <h3 className="text-sm font-semibold">Espaços</h3>
        <ul className="mt-2 space-y-3">
          {items.map((it, i) => (
            <li key={i} className="space-y-2 rounded-xl border border-border p-3">
              <div className="flex flex-wrap items-end gap-2">
                <Select label="Espaço" value={it.ref} onChange={(e) => setItem(i, { ref: e.target.value })} containerClassName="min-w-0 flex-1 basis-64">
                  <optgroup label="Por categoria">
                    {categories.map((c) => (
                      <option key={c.id} value={`c:${c.id}`}>
                        {c.name}
                      </option>
                    ))}
                  </optgroup>
                  <optgroup label="Sala ou espaço específico">
                    {rooms.map((r) => (
                      <option key={r.id} value={`r:${r.id}`}>
                        {r.name}
                      </option>
                    ))}
                  </optgroup>
                </Select>
                <Input label="Quantidade" type="number" inputMode="numeric" min={1} value={it.count} onChange={(e) => setItem(i, { count: e.target.value })} containerClassName="w-28" />
                {items.length > 1 && <IconButton icon={TrashIcon} label="Tirar este espaço" onClick={() => setItems((all) => all.filter((_, j) => j !== i))} />}
              </div>
              {it.ref.startsWith("r:") && (
                <Switch
                  checked={it.coffeeInRoom}
                  onChange={(coffeeInRoom) => setItem(i, { coffeeInRoom })}
                  label="Coffee break na própria sala"
                  description="Adicional da Portaria 2794, Art. 5º. Só vale nas salas de aula que permitem coffee (2366/2368, 2223 e 1357)."
                />
              )}
            </li>
          ))}
        </ul>
        <Button
          variant="ghost"
          size="sm"
          icon={PlusIcon}
          className="mt-2"
          onClick={() => setItems([...items, { ref: items.at(-1)?.ref ?? `c:${firstDidactic?.id}`, count: "1", coffeeInRoom: false }])}
        >
          Mais um espaço
        </Button>
      </section>

      <section className="mt-5 space-y-3 rounded-xl border border-border p-4">
        <Switch
          checked={institutional}
          onChange={setInstitutional}
          label="Unidade FMUSP/HC, USP, SES ou Instituto Adolfo Lutz"
          description="Desconto institucional (Art. 4º III), sem somar com outros."
        />
        <Switch checked={exempt} onChange={setExempt} label="Isento" description="Art. 4º I e II. Por enquanto, quem analisa marca, com o motivo." />
        {exempt && <Input label="Motivo da isenção" required value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Ex.: evento institucional da FMUSP, sem inscrição" />}
      </section>

      <div className="mt-5">
        <Button icon={CalculatorIcon} loading={loading} disabled={items.length === 0 || (exempt && !reason.trim())} onClick={() => void calculate()}>
          Calcular orçamento
        </Button>
      </div>

      {error && (
        <Alert tone="danger" className="mt-4">
          {error}
        </Alert>
      )}
      {estimate && (
        <div className="mt-5">
          <QuoteBreakdown estimate={estimate} />
        </div>
      )}
    </Card>
  );
}
