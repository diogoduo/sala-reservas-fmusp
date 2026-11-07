import type { Prisma, PrismaClient } from "@prisma/client";
import { env } from "../config/env";
import { renderMail } from "../mail/layout";
import { sendNow } from "../mail/mailer";
import { prisma } from "../lib/prisma";

// Fase 12 — e-mails do evento. Cada aviso fica gravado (event_notices) na mesma
// transação da ação, e a tela do evento mostra o que foi enviado. Com o e-mail
// desligado (MAIL_ENABLED=false, como na demonstração), o aviso fica registrado
// como "não enviado" e o link continua visível na tela.

type Db = PrismaClient | Prisma.TransactionClient;

export interface NoticeInput {
  eventId: string;
  to: string[];
  subject: string;
  heading: string;
  paragraphs: string[];
  details?: [string, string][];
  /** Caminho no site ("/eventos/<id>"); vira link completo. */
  path?: string;
}

const fullLink = (path?: string) => (path ? `${env.FRONTEND_URL.replace(/\/$/, "")}${path}` : null);

/** Grava o aviso; envie depois do commit com `deliverNotices`. */
export async function queueNotice(db: Db, notice: NoticeInput) {
  const link = fullLink(notice.path);
  const lines = [
    ...notice.paragraphs,
    ...(notice.details ?? []).map(([label, value]) => `${label}: ${value}`),
    ...(link ? [`Acesse: ${link}`] : []),
  ];
  return db.eventNotice.create({
    data: { eventId: notice.eventId, to: [...new Set(notice.to.filter(Boolean))], subject: notice.subject, body: lines.join("\n"), link },
    select: { id: true },
  });
}

/** Envia os avisos gravados, sem segurar a resposta; marca `sentAt` quando o envio funciona. */
export function deliverNotices(ids: string[]): void {
  // Na demonstração sem MAIL_REDIRECT_TO o mailer não manda nada (trava das contas
  // de teste): o aviso fica "Registrado", sem marcar como enviado.
  const willSend = env.MAIL_ENABLED && (!env.DEMO_MODE || Boolean(env.MAIL_REDIRECT_TO));
  if (ids.length === 0 || !willSend) return;
  void (async () => {
    for (const id of ids) {
      const notice = await prisma.eventNotice.findUnique({ where: { id } });
      if (!notice || notice.to.length === 0) continue;
      const paragraphs = notice.body.split("\n").filter(Boolean);
      const { text, html } = renderMail({ heading: notice.subject, paragraphs });
      try {
        await sendNow({ to: notice.to, subject: notice.subject, text, html });
        await prisma.eventNotice.update({ where: { id }, data: { sentAt: new Date() } });
      } catch (error) {
        console.error(`[e-mail] falha ao enviar "${notice.subject}":`, error);
      }
    }
  })();
}

/** E-mails da equipe que acompanha os eventos: o NUCEV (e o SAD, quando `withSad`). */
export async function staffEmails(db: Db, { withSad = false } = {}): Promise<string[]> {
  const people = await db.user.findMany({ where: { role: { in: withSad ? ["NUCEV", "ADMIN"] : ["NUCEV"] } }, select: { email: true } });
  return people.map((p) => p.email);
}

export async function sadEmails(db: Db): Promise<string[]> {
  const people = await db.user.findMany({ where: { role: "ADMIN" }, select: { email: true } });
  return people.map((p) => p.email);
}
