import type { ActivityType, RoomType } from "./types";

// Taxas de utilização — Portaria FMUSP nº 2794, de 02/06/2026 (valores de
// referência) e Portaria nº 2793, Caps. VIII e IX (isenções e taxas). O sistema
// só ESTIMA: quem define o valor é a Divisão Acadêmica (2793, Art. 14 §1º), e os
// valores são reajustados todo ano pelo IPC-FIPE (2794, Art. 2º §2º) — ao
// reajustar, atualize os números abaixo.

export type SpaceCategory = "THEATER" | "AMPHITHEATER" | "ROOM";

/** Art. 2º: espaços didáticos, por hora, com cobrança mínima de 2 horas. */
export const SPACE_RATES: Record<SpaceCategory, { label: string; hourly: number }> = {
  THEATER: { label: "Teatro", hourly: 625 },
  AMPHITHEATER: { label: "Anfiteatro", hourly: 375 },
  ROOM: { label: "Sala de aula ou de reunião", hourly: 125 },
};

const MIN_CHARGED_HOURS = 2;
/** Art. 2º §1º: 1 hora antes e 1 hora depois, para a equipe técnica preparar o espaço. */
const PREPARATION_HOURS = 2;
/** Art. 5º §2º: adicional de 20% no valor/hora das salas autorizadas para coffee break. */
const COFFEE_BREAK_SURCHARGE = 0.2;
/** 2793, Art. 15 / 2794, Art. 4º, III. */
const DISCOUNT = 0.25;

/** Art. 3º: áreas de apoio. */
export const SUPPORT_AREAS: { code: string; label: string; price: number; unit: "hour" | "day" }[] = [
  { code: "ATRIUM", label: "Átrio", price: 1500, unit: "hour" },
  { code: "TERRACE", label: "Área de vivência / terraço – 5º andar", price: 1200, unit: "hour" },
  { code: "THEATER_FOYER", label: "Foyer do Teatro", price: 500, unit: "day" },
  { code: "TRANSITION_HALL", label: "Hall de transição – 4º andar", price: 500, unit: "day" },
  { code: "PANTRY_5", label: "Copa – 5º andar", price: 450, unit: "day" },
  { code: "THEATER_PANTRY", label: "Copa do Teatro", price: 300, unit: "day" },
];

export function spaceCategoryOf(roomType: RoomType): SpaceCategory {
  if (roomType === "THEATER") return "THEATER";
  if (roomType === "AUDITORIUM") return "AMPHITHEATER";
  return "ROOM";
}

// 2794, Art. 5º: coffee break é vedado nas salas de aula, exceto 2366/2368 (Sala
// do Futuro), 2223 (Design Thinking) e 1357. Mesma regra do back-end (rules.ts).
const COFFEE_BREAK_ROOMS = /\b(2366|2368|2223|1357)\b/;

export function coffeeBreakAllowed(room: { name: string; roomType: RoomType }): boolean {
  return room.roomType !== "CLASSROOM" || COFFEE_BREAK_ROOMS.test(room.name);
}

/** Sala de aula liberada para coffee break (com o adicional de 20%). */
export function isCoffeeBreakClassroom(room: { name: string; roomType: RoomType }): boolean {
  return room.roomType === "CLASSROOM" && COFFEE_BREAK_ROOMS.test(room.name);
}

export interface FeeClass {
  /** EXEMPT = sem taxa do espaço; MAY_BE_EXEMPT = depende de análise; CHARGED = cobrada. */
  kind: "EXEMPT" | "MAY_BE_EXEMPT" | "CHARGED";
  reason: string;
  /** Desconto de 25% das unidades do Sistema FMUSP/HC, USP, SES e Adolfo Lutz. */
  discount: boolean;
}

const INSTITUTIONAL = ["DEPARTMENT", "DIRECTORATE", "ACADEMIC_DIVISION", "COMMISSION", "STAFF"];
const STUDENT = ["CAOC", "AAAOC", "CA_XXI", "DC", "MEDENSINA", "MEDICINA_JR", "EMA", "LEAGUE"];
const DISCOUNTED = ["DEPARTMENT", "DIRECTORATE", "ACADEMIC_DIVISION", "COMMISSION", "HC", "USP_UNIT", "SES", "ADOLFO_LUTZ"];

/** Enquadramento da atividade nas isenções/taxas (2793, Arts. 13–15; 2794, Art. 4º). */
export function classifyFee(type: ActivityType, d: Record<string, unknown>): FeeClass {
  switch (type) {
    case "UNDERGRADUATE":
    case "GRADUATE":
      return { kind: "EXEMPT", reason: "Aulas e provas da graduação e da pós-graduação (Portaria 2793, Art. 13, item 1).", discount: false };
    case "DEFENSE":
      return { kind: "EXEMPT", reason: "Atividade acadêmica das Comissões, sem cobrança aos participantes (Art. 13, item 2).", discount: false };
    case "PUBLIC_EXAM":
      return { kind: "EXEMPT", reason: "Concursos públicos (Art. 13, item 3).", discount: false };
    case "ADMINISTRATIVE":
      return { kind: "EXEMPT", reason: "Reuniões administrativas (Art. 13, item 3).", discount: false };
    case "CULTURE_EXTENSION":
      break;
  }

  const entity = String(d.entity ?? "");
  const discount = DISCOUNTED.includes(entity);
  if (d.sponsored === true) {
    return {
      kind: "CHARGED",
      reason: "Evento com patrocínio: cobrança integral dos espaços, inclusive das áreas de apoio (Portaria 2794, Art. 4º, parágrafo único).",
      discount,
    };
  }
  if (d.free === true) {
    if (INSTITUTIONAL.includes(entity) || STUDENT.includes(entity)) {
      return { kind: "EXEMPT", reason: "Evento institucional da FMUSP ou estudantil, sem inscrição e sem patrocínio (Portaria 2794, Art. 4º, I).", discount: false };
    }
    if (entity === "USP_UNIT") {
      return { kind: "EXEMPT", reason: "Atividade acadêmica de outra Unidade da USP, sem cobrança (Portaria 2793, Art. 13, item 5).", discount: false };
    }
    return {
      kind: "CHARGED",
      reason: "Atividade de entidade externa: há taxa, salvo parceria isenta a critério da Diretoria (Art. 13, item 6). Pedidos de isenção ou redução vão ao SAD/NE em documento assinado (Art. 14 §5º).",
      discount,
    };
  }
  if (STUDENT.includes(entity) && d.costOnly === true) {
    return {
      kind: "MAY_BE_EXEMPT",
      reason:
        "Evento estudantil sem patrocínio, com inscrição só para custeio: pode ser isento após análise do Núcleo de Eventos e aprovação da Divisão Acadêmica, com demonstrativo financeiro apresentado antes (Portaria 2794, Art. 4º, II; Portaria 2793, Art. 13, parágrafo único).",
      discount,
    };
  }
  return { kind: "CHARGED", reason: "Evento com inscrição paga: cobrança integral (Portaria 2794, Art. 4º, IV).", discount };
}

/** Horas cobradas de um espaço didático: mínimo de 2 h + 1 h antes e 1 h depois (Art. 2º). */
export function chargedHours(reservedMinutes: number): number {
  return Math.max(MIN_CHARGED_HOURS, reservedMinutes / 60) + PREPARATION_HOURS;
}

export interface FeeEstimate {
  hours: number;
  hourly: number;
  space: number;
  areas: number;
  discount: number;
  total: number;
}

/** Estimativa por data × nº de datas. */
export function estimateFee({
  category,
  reservedMinutes,
  dates,
  coffeeBreakSurcharge,
  supportAreas,
  discount,
}: {
  category: SpaceCategory;
  reservedMinutes: number;
  dates: number;
  coffeeBreakSurcharge: boolean;
  supportAreas: string[];
  discount: boolean;
}): FeeEstimate {
  const hours = chargedHours(reservedMinutes);
  const hourly = SPACE_RATES[category].hourly * (coffeeBreakSurcharge ? 1 + COFFEE_BREAK_SURCHARGE : 1);
  const space = hours * hourly * dates;
  const areas =
    supportAreas.reduce((sum, code) => {
      const area = SUPPORT_AREAS.find((a) => a.code === code);
      if (!area) return sum;
      return sum + (area.unit === "hour" ? (area.price * reservedMinutes) / 60 : area.price);
    }, 0) * dates;
  const discountValue = discount ? (space + areas) * DISCOUNT : 0;
  return { hours, hourly, space, areas, discount: discountValue, total: space + areas - discountValue };
}

export const formatBRL = (value: number) => value.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
