import {
  ArrowsLeftRightIcon,
  DownloadSimpleIcon,
  FloppyDiskIcon,
  LaptopIcon,
  MagnifyingGlassIcon,
  PencilSimpleIcon,
  PlusIcon,
  TrashIcon,
} from "@phosphor-icons/react";
import { useEffect, useState } from "react";
import { api, ApiError } from "../../lib/api";
import { useConfirm } from "../../lib/confirm";
import { plural } from "../../lib/format";
import { useToast } from "../../lib/toast";
import { NOTEBOOK_LOCATION_LABELS } from "../../lib/types";
import type { Notebook, NotebookLocation } from "../../lib/types";
import { Button, IconButton } from "../ui/Button";
import { Dialog } from "../ui/Dialog";
import { EmptyState, Skeleton } from "../ui/Feedback";
import { Input, Textarea } from "../ui/Field";
import { SegmentedControl } from "../ui/SegmentedControl";
import { Card, IconTile } from "../ui/Surface";

const FORM_ID = "formulario-notebook";
const LOCATIONS: NotebookLocation[] = ["SAD", "NIT"];

const LOCATION_HINTS: Record<NotebookLocation, string> = {
  SAD: "Notebooks reserva, guardados no SAD.",
  NIT: "Notebooks que foram para o NIT, a TI da faculdade.",
};

function NotebookForm({ notebook, onSubmit }: { notebook: Notebook | null; onSubmit: (body: Record<string, unknown>) => void }) {
  const [assetTag, setAssetTag] = useState(notebook?.assetTag ?? "");
  const [model, setModel] = useState(notebook?.model ?? "");
  const [location, setLocation] = useState<NotebookLocation>(notebook?.location ?? "SAD");
  const [notes, setNotes] = useState(notebook?.notes ?? "");

  return (
    <form
      id={FORM_ID}
      onSubmit={(e) => {
        e.preventDefault();
        onSubmit({ assetTag, model, location, notes });
      }}
      className="space-y-5"
    >
      <Input label="Patrimônio" required data-autofocus value={assetTag} onChange={(e) => setAssetTag(e.target.value)} className="font-mono" />
      <Input label="Modelo" placeholder="Ex.: Dell Latitude 3420" value={model} onChange={(e) => setModel(e.target.value)} />
      <div className="flex flex-col gap-1.5">
        <span className="text-sm font-medium">Onde está</span>
        <SegmentedControl
          label="Onde está"
          value={location}
          onChange={setLocation}
          options={LOCATIONS.map((value) => ({ value, label: NOTEBOOK_LOCATION_LABELS[value] }))}
        />
        <p className="text-xs text-muted">{LOCATION_HINTS[location]}</p>
      </div>
      <Textarea label="Observações" rows={2} placeholder="Opcional" value={notes} onChange={(e) => setNotes(e.target.value)} />
    </form>
  );
}

function csvCell(value: string | null) {
  const text = value ?? "";
  return /[";\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

function downloadCsv(notebooks: Notebook[]) {
  const lines = [
    ["Patrimônio", "Modelo", "Onde está", "Observações"],
    ...notebooks.map((n) => [n.assetTag, n.model, NOTEBOOK_LOCATION_LABELS[n.location], n.notes]),
  ];
  const csv = lines.map((line) => line.map(csvCell).join(";")).join("\r\n");
  const url = URL.createObjectURL(new Blob(["﻿" + csv], { type: "text/csv;charset=utf-8" }));
  const a = document.createElement("a");
  a.href = url;
  a.download = `notebooks-${new Date().toISOString().slice(0, 10)}.csv`;
  a.click();
  URL.revokeObjectURL(url);
}

/** Notebooks do SAD: controle de patrimônio (não são reservados pelo sistema). */
export function NotebooksView() {
  const toast = useToast();
  const confirm = useConfirm();
  const [notebooks, setNotebooks] = useState<Notebook[] | null>(null);
  const [query, setQuery] = useState("");
  const [editing, setEditing] = useState<Notebook | "new" | null>(null);
  const [saving, setSaving] = useState(false);

  async function load() {
    try {
      setNotebooks((await api<{ notebooks: Notebook[] }>("/notebooks")).notebooks);
    } catch (e) {
      toast.error("Não foi possível carregar os notebooks.", e instanceof Error ? e.message : undefined);
      setNotebooks([]);
    }
  }

  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function submit(body: Record<string, unknown>) {
    setSaving(true);
    try {
      if (editing && editing !== "new") {
        await api(`/notebooks/${editing.id}`, { method: "PATCH", body: JSON.stringify(body) });
        toast.success("Notebook atualizado", String(body.assetTag));
      } else {
        await api("/notebooks", { method: "POST", body: JSON.stringify(body) });
        toast.success("Notebook cadastrado", String(body.assetTag));
      }
      setEditing(null);
      await load();
    } catch (e) {
      toast.error("Não foi possível salvar o notebook.", e instanceof ApiError ? e.message : undefined);
    } finally {
      setSaving(false);
    }
  }

  async function move(notebook: Notebook) {
    const location: NotebookLocation = notebook.location === "SAD" ? "NIT" : "SAD";
    try {
      await api(`/notebooks/${notebook.id}`, { method: "PATCH", body: JSON.stringify({ location }) });
      toast.success(`Movido: ${NOTEBOOK_LOCATION_LABELS[location]}`, notebook.assetTag);
      await load();
    } catch (e) {
      toast.error("Não foi possível mover o notebook.", e instanceof ApiError ? e.message : undefined);
    }
  }

  async function remove(notebook: Notebook) {
    const ok = await confirm({
      tone: "danger",
      title: `Excluir o notebook ${notebook.assetTag}?`,
      description: "Ele sai da lista de patrimônios do SAD.",
      confirmLabel: "Excluir notebook",
    });
    if (!ok) return;
    try {
      await api(`/notebooks/${notebook.id}`, { method: "DELETE" });
      toast.success("Notebook excluído", notebook.assetTag);
      await load();
    } catch (e) {
      toast.error("Não foi possível excluir.", e instanceof ApiError ? e.message : undefined);
    }
  }

  const needle = query.trim().toLowerCase();
  const visible = (notebooks ?? []).filter((n) => !needle || `${n.assetTag} ${n.model ?? ""} ${n.notes ?? ""}`.toLowerCase().includes(needle));
  const editingNotebook = editing === "new" ? null : editing;

  return (
    <div className="space-y-5">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="relative sm:w-80">
          <Input type="search" aria-label="Buscar notebook" placeholder="Buscar por patrimônio ou modelo" value={query} onChange={(e) => setQuery(e.target.value)} className="pl-10" />
          <MagnifyingGlassIcon size={18} aria-hidden className="pointer-events-none absolute top-1/2 left-3 -translate-y-1/2 text-muted" />
        </div>
        <div className="flex gap-2">
          <Button variant="secondary" icon={DownloadSimpleIcon} disabled={visible.length === 0} onClick={() => downloadCsv(visible)}>
            Exportar CSV
          </Button>
          <Button icon={PlusIcon} onClick={() => setEditing("new")}>
            Novo notebook
          </Button>
        </div>
      </div>

      {notebooks === null ? (
        <div className="grid gap-4 lg:grid-cols-2">
          <Skeleton className="h-64 rounded-2xl" />
          <Skeleton className="h-64 rounded-2xl" />
        </div>
      ) : notebooks.length === 0 ? (
        <EmptyState
          icon={LaptopIcon}
          title="Nenhum notebook cadastrado"
          description="Cadastre os notebooks reserva do SAD e os que foram para o NIT."
          action={
            <Button icon={PlusIcon} onClick={() => setEditing("new")}>
              Novo notebook
            </Button>
          }
        />
      ) : (
        <div className="grid items-start gap-4 lg:grid-cols-2">
          {LOCATIONS.map((location) => {
            const items = visible.filter((n) => n.location === location);
            return (
              <Card key={location} className="overflow-hidden">
                <div className="flex items-center gap-3 border-b border-border px-4 py-3 sm:px-5">
                  <IconTile icon={LaptopIcon} size="sm" tone={location === "SAD" ? "primary" : "info"} />
                  <div className="min-w-0 flex-1">
                    <h3 className="font-semibold">{NOTEBOOK_LOCATION_LABELS[location]}</h3>
                    <p className="text-xs text-muted">{LOCATION_HINTS[location]}</p>
                  </div>
                  <span className="text-sm font-semibold text-muted tabular-nums">{items.length}</span>
                </div>
                {items.length === 0 ? (
                  <p className="px-5 py-6 text-center text-sm text-muted">{needle ? "Nada encontrado aqui." : "Nenhum notebook."}</p>
                ) : (
                  <ul className="divide-y divide-border">
                    {items.map((notebook) => (
                      <li key={notebook.id} className="flex items-center gap-3 px-4 py-2.5 sm:px-5">
                        <div className="min-w-0 flex-1">
                          <p className="font-mono text-sm font-medium">{notebook.assetTag}</p>
                          <p className="truncate text-xs text-muted">
                            {notebook.model ?? <span className="italic">Modelo a informar</span>}
                            {notebook.notes && ` · ${notebook.notes}`}
                          </p>
                        </div>
                        <div className="flex shrink-0 gap-1">
                          <IconButton
                            icon={ArrowsLeftRightIcon}
                            size="sm"
                            label={`Mover ${notebook.assetTag} para ${location === "SAD" ? "o NIT" : "o SAD"}`}
                            onClick={() => void move(notebook)}
                          />
                          <IconButton icon={PencilSimpleIcon} size="sm" label={`Editar ${notebook.assetTag}`} onClick={() => setEditing(notebook)} />
                          <IconButton icon={TrashIcon} size="sm" variant="danger-soft" label={`Excluir ${notebook.assetTag}`} onClick={() => void remove(notebook)} />
                        </div>
                      </li>
                    ))}
                  </ul>
                )}
              </Card>
            );
          })}
        </div>
      )}

      {notebooks && notebooks.length > 0 && (
        <p className="text-xs text-muted">
          {plural(notebooks.length, "notebook", "notebooks")} ·{" "}
          {plural(notebooks.filter((n) => !n.model).length, "sem modelo informado", "sem modelo informado")}
        </p>
      )}

      {editing !== null && (
        <Dialog
          open
          onClose={() => setEditing(null)}
          title={editingNotebook ? `Editar ${editingNotebook.assetTag}` : "Novo notebook"}
          footer={
            <>
              <Button variant="secondary" onClick={() => setEditing(null)}>
                Cancelar
              </Button>
              <Button type="submit" form={FORM_ID} icon={FloppyDiskIcon} loading={saving}>
                {editingNotebook ? "Salvar" : "Cadastrar"}
              </Button>
            </>
          }
        >
          <NotebookForm notebook={editingNotebook} onSubmit={(body) => void submit(body)} />
        </Dialog>
      )}
    </div>
  );
}
