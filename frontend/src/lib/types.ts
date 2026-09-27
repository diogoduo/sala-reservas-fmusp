export type RoomType =
  | "AUDITORIUM"
  | "LABORATORY"
  | "CLASSROOM"
  | "MEETING_ROOM"
  | "MULTIPURPOSE"
  | "COMPUTER_LAB"
  | "BOARD_ROOM"
  | "THEATER";
export type ActivityType = "UNDERGRADUATE" | "GRADUATE" | "CULTURE_EXTENSION" | "PUBLIC_EXAM" | "DEFENSE";
export type RoomStatus = "ACTIVE" | "MAINTENANCE" | "INACTIVE";

export const ROOM_TYPE_LABELS: Record<RoomType, string> = {
  AUDITORIUM: "Anfiteatro",
  CLASSROOM: "Sala de Aula",
  COMPUTER_LAB: "Sala de Informática",
  MEETING_ROOM: "Sala de Reunião",
  BOARD_ROOM: "Congregação/CTA",
  THEATER: "Teatro",
  LABORATORY: "Laboratório",
  MULTIPURPOSE: "Espaço Multiuso",
};

export const ROOM_STATUS_LABELS: Record<RoomStatus, string> = {
  ACTIVE: "Ativa",
  MAINTENANCE: "Em Manutenção",
  INACTIVE: "Inativa",
};

export interface Resource {
  id: string;
  name: string;
  description: string | null;
  /** O formulário de solicitação pede a quantidade. */
  requestsQuantity: boolean;
  /** Aparece no formulário de reserva; false = só inventário das salas (nobreak, splitter…). */
  requestable: boolean;
  /** Texto de exemplo do campo de detalhe; null = não pede detalhe. */
  detailPrompt: string | null;
  /** Se não vazia, o detalhe é um select com estas opções (e é obrigatório). */
  detailOptions: string[];
}

/** Recurso pedido numa solicitação (quantidade/detalhe só nos recursos que pedem isso). */
export interface RequestedResource {
  resourceId: string;
  quantity?: number;
  detail?: string;
}

export interface RoomResourceLink {
  roomId: string;
  resourceId: string;
  quantity: number;
  /** Modelo e patrimônio(s): só vêm para o SAD. */
  model?: string | null;
  assetTags?: string | null;
  resource: Resource;
}

export interface Room {
  id: string;
  name: string;
  building: string;
  floor: string;
  capacity: number;
  roomType: RoomType;
  status: RoomStatus;
  /** Cadeiras extras (professor, rodinha…) além da capacidade da plateia. */
  extraSeats: number | null;
  /** Largura × comprimento, como na planilha (ex.: "10,30 × 9,60 m"). */
  dimensions: string | null;
  /** Outros equipamentos, em texto livre: só vem para o SAD. */
  equipmentNotes?: string | null;
  resources: RoomResourceLink[];
  /** Na ordem da galeria; a primeira é a capa. */
  photos: RoomPhoto[];
}

export interface RoomPhoto {
  id: string;
  caption: string | null;
  position: number;
  /** Dimensões da versão grande, para reservar o espaço antes de carregar. */
  width: number;
  height: number;
}

export type ReservationStatus = "PENDING" | "APPROVED" | "REJECTED" | "CANCELLED";

export interface ReservationSnapshot {
  status: ReservationStatus;
  startTime: string;
  endTime: string;
  roomId: string | null;
  roomName: string | null;
  expectedAttendees: number;
  title: string;
}

export const RESERVATION_STATUS_LABELS: Record<ReservationStatus, string> = {
  PENDING: "Pendente",
  APPROVED: "Aprovada",
  REJECTED: "Rejeitada",
  CANCELLED: "Cancelada",
};

export interface Reservation {
  id: string;
  seriesId: string | null;
  roomId: string | null;
  title: string;
  description: string;
  /** Nulos nas solicitações feitas antes dos formulários por tipo de atividade. */
  activityType: ActivityType | null;
  activityDetails: Record<string, unknown> | null;
  expectedAttendees: number;
  requestedResources: RequestedResource[];
  supportNotes: string | null;
  startTime: string;
  endTime: string;
  status: ReservationStatus;
  rejectionReason: string | null;
  cancelledAt: string | null;
  createdAt: string;
  /** Quando o solicitante alterou a reserva pela última vez (null se nunca). */
  modifiedByRequesterAt: string | null;
  /** Como estava antes da alteração, para o SAD comparar. */
  previousSnapshot: ReservationSnapshot | null;
  room: Room | null;
}

/** Reserva como aparece na fila do Admin (GET /api/admin/reservations). */
export interface AdminReservation extends Omit<Reservation, "room"> {
  room: Omit<Room, "resources"> | null;
  user: { id: string; name: string; email: string };
  series: { id: string; rrule: string; untilDate: string | null } | null;
  reviewedBy: { id: string; name: string } | null;
  reviewedAt: string | null;
}

/** "single": só a ocorrência; "series": todas as ocorrências futuras pendentes da série. */
export type ReviewScope = "single" | "series";

export interface RoomOption {
  room: Room;
  fitsCapacity: boolean;
  /** Recursos que a sala não tem (`available` = 0) ou tem em quantidade menor que a pedida. */
  missingResources: { resourceId: string; requested: number; available: number }[];
  conflictingDates: string[];
}

/** Uma sala na consulta de "Salas livres" do SAD (GET /api/admin/availability). */
export interface RoomAvailability {
  room: Room;
  free: boolean;
  busy: (
    | { type: "reservation"; start: string; end: string; title: string; status: ReservationStatus; requester: string }
    | { type: "block"; start: string; end: string; reason: string }
  )[];
}

export interface BusyInterval {
  start: string;
  end: string;
  type: "reservation" | "block";
  status?: ReservationStatus;
  reason?: string;
}
