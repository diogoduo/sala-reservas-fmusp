import { CheckCircleIcon, StampIcon, XCircleIcon } from "@phosphor-icons/react";
import { useEffect, useState } from "react";
import { useParams } from "react-router";
import { api, ApiError } from "../../lib/api";
import { AUTHORIZATION_LABELS, dayLabel, dateTimeText, type AuthorizationStatus } from "../../lib/events";
import { Badge } from "../ui/Badge";
import { Button } from "../ui/Button";
import { Alert } from "../ui/Feedback";
import { Textarea } from "../ui/Field";
import { Logo } from "../ui/Logo";
import { Card } from "../ui/Surface";

interface AuthorizationResponse {
  authorization: {
    status: AuthorizationStatus;
    spaces: string;
    note: string | null;
    requestedAt: string;
    requestedByName: string | null;
    respondedAt: string | null;
    responseNote: string | null;
  };
  event: {
    protocol: string;
    title: string;
    description: string;
    expectedAttendees: number;
    responsible: string;
    responsibleContact: string;
    department: string;
    days: { date: string; start: string; end: string }[];
  };
}

/** Link do e-mail da Diretoria Executiva (Fase 12): autorizar ou negar, sem login. */
export function AuthorizationPage() {
  const { token } = useParams();
  const [data, setData] = useState<AuthorizationResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState<"AUTHORIZE" | "DENY" | null>(null);

  const load = () =>
    api<AuthorizationResponse>(`/authorizations/${token}`)
      .then(setData)
      .catch((e) => setError(e instanceof ApiError ? e.message : "Não foi possível abrir o pedido."));

  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token]);

  async function answer(decision: "AUTHORIZE" | "DENY") {
    setBusy(decision);
    try {
      await api(`/authorizations/${token}`, { method: "POST", body: JSON.stringify({ decision, note: note.trim() || undefined }) });
      await load();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Não foi possível registrar a resposta.");
    } finally {
      setBusy(null);
    }
  }

  const a = data?.authorization;
  const e = data?.event;
  return (
    <div className="mx-auto min-h-dvh max-w-2xl space-y-6 px-4 py-8">
      <Logo />
      <div>
        <h1 className="flex items-center gap-2 text-2xl font-bold">
          <StampIcon size={28} aria-hidden /> Autorização da Diretoria Executiva
        </h1>
        <p className="mt-1 text-sm text-muted">Pedido do Núcleo de Eventos (NUCEV) para o uso de espaço que depende de autorização.</p>
      </div>
      {error && <Alert tone="danger">{error}</Alert>}
      {a && e && (
        <>
          <Card className="space-y-4 p-4 sm:p-6">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h2 className="text-lg font-semibold">{e.title}</h2>
              <Badge tone={a.status === "AUTHORIZED" ? "success" : a.status === "DENIED" ? "danger" : "warning"}>{AUTHORIZATION_LABELS[a.status]}</Badge>
            </div>
            <dl className="grid gap-3 text-sm sm:grid-cols-2">
              <div>
                <dt className="text-xs text-muted">Espaço</dt>
                <dd className="font-medium">{a.spaces}</dd>
              </div>
              <div>
                <dt className="text-xs text-muted">Participantes</dt>
                <dd>{e.expectedAttendees} pessoas</dd>
              </div>
              <div className="sm:col-span-2">
                <dt className="text-xs text-muted">Datas e horários</dt>
                <dd>{e.days.map((d) => `${dayLabel(d.date)}, ${d.start}–${d.end}`).join(" · ")}</dd>
              </div>
              <div>
                <dt className="text-xs text-muted">Responsável</dt>
                <dd>
                  {e.responsible} · {e.responsibleContact}
                </dd>
              </div>
              <div>
                <dt className="text-xs text-muted">Protocolo</dt>
                <dd className="tabular-nums">{e.protocol}</dd>
              </div>
            </dl>
            <div>
              <h3 className="text-sm font-semibold">Motivo e programação</h3>
              <p className="mt-1 text-sm whitespace-pre-line text-muted">{e.description}</p>
            </div>
            {a.note && <p className="text-sm">Observação do NUCEV: {a.note}</p>}
            <p className="text-xs text-muted">
              Pedido em {dateTimeText(a.requestedAt)}
              {a.requestedByName ? ` por ${a.requestedByName}` : ""}.
            </p>
          </Card>

          {a.status === "PENDING" ? (
            <Card className="space-y-4 p-4 sm:p-6">
              <Textarea label="Observação (opcional)" rows={3} value={note} onChange={(ev) => setNote(ev.target.value)} />
              <div className="flex flex-col gap-2 sm:flex-row">
                <Button icon={CheckCircleIcon} loading={busy === "AUTHORIZE"} disabled={busy !== null} onClick={() => void answer("AUTHORIZE")}>
                  Autorizar
                </Button>
                <Button variant="danger-soft" icon={XCircleIcon} loading={busy === "DENY"} disabled={busy !== null} onClick={() => void answer("DENY")}>
                  Negar
                </Button>
              </div>
            </Card>
          ) : (
            <Alert tone={a.status === "AUTHORIZED" ? "success" : "warning"} title={a.status === "AUTHORIZED" ? "Uso autorizado" : "Uso negado"}>
              Resposta registrada em {a.respondedAt ? dateTimeText(a.respondedAt) : ""}. O NUCEV e o SAD foram avisados.
              {a.responseNote && ` Observação: ${a.responseNote}`}
            </Alert>
          )}
        </>
      )}
    </div>
  );
}
