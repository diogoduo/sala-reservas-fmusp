import { FloppyDiskIcon, HashIcon, ListBulletsIcon, PencilSimpleIcon, PlusIcon, TextTIcon, TrashIcon, WrenchIcon } from "@phosphor-icons/react";
import { useEffect, useState } from "react";
import { api, ApiError } from "../../lib/api";
import { useConfirm } from "../../lib/confirm";
import { resourceIcon } from "../../lib/icons";
import { useToast } from "../../lib/toast";
import type { Resource } from "../../lib/types";
import { Badge } from "../ui/Badge";
import { Button, IconButton } from "../ui/Button";
import { Dialog } from "../ui/Dialog";
import { EmptyState, Skeleton } from "../ui/Feedback";
import { Input, Switch } from "../ui/Field";
import { Card, IconTile, PageHeader } from "../ui/Surface";

const FORM_ID = "formulario-recurso";

const splitOptions = (value: string) =>
  value
    .split(",")
    .map((option) => option.trim())
    .filter(Boolean);

interface ResourceFormProps {
  resource: Resource | null;
  onSubmit: (body: Record<string, unknown>) => void;
}

function ResourceForm({ resource, onSubmit }: ResourceFormProps) {
  const [name, setName] = useState(resource?.name ?? "");
  const [description, setDescription] = useState(resource?.description ?? "");
  const [requestsQuantity, setRequestsQuantity] = useState(resource?.requestsQuantity ?? false);
  const [detailPrompt, setDetailPrompt] = useState(resource?.detailPrompt ?? "");
  const [detailOptions, setDetailOptions] = useState(resource?.detailOptions.join(", ") ?? "");
  const options = splitOptions(detailOptions);
  const PreviewIcon = resourceIcon(name);

  return (
    <form
      id={FORM_ID}
      onSubmit={(e) => {
        e.preventDefault();
        onSubmit({ name, description: description || undefined, requestsQuantity, detailPrompt: detailPrompt || null, detailOptions: options });
      }}
      className="space-y-6"
    >
      <div className="flex items-center gap-3 rounded-xl bg-surface-muted p-3">
        <IconTile icon={PreviewIcon} />
        <div className="min-w-0">
          <p className="truncate font-semibold">{name || "Novo recurso"}</p>
          <p className="text-xs text-muted">O ícone é escolhido pelo nome.</p>
        </div>
      </div>
      <Input label="Nome do recurso" required placeholder="Ex.: Datashow/Projetor" value={name} onChange={(e) => setName(e.target.value)} />
      <Input label="Descrição" placeholder="Opcional" value={description} onChange={(e) => setDescription(e.target.value)} />

      <div className="space-y-4 rounded-xl border border-border p-4">
        <p className="text-sm font-semibold">No formulário de reserva</p>
        <Switch
          checked={requestsQuantity}
          onChange={setRequestsQuantity}
          label="Pedir quantidade"
          description="Ex.: quantos computadores ou Chromebooks."
        />
        <Input
          label="Pedir um detalhe (texto de exemplo)"
          placeholder="Ex.: Zoom, Teams, Google Meet"
          hint="Deixe vazio para não pedir detalhe."
          value={detailPrompt}
          onChange={(e) => setDetailPrompt(e.target.value)}
        />
        <Input
          label="Opções fixas do detalhe"
          placeholder="Separadas por vírgula"
          hint="Se preencher, o detalhe vira uma lista de escolha obrigatória."
          value={detailOptions}
          onChange={(e) => setDetailOptions(e.target.value)}
        />
        {options.length > 0 && (
          <ul className="flex flex-wrap gap-1.5" aria-label="Prévia das opções">
            {options.map((option) => (
              <li key={option}>
                <Badge tone="primary">{option}</Badge>
              </li>
            ))}
          </ul>
        )}
      </div>
    </form>
  );
}

export function ResourcesAdmin() {
  const toast = useToast();
  const confirm = useConfirm();
  const [resources, setResources] = useState<Resource[] | null>(null);
  const [editing, setEditing] = useState<Resource | "new" | null>(null);
  const [saving, setSaving] = useState(false);

  async function load() {
    try {
      const { resources: list } = await api<{ resources: Resource[] }>("/resources");
      setResources(list);
    } catch (e) {
      toast.error("Não foi possível carregar os recursos.", e instanceof Error ? e.message : undefined);
      setResources([]);
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
        await api(`/resources/${editing.id}`, { method: "PATCH", body: JSON.stringify(body) });
        toast.success("Recurso atualizado", String(body.name));
      } else {
        await api("/resources", { method: "POST", body: JSON.stringify(body) });
        toast.success("Recurso criado", String(body.name));
      }
      setEditing(null);
      await load();
    } catch (e) {
      toast.error("Não foi possível salvar o recurso.", e instanceof ApiError ? e.message : undefined);
    } finally {
      setSaving(false);
    }
  }

  async function remove(resource: Resource) {
    const ok = await confirm({
      tone: "danger",
      title: `Excluir "${resource.name}"?`,
      description: "Ele sai de todas as salas vinculadas e do formulário de reserva.",
      confirmLabel: "Excluir recurso",
    });
    if (!ok) return;
    try {
      await api(`/resources/${resource.id}`, { method: "DELETE" });
      toast.success("Recurso excluído", resource.name);
      await load();
    } catch (e) {
      toast.error("Não foi possível excluir.", e instanceof ApiError ? e.message : undefined);
    }
  }

  const editingResource = editing === "new" ? null : editing;

  return (
    <div className="space-y-6">
      <PageHeader
        title="Recursos"
        description="Equipamentos e serviços que aparecem no formulário de reserva e nas salas."
        actions={
          <Button icon={PlusIcon} onClick={() => setEditing("new")}>
            Novo recurso
          </Button>
        }
      />

      {resources === null ? (
        <div className="grid gap-3 sm:grid-cols-2">
          {Array.from({ length: 4 }, (_, i) => (
            <Skeleton key={i} className="h-24 rounded-2xl" />
          ))}
        </div>
      ) : resources.length === 0 ? (
        <EmptyState
          icon={WrenchIcon}
          title="Nenhum recurso cadastrado"
          description="Cadastre projetores, microfones, webconferência e o que mais as salas oferecem."
          action={
            <Button icon={PlusIcon} onClick={() => setEditing("new")}>
              Novo recurso
            </Button>
          }
        />
      ) : (
        <ul className="grid gap-3 sm:grid-cols-2">
          {resources.map((resource, index) => (
            <li key={resource.id} className="min-w-0 animate-fade-in-up" style={{ animationDelay: `${Math.min(index, 10) * 30}ms` }}>
              <Card className="flex h-full items-start gap-4 p-4">
                <IconTile icon={resourceIcon(resource.name)} />
                <div className="min-w-0 flex-1">
                  <h2 className="font-semibold">{resource.name}</h2>
                  {resource.description && <p className="text-sm text-muted">{resource.description}</p>}
                  {(resource.requestsQuantity || resource.detailPrompt || resource.detailOptions.length > 0) && (
                    <div className="mt-2 flex flex-wrap gap-1.5">
                      {resource.requestsQuantity && (
                        <Badge tone="info" icon={HashIcon}>
                          Pede quantidade
                        </Badge>
                      )}
                      {resource.detailOptions.length > 0 ? (
                        <Badge tone="info" icon={ListBulletsIcon}>
                          {resource.detailOptions.join(" · ")}
                        </Badge>
                      ) : (
                        resource.detailPrompt && (
                          <Badge tone="info" icon={TextTIcon}>
                            Pede detalhe
                          </Badge>
                        )
                      )}
                    </div>
                  )}
                </div>
                <div className="flex shrink-0 gap-1">
                  <IconButton icon={PencilSimpleIcon} label={`Editar ${resource.name}`} size="sm" onClick={() => setEditing(resource)} />
                  <IconButton icon={TrashIcon} label={`Excluir ${resource.name}`} size="sm" variant="danger-soft" onClick={() => void remove(resource)} />
                </div>
              </Card>
            </li>
          ))}
        </ul>
      )}

      {editing !== null && (
        <Dialog
          open
          variant="drawer"
          onClose={() => setEditing(null)}
          title={editingResource ? `Editar ${editingResource.name}` : "Novo recurso"}
          footer={
            <>
              <Button variant="secondary" onClick={() => setEditing(null)}>
                Cancelar
              </Button>
              <Button type="submit" form={FORM_ID} icon={FloppyDiskIcon} loading={saving}>
                {editingResource ? "Salvar alterações" : "Criar recurso"}
              </Button>
            </>
          }
        >
          <ResourceForm resource={editingResource} onSubmit={(body) => void submit(body)} />
        </Dialog>
      )}
    </div>
  );
}
