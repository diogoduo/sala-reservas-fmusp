import { ArrowSquareOutIcon, ArrowsClockwiseIcon, CopyIcon, ProhibitIcon, TelevisionIcon } from "@phosphor-icons/react";
import { useEffect, useState } from "react";
import { api } from "../../lib/api";
import { useConfirm } from "../../lib/confirm";
import { useToast } from "../../lib/toast";
import { Button } from "../ui/Button";
import { Dialog } from "../ui/Dialog";
import { Alert } from "../ui/Feedback";
import { Input } from "../ui/Field";

// Fase 15 — o SAD gera o link do painel da TV (abre sem login) e pode trocá-lo
// ou desativá-lo; o link anterior para de funcionar na hora.

interface TvLink {
  token: string | null;
  updatedAt: string | null;
  updatedByName: string | null;
}

export function TvLinkDialog({ onClose }: { onClose: () => void }) {
  const toast = useToast();
  const confirm = useConfirm();
  const [link, setLink] = useState<TvLink | null>(null);
  const [busy, setBusy] = useState(false);
  const url = link?.token ? `${window.location.origin}/tv/${link.token}` : null;

  useEffect(() => {
    api<TvLink>("/settings/tv")
      .then(setLink)
      .catch((e: Error) => toast.error("Não foi possível carregar o link.", e.message));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function generate() {
    if (link?.token) {
      const ok = await confirm({
        title: "Gerar um novo link?",
        description: "O link atual para de funcionar na hora: a TV vai precisar abrir o novo.",
        confirmLabel: "Gerar novo link",
      });
      if (!ok) return;
    }
    setBusy(true);
    try {
      setLink(await api<TvLink>("/settings/tv", { method: "POST" }));
      toast.success("Link do painel gerado", "Abra-o no navegador da TV.");
    } catch (e) {
      toast.error("Não foi possível gerar o link.", e instanceof Error ? e.message : undefined);
    } finally {
      setBusy(false);
    }
  }

  async function disable() {
    const ok = await confirm({
      title: "Desativar o painel da TV?",
      description: "O link para de funcionar e a TV mostra o aviso de link desativado.",
      confirmLabel: "Desativar",
      tone: "danger",
    });
    if (!ok) return;
    setBusy(true);
    try {
      setLink(await api<TvLink>("/settings/tv", { method: "DELETE" }));
      toast.success("Painel da TV desativado");
    } catch (e) {
      toast.error("Não foi possível desativar.", e instanceof Error ? e.message : undefined);
    } finally {
      setBusy(false);
    }
  }

  async function copy() {
    if (!url) return;
    try {
      await navigator.clipboard.writeText(url);
      toast.success("Link copiado");
    } catch {
      toast.error("Não foi possível copiar.", "Selecione o link e copie à mão.");
    }
  }

  return (
    <Dialog
      open
      onClose={onClose}
      size="lg"
      title="Painel da TV"
      description="As reservas e os eventos de hoje, em letras grandes, para a TV em frente ao SAD. Atualiza sozinho a cada minuto e não mostra nome nem e-mail de ninguém."
      footer={
        <>
          {link?.token && (
            <Button variant="ghost" icon={ProhibitIcon} onClick={() => void disable()} disabled={busy}>
              Desativar
            </Button>
          )}
          <Button variant={link?.token ? "secondary" : "primary"} icon={link?.token ? ArrowsClockwiseIcon : TelevisionIcon} loading={busy} onClick={() => void generate()} disabled={!link}>
            {link?.token ? "Gerar novo link" : "Gerar o link"}
          </Button>
        </>
      }
    >
      {!link ? (
        <p className="text-sm text-muted">Carregando…</p>
      ) : url ? (
        <div className="space-y-4">
          <Input label="Link do painel" readOnly value={url} onFocus={(e) => e.currentTarget.select()} />
          <div className="flex flex-wrap gap-2">
            <Button variant="secondary" icon={CopyIcon} onClick={() => void copy()}>
              Copiar o link
            </Button>
            <Button variant="secondary" icon={ArrowSquareOutIcon} onClick={() => window.open(url, "_blank", "noopener")}>
              Abrir o painel
            </Button>
          </div>
          <Alert tone="info">
            Abra o link no navegador da TV e use "Tela cheia". Quem tiver o link vê o painel: se ele vazar, gere um novo.
            {link.updatedByName && ` Gerado por ${link.updatedByName} em ${new Date(link.updatedAt!).toLocaleString("pt-BR", { dateStyle: "short", timeStyle: "short" })}.`}
          </Alert>
        </div>
      ) : (
        <Alert tone="info">Ainda não há link. Gere um e abra-o no navegador da TV.</Alert>
      )}
    </Dialog>
  );
}
