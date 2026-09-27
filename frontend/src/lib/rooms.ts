import type { Room } from "./types";

const collator = new Intl.Collator("pt-BR", { numeric: true, sensitivity: "base" });

/** "Térreo" = 0, "2º andar" = 2; o que não tiver número vai para o fim. */
function floorRank(floor: string) {
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
 * Ordem de exibição das salas: o prédio com mais salas primeiro (o Prédio
 * Principal), depois andar e número da sala, como nas planilhas do SAD.
 */
export function sortRooms<T extends Pick<Room, "building" | "floor" | "name">>(rooms: T[]): T[] {
  const perBuilding = new Map<string, number>();
  for (const room of rooms) perBuilding.set(room.building, (perBuilding.get(room.building) ?? 0) + 1);
  return [...rooms].sort(
    (a, b) =>
      perBuilding.get(b.building)! - perBuilding.get(a.building)! ||
      collator.compare(a.building, b.building) ||
      floorRank(a.floor) - floorRank(b.floor) ||
      roomNumber(a.name) - roomNumber(b.name) ||
      collator.compare(a.name, b.name),
  );
}
