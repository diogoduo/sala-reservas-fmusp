import { Router } from "express";
import { z } from "zod";
import { recordAudit } from "../audit/log";
import { deliverNotices, queueNotice, staffEmails } from "../events/notices";
import { asyncHandler } from "../lib/async-handler";
import { AppError } from "../lib/errors";
import { prisma } from "../lib/prisma";
import { zonedClock } from "../lib/timezone";

// Fase 12 — resposta da Diretoria Executiva pelo link do e-mail, sem login: o
// token do link é o segredo (24 bytes aleatórios). Na demonstração, o código de
// acesso do site continua valendo antes disso.
export const authorizationsRouter = Router();

async function findByToken(token: string) {
  const authorization = await prisma.eventAuthorization.findUnique({
    where: { token },
    include: { event: { include: { days: { orderBy: { date: "asc" } } } } },
  });
  if (!authorization) throw new AppError(404, "AUTHORIZATION_NOT_FOUND", "Link de autorização inválido ou expirado.");
  return authorization;
}

authorizationsRouter.get(
  "/:token",
  asyncHandler(async (req, res) => {
    const a = await findByToken(req.params.token!);
    const e = a.event;
    res.json({
      authorization: { status: a.status, spaces: a.spaces, note: a.note, requestedAt: a.requestedAt, requestedByName: a.requestedByName, respondedAt: a.respondedAt, responseNote: a.responseNote },
      event: {
        protocol: e.protocol,
        title: e.title,
        description: e.description,
        expectedAttendees: e.expectedAttendees,
        responsible: e.responsible,
        responsibleContact: e.responsibleContact,
        department: e.department,
        days: e.days.map((d) => ({ date: d.date.toISOString().slice(0, 10), start: zonedClock(d.startTime), end: zonedClock(d.endTime) })),
      },
    });
  }),
);

const decisionSchema = z.object({ decision: z.enum(["AUTHORIZE", "DENY"]), note: z.string().trim().max(2000).optional() });

authorizationsRouter.post(
  "/:token",
  asyncHandler(async (req, res) => {
    const { decision, note } = decisionSchema.parse(req.body);
    const a = await findByToken(req.params.token!);
    if (a.status !== "PENDING") throw new AppError(409, "AUTHORIZATION_ANSWERED", "Este pedido já foi respondido.");
    const status = decision === "AUTHORIZE" ? "AUTHORIZED" : "DENIED";
    const noticeId = await prisma.$transaction(async (tx) => {
      await tx.eventAuthorization.update({ where: { id: a.id }, data: { status, respondedAt: new Date(), responseNote: note || null } });
      await recordAudit(tx, {
        actor: null,
        action: "event.authorization_response",
        entityType: "event",
        entityId: a.event.protocol,
        label: `${a.event.protocol} — ${a.event.title}`,
        details: { by: "Diretoria Executiva (link do e-mail)", decision: status, spaces: a.spaces, ...(note && { note }) },
      });
      const notice = await queueNotice(tx, {
        eventId: a.eventId,
        to: await staffEmails(tx, { withSad: true }),
        subject: `Diretoria ${status === "AUTHORIZED" ? "autorizou" : "negou"}: ${a.event.title}`,
        heading: status === "AUTHORIZED" ? "Uso autorizado pela Diretoria" : "Uso negado pela Diretoria",
        paragraphs: [`A Diretoria Executiva ${status === "AUTHORIZED" ? "autorizou" : "negou"} o uso de ${a.spaces} no evento ${a.event.protocol}.`, ...(note ? [`Observação: ${note}`] : [])],
        path: `/admin/eventos/${a.eventId}`,
      });
      return notice.id;
    });
    deliverNotices([noticeId]);
    res.json({ status });
  }),
);
