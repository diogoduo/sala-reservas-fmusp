import type { EventStatus } from "@prisma/client";
import { recordAudit } from "../audit/log";
import { prisma } from "../lib/prisma";
import { deliverNotices, queueNotice, staffEmails } from "./notices";

// Fase 12 — pré-reserva vencida. Enquanto o evento não tem o comprovante de
// pagamento, a pré-reserva vale até a data definida pelo SAD; vencida, o sistema
// cancela as reservas do evento (a sala fica livre) e marca o evento como
// "Pré-reserva vencida". Com o comprovante já enviado, a pré-reserva não vence:
// a decisão fica com o NUCEV e o SAD.

/** Situações em que a pré-reserva pode vencer. */
export const EXPIRABLE: EventStatus[] = ["PRE_RESERVED", "QUOTE_SENT", "CHANGES_REQUESTED", "QUOTE_APPROVED"];

export async function expireOverduePreReservations(now: Date = new Date()): Promise<number> {
  const overdue = await prisma.event.findMany({
    where: { status: { in: EXPIRABLE }, preReservedUntil: { lt: now } },
    select: { id: true, protocol: true, title: true, status: true, preReservedUntil: true, user: { select: { email: true } } },
  });
  const noticeIds: string[] = [];
  for (const event of overdue) {
    await prisma.$transaction(async (tx) => {
      // Outra execução pode ter chegado antes.
      const current = await tx.event.findUnique({ where: { id: event.id }, select: { status: true } });
      if (!current || !EXPIRABLE.includes(current.status)) return;
      await tx.reservation.updateMany({
        where: { eventId: event.id, status: { in: ["PENDING", "APPROVED"] } },
        data: { status: "CANCELLED", cancelledAt: now, cancellationReason: "Pré-reserva do evento vencida sem pagamento." },
      });
      await tx.event.update({ where: { id: event.id }, data: { status: "EXPIRED", preReservedUntil: null } });
      await recordAudit(tx, {
        actor: null,
        action: "event.expire",
        entityType: "event",
        entityId: event.protocol,
        label: `${event.protocol} — ${event.title}`,
        changes: { status: { from: event.status, to: "EXPIRED" } },
        details: { preReservedUntil: event.preReservedUntil?.toISOString() ?? null },
      });
      const notice = await queueNotice(tx, {
        eventId: event.id,
        to: [event.user.email, ...(await staffEmails(tx, { withSad: true }))],
        subject: `Pré-reserva vencida: ${event.title}`,
        heading: "Pré-reserva vencida",
        paragraphs: [`A pré-reserva do evento ${event.protocol} venceu sem o pagamento, e os espaços foram liberados.`],
        path: `/eventos/${event.id}`,
      });
      noticeIds.push(notice.id);
    });
  }
  deliverNotices(noticeIds);
  return overdue.length;
}

/** Confere a cada 5 minutos (o servidor do Render dorme sem uso; ao acordar, a primeira consulta já confere). */
export function scheduleExpiry(): void {
  const run = () => expireOverduePreReservations().catch((error: unknown) => console.error("[eventos] falha ao vencer pré-reservas:", error));
  setInterval(run, 5 * 60_000).unref();
  void run();
}
