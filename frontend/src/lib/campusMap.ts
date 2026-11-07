// Mapa 3D da faculdade: os prédios, os andares, a posição de cada sala e o
// "como chegar" (da entrada até a escada ou o elevador mais perto, e dali até a
// sala). Tudo em metros, no sistema de cada prédio (x para a direita, y para baixo
// na planta); o prédio tem a posição dele no campus.
import type { Room } from "./types";

export interface MapRect {
  x: number;
  y: number;
  w: number;
  h: number;
  label: string | null;
}

export type LandmarkKind = "STAIRS" | "ELEVATOR" | "ENTRANCE" | "RESTROOM";

export interface MapLandmark {
  /** "*" = em todos os andares do prédio. */
  floor: string;
  kind: LandmarkKind;
  label: string;
  x: number;
  y: number;
}

export interface MapBuildingData {
  id: string;
  name: string;
  x: number;
  y: number;
  color: string | null;
  floors: Record<string, MapRect[]>;
  landmarks: MapLandmark[];
  plans: { id: string; floor: string; bounds: { x: number; y: number; w: number; h: number }; updatedAt: string }[];
  /** Criado na tela (prédio sem dados no mapa ainda). */
  virtual?: boolean;
}

export interface CampusMapData {
  buildings: MapBuildingData[];
  rooms: { id: string; mapX: number | null; mapY: number | null }[];
}

export interface Placement {
  room: Room;
  building: MapBuildingData;
  floor: string;
  x: number;
  y: number;
  /** Sem posição cadastrada: posta automaticamente no andar. */
  auto: boolean;
}

export function floorRank(floor: string) {
  if (/subsolo/i.test(floor)) return -1;
  if (/t[ée]rreo/i.test(floor)) return 0;
  const n = floor.match(/\d+/);
  return n ? Number(n[0]) : 99;
}

export const sortFloors = (floors: string[]) => [...new Set(floors)].sort((a, b) => floorRank(a) - floorRank(b));

/** Os andares do prédio, em ordem, com o nível (o primeiro fora do subsolo é o 0). */
export function levelsOf(building: MapBuildingData, extraFloors: string[] = []): Map<string, number> {
  const floors = sortFloors([...Object.keys(building.floors), ...extraFloors]);
  const ground = floors.findIndex((f) => !/subsolo/i.test(f));
  return new Map(floors.map((f, i) => [f, i - (ground < 0 ? 0 : ground)]));
}

/** "Sala de Aula 1107" → "1107"; nomes sem número ficam curtos. */
export function shortLabel(name: string) {
  const n = name.match(/\b\d{3,4}(?:[\s-]?[A-Z])?$/)?.[0];
  return n ?? (name.length > 18 ? `${name.slice(0, 17)}…` : name);
}

/** O maior retângulo do andar (para pôr as salas sem posição). */
const mainRect = (rects: MapRect[]) => [...rects].sort((a, b) => b.w * b.h - a.w * a.h)[0];

/**
 * A posição de cada sala: a cadastrada ou, sem ela, em fila no maior retângulo
 * do andar. Prédio sem dados no mapa ganha um contorno simples ao lado do campus.
 */
export function placeRooms(rooms: Room[], data: CampusMapData): { placements: Placement[]; buildings: MapBuildingData[] } {
  const buildings = [...data.buildings];
  const position = new Map(data.rooms.map((r) => [r.id, r]));
  let nextX = Math.max(0, ...buildings.map((b) => b.x + Math.max(0, ...Object.values(b.floors).flat().map((r) => r.x + r.w)))) + 40;
  const byName = (name: string) => {
    let b = buildings.find((x) => x.name === name);
    if (!b) {
      b = { id: `virtual-${name}`, name, x: nextX, y: 0, color: "#64748b", floors: {}, landmarks: [], plans: [], virtual: true };
      nextX += 90;
      buildings.push(b);
    }
    return b;
  };

  const placements: Placement[] = [];
  const pending = new Map<string, Room[]>();
  for (const room of rooms) {
    const b = byName(room.building);
    if (!b.floors[room.floor]) b.floors[room.floor] = [{ x: 0, y: 0, w: 60, h: 24, label: null }];
    const p = position.get(room.id);
    if (p && p.mapX !== null && p.mapY !== null) placements.push({ room, building: b, floor: room.floor, x: p.mapX, y: p.mapY, auto: false });
    else pending.set(`${b.name}|${room.floor}`, [...(pending.get(`${b.name}|${room.floor}`) ?? []), room]);
  }
  for (const [key, list] of pending) {
    const [name, floor] = key.split("|") as [string, string];
    const b = byName(name);
    const rect = mainRect(b.floors[floor]!)!;
    const cols = Math.max(1, Math.ceil(Math.sqrt((list.length * rect.w) / Math.max(rect.h, 1))));
    const rows = Math.ceil(list.length / cols);
    list.forEach((room, i) => {
      const col = i % cols;
      const row = Math.floor(i / cols);
      placements.push({ room, building: b, floor, x: rect.x + ((col + 0.5) * rect.w) / cols, y: rect.y + ((row + 0.5) * rect.h) / rows, auto: true });
    });
  }
  return { placements, buildings };
}

/** A ala em que o ponto fica (o rótulo do retângulo). */
export function wingOf(building: MapBuildingData, floor: string, x: number, y: number): string | null {
  const rect = (building.floors[floor] ?? []).find((r) => x >= r.x - 2 && x <= r.x + r.w + 2 && y >= r.y - 2 && y <= r.y + r.h + 2);
  return rect?.label ?? null;
}

/** "a Sala de Aula 2366", "o Anfiteatro 1104", "o Teatro". */
const named = (name: string) => (/^(anfiteatro|teatro|hall|átrio|audit|laborat|espaço|museu)/i.test(name) ? `o ${name}` : `a ${name}`);

const dist = (a: { x: number; y: number }, b: { x: number; y: number }) => Math.hypot(a.x - b.x, a.y - b.y);
const on = (l: MapLandmark, floor: string) => l.floor === "*" || l.floor === floor;
const floorName = (floor: string) => (/andar|subsolo|t[ée]rreo/i.test(floor) ? floor.toLowerCase().replace(/^(\d)/, "$1") : floor);

export interface RoutePoint {
  floor: string;
  x: number;
  y: number;
}

export interface Directions {
  steps: string[];
  path: RoutePoint[];
  entrance: MapLandmark | null;
  vertical: MapLandmark | null;
}

/** Como chegar: da entrada do prédio até a escada (ou o elevador) e dali até a sala. */
export function directionsTo(p: Placement): Directions {
  const { building, floor, room } = p;
  const levels = levelsOf(building, [floor]);
  const entrances = building.landmarks.filter((l) => l.kind === "ENTRANCE");
  const entrance = [...entrances].sort((a, b) => dist(a, p) - dist(b, p))[0] ?? null;
  const wing = wingOf(building, floor, p.x, p.y);
  const where = wing ? `na ${wing}` : `no ${floorName(floor)}`;
  const wingPath = wing ? `pela ${wing}` : "pelo corredor";
  if (!entrance) {
    return { steps: [`${named(room.name).replace(/^./, (c) => c.toUpperCase())} fica ${where} do ${building.name}, no ${floorName(floor)}.`], path: [], entrance: null, vertical: null };
  }
  const steps = [`Entre pelo ${entrance.label}.`];
  if (entrance.floor === floor || entrance.floor === "*") {
    steps.push(`Siga ${wingPath} até ${named(room.name)}.`);
    return { steps, path: [{ floor, x: entrance.x, y: entrance.y }, { floor, x: p.x, y: p.y }], entrance, vertical: null };
  }
  const verticals = building.landmarks.filter((l) => (l.kind === "STAIRS" || l.kind === "ELEVATOR") && on(l, entrance.floor) && on(l, floor));
  const near = (kind: LandmarkKind) => verticals.filter((v) => v.kind === kind).sort((a, b) => dist(a, p) + dist(a, entrance) * 0.4 - (dist(b, p) + dist(b, entrance) * 0.4))[0];
  const stairs = near("STAIRS");
  const elevator = near("ELEVATOR");
  const vertical = stairs ?? elevator ?? null;
  const up = (levels.get(floor) ?? 0) > (levels.get(entrance.floor) ?? 0);
  if (vertical) {
    const alt = elevator && vertical !== elevator ? ` (ou os ${elevator.label.replace(/^Elevadores /, "elevadores ")})` : "";
    steps.push(`Vá até a ${vertical.label}${alt} e ${up ? "suba" : "desça"} até o ${floorName(floor)}.`);
    steps.push(`No ${floorName(floor)}, siga ${wingPath} até ${named(room.name)}.`);
    return {
      steps,
      path: [
        { floor: entrance.floor, x: entrance.x, y: entrance.y },
        { floor: entrance.floor, x: vertical.x, y: vertical.y },
        { floor, x: vertical.x, y: vertical.y },
        { floor, x: p.x, y: p.y },
      ],
      entrance,
      vertical,
    };
  }
  steps.push(`${up ? "Suba" : "Desça"} até o ${floorName(floor)} e siga ${wingPath} até ${named(room.name)}.`);
  return { steps, path: [{ floor: entrance.floor, x: entrance.x, y: entrance.y }, { floor, x: p.x, y: p.y }], entrance, vertical: null };
}
