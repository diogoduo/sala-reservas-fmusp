import { Router } from "express";
import { z } from "zod";
import { env } from "../config/env";
import { asyncHandler } from "../lib/async-handler";
import { AppError } from "../lib/errors";
import { prisma } from "../lib/prisma";
import { renderMail } from "../mail/layout";
import { sendInBackground } from "../mail/mailer";
import { isStaff, requireAuth } from "../middleware/auth";

// Fase 19 — conversa de cada reserva (documento SAD/NUCEV, 2.2): entre quem
// pediu e o SAD, pelo protocolo (uma série inteira tem uma conversa só). Histórico
// permanente, com o autor, a data e a hora de cada mensagem. Cada mensagem avisa
// o outro lado por e-mail. O NUCEV acompanha (só lê), como no resto das reservas.
export const conversationsRouter = Router();
conversationsRouter.use(requireAuth);

/** O pedido (qualquer data do protocolo) e quem pode ver e escrever. */
async function access(protocol: string, user: { id: string; role: string }) {
  const reservation = await prisma.reservation.findFirst({
    where: { protocol },
    select: { protocol: true, title: true, userId: true, eventId: true, user: { select: { email: true, name: true } } },
  });
  const owner = reservation?.userId === user.id;
  if (!reservation || (!owner && !isStaff(user.role as never))) throw new AppError(404, "NOT_FOUND", "Reserva não encontrada.");
  return { reservation, canWrite: owner || user.role === "ADMIN", owner };
}

conversationsRouter.get(
  "/:protocol",
  asyncHandler(async (req, res) => {
    const { reservation, canWrite } = await access(req.params.protocol!, req.user!);
    const messages = await prisma.reservationMessage.findMany({ where: { protocol: reservation.protocol }, orderBy: { createdAt: "asc" } });
    res.json({ protocol: reservation.protocol, title: reservation.title, canWrite, messages });
  }),
);

conversationsRouter.post(
  "/:protocol",
  asyncHandler(async (req, res) => {
    const { body } = z.object({ body: z.string().trim().min(1, "Escreva a mensagem.").max(4000) }).parse(req.body);
    const { reservation, canWrite, owner } = await access(req.params.protocol!, req.user!);
    if (!canWrite) throw new AppError(403, "FORBIDDEN", "Quem conversa sobre a reserva é quem pediu e o SAD.");
    const message = await prisma.reservationMessage.create({
      data: { protocol: reservation.protocol, authorId: req.user!.id, authorName: req.user!.name, authorRole: req.user!.role, body },
    });

    // Avisa o outro lado: o SAD, quando quem pediu escreve; quem pediu, quando o SAD responde.
    sendInBackground("mensagem na reserva", async () => {
      const to = owner ? (await prisma.user.findMany({ where: { role: "ADMIN" }, select: { email: true } })).map((u) => u.email) : [reservation.user.email];
      const path = owner ? "/admin/solicitacoes" : "/minhas-reservas";
      const { text, html } = renderMail({
        heading: `Nova mensagem sobre a reserva ${reservation.protocol}`,
        paragraphs: [`${req.user!.name} escreveu:`, body, `Responda pelo sistema: ${env.FRONTEND_URL.replace(/\/$/, "")}${path}`],
        details: [
          ["Protocolo", reservation.protocol],
          ["Atividade", reservation.title],
        ],
      });
      return [{ to, subject: `[Reservas FMUSP] Nova mensagem: ${reservation.title}`, text, html }];
    });

    res.status(201).json({ message });
  }),
);
