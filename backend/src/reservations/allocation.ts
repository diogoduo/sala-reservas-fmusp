import type { Prisma } from "@prisma/client";
import { overlaps, type BusyInterval } from "./conflicts";
import type { Occurrence } from "./recurrence";
import type { RequestedResource } from "./requested-resources";

export type RoomWithResources = Prisma.RoomGetPayload<{ include: { resources: { include: { resource: true } } } }>;

/** Recurso pedido que a sala não tem (`available` = 0) ou tem em quantidade menor. */
export interface MissingResource {
  resourceId: string;
  requested: number;
  available: number;
}

export interface RoomOption {
  room: RoomWithResources;
  fitsCapacity: boolean;
  /** Não impede a aprovação, só pesa na ordem. */
  missingResources: MissingResource[];
  /** Início das ocorrências que colidem com reservas ativas ou bloqueios da sala. */
  conflictingDates: Date[];
}

/**
 * Avalia cada sala para uma solicitação e ordena da mais para a menos adequada:
 *  1. comporta os participantes;
 *  2. está livre em todas as datas;
 *  3. tem os recursos pedidos, na quantidade pedida (faltar recurso não
 *     bloqueia — o Admin pode providenciar um equipamento móvel —, mas pesa na ordem);
 *  4. tem menos datas em conflito;
 *  5. tem a menor capacidade que ainda comporta (não gastar um auditório com
 *     uma reunião de 5 pessoas).
 *
 * No passo 3 só contam recursos que alguma sala tem cadastrado. Os demais
 * (Chromebook, Webconferência, Equipamento pessoal…) são itens avulsos que a
 * TI providencia e não dependem da sala escolhida.
 */
export function rankRoomOptions(
  request: { expectedAttendees: number; requestedResources: RequestedResource[] },
  occurrences: Occurrence[],
  rooms: RoomWithResources[],
  busy: BusyInterval[],
): RoomOption[] {
  const roomFixtures = new Set(rooms.flatMap((room) => room.resources.map((r) => r.resourceId)));
  const needed = request.requestedResources.filter((r) => roomFixtures.has(r.resourceId));

  const options = rooms.map((room): RoomOption => {
    const roomBusy = busy.filter((b) => b.roomId === room.id);
    const available = new Map(room.resources.map((r) => [r.resourceId, r.quantity]));
    return {
      room,
      fitsCapacity: room.capacity >= request.expectedAttendees,
      missingResources: needed.flatMap((r) => {
        const requested = r.quantity ?? 1;
        const have = available.get(r.resourceId) ?? 0;
        return have < requested ? [{ resourceId: r.resourceId, requested, available: have }] : [];
      }),
      conflictingDates: occurrences.filter((o) => roomBusy.some((b) => overlaps(o, b))).map((o) => o.start),
    };
  });

  return options.sort(
    (a, b) =>
      Number(!a.fitsCapacity) - Number(!b.fitsCapacity) ||
      Number(a.conflictingDates.length > 0) - Number(b.conflictingDates.length > 0) ||
      a.missingResources.length - b.missingResources.length ||
      a.conflictingDates.length - b.conflictingDates.length ||
      a.room.capacity - b.room.capacity,
  );
}
