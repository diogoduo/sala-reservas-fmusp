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

/** "Reserva de Salas FMUSP <no-reply@fm.usp.br>" → { name, email }. */
function parseAddress(address: string): { name?: string; email: string } {
  const match = address.match(/^\s*"?([^"<]*?)"?\s*<([^>]+)>\s*$/);
  return match ? { name: match[1]!.trim() || undefined, email: match[2]!.trim() } : { email: address.trim() };
}

/**
 * Na demonstração (MAIL_REDIRECT_TO), os e-mails das contas de teste vão para
 * um endereço só, com o destinatário original no assunto. Quem está em
 * MAIL_REDIRECT_EXCEPT (ex.: o e-mail real da TI) continua recebendo direto.
 *
 * Trava de segurança: com DEMO_MODE e sem MAIL_REDIRECT_TO, só os endereços de
 * MAIL_REDIRECT_EXCEPT recebem — as contas de teste (aluno@usp.br…) podem ser
 * caixas reais da USP e nunca recebem e-mail da demonstração.
 */
function applyRedirect(mail: Mail): Mail[] {
  if (!env.MAIL_REDIRECT_TO && !env.DEMO_MODE) return [mail];
  const direct = mail.to.filter((to) => env.MAIL_REDIRECT_EXCEPT.includes(to.toLowerCase()));
  const redirected = mail.to.filter((to) => !direct.includes(to));
  if (!env.MAIL_REDIRECT_TO) {
    if (redirected.length > 0) console.log(`[e-mail] demonstração sem MAIL_REDIRECT_TO, não enviado: "${mail.subject}" → ${redirected.join(", ")}`);
    return direct.length > 0 ? [{ ...mail, to: direct }] : [];
  }
  return [
    ...(direct.length > 0 ? [{ ...mail, to: direct }] : []),
    ...(redirected.length > 0 ? [{ ...mail, to: [env.MAIL_REDIRECT_TO], subject: `${mail.subject} (para: ${redirected.join(", ")})` }] : []),
  ];
}

async function sendWithBrevo(mail: Mail, apiKey: string): Promise<void> {
  const response = await fetch("https://api.brevo.com/v3/smtp/email", {
    method: "POST",
    headers: { "api-key": apiKey, "Content-Type": "application/json", Accept: "application/json" },
    body: JSON.stringify({
      sender: parseAddress(env.MAIL_FROM),
      to: mail.to.map((email) => ({ email })),
      subject: mail.subject,
      htmlContent: mail.html,
      textContent: mail.text,
    }),
  });
  if (!response.ok) throw new Error(`Brevo respondeu ${response.status}: ${await response.text()}`);
}

async function send(original: Mail): Promise<void> {
  if (original.to.length === 0) return;
  for (const mail of applyRedirect(original)) {
    if (!env.MAIL_ENABLED) {
      console.log(`[e-mail] MAIL_ENABLED=false, não enviado: "${mail.subject}" → ${mail.to.join(", ")}`);
    } else if (env.BREVO_API_KEY) {
      await sendWithBrevo(mail, env.BREVO_API_KEY);
    } else {
      await transport.sendMail({ from: env.MAIL_FROM, ...mail });
    }
  }
}

/** Envia na hora e deixa o erro subir (usado pelo "e-mail de teste" do SAD). */
export async function sendNow(mail: Mail): Promise<void> {
  await send(mail);
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
