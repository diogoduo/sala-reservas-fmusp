import { ClockCounterClockwiseIcon, MinusIcon, PlusIcon } from "@phosphor-icons/react";
import { useState } from "react";
import { auditActionMeta, auditDetailLines, auditFieldLabel, auditListItem, formatAuditValue, listDiff, orderedChanges, useAuditLog } from "../../lib/audit";
import type { AuditEntry } from "../../lib/types";
import { Button } from "../ui/Button";
import { Alert, Skeleton } from "../ui/Feedback";
import { IconTile } from "../ui/Surface";

function Changes({ entry }: { entry: AuditEntry }) {
  const changes = orderedChanges(entry.changes);
  if (changes.length === 0) return null;
  return (
    <ul className="mt-2 space-y-1 text-sm">
      {changes.map(([field, { from, to }]) => {
        const list = listDiff(from, to);
        return (
          <li key={field} className="break-words">
            <span className="text-muted">{auditFieldLabel(field)}:</span>{" "}
            {list ? (
              <span className="inline-flex flex-col gap-0.5 align-top">
                {list.added.map((item) => (
                  <span key={`+${item}`} className="inline-flex items-start gap-1 text-success-foreground">
                    <PlusIcon size={14} weight="bold" aria-label="incluído" className="mt-0.5 shrink-0" />
                    {auditListItem(field, item)}
                  </span>
                ))}
                {list.removed.map((item) => (
                  <span key={`-${item}`} className="inline-flex items-start gap-1 text-muted line-through">
                    <MinusIcon size={14} weight="bold" aria-label="removido" className="mt-0.5 shrink-0" />
                    {auditListItem(field, item)}
                  </span>
                ))}
              </span>
            ) : (
              <>
                <span className="text-muted line-through decoration-1">{formatAuditValue(entry.entityType, field, from)}</span>
                <span aria-label="passou para"> → </span>
                <span className="font-medium">{formatAuditValue(entry.entityType, field, to)}</span>
              </>
            )}
          </li>
        );
      })}
    </ul>
  );
}

/** Uma ação do histórico: o que foi feito, quem fez, quando e o que mudou. */
export function AuditEntryItem({ entry, showLabel = true }: { entry: AuditEntry; showLabel?: boolean }) {
  const meta = auditActionMeta(entry.action);
  const lines = auditDetailLines(entry);
  const time = new Date(entry.createdAt).toLocaleString("pt-BR", { dateStyle: "short", timeStyle: "short" });
  return (
    <li className="flex gap-3 py-3 first:pt-0 last:pb-0">
      <IconTile icon={meta.icon} tone={meta.tone} size="sm" />
      <div className="min-w-0 flex-1">
        <p className="text-sm leading-snug">
          <span className="font-semibold">{meta.label}</span>
          {showLabel && entry.label && <span className="text-muted"> · {entry.label}</span>}
        </p>
        <p className="mt-0.5 text-xs text-muted">
          <time dateTime={entry.createdAt}>{time}</time> · {entry.actorName ?? "Sistema"}
        </p>
        <Changes entry={entry} />
        {lines.length > 0 && (
          <ul className="mt-1.5 space-y-0.5 text-sm text-muted">
            {lines.map((line) => (
              <li key={line} className="break-words">
                {line}
              </li>
            ))}
          </ul>
        )}
      </div>
    </li>
  );
}

/** Histórico de um pedido (todas as datas do protocolo), recolhido até o SAD abrir. */
export function ReservationHistory({ protocol }: { protocol: string }) {
  const [open, setOpen] = useState(false);
  const { items, error, hasMore, loadMore, loadingMore } = useAuditLog({ entityType: "reservation", entityId: protocol, limit: "20" }, open);

  return (
    <details className="group rounded-xl border border-border" onToggle={(e) => setOpen(e.currentTarget.open)}>
      <summary className="flex min-h-11 cursor-pointer list-none items-center gap-2 rounded-xl px-3 text-sm font-semibold hover:bg-surface-muted [&::-webkit-details-marker]:hidden">
        <ClockCounterClockwiseIcon size={18} aria-hidden className="text-muted" />
        <span className="flex-1">Histórico do pedido</span>
        <span className="text-xs font-normal text-muted group-open:hidden">Ver quem fez o quê</span>
      </summary>
      <div className="border-t border-border p-3">
        {error ? (
          <Alert tone="danger">{error}</Alert>
        ) : items === null ? (
          <Skeleton className="h-16 rounded-lg" />
        ) : items.length === 0 ? (
          <p className="text-sm text-muted">Nada registrado ainda. O histórico começou a ser gravado na Fase 9.</p>
        ) : (
          <>
            <ul className="divide-y divide-border">
              {items.map((entry) => (
                <AuditEntryItem key={entry.id} entry={entry} showLabel={false} />
              ))}
            </ul>
            {hasMore && (
              <Button variant="secondary" size="sm" className="mt-3 w-full" loading={loadingMore} onClick={() => void loadMore()}>
                Ver mais
              </Button>
            )}
          </>
        )}
      </div>
    </details>
  );
}
