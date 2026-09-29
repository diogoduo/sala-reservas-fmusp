import {
  CheckIcon,
  EyeIcon,
  FilePdfIcon,
  FloppyDiskIcon,
  PencilSimpleIcon,
  ScrollIcon,
  TrashIcon,
  UploadSimpleIcon,
} from "@phosphor-icons/react";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { api, ApiError } from "../../lib/api";
import { useAuth } from "../../lib/auth";
import { useConfirm } from "../../lib/confirm";
import { useToast } from "../../lib/toast";
import type { Regulation, RegulationFile } from "../../lib/types";
import { Button, IconButton, Spinner } from "../ui/Button";
import { Dialog } from "../ui/Dialog";
import { Alert, Skeleton } from "../ui/Feedback";
import { Input, Textarea } from "../ui/Field";
import { Card, IconTile, PageHeader } from "../ui/Surface";

const DEFAULT_TITLE = "Regulamento de Uso dos Espaços da FMUSP";

interface RegulationData {
  regulation: Regulation | null;
  files: RegulationFile[];
}

function useRegulation() {
  const [data, setData] = useState<RegulationData | null>(null);
  const reload = () =>
    api<RegulationData>("/regulamento")
      .then(setData)
      .catch(() => setData({ regulation: null, files: [] }));
  useEffect(() => {
    void reload();
  }, []);
  return { data, reload };
}

/** Título atual do regulamento (para o "Li e concordo com o …"). */
export function useRegulationTitle(): string {
  const [title, setTitle] = useState(DEFAULT_TITLE);
  useEffect(() => {
    api<RegulationData>("/regulamento")
      .then((res) => res.regulation?.title && setTitle(res.regulation.title))
      .catch(() => undefined);
  }, []);
  return title;
}

/** **negrito** dentro de uma linha. */
function inline(text: string): ReactNode[] {
  return text.split(/(\*\*[^*]+\*\*)/g).map((part, i) =>
    part.startsWith("**") && part.endsWith("**") ? <strong key={i}>{part.slice(2, -2)}</strong> : part,
  );
}

const BULLET = /^\s*[-•]\s+/;
// Itens numerados das portarias: "1.", "a)", "I." (o marcador fica no texto).
const ENUMERATED = /^\s*(?:\d{1,2}|[a-z]|[IVX]{1,4})[.)]\s+/;
const isItem = (line: string) => BULLET.test(line) || ENUMERATED.test(line);

/**
 * Texto simples do regulamento: linha em branco separa parágrafos; "## " vira
 * título; linhas com "- " viram lista (e "1.", "a)", "I." lista numerada);
 * **negrito**. O SAD escreve sem precisar de editor especial.
 */
export function RegulationText({ body }: { body: string }) {
  const blocks = body.replace(/\r\n/g, "\n").split(/\n{2,}/);
  return (
    <div className="space-y-3 text-sm leading-relaxed">
      {blocks.map((block, i) => {
        const lines = block.split("\n").filter((line) => line.trim() !== "");
        if (lines.length === 0) return null;
        if (lines[0]!.startsWith("## ") || lines[0]!.startsWith("# ")) {
          const [heading, ...rest] = lines;
          return (
            <div key={i} className="space-y-2">
              <h3 className="pt-2 text-base font-semibold">{heading!.replace(/^#+\s*/, "")}</h3>
              {rest.length > 0 && <RegulationText body={rest.join("\n")} />}
            </div>
          );
        }
        if (lines.every(isItem)) {
          return (
            <ul key={i} className="space-y-1 pl-5">
              {lines.map((line, j) =>
                BULLET.test(line) ? (
                  <li key={j} className="list-disc">
                    {inline(line.replace(BULLET, ""))}
                  </li>
                ) : (
                  <li key={j} className="-ml-1 list-none pl-5 -indent-5">
                    {inline(line.trim())}
                  </li>
                ),
              )}
            </ul>
          );
        }
        // Parágrafo seguido de lista no mesmo bloco ("Você se compromete a:\n- …").
        const firstItem = lines.findIndex(isItem);
        if (firstItem > 0) {
          return (
            <div key={i} className="space-y-1">
              <p>{inline(lines.slice(0, firstItem).join(" "))}</p>
              <RegulationText body={lines.slice(firstItem).join("\n")} />
            </div>
          );
        }
        return <p key={i}>{inline(lines.join(" "))}</p>;
      })}
    </div>
  );
}

const formatSize = (bytes: number) => (bytes < 1024 * 1024 ? `${Math.max(1, Math.round(bytes / 1024))} KB` : `${(bytes / 1024 / 1024).toFixed(1)} MB`);

function FileList({ files, onRemove }: { files: RegulationFile[]; onRemove?: (file: RegulationFile) => void }) {
  if (files.length === 0) return null;
  return (
    <ul className="space-y-2">
      {files.map((file) => (
        <li key={file.id} className="flex items-center gap-3 rounded-xl border border-border px-3 py-2.5">
          <FilePdfIcon size={24} className="shrink-0 text-danger-foreground" aria-hidden />
          <a
            href={`/api/regulamento/files/${file.id}`}
            target="_blank"
            rel="noreferrer"
            className="min-w-0 flex-1 truncate text-sm font-medium text-primary hover:underline focus-visible:rounded-sm focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
          >
            {file.fileName}
          </a>
          <span className="shrink-0 text-xs text-muted tabular-nums">{formatSize(file.size)}</span>
          {onRemove && <IconButton icon={TrashIcon} size="sm" variant="danger-soft" label={`Remover ${file.fileName}`} onClick={() => onRemove(file)} />}
        </li>
      ))}
    </ul>
  );
}

/** Regulamento num diálogo, aberto pelo "Li e concordo" do formulário de reserva. */
export function RegulationDialog({ onClose, onAccept }: { onClose: () => void; onAccept?: () => void }) {
  const { data } = useRegulation();
  return (
    <Dialog
      open
      size="lg"
      onClose={onClose}
      title={data?.regulation?.title ?? DEFAULT_TITLE}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Fechar
          </Button>
          {onAccept && (
            <Button icon={CheckIcon} onClick={onAccept} disabled={!data}>
              Li e concordo
            </Button>
          )}
        </>
      }
    >
      {!data ? (
        <div className="space-y-3">
          <Skeleton className="h-4 w-3/4" />
          <Skeleton className="h-4 w-full" />
          <Skeleton className="h-4 w-5/6" />
        </div>
      ) : (
        <div className="space-y-5">
          {data.regulation && <RegulationText body={data.regulation.body} />}
          {data.files.length > 0 && (
            <section className="space-y-2">
              <h3 className="text-sm font-semibold">Portarias</h3>
              <FileList files={data.files} />
            </section>
          )}
        </div>
      )}
    </Dialog>
  );
}

/** Página do regulamento: leitura para todos; o SAD edita o texto e anexa os PDFs. */
export function RegulationPage() {
  const { user } = useAuth();
  const toast = useToast();
  const confirm = useConfirm();
  const { data, reload } = useRegulation();
  const isAdmin = user?.role === "ADMIN";
  const [mode, setMode] = useState<"view" | "edit">("view");
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [saving, setSaving] = useState(false);
  const [uploading, setUploading] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);

  function startEditing() {
    setTitle(data?.regulation?.title ?? DEFAULT_TITLE);
    setBody(data?.regulation?.body ?? "");
    setMode("edit");
  }

  async function save() {
    setSaving(true);
    try {
      await api("/regulamento", { method: "PUT", body: JSON.stringify({ title, body }) });
      toast.success("Regulamento salvo", "Já vale para as novas solicitações.");
      await reload();
      setMode("view");
    } catch (e) {
      toast.error("Não foi possível salvar.", e instanceof ApiError ? e.message : undefined);
    } finally {
      setSaving(false);
    }
  }

  async function upload(files: FileList) {
    setUploading(true);
    for (const file of [...files]) {
      try {
        await api(`/regulamento/files?nome=${encodeURIComponent(file.name)}`, {
          method: "POST",
          headers: { "Content-Type": "application/pdf" },
          body: file,
        });
        toast.success("Arquivo anexado", file.name);
      } catch (e) {
        toast.error(`Não foi possível anexar "${file.name}".`, e instanceof ApiError ? e.message : undefined);
      }
    }
    setUploading(false);
    await reload();
  }

  async function remove(file: RegulationFile) {
    const ok = await confirm({ tone: "danger", title: `Remover "${file.fileName}"?`, confirmLabel: "Remover arquivo" });
    if (!ok) return;
    try {
      await api(`/regulamento/files/${file.id}`, { method: "DELETE" });
      toast.success("Arquivo removido", file.fileName);
      await reload();
    } catch (e) {
      toast.error("Não foi possível remover.", e instanceof ApiError ? e.message : undefined);
    }
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title="Regulamento"
        description={isAdmin ? "Texto e portarias que o solicitante aceita no \"Li e concordo\" ao pedir uma sala." : "Regras de uso dos espaços da FMUSP."}
        actions={
          isAdmin &&
          mode === "view" && (
            <Button icon={PencilSimpleIcon} onClick={startEditing} disabled={!data}>
              Editar
            </Button>
          )
        }
      />

      {!data ? (
        <Skeleton className="h-64 rounded-2xl" />
      ) : mode === "edit" ? (
        <Card className="space-y-5 p-5 sm:p-6">
          <Input label="Título" required value={title} onChange={(e) => setTitle(e.target.value)} />
          <Textarea
            label="Texto"
            rows={16}
            value={body}
            onChange={(e) => setBody(e.target.value)}
            hint={'Linha em branco separa parágrafos. Comece a linha com "## " para um título e com "- " para um item de lista. **Texto entre asteriscos duplos** fica em negrito.'}
            className="font-mono text-sm"
          />
          <details className="rounded-xl border border-border p-4">
            <summary className="flex cursor-pointer items-center gap-2 text-sm font-medium">
              <EyeIcon size={16} aria-hidden /> Prévia
            </summary>
            <div className="mt-4">
              <RegulationText body={body} />
            </div>
          </details>
          <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
            <Button variant="secondary" onClick={() => setMode("view")}>
              Cancelar
            </Button>
            <Button icon={FloppyDiskIcon} loading={saving} disabled={!title.trim()} onClick={() => void save()}>
              Salvar regulamento
            </Button>
          </div>
        </Card>
      ) : (
        <Card className="p-5 sm:p-6">
          <div className="flex items-start gap-3">
            <IconTile icon={ScrollIcon} />
            <div className="min-w-0">
              <h2 className="text-lg font-semibold">{data.regulation?.title ?? DEFAULT_TITLE}</h2>
              {data.regulation && (
                <p className="text-xs text-muted">Atualizado em {new Date(data.regulation.updatedAt).toLocaleDateString("pt-BR")}</p>
              )}
            </div>
          </div>
          <div className="mt-5">{data.regulation ? <RegulationText body={data.regulation.body} /> : <Alert tone="info">O SAD ainda não publicou o regulamento.</Alert>}</div>
        </Card>
      )}

      {data && (data.files.length > 0 || isAdmin) && (
        <Card className="space-y-4 p-5 sm:p-6">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <h2 className="text-base font-semibold">Portarias</h2>
              <p className="text-sm text-muted">{isAdmin ? "Os PDFs anexados aparecem junto do regulamento no formulário." : "Documentos oficiais em PDF."}</p>
            </div>
            {isAdmin && (
              <>
                <Button variant="secondary" icon={uploading ? undefined : UploadSimpleIcon} disabled={uploading} onClick={() => fileInput.current?.click()}>
                  {uploading && <Spinner size={16} />}
                  Anexar PDF
                </Button>
                <input
                  ref={fileInput}
                  type="file"
                  accept="application/pdf"
                  multiple
                  hidden
                  onChange={(e) => {
                    if (e.target.files?.length) void upload(e.target.files);
                    e.target.value = "";
                  }}
                />
              </>
            )}
          </div>
          {data.files.length === 0 ? (
            <p className="text-sm text-muted">Nenhuma portaria anexada ainda.</p>
          ) : (
            <FileList files={data.files} onRemove={isAdmin ? (file) => void remove(file) : undefined} />
          )}
        </Card>
      )}
    </div>
  );
}
