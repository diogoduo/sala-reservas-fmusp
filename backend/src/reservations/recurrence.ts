import { rrulestr } from "rrule";
import { env } from "../config/env";
import { AppError } from "../lib/errors";

// Trava de segurança: ~5 anos de recorrência semanal (na prática a série dura no máximo 1 ano).
const MAX_OCCURRENCES = 260;
/** Uma série vai, no máximo, até 1 ano depois da primeira data (também é o horizonte sem `until`). */
const MAX_SPAN_MS = 366 * 24 * 60 * 60 * 1000;

export interface Occurrence {
  start: Date;
  end: Date;
}

function toIcalUtc(date: Date): string {
  return `${date.toISOString().replace(/[-:]/g, "").split(".")[0]}Z`;
}

/**
 * "Relógio de parede": um Date cujos campos UTC são a data e a hora locais no
 * fuso (ex.: quarta 21:00 em São Paulo vira um Date de quarta 21:00 UTC).
 */
function toWallClock(instant: Date, timeZone: string): Date {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat("en-US", {
      timeZone,
      hourCycle: "h23",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    })
      .formatToParts(instant)
      .map((p) => [p.type, Number(p.value)]),
  ) as Record<string, number>;
  return new Date(Date.UTC(parts.year!, parts.month! - 1, parts.day!, parts.hour!, parts.minute!, parts.second!, instant.getUTCMilliseconds()));
}

/** Deslocamento do fuso naquele instante, em ms (São Paulo: -3 h). */
const offsetMs = (instant: Date, timeZone: string) => toWallClock(instant, timeZone).getTime() - instant.getTime();

/** O inverso de toWallClock: a data/hora local volta a ser um instante real. */
function fromWallClock(wall: Date, timeZone: string): Date {
  // Duas passadas acertam o deslocamento mesmo perto de uma troca de horário de verão.
  const guess = new Date(wall.getTime() - offsetMs(wall, timeZone));
  return new Date(wall.getTime() - offsetMs(guess, timeZone));
}

/**
 * Expande uma regra RRule (RFC 5545, apenas a regra — sem "DTSTART:") em uma
 * lista de ocorrências concretas, usando `firstStart`/`firstEnd` como horário
 * (e duração) de cada ocorrência.
 *
 * A regra é avaliada no horário local de APP_TIMEZONE: BYDAY=WE quer dizer
 * quarta-feira em São Paulo. Avaliar em UTC (como era antes) errava o dia de
 * tudo que começa às 21h ou depois — quarta 21:00 em São Paulo já é quinta em
 * UTC. Por isso o início vira "relógio de parede", a lib rrule expande com
 * esses campos, e cada data volta a ser um instante real no fuso. `firstStart`
 * é o início do período reservado (já inclui a montagem).
 *
 * Antes de expandir, confere o período: até 1 ano depois da primeira data, e
 * no máximo 260 ocorrências. O formato da regra (só FREQ=WEEKLY;INTERVAL=n;
 * BYDAY=…) é validado no schema (recurrenceSchema).
 */
export function expandRecurrence(
  rruleExpression: string,
  firstStart: Date,
  firstEnd: Date,
  until: Date | null,
  timeZone: string = env.APP_TIMEZONE,
): Occurrence[] {
  const durationMs = firstEnd.getTime() - firstStart.getTime();
  const horizon = until ?? new Date(firstStart.getTime() + MAX_SPAN_MS);
  if (horizon.getTime() - firstStart.getTime() > MAX_SPAN_MS) {
    throw new AppError(400, "RECURRENCE_TOO_LONG", "Uma série pode se repetir por no máximo 1 ano a partir da primeira data.");
  }

  const wallStart = toWallClock(firstStart, timeZone);
  let rule;
  try {
    rule = rrulestr(`DTSTART:${toIcalUtc(wallStart)}\nRRULE:${rruleExpression}`);
  } catch {
    throw new AppError(400, "INVALID_RRULE", "Expressão de recorrência (RRule) inválida.");
  }

  const starts = rule.between(wallStart, toWallClock(horizon, timeZone), true);

  if (starts.length === 0) {
    throw new AppError(400, "INVALID_RRULE", "A regra de recorrência não gera nenhuma ocorrência dentro do período informado.");
  }
  if (starts.length > MAX_OCCURRENCES) {
    throw new AppError(
      400,
      "TOO_MANY_OCCURRENCES",
      `A recorrência geraria ${starts.length} ocorrências; o limite é ${MAX_OCCURRENCES}. Reduza o período (até quando repete) ou a frequência.`,
    );
  }

  return starts.map((wall) => {
    const start = fromWallClock(wall, timeZone);
    return { start, end: new Date(start.getTime() + durationMs) };
  });
}
