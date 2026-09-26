import { CheckCircleIcon, HourglassMediumIcon, ProhibitIcon, XCircleIcon, type Icon } from "@phosphor-icons/react";
import { RESERVATION_STATUS_LABELS } from "../lib/types";
import type { ReservationStatus } from "../lib/types";
import { Badge, type Tone } from "./ui/Badge";

const STYLES: Record<ReservationStatus, { tone: Tone; icon: Icon }> = {
  PENDING: { tone: "warning", icon: HourglassMediumIcon },
  APPROVED: { tone: "success", icon: CheckCircleIcon },
  REJECTED: { tone: "danger", icon: XCircleIcon },
  CANCELLED: { tone: "neutral", icon: ProhibitIcon },
};

export function StatusBadge({ status }: { status: ReservationStatus }) {
  const { tone, icon } = STYLES[status];
  return (
    <Badge tone={tone} icon={icon}>
      {RESERVATION_STATUS_LABELS[status]}
    </Badge>
  );
}
