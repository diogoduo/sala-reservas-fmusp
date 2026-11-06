import { ClockCounterClockwiseIcon, MagnifyingGlassIcon } from "@phosphor-icons/react";
import { useEffect, useState } from "react";
import { useSearchParams } from "react-router";
import { AUDIT_ENTITY_LABELS, useAuditLog } from "../../lib/audit";
import type { AuditEntityType, AuditEntry } from "../../lib/types";
import { Button } from "../ui/Button";
import { Alert, CardListSkeleton, EmptyState } from "../ui/Feedback";
import { Input, Select } from "../ui/Field";
import { Card, PageHeader } from "../ui/Surface";
import { AuditEntryItem } from "./AuditTrail";

const ENTITY_FILTERS: AuditEntityType[] = ["reservation", "room", "resource", "user", "regulation", "notebook"];

const dayKey = (iso: string) => new Date(iso).toLocaleDateString("en-CA");

function dayTitle(key: string): string {
  const today = new Date().toLocaleDateString("en-CA");
  const yesterday = new Date(Date.now() - 86_400_000).toLocaleDateString("en-CA");
  if (key === today) return "Hoje";
  if (key === yesterday) return "Ontem";
  const label = new Date(`${key}T12:00:00`).toLocaleDateString("pt-BR", { weekday: "long", day: "numeric", month: "long", year: "numeric" });
  return label.charAt(0).toUpperCase() + label.slice(1);
}

function groupByDay(items: AuditEntry[]) {
  const groups: { key: string; items: AuditEntry[] }[] = [];
  for (const item of items) {
    const key = dayKey(item.createdAt);
    const last = groups.at(-1);
    if (last?.key === key) last.items.push(item);
    else groups.push({ key, items: [item] });
  }
  return groups;
}

/** Tela "Histórico" do SAD: tudo o que foi feito no sistema, com filtros na URL. */
export function AuditLogPage() {
  const [params, setParams] = useSearchParams();
  const entityType = (params.get("tipo") ?? "") as AuditEntityType | "";
  const from = params.get("de") ?? "";
  const to = params.get("ate") ?? "";
  const q = params.get("busca") ?? "";
  const [search, setSearch] = useState(q);

  function update(patch: Partial<Record<"tipo" | "de" | "ate" | "busca", string>>) {
    setParams(
      (prev) => {
        const next = new URLSearchParams(prev);
        for (const [key, value] of Object.entries(patch)) {
          if (value) next.set(key, value);
          else next.delete(key);
        }
        return next;
      },
      { replace: true },
    );
  }

  // A busca espera a pessoa parar de digitar.
  useEffect(() => {
    const timer = setTimeout(() => {
      if (search.trim() !== q) update({ busca: search.trim() });
    }, 350);
    return () => clearTimeout(timer);
  }, [search]);

  const { items, error, hasMore, loadMore, loadingMore } = useAuditLog({
    entityType: entityType || undefined,
    from: from || undefined,
    to: to || undefined,
    q: q || undefined,
  });
  const filtered = Boolean(entityType || from || to || q);

  return (
    <div className="space-y-6">
      <PageHeader title="Histórico" description="Tudo o que foi feito no sistema: quem fez, quando e o que mudou." />

      <div className="grid grid-cols-2 items-end gap-3 lg:grid-cols-[1fr_14rem_10.5rem_10.5rem]">
        <div className="relative col-span-2 lg:col-span-1">
          <Input
            type="search"
            aria-label="Buscar no histórico"
            placeholder="Protocolo, sala, recurso ou pessoa"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="pl-10"
          />
          <MagnifyingGlassIcon size={18} aria-hidden className="pointer-events-none absolute top-1/2 left-3 -translate-y-1/2 text-muted" />
        </div>
        <Select
          label="O que mudou"
          containerClassName="col-span-2 lg:col-span-1"
          value={entityType}
          onChange={(e) => update({ tipo: e.target.value })}
        >
          <option value="">Tudo</option>
          {ENTITY_FILTERS.map((type) => (
            <option key={type} value={type}>
              {AUDIT_ENTITY_LABELS[type]}
            </option>
          ))}
        </Select>
        <Input label="De" type="date" value={from} max={to || undefined} onChange={(e) => update({ de: e.target.value })} />
        <Input label="Até" type="date" value={to} min={from || undefined} onChange={(e) => update({ ate: e.target.value })} />
      </div>

      {error ? (
        <Alert tone="danger">{error}</Alert>
      ) : items === null ? (
        <CardListSkeleton />
      ) : items.length === 0 ? (
        <EmptyState
          icon={filtered ? MagnifyingGlassIcon : ClockCounterClockwiseIcon}
          title={filtered ? "Nada encontrado" : "Nada registrado ainda"}
          description={filtered ? "Nenhuma ação com esses filtros." : "As ações feitas a partir de agora aparecem aqui."}
          action={
            filtered ? (
              <Button
                variant="secondary"
                onClick={() => {
                  setSearch("");
                  update({ tipo: "", de: "", ate: "", busca: "" });
                }}
              >
                Limpar filtros
              </Button>
            ) : undefined
          }
        />
      ) : (
        <div className="space-y-6">
          {groupByDay(items).map((group) => (
            <section key={group.key} aria-label={dayTitle(group.key)} className="space-y-2">
              <h2 className="text-sm font-semibold text-muted">{dayTitle(group.key)}</h2>
              <Card className="p-4 sm:p-5">
                <ul className="divide-y divide-border">
                  {group.items.map((entry) => (
                    <AuditEntryItem key={entry.id} entry={entry} />
                  ))}
                </ul>
              </Card>
            </section>
          ))}
          {hasMore && (
            <div className="flex justify-center">
              <Button variant="secondary" loading={loadingMore} onClick={() => void loadMore()}>
                Carregar mais
              </Button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
