import {
  CalendarCheckIcon,
  CarIcon,
  CheckCircleIcon,
  ClipboardTextIcon,
  DownloadSimpleIcon,
  FlagCheckeredIcon,
  ForkKnifeIcon,
  MagnifyingGlassIcon,
  MicrophoneStageIcon,
  PencilSimpleIcon,
  PlusIcon,
  TrashIcon,
  UserCircleGearIcon,
  UsersThreeIcon,
} from "@phosphor-icons/react";
import { useCallback, useEffect, useState, type ReactNode } from "react";
import { api, ApiError } from "../../lib/api";
import { cn } from "../../lib/cn";
import { useConfirm } from "../../lib/confirm";
import {
  confirmedPhase,
  dayLabel,
  type EventManagement,
  type EventOrganizationData,
  type EventPersonKind,
  type EventPersonRow,
  type EventRequest,
  type ScheduleItemRow,
  type TaskRow,
} from "../../lib/events";
import { plural } from "../../lib/format";
import { formatDateKey } from "../../lib/prices";
import { useToast } from "../../lib/toast";
import { Button, IconButton } from "../ui/Button";
import { Dialog } from "../ui/Dialog";
import { Alert, CardListSkeleton } from "../ui/Feedback";
import { Input, Select, Switch, Textarea } from "../ui/Field";
import { Card } from "../ui/Surface";

// Fase 16 — organização do evento confirmado (documento SAD/NUCEV, 5.1):
// programação, palestrantes, participantes, pendências, responsáveis, logística
// e o encerramento ("Finalizado"). O NUCEV e o SAD editam; encerrado, só consulta.

const errorText = (e: unknown, fallback: string) => (e instanceof ApiError ? e.message : fallback);
const todayKey = () => new Date().toLocaleDateString("en-CA");

function Section({ icon: Icon, title, description, action, children }: { icon: typeof PlusIcon; title: string; description?: string; action?: ReactNode; children: ReactNode }) {
  return (
    <Card className="p-4 sm:p-6">
      <div className="mb-3 flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h2 className="flex items-center gap-2 text-base font-semibold">
            <Icon size={18} className="text-primary" aria-hidden /> {title}
          </h2>
          {description && <p className="text-sm text-muted">{description}</p>}
        </div>
        {action}
      </div>
      {children}
    </Card>
  );
}

/** Envia e mostra o resultado; devolve true quando deu certo. */
function useSend(onDone: () => void) {
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  const send = useCallback(
    async (path: string, method: string, body: unknown, success?: string) => {
      setBusy(true);
      try {
        await api(path, { method, body: body === undefined ? undefined : JSON.stringify(body) });
        if (success) toast.success(success);
        onDone();
        return true;
      } catch (e) {
        toast.error("Não foi possível salvar.", errorText(e, ""));
        return false;
      } finally {
        setBusy(false);
      }
    },
    [onDone, toast],
  );
  return { send, busy };
}

// ---------------------------------------------------------------------------
// Programação e cronograma
// ---------------------------------------------------------------------------

interface ScheduleDraft {
  date: string;
  start: string;
  end: string;
  title: string;
  location: string;
  speaker: string;
  notes: string;
}

function ScheduleDialog({
  event,
  rooms,
  item,
  onClose,
  onSave,
  busy,
}: {
  event: EventRequest;
  rooms: string[];
  item: ScheduleItemRow | null;
  onClose: () => void;
  onSave: (draft: ScheduleDraft) => void;
  busy: boolean;
}) {
  const first = event.days[0];
  const [draft, setDraft] = useState<ScheduleDraft>(
    item
      ? { date: item.date, start: item.start, end: item.end, title: item.title, location: item.location ?? "", speaker: item.speaker ?? "", notes: item.notes ?? "" }
      : { date: first?.date ?? "", start: first?.start ?? "08:00", end: first?.start ?? "09:00", title: "", location: "", speaker: "", notes: "" },
  );
  const set = (patch: Partial<ScheduleDraft>) => setDraft((d) => ({ ...d, ...patch }));
  const valid = draft.title.trim().length >= 2 && draft.end > draft.start;
  return (
    <Dialog
      open
      onClose={onClose}
      title={item ? "Alterar item da programação" : "Incluir na programação"}
      footer={
        <>
          <Button variant="secondary" onClick={onClose} disabled={busy}>
            Cancelar
          </Button>
          <Button loading={busy} disabled={!valid} onClick={() => onSave(draft)}>
            Salvar
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <Input label="O que acontece" required value={draft.title} onChange={(e) => set({ title: e.target.value })} placeholder="Ex.: Abertura, mesa-redonda, coffee break" data-autofocus />
        <div className="grid gap-3 sm:grid-cols-3">
          <Select label="Dia" value={draft.date} onChange={(e) => set({ date: e.target.value })}>
            {event.days.map((d) => (
              <option key={d.date} value={d.date}>
                {dayLabel(d.date)}
              </option>
            ))}
          </Select>
          <Input label="Início" type="time" value={draft.start} onChange={(e) => set({ start: e.target.value })} />
          <Input label="Fim" type="time" value={draft.end} onChange={(e) => set({ end: e.target.value })} error={draft.end <= draft.start ? "O fim vem depois do início." : undefined} />
        </div>
        <Input label="Local" list="org-rooms" value={draft.location} onChange={(e) => set({ location: e.target.value })} placeholder="Sala ou espaço" />
        <datalist id="org-rooms">
          {rooms.map((r) => (
            <option key={r} value={r} />
          ))}
        </datalist>
        <Input label="Palestrante ou responsável" value={draft.speaker} onChange={(e) => set({ speaker: e.target.value })} />
        <Textarea label="Observações" rows={2} value={draft.notes} onChange={(e) => set({ notes: e.target.value })} />
      </div>
    </Dialog>
  );
}

function ScheduleSection({ event, org, rooms, reload }: { event: EventRequest; org: EventOrganizationData; rooms: string[]; reload: () => void }) {
  const confirm = useConfirm();
  const { send, busy } = useSend(reload);
  const [editing, setEditing] = useState<ScheduleItemRow | "new" | null>(null);
  const base = `/events/${event.id}/organization/schedule`;

  async function save(draft: ScheduleDraft) {
    const ok = editing === "new" ? await send(base, "POST", draft, "Incluído na programação") : await send(`${base}/${(editing as ScheduleItemRow).id}`, "PATCH", draft, "Programação alterada");
    if (ok) setEditing(null);
  }
  async function remove(item: ScheduleItemRow) {
    if (await confirm({ title: "Tirar da programação?", description: item.title, confirmLabel: "Tirar", tone: "danger" })) await send(`${base}/${item.id}`, "DELETE", undefined, "Tirado da programação");
  }

  return (
    <Section
      icon={CalendarCheckIcon}
      title="Programação e cronograma"
      description="O que acontece em cada dia, onde e com quem."
      action={
        org.editable && (
          <Button size="sm" variant="secondary" icon={PlusIcon} onClick={() => setEditing("new")}>
            Incluir
          </Button>
        )
      }
    >
      <div className="space-y-4">
        {event.days.map((d) => {
          const items = org.schedule.filter((s) => s.date === d.date);
          return (
            <div key={d.date}>
              <h3 className="text-sm font-semibold capitalize">
                {dayLabel(d.date)} <span className="font-normal text-muted">· {d.start}–{d.end}</span>
              </h3>
              {items.length === 0 ? (
                <p className="mt-1 text-sm text-muted">Nada na programação deste dia ainda.</p>
              ) : (
                <ul className="mt-2 divide-y divide-border rounded-xl border border-border">
                  {items.map((s) => (
                    <li key={s.id} className="flex items-start gap-3 px-3 py-2.5">
                      <span className="w-24 shrink-0 text-sm font-semibold tabular-nums">
                        {s.start}–{s.end}
                      </span>
                      <div className="min-w-0 flex-1 text-sm">
                        <p className="font-medium break-words">{s.title}</p>
                        <p className="text-muted">{[s.location, s.speaker].filter(Boolean).join(" · ") || "—"}</p>
                        {s.notes && <p className="mt-0.5 text-xs whitespace-pre-line text-muted">{s.notes}</p>}
                      </div>
                      {org.editable && (
                        <div className="flex shrink-0">
                          <IconButton icon={PencilSimpleIcon} label={`Alterar ${s.title}`} onClick={() => setEditing(s)} />
                          <IconButton icon={TrashIcon} label={`Tirar ${s.title}`} onClick={() => void remove(s)} />
                        </div>
                      )}
                    </li>
                  ))}
                </ul>
              )}
            </div>
          );
        })}
      </div>
      {editing && <ScheduleDialog event={event} rooms={rooms} item={editing === "new" ? null : editing} onClose={() => setEditing(null)} onSave={(d) => void save(d)} busy={busy} />}
    </Section>
  );
}

// ---------------------------------------------------------------------------
// Pessoas
// ---------------------------------------------------------------------------

const PEOPLE_TEXT: Record<EventPersonKind, { affiliation: string; empty: string; one: string; many: string }> = {
  ORGANIZER: { affiliation: "Função", empty: "Ninguém cadastrado ainda.", one: "responsável", many: "responsáveis" },
  SPEAKER: { affiliation: "Instituição", empty: "Nenhum palestrante externo cadastrado.", one: "palestrante", many: "palestrantes" },
  PARTICIPANT: { affiliation: "Instituição", empty: "Nenhum participante na lista ainda.", one: "participante", many: "participantes" },
};

function PersonDialog({ kind, person, onClose, onSave, busy }: { kind: EventPersonKind; person: EventPersonRow | null; onClose: () => void; onSave: (p: Record<string, string>) => void; busy: boolean }) {
  const [draft, setDraft] = useState({ name: person?.name ?? "", affiliation: person?.affiliation ?? "", contact: person?.contact ?? "", notes: person?.notes ?? "" });
  const text = PEOPLE_TEXT[kind];
  return (
    <Dialog
      open
      onClose={onClose}
      title={person ? `Alterar ${text.one}` : `Incluir ${text.one}`}
      footer={
        <>
          <Button variant="secondary" onClick={onClose} disabled={busy}>
            Cancelar
          </Button>
          <Button loading={busy} disabled={draft.name.trim().length < 2} onClick={() => onSave(draft)}>
            Salvar
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <Input label="Nome" required value={draft.name} onChange={(e) => setDraft({ ...draft, name: e.target.value })} data-autofocus />
        <div className="grid gap-3 sm:grid-cols-2">
          <Input label={text.affiliation} value={draft.affiliation} onChange={(e) => setDraft({ ...draft, affiliation: e.target.value })} />
          <Input label="Contato" value={draft.contact} onChange={(e) => setDraft({ ...draft, contact: e.target.value })} placeholder="E-mail ou telefone" />
        </div>
        <Textarea
          label="Observações"
          rows={2}
          value={draft.notes}
          onChange={(e) => setDraft({ ...draft, notes: e.target.value })}
          placeholder={kind === "SPEAKER" ? "Ex.: passagem, hospedagem, horário de chegada" : undefined}
        />
      </div>
    </Dialog>
  );
}

function PeopleList({ event, org, kind, people, reload }: { event: EventRequest; org: EventOrganizationData; kind: EventPersonKind; people: EventPersonRow[]; reload: () => void }) {
  const confirm = useConfirm();
  const { send, busy } = useSend(reload);
  const [editing, setEditing] = useState<EventPersonRow | "new" | null>(null);
  const base = `/events/${event.id}/organization/people`;
  const text = PEOPLE_TEXT[kind];

  async function save(draft: Record<string, string>) {
    const ok = editing === "new" ? await send(base, "POST", { kind, ...draft }, "Incluído") : await send(`${base}/${(editing as EventPersonRow).id}`, "PATCH", draft, "Alterado");
    if (ok) setEditing(null);
  }
  async function remove(p: EventPersonRow) {
    if (await confirm({ title: `Tirar ${p.name}?`, confirmLabel: "Tirar", tone: "danger" })) await send(`${base}/${p.id}`, "DELETE", undefined, "Tirado da lista");
  }

  return (
    <>
      {people.length === 0 ? (
        <p className="text-sm text-muted">{text.empty}</p>
      ) : (
        <ul className="divide-y divide-border">
          {people.map((p) => (
            <li key={p.id} className="flex items-start gap-3 py-2.5 text-sm">
              <div className="min-w-0 flex-1">
                <p className="font-medium break-words">{p.name}</p>
                <p className="text-muted">{[p.affiliation, p.contact].filter(Boolean).join(" · ") || "—"}</p>
                {p.notes && <p className="mt-0.5 text-xs whitespace-pre-line text-muted">{p.notes}</p>}
              </div>
              {org.editable && (
                <div className="flex shrink-0">
                  <IconButton icon={PencilSimpleIcon} label={`Alterar ${p.name}`} onClick={() => setEditing(p)} />
                  <IconButton icon={TrashIcon} label={`Tirar ${p.name}`} onClick={() => void remove(p)} />
                </div>
              )}
            </li>
          ))}
        </ul>
      )}
      {org.editable && (
        <Button size="sm" variant="secondary" icon={PlusIcon} className="mt-3" onClick={() => setEditing("new")}>
          Incluir {text.one}
        </Button>
      )}
      {editing && <PersonDialog kind={kind} person={editing === "new" ? null : editing} onClose={() => setEditing(null)} onSave={(d) => void save(d)} busy={busy} />}
    </>
  );
}

/** "Nome;contato;instituição" por linha, para abrir na planilha. */
function downloadCsv(event: EventRequest, people: EventPersonRow[]) {
  const cell = (v: string | null) => `"${(v ?? "").replace(/"/g, '""')}"`;
  const lines = ["Nome;Contato;Instituição;Observações", ...people.map((p) => [p.name, p.contact, p.affiliation, p.notes].map(cell).join(";"))];
  const blob = new Blob([`﻿${lines.join("\r\n")}`], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `participantes-${event.protocol.replace(/\W+/g, "-")}.csv`;
  a.click();
  URL.revokeObjectURL(url);
}

const PARTICIPANTS_SHOWN = 50;

function ParticipantsSection({ event, org, reload }: { event: EventRequest; org: EventOrganizationData; reload: () => void }) {
  const toast = useToast();
  const [query, setQuery] = useState("");
  const [showAll, setShowAll] = useState(false);
  const [pasting, setPasting] = useState(false);
  const [pasted, setPasted] = useState("");
  const [busy, setBusy] = useState(false);
  const participants = org.people.filter((p) => p.kind === "PARTICIPANT");
  const needle = query.trim().toLowerCase();
  const filtered = needle ? participants.filter((p) => `${p.name} ${p.contact ?? ""} ${p.affiliation ?? ""}`.toLowerCase().includes(needle)) : participants;
  const shown = showAll || needle ? filtered : filtered.slice(0, PARTICIPANTS_SHOWN);

  async function importList() {
    setBusy(true);
    try {
      const res = await api<{ added: number; skipped: number }>(`/events/${event.id}/organization/people/import`, { method: "POST", body: JSON.stringify({ kind: "PARTICIPANT", text: pasted }) });
      toast.success(`${plural(res.added, "participante incluído", "participantes incluídos")}`, res.skipped > 0 ? `${plural(res.skipped, "nome repetido ficou", "nomes repetidos ficaram")} de fora.` : undefined);
      setPasting(false);
      setPasted("");
      reload();
    } catch (e) {
      toast.error("Não foi possível importar.", errorText(e, ""));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Section
      icon={UsersThreeIcon}
      title="Participantes"
      description={`${plural(participants.length, "pessoa na lista", "pessoas na lista")} · público previsto: ${event.expectedAttendees}`}
      action={
        <div className="flex flex-wrap gap-2">
          {participants.length > 0 && (
            <Button size="sm" variant="ghost" icon={DownloadSimpleIcon} onClick={() => downloadCsv(event, participants)}>
              Baixar (CSV)
            </Button>
          )}
          {org.editable && (
            <Button size="sm" variant="secondary" icon={ClipboardTextIcon} onClick={() => setPasting(true)}>
              Colar lista
            </Button>
          )}
        </div>
      }
    >
      {participants.length > 10 && (
        <div className="relative mb-3">
          <Input aria-label="Buscar participante" type="search" placeholder="Buscar por nome, contato ou instituição" value={query} onChange={(e) => setQuery(e.target.value)} className="pl-10" />
          <MagnifyingGlassIcon size={18} aria-hidden className="pointer-events-none absolute top-1/2 left-3 -translate-y-1/2 text-muted" />
        </div>
      )}
      <PeopleList event={event} org={org} kind="PARTICIPANT" people={shown} reload={reload} />
      {!showAll && !needle && filtered.length > PARTICIPANTS_SHOWN && (
        <button type="button" className="mt-2 text-sm font-medium text-primary hover:underline" onClick={() => setShowAll(true)}>
          Mostrar todos ({filtered.length})
        </button>
      )}
      {pasting && (
        <Dialog
          open
          onClose={() => setPasting(false)}
          size="lg"
          title="Colar a lista de participantes"
          description="Uma pessoa por linha: nome; contato; instituição (separados por ponto e vírgula ou copiados de uma planilha). Nomes que já estão na lista ficam de fora."
          footer={
            <>
              <Button variant="secondary" onClick={() => setPasting(false)} disabled={busy}>
                Cancelar
              </Button>
              <Button loading={busy} disabled={!pasted.trim()} onClick={() => void importList()}>
                Incluir na lista
              </Button>
            </>
          }
        >
          <Textarea
            label="Lista"
            rows={10}
            value={pasted}
            onChange={(e) => setPasted(e.target.value)}
            placeholder={"Ana Souza; ana@usp.br; FMUSP\nBruno Lima; (11) 99999-0000; HC"}
            data-autofocus
          />
          <p className="mt-2 text-xs text-muted">{plural(pasted.split(/\r?\n/).filter((l) => l.trim().length >= 2).length, "linha", "linhas")}</p>
        </Dialog>
      )}
    </Section>
  );
}

// ---------------------------------------------------------------------------
// Pendências
// ---------------------------------------------------------------------------

function TasksSection({ event, org, reload }: { event: EventRequest; org: EventOrganizationData; reload: () => void }) {
  const confirm = useConfirm();
  const { send, busy } = useSend(reload);
  const [title, setTitle] = useState("");
  const [assigneeId, setAssigneeId] = useState("");
  const [dueDate, setDueDate] = useState("");
  const [showDone, setShowDone] = useState(false);
  const base = `/events/${event.id}/organization/tasks`;
  const open = org.tasks.filter((t) => t.status === "OPEN");
  const done = org.tasks.filter((t) => t.status === "DONE");
  const today = todayKey();

  async function add() {
    const ok = await send(base, "POST", { title, assigneeId: assigneeId || null, dueDate: dueDate || null }, "Pendência criada");
    if (ok) {
      setTitle("");
      setDueDate("");
    }
  }
  async function remove(t: TaskRow) {
    if (await confirm({ title: "Apagar a pendência?", description: t.title, confirmLabel: "Apagar", tone: "danger" })) await send(`${base}/${t.id}`, "DELETE", undefined, "Pendência apagada");
  }

  const row = (t: TaskRow) => {
    const late = t.status === "OPEN" && t.dueDate !== null && t.dueDate < today;
    return (
      <li key={t.id} className="flex items-start gap-3 py-2.5 text-sm">
        <input
          type="checkbox"
          checked={t.status === "DONE"}
          disabled={!org.editable || busy}
          onChange={(e) => void send(`${base}/${t.id}`, "PATCH", { done: e.target.checked })}
          aria-label={t.status === "DONE" ? `Reabrir: ${t.title}` : `Concluir: ${t.title}`}
          className="mt-0.5 size-4 shrink-0 accent-[var(--primary)]"
        />
        <div className="min-w-0 flex-1">
          <p className={cn("font-medium break-words", t.status === "DONE" && "text-muted line-through")}>{t.title}</p>
          <p className="text-xs text-muted">
            {t.assigneeName ?? "Sem responsável"}
            {t.dueDate && (
              <span className={cn(late && "font-semibold text-danger-foreground")}>
                {" · "}
                {late ? "atrasada, era até" : "até"} {formatDateKey(t.dueDate)}
              </span>
            )}
            {t.status === "DONE" && t.doneByName && ` · concluída por ${t.doneByName}`}
          </p>
        </div>
        {org.editable && <IconButton icon={TrashIcon} label={`Apagar ${t.title}`} onClick={() => void remove(t)} />}
      </li>
    );
  };

  return (
    <Section icon={CheckCircleIcon} title="Pendências" description={open.length === 0 ? "Nada pendente." : `${plural(open.length, "pendência aberta", "pendências abertas")}`}>
      {open.length > 0 && <ul className="divide-y divide-border">{open.map(row)}</ul>}
      {org.editable && (
        <div className="mt-3 space-y-2 rounded-xl border border-dashed border-border p-3">
          <Input aria-label="Nova pendência" placeholder="Nova pendência: o que precisa ser feito" value={title} onChange={(e) => setTitle(e.target.value)} />
          <div className="grid gap-2">
            <Select aria-label="Responsável" value={assigneeId} onChange={(e) => setAssigneeId(e.target.value)}>
              <option value="">Sem responsável</option>
              {org.team.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </Select>
            <Input aria-label="Prazo" type="date" value={dueDate} onChange={(e) => setDueDate(e.target.value)} />
          </div>
          <Button size="sm" icon={PlusIcon} loading={busy} disabled={title.trim().length < 2} onClick={() => void add()}>
            Criar pendência
          </Button>
        </div>
      )}
      {done.length > 0 && (
        <div className="mt-3">
          <button type="button" className="text-sm font-medium text-primary hover:underline" onClick={() => setShowDone((v) => !v)}>
            {showDone ? "Esconder" : "Ver"} as concluídas ({done.length})
          </button>
          {showDone && <ul className="mt-1 divide-y divide-border">{done.map(row)}</ul>}
        </div>
      )}
    </Section>
  );
}

// ---------------------------------------------------------------------------
// Logística: buffet, estacionamento, estrutura, equipamentos, observações
// ---------------------------------------------------------------------------

function LogisticsSection({ event, org, reload }: { event: EventRequest; org: EventOrganizationData; reload: () => void }) {
  const { send, busy } = useSend(reload);
  const plan = org.plan;
  const [draft, setDraft] = useState({
    buffetNeeded: plan?.buffetNeeded ?? false,
    buffetDetails: plan?.buffetDetails ?? "",
    parkingNeeded: plan?.parkingNeeded ?? false,
    parkingSpots: plan?.parkingSpots?.toString() ?? "",
    parkingDetails: plan?.parkingDetails ?? "",
    structure: plan?.structure ?? "",
    equipment: plan?.equipment ?? event.infrastructure ?? "",
    notes: plan?.notes ?? "",
  });
  const set = (patch: Partial<typeof draft>) => setDraft((d) => ({ ...d, ...patch }));
  const disabled = !org.editable;

  return (
    <Section icon={ForkKnifeIcon} title="Buffet, estacionamento e estrutura" description={plan?.updatedByName ? `Atualizado por ${plan.updatedByName} em ${new Date(plan.updatedAt).toLocaleString("pt-BR", { dateStyle: "short", timeStyle: "short" })}.` : "Ainda não preenchido."}>
      <div className="space-y-4">
        <div className="space-y-2 rounded-xl border border-border p-3">
          <Switch checked={draft.buffetNeeded} onChange={(v) => set({ buffetNeeded: v })} label="Precisa de buffet" disabled={disabled} />
          {draft.buffetNeeded && <Textarea label="Buffet" rows={2} value={draft.buffetDetails} onChange={(e) => set({ buffetDetails: e.target.value })} placeholder="Fornecedor, horários, quantidade de pessoas, local" disabled={disabled} />}
        </div>
        <div className="space-y-2 rounded-xl border border-border p-3">
          <Switch checked={draft.parkingNeeded} onChange={(v) => set({ parkingNeeded: v })} label="Precisa de estacionamento" disabled={disabled} />
          {draft.parkingNeeded && (
            <>
              <span className="flex items-center gap-2 text-sm text-muted">
                <CarIcon size={16} aria-hidden /> Vagas
              </span>
              <Input aria-label="Vagas" type="number" min={0} inputMode="numeric" value={draft.parkingSpots} onChange={(e) => set({ parkingSpots: e.target.value })} containerClassName="max-w-32" disabled={disabled} />
              <Textarea label="Estacionamento" rows={2} value={draft.parkingDetails} onChange={(e) => set({ parkingDetails: e.target.value })} placeholder="Para quem, placas, horários" disabled={disabled} />
            </>
          )}
        </div>
        <Textarea label="Estrutura necessária" rows={2} value={draft.structure} onChange={(e) => set({ structure: e.target.value })} placeholder="Ex.: mesas de credenciamento, palco, sinalização" disabled={disabled} />
        <Textarea label="Equipamentos" rows={2} value={draft.equipment} onChange={(e) => set({ equipment: e.target.value })} placeholder="Ex.: microfones, projetor, transmissão" disabled={disabled} />
        <Textarea label="Observações" rows={2} value={draft.notes} onChange={(e) => set({ notes: e.target.value })} disabled={disabled} />
        {org.editable && (
          <Button
            loading={busy}
            onClick={() =>
              void send(
                `/events/${event.id}/organization/plan`,
                "PUT",
                { ...draft, parkingSpots: draft.parkingSpots === "" ? null : Number(draft.parkingSpots) },
                "Logística salva",
              )
            }
          >
            Salvar
          </Button>
        )}
      </div>
    </Section>
  );
}

// ---------------------------------------------------------------------------
// Encerramento
// ---------------------------------------------------------------------------

function ClosingCard({ event, org, onClosed }: { event: EventRequest; org: EventOrganizationData; onClosed: () => void }) {
  const toast = useToast();
  const [open, setOpen] = useState(false);
  const [attendees, setAttendees] = useState("");
  const [notes, setNotes] = useState("");
  const [busy, setBusy] = useState(false);
  const phase = confirmedPhase(event);
  const openTasks = org.tasks.filter((t) => t.status === "OPEN").length;

  async function close() {
    setBusy(true);
    try {
      await api(`/events/${event.id}/close`, { method: "POST", body: JSON.stringify({ actualAttendees: attendees === "" ? null : Number(attendees), notes: notes.trim() || undefined }) });
      toast.success("Evento encerrado", "Ficou como Finalizado, com todo o histórico.");
      setOpen(false);
      onClosed();
    } catch (e) {
      toast.error("Não foi possível encerrar.", errorText(e, ""));
    } finally {
      setBusy(false);
    }
  }

  if (phase === "FINISHED") {
    return (
      <Card className="space-y-2 p-4 sm:p-6">
        <h2 className="flex items-center gap-2 text-base font-semibold">
          <FlagCheckeredIcon size={18} className="text-primary" aria-hidden /> Finalizado
        </h2>
        <p className="text-sm text-muted">
          Encerrado por {event.closedByName} em {new Date(event.closedAt!).toLocaleString("pt-BR", { dateStyle: "short", timeStyle: "short" })}.
          {event.actualAttendees !== null && ` Público presente: ${event.actualAttendees} (previsto: ${event.expectedAttendees}).`}
        </p>
        {event.closingNotes && <p className="text-sm whitespace-pre-line">{event.closingNotes}</p>}
      </Card>
    );
  }

  return (
    <Card className="space-y-3 p-4 sm:p-6">
      <h2 className="flex items-center gap-2 text-base font-semibold">
        <FlagCheckeredIcon size={18} className="text-primary" aria-hidden /> Encerramento
      </h2>
      <p className="text-sm text-muted">
        {phase === "ONGOING"
          ? "O evento está acontecendo. No último dia, a equipe encerra com o balanço."
          : phase === "AWAITING_CLOSE"
            ? "O evento terminou: encerre com o público presente e o balanço. Ele fica como Finalizado, com todo o histórico."
            : "Depois do último dia, a equipe encerra o evento com o balanço."}
      </p>
      {org.closable && (
        <Button icon={FlagCheckeredIcon} onClick={() => setOpen(true)} className="w-full">
          Encerrar o evento
        </Button>
      )}
      {open && (
        <Dialog
          open
          onClose={() => setOpen(false)}
          title="Encerrar o evento?"
          description="O evento fica como Finalizado e a organização, só para consulta."
          footer={
            <>
              <Button variant="secondary" onClick={() => setOpen(false)} disabled={busy}>
                Voltar
              </Button>
              <Button icon={FlagCheckeredIcon} loading={busy} onClick={() => void close()}>
                Encerrar
              </Button>
            </>
          }
        >
          <div className="space-y-4">
            {openTasks > 0 && <Alert tone="warning">Ainda há {plural(openTasks, "pendência aberta", "pendências abertas")}. Dá para encerrar mesmo assim.</Alert>}
            <Input label="Público presente" type="number" min={0} inputMode="numeric" value={attendees} onChange={(e) => setAttendees(e.target.value)} hint={`Previsto: ${event.expectedAttendees}`} containerClassName="sm:max-w-xs" />
            <Textarea label="Balanço e ocorrências" rows={4} value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Como foi, o que deu certo, o que melhorar, itens devolvidos" />
          </div>
        </Dialog>
      )}
    </Card>
  );
}

// ---------------------------------------------------------------------------

export function EventOrganization({ event, management, onEventChanged }: { event: EventRequest; management: EventManagement; onEventChanged: () => void }) {
  const toast = useToast();
  const [org, setOrg] = useState<EventOrganizationData | null>(null);
  // As salas do evento, para sugerir o local de cada item da programação.
  const rooms = [...new Set(management.reservations.flatMap((r) => (r.room ? [r.room.name] : [])))];

  const load = useCallback(() => {
    api<EventOrganizationData>(`/events/${event.id}/organization`)
      .then(setOrg)
      .catch((e) => toast.error("Não foi possível carregar a organização.", errorText(e, "")));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [event.id]);

  useEffect(() => {
    load();
  }, [load]);

  if (!org) return <CardListSkeleton />;
  const speakers = org.people.filter((p) => p.kind === "SPEAKER");
  const organizers = org.people.filter((p) => p.kind === "ORGANIZER");

  return (
    <div className="space-y-6">
      {!org.editable && event.status === "CONFIRMED" && event.closedAt && (
        <Alert tone="info">Evento encerrado: a organização fica só para consulta.</Alert>
      )}
      <div className="grid gap-6 lg:grid-cols-[1fr_24rem]">
        <div className="min-w-0 space-y-6">
          <ScheduleSection event={event} org={org} rooms={rooms} reload={load} />
          <Section icon={MicrophoneStageIcon} title="Palestrantes externos" description={speakers.length > 0 ? plural(speakers.length, "palestrante", "palestrantes") : undefined}>
            <PeopleList event={event} org={org} kind="SPEAKER" people={speakers} reload={load} />
          </Section>
          <ParticipantsSection event={event} org={org} reload={load} />
        </div>
        <div className="min-w-0 space-y-6">
          <ClosingCard
            event={event}
            org={org}
            onClosed={() => {
              load();
              onEventChanged();
            }}
          />
          <TasksSection event={event} org={org} reload={load} />
          <Section icon={UserCircleGearIcon} title="Responsáveis pela organização">
            <PeopleList event={event} org={org} kind="ORGANIZER" people={organizers} reload={load} />
          </Section>
          <LogisticsSection key={org.plan?.updatedAt ?? "novo"} event={event} org={org} reload={load} />
        </div>
      </div>
      {org.editable && <p className="text-xs text-muted">Tudo o que muda aqui vai para o Histórico, com quem fez e quando.</p>}
    </div>
  );
}
