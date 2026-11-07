// Fase 18 — controle de pranchões.

export interface MaterialItem {
  id: string;
  name: string;
  total: number;
  homeLocation: string;
  notes: string | null;
  inUse: number;
  available: number;
}

export interface MaterialLoan {
  id: string;
  itemId: string;
  quantity: number;
  returnedQuantity: number;
  location: string;
  eventId: string | null;
  event: { id: string; protocol: string; title: string } | null;
  reservationProtocol: string | null;
  purpose: string | null;
  takenBy: string;
  takenAt: string;
  expectedReturnAt: string | null;
  returnedBy: string | null;
  returnedAt: string | null;
  recordedByName: string;
}

export type MovementKind = "CHECKOUT" | "RETURN" | "MOVE" | "ADJUST";

export const MOVEMENT_LABELS: Record<MovementKind, string> = { CHECKOUT: "Retirada", RETURN: "Devolução", MOVE: "Movimentação", ADJUST: "Ajuste do estoque" };
export const MOVEMENT_TONES: Record<MovementKind, "warning" | "success" | "info" | "neutral"> = { CHECKOUT: "warning", RETURN: "success", MOVE: "info", ADJUST: "neutral" };

export interface MaterialMovement {
  id: string;
  itemId: string;
  item: { name: string };
  loan: (MaterialLoan & { event: { protocol: string; title: string } | null }) | null;
  kind: MovementKind;
  quantity: number;
  fromLocation: string | null;
  toLocation: string | null;
  person: string | null;
  at: string;
  notes: string | null;
  recordedByName: string;
}

export interface MaterialsData {
  items: MaterialItem[];
  loans: MaterialLoan[];
  movements: MaterialMovement[];
  events: { id: string; protocol: string; title: string }[];
}

/** Plural do nome do material: "pranchão" → "pranchões", "mesa" → "mesas", "cavalete" → "cavaletes". */
export function materialPlural(name: string): string {
  const n = name.toLowerCase();
  if (n.endsWith("ão")) return n.slice(0, -2) + "ões";
  if (/[rzs]$/.test(n)) return n + "es";
  if (n.endsWith("l")) return n.slice(0, -1) + "is";
  return n + "s";
}

/** "12 pranchões", "1 pranchão". */
export const materialCount = (quantity: number, name: string) => `${quantity} ${Math.abs(quantity) === 1 ? name.toLowerCase() : materialPlural(name)}`;
