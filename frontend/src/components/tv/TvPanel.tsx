import { ArrowsOutIcon, CalendarStarIcon, CheckCircleIcon, ClockIcon, DoorOpenIcon, HourglassMediumIcon, MapPinIcon, WifiSlashIcon } from "@phosphor-icons/react";
import { useEffect, useState } from "react";
import { useParams } from "react-router";
import { ACTIVITY_TYPE_LABELS } from "../../lib/activities";
import { api, ApiError } from "../../lib/api";
import { cn } from "../../lib/cn";
import type { ActivityType } from "../../lib/types";
import { LogoMark } from "../ui/Logo";

// Fase 15 — painel de reservas para a TV em frente ao SAD. Abre pelo link
// secreto que o SAD gera na Agenda, sem login. Tela escura, letras grandes,
// atualiza a cada minuto; quando a lista não cabe, as páginas giram sozinhas.

type TvStatus = "CONFIRMED" | "PENDING" | "PRE_RESERVED";

interface TvItem {
  id: string;
  kind: "reservation" | "event";
  title: string;
  start: string;
  end: string;
  status: TvStatus;
  activityType: ActivityType | null;
  rooms: { name: string; building: string; floor: string }[];
}

interface TvData {
  now: string;
  date: string;
  items: TvItem[];
  rooms: { total: number; busyNow: number; freeNow: number };
}

const REFRESH_MS = 60_000;
const PAGE_MS = 12_000;
const NOW_PER_PAGE = 4;
const NEXT_PER_PAGE = 8;

const STATUS: Record<TvStatus, { label: string; className: string; icon: typeof CheckCircleIcon }> = {
  CONFIRMED: { label: "Confirmada", className: "bg-success-soft text-success-foreground", icon: CheckCircleIcon },
  PENDING: { label: "Aguardando aprovação", className: "bg-warning-soft text-warning-foreground", icon: HourglassMediumIcon },
  PRE_RESERVED: { label: "Pré-reserva", className: "bg-info-soft text-info-foreground", icon: HourglassMediumIcon },
};

const clock = (iso: string | Date) => new Date(iso).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" });
const roomsText = (item: TvItem) => (item.rooms.length === 0 ? "Sala a definir" : item.rooms.map((r) => r.name).join(" · "));
const placeText = (item: TvItem) => {
  const places = [...new Set(item.rooms.map((r) => `${r.building}, ${r.floor}`))];
  return places.length === 1 ? places[0] : places.length > 1 ? `${places.length} locais` : "";
};

function StatusPill({ status, large }: { status: TvStatus; large?: boolean }) {
  const s = STATUS[status];
  const Icon = s.icon;
  return (
    <span className={cn("inline-flex shrink-0 items-center gap-1.5 rounded-full font-semibold", s.className, large ? "px-3 py-1 text-base" : "px-2.5 py-0.5 text-sm")}>
      <Icon size={large ? 18 : 15} weight="bold" aria-hidden /> {s.label}
    </span>
  );
}

/** Página atual de uma lista que gira sozinha. */
function paged<T>(list: T[], perPage: number, tick: number) {
  const pages = Math.max(1, Math.ceil(list.length / perPage));
  const page = tick % pages;
  return { items: list.slice(page * perPage, page * perPage + perPage), page, pages };
}

function PageDots({ page, pages }: { page: number; pages: number }) {
  if (pages <= 1) return null;
  return (
    <span className="flex items-center gap-1.5" aria-label={`Página ${page + 1} de ${pages}`}>
      {Array.from({ length: pages }, (_, i) => (
        <span key={i} className={cn("size-2 rounded-full", i === page ? "bg-primary" : "bg-border-strong")} aria-hidden />
      ))}
    </span>
  );
}

function NowCard({ item, now }: { item: TvItem; now: number }) {
  const start = new Date(item.start).getTime();
  const end = new Date(item.end).getTime();
  const progress = Math.min(100, Math.max(0, ((now - start) / (end - start)) * 100));
  return (
    <li className="min-w-0 rounded-2xl border border-border bg-surface p-5 shadow-sm">
      <div className="flex flex-wrap items-start justify-between gap-x-4 gap-y-2">
        <p className="text-2xl font-bold tabular-nums xl:text-3xl">
          {clock(item.start)}–{clock(item.end)}
        </p>
        <StatusPill status={item.status} large />
      </div>
      <p className="mt-2 line-clamp-2 text-2xl leading-tight font-semibold xl:text-3xl">
        {item.kind === "event" && <CalendarStarIcon size={28} weight="fill" className="mr-2 inline align-[-4px] text-primary" aria-label="Evento" />}
        {item.title}
      </p>
      <p className="mt-2 flex items-center gap-2 text-xl text-muted">
        <MapPinIcon size={22} className="shrink-0" aria-hidden />
        <span className="truncate">
          <span className="font-semibold text-foreground">{roomsText(item)}</span>
          {placeText(item) && ` · ${placeText(item)}`}
        </span>
      </p>
      <div className="mt-4 h-2 overflow-hidden rounded-full bg-surface-muted" aria-hidden>
        <div className="h-full rounded-full bg-primary" style={{ width: `${progress}%` }} />
      </div>
    </li>
  );
}

function NextRow({ item }: { item: TvItem }) {
  return (
    <li className="grid grid-cols-[5.5rem_minmax(0,1fr)] items-start gap-3 border-b border-border py-3 last:border-b-0 sm:grid-cols-[7.5rem_minmax(0,1fr)] sm:gap-4">
      <p className="text-2xl font-bold tabular-nums">{clock(item.start)}</p>
      <div className="min-w-0">
        <div className="flex flex-wrap items-start justify-between gap-x-3 gap-y-1">
          <p className="line-clamp-1 min-w-0 text-xl font-semibold xl:text-2xl">
            {item.kind === "event" && <CalendarStarIcon size={22} weight="fill" className="mr-1.5 inline align-[-3px] text-primary" aria-label="Evento" />}
            {item.title}
          </p>
          <StatusPill status={item.status} />
        </div>
        <p className="mt-0.5 truncate text-lg text-muted">
          até {clock(item.end)} · <span className="text-foreground">{roomsText(item)}</span>
          {item.activityType && ` · ${ACTIVITY_TYPE_LABELS[item.activityType]}`}
        </p>
      </div>
    </li>
  );
}

export function TvPanel() {
  const { token = "" } = useParams();
  const [data, setData] = useState<TvData | null>(null);
  const [invalid, setInvalid] = useState<string | null>(null);
  const [offline, setOffline] = useState(false);
  const [updatedAt, setUpdatedAt] = useState<Date | null>(null);
  const [now, setNow] = useState(() => Date.now());
  const [tick, setTick] = useState(0);
  const [fullscreen, setFullscreen] = useState(false);

  useEffect(() => {
    document.title = "Painel da TV — Reserva de Salas";
  }, []);

  // Dados: na hora e a cada minuto. Sem conexão, mantém o último e avisa.
  useEffect(() => {
    let alive = true;
    const load = () =>
      api<TvData>(`/tv/${encodeURIComponent(token)}`)
        .then((res) => {
          if (!alive) return;
          setData(res);
          setOffline(false);
          setUpdatedAt(new Date());
        })
        .catch((e: unknown) => {
          if (!alive) return;
          if (e instanceof ApiError && e.status === 404) setInvalid(e.message);
          else setOffline(true);
        });
    void load();
    const id = setInterval(load, REFRESH_MS);
    return () => {
      alive = false;
      clearInterval(id);
    };
  }, [token]);

  // Relógio e páginas que giram.
  useEffect(() => {
    const clockId = setInterval(() => setNow(Date.now()), 10_000);
    const pageId = setInterval(() => setTick((t) => t + 1), PAGE_MS);
    return () => {
      clearInterval(clockId);
      clearInterval(pageId);
    };
  }, []);

  // Mantém a tela da TV acesa, quando o navegador deixa.
  useEffect(() => {
    let lock: { release: () => Promise<void> } | null = null;
    const request = () => {
      const nav = navigator as Navigator & { wakeLock?: { request: (type: "screen") => Promise<{ release: () => Promise<void> }> } };
      nav.wakeLock
        ?.request("screen")
        .then((l) => (lock = l))
        .catch(() => undefined);
    };
    request();
    const onVisible = () => document.visibilityState === "visible" && request();
    document.addEventListener("visibilitychange", onVisible);
    const onFullscreen = () => setFullscreen(Boolean(document.fullscreenElement));
    document.addEventListener("fullscreenchange", onFullscreen);
    return () => {
      document.removeEventListener("visibilitychange", onVisible);
      document.removeEventListener("fullscreenchange", onFullscreen);
      void lock?.release().catch(() => undefined);
    };
  }, []);

  const items = data?.items ?? [];
  const happening = items.filter((i) => new Date(i.start).getTime() <= now && new Date(i.end).getTime() > now);
  const upcoming = items.filter((i) => new Date(i.start).getTime() > now);
  const finished = items.filter((i) => new Date(i.end).getTime() <= now).length;
  const nowPage = paged(happening, NOW_PER_PAGE, tick);
  const nextPage = paged(upcoming, NEXT_PER_PAGE, tick);
  const today = new Date(now).toLocaleDateString("pt-BR", { weekday: "long", day: "numeric", month: "long" });

  if (invalid) {
    return (
      <div className="dark grid min-h-dvh place-items-center bg-background p-8 text-center text-foreground">
        <div className="max-w-xl space-y-4">
          <LogoMark className="mx-auto size-16" />
          <h1 className="text-3xl font-bold">Painel da TV</h1>
          <p className="text-xl text-muted">{invalid}</p>
        </div>
      </div>
    );
  }

  return (
    <div className="dark flex min-h-dvh flex-col bg-background text-foreground">
      <header className="flex flex-wrap items-center justify-between gap-6 border-b border-border px-6 py-5 lg:px-10">
        <div className="flex items-center gap-4">
          <LogoMark className="size-14" />
          <div>
            <p className="text-2xl font-bold xl:text-3xl">Reserva de Salas · FMUSP</p>
            <p className="text-lg text-muted">Painel do SAD — reservas e eventos de hoje</p>
          </div>
        </div>
        <div className="flex items-center gap-6">
          {!fullscreen && document.fullscreenEnabled && (
            <button
              type="button"
              onClick={() => void document.documentElement.requestFullscreen().catch(() => undefined)}
              className="inline-flex items-center gap-2 rounded-lg border border-border px-3 py-2 text-sm text-muted hover:text-foreground"
            >
              <ArrowsOutIcon size={18} aria-hidden /> Tela cheia
            </button>
          )}
          <div className="text-right">
            <p className="text-5xl font-bold tabular-nums xl:text-6xl" aria-live="off">
              {clock(new Date(now))}
            </p>
            <p className="text-lg text-muted first-letter:uppercase">{today}</p>
          </div>
        </div>
      </header>

      {offline && (
        <p className="flex items-center justify-center gap-2 bg-warning-soft px-6 py-2 text-lg font-medium text-warning-foreground" role="status">
          <WifiSlashIcon size={22} aria-hidden /> Sem conexão com o sistema — mostrando os últimos dados e tentando de novo.
        </p>
      )}

      <div className="grid gap-4 px-6 pt-5 sm:grid-cols-3 lg:px-10">
        {[
          { icon: ClockIcon, label: "Acontecendo agora", value: data ? happening.length : "—" },
          { icon: HourglassMediumIcon, label: "Ainda hoje", value: data ? upcoming.length : "—" },
          { icon: DoorOpenIcon, label: "Salas livres agora", value: data ? `${data.rooms.freeNow} de ${data.rooms.total}` : "—" },
        ].map((s) => (
          <div key={s.label} className="flex items-center gap-4 rounded-2xl border border-border bg-surface px-5 py-4">
            <s.icon size={36} className="shrink-0 text-primary" aria-hidden />
            <div>
              <p className="text-3xl font-bold tabular-nums xl:text-4xl">{s.value}</p>
              <p className="text-lg text-muted">{s.label}</p>
            </div>
          </div>
        ))}
      </div>

      <main className="grid flex-1 gap-6 px-6 py-5 lg:grid-cols-[minmax(0,1.1fr)_minmax(0,1fr)] lg:px-10">
        <section aria-labelledby="tv-agora" className="flex min-h-0 min-w-0 flex-col">
          <div className="mb-3 flex items-center justify-between gap-3">
            <h2 id="tv-agora" className="text-2xl font-bold tracking-wide uppercase">
              Acontecendo agora
            </h2>
            <PageDots page={nowPage.page} pages={nowPage.pages} />
          </div>
          {data === null ? (
            <p className="text-xl text-muted">Carregando…</p>
          ) : happening.length === 0 ? (
            <p className="rounded-2xl border border-dashed border-border px-6 py-10 text-center text-2xl text-muted">Nenhuma atividade agora.</p>
          ) : (
            <ul className={cn("grid gap-4", nowPage.items.length > 1 && "xl:grid-cols-2")}>
              {nowPage.items.map((item) => (
                <NowCard key={item.id} item={item} now={now} />
              ))}
            </ul>
          )}
        </section>

        <section aria-labelledby="tv-proximas" className="flex min-h-0 min-w-0 flex-col">
          <div className="mb-3 flex items-center justify-between gap-3">
            <h2 id="tv-proximas" className="text-2xl font-bold tracking-wide uppercase">
              Próximas
            </h2>
            <PageDots page={nextPage.page} pages={nextPage.pages} />
          </div>
          {data === null ? (
            <p className="text-xl text-muted">Carregando…</p>
          ) : upcoming.length === 0 ? (
            <p className="rounded-2xl border border-dashed border-border px-6 py-10 text-center text-2xl text-muted">Nada mais marcado para hoje.</p>
          ) : (
            <ul className="rounded-2xl border border-border bg-surface px-5">
              {nextPage.items.map((item) => (
                <NextRow key={item.id} item={item} />
              ))}
            </ul>
          )}
        </section>
      </main>

      <footer className="flex flex-wrap items-center justify-between gap-3 border-t border-border px-6 py-3 text-base text-muted lg:px-10">
        <span>{finished > 0 ? `${finished === 1 ? "1 atividade já encerrada" : `${finished} atividades já encerradas`} hoje` : "Nenhuma atividade encerrada ainda hoje"}</span>
        <span>{updatedAt ? `Atualizado às ${clock(updatedAt)} · atualiza a cada minuto` : "Conectando…"}</span>
      </footer>
    </div>
  );
}
