import { rrulestr } from "rrule";
import { AppError } from "../lib/errors";

// Trava de segurança: uma RRule mal configurada (ex.: sem UNTIL/COUNT) pode gerar
// ocorrências indefinidamente. ~5 anos de recorrência semanal.
const MAX_OCCURRENCES = 260;
// Se a série não tiver `until`, limitamos a expansão a 2 anos à frente do início.
const DEFAULT_HORIZON_MS = 1000 * 60 * 60 * 24 * 365 * 2;

export interface Occurrence {
  start: Date;
  end: Date;
}

function toIcalUtc(date: Date): string {
  return `${date.toISOString().replace(/[-:]/g, "").split(".")[0]}Z`;
}

/**
 * Expande uma regra RRule (RFC 5545, apenas a regra — sem "DTSTART:") em uma
 * lista de ocorrências concretas, usando `firstStart`/`firstEnd` como horário
 * (e duração) de cada ocorrência.
 *
 * Observação: o horário de início é tratado como um instante UTC fixo e
 * replicado a cada ocorrência (ex.: toda semana, no mesmo instante). Como o
 * Brasil não usa horário de verão desde 2019, isso equivale a manter o mesmo
 * horário local a cada ocorrência — mas o cálculo não faz conversão de fuso
 * explícita, então revise se o consumidor do sistema operar fora do Brasil.
 */
export function expandRecurrence(rruleExpression: string, firstStart: Date, firstEnd: Date, until: Date | null): Occurrence[] {
  const durationMs = firstEnd.getTime() - firstStart.getTime();

  let rule;
  try {
    rule = rrulestr(`DTSTART:${toIcalUtc(firstStart)}\nRRULE:${rruleExpression}`);
  } catch {
    throw new AppError(400, "INVALID_RRULE", "Expressão de recorrência (RRule) inválida.");
  }

  const horizon = until ?? new Date(firstStart.getTime() + DEFAULT_HORIZON_MS);
  const starts = rule.between(firstStart, horizon, true);

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

  return starts.map((start) => ({ start, end: new Date(start.getTime() + durationMs) }));
}
