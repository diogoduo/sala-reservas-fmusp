// Feriados e dias úteis — mesma lista de backend/src/lib/calendar.ts (a fonte
// da verdade é o back-end; aqui é só para avisar no formulário). Portaria 2793:
// Art. 6º (funcionamento em dias úteis e sábados) e Art. 9º (cancelamento com
// 3 dias úteis de antecedência).

const FIXED_HOLIDAYS: Record<string, string> = {
  "01-01": "Confraternização Universal",
  "01-25": "Aniversário de São Paulo",
  "04-21": "Tiradentes",
  "05-01": "Dia do Trabalho",
  "07-09": "Revolução Constitucionalista",
  "09-07": "Independência do Brasil",
  "10-12": "Nossa Senhora Aparecida",
  "11-02": "Finados",
  "11-15": "Proclamação da República",
  "11-20": "Dia da Consciência Negra",
  "12-25": "Natal",
};

const pad = (n: number) => String(n).padStart(2, "0");
const keyOf = (d: Date) => `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
const utcDate = (key: string) => new Date(`${key}T12:00:00Z`);

/** Domingo de Páscoa (algoritmo de Meeus/Jones/Butcher). */
function easter(year: number): Date {
  const a = year % 19;
  const b = Math.floor(year / 100);
  const c = year % 100;
  const d = Math.floor(b / 4);
  const e = b % 4;
  const f = Math.floor((b + 8) / 25);
  const g = Math.floor((b - f + 1) / 3);
  const h = (19 * a + b - d - g + 15) % 30;
  const i = Math.floor(c / 4);
  const k = c % 4;
  const l = (32 + 2 * e + 2 * i - h - k) % 7;
  const m = Math.floor((a + 11 * h + 22 * l) / 451);
  const month = Math.floor((h + l - 7 * m + 114) / 31);
  const day = ((h + l - 7 * m + 114) % 31) + 1;
  return new Date(Date.UTC(year, month - 1, day, 12));
}

const cache = new Map<number, Map<string, string>>();

function holidaysOf(year: number): Map<string, string> {
  const cached = cache.get(year);
  if (cached) return cached;
  const map = new Map<string, string>();
  for (const [monthDay, name] of Object.entries(FIXED_HOLIDAYS)) map.set(`${year}-${monthDay}`, name);
  const easterSunday = easter(year);
  const fromEaster = (days: number, name: string) => map.set(keyOf(new Date(easterSunday.getTime() + days * 86_400_000)), name);
  fromEaster(-48, "Carnaval (ponto facultativo)");
  fromEaster(-47, "Carnaval (ponto facultativo)");
  fromEaster(-2, "Sexta-feira Santa");
  fromEaster(60, "Corpus Christi");
  cache.set(year, map);
  return map;
}

/** Nome do feriado/ponto facultativo em "AAAA-MM-DD", ou null. */
export function holidayName(dateKey: string): string | null {
  return holidaysOf(Number(dateKey.slice(0, 4))).get(dateKey) ?? null;
}

/** 0 = domingo … 6 = sábado. */
export function weekdayOf(dateKey: string): number {
  return utcDate(dateKey).getUTCDay();
}

export function isBusinessDay(dateKey: string): boolean {
  const weekday = weekdayOf(dateKey);
  return weekday !== 0 && weekday !== 6 && holidayName(dateKey) === null;
}

export function addDays(dateKey: string, days: number): string {
  return keyOf(new Date(utcDate(dateKey).getTime() + days * 86_400_000));
}

/** Último dia para cancelar/alterar pelo sistema: o 3º dia útil antes da atividade (Art. 9º). */
export function cancellationDeadline(activityDateKey: string, businessDays = 3): string {
  let key = activityDateKey;
  let counted = 0;
  while (counted < businessDays) {
    key = addDays(key, -1);
    if (isBusinessDay(key)) counted++;
  }
  return key;
}

/** "AAAA-MM-DD" de um instante, no fuso da FMUSP. */
export function dateKeyOf(date: Date | string): string {
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Sao_Paulo", year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(
    typeof date === "string" ? new Date(date) : date,
  );
  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? "";
  return `${get("year")}-${get("month")}-${get("day")}`;
}

/** "25/12" */
export function formatDayMonth(dateKey: string): string {
  return `${dateKey.slice(8, 10)}/${dateKey.slice(5, 7)}`;
}
