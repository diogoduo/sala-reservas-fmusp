import { CurrencyCircleDollarIcon, SealCheckIcon, WarningIcon } from "@phosphor-icons/react";
import { cn } from "../../lib/cn";
import {
  classifyFee,
  coffeeBreakAllowed,
  estimateFee,
  formatBRL,
  isCoffeeBreakClassroom,
  SPACE_RATES,
  spaceCategoryOf,
  type SpaceCategory,
} from "../../lib/fees";
import { formatMinutes } from "../../lib/reservations";
import type { ActivityType, RoomType } from "../../lib/types";

interface Props {
  type: ActivityType;
  details: Record<string, unknown>;
  /** Minutos do período reservado (montagem + atividade) em cada data. */
  reservedMinutes: number;
  dates: number;
  /** Primeira data (para o prazo de pagamento de 30 dias). */
  firstDate: Date | null;
  coffeeBreak: boolean;
  /** Sala já escolhida (SAD); sem ela, mostra os três tipos de espaço. */
  room?: { name: string; roomType: RoomType } | null;
  compact?: boolean;
}

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Enquadramento da atividade nas isenções/taxas e estimativa do valor
 * (Portaria 2794 e Portaria 2793, Caps. VIII–IX). É só uma estimativa: o valor
 * é definido pela Divisão Acadêmica.
 */
export function FeeEstimate({ type, details, reservedMinutes, dates, firstDate, coffeeBreak, room, compact }: Props) {
  const fee = classifyFee(type, details);
  const supportAreas = Array.isArray(details.supportAreas)
    ? (details.supportAreas as string[])
    : typeof details.supportAreas === "string" && details.supportAreas
      ? details.supportAreas.split(",")
      : [];
  const minutes = Math.max(reservedMinutes, 0);
  const categories: SpaceCategory[] = room ? [spaceCategoryOf(room.roomType)] : ["ROOM", "AMPHITHEATER", "THEATER"];
  const inscription = details.free === false && Number(details.fee) > 0 ? Number(details.fee) : 0;
  const payBy = firstDate ? new Date(firstDate.getTime() - 30 * DAY_MS) : null;
  const lateForPayment = fee.kind !== "EXEMPT" && payBy !== null && payBy.getTime() < Date.now();

  if (fee.kind === "EXEMPT") {
    return (
      <div className="flex gap-3 rounded-xl bg-success-soft p-4 text-sm text-success-foreground">
        <SealCheckIcon size={20} weight="fill" className="mt-0.5 shrink-0" aria-hidden />
        <div>
          <p className="font-semibold">Sem taxa de utilização do espaço</p>
          <p className="mt-0.5">{fee.reason}</p>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-3 text-sm">
      <div
        className={cn(
          "flex gap-3 rounded-xl p-4",
          fee.kind === "MAY_BE_EXEMPT" ? "bg-info-soft text-info-foreground" : "bg-warning-soft text-warning-foreground",
        )}
      >
        <CurrencyCircleDollarIcon size={20} weight="fill" className="mt-0.5 shrink-0" aria-hidden />
        <div>
          <p className="font-semibold">{fee.kind === "MAY_BE_EXEMPT" ? "Pode ser isenta, após análise" : "Atividade sujeita a taxa de utilização"}</p>
          <p className="mt-0.5">{fee.reason}</p>
        </div>
      </div>

      {minutes > 0 && (
        <div className="overflow-hidden rounded-xl border border-border">
          <table className="w-full text-left">
            <caption className="bg-surface-muted px-3 py-2 text-left text-xs text-muted">
              Estimativa{dates > 1 ? ` para ${dates} datas` : ""}: {formatMinutes(Math.round(Math.max(120, minutes)))} + 2 h de preparação (1 h antes e 1 h depois)
              {fee.discount ? " · com desconto de 25%" : ""}
            </caption>
            <tbody className="divide-y divide-border">
              {categories.map((category) => {
                const surcharge = coffeeBreak && room ? isCoffeeBreakClassroom(room) : false;
                const estimate = estimateFee({ category, reservedMinutes: minutes, dates, coffeeBreakSurcharge: surcharge, supportAreas, discount: fee.discount });
                return (
                  <tr key={category}>
                    <th scope="row" className="px-3 py-2 font-normal">
                      {room ? room.name : SPACE_RATES[category].label}
                      <span className="block text-xs text-muted">
                        {formatBRL(estimate.hourly)}/h{surcharge ? " (com 20% de coffee break)" : ""}
                        {estimate.areas > 0 ? ` + áreas de apoio ${formatBRL(estimate.areas)}` : ""}
                      </span>
                    </th>
                    <td className="px-3 py-2 text-right font-semibold tabular-nums">{formatBRL(estimate.total)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {room && coffeeBreak && !coffeeBreakAllowed(room) && (
        <p className="flex gap-2 text-danger-foreground">
          <WarningIcon size={18} weight="fill" className="mt-0.5 shrink-0" aria-hidden />
          Coffee break não é permitido nesta sala (Portaria 2794, Art. 5º).
        </p>
      )}

      {!compact && (
        <ul className="list-disc space-y-1 pl-5 text-xs text-muted">
          <li>Valor definido pela Divisão Acadêmica; os valores de referência são reajustados todo ano pelo IPC-FIPE.</li>
          <li>
            A taxa é recolhida à FFM com no mínimo 30 dias de antecedência
            {payBy ? ` (até ${payBy.toLocaleDateString("pt-BR")})` : ""}, e a reserva só é confirmada com o comprovante entregue ao SAD/NE
            (Portaria 2793, Art. 14 §2º e §3º).
          </li>
          <li>A equipe técnica de áudio e vídeo é cobrada à parte, mesmo com isenção do espaço (Art. 13, parágrafo único).</li>
          {fee.discount && <li>O desconto de 25% não vale para Centros de Estudo; o pagamento é por transferência entre CGs (Art. 15).</li>}
          {(inscription > 150 || details.sponsored === true) && (
            <li>Inscrição acima de R$ 150 ou com patrocínio: preveja no planejamento o custo do espaço e da equipe técnica (Art. 16).</li>
          )}
          <li>Pedidos de redução ou isenção: documento assinado pelos responsáveis, entregue ao SAD/NE (Art. 14 §5º).</li>
        </ul>
      )}

      {lateForPayment && (
        <p className="flex gap-2 text-warning-foreground">
          <WarningIcon size={18} weight="fill" className="mt-0.5 shrink-0" aria-hidden />
          Faltam menos de 30 dias: se houver taxa, o prazo de pagamento já passou — fale com o SAD/NE.
        </p>
      )}
    </div>
  );
}
