import { FloppyDiskIcon, PencilSimpleLineIcon } from "@phosphor-icons/react";
import { useEffect, useState } from "react";
import { api, ApiError } from "../../lib/api";
import { useAuth } from "../../lib/auth";
import { dateTimeText } from "../../lib/events";
import { useToast } from "../../lib/toast";
import { Button } from "../ui/Button";
import { Textarea } from "../ui/Field";
import { Card } from "../ui/Surface";

interface Instructions {
  value: string;
  updatedAt: string | null;
  updatedByName: string | null;
}

/**
 * Fase 13 — orientações de pagamento dos eventos: o texto que vai para quem
 * aprovou o orçamento (por e-mail e na tela do evento). O SAD e o NUCEV editam.
 */
export function PaymentInstructionsCard() {
  const { user } = useAuth();
  const toast = useToast();
  const [data, setData] = useState<Instructions | null>(null);
  const [draft, setDraft] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const canEdit = user?.role === "ADMIN" || user?.role === "NUCEV";

  useEffect(() => {
    api<Instructions>("/settings/payment-instructions")
      .then(setData)
      .catch(() => setData({ value: "", updatedAt: null, updatedByName: null }));
  }, []);

  async function save() {
    if (draft === null) return;
    setSaving(true);
    try {
      setData(await api<Instructions>("/settings/payment-instructions", { method: "PUT", body: JSON.stringify({ value: draft }) }));
      setDraft(null);
      toast.success("Orientações salvas", "Valem para os próximos orçamentos aprovados.");
    } catch (e) {
      toast.error("Não foi possível salvar.", e instanceof ApiError ? e.message : undefined);
    } finally {
      setSaving(false);
    }
  }

  return (
    <Card className="p-4 sm:p-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold">Orientações de pagamento dos eventos</h2>
          <p className="text-sm text-muted">Vão para quem aprova o orçamento, por e-mail e na tela do evento. Cada evento guarda o texto que recebeu.</p>
        </div>
        {canEdit &&
          (draft === null ? (
            <Button variant="secondary" icon={PencilSimpleLineIcon} onClick={() => setDraft(data?.value ?? "")} disabled={!data}>
              Editar
            </Button>
          ) : (
            <div className="flex gap-2">
              <Button variant="secondary" onClick={() => setDraft(null)} disabled={saving}>
                Cancelar
              </Button>
              <Button icon={FloppyDiskIcon} loading={saving} disabled={draft.trim().length < 10} onClick={() => void save()}>
                Salvar
              </Button>
            </div>
          ))}
      </div>
      {draft !== null ? (
        <Textarea aria-label="Orientações de pagamento" rows={5} value={draft} onChange={(e) => setDraft(e.target.value)} containerClassName="mt-4" />
      ) : (
        <p className="mt-4 rounded-xl bg-surface-muted p-3 text-sm whitespace-pre-line">{data?.value || "Carregando…"}</p>
      )}
      {data?.updatedByName && data.updatedAt && (
        <p className="mt-2 text-xs text-muted">
          Alterado por {data.updatedByName} em {dateTimeText(data.updatedAt)}
        </p>
      )}
    </Card>
  );
}
