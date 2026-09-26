import { useEffect, useState } from "react";
import { api, ApiError } from "../../lib/api";
import type { Resource } from "../../lib/types";

export function ResourcesAdmin() {
  const [resources, setResources] = useState<Resource[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [requestsQuantity, setRequestsQuantity] = useState(false);
  const [detailPrompt, setDetailPrompt] = useState("");
  const [detailOptions, setDetailOptions] = useState(""); // separadas por vírgula
  const [editingId, setEditingId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function load() {
    setLoading(true);
    try {
      const { resources: list } = await api<{ resources: Resource[] }>("/resources");
      setResources(list);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Falha ao carregar recursos.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void load();
  }, []);

  function startEdit(resource: Resource) {
    setEditingId(resource.id);
    setName(resource.name);
    setDescription(resource.description ?? "");
    setRequestsQuantity(resource.requestsQuantity);
    setDetailPrompt(resource.detailPrompt ?? "");
    setDetailOptions(resource.detailOptions.join(", "));
  }

  function resetForm() {
    setEditingId(null);
    setName("");
    setDescription("");
    setRequestsQuantity(false);
    setDetailPrompt("");
    setDetailOptions("");
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const body = JSON.stringify({
        name,
        description: description || undefined,
        requestsQuantity,
        detailPrompt: detailPrompt || null,
        detailOptions: detailOptions
          .split(",")
          .map((option) => option.trim())
          .filter(Boolean),
      });
      if (editingId) {
        await api(`/resources/${editingId}`, { method: "PATCH", body });
      } else {
        await api("/resources", { method: "POST", body });
      }
      resetForm();
      await load();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Falha ao salvar recurso.");
    } finally {
      setBusy(false);
    }
  }

  async function remove(id: string) {
    if (!confirm("Excluir este recurso? Ele será removido de todas as salas vinculadas.")) return;
    setBusy(true);
    setError(null);
    try {
      await api(`/resources/${id}`, { method: "DELETE" });
      await load();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Falha ao excluir recurso.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div>
      <form onSubmit={submit} className="flex flex-wrap items-end gap-3 rounded-lg border border-slate-200 p-4">
        <div className="flex-1 min-w-[180px]">
          <label className="block text-sm font-medium text-slate-700">Nome do recurso</label>
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            required
            className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
            placeholder="Ex.: Datashow/Projetor"
          />
        </div>
        <div className="flex-1 min-w-[220px]">
          <label className="block text-sm font-medium text-slate-700">Descrição (opcional)</label>
          <input
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
          />
        </div>
        <div className="flex-1 min-w-[220px]">
          <label className="block text-sm font-medium text-slate-700">Pedir detalhe (texto de exemplo)</label>
          <input
            value={detailPrompt}
            onChange={(e) => setDetailPrompt(e.target.value)}
            className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
            placeholder="Vazio = não pede. Ex.: Zoom, Teams…"
          />
        </div>
        <div className="flex-1 min-w-[220px]">
          <label className="block text-sm font-medium text-slate-700">Opções do detalhe (opcional)</label>
          <input
            value={detailOptions}
            onChange={(e) => setDetailOptions(e.target.value)}
            className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
            placeholder="Separadas por vírgula; vira uma lista de escolha"
          />
        </div>
        <label className="flex items-center gap-2 pb-2 text-sm">
          <input type="checkbox" checked={requestsQuantity} onChange={(e) => setRequestsQuantity(e.target.checked)} />
          Pedir quantidade
        </label>
        <div className="flex gap-2">
          <button disabled={busy} type="submit" className="rounded-md bg-slate-900 px-4 py-2 text-sm text-white disabled:opacity-50">
            {editingId ? "Salvar" : "Adicionar"}
          </button>
          {editingId && (
            <button type="button" onClick={resetForm} className="rounded-md border border-slate-300 px-4 py-2 text-sm">
              Cancelar
            </button>
          )}
        </div>
      </form>

      {error && <p className="mt-3 text-sm text-red-600">{error}</p>}

      <ul className="mt-4 divide-y divide-slate-200 rounded-lg border border-slate-200">
        {loading && <li className="p-4 text-sm text-slate-500">Carregando…</li>}
        {!loading && resources.length === 0 && <li className="p-4 text-sm text-slate-500">Nenhum recurso cadastrado.</li>}
        {resources.map((r) => (
          <li key={r.id} className="flex items-center justify-between p-3">
            <div>
              <div className="font-medium">{r.name}</div>
              {r.description && <div className="text-sm text-slate-500">{r.description}</div>}
              {(r.requestsQuantity || r.detailPrompt || r.detailOptions.length > 0) && (
                <div className="text-xs text-slate-500">
                  No formulário:{" "}
                  {[
                    r.requestsQuantity && "pede quantidade",
                    r.detailOptions.length > 0
                      ? `escolha entre ${r.detailOptions.join(", ")}`
                      : r.detailPrompt && `pede detalhe ("${r.detailPrompt}")`,
                  ]
                    .filter(Boolean)
                    .join(" · ")}
                </div>
              )}
            </div>
            <div className="flex gap-2">
              <button onClick={() => startEdit(r)} className="text-sm text-slate-600 hover:underline">
                Editar
              </button>
              <button onClick={() => void remove(r.id)} className="text-sm text-red-600 hover:underline">
                Excluir
              </button>
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}
