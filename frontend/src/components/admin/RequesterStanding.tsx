import { GavelIcon, ProhibitIcon, UserMinusIcon, WarningIcon } from "@phosphor-icons/react";
import { useCallback, useEffect, useState } from "react";
import { api, ApiError } from "../../lib/api";
import { useConfirm } from "../../lib/confirm";
import { plural } from "../../lib/format";
import { notifyReservationsChanged } from "../../lib/reservations";
import { useToast } from "../../lib/toast";
import { SANCTION_TYPE_LABELS, type RequesterStanding as Standing, type Sanction, type SanctionType } from "../../lib/types";
import { Button } from "../ui/Button";
import { Dialog } from "../ui/Dialog";
import { Input, Select, Textarea } from "../ui/Field";

const formatUntil = (s: Pick<Sanction, "until">) =>
  s.until ? `até ${new Date(s.until).toLocaleDateString("pt-BR", { timeZone: "UTC" })}` : "até a regularização";

const pad = (n: number) => String(n).padStart(2, "0");
const isoDay = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;

/**
 * Aplicar sanção (Portaria 2793): advertência, multa ou suspensão de novas
 * reservas — por até 1 ano (Art. 11) ou até a regularização (Art. 17). Na
 * inadimplência, as reservas vigentes também são canceladas.
 */
function SanctionDialog({ user, onClose, onDone }: { user: Standing["user"]; onClose: () => void; onDone: () => void }) {
  const toast = useToast();
  const [type, setType] = useState<SanctionType>("WARNING");
  const [reason, setReason] = useState("");
  const [until, setUntil] = useState("");
  const [cancelFuture, setCancelFuture] = useState(false);
  const [sending, setSending] = useState(false);
  const formId = `sancao-${user.id}`;
  const today = new Date();
  const maxDate = new Date(today.getFullYear() + 1, today.getMonth(), today.getDate());

  async function submit() {
    setSending(true);
    try {
      const res = await api<{ cancelledCount: number }>(`/admin/users/${user.id}/sanctions`, {
        method: "POST",
        body: JSON.stringify({
          type,
          reason,
          until: type === "SUSPENSION" && until ? until : undefined,
          cancelFutureReservations: type === "SUSPENSION" && cancelFuture,
        }),
      });
      toast.success(
        `${SANCTION_TYPE_LABELS[type]} registrada`,
        res.cancelledCount > 0 ? `${plural(res.cancelledCount, "reserva cancelada", "reservas canceladas")}.` : undefined,
      );
      // Atualiza as listas (e a de suspensões em vigor, na tela de Solicitações).
      notifyReservationsChanged();
      onDone();
    } catch (e) {
      toast.error("Não foi possível registrar a sanção.", e instanceof ApiError ? e.message : undefined);
      setSending(false);
    }
  }

  return (
    <Dialog
      open
      onClose={onClose}
      title="Aplicar sanção"
      description={`${user.name} · ${user.email}`}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Voltar
          </Button>
          <Button type="submit" form={formId} variant="danger" icon={GavelIcon} loading={sending}>
            Registrar
          </Button>
        </>
      }
    >
      <form
        id={formId}
        onSubmit={(e) => {
          e.preventDefault();
          void submit();
        }}
        className="space-y-4"
      >
        <Select label="Sanção" value={type} onChange={(e) => setType(e.target.value as SanctionType)}>
          {(Object.keys(SANCTION_TYPE_LABELS) as SanctionType[]).map((t) => (
            <option key={t} value={t}>
              {SANCTION_TYPE_LABELS[t]}
            </option>
          ))}
        </Select>
        <Textarea
          label="Motivo"
          required
          rows={3}
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          placeholder="Ex.: 3 ausências sem cancelamento em 12 meses (Art. 9º §2º)."
        />
        {type === "SUSPENSION" && (
          <div className="animate-fade-in space-y-3">
            <Input
              label="Suspensa até"
              type="date"
              min={isoDay(today)}
              max={isoDay(maxDate)}
              value={until}
              onChange={(e) => setUntil(e.target.value)}
              hint="Até 1 ano (Art. 11). Em branco: até a regularização (ex.: inadimplência junto à FFM, Art. 17)."
            />
            <label className="flex items-start gap-3 text-sm">
              <input type="checkbox" className="mt-0.5 size-5 shrink-0" checked={cancelFuture} onChange={(e) => setCancelFuture(e.target.checked)} />
              <span>Cancelar também as reservas futuras deste solicitante (inadimplência, Art. 17). Ele recebe o motivo por e-mail.</span>
            </label>
          </div>
        )}
        <p className="text-xs text-muted">Quem decide a sanção é a Diretoria/SAD; o sistema registra e aplica a suspensão nos pedidos.</p>
      </form>
    </Dialog>
  );
}

/**
 * Situação do solicitante para o SAD: ausências (não comparecimento sem
 * cancelar) nos últimos 12 meses — 3 ou mais é recorrência (Art. 9º §2º) — e
 * sanções. Daqui o SAD aplica ou retira uma sanção.
 */
export function RequesterStanding({ userId }: { userId: string }) {
  const toast = useToast();
  const confirm = useConfirm();
  const [standing, setStanding] = useState<Standing | null>(null);
  const [sanctioning, setSanctioning] = useState(false);

  const load = useCallback(() => {
    api<Standing>(`/admin/users/${userId}/standing`)
      .then(setStanding)
      .catch(() => setStanding(null));
  }, [userId]);

  useEffect(load, [load]);

  if (!standing) return null;
  const active = standing.sanctions.find((s) => s.id === standing.activeSuspensionId);
  const noShows = standing.noShows.length;

  async function lift(sanction: Sanction) {
    const ok = await confirm({
      title: "Retirar a suspensão?",
      description: "O solicitante volta a poder fazer pedidos de reserva.",
      confirmLabel: "Retirar",
      cancelLabel: "Manter",
    });
    if (!ok) return;
    try {
      await api(`/admin/sanctions/${sanction.id}/lift`, { method: "POST" });
      toast.success("Suspensão retirada");
      load();
    } catch (e) {
      toast.error("Não foi possível retirar.", e instanceof Error ? e.message : undefined);
    }
  }

  return (
    <div className="space-y-2 rounded-xl border border-border p-3 text-sm">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="flex items-center gap-2">
          <UserMinusIcon size={18} className="shrink-0 text-muted" aria-hidden />
          <span>
            {noShows === 0 ? "Nenhuma ausência" : plural(noShows, "ausência", "ausências")} nos últimos 12 meses
            {standing.sanctions.length > 0 && ` · ${plural(standing.sanctions.length, "sanção", "sanções")} registradas`}
          </span>
        </p>
        <Button size="sm" variant="ghost" icon={GavelIcon} onClick={() => setSanctioning(true)}>
          Aplicar sanção
        </Button>
      </div>
      {noShows >= 3 && (
        <p className="flex gap-2 text-warning-foreground">
          <WarningIcon size={18} weight="fill" className="mt-px shrink-0" aria-hidden />
          Recorrência (3 ou mais ausências em 12 meses): cabe notificação formal e sanções (Portaria 2793, Art. 9º §2º).
        </p>
      )}
      {active && (
        <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg bg-danger-soft px-3 py-2 text-danger-foreground">
          <p className="flex gap-2">
            <ProhibitIcon size={18} weight="fill" className="mt-px shrink-0" aria-hidden />
            <span>
              Suspenso {formatUntil(active)}: {active.reason}. Aprovar um pedido dele passa por cima da suspensão (Portaria 2793, Arts. 11, 17
              e 22).
            </span>
          </p>
          <Button size="sm" variant="secondary" onClick={() => void lift(active)}>
            Retirar
          </Button>
        </div>
      )}
      {standing.sanctions.length > 0 && (
        <ul className="space-y-0.5 text-xs text-muted">
          {standing.sanctions.slice(0, 4).map((s) => (
            <li key={s.id}>
              {new Date(s.createdAt).toLocaleDateString("pt-BR")} · {SANCTION_TYPE_LABELS[s.type]}
              {s.type === "SUSPENSION" ? ` ${formatUntil(s)}${s.liftedAt ? " (retirada)" : ""}` : ""} — {s.reason}
            </li>
          ))}
        </ul>
      )}
      {sanctioning && (
        <SanctionDialog
          user={standing.user}
          onClose={() => setSanctioning(false)}
          onDone={() => {
            setSanctioning(false);
            load();
          }}
        />
      )}
    </div>
  );
}
