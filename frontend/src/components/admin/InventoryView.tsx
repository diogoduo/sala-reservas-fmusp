import { DownloadSimpleIcon, FunnelSimpleXIcon, MagnifyingGlassIcon, NotePencilIcon, PencilSimpleIcon, UsersIcon } from "@phosphor-icons/react";
import { useMemo, useState } from "react";
import { useNavigate } from "react-router";
import { plural } from "../../lib/format";
import { resourceIcon, ROOM_TYPE_ICONS } from "../../lib/icons";
import { ROOM_STATUS_LABELS } from "../../lib/types";
import type { Resource, Room } from "../../lib/types";
import { Badge } from "../ui/Badge";
import { Button } from "../ui/Button";
import { EmptyState } from "../ui/Feedback";
import { Input, Select } from "../ui/Field";
import { Card, IconTile } from "../ui/Surface";

/** Comparação sem acento e sem caixa ("patrimonio" acha "Patrimônio"). */
const fold = (text: string) =>
  text
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toLowerCase();

/** Destaca o termo buscado (útil para achar um patrimônio no meio da lista). */
function Highlight({ text, needle }: { text: string; needle: string }) {
  if (!needle) return <>{text}</>;
  // fold() preserva o tamanho do texto para letras latinas, então os índices batem.
  const at = fold(text).indexOf(needle);
  if (at < 0 || fold(text).length !== text.length) return <>{text}</>;
  return (
    <>
      {text.slice(0, at)}
      <mark className="rounded-sm bg-warning-soft px-0.5 text-warning-foreground">{text.slice(at, at + needle.length)}</mark>
      {text.slice(at + needle.length)}
    </>
  );
}

function csvCell(value: string | number | null | undefined) {
  const text = String(value ?? "");
  return /[";\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

/** CSV com ";" e BOM, que o Excel em português abre direto com acentos. */
function downloadCsv(rooms: Room[]) {
  const header = ["Prédio", "Andar", "Sala", "Recurso", "Quantidade", "Modelo", "Patrimônio"];
  const lines = rooms.flatMap((room) => [
    ...room.resources.map((link) => [room.building, room.floor, room.name, link.resource.name, link.quantity, link.model, link.assetTags]),
    ...(room.equipmentNotes ? [[room.building, room.floor, room.name, "Outros equipamentos", "", room.equipmentNotes, ""]] : []),
  ]);
  const csv = [header, ...lines].map((line) => line.map(csvCell).join(";")).join("\r\n");
  const url = URL.createObjectURL(new Blob(["﻿" + csv], { type: "text/csv;charset=utf-8" }));
  const a = document.createElement("a");
  a.href = url;
  a.download = `inventario-salas-${new Date().toISOString().slice(0, 10)}.csv`;
  a.click();
  URL.revokeObjectURL(url);
}

interface Props {
  rooms: Room[];
  resources: Resource[];
}

/** Inventário de equipamentos por sala, com modelo e patrimônio. Só o SAD vê. */
export function InventoryView({ rooms, resources }: Props) {
  const navigate = useNavigate();
  const [query, setQuery] = useState("");
  const [resourceId, setResourceId] = useState("");
  const [building, setBuilding] = useState("");

  const buildings = useMemo(() => [...new Set(rooms.map((r) => r.building))].sort(), [rooms]);
  const usedResources = useMemo(() => {
    const used = new Set(rooms.flatMap((room) => room.resources.map((link) => link.resourceId)));
    return resources.filter((r) => used.has(r.id));
  }, [rooms, resources]);

  const needle = fold(query.trim());
  // A busca por nome de sala mostra a sala inteira; a busca por modelo/patrimônio mostra só os itens que batem.
  const visible = rooms.flatMap((room) => {
    if (building && room.building !== building) return [];
    const roomMatches = !needle || fold(`${room.name} ${room.building} ${room.floor}`).includes(needle);
    const items = room.resources.filter(
      (link) =>
        (!resourceId || link.resourceId === resourceId) &&
        (roomMatches || fold(`${link.resource.name} ${link.model ?? ""} ${link.assetTags ?? ""}`).includes(needle)),
    );
    const notes = !resourceId && room.equipmentNotes && (roomMatches || fold(room.equipmentNotes).includes(needle)) ? room.equipmentNotes : null;
    return items.length > 0 || notes ? [{ room, items, notes }] : [];
  });
  const itemCount = visible.reduce((sum, v) => sum + v.items.length, 0);
  const hasFilters = Boolean(query || resourceId || building);

  function clearFilters() {
    setQuery("");
    setResourceId("");
    setBuilding("");
  }

  return (
    <div className="space-y-5">
      <Card className="grid gap-4 p-4 sm:grid-cols-2 sm:p-5 lg:grid-cols-[minmax(0,2fr)_minmax(0,1fr)_minmax(0,1fr)]">
        <div className="relative sm:col-span-2 lg:col-span-1">
          <Input
            label="Buscar"
            type="search"
            placeholder="Patrimônio, modelo ou sala (ex.: 360001234, Sennheiser, 2104)"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            className="pl-10"
          />
          <MagnifyingGlassIcon size={18} aria-hidden className="pointer-events-none absolute bottom-3.5 left-3 text-muted" />
        </div>
        <Select label="Recurso" value={resourceId} onChange={(e) => setResourceId(e.target.value)}>
          <option value="">Todos os recursos</option>
          {usedResources.map((r) => (
            <option key={r.id} value={r.id}>
              {r.name}
            </option>
          ))}
        </Select>
        <Select label="Prédio" value={building} onChange={(e) => setBuilding(e.target.value)}>
          <option value="">Todos os prédios</option>
          {buildings.map((b) => (
            <option key={b} value={b}>
              {b}
            </option>
          ))}
        </Select>
      </Card>

      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm text-muted" aria-live="polite">
          {plural(itemCount, "item", "itens")} em {plural(visible.length, "sala", "salas")}
        </p>
        <div className="flex gap-2">
          {hasFilters && (
            <Button variant="ghost" size="sm" icon={FunnelSimpleXIcon} onClick={clearFilters}>
              Limpar filtros
            </Button>
          )}
          <Button
            variant="secondary"
            size="sm"
            icon={DownloadSimpleIcon}
            disabled={visible.length === 0}
            onClick={() => downloadCsv(visible.map(({ room, items, notes }) => ({ ...room, resources: items, equipmentNotes: notes })))}
          >
            Exportar CSV
          </Button>
        </div>
      </div>

      {visible.length === 0 ? (
        <EmptyState
          icon={MagnifyingGlassIcon}
          title={rooms.length === 0 ? "Nenhuma sala cadastrada" : "Nada encontrado"}
          description={rooms.length === 0 ? undefined : "Confira o número do patrimônio ou tente outro filtro."}
          action={hasFilters && <Button variant="secondary" onClick={clearFilters}>Limpar filtros</Button>}
        />
      ) : (
        <ul className="space-y-4">
          {visible.map(({ room, items, notes }) => (
            <li key={room.id}>
              <Card className="overflow-hidden">
                <div className="flex flex-wrap items-center gap-3 border-b border-border px-4 py-3 sm:px-5">
                  <IconTile icon={ROOM_TYPE_ICONS[room.roomType]} size="sm" tone={room.status === "ACTIVE" ? "primary" : "neutral"} />
                  <div className="min-w-0 flex-1">
                    <h3 className="font-semibold break-words">
                      <Highlight text={room.name} needle={needle} />
                    </h3>
                    <p className="flex flex-wrap items-center gap-x-2 text-xs text-muted">
                      <span>
                        {room.building} · {room.floor}
                      </span>
                      <span className="inline-flex items-center gap-1">
                        <UsersIcon size={12} aria-hidden /> {room.capacity}
                        {room.extraSeats ? ` + ${room.extraSeats}` : ""}
                      </span>
                    </p>
                  </div>
                  {room.status !== "ACTIVE" && <Badge>{ROOM_STATUS_LABELS[room.status]}</Badge>}
                  <Button variant="ghost" size="sm" icon={PencilSimpleIcon} onClick={() => navigate(`/admin/salas?editar=${room.id}`)}>
                    Editar
                  </Button>
                </div>

                {items.length > 0 && (
                  <table className="block w-full text-sm sm:table">
                    <thead className="sr-only sm:not-sr-only">
                      <tr className="text-left text-xs text-muted">
                        <th className="px-4 pt-3 pb-1 font-medium sm:px-5">Recurso</th>
                        <th className="px-2 pt-3 pb-1 font-medium">Modelo</th>
                        <th className="px-4 pt-3 pb-1 font-medium sm:px-5">Patrimônio</th>
                      </tr>
                    </thead>
                    <tbody className="block divide-y divide-border sm:table-row-group">
                      {items.map((link) => {
                        const ResourceIcon = resourceIcon(link.resource.name);
                        return (
                          <tr key={link.resourceId} className="flex flex-col gap-1 px-4 py-2.5 sm:table-row sm:px-0 sm:py-0">
                            <td className="sm:w-56 sm:py-2.5 sm:pr-2 sm:pl-5 sm:align-top">
                              <span className="inline-flex items-center gap-2 font-medium">
                                <ResourceIcon size={16} className="shrink-0 text-muted" aria-hidden />
                                {link.resource.name}
                                {link.quantity > 1 && <span className="text-muted tabular-nums">×{link.quantity}</span>}
                              </span>
                            </td>
                            <td className="pl-6 text-muted sm:py-2.5 sm:pr-2 sm:pl-2 sm:align-top">
                              {link.model ? <Highlight text={link.model} needle={needle} /> : <span className="text-muted/60">—</span>}
                            </td>
                            <td className="pl-6 font-mono text-xs break-words text-muted sm:py-2.5 sm:pr-5 sm:pl-4 sm:align-top">
                              {link.assetTags ? <Highlight text={link.assetTags} needle={needle} /> : <span className="font-sans text-muted/60">—</span>}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                )}

                {notes && (
                  <div className="flex gap-2 border-t border-border bg-surface-muted/50 px-4 py-3 text-sm sm:px-5">
                    <NotePencilIcon size={16} className="mt-0.5 shrink-0 text-muted" aria-hidden />
                    <p className="min-w-0">
                      <span className="font-medium">Outros equipamentos: </span>
                      <span className="text-muted">
                        <Highlight text={notes} needle={needle} />
                      </span>
                    </p>
                  </div>
                )}
              </Card>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
