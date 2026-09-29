import type { Prisma, PrismaClient } from "@prisma/client";
import { holidayName } from "../lib/calendar";
import { AppError } from "../lib/errors";
import { zonedDateKey } from "../lib/timezone";
import type { Occurrence } from "./recurrence";

// Peças das Portarias 2793/2794 usadas pelas rotas de reserva: protocolo,
// montagem, feriados nas séries e suspensão de solicitantes.

type Db = PrismaClient | Prisma.TransactionClient;

/** Próximo nº de protocolo (Art. 8º §1º, b), no formato "000123/2026". */
export async function nextProtocol(db: Db): Promise<string> {
  const [row] = await db.$queryRaw<{ n: bigint }[]>`SELECT nextval('reservation_protocol_seq') AS n`;
  return `${String(row!.n).padStart(6, "0")}/${zonedDateKey(new Date()).slice(0, 4)}`;
}

/**
 * O período reservado: a atividade (startTime–endTime do formulário) com a
 * montagem antes (Art. 19 — a montagem é reservada e faz parte do uso).
 */
export function reservedWindow(input: { startTime: Date; endTime: Date; setupMinutes: number }): Occurrence {
  return { start: new Date(input.startTime.getTime() - input.setupMinutes * 60_000), end: input.endTime };
}

/**
 * Numa série, as datas que caem em feriado ou ponto facultativo ficam de fora
 * (Art. 6º). Se não sobrar nenhuma, o pedido é recusado.
 */
export function withoutHolidays(occurrences: Occurrence[]): { kept: Occurrence[]; skipped: { date: string; holiday: string }[] } {
  const kept: Occurrence[] = [];
  const skipped: { date: string; holiday: string }[] = [];
  for (const occ of occurrences) {
    const date = zonedDateKey(occ.start);
    const holiday = holidayName(date);
    if (holiday) skipped.push({ date, holiday });
    else kept.push(occ);
  }
  if (kept.length === 0) {
    throw new AppError(400, "ONLY_HOLIDAYS", "Todas as datas desta série caem em feriados ou pontos facultativos.");
  }
  return { kept, skipped };
}

/** Suspensão de novas reservas em vigor para o usuário (Art. 9º §2º, 11, 17 e 22), se houver. */
export async function activeSuspension(db: Db, userId: string, now = new Date()) {
  const today = new Date(`${zonedDateKey(now)}T00:00:00Z`);
  return db.userSanction.findFirst({
    where: { userId, type: "SUSPENSION", liftedAt: null, OR: [{ until: null }, { until: { gte: today } }] },
    orderBy: { createdAt: "desc" },
  });
}

export async function assertNotSuspended(db: Db, userId: string): Promise<void> {
  const suspension = await activeSuspension(db, userId);
  if (!suspension) return;
  const until = suspension.until ? `até ${suspension.until.toISOString().slice(0, 10).split("-").reverse().join("/")}` : "até a regularização";
  throw new AppError(
    403,
    "USER_SUSPENDED",
    `Suas novas reservas estão suspensas ${until}. Motivo: ${suspension.reason}. Fale com o SAD/NE.`,
    { until: suspension.until, reason: suspension.reason },
  );
}

/** Ausências (não comparecimento sem cancelar) nos últimos 12 meses — 3 ou mais = recorrência (Art. 9º §2º). */
export function noShowsInLastYear(db: Db, userId: string, now = new Date()) {
  const since = new Date(now);
  since.setFullYear(since.getFullYear() - 1);
  return db.reservation.findMany({
    where: { userId, noShowAt: { not: null }, startTime: { gte: since } },
    select: { id: true, title: true, startTime: true, protocol: true, room: { select: { name: true } } },
    orderBy: { startTime: "desc" },
  });
}
