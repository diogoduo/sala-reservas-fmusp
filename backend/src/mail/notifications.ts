import type { Prisma } from "@prisma/client";
import { env } from "../config/env";
import { prisma } from "../lib/prisma";
import { ACTIVITY_TYPE_LABELS } from "../reservations/activities";
import { parseRequestedResources } from "../reservations/requested-resources";
import { renderMail, type MailContent } from "./layout";
import type { Mail } from "./mailer";

// Fase 7 — avisos por e-mail. Cada função recebe os ids afetados por UMA ação
// (uma data, ou as datas de uma série tratadas de uma vez) e devolve os e-mails
// a enviar: um por destinatário, nunca um por data.

const include = { user: true, room: true } satisfies Prisma.ReservationInclude;
type LoadedReservation = Prisma.ReservationGetPayload<{ include: typeof include }>;

function load(ids: string[]): Promise<LoadedReservation[]> {
  return prisma.reservation.findMany({ where: { id: { in: ids } }, include, orderBy: { startTime: "asc" } });
}

const dateFormat = new Intl.DateTimeFormat("pt-BR", {
  timeZone: env.APP_TIMEZONE,
  weekday: "short",
  day: "2-digit",
  month: "2-digit",
  year: "numeric",
});
const timeFormat = new Intl.DateTimeFormat("pt-BR", { timeZone: env.APP_TIMEZONE, hour: "2-digit", minute: "2-digit" });

/** "qua., 14/10/2026 · 14:00–16:00" no fuso da aplicação (não no do servidor). */
const formatSlot = (r: { startTime: Date; endTime: Date }) =>
  `${dateFormat.format(r.startTime)} · ${timeFormat.format(r.startTime)}–${timeFormat.format(r.endTime)}`;

/** Salas distintas entre as datas (numa série, cada data pode ter sido aprovada numa sala). */
const roomsOf = (list: LoadedReservation[]) =>
  [...new Set(list.flatMap((r) => (r.room ? [`${r.room.name} — ${r.room.building}, ${r.room.floor}`] : [])))].join("; ");

const requesterOf = (r: LoadedReservation) => `${r.user.name} (${r.user.email})`;

const mail = (to: string[], subject: string, content: MailContent): Mail => ({
  to,
  subject: `[Reservas FMUSP] ${subject}`,
  ...renderMail(content),
});

/** O SAD (Serviço de Apoio Didático) são todos os usuários Admin. */
async function adminEmails(): Promise<string[]> {
  const admins = await prisma.user.findMany({ where: { role: "ADMIN" }, select: { email: true } });
  return admins.map((a) => a.email);
}

/** "Datashow/Projetor; Computador de Apoio (2); Webconferência: Zoom", ou null se não pediu nada. */
async function describeResources(json: Prisma.JsonValue): Promise<string | null> {
  const requested = parseRequestedResources(json);
  if (requested.length === 0) return null;
  const resources = await prisma.resource.findMany({ where: { id: { in: requested.map((r) => r.resourceId) } } });
  const names = new Map(resources.map((r) => [r.id, r.name]));
  return requested
    .map((r) => `${names.get(r.resourceId) ?? "recurso removido"}${r.quantity ? ` (${r.quantity})` : ""}${r.detail ? `: ${r.detail}` : ""}`)
    .join("; ");
}

/** Nova solicitação: confirmação para o solicitante e aviso para o SAD. */
export async function requestReceivedMails(ids: string[]): Promise<Mail[]> {
  const list = await load(ids);
  const first = list[0];
  if (!first) return [];
  const dates = list.map(formatSlot);

  return [
    mail([first.user.email], `Solicitação recebida: ${first.title}`, {
      heading: "Recebemos sua solicitação de reserva",
      paragraphs: [
        `Olá, ${first.user.name}. A solicitação "${first.title}" foi registrada e está pendente.`,
        "O SAD (Serviço de Apoio Didático) vai escolher a sala mais adequada, e você recebe outro e-mail quando ela for aprovada ou rejeitada.",
      ],
      dates,
    }),
    mail(await adminEmails(), `Nova solicitação: ${first.title}`, {
      heading: "Nova solicitação de reserva",
      paragraphs: ["Há uma nova solicitação aguardando análise na aba Solicitações."],
      details: [
        ["Solicitante", requesterOf(first)],
        ...(first.activityType ? [["Atividade", ACTIVITY_TYPE_LABELS[first.activityType]] as [string, string]] : []),
        ["Participantes", String(first.expectedAttendees)],
      ],
      dates,
    }),
  ];
}

/** Aprovação: sala e datas para o solicitante; se pediu equipamentos, aviso para a TI. */
export async function approvedMails(ids: string[]): Promise<Mail[]> {
  const list = await load(ids);
  const first = list[0];
  if (!first) return [];
  const dates = list.map(formatSlot);
  const rooms = roomsOf(list);

  // Aprovação parcial de série: as datas ocupadas continuam pendentes.
  const stillPending = first.seriesId
    ? await prisma.reservation.count({ where: { seriesId: first.seriesId, status: "PENDING" } })
    : 0;

  const mails = [
    mail([first.user.email], `Reserva aprovada: ${first.title}`, {
      heading: "Sua reserva foi aprovada",
      paragraphs: [
        `Olá, ${first.user.name}. A reserva "${first.title}" foi aprovada.`,
        ...(stillPending === 1 ? ["1 data desta série continua em análise."] : []),
        ...(stillPending > 1 ? [`${stillPending} datas desta série continuam em análise.`] : []),
      ],
      details: [["Sala", rooms]],
      dates,
    }),
  ];

  const resources = await describeResources(first.requestedResources);
  if (resources) {
    mails.push(
      mail([env.TI_EMAIL_ADDRESS], `Preparar recursos: ${first.title}`, {
        heading: "Reserva aprovada com recursos técnicos",
        paragraphs: ["Uma reserva aprovada pede equipamentos. Confira o que preparar em cada data."],
        details: [
          ["Sala", rooms],
          ["Recursos", resources],
          ...(first.supportNotes ? [["Observações", first.supportNotes] as [string, string]] : []),
          ["Solicitante", requesterOf(first)],
        ],
        dates,
      }),
    );
  }
  return mails;
}

/** Rejeição: justificativa para o solicitante. */
export async function rejectedMails(ids: string[]): Promise<Mail[]> {
  const list = await load(ids);
  const first = list[0];
  if (!first) return [];

  return [
    mail([first.user.email], `Solicitação não aprovada: ${first.title}`, {
      heading: "Sua solicitação não foi aprovada",
      paragraphs: [
        `Olá, ${first.user.name}. A solicitação "${first.title}" não pôde ser aprovada.`,
        "Se quiser, faça uma nova solicitação com outra data ou horário.",
      ],
      details: [["Justificativa", first.rejectionReason ?? "—"]],
      dates: list.map(formatSlot),
    }),
  ];
}

const STATUS_LABELS: Record<string, string> = { PENDING: "pendente", APPROVED: "aprovada", REJECTED: "rejeitada", CANCELLED: "cancelada" };

/** Lê o retrato "antes da alteração" guardado em reservations.previous_snapshot. */
function snapshotOf(json: Prisma.JsonValue | null): { status: string; startTime: Date; endTime: Date; roomName: string | null } | null {
  if (!json || typeof json !== "object" || Array.isArray(json)) return null;
  const s = json as Prisma.JsonObject;
  if (typeof s.startTime !== "string" || typeof s.endTime !== "string") return null;
  return {
    status: String(s.status),
    startTime: new Date(s.startTime),
    endTime: new Date(s.endTime),
    roomName: typeof s.roomName === "string" ? s.roomName : null,
  };
}

/**
 * Alteração pelo solicitante: a reserva volta para análise. Confirmação para o
 * solicitante, aviso para o SAD (com o "antes") e, se estava aprovada com
 * equipamentos, para a TI esperar a nova aprovação.
 */
export async function modifiedMails(ids: string[]): Promise<Mail[]> {
  const list = await load(ids);
  const first = list[0];
  if (!first) return [];
  const dates = list.map(formatSlot);
  const before = snapshotOf(first.previousSnapshot);
  const beforeLine = before
    ? `${formatSlot(before)}${before.roomName ? ` · ${before.roomName}` : ""} (${STATUS_LABELS[before.status] ?? before.status})`
    : null;

  const mails = [
    mail([first.user.email], `Alteração recebida: ${first.title}`, {
      heading: "Recebemos a alteração da sua reserva",
      paragraphs: [
        `Olá, ${first.user.name}. A reserva "${first.title}" foi alterada e voltou para análise do SAD.`,
        "Você recebe outro e-mail quando ela for aprovada ou rejeitada.",
      ],
      dates,
    }),
    mail(await adminEmails(), `Reserva alterada: ${first.title}`, {
      heading: "Reserva alterada pelo solicitante",
      paragraphs: ["Ela voltou para análise e está na aba Alteradas, em Solicitações."],
      details: [
        ["Solicitante", requesterOf(first)],
        ...(beforeLine ? [["Antes", beforeLine] as [string, string]] : []),
      ],
      dates,
    }),
  ];

  const resources = before?.status === "APPROVED" ? await describeResources(first.requestedResources) : null;
  if (resources && beforeLine) {
    mails.push(
      mail([env.TI_EMAIL_ADDRESS], `Aguardar nova aprovação: ${first.title}`, {
        heading: "Reserva aprovada com recursos foi alterada",
        paragraphs: ["Ela voltou para análise do SAD. Espere a nova aprovação antes de preparar os recursos."],
        details: [
          ["Antes", beforeLine],
          ["Recursos", resources],
        ],
        dates,
      }),
    );
  }
  return mails;
}

/**
 * Cancelamento pelo solicitante: aviso para o SAD e, se alguma data já
 * estava aprovada com equipamentos, para a TI não preparar à toa.
 */
export async function cancelledMails(ids: string[]): Promise<Mail[]> {
  const list = await load(ids);
  const first = list[0];
  if (!first) return [];
  // Só aprovadas e rejeitadas têm revisão, e rejeitadas não podem ser canceladas.
  const wereApproved = list.filter((r) => r.reviewedAt !== null);

  const mails = [
    mail(await adminEmails(), `Reserva cancelada: ${first.title}`, {
      heading: "Reserva cancelada pelo solicitante",
      paragraphs: ["O horário já está livre para outras solicitações."],
      details: [
        ["Solicitante", requesterOf(first)],
        ...(wereApproved.length > 0 ? [["Sala", roomsOf(wereApproved)] as [string, string]] : []),
      ],
      dates: list.map(formatSlot),
    }),
  ];

  const resources = wereApproved.length > 0 ? await describeResources(first.requestedResources) : null;
  if (resources) {
    mails.push(
      mail([env.TI_EMAIL_ADDRESS], `Recursos dispensados: ${first.title}`, {
        heading: "Reserva cancelada: não é mais preciso preparar os recursos",
        paragraphs: ["O solicitante cancelou uma reserva aprovada que pedia equipamentos."],
        details: [
          ["Sala", roomsOf(wereApproved)],
          ["Recursos", resources],
        ],
        dates: wereApproved.map(formatSlot),
      }),
    );
  }
  return mails;
}
