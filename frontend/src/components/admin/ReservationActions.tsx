import { PencilSimpleIcon, UserMinusIcon, XCircleIcon } from "@phosphor-icons/react";
import { useState } from "react";
import { useNavigate } from "react-router";
import { api, ApiError } from "../../lib/api";
import { formatDateTimeRange } from "../../lib/format";
import { notifyReservationsChanged } from "../../lib/reservations";
import { useToast } from "../../lib/toast";
import type { ReservationStatus, ReviewScope } from "../../lib/types";
import { Button } from "../ui/Button";
import { Dialog } from "../ui/Dialog";
import { Textarea } from "../ui/Field";
import { SegmentedControl } from "../ui/SegmentedControl";

/** O mínimo de uma reserva que as ações do SAD precisam. */
export interface ActionableReservation {
  id: string;
  title: string;
  status: ReservationStatus;
  startTime: string;
  endTime: string;
  seriesId: string | null;
}

/** O SAD altera ou cancela reservas pendentes ou aprovadas que ainda não terminaram. */
export function isAdminActionable(r: Pick<ActionableReservation, "status" | "endTime">, now = Date.now()): boolean {
  return (r.status === "PENDING" || r.status === "APPROVED") && new Date(r.endTime).getTime() > now;
}

function CancelReservationDialog({
  reservation,
  onClose,
  onDone,
}: {
  reservation: ActionableReservation;
  onClose: () => void;
  onDone: () => void;
}) {
  const toast = useToast();
  const [reason, setReason] = useState("");
  const [scope, setScope] = useState<ReviewScope>("single");
  const [sending, setSending] = useState(false);
  const formId = `cancelar-${reservation.id}`;

  async function submit() {
    setSending(true);
    try {
      const { cancelledIds } = await api<{ cancelledIds: string[] }>(`/admin/reservations/${reservation.id}/cancel`, {
        method: "POST",
        body: JSON.stringify({ reason, scope }),
      });
      toast.success(
        cancelledIds.length === 1 ? "Reserva cancelada" : `${cancelledIds.length} datas canceladas`,
        "O solicitante foi avisado por e-mail.",
      );
      notifyReservationsChanged();
      onDone();
    } catch (e) {
      toast.error("Não foi possível cancelar.", e instanceof ApiError ? e.message : undefined);
      setSending(false);
    }
  }

  return (
    <Dialog
      open
      onClose={onClose}
      title="Cancelar reserva"
      description={`${reservation.title} · ${formatDateTimeRange(reservation.startTime, reservation.endTime)}`}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Voltar
          </Button>
          <Button type="submit" form={formId} variant="danger" icon={XCircleIcon} loading={sending}>
            Cancelar reserva
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
        {reservation.seriesId && (
          <div className="space-y-2">
            <span className="text-sm font-medium">Esta reserva faz parte de uma série. Cancelar:</span>
            <SegmentedControl
              label="Cancelar"
              value={scope}
              onChange={setScope}
              options={[
                { value: "single", label: "Só esta data" },
                { value: "series", label: "Esta e as próximas" },
              ]}
            />
          </div>
        )}
        <Textarea
          label="Motivo"
          required
          data-autofocus
          rows={3}
          placeholder="Ex.: sala interditada para manutenção elétrica."
          hint="Vai no e-mail para o solicitante."
          value={reason}
          onChange={(e) => setReason(e.target.value)}
        />
        <p className="text-sm text-muted">O horário da sala fica livre na hora.</p>
      </form>
    </Dialog>
  );
}

/**
 * Registrar (ou desfazer) a ausência de uma reserva aprovada que já começou:
 * o espaço não foi usado nem cancelado (Portaria 2793, Art. 9º §2º).
 */
export function NoShowButton({
  reservation,
  onChanged,
}: {
  reservation: { id: string; status: ReservationStatus; startTime: string; noShowAt: string | null };
  onChanged: () => void;
}) {
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  if (reservation.status !== "APPROVED" || new Date(reservation.startTime).getTime() > Date.now()) return null;
  const marked = reservation.noShowAt !== null;

  async function toggle() {
    setBusy(true);
    try {
      const { noShowCount } = await api<{ noShowCount: number }>(`/admin/reservations/${reservation.id}/no-show`, {
        method: marked ? "DELETE" : "POST",
      });
      toast.success(
        marked ? "Ausência desfeita" : "Ausência registrada",
        `${noShowCount} ${noShowCount === 1 ? "ausência" : "ausências"} deste solicitante nos últimos 12 meses${noShowCount >= 3 ? " — recorrência (Art. 9º §2º)" : ""}.`,
      );
      notifyReservationsChanged();
      onChanged();
    } catch (e) {
      toast.error("Não foi possível registrar.", e instanceof ApiError ? e.message : undefined);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Button variant={marked ? "ghost" : "danger-soft"} size="sm" icon={UserMinusIcon} loading={busy} onClick={() => void toggle()}>
      {marked ? "Desfazer ausência" : "Registrar ausência"}
    </Button>
  );
}

/**
 * "Alterar" e "Cancelar" do SAD para uma reserva. Alterar abre o formulário
 * (/admin/reservas/:id/editar) e volta para `returnTo` ao salvar.
 */
export function AdminReservationActions({
  reservation,
  returnTo,
  onChanged,
}: {
  reservation: ActionableReservation;
  returnTo: string;
  onChanged: () => void;
}) {
  const navigate = useNavigate();
  const [cancelling, setCancelling] = useState(false);
  if (!isAdminActionable(reservation)) return null;

  return (
    <>
      <Button
        variant="ghost"
        size="sm"
        icon={PencilSimpleIcon}
        onClick={() => navigate(`/admin/reservas/${reservation.id}/editar?voltar=${encodeURIComponent(returnTo)}`)}
      >
        Alterar
      </Button>
      <Button variant="danger-soft" size="sm" icon={XCircleIcon} onClick={() => setCancelling(true)}>
        Cancelar
      </Button>
      {cancelling && (
        <CancelReservationDialog
          reservation={reservation}
          onClose={() => setCancelling(false)}
          onDone={() => {
            setCancelling(false);
            onChanged();
          }}
        />
      )}
    </>
  );
}
