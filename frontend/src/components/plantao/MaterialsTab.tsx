import { ArrowArcLeftIcon, ArrowsLeftRightIcon, CalendarStarIcon, PencilSimpleIcon, PlusIcon, StackIcon, WarningIcon } from "@phosphor-icons/react";
import { useCallback, useEffect, useState } from "react";
import { Link } from "react-router";
import { api, ApiError } from "../../lib/api";
import { materialCount, materialPlural, MOVEMENT_LABELS, MOVEMENT_TONES, type MaterialItem, type MaterialLoan, type MaterialsData } from "../../lib/materials";
import { formatDateKey } from "../../lib/prices";
import { shortDateTime } from "../../lib/tasks";
import { useToast } from "../../lib/toast";
import { Badge } from "../ui/Badge";
import { Button } from "../ui/Button";
import { Dialog } from "../ui/Dialog";
import { CardListSkeleton } from "../ui/Feedback";
import { Input, Select, Textarea } from "../ui/Field";
import { Card } from "../ui/Surface";
import { isoDay } from "./ChecklistTab";

// Fase 18 — controle de pranchões (documento SAD/NUCEV, 5.2): total, em uso,
// disponível e onde estão; retirada (para um evento ou uma reserva), devolução
// (em partes), movimentação de local, ajuste do estoque e o histórico.

const errorText = (e: unknown) => (e instanceof ApiError ? e.message : "");
/** "2026-11-07T14:30" no fuso do navegador, para o campo de data e hora. */
const localNow = () => {
  const d = new Date();
  return `${isoDay(d)}T${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
};

type DialogState =
  | { kind: "item"; item: MaterialItem | null }
  | { kind: "checkout"; item: MaterialItem }
  | { kind: "return"; loan: MaterialLoan }
  | { kind: "move"; loan: MaterialLoan }
  | null;

function useSend(onDone: () => void) {
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  async function send(path: string, body: unknown, success: string, method = "POST") {
    setBusy(true);
    try {
      await api(path, { method, body: JSON.stringify(body) });
      toast.success(success);
      onDone();
    } catch (e) {
      toast.error("Não foi possível salvar.", errorText(e));
    } finally {
      setBusy(false);
    }
  }
  return { send, busy };
}

function Actions({ busy, disabled, label, onClose, onSave }: { busy: boolean; disabled?: boolean; label: string; onClose: () => void; onSave: () => void }) {
  return (
    <>
      <Button variant="secondary" onClick={onClose} disabled={busy}>
        Cancelar
      </Button>
      <Button loading={busy} disabled={disabled} onClick={onSave}>
        {label}
      </Button>
    </>
  );
}

function ItemDialog({ item, onClose, onDone }: { item: MaterialItem | null; onClose: () => void; onDone: () => void }) {
  const { send, busy } = useSend(onDone);
  const [d, setD] = useState({ name: item?.name ?? "Pranchão", total: String(item?.total ?? ""), homeLocation: item?.homeLocation ?? "", reason: "" });
  const total = Number(d.total);
  return (
    <Dialog
      open
      onClose={onClose}
      title={item ? `Ajustar ${item.name}` : "Cadastrar material"}
      description={item ? `Em uso agora: ${item.inUse}. O total não pode ficar abaixo disso.` : "Os pranchões (ou outro material que a equipe controla)."}
      footer={
        <Actions
          busy={busy}
          label="Salvar"
          disabled={d.name.trim().length < 2 || d.homeLocation.trim().length < 2 || !(total >= 0) || d.total === ""}
          onClose={onClose}
          onSave={() => void send(item ? `/materials/items/${item.id}` : "/materials/items", { name: d.name, total, homeLocation: d.homeLocation, ...(item ? { reason: d.reason } : {}) }, item ? "Estoque ajustado" : "Material cadastrado", item ? "PATCH" : "POST")}
        />
      }
    >
      <div className="space-y-4">
        <Input label="Nome" value={d.name} onChange={(e) => setD({ ...d, name: e.target.value })} />
        <div className="grid gap-3 sm:grid-cols-2">
          <Input label="Total" type="number" min={0} inputMode="numeric" value={d.total} onChange={(e) => setD({ ...d, total: e.target.value })} />
          <Input label="Onde fica guardado" value={d.homeLocation} onChange={(e) => setD({ ...d, homeLocation: e.target.value })} placeholder="Ex.: depósito do SAD, subsolo" />
        </div>
        {item && <Input label="Motivo do ajuste" value={d.reason} onChange={(e) => setD({ ...d, reason: e.target.value })} placeholder="Ex.: dois quebrados, recontagem" />}
      </div>
    </Dialog>
  );
}

function CheckoutDialog({ item, events, onClose, onDone }: { item: MaterialItem; events: MaterialsData["events"]; onClose: () => void; onDone: () => void }) {
  const { send, busy } = useSend(onDone);
  const [d, setD] = useState({ quantity: "", location: "", eventId: "", reservationProtocol: "", purpose: "", takenBy: "", takenAt: localNow(), expectedReturnAt: "" });
  const quantity = Number(d.quantity);
  const valid = quantity >= 1 && quantity <= item.available && d.location.trim().length >= 2 && d.takenBy.trim().length >= 2;
  return (
    <Dialog
      open
      onClose={onClose}
      size="lg"
      title={`Retirada de ${materialPlural(item.name)}`}
      description={`Disponíveis agora: ${item.available} de ${item.total}.`}
      footer={
        <Actions
          busy={busy}
          label="Registrar a retirada"
          disabled={!valid}
          onClose={onClose}
          onSave={() =>
            void send(
              `/materials/items/${item.id}/checkout`,
              {
                quantity,
                location: d.location,
                eventId: d.eventId || null,
                reservationProtocol: d.reservationProtocol,
                purpose: d.purpose,
                takenBy: d.takenBy,
                takenAt: new Date(d.takenAt).toISOString(),
                expectedReturnAt: d.expectedReturnAt || null,
              },
              "Retirada registrada",
            )
          }
        />
      }
    >
      <div className="grid gap-3 sm:grid-cols-2">
        <Input label="Quantidade" type="number" min={1} max={item.available} inputMode="numeric" value={d.quantity} onChange={(e) => setD({ ...d, quantity: e.target.value })} error={quantity > item.available ? `Só há ${item.available}.` : undefined} data-autofocus />
        <Input label="Para onde vão" value={d.location} onChange={(e) => setD({ ...d, location: e.target.value })} placeholder="Ex.: Foyer do Teatro" />
        <Input label="Quem retirou" value={d.takenBy} onChange={(e) => setD({ ...d, takenBy: e.target.value })} />
        <Input label="Quando" type="datetime-local" value={d.takenAt} onChange={(e) => setD({ ...d, takenAt: e.target.value })} />
        <Select label="Evento (opcional)" value={d.eventId} onChange={(e) => setD({ ...d, eventId: e.target.value })}>
          <option value="">Nenhum</option>
          {events.map((ev) => (
            <option key={ev.id} value={ev.id}>
              {ev.protocol} · {ev.title}
            </option>
          ))}
        </Select>
        <Input label="Reserva (protocolo, opcional)" value={d.reservationProtocol} onChange={(e) => setD({ ...d, reservationProtocol: e.target.value })} placeholder="000123/2026" />
        <Input label="Devolução prevista" type="date" value={d.expectedReturnAt} onChange={(e) => setD({ ...d, expectedReturnAt: e.target.value })} />
        <Input label="Para quê" value={d.purpose} onChange={(e) => setD({ ...d, purpose: e.target.value })} placeholder="Ex.: mesas do credenciamento" />
      </div>
    </Dialog>
  );
}

function ReturnDialog({ loan, onClose, onDone }: { loan: MaterialLoan; onClose: () => void; onDone: () => void }) {
  const { send, busy } = useSend(onDone);
  const pending = loan.quantity - loan.returnedQuantity;
  const [d, setD] = useState({ quantity: String(pending), returnedBy: "", at: localNow(), notes: "" });
  const quantity = Number(d.quantity);
  return (
    <Dialog
      open
      onClose={onClose}
      title="Devolução"
      description={`${pending} em ${loan.location}, retirados por ${loan.takenBy}. Dá para devolver em partes.`}
      footer={
        <Actions
          busy={busy}
          label="Registrar a devolução"
          disabled={!(quantity >= 1 && quantity <= pending) || d.returnedBy.trim().length < 2}
          onClose={onClose}
          onSave={() => void send(`/materials/loans/${loan.id}/return`, { quantity, returnedBy: d.returnedBy, at: new Date(d.at).toISOString(), notes: d.notes }, quantity === pending ? "Devolução registrada" : "Devolução parcial registrada")}
        />
      }
    >
      <div className="grid gap-3 sm:grid-cols-2">
        <Input label="Quantidade devolvida" type="number" min={1} max={pending} inputMode="numeric" value={d.quantity} onChange={(e) => setD({ ...d, quantity: e.target.value })} />
        <Input label="Quem devolveu" value={d.returnedBy} onChange={(e) => setD({ ...d, returnedBy: e.target.value })} data-autofocus />
        <Input label="Quando" type="datetime-local" value={d.at} onChange={(e) => setD({ ...d, at: e.target.value })} />
        <Textarea label="Observações" rows={2} value={d.notes} onChange={(e) => setD({ ...d, notes: e.target.value })} placeholder="Ex.: um voltou com a perna solta" containerClassName="sm:col-span-2" />
      </div>
    </Dialog>
  );
}

function MoveDialog({ loan, onClose, onDone }: { loan: MaterialLoan; onClose: () => void; onDone: () => void }) {
  const { send, busy } = useSend(onDone);
  const [d, setD] = useState({ toLocation: "", movedBy: "", at: localNow(), notes: "" });
  return (
    <Dialog
      open
      onClose={onClose}
      title="Movimentar"
      description={`${loan.quantity - loan.returnedQuantity} estão em ${loan.location}.`}
      footer={
        <Actions
          busy={busy}
          label="Registrar"
          disabled={d.toLocation.trim().length < 2 || d.movedBy.trim().length < 2}
          onClose={onClose}
          onSave={() => void send(`/materials/loans/${loan.id}/move`, { ...d, at: new Date(d.at).toISOString() }, "Movimentação registrada")}
        />
      }
    >
      <div className="grid gap-3 sm:grid-cols-2">
        <Input label="Para onde foram" value={d.toLocation} onChange={(e) => setD({ ...d, toLocation: e.target.value })} data-autofocus />
        <Input label="Quem levou" value={d.movedBy} onChange={(e) => setD({ ...d, movedBy: e.target.value })} />
        <Input label="Quando" type="datetime-local" value={d.at} onChange={(e) => setD({ ...d, at: e.target.value })} />
        <Input label="Observações" value={d.notes} onChange={(e) => setD({ ...d, notes: e.target.value })} />
      </div>
    </Dialog>
  );
}

export function MaterialsTab() {
  const toast = useToast();
  const [data, setData] = useState<MaterialsData | null>(null);
  const [dialog, setDialog] = useState<DialogState>(null);
  const today = isoDay(new Date());

  const load = useCallback(() => {
    api<MaterialsData>("/materials")
      .then(setData)
      .catch((e) => toast.error("Não foi possível carregar os pranchões.", errorText(e)));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  useEffect(() => load(), [load]);
  const done = () => {
    setDialog(null);
    load();
  };

  if (!data) return <CardListSkeleton />;

  return (
    <div className="space-y-6">
      {data.items.length === 0 ? (
        <Card className="space-y-3 p-6 text-center">
          <StackIcon size={32} className="mx-auto text-primary" aria-hidden />
          <p className="font-semibold">Nenhum material cadastrado</p>
          <p className="text-sm text-muted">Cadastre os pranchões com o total e onde ficam guardados.</p>
          <Button icon={PlusIcon} onClick={() => setDialog({ kind: "item", item: null })} className="mx-auto">
            Cadastrar os pranchões
          </Button>
        </Card>
      ) : (
        <div className="grid gap-4 md:grid-cols-2">
          {data.items.map((item) => (
            <Card key={item.id} className="p-4 sm:p-5">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <h2 className="flex items-center gap-2 text-base font-semibold">
                    <StackIcon size={18} className="text-primary" aria-hidden /> {item.name}
                  </h2>
                  <p className="text-sm text-muted">Guardados em: {item.homeLocation}</p>
                </div>
                <Button size="sm" variant="ghost" icon={PencilSimpleIcon} onClick={() => setDialog({ kind: "item", item })}>
                  Ajustar
                </Button>
              </div>
              <dl className="mt-4 grid grid-cols-3 gap-2 text-center">
                {[
                  ["Total", item.total, ""],
                  ["Em uso", item.inUse, "text-warning-foreground"],
                  ["Disponíveis", item.available, "text-success-foreground"],
                ].map(([label, value, tone]) => (
                  <div key={label as string} className="rounded-xl bg-surface-muted p-3">
                    <dd className={`text-2xl font-bold tabular-nums ${tone}`}>{value}</dd>
                    <dt className="text-xs text-muted">{label}</dt>
                  </div>
                ))}
              </dl>
              <Button icon={ArrowsLeftRightIcon} className="mt-4 w-full" disabled={item.available === 0} onClick={() => setDialog({ kind: "checkout", item })}>
                Registrar retirada
              </Button>
            </Card>
          ))}
          <button type="button" onClick={() => setDialog({ kind: "item", item: null })} className="rounded-2xl border border-dashed border-border p-4 text-sm font-medium text-primary hover:bg-surface-muted">
            <PlusIcon size={16} className="mr-1 inline" aria-hidden /> Cadastrar outro material
          </button>
        </div>
      )}

      <Card className="p-4 sm:p-5">
        <h2 className="text-base font-semibold">
          Em uso agora <span className="font-normal text-muted">({data.loans.length})</span>
        </h2>
        {data.loans.length === 0 ? (
          <p className="mt-2 text-sm text-muted">Tudo guardado.</p>
        ) : (
          <ul className="mt-2 divide-y divide-border">
            {data.loans.map((l) => {
              const item = data.items.find((i) => i.id === l.itemId);
              const late = l.expectedReturnAt !== null && l.expectedReturnAt < today;
              return (
                <li key={l.id} className="flex flex-wrap items-start justify-between gap-3 py-3">
                  <div className="min-w-0 text-sm">
                    <p className="font-semibold">
                      {materialCount(l.quantity - l.returnedQuantity, item?.name ?? "item")} em {l.location}
                      {l.returnedQuantity > 0 && <span className="font-normal text-muted"> ({l.returnedQuantity} de {l.quantity} já devolvidos)</span>}
                    </p>
                    <p className="text-muted">
                      Retirados por {l.takenBy} em {shortDateTime(l.takenAt)}
                      {l.purpose && ` · ${l.purpose}`}
                    </p>
                    <p className="mt-0.5 flex flex-wrap gap-x-3 text-xs text-muted">
                      {l.event && (
                        <Link to={`/admin/eventos/${l.event.id}?aba=organizacao`} className="inline-flex items-center gap-1 text-primary hover:underline">
                          <CalendarStarIcon size={12} aria-hidden /> {l.event.protocol} · {l.event.title}
                        </Link>
                      )}
                      {l.reservationProtocol && <span>Reserva {l.reservationProtocol}</span>}
                      {l.expectedReturnAt && (
                        <span className={late ? "font-semibold text-warning-foreground" : undefined}>
                          {late && <WarningIcon size={12} className="mr-0.5 inline" aria-hidden />}
                          devolução prevista: {formatDateKey(l.expectedReturnAt)}
                        </span>
                      )}
                    </p>
                  </div>
                  <div className="flex shrink-0 gap-1">
                    <Button size="sm" variant="ghost" icon={ArrowsLeftRightIcon} onClick={() => setDialog({ kind: "move", loan: l })}>
                      Movimentar
                    </Button>
                    <Button size="sm" variant="secondary" icon={ArrowArcLeftIcon} onClick={() => setDialog({ kind: "return", loan: l })}>
                      Devolver
                    </Button>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </Card>

      <Card className="p-4 sm:p-5">
        <h2 className="text-base font-semibold">Histórico</h2>
        {data.movements.length === 0 ? (
          <p className="mt-2 text-sm text-muted">Nada registrado ainda.</p>
        ) : (
          <ul className="mt-2 divide-y divide-border">
            {data.movements.map((m) => (
              <li key={m.id} className="flex flex-wrap items-start gap-x-3 gap-y-1 py-2.5 text-sm">
                <span className="w-28 shrink-0 text-xs text-muted tabular-nums">{shortDateTime(m.at)}</span>
                <Badge tone={MOVEMENT_TONES[m.kind]}>{MOVEMENT_LABELS[m.kind]}</Badge>
                <span className="min-w-0 flex-1">
                  <span className="font-medium">
                    {m.quantity > 0 && m.kind === "ADJUST" ? "+" : ""}
                    {materialCount(m.quantity, m.item.name)}
                  </span>
                  {(m.fromLocation || m.toLocation) && (
                    <span className="text-muted">
                      {" "}
                      · {m.fromLocation ?? "—"} → {m.toLocation ?? "—"}
                    </span>
                  )}
                  {m.person && <span className="text-muted"> · {m.person}</span>}
                  {m.loan?.event && <span className="text-muted"> · {m.loan.event.title}</span>}
                  {m.notes && <span className="block text-xs text-muted">{m.notes}</span>}
                  <span className="block text-xs text-muted">registrado por {m.recordedByName}</span>
                </span>
              </li>
            ))}
          </ul>
        )}
      </Card>

      {dialog?.kind === "item" && <ItemDialog item={dialog.item} onClose={() => setDialog(null)} onDone={done} />}
      {dialog?.kind === "checkout" && <CheckoutDialog item={dialog.item} events={data.events} onClose={() => setDialog(null)} onDone={done} />}
      {dialog?.kind === "return" && <ReturnDialog loan={dialog.loan} onClose={() => setDialog(null)} onDone={done} />}
      {dialog?.kind === "move" && <MoveDialog loan={dialog.loan} onClose={() => setDialog(null)} onDone={done} />}
    </div>
  );
}
