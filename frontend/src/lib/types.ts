export type RoomType =
  | "AUDITORIUM"
  | "LABORATORY"
  | "CLASSROOM"
  | "MEETING_ROOM"
  | "MULTIPURPOSE"
  | "COMPUTER_LAB"
  | "BOARD_ROOM"
  | "THEATER";
export type ActivityType = "UNDERGRADUATE" | "GRADUATE" | "CULTURE_EXTENSION" | "PUBLIC_EXAM" | "DEFENSE" | "ADMINISTRATIVE";
export type RoomStatus = "ACTIVE" | "MAINTENANCE" | "INACTIVE";
export type SeatType = "SCHOOL" | "UNIVERSITY_FIXED" | "UNIVERSITY_MOBILE";
export type NotebookLocation = "SAD" | "NIT";

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

/** Tipos de cadeira da planilha do SAD. */
export const SEAT_TYPE_LABELS: Record<SeatType, string> = {
  SCHOOL: "Escolar",
  UNIVERSITY_FIXED: "Universitária fixa",
  UNIVERSITY_MOBILE: "Universitária móvel",
};

export const NOTEBOOK_LOCATION_LABELS: Record<NotebookLocation, string> = {
  SAD: "Backup no SAD",
  NIT: "Transferidos para o NIT",
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
  /** Cadeiras da plateia. null = a definir: só em sala que não está Ativa (ex.: em reforma). */
  capacity: number | null;
  roomType: RoomType;
  status: RoomStatus;
  seatTypes: SeatType[];
  /** Porta de 900 mm. */
  wideDoor: boolean;
  /** Sala preparada para atendimento especial. */
  specialNeeds: boolean;
  /**
   * Cadeiras extras (professor, rodinha…) além da capacidade da plateia. Só vem
   * para o SAD: não contam como lugar (Portaria 2793, Art. 5º §2º).
   */
  extraSeats?: number | null;
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

/** Notebook do SAD (só controle de patrimônio; não é reservado pelo sistema). */
export interface Notebook {
  id: string;
  assetTag: string;
  model: string | null;
  location: NotebookLocation;
  notes: string | null;
  updatedAt: string;
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

/** Conferência do SAD ao confirmar Cultura e Extensão (Portaria 2793, Art. 20 §3º e Art. 14 §3º). */
export interface ApprovalChecklist {
  ccexAuthorized: boolean;
  academicDivisionApproved: boolean;
  feeSettled: boolean;
  directorateHomologated: boolean;
  checkedAt?: string;
}

export interface Reservation {
  id: string;
  /** Nº de protocolo do pedido (Art. 8º §1º, b); o mesmo em todas as datas de uma série. */
  protocol: string;
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
  /** Início do período reservado — já inclui a montagem (a atividade começa setupMinutes depois). */
  startTime: string;
  endTime: string;
  /** Montagem antes da atividade, reservada junto (Art. 19). */
  setupMinutes: number;
  /** Domingo, feriado ou fora das 07h–22h, com autorização da Divisão Acadêmica (Art. 6º §1º). */
  outsideRegularHours: boolean;
  /** Compromisso do Art. 23 (sem comércio nem consumo de bebidas alcoólicas). */
  noAlcoholCommitment: boolean;
  coffeeBreak: boolean;
  approvalChecklist: ApprovalChecklist | null;
  /** Ausência (não comparecimento sem cancelar) registrada pelo SAD (Art. 9º §2º). */
  noShowAt: string | null;
  status: ReservationStatus;
  rejectionReason: string | null;
  cancelledAt: string | null;
  createdAt: string;
  /** Quando o solicitante alterou a reserva pela última vez (null se nunca). */
  modifiedByRequesterAt: string | null;
  /** Como estava antes da alteração, para o SAD comparar. */
  previousSnapshot: ReservationSnapshot | null;
  /** Quem cancelou (o solicitante ou alguém do SAD) e, se foi o SAD, o motivo. */
  cancelledById: string | null;
  cancellationReason: string | null;
  /** Última alteração feita pelo SAD (não devolve a reserva para análise). */
  modifiedByAdminAt: string | null;
  room: Room | null;
  /** Quem pediu (útil para o SAD ao alterar). */
  user?: { name: string; email: string };
}

/** Reserva como aparece na fila do Admin (GET /api/admin/reservations). */
export interface AdminReservation extends Omit<Reservation, "room"> {
  room: Omit<Room, "resources"> | null;
  user: { id: string; name: string; email: string };
  series: { id: string; rrule: string; untilDate: string | null } | null;
  reviewedBy: { id: string; name: string } | null;
  reviewedAt: string | null;
  cancelledBy: { id: string; name: string } | null;
  noShowBy: { id: string; name: string } | null;
}

export type SanctionType = "WARNING" | "FINE" | "SUSPENSION";

export const SANCTION_TYPE_LABELS: Record<SanctionType, string> = {
  WARNING: "Advertência",
  FINE: "Multa",
  SUSPENSION: "Suspensão de novas reservas",
};

export interface Sanction {
  id: string;
  userId: string;
  type: SanctionType;
  reason: string;
  /** Suspensão: último dia ("AAAA-MM-DD..."); null = até a regularização. */
  until: string | null;
  createdAt: string;
  createdBy: { id: string; name: string };
  liftedAt: string | null;
  liftedBy: { id: string; name: string } | null;
}

/** Situação de um solicitante para o SAD (ausências em 12 meses e sanções). */
export interface RequesterStanding {
  user: { id: string; name: string; email: string };
  noShows: { id: string; title: string; startTime: string; protocol: string; room: { name: string } | null }[];
  sanctions: Sanction[];
  activeSuspensionId: string | null;
}

/** "single": só a ocorrência; "series": todas as ocorrências futuras pendentes da série. */
export type ReviewScope = "single" | "series";

export interface RoomOption {
  room: Room;
  fitsCapacity: boolean;
  /** Pedido com coffee break só vai para salas que permitem (Portaria 2794, Art. 5º). */
  coffeeBreakAllowed: boolean;
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
  /** Reserva: título e tipo de atividade aparecem para todos. */
  id?: string;
  title?: string;
  activityType?: ActivityType | null;
  setupMinutes?: number;
  /** Só para o SAD: o resto da reserva. */
  protocol?: string;
  requester?: { name: string; email: string };
  expectedAttendees?: number;
  description?: string;
  supportNotes?: string | null;
  seriesId?: string | null;
  modified?: boolean;
  resources?: string[];
}

/** Regulamento (portarias) aceito no formulário de reserva. */
export interface Regulation {
  title: string;
  body: string;
  updatedAt: string;
}

export interface RegulationFile {
  id: string;
  fileName: string;
  size: number;
  createdAt: string;
}
