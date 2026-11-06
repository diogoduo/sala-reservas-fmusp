import { CalendarPlusIcon, CurrencyCircleDollarIcon, FloppyDiskIcon, PencilSimpleLineIcon, TrashIcon } from "@phosphor-icons/react";
import { useEffect, useId, useState, type FormEvent } from "react";
import { api, ApiError } from "../../lib/api";
import { useCanManage } from "../../lib/auth";
import { cn } from "../../lib/cn";
import { useConfirm } from "../../lib/confirm";
import { centsToInput, formatDateKey, inputToCents, priceText, PRICE_UNIT_LABELS } from "../../lib/prices";
import { useToast } from "../../lib/toast";
import type { PriceCategory, PricesResponse, PriceTable } from "../../lib/types";
import { Badge } from "../ui/Badge";
import { Button } from "../ui/Button";
import { Dialog } from "../ui/Dialog";
import { Alert, CardListSkeleton, EmptyState } from "../ui/Feedback";
import { Input, Textarea } from "../ui/Field";
import { Card, PageHeader } from "../ui/Surface";

type RuleKey = "minimumHours" | "prepHoursBefore" | "prepHoursAfter" | "coffeeSurchargePercent" | "institutionalDiscountPercent";

interface Draft {
  amounts: Record<string, string>;
  rules: Record<RuleKey, string>;
  notes: string;
}

const RULE_KEYS: RuleKey[] = ["minimumHours", "prepHoursBefore", "prepHoursAfter", "coffeeSurchargePercent", "institutionalDiscountPercent"];

const today = () => new Date().toLocaleDateString("en-CA");

function tableStatus(table: PriceTable, currentId: string | null): { label: string; tone: "success" | "info" | "neutral" } {
  if (table.id === currentId) return { label: "Vigente", tone: "success" };
  if (table.validFrom > today()) return { label: "Futura", tone: "info" };
  return { label: "Anterior", tone: "neutral" };
}

function draftFrom(table: PriceTable, categories: PriceCategory[]): Draft {
  const amount = (id: string) => table.entries.find((e) => e.categoryId === id)?.amountCents ?? null;
  return {
    amounts: Object.fromEntries(categories.map((c) => [c.id, centsToInput(amount(c.id))])),
    rules: Object.fromEntries(RULE_KEYS.map((k) => [k, String(table[k])])) as Record<RuleKey, string>,
    notes: table.notes ?? "",
  };
}

/** Uma categoria: nome, espaços que usam e o valor (ou o campo, ao editar). */
function CategoryRow({
  category,
  amountCents,
  editing,
  value,
  onChange,
  invalid,
}: {
  category: PriceCategory;
  amountCents: number | null;
  editing: boolean;
  value: string;
  onChange: (value: string) => void;
  invalid: boolean;
}) {
  const inputId = useId();
  const active = category.rooms.filter((r) => r.status === "ACTIVE");
  return (
    <li className="flex flex-col gap-3 py-3.5 sm:flex-row sm:items-center sm:justify-between">
      <div className="min-w-0">
        <label htmlFor={inputId} className="font-medium">
          {category.name}
        </label>
        {category.rooms.length === 0 ? (
          <p className="text-sm text-muted">Nenhum espaço usa esta categoria.</p>
        ) : (
          <details className="text-sm text-muted">
            <summary className="w-fit cursor-pointer hover:text-foreground">
              {active.length === 1 ? "1 espaço" : `${active.length} espaços`}
              {category.rooms.length > active.length ? ` (+${category.rooms.length - active.length} fora de uso)` : ""}
            </summary>
            <p className="mt-1 leading-relaxed">{category.rooms.map((r) => r.name).join(", ")}</p>
          </details>
        )}
      </div>
      {editing ? (
        <div className="flex shrink-0 items-center gap-2">
          <div className="relative w-40">
            <span aria-hidden className="pointer-events-none absolute top-1/2 left-3 -translate-y-1/2 text-sm text-muted">
              R$
            </span>
            <Input
              id={inputId}
              inputMode="decimal"
              placeholder="A definir"
              value={value}
              onChange={(e) => onChange(e.target.value)}
              error={invalid ? "Valor inválido" : undefined}
              className="pl-9 tabular-nums"
            />
          </div>
          <span className="w-16 text-sm text-muted">{PRICE_UNIT_LABELS[category.unit]}</span>
        </div>
      ) : amountCents === null ? (
        <Badge tone="warning" className="w-fit">
          A definir
        </Badge>
      ) : (
        <p className="shrink-0 font-semibold tabular-nums">{priceText(amountCents, category.unit)}</p>
      )}
    </li>
  );
}

function RuleField({ label, suffix, value, onChange }: { label: string; suffix: string; value: string; onChange: (v: string) => void }) {
  return (
    <div className="flex items-center gap-2">
      <Input aria-label={label} type="number" inputMode="numeric" min={0} value={value} onChange={(e) => onChange(e.target.value)} className="h-9 w-20 tabular-nums" />
      <span className="text-sm text-muted">{suffix}</span>
    </div>
  );
}

function NewTableDialog({ source, onClose, onCreated }: { source: PriceTable; onClose: () => void; onCreated: (t: PriceTable) => void }) {
  const toast = useToast();
  const formId = useId();
  const nextYear = new Date().getFullYear() + 1;
  const [name, setName] = useState(`Reajuste ${nextYear}`);
  const [validFrom, setValidFrom] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setSaving(true);
    setError(null);
    try {
      const { table } = await api<{ table: PriceTable }>("/prices/tables", {
        method: "POST",
        body: JSON.stringify({ copyFromId: source.id, name, validFrom }),
      });
      toast.success("Tabela criada", "Ajuste os valores novos e salve.");
      onCreated(table);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Não foi possível criar a tabela.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog
      open
      onClose={onClose}
      title="Nova tabela (reajuste)"
      description={`Começa com os valores e as regras de "${source.name}". A tabela atual continua guardada.`}
      footer={
        <>
          <Button variant="secondary" onClick={onClose} disabled={saving}>
            Cancelar
          </Button>
          <Button type="submit" form={formId} loading={saving} icon={CalendarPlusIcon}>
            Criar tabela
          </Button>
        </>
      }
    >
      <form id={formId} onSubmit={submit} className="space-y-4">
        {error && <Alert tone="danger">{error}</Alert>}
        <Input label="Nome" required value={name} onChange={(e) => setName(e.target.value)} hint="Ex.: Reajuste 2027 (IPC-FIPE)" />
        <Input
          label="Vale a partir de"
          type="date"
          required
          value={validFrom}
          onChange={(e) => setValidFrom(e.target.value)}
          hint="Os orçamentos de eventos a partir dessa data usam a tabela nova."
        />
      </form>
    </Dialog>
  );
}

/** Tela "Preços": a tabela da Portaria 2794 com vigência. O SAD edita; o NUCEV consulta. */
export function PricesPage() {
  const toast = useToast();
  const confirm = useConfirm();
  const canManage = useCanManage();
  const [data, setData] = useState<PricesResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [saving, setSaving] = useState(false);
  const [creating, setCreating] = useState(false);

  async function load(select?: string) {
    try {
      const res = await api<PricesResponse>("/prices");
      setData(res);
      setSelectedId((prev) => select ?? prev ?? res.currentTableId ?? res.tables[0]?.id ?? null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Não foi possível carregar os preços.");
    }
  }

  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (error) return <Alert tone="danger">{error}</Alert>;

  const table = data?.tables.find((t) => t.id === selectedId) ?? null;
  const categories = data?.categories ?? [];
  const editing = draft !== null && table !== null;
  const amountOf = (id: string) => table?.entries.find((e) => e.categoryId === id)?.amountCents ?? null;
  const invalidAmount = (id: string) => editing && inputToCents(draft.amounts[id] ?? "") === undefined;
  const hasInvalid = editing && categories.some((c) => invalidAmount(c.id));

  async function save() {
    if (!table || !draft || hasInvalid) return;
    setSaving(true);
    try {
      await api(`/prices/tables/${table.id}`, {
        method: "PATCH",
        body: JSON.stringify({
          ...Object.fromEntries(RULE_KEYS.map((k) => [k, Number(draft.rules[k]) || 0])),
          notes: draft.notes,
          entries: categories.map((c) => ({ categoryId: c.id, amountCents: inputToCents(draft.amounts[c.id] ?? "") ?? null })),
        }),
      });
      toast.success("Preços salvos", table.name);
      setDraft(null);
      await load(table.id);
    } catch (e) {
      toast.error("Não foi possível salvar.", e instanceof ApiError ? e.message : undefined);
    } finally {
      setSaving(false);
    }
  }

  async function removeTable(t: PriceTable) {
    const ok = await confirm({
      tone: "danger",
      title: `Excluir "${t.name}"?`,
      description: "Só dá para excluir uma tabela que ainda não começou a valer.",
      confirmLabel: "Excluir",
    });
    if (!ok) return;
    try {
      await api(`/prices/tables/${t.id}`, { method: "DELETE" });
      toast.success("Tabela excluída", t.name);
      setSelectedId(null);
      await load(data?.currentTableId ?? undefined);
    } catch (e) {
      toast.error("Não foi possível excluir.", e instanceof ApiError ? e.message : undefined);
    }
  }

  const setRule = (key: RuleKey, value: string) => setDraft((d) => d && { ...d, rules: { ...d.rules, [key]: value } });
  const groups = [
    { title: "Espaços didáticos", rule: "Portaria 2794, Art. 2º", items: categories.filter((c) => c.didactic) },
    { title: "Áreas de apoio", rule: "Portaria 2794, Art. 3º", items: categories.filter((c) => !c.didactic) },
  ].filter((g) => g.items.length > 0);
  const status = table && data ? tableStatus(table, data.currentTableId) : null;

  return (
    <div className="space-y-6">
      <PageHeader
        title="Preços"
        description="Valores de locação para eventos (Portaria 2794). O orçamento usa a tabela que vale na data do evento."
        actions={
          canManage && table && !editing ? (
            <Button variant="secondary" icon={CalendarPlusIcon} onClick={() => setCreating(true)}>
              Nova tabela (reajuste)
            </Button>
          ) : undefined
        }
      />

      {data === null ? (
        <CardListSkeleton />
      ) : !table ? (
        <EmptyState icon={CurrencyCircleDollarIcon} title="Nenhuma tabela de preços" description="A tabela da Portaria 2794 entra com a atualização do sistema." />
      ) : (
        <>
          {data.tables.length > 1 && (
            <div role="tablist" aria-label="Tabelas de preços" className="flex flex-wrap gap-2">
              {data.tables.map((t) => {
                const s = tableStatus(t, data.currentTableId);
                return (
                  <button
                    key={t.id}
                    type="button"
                    role="tab"
                    aria-selected={t.id === table.id}
                    disabled={editing}
                    onClick={() => setSelectedId(t.id)}
                    className={cn(
                      "rounded-full border px-4 py-2 text-sm font-medium transition-colors disabled:opacity-60",
                      t.id === table.id ? "border-primary bg-primary-soft text-primary-soft-foreground" : "border-border-strong text-muted hover:text-foreground",
                    )}
                  >
                    {t.name} · {s.label.toLowerCase()}
                  </button>
                );
              })}
            </div>
          )}

          <Card className="p-4 sm:p-6">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <div className="flex flex-wrap items-center gap-2">
                  <h2 className="text-lg font-semibold">{table.name}</h2>
                  {status && <Badge tone={status.tone}>{status.label}</Badge>}
                </div>
                <p className="text-sm text-muted">
                  {status?.label === "Futura" ? "Vale" : "Valendo"} a partir de {formatDateKey(table.validFrom)}
                </p>
              </div>
              {canManage &&
                (editing ? (
                  <div className="flex gap-2">
                    <Button variant="secondary" onClick={() => setDraft(null)} disabled={saving}>
                      Cancelar
                    </Button>
                    <Button icon={FloppyDiskIcon} loading={saving} disabled={hasInvalid} onClick={() => void save()}>
                      Salvar
                    </Button>
                  </div>
                ) : (
                  <div className="flex gap-2">
                    {status?.label === "Futura" && (
                      <Button variant="ghost" icon={TrashIcon} onClick={() => void removeTable(table)}>
                        Excluir
                      </Button>
                    )}
                    <Button variant="secondary" icon={PencilSimpleLineIcon} onClick={() => setDraft(draftFrom(table, categories))}>
                      Editar valores
                    </Button>
                  </div>
                ))}
            </div>
            {editing && status?.label !== "Futura" && (
              <Alert tone="info" className="mt-4">
                Para o reajuste anual, prefira "Nova tabela": assim os valores antigos continuam guardados. Toda mudança vai para o Histórico.
              </Alert>
            )}

            {groups.map((group) => (
              <section key={group.title} className="mt-6">
                <h3 className="text-sm font-semibold">
                  {group.title} <span className="font-normal text-muted">· {group.rule}</span>
                </h3>
                <ul className="mt-1 divide-y divide-border">
                  {group.items.map((c) => (
                    <CategoryRow
                      key={c.id}
                      category={c}
                      amountCents={amountOf(c.id)}
                      editing={editing}
                      value={draft?.amounts[c.id] ?? ""}
                      onChange={(value) => setDraft((d) => d && { ...d, amounts: { ...d.amounts, [c.id]: value } })}
                      invalid={invalidAmount(c.id)}
                    />
                  ))}
                </ul>
              </section>
            ))}
          </Card>

          <Card className="p-4 sm:p-6">
            <h2 className="text-lg font-semibold">Regras de cobrança</h2>
            <p className="text-sm text-muted">Aplicadas pelo orçamento automático dos eventos.</p>
            <ul className="mt-4 space-y-4 text-sm">
              <li>
                <p className="font-medium">Cobrança mínima nos espaços didáticos</p>
                {editing ? (
                  <RuleField label="Cobrança mínima" suffix="horas" value={draft.rules.minimumHours} onChange={(v) => setRule("minimumHours", v)} />
                ) : (
                  <p className="text-muted">{table.minimumHours} horas (Art. 2º)</p>
                )}
              </li>
              <li>
                <p className="font-medium">Preparação do espaço, em cada dia do evento</p>
                {editing ? (
                  <div className="flex flex-wrap gap-4">
                    <RuleField label="Horas antes" suffix="h antes" value={draft.rules.prepHoursBefore} onChange={(v) => setRule("prepHoursBefore", v)} />
                    <RuleField label="Horas depois" suffix="h depois" value={draft.rules.prepHoursAfter} onChange={(v) => setRule("prepHoursAfter", v)} />
                  </div>
                ) : (
                  <p className="text-muted">
                    +{table.prepHoursBefore}h antes do início e +{table.prepHoursAfter}h depois do término, cobradas nos espaços didáticos (Art. 2º §1º)
                  </p>
                )}
              </li>
              <li>
                <p className="font-medium">Coffee break em sala de aula</p>
                {editing ? (
                  <RuleField label="Adicional de coffee" suffix="% sobre o valor/hora" value={draft.rules.coffeeSurchargePercent} onChange={(v) => setRule("coffeeSurchargePercent", v)} />
                ) : (
                  <p className="text-muted">+{table.coffeeSurchargePercent}% sobre o valor/hora da sala (2366/2368, 2223 e 1357; Art. 5º §2º)</p>
                )}
              </li>
              <li>
                <p className="font-medium">Desconto institucional</p>
                {editing ? (
                  <RuleField label="Desconto institucional" suffix="%" value={draft.rules.institutionalDiscountPercent} onChange={(v) => setRule("institutionalDiscountPercent", v)} />
                ) : (
                  <p className="text-muted">
                    {table.institutionalDiscountPercent}% para unidades do Sistema FMUSP/HC, USP, SES e Instituto Adolfo Lutz, sem somar com outros descontos (Art. 4º III)
                  </p>
                )}
              </li>
              <li>
                <p className="font-medium">Pernoite</p>
                <p className="text-muted">Não é cobrado, desde que o espaço continue reservado para o evento (Art. 3º §2º)</p>
              </li>
              <li>
                <p className="font-medium">Isenções (Art. 4º I e II)</p>
                <p className="text-muted">Regra a definir. Por enquanto, quem analisa o evento marca a isenção, com o motivo.</p>
              </li>
            </ul>
            {editing ? (
              <Textarea label="Observações" value={draft.notes} onChange={(e) => setDraft((d) => d && { ...d, notes: e.target.value })} containerClassName="mt-6" />
            ) : (
              table.notes && <p className="mt-6 border-t border-border pt-4 text-sm text-muted">{table.notes}</p>
            )}
          </Card>
        </>
      )}

      {creating && table && (
        <NewTableDialog
          source={table}
          onClose={() => setCreating(false)}
          onCreated={(t) => {
            setCreating(false);
            void load(t.id).then(() => setDraft(null));
          }}
        />
      )}
    </div>
  );
}
