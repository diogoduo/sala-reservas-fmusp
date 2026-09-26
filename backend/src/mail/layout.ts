import { env } from "../config/env";

/** Conteúdo de um e-mail; `renderMail` gera as versões em texto e HTML. */
export interface MailContent {
  heading: string;
  paragraphs: string[];
  /** Pares rótulo/valor (sala, solicitante, justificativa…). */
  details?: [string, string][];
  /** Datas e horários, uma por linha. */
  dates?: string[];
}

const HTML_ENTITIES: Record<string, string> = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" };
// Título, justificativa e observações vêm de usuários: sempre escapar no HTML.
const escapeHtml = (value: string) => value.replace(/[&<>"']/g, (c) => HTML_ENTITIES[c]!);

export function renderMail(content: MailContent): { text: string; html: string } {
  const details = content.details ?? [];
  const dates = content.dates ?? [];

  const text = [
    content.heading,
    "",
    ...content.paragraphs.flatMap((p) => [p, ""]),
    ...details.map(([label, value]) => `${label}: ${value}`),
    ...(dates.length > 0 ? ["", "Datas:", ...dates.map((d) => `  • ${d}`)] : []),
    "",
    "—",
    `Sistema de Reserva de Salas — FMUSP · ${env.FRONTEND_URL}`,
    "Mensagem automática; não responda.",
  ].join("\n");

  const detailRows = details
    .map(
      ([label, value]) =>
        `<tr><td style="color:#64748b;padding:2px 12px 2px 0;vertical-align:top">${escapeHtml(label)}</td>` +
        `<td style="padding:2px 0;white-space:pre-line">${escapeHtml(value)}</td></tr>`,
    )
    .join("");

  const html = `<!doctype html>
<html lang="pt-BR">
<body style="margin:0;background:#f1f5f9;font-family:Arial,Helvetica,sans-serif;color:#0f172a">
  <div style="max-width:560px;margin:24px auto;background:#ffffff;border:1px solid #e2e8f0;border-radius:8px;padding:24px">
    <h1 style="font-size:18px;margin:0 0 16px">${escapeHtml(content.heading)}</h1>
    ${content.paragraphs.map((p) => `<p style="font-size:14px;line-height:1.5;margin:0 0 12px">${escapeHtml(p)}</p>`).join("")}
    ${details.length > 0 ? `<table style="font-size:14px;border-collapse:collapse;margin:8px 0 12px">${detailRows}</table>` : ""}
    ${
      dates.length > 0
        ? `<p style="font-size:14px;margin:12px 0 4px;color:#64748b">Datas</p>` +
          `<ul style="font-size:14px;margin:0;padding-left:20px">${dates.map((d) => `<li>${escapeHtml(d)}</li>`).join("")}</ul>`
        : ""
    }
    <p style="font-size:12px;color:#64748b;margin:24px 0 0;border-top:1px solid #e2e8f0;padding-top:12px">
      Sistema de Reserva de Salas — FMUSP ·
      <a href="${escapeHtml(env.FRONTEND_URL)}" style="color:#0f172a">${escapeHtml(env.FRONTEND_URL)}</a><br>
      Mensagem automática; não responda.
    </p>
  </div>
</body>
</html>`;

  return { text, html };
}
