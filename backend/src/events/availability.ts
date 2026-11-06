import type { Prisma, PrismaClient } from "@prisma/client";
import { zonedTime } from "../lib/timezone";

// Fase 11 — disponibilidade dos espaços pedidos num evento, dia a dia. Só
// orienta o formulário e a análise: quem bloqueia de verdade é a pré-reserva do
// SAD (Fase 12), que passa pela checagem de conflito no banco.

type Db = PrismaClient | Prisma.TransactionClient;

export interface AvailabilityWindow {
  date: string;
  /** "HH:MM": da montagem ao fim da desmontagem. */
  start: string;
  end: string;
}

export interface AvailabilitySpace {
  categoryId?: string;
  roomId?: string;
  count: number;
  minCapacity?: number;
  /** Vazio = todos os dias. */
  dates: string[];
}

export interface SpaceDayAvailability {
  date: string;
  needed: number;
  /** Espaços que servem (categoria e capacidade) e estão livres no horário. */
  free: number;
  /** Até 5 nomes livres, para sugerir. */
  suggestions: string[];
}

export async function spaceAvailability(db: Db, windows: AvailabilityWindow[], spaces: AvailabilitySpace[]) {
  const categoryIds = [...new Set(spaces.flatMap((s) => (s.categoryId ? [s.categoryId] : [])))];
  const roomIds = [...new Set(spaces.flatMap((s) => (s.roomId ? [s.roomId] : [])))];
  const rooms = await db.room.findMany({
    where: { status: "ACTIVE", OR: [{ priceCategoryId: { in: categoryIds } }, { id: { in: roomIds } }] },
    select: { id: true, name: true, capacity: true, priceCategoryId: true },
    orderBy: { capacity: "asc" },
  });

  const ranges = windows.map((w) => ({ date: w.date, start: zonedTime(w.date, w.start), end: zonedTime(w.date, w.end) }));
  const minStart = new Date(Math.min(...ranges.map((r) => r.start.getTime())));
  const maxEnd = new Date(Math.max(...ranges.map((r) => r.end.getTime())));
  const ids = rooms.map((r) => r.id);
  const [reservations, blocks] = await Promise.all([
    db.reservation.findMany({
      where: { roomId: { in: ids }, status: { in: ["PENDING", "APPROVED"] }, startTime: { lt: maxEnd }, endTime: { gt: minStart } },
      select: { roomId: true, startTime: true, endTime: true },
    }),
    db.roomBlock.findMany({
      where: { roomId: { in: ids }, startTime: { lt: maxEnd }, endTime: { gt: minStart } },
      select: { roomId: true, startTime: true, endTime: true },
    }),
  ]);
  const busy = [...reservations, ...blocks];
  const isFree = (roomId: string, start: Date, end: Date) =>
    !busy.some((b) => b.roomId === roomId && b.startTime < end && b.endTime > start);

  return spaces.map((space) => {
    const candidates = rooms.filter((r) =>
      space.roomId
        ? r.id === space.roomId
        : r.priceCategoryId === space.categoryId && (!space.minCapacity || r.capacity === null || r.capacity >= space.minCapacity),
    );
    const days: SpaceDayAvailability[] = ranges
      .filter((r) => space.dates.length === 0 || space.dates.includes(r.date))
      .map((r) => {
        const free = candidates.filter((c) => isFree(c.id, r.start, r.end));
        return { date: r.date, needed: space.count, free: free.length, suggestions: free.slice(0, 5).map((c) => c.name) };
      });
    return { candidates: candidates.length, days };
  });
}
