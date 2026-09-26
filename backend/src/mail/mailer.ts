import nodemailer from "nodemailer";
import { env } from "../config/env";

// Em dev, aponta para o Mailpit do docker-compose (caixa de entrada em http://localhost:8025).
const transport = nodemailer.createTransport({
  host: env.SMTP_HOST,
  port: env.SMTP_PORT,
  secure: env.SMTP_SECURE,
  auth: env.SMTP_USER ? { user: env.SMTP_USER, pass: env.SMTP_PASS } : undefined,
});

export interface Mail {
  to: string[];
  subject: string;
  text: string;
  html: string;
}

async function send(mail: Mail): Promise<void> {
  if (mail.to.length === 0) return;
  await transport.sendMail({ from: env.MAIL_FROM, ...mail });
}

/**
 * Envia sem segurar a resposta HTTP. É chamado depois que a transação terminou:
 * a reserva já está gravada, então uma falha de SMTP não pode virar erro para
 * quem fez a ação — só vai para o log. (Em produção, o próximo passo seria uma
 * tabela de "outbox" com novas tentativas.)
 */
export function sendInBackground(label: string, build: () => Promise<Mail[]>): void {
  build()
    .then((mails) => Promise.all(mails.map(send)))
    .catch((error: unknown) => console.error(`[e-mail] falha ao enviar "${label}":`, error));
}
