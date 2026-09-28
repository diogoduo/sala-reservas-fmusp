import { ChairIcon, DoorIcon, HandHeartIcon, type Icon } from "@phosphor-icons/react";
import { cn } from "../../lib/cn";
import { SEAT_TYPE_LABELS } from "../../lib/types";
import type { Room } from "../../lib/types";

type Features = Pick<Room, "seatTypes" | "wideDoor" | "specialNeeds">;

/** "Escolar" ou "Escolar e Universitária fixa". */
export function seatTypesLabel(room: Pick<Room, "seatTypes">) {
  const labels = room.seatTypes.map((type) => SEAT_TYPE_LABELS[type]);
  return labels.length <= 1 ? (labels[0] ?? null) : `${labels.slice(0, -1).join(", ")} e ${labels.at(-1)}`;
}

/** Características da sala vindas da planilha do SAD: tipo de cadeira, porta de 900 mm, atendimento especial. */
export function RoomFeatures({ room, compact = false, className }: { room: Features; compact?: boolean; className?: string }) {
  const seats = seatTypesLabel(room);
  const items: { icon: Icon; label: string; highlight?: boolean }[] = [
    ...(seats ? [{ icon: ChairIcon, label: `Cadeira ${seats.toLowerCase()}` }] : []),
    // Todas as salas da planilha atual têm porta de 900 mm; no card, só o que diferencia.
    ...(room.wideDoor && !compact ? [{ icon: DoorIcon, label: "Porta de 900 mm" }] : []),
    ...(room.specialNeeds ? [{ icon: HandHeartIcon, label: "Atendimento especial", highlight: true }] : []),
  ];
  if (items.length === 0) return null;
  return (
    <ul className={cn("flex flex-wrap gap-1.5", className)}>
      {items.map(({ icon: ItemIcon, label, highlight }) => (
        <li
          key={label}
          className={cn(
            "inline-flex items-center gap-1 rounded-md px-2 py-1 text-xs",
            highlight ? "bg-info-soft font-medium text-info-foreground" : "bg-surface-muted text-muted",
          )}
        >
          <ItemIcon size={14} aria-hidden />
          {label}
        </li>
      ))}
    </ul>
  );
}
