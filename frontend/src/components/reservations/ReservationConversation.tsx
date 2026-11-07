import { ChatsCircleIcon, PaperPlaneTiltIcon } from "@phosphor-icons/react";
import { useCallback, useEffect, useState } from "react";
import { api, ApiError } from "../../lib/api";
import { useAuth } from "../../lib/auth";
import { cn } from "../../lib/cn";
import { ROLE_LABELS, type UserRole } from "../../lib/permissions";
import { useToast } from "../../lib/toast";
import { Avatar } from "../ui/Avatar";
import { Button } from "../ui/Button";
import { Skeleton } from "../ui/Feedback";
import { Textarea } from "../ui/Field";

// Fase 19 — conversa de cada reserva (documento SAD/NUCEV, 2.2): entre quem pediu
// e o SAD, pelo protocolo. Histórico permanente, com autor, data e hora; cada
// mensagem avisa o outro lado por e-mail. O NUCEV acompanha sem escrever.

interface Message {
  id: string;
  authorId: string | null;
  authorName: string;
  authorRole: UserRole;
  body: string;
  createdAt: string;
}

interface Conversation {
  protocol: string;
  title: string;
  canWrite: boolean;
  messages: Message[];
}

const when = (iso: string) => new Date(iso).toLocaleString("pt-BR", { dateStyle: "short", timeStyle: "short" });

export function ReservationConversation({ protocol, compact }: { protocol: string; compact?: boolean }) {
  const { user } = useAuth();
  const toast = useToast();
  const [data, setData] = useState<Conversation | null>(null);
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const path = `/conversations/${encodeURIComponent(protocol)}`;

  const load = useCallback(() => {
    api<Conversation>(path)
      .then(setData)
      .catch((e) => toast.error("Não foi possível carregar a conversa.", e instanceof ApiError ? e.message : ""));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [path]);
  useEffect(() => load(), [load]);

  async function send() {
    setBusy(true);
    try {
      await api(path, { method: "POST", body: JSON.stringify({ body: text }) });
      setText("");
      load();
    } catch (e) {
      toast.error("Não foi possível enviar.", e instanceof ApiError ? e.message : "");
    } finally {
      setBusy(false);
    }
  }

  return (
    <section aria-label="Conversa da reserva" className={cn("space-y-3", !compact && "rounded-xl border border-border p-3")}>
      {!compact && (
        <h3 className="flex items-center gap-2 text-sm font-semibold">
          <ChatsCircleIcon size={18} className="text-muted" aria-hidden /> Conversa com quem pediu
        </h3>
      )}
      {!data ? (
        <Skeleton className="h-16 rounded-lg" />
      ) : data.messages.length === 0 ? (
        <p className="text-sm text-muted">Nenhuma mensagem ainda. {data.canWrite ? "Escreva abaixo: o outro lado recebe um e-mail." : ""}</p>
      ) : (
        <ul className="space-y-3">
          {data.messages.map((m) => {
            const mine = m.authorId === user?.id;
            return (
              <li key={m.id} className={cn("flex gap-2", mine && "flex-row-reverse")}>
                <Avatar name={m.authorName} size="sm" className="size-7 shrink-0 text-[10px]" />
                <div className={cn("max-w-[85%] rounded-2xl px-3 py-2 text-sm", mine ? "bg-primary-soft text-primary-soft-foreground" : "bg-surface-muted")}>
                  <p className="text-xs text-muted">
                    {m.authorName} · {ROLE_LABELS[m.authorRole] ?? m.authorRole} · {when(m.createdAt)}
                  </p>
                  <p className="mt-0.5 whitespace-pre-line break-words">{m.body}</p>
                </div>
              </li>
            );
          })}
        </ul>
      )}
      {data?.canWrite && (
        <div className="space-y-2">
          <Textarea aria-label="Nova mensagem" rows={3} value={text} onChange={(e) => setText(e.target.value)} placeholder="Escreva uma mensagem" />
          <div className="flex justify-end">
            <Button size="sm" icon={PaperPlaneTiltIcon} loading={busy} disabled={!text.trim()} onClick={() => void send()}>
              Enviar
            </Button>
          </div>
        </div>
      )}
      {data && !data.canWrite && <p className="text-xs text-muted">O NUCEV acompanha a conversa; quem escreve é quem pediu e o SAD.</p>}
    </section>
  );
}
