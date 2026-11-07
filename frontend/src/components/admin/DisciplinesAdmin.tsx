import { BooksIcon, ClipboardTextIcon, MagnifyingGlassIcon, TrashIcon, XIcon } from "@phosphor-icons/react";
import { useCallback, useEffect, useState } from "react";
import { api, ApiError } from "../../lib/api";
import { useCanManage } from "../../lib/auth";
import { useConfirm } from "../../lib/confirm";
import { plural } from "../../lib/format";
import { useToast } from "../../lib/toast";
import { Badge } from "../ui/Badge";
import { Button, IconButton } from "../ui/Button";
import { Dialog } from "../ui/Dialog";
import { Alert, CardListSkeleton } from "../ui/Feedback";
import { Input, Textarea } from "../ui/Field";
import { Card } from "../ui/Surface";

// Fase 19 — disciplinas e os docentes de cada uma (documento SAD/NUCEV, 2.3).
// O SAD cola a planilha; ligar a disciplina libera ao docente a permissão de
// Graduação (ou de Pós), e ele passa a pedir só para as disciplinas dele.

interface DisciplineRow {
  id: string;
  code: string;
  name: string;
  department: string | null;
  level: "UNDERGRADUATE" | "GRADUATE";
  teachers: { userId: string; user: { id: string; name: string; email: string } }[];
}

interface ImportResult {
  lines: number;
  created: number;
  updated: number;
  linked: number;
  missing: string[];
  invalid: string[];
}

const errorText = (e: unknown) => (e instanceof ApiError ? e.message : "");

export function DisciplinesAdmin() {
  const canManage = useCanManage();
  const toast = useToast();
  const confirm = useConfirm();
  const [list, setList] = useState<DisciplineRow[] | null>(null);
  const [query, setQuery] = useState("");
  const [pasting, setPasting] = useState(false);
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<ImportResult | null>(null);

  const load = useCallback(() => {
    api<{ disciplines: DisciplineRow[] }>("/disciplines")
      .then((res) => setList(res.disciplines))
      .catch((e) => toast.error("Não foi possível carregar as disciplinas.", errorText(e)));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  useEffect(() => load(), [load]);

  async function importList() {
    setBusy(true);
    try {
      const res = await api<ImportResult>("/disciplines/import", { method: "POST", body: JSON.stringify({ text }) });
      setResult(res);
      setPasting(false);
      setText("");
      toast.success("Planilha importada", `${plural(res.created, "disciplina nova", "disciplinas novas")} · ${plural(res.linked, "ligação", "ligações")}`);
      load();
    } catch (e) {
      toast.error("Não foi possível importar.", errorText(e));
    } finally {
      setBusy(false);
    }
  }

  async function run(path: string, success: string) {
    try {
      await api(path, { method: "DELETE" });
      toast.success(success);
      load();
    } catch (e) {
      toast.error("Não foi possível concluir.", errorText(e));
    }
  }

  const needle = query.trim().toLowerCase();
  const visible = (list ?? []).filter((d) => !needle || `${d.code} ${d.name} ${d.department ?? ""} ${d.teachers.map((t) => `${t.user.name} ${t.user.email}`).join(" ")}`.toLowerCase().includes(needle));

  return (
    <Card className="space-y-4 p-4 sm:p-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="flex items-center gap-2 text-base font-semibold">
            <BooksIcon size={18} className="text-primary" aria-hidden /> Disciplinas e docentes
          </h2>
          <p className="text-sm text-muted">
            O docente ligado a uma disciplina pede as reservas de Graduação (ou de Pós) só das disciplinas dele. Quem não tem disciplina ligada, como a secretaria,
            pede para qualquer uma.
          </p>
        </div>
        {canManage && (
          <Button variant="secondary" icon={ClipboardTextIcon} onClick={() => setPasting(true)}>
            Colar planilha
          </Button>
        )}
      </div>

      {result && (
        <Alert tone={result.missing.length > 0 || result.invalid.length > 0 ? "warning" : "success"}>
          {plural(result.lines, "linha lida", "linhas lidas")}: {plural(result.created, "disciplina nova", "disciplinas novas")}, {result.updated} atualizada(s),{" "}
          {plural(result.linked, "docente ligado", "docentes ligados")}.
          {result.missing.length > 0 && ` Sem cadastro no sistema (entram depois do primeiro login): ${result.missing.join(", ")}.`}
          {result.invalid.length > 0 && ` Linhas com código inválido: ${result.invalid.join(", ")}.`}
        </Alert>
      )}

      {(list?.length ?? 0) > 8 && (
        <div className="relative">
          <Input aria-label="Buscar disciplina" type="search" placeholder="Código, disciplina, departamento ou docente" value={query} onChange={(e) => setQuery(e.target.value)} className="pl-10" />
          <MagnifyingGlassIcon size={18} aria-hidden className="pointer-events-none absolute top-1/2 left-3 -translate-y-1/2 text-muted" />
        </div>
      )}

      {list === null ? (
        <CardListSkeleton />
      ) : list.length === 0 ? (
        <p className="text-sm text-muted">Nenhuma disciplina cadastrada. Cole a planilha de disciplinas e docentes.</p>
      ) : (
        <ul className="divide-y divide-border">
          {visible.map((d) => (
            <li key={d.id} className="flex flex-wrap items-start gap-3 py-3">
              <div className="min-w-0 flex-1">
                <p className="flex flex-wrap items-center gap-2 text-sm">
                  <span className="font-mono font-semibold">{d.code}</span>
                  <span className="font-medium">{d.name}</span>
                  <Badge tone={d.level === "GRADUATE" ? "info" : "primary"}>{d.level === "GRADUATE" ? "Pós" : "Graduação"}</Badge>
                </p>
                {d.department && <p className="text-xs text-muted">{d.department}</p>}
                <div className="mt-1.5 flex flex-wrap gap-1.5">
                  {d.teachers.length === 0 ? (
                    <span className="text-xs text-muted italic">Sem docente ligado</span>
                  ) : (
                    d.teachers.map((t) => (
                      <span key={t.userId} className="inline-flex items-center gap-1 rounded-full bg-surface-muted py-0.5 pr-1 pl-2.5 text-xs">
                        {t.user.name}
                        {canManage && (
                          <button
                            type="button"
                            aria-label={`Desligar ${t.user.name} de ${d.code}`}
                            className="rounded-full p-0.5 text-muted hover:bg-surface hover:text-foreground"
                            onClick={async () => {
                              if (await confirm({ title: `Desligar ${t.user.name}?`, description: `${d.code} · ${d.name}. A permissão de pedir continua; só a restrição desta disciplina sai.`, confirmLabel: "Desligar" }))
                                void run(`/disciplines/${d.id}/teachers/${t.userId}`, "Docente desligado da disciplina");
                            }}
                          >
                            <XIcon size={12} aria-hidden />
                          </button>
                        )}
                      </span>
                    ))
                  )}
                </div>
              </div>
              {canManage && (
                <IconButton
                  icon={TrashIcon}
                  label={`Apagar ${d.code}`}
                  onClick={async () => {
                    if (await confirm({ title: `Apagar ${d.code}?`, description: d.name, confirmLabel: "Apagar", tone: "danger" })) void run(`/disciplines/${d.id}`, "Disciplina apagada");
                  }}
                />
              )}
            </li>
          ))}
        </ul>
      )}

      {pasting && (
        <Dialog
          open
          onClose={() => setPasting(false)}
          size="lg"
          title="Colar a planilha de disciplinas"
          description="Uma disciplina por linha: código; disciplina; e-mail do docente; departamento; G (Graduação) ou P (Pós). Pode copiar direto do Excel. A mesma disciplina pode vir em várias linhas, uma por docente."
          footer={
            <>
              <Button variant="secondary" onClick={() => setPasting(false)} disabled={busy}>
                Cancelar
              </Button>
              <Button loading={busy} disabled={!text.trim()} onClick={() => void importList()}>
                Importar
              </Button>
            </>
          }
        >
          <Textarea
            label="Planilha"
            rows={10}
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder={"MCM0101; Clínica Médica I; docente@fm.usp.br; Clínica Médica; G\nMCM5001; Tópicos em Clínica; docente@fm.usp.br; Clínica Médica; P"}
            data-autofocus
          />
        </Dialog>
      )}
    </Card>
  );
}
