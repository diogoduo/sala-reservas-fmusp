import { Prisma } from "@prisma/client";
import type { Occurrence } from "./recurrence";

/** Algo que ocupa uma sala num intervalo: reserva ativa (PENDING/APPROVED) ou bloqueio. */
export interface BusyInterval {
  roomId: string;
  start: Date;
  end: Date;
}

/**
 * Mesma semântica do intervalo [início, fim) da exclusion constraint do banco
 * (migration db_constraints): uma reserva pode começar exatamente quando outra termina.
 */
export function overlaps(a: Occurrence, b: Occurrence): boolean {
  return a.start < b.end && b.start < a.end;
}

/**
 * Carrega, em duas consultas, tudo o que ocupa as salas informadas na janela
 * coberta pelas ocorrências: reservas ativas (PENDING ou APPROVED) e bloqueios
 * administrativos/manutenção (room_blocks).
 *
 * `excludeReservationIds` tira da conta as próprias reservas sendo avaliadas —
 * uma solicitação que já está pendente numa sala não pode "conflitar consigo
 * mesma" quando o Admin a aprova naquela mesma sala.
 */
export async function loadBusyIntervals(
  db: Prisma.TransactionClient,
  roomIds: string[],
  occurrences: Occurrence[],
  excludeReservationIds: string[] = [],
): Promise<BusyInterval[]> {
  if (roomIds.length === 0 || occurrences.length === 0) return [];

  const rangeStart = new Date(Math.min(...occurrences.map((o) => o.start.getTime())));
  const rangeEnd = new Date(Math.max(...occurrences.map((o) => o.end.getTime())));

  // Sequencial de propósito: consultas paralelas dentro de uma transação
  // interativa do Prisma disputam a mesma conexão.
  const reservations = await db.reservation.findMany({
    where: {
      roomId: { in: roomIds },
      id: { notIn: excludeReservationIds },
      status: { in: ["PENDING", "APPROVED"] },
      startTime: { lt: rangeEnd },
      endTime: { gt: rangeStart },
    },
    select: { roomId: true, startTime: true, endTime: true },
  });
  const blocks = await db.roomBlock.findMany({
    where: { roomId: { in: roomIds }, startTime: { lt: rangeEnd }, endTime: { gt: rangeStart } },
    select: { roomId: true, startTime: true, endTime: true },
  });

  return [
    ...reservations.map((r) => ({ roomId: r.roomId!, start: r.startTime, end: r.endTime })),
    ...blocks.map((b) => ({ roomId: b.roomId, start: b.startTime, end: b.endTime })),
  ];
}

/**
 * Devolve as ocorrências que colidem com alguma reserva ativa ou bloqueio da sala.
 *
 * Deve ser chamado DENTRO de uma transação que já tenha feito `lockRoomForUpdate`
 * na sala, para serializar tentativas concorrentes antes de checar/gravar.
 */
export async function findConflictingOccurrences<T extends Occurrence>(
  tx: Prisma.TransactionClient,
  roomId: string,
  occurrences: T[],
  excludeReservationIds: string[] = [],
): Promise<T[]> {
  const busy = await loadBusyIntervals(tx, [roomId], occurrences, excludeReservationIds);
  return occurrences.filter((occurrence) => busy.some((b) => overlaps(occurrence, b)));
}

/**
 * O Prisma 6 não mapeia a violação de exclusion constraint (SQLSTATE 23P01)
 * para um código P2xxx: ela chega como PrismaClientUnknownRequestError, com o
 * código do Postgres só dentro da mensagem (conferido na prática, não é suposição).
 */
export function isOverlapViolation(error: unknown): boolean {
  return error instanceof Prisma.PrismaClientUnknownRequestError && error.message.includes("23P01");
}

/** Trava a linha da sala (SELECT ... FOR UPDATE) para serializar gravações concorrentes. */
export async function lockRoomForUpdate(tx: Prisma.TransactionClient, roomId: string): Promise<void> {
  await tx.$queryRaw`SELECT id FROM rooms WHERE id = ${roomId}::uuid FOR UPDATE`;
}
