import { CoffeeIcon } from "@phosphor-icons/react";
import { formatDateKey, formatMoney, priceText } from "../../lib/prices";
import type { QuoteEstimate, QuoteLine, QuoteRules } from "../../lib/types";
import { Alert } from "../ui/Feedback";

const hoursText = (h: number) => `${h.toLocaleString("pt-BR", { maximumFractionDigits: 2 })} h`;
const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

/** "10 h de uso + 2 h de preparação" ou "2 dias", para a linha do orçamento. */
export function lineDetail(line: QuoteLine, rules: QuoteRules): string {
  if (line.unit === "DAY") return `${plural(line.quantity, "dia", "dias")} × ${priceText(line.rateCents, line.unit)}`;
  const used = line.days.reduce((sum, d) => sum + d.usedHours, 0);
  const rate = line.rateCents === null ? "valor a definir" : priceText(line.rateCents, line.unit);
  if (!line.didactic) return `${hoursText(used)} × ${rate}`;
  const prep = (rules.prepHoursBefore + rules.prepHoursAfter) * line.days.length;
  const minimum = line.days.some((d) => d.usedHours < rules.minimumHours) ? ` (mínimo de ${rules.minimumHours} h)` : "";
  const days = line.days.length > 1 ? `${plural(line.days.length, "dia", "dias")}: ` : "";
  return `${days}${hoursText(used)} de uso${minimum} + ${hoursText(prep)} de preparação = ${hoursText(line.quantity)} × ${rate}`;
}

/** O orçamento linha a linha, com desconto, isenção e total. */
export function QuoteBreakdown({ estimate }: { estimate: QuoteEstimate }) {
  const { quote, table, rules } = estimate;
  return (
    <div className="space-y-4">
      <ul className="divide-y divide-border rounded-xl border border-border">
        {quote.lines.map((line, i) => (
          <li key={i} className="flex flex-col gap-1 p-3 sm:flex-row sm:items-start sm:justify-between sm:gap-4">
            <div className="min-w-0">
              <p className="font-medium">
                {line.count > 1 && <span className="tabular-nums">{line.count} × </span>}
                {line.label}
              </p>
              {line.label !== line.categoryName && <p className="text-xs text-muted">{line.categoryName}</p>}
              <p className="text-sm text-muted">{lineDetail(line, rules)}</p>
              {line.coffeeInRoom && line.surchargeCents !== null && (
                <p className="flex items-center gap-1 text-sm text-muted">
                  <CoffeeIcon size={14} aria-hidden /> Coffee break na sala: +{rules.coffeeSurchargePercent}% ({formatMoney(line.surchargeCents)})
                </p>
              )}
            </div>
            <p className="shrink-0 font-semibold tabular-nums sm:text-right">
              {line.subtotalCents === null ? <span className="text-warning-foreground">A definir</span> : formatMoney(line.subtotalCents)}
            </p>
          </li>
        ))}
      </ul>

      <dl className="space-y-1.5 text-sm">
        <div className="flex justify-between gap-4">
          <dt className="text-muted">Subtotal</dt>
          <dd className="tabular-nums">{formatMoney(quote.subtotalCents)}</dd>
        </div>
        {quote.discountCents > 0 && (
          <div className="flex justify-between gap-4">
            <dt className="text-muted">Desconto institucional ({quote.discountPercent}%)</dt>
            <dd className="tabular-nums">− {formatMoney(quote.discountCents)}</dd>
          </div>
        )}
        {quote.exempt && (
          <div className="flex justify-between gap-4">
            <dt className="text-muted">Isenção: {quote.exemptionReason}</dt>
            <dd className="tabular-nums">− {formatMoney(quote.subtotalCents)}</dd>
          </div>
        )}
        <div className="flex justify-between gap-4 border-t border-border pt-2 text-base font-semibold">
          <dt>Total{quote.hasUndefined ? " (parcial)" : ""}</dt>
          <dd className="tabular-nums">{formatMoney(quote.totalCents)}</dd>
        </div>
      </dl>

      {quote.hasUndefined && <Alert tone="warning">Há espaços com valor a definir: o total ainda não inclui esses espaços.</Alert>}
      <p className="text-xs text-muted">
        {table.name}, vigente desde {formatDateKey(table.validFrom)}. Valores de locação dos espaços; a equipe técnica de áudio e vídeo é à parte.
      </p>
    </div>
  );
}
