import { RESERVATION_STATUS_LABELS } from "../lib/types";
import type { ReservationStatus } from "../lib/types";

const STYLES: Record<ReservationStatus, string> = {
  PENDING: "bg-amber-100 text-amber-800",
  APPROVED: "bg-emerald-100 text-emerald-800",
  REJECTED: "bg-red-100 text-red-700",
  CANCELLED: "bg-slate-100 text-slate-500",
};

export function StatusBadge({ status }: { status: ReservationStatus }) {
  return (
    <span className={`shrink-0 rounded-full px-2 py-0.5 text-xs ${STYLES[status]}`}>{RESERVATION_STATUS_LABELS[status]}</span>
  );
}
