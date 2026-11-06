import {
  ArrowCounterClockwiseIcon,
  CalendarPlusIcon,
  CheckCircleIcon,
  ClockCounterClockwiseIcon,
  DoorOpenIcon,
  FilePdfIcon,
  GavelIcon,
  ImageIcon,
  ImagesIcon,
  LaptopIcon,
  LockOpenIcon,
  PaperPlaneTiltIcon,
  PencilSimpleLineIcon,
  ProhibitIcon,
  ScrollIcon,
  TrashIcon,
  UserMinusIcon,
  WrenchIcon,
  XCircleIcon,
  type Icon,
} from "@phosphor-icons/react";
import { useCallback, useEffect, useState } from "react";
import type { Tone } from "../components/ui/Badge";
import { ACTIVITY_TYPE_LABELS } from "./activities";
import { api } from "./api";
import { formatMinutes } from "./reservations";
import {
  NOTEBOOK_LOCATION_LABELS,
  RESERVATION_STATUS_LABELS,
  ROOM_STATUS_LABELS,
  ROOM_TYPE_LABELS,
  SANCTION_TYPE_LABELS,
  SEAT_TYPE_LABELS,
  type ActivityType,
  type AuditEntry,
  type AuditEntityType,
  type AuditPage,
  type NotebookLocation,
  type ReservationStatus,
  type RoomStatus,
  type RoomType,
  type SanctionType,
  type SeatType,
} from "./types";

export const AUDIT_ENTITY_LABELS: Record<AuditEntityType, string> = {
  reservation: "Reservas",
  room: "Salas",
  resource: "Recursos",
  user: "Pessoas e sanções",
  regulation: "Regulamento",
  notebook: "Notebooks",
  sanction: "Sanções",
};

interface ActionMeta {
  label: string;
  tone: Tone;
  icon: Icon;
}

const ACTIONS: Record<string, ActionMeta> = {
  "reservation.request": { label: "Pedido enviado", tone: "info", icon: PaperPlaneTiltIcon },
  "reservation.edit": { label: "Alterado pelo solicitante", tone: "warning", icon: PencilSimpleLineIcon },
  "reservation.cancel": { label: "Cancelado pelo solicitante", tone: "neutral", icon: ProhibitIcon },
  "reservation.approve": { label: "Aprovado", tone: "success", icon: CheckCircleIcon },
  "reservation.reject": { label: "Rejeitado", tone: "danger", icon: XCircleIcon },
  "reservation.admin_create": { label: "Reservado pelo SAD", tone: "success", icon: CalendarPlusIcon },
  "reservation.admin_edit": { label: "Alterado pelo SAD", tone: "warning", icon: PencilSimpleLineIcon },
  "reservation.admin_cancel": { label: "Cancelado pelo SAD", tone: "danger", icon: ProhibitIcon },
  "reservation.no_show": { label: "Ausência registrada", tone: "warning", icon: UserMinusIcon },
  "reservation.no_show_undo": { label: "Ausência retirada", tone: "neutral", icon: ArrowCounterClockwiseIcon },
  "room.create": { label: "Sala cadastrada", tone: "success", icon: DoorOpenIcon },
  "room.update": { label: "Sala alterada", tone: "info", icon: PencilSimpleLineIcon },
  "room.delete": { label: "Sala excluída", tone: "danger", icon: TrashIcon },
  "room.photo_add": { label: "Foto adicionada", tone: "info", icon: ImageIcon },
  "room.photo_caption": { label: "Legenda de foto alterada", tone: "info", icon: ImageIcon },
  "room.photo_order": { label: "Ordem das fotos alterada", tone: "info", icon: ImagesIcon },
  "room.photo_delete": { label: "Foto removida", tone: "neutral", icon: ImageIcon },
  "resource.create": { label: "Recurso cadastrado", tone: "success", icon: WrenchIcon },
  "resource.update": { label: "Recurso alterado", tone: "info", icon: WrenchIcon },
  "resource.delete": { label: "Recurso excluído", tone: "danger", icon: TrashIcon },
  "regulation.update": { label: "Regulamento alterado", tone: "info", icon: ScrollIcon },
  "regulation.file_add": { label: "PDF anexado ao regulamento", tone: "info", icon: FilePdfIcon },
  "regulation.file_delete": { label: "PDF removido do regulamento", tone: "neutral", icon: FilePdfIcon },
  "notebook.create": { label: "Notebook cadastrado", tone: "success", icon: LaptopIcon },
  "notebook.update": { label: "Notebook alterado", tone: "info", icon: LaptopIcon },
  "notebook.delete": { label: "Notebook excluído", tone: "danger", icon: TrashIcon },
  "sanction.create": { label: "Sanção aplicada", tone: "danger", icon: GavelIcon },
  "sanction.lift": { label: "Suspensão retirada", tone: "success", icon: LockOpenIcon },
};

export function auditActionMeta(action: string): ActionMeta {
  return ACTIONS[action] ?? { label: action, tone: "neutral", icon: ClockCounterClockwiseIcon };
}

const FIELD_LABELS: Record<string, string> = {
  status: "Situação",
  startTime: "Início",
  endTime: "Término",
  room: "Sala",
  title: "Título",
  expectedAttendees: "Participantes",
  activityType: "Tipo de atividade",
  setupMinutes: "Montagem",
  supportNotes: "Observações para a TI",
  resources: "Recursos",
  name: "Nome",
  building: "Prédio",
  floor: "Andar",
  capacity: "Capacidade",
  roomType: "Tipo",
  extraSeats: "Cadeiras extras",
  dimensions: "Dimensões",
  equipmentNotes: "Outros equipamentos",
  seatTypes: "Tipo de cadeira",
  wideDoor: "Porta de 900 mm",
  specialNeeds: "Atendimento especial",
  caption: "Legenda",
  description: "Descrição",
  requestsQuantity: "Pede quantidade",
  requestable: "Aparece no formulário",
  detailPrompt: "Texto de exemplo do detalhe",
  detailOptions: "Opções do detalhe",
  assetTag: "Patrimônio",
  model: "Modelo",
  location: "Local",
  notes: "Observações",
};

export const auditFieldLabel = (field: string) => FIELD_LABELS[field] ?? field;

const FIELD_ORDER = Object.keys(FIELD_LABELS);

/** Campos alterados na ordem de leitura (situação, datas, sala…): o banco (jsonb) não guarda a ordem. */
export function orderedChanges(changes: AuditEntry["changes"]) {
  const rank = (field: string) => (FIELD_ORDER.includes(field) ? FIELD_ORDER.indexOf(field) : FIELD_ORDER.length);
  return Object.entries(changes ?? {}).sort(([a], [b]) => rank(a) - rank(b));
}

const dateTime = (iso: string) => new Date(iso).toLocaleString("pt-BR", { dateStyle: "short", timeStyle: "short" });
const dayMonth = (iso: string) => new Date(iso).toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit" });

/** Um valor do histórico em texto. Listas (recursos, tipos de cadeira) viram itens separados por vírgula. */
export function formatAuditValue(entityType: AuditEntityType, field: string, value: unknown): string {
  if (value === null || value === undefined || value === "") return "—";
  if (typeof value === "boolean") return value ? "Sim" : "Não";
  if (Array.isArray(value)) {
    if (value.length === 0) return "nenhum";
    const items = field === "seatTypes" ? value.map((v) => SEAT_TYPE_LABELS[v as SeatType] ?? String(v)) : value.map(String);
    return items.join(", ");
  }
  switch (field) {
    case "status":
      return entityType === "room"
        ? (ROOM_STATUS_LABELS[value as RoomStatus] ?? String(value))
        : (RESERVATION_STATUS_LABELS[value as ReservationStatus] ?? String(value));
    case "roomType":
      return ROOM_TYPE_LABELS[value as RoomType] ?? String(value);
    case "activityType":
      return ACTIVITY_TYPE_LABELS[value as ActivityType] ?? String(value);
    case "location":
      return NOTEBOOK_LOCATION_LABELS[value as NotebookLocation] ?? String(value);
    case "startTime":
    case "endTime":
      return dateTime(String(value));
    case "setupMinutes":
      return Number(value) === 0 ? "sem montagem" : formatMinutes(Number(value));
    default:
      return String(value);
  }
}

/** Listas que mudaram: o que entrou e o que saiu, em vez de "antes → depois" inteiros. */
export function listDiff(from: unknown, to: unknown): { added: string[]; removed: string[] } | null {
  if (!Array.isArray(from) || !Array.isArray(to)) return null;
  const before = from.map(String);
  const after = to.map(String);
  return { added: after.filter((x) => !before.includes(x)), removed: before.filter((x) => !after.includes(x)) };
}

const num = (value: unknown) => (typeof value === "number" ? value : 0);
const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

/** Linhas de contexto de uma ação: datas afetadas, motivo, sala… */
export function auditDetailLines(entry: AuditEntry): string[] {
  const d = entry.details ?? {};
  const lines: string[] = [];

  const dates = Array.isArray(d.dates) ? (d.dates as string[]) : [];
  const count = num(d.count);
  if (count === 1 && dates[0]) lines.push(`Data: ${dateTime(dates[0])}`);
  else if (count > 1 && dates.length > 0) {
    lines.push(`${plural(count, "data", "datas")}: de ${dayMonth(dates[0]!)} a ${dayMonth(dates.at(-1)!)}${d.scope === "series" ? " (esta e as próximas)" : ""}`);
  }
  if (entry.action === "reservation.request" || entry.action === "reservation.admin_create") {
    const type = d.activityType ? ACTIVITY_TYPE_LABELS[d.activityType as ActivityType] : null;
    const people = num(d.expectedAttendees);
    lines.push([type, people ? plural(people, "pessoa", "pessoas") : null].filter(Boolean).join(" · "));
  }
  if (typeof d.room === "string") lines.push(`Sala: ${d.room}`);
  if (num(d.skippedHolidays) > 0) lines.push(`${plural(num(d.skippedHolidays), "feriado ficou", "feriados ficaram")} fora da série`);
  if (num(d.outsideRegularHoursCount) > 0) lines.push(`${plural(num(d.outsideRegularHoursCount), "data", "datas")} em horário extraordinário`);
  if (num(d.leftPendingCount) > 0) lines.push(`${plural(num(d.leftPendingCount), "data continua pendente", "datas continuam pendentes")} (sala ocupada)`);
  if (num(d.keptCount) > 0) lines.push(`${plural(num(d.keptCount), "data aprovada ficou", "datas aprovadas ficaram")} de pé (fora do prazo)`);
  if (typeof d.reason === "string") lines.push(`Motivo: ${d.reason}`);

  if (entry.action === "sanction.create" || entry.action === "sanction.lift") {
    const type = SANCTION_TYPE_LABELS[d.type as SanctionType] ?? String(d.type);
    const until =
      d.type === "SUSPENSION" && entry.action === "sanction.create"
        ? typeof d.until === "string"
          ? ` até ${new Date(`${d.until}T12:00:00`).toLocaleDateString("pt-BR")}`
          : " até a regularização"
        : "";
    lines.unshift(`${type}${until}`);
    if (num(d.cancelledCount) > 0) lines.push(`${plural(num(d.cancelledCount), "reserva futura cancelada", "reservas futuras canceladas")}`);
  }
  if (entry.action === "regulation.update" && d.bodyChanged) lines.push("Texto do regulamento alterado");
  if (entry.entityType === "room" && typeof d.caption === "string") lines.push(`Legenda: ${d.caption}`);
  if ((entry.action === "room.create" || entry.action === "room.delete") && typeof d.capacity === "number") {
    lines.push(`Capacidade: ${plural(d.capacity, "lugar", "lugares")}`);
  }
  return lines.filter(Boolean);
}

// ---------------------------------------------------------------------------
// Carregamento em páginas
// ---------------------------------------------------------------------------

export type AuditFilters = Partial<Record<"entityType" | "entityId" | "actorId" | "q" | "from" | "to" | "limit", string>>;

/** Histórico com os filtros dados, do mais recente para o mais antigo; `loadMore` traz a próxima página. */
export function useAuditLog(filters: AuditFilters, enabled = true) {
  const [items, setItems] = useState<AuditEntry[] | null>(null);
  const [cursor, setCursor] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loadingMore, setLoadingMore] = useState(false);

  const query = new URLSearchParams(Object.entries(filters).filter((e): e is [string, string] => Boolean(e[1]))).toString();

  useEffect(() => {
    if (!enabled) return;
    let active = true;
    setItems(null);
    setError(null);
    api<AuditPage>(`/audit?${query}`)
      .then((page) => {
        if (!active) return;
        setItems(page.items);
        setCursor(page.nextCursor);
      })
      .catch((e: Error) => active && setError(e.message));
    return () => {
      active = false;
    };
  }, [query, enabled]);

  const loadMore = useCallback(async () => {
    if (!cursor) return;
    setLoadingMore(true);
    try {
      const page = await api<AuditPage>(`/audit?${query}${query ? "&" : ""}cursor=${encodeURIComponent(cursor)}`);
      setItems((current) => [...(current ?? []), ...page.items]);
      setCursor(page.nextCursor);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoadingMore(false);
    }
  }, [cursor, query]);

  return { items, error, hasMore: cursor !== null, loadMore, loadingMore };
}
