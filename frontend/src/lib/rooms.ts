import type { Room } from "./types";

const collator = new Intl.Collator("pt-BR", { numeric: true, sensitivity: "base" });

/** "Subsolo" = −1, "Térreo" = 0, "2º andar" = 2; o que não tiver número vai para o fim. */
function floorRank(floor: string) {
  if (/subsolo/i.test(floor)) return -1;
  if (/t[ée]rreo/i.test(floor)) return 0;
  const n = floor.match(/\d+/);
  return n ? Number(n[0]) : 99;
}

/** Número da sala no nome ("Anfiteatro 1104" → 1104), para seguir a ordem do prédio e não a do tipo. */
function roomNumber(name: string) {
  const n = name.match(/\d{3,}/);
  return n ? Number(n[0]) : Number.POSITIVE_INFINITY;
}

/**
 * Ordem de exibição das salas: primeiro as salas e depois as áreas de apoio
 * (átrios, halls, copas); dentro de cada grupo, o prédio com mais salas
 * primeiro (o Prédio Principal), depois andar e número da sala, como nas
 * planilhas do SAD.
 */
export function sortRooms<T extends Pick<Room, "building" | "floor" | "name"> & { roomType?: Room["roomType"] }>(rooms: T[]): T[] {
  const perBuilding = new Map<string, number>();
  for (const room of rooms) perBuilding.set(room.building, (perBuilding.get(room.building) ?? 0) + 1);
  const isSupport = (room: T) => Number(room.roomType === "SUPPORT_AREA");
  return [...rooms].sort(
    (a, b) =>
      isSupport(a) - isSupport(b) ||
      perBuilding.get(b.building)! - perBuilding.get(a.building)! ||
      collator.compare(a.building, b.building) ||
      floorRank(a.floor) - floorRank(b.floor) ||
      roomNumber(a.name) - roomNumber(b.name) ||
      collator.compare(a.name, b.name),
  );
}

/**
 * A capacidade em texto: "40 pessoas", "sem limite cadastrado" (área de apoio
 * como o átrio, onde "acima de 250" é indicação e não limite) ou "a definir".
 */
export function capacityText(room: Pick<Room, "capacity" | "roomType">): string {
  if (room.capacity !== null) return `${room.capacity} ${room.capacity === 1 ? "pessoa" : "pessoas"}`;
  return room.roomType === "SUPPORT_AREA" ? "sem limite cadastrado" : "a definir";
}

/** "até 40 pessoas" para listas; o mesmo de capacityText quando não há número. */
export const upToText = (room: Pick<Room, "capacity" | "roomType">) => (room.capacity !== null ? `até ${capacityText(room)}` : capacityText(room));

/** Máximo de pessoas no coffee break: o próprio, ou a capacidade do espaço. null = sem coffee. */
export function coffeeLimit(room: Pick<Room, "coffeeAllowed" | "coffeeCapacity" | "capacity">): number | "sem limite" | null {
  if (!room.coffeeAllowed) return null;
  return room.coffeeCapacity ?? room.capacity ?? "sem limite";
}

/** "Coffee break até 60 pessoas" ou "Coffee break" (sem limite cadastrado). */
export function coffeeText(room: Pick<Room, "coffeeAllowed" | "coffeeCapacity" | "capacity">): string | null {
  const limit = coffeeLimit(room);
  if (limit === null) return null;
  return limit === "sem limite" ? "Coffee break" : `Coffee break até ${limit} pessoas`;
}
