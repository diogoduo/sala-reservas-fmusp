import { useEffect, useMemo, useState } from "react";
import { api } from "../../lib/api";
import type { BusyInterval } from "../../lib/types";

interface Props {
  roomId: string;
}

const WEEKDAY_LABELS = ["D", "S", "T", "Q", "Q", "S", "S"];

/**
 * Calendário simples (grade mensal, sem biblioteca externa): mostra quais dias
 * têm pelo menos um horário ocupado na sala, com base em GET /api/rooms/:id/availability.
 * Não é uma agenda hora a hora — só orienta a busca antes de preencher o formulário.
 */
export function AvailabilityCalendar({ roomId }: Props) {
  const [monthOffset, setMonthOffset] = useState(0);
  const [busy, setBusy] = useState<BusyInterval[]>([]);
  const [loading, setLoading] = useState(true);

  const viewDate = useMemo(() => {
    const d = new Date();
    d.setDate(1);
    d.setMonth(d.getMonth() + monthOffset);
    return d;
  }, [monthOffset]);

  useEffect(() => {
    const from = new Date(viewDate.getFullYear(), viewDate.getMonth(), 1);
    const to = new Date(viewDate.getFullYear(), viewDate.getMonth() + 1, 1);
    setLoading(true);
    api<{ busy: BusyInterval[] }>(`/rooms/${roomId}/availability?from=${from.toISOString()}&to=${to.toISOString()}`)
      .then((res) => setBusy(res.busy))
      .finally(() => setLoading(false));
  }, [roomId, viewDate]);

  const busyDateKeys = useMemo(() => {
    const keys = new Set<string>();
    for (const interval of busy) {
      // Marca todo dia tocado pelo intervalo (reservas não cruzam meia-noite, mas por segurança percorremos).
      const cursor = new Date(interval.start);
      const end = new Date(interval.end);
      while (cursor < end) {
        keys.add(cursor.toDateString());
        cursor.setDate(cursor.getDate() + 1);
        cursor.setHours(0, 0, 0, 0);
      }
    }
    return keys;
  }, [busy]);

  const firstWeekday = new Date(viewDate.getFullYear(), viewDate.getMonth(), 1).getDay();
  const daysInMonth = new Date(viewDate.getFullYear(), viewDate.getMonth() + 1, 0).getDate();
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  const cells: (Date | null)[] = [
    ...Array.from({ length: firstWeekday }, () => null),
    ...Array.from({ length: daysInMonth }, (_, i) => new Date(viewDate.getFullYear(), viewDate.getMonth(), i + 1)),
  ];

  return (
    <div className="rounded-lg border border-slate-200 p-3">
      <div className="flex items-center justify-between">
        <button onClick={() => setMonthOffset((m) => m - 1)} className="rounded-md px-2 py-1 text-sm hover:bg-slate-100">
          ‹
        </button>
        <span className="text-sm font-medium">
          {viewDate.toLocaleDateString("pt-BR", { month: "long", year: "numeric" })}
        </span>
        <button onClick={() => setMonthOffset((m) => m + 1)} className="rounded-md px-2 py-1 text-sm hover:bg-slate-100">
          ›
        </button>
      </div>

      <div className="mt-2 grid grid-cols-7 gap-1 text-center text-xs text-slate-400">
        {WEEKDAY_LABELS.map((w, i) => (
          <div key={i}>{w}</div>
        ))}
      </div>

      <div className="mt-1 grid grid-cols-7 gap-1">
        {cells.map((date, i) => {
          if (!date) return <div key={i} />;
          const isPast = date < today;
          const isBusy = busyDateKeys.has(date.toDateString());
          return (
            <div
              key={i}
              className={`flex h-8 items-center justify-center rounded-md text-xs ${
                isPast
                  ? "text-slate-300"
                  : isBusy
                    ? "bg-red-100 text-red-700"
                    : "bg-emerald-50 text-emerald-700"
              }`}
              title={isBusy ? "Tem pelo menos um horário ocupado neste dia" : "Sem ocupação registrada"}
            >
              {date.getDate()}
            </div>
          );
        })}
      </div>

      <div className="mt-2 flex gap-4 text-xs text-slate-500">
        <span><span className="inline-block h-2 w-2 rounded-full bg-emerald-400 align-middle" /> livre</span>
        <span><span className="inline-block h-2 w-2 rounded-full bg-red-400 align-middle" /> tem ocupação</span>
      </div>
      {loading && <p className="mt-1 text-xs text-slate-400">Carregando…</p>}
    </div>
  );
}
