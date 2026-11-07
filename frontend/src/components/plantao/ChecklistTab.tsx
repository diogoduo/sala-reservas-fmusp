import { CalendarStarIcon, CaretLeftIcon, CaretRightIcon, FireIcon, PencilSimpleIcon, PlusIcon, TrashIcon, WarningIcon } from "@phosphor-icons/react";
import { useCallback, useEffect, useState } from "react";
import { Link } from "react-router";
import { api, ApiError } from "../../lib/api";
import { useAuth } from "../../lib/auth";
import { cn } from "../../lib/cn";
import { useConfirm } from "../../lib/confirm";
import { capitalizeFirst, plural } from "../../lib/format";
import { formatDateKey } from "../../lib/prices";
import { shortDateTime, type ChecklistData, type TaskItem } from "../../lib/tasks";
import { useToast } from "../../lib/toast";
import { EntityHistory } from "../admin/AuditTrail";
import { Badge } from "../ui/Badge";
import { Button, IconButton } from "../ui/Button";
import { Dialog } from "../ui/Dialog";
import { CardListSkeleton } from "../ui/Feedback";
import { Input, Select, Textarea } from "../ui/Field";
import { SegmentedControl } from "../ui/SegmentedControl";
import { Card } from "../ui/Surface";

// Fase 17 — checklist do dia (documento SAD/NUCEV, 5.3): criar, editar,
// atribuir, dar prazo, marcar como prioritária, concluir; as atrasadas e as
// pendências dos eventos aparecem juntas. Quem criou, alterou e concluiu fica
// registrado (e o Histórico de cada tarefa mostra tudo).

const pad = (n: number) => String(n).padStart(2, "0");
export const isoDay = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
export const shiftDay = (key: string, days: number) => {
  const d = new Date(`${key}T12:00:00`);
  d.setDate(d.getDate() + days);
  return isoDay(d);
};
export const longDay = (key: string) => capitalizeFirst(new Date(`${key}T12:00:00`).toLocaleDateString("pt-BR", { weekday: "long", day: "numeric", month: "long" }));
const errorText = (e: unknown) => (e instanceof ApiError ? e.message : "");

interface Draft {
  title: string;
  details: string;
  assigneeId: string;
  dueDate: string;
  priority: boolean;
  eventId: string;
}

const draftOf = (t: TaskItem): Draft => ({
  title: t.title,
  details: t.details ?? "",
  assigneeId: t.assigneeId ?? "",
  dueDate: t.dueDate ?? "",
  priority: t.priority,
  eventId: t.eventId ?? "",
});
const payload = (d: Draft) => ({
  title: d.title,
  details: d.details,
  assigneeId: d.assigneeId || null,
  dueDate: d.dueDate || null,
  priority: d.priority,
  eventId: d.eventId || null,
});

function TaskFields({ draft, set, data }: { draft: Draft; set: (patch: Partial<Draft>) => void; data: ChecklistData }) {
  return (
    <div className="grid gap-3">
      <Select label="Responsável" value={draft.assigneeId} onChange={(e) => set({ assigneeId: e.target.value })}>
        <option value="">Sem responsável</option>
        {data.team.map((p) => (
          <option key={p.id} value={p.id}>
            {p.name}
          </option>
        ))}
      </Select>
      <Input label="Prazo" type="date" value={draft.dueDate} onChange={(e) => set({ dueDate: e.target.value })} />
      <Select label="Evento (opcional)" value={draft.eventId} onChange={(e) => set({ eventId: e.target.value })}>
        <option value="">Nenhum</option>
        {data.events.map((ev) => (
          <option key={ev.id} value={ev.id}>
            {ev.protocol} · {ev.title}
          </option>
        ))}
      </Select>
      <label className="inline-flex items-center gap-2 text-sm font-medium">
        <input type="checkbox" checked={draft.priority} onChange={(e) => set({ priority: e.target.checked })} className="size-4 accent-[var(--primary)]" />
        Prioritária
      </label>
    </div>
  );
}

function EditDialog({ task, data, onClose, onSaved }: { task: TaskItem; data: ChecklistData; onClose: () => void; onSaved: () => void }) {
  const toast = useToast();
  const [draft, setDraft] = useState(draftOf(task));
  const [busy, setBusy] = useState(false);
  async function save() {
    setBusy(true);
    try {
      await api(`/tasks/${task.id}`, { method: "PATCH", body: JSON.stringify(payload(draft)) });
      toast.success("Tarefa alterada");
      onSaved();
    } catch (e) {
      toast.error("Não foi possível salvar.", errorText(e));
    } finally {
      setBusy(false);
    }
  }
  return (
    <Dialog
      open
      onClose={onClose}
      size="lg"
      title="Alterar tarefa"
      description={`Criada por ${task.createdByName} em ${shortDateTime(task.createdAt)}${task.updatedByName ? ` · alterada por último por ${task.updatedByName}` : ""}.`}
      footer={
        <>
          <Button variant="secondary" onClick={onClose} disabled={busy}>
            Cancelar
          </Button>
          <Button loading={busy} disabled={draft.title.trim().length < 2} onClick={() => void save()}>
            Salvar
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <Input label="O que precisa ser feito" required value={draft.title} onChange={(e) => setDraft({ ...draft, title: e.target.value })} />
        <Textarea label="Detalhes" rows={3} value={draft.details} onChange={(e) => setDraft({ ...draft, details: e.target.value })} />
        <TaskFields draft={draft} set={(patch) => setDraft((d) => ({ ...d, ...patch }))} data={data} />
        <EntityHistory entityType="task" entityId={task.id} title="Histórico da tarefa" />
      </div>
    </Dialog>
  );
}

function TaskRow({ task, date, busy, onToggle, onEdit, onDelete }: { task: TaskItem; date: string; busy: boolean; onToggle: () => void; onEdit: () => void; onDelete: () => void }) {
  const done = task.status === "DONE";
  const late = !done && task.dueDate !== null && task.dueDate < date;
  return (
    <li className={cn("flex items-start gap-3 py-3", done && "opacity-75")}>
      <input
        type="checkbox"
        checked={done}
        disabled={busy}
        onChange={onToggle}
        aria-label={done ? `Reabrir: ${task.title}` : `Concluir: ${task.title}`}
        className="mt-1 size-5 shrink-0 accent-[var(--primary)]"
      />
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-1.5">
          <p className={cn("font-medium break-words", done && "text-muted line-through")}>{task.title}</p>
          {task.priority && !done && (
            <Badge tone="danger" icon={FireIcon}>
              Prioritária
            </Badge>
          )}
          {late && (
            <Badge tone="warning" icon={WarningIcon}>
              Atrasada
            </Badge>
          )}
        </div>
        {task.details && <p className="mt-0.5 text-sm whitespace-pre-line text-muted">{task.details}</p>}
        <p className="mt-1 flex flex-wrap gap-x-3 gap-y-0.5 text-xs text-muted">
          <span className={cn(!task.assigneeName && "italic")}>{task.assigneeName ?? "Sem responsável"}</span>
          {task.dueDate && <span className={cn(late && "font-semibold text-warning-foreground")}>até {formatDateKey(task.dueDate)}</span>}
          {task.event && (
            <Link to={`/admin/eventos/${task.event.id}?aba=organizacao`} className="inline-flex items-center gap-1 text-primary hover:underline">
              <CalendarStarIcon size={13} aria-hidden /> {task.event.protocol} · {task.event.title}
            </Link>
          )}
          <span>
            criada por {task.createdByName} em {shortDateTime(task.createdAt)}
          </span>
          {done && task.doneAt && (
            <span className="font-medium text-success-foreground">
              concluída por {task.doneByName} em {shortDateTime(task.doneAt)}
            </span>
          )}
        </p>
      </div>
      <div className="flex shrink-0">
        <IconButton icon={PencilSimpleIcon} label={`Alterar ${task.title}`} onClick={onEdit} />
        <IconButton icon={TrashIcon} label={`Apagar ${task.title}`} onClick={onDelete} />
      </div>
    </li>
  );
}

type Show = "ALL" | "MINE" | "PRIORITY";

export function ChecklistTab({ date, onDateChange }: { date: string; onDateChange: (date: string) => void }) {
  const { user } = useAuth();
  const toast = useToast();
  const confirm = useConfirm();
  const [data, setData] = useState<ChecklistData | null>(null);
  const [busy, setBusy] = useState(false);
  const [show, setShow] = useState<Show>("ALL");
  const [editing, setEditing] = useState<TaskItem | null>(null);
  const empty: Draft = { title: "", details: "", assigneeId: "", dueDate: date, priority: false, eventId: "" };
  const [draft, setDraft] = useState<Draft>(empty);
  const today = isoDay(new Date());

  const load = useCallback(() => {
    api<ChecklistData>(`/tasks?date=${date}`)
      .then(setData)
      .catch((e) => toast.error("Não foi possível carregar o checklist.", errorText(e)));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [date]);

  useEffect(() => {
    setData(null);
    setDraft((d) => ({ ...d, dueDate: date }));
    load();
  }, [load, date]);

  async function send(path: string, method: string, body?: unknown, success?: string) {
    setBusy(true);
    try {
      await api(path, { method, body: body === undefined ? undefined : JSON.stringify(body) });
      if (success) toast.success(success);
      load();
      return true;
    } catch (e) {
      toast.error("Não foi possível salvar.", errorText(e));
      return false;
    } finally {
      setBusy(false);
    }
  }

  async function add() {
    if (await send("/tasks", "POST", payload(draft), "Tarefa criada")) setDraft({ ...empty, assigneeId: draft.assigneeId });
  }

  const visible = (data?.tasks ?? []).filter((t) => (show === "MINE" ? t.assigneeId === user?.id : show === "PRIORITY" ? t.priority : true));
  const open = visible.filter((t) => t.status === "OPEN");
  const groups: { key: string; title: string; items: TaskItem[] }[] = [
    { key: "late", title: "Atrasadas", items: open.filter((t) => t.dueDate !== null && t.dueDate < date) },
    { key: "day", title: date === today ? "Para hoje" : `Para ${longDay(date).toLowerCase()}`, items: open.filter((t) => t.dueDate === date) },
    { key: "undated", title: "Sem prazo", items: open.filter((t) => t.dueDate === null) },
    { key: "done", title: "Concluídas", items: visible.filter((t) => t.status === "DONE") },
  ];
  const counts = data && {
    open: data.tasks.filter((t) => t.status === "OPEN").length,
    late: data.tasks.filter((t) => t.status === "OPEN" && t.dueDate !== null && t.dueDate < date).length,
    priority: data.tasks.filter((t) => t.status === "OPEN" && t.priority).length,
    done: data.tasks.filter((t) => t.status === "DONE").length,
  };

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center gap-2">
        <IconButton icon={CaretLeftIcon} label="Dia anterior" variant="secondary" onClick={() => onDateChange(shiftDay(date, -1))} />
        <IconButton icon={CaretRightIcon} label="Próximo dia" variant="secondary" onClick={() => onDateChange(shiftDay(date, 1))} />
        <Button variant="secondary" onClick={() => onDateChange(today)}>
          Hoje
        </Button>
        <Input type="date" aria-label="Escolher o dia" value={date} onChange={(e) => e.target.value && onDateChange(e.target.value)} className="w-44" />
        <p className="ml-1 text-base font-semibold sm:text-lg">{longDay(date)}</p>
      </div>

      {counts && (
        <p className="text-sm text-muted" aria-live="polite">
          {plural(counts.open, "tarefa aberta", "tarefas abertas")} ·{" "}
          <span className={counts.late > 0 ? "font-medium text-warning-foreground" : undefined}>{plural(counts.late, "atrasada", "atrasadas")}</span> ·{" "}
          <span className={counts.priority > 0 ? "font-medium text-danger-foreground" : undefined}>{plural(counts.priority, "prioritária", "prioritárias")}</span> ·{" "}
          {plural(counts.done, "concluída", "concluídas")} no dia
        </p>
      )}

      <div className="grid items-start gap-6 lg:grid-cols-[minmax(0,1fr)_22rem]">
        <div className="min-w-0 space-y-4">
          <SegmentedControl
            label="Mostrar"
            value={show}
            onChange={setShow}
            options={[
              { value: "ALL", label: "Todas" },
              { value: "MINE", label: "As minhas" },
              { value: "PRIORITY", label: "Prioritárias" },
            ]}
          />
          {data === null ? (
            <CardListSkeleton />
          ) : (
            groups
              .filter((g) => g.items.length > 0 || g.key === "day")
              .map((g) => (
                <Card key={g.key} className="p-4 sm:p-5">
                  <h2 className={cn("text-sm font-semibold", g.key === "late" && "text-warning-foreground")}>
                    {g.title} <span className="font-normal text-muted">({g.items.length})</span>
                  </h2>
                  {g.items.length === 0 ? (
                    <p className="mt-2 text-sm text-muted">Nada para este dia.</p>
                  ) : (
                    <ul className="divide-y divide-border">
                      {g.items.map((t) => (
                        <TaskRow
                          key={t.id}
                          task={t}
                          date={date}
                          busy={busy}
                          onToggle={() => void send(`/tasks/${t.id}`, "PATCH", { done: t.status !== "DONE" }, t.status === "DONE" ? "Tarefa reaberta" : "Tarefa concluída")}
                          onEdit={() => setEditing(t)}
                          onDelete={async () => {
                            if (await confirm({ title: "Apagar a tarefa?", description: t.title, confirmLabel: "Apagar", tone: "danger" })) await send(`/tasks/${t.id}`, "DELETE", undefined, "Tarefa apagada");
                          }}
                        />
                      ))}
                    </ul>
                  )}
                </Card>
              ))
          )}
        </div>

        <Card className="space-y-3 p-4 sm:p-5 lg:sticky lg:top-4">
          <h2 className="flex items-center gap-2 text-base font-semibold">
            <PlusIcon size={18} className="text-primary" aria-hidden /> Nova tarefa
          </h2>
          <Input label="O que precisa ser feito" value={draft.title} onChange={(e) => setDraft({ ...draft, title: e.target.value })} placeholder="Ex.: conferir as chaves do Teatro" />
          <Textarea label="Detalhes (opcional)" rows={2} value={draft.details} onChange={(e) => setDraft({ ...draft, details: e.target.value })} />
          {data && <TaskFields draft={draft} set={(patch) => setDraft((d) => ({ ...d, ...patch }))} data={data} />}
          <Button icon={PlusIcon} loading={busy} disabled={draft.title.trim().length < 2} onClick={() => void add()} className="w-full">
            Criar tarefa
          </Button>
        </Card>
      </div>

      {editing && data && (
        <EditDialog
          task={editing}
          data={data}
          onClose={() => setEditing(null)}
          onSaved={() => {
            setEditing(null);
            load();
          }}
        />
      )}
    </div>
  );
}
