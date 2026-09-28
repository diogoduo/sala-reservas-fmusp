import { CaretLeftIcon, CaretRightIcon, ImagesIcon, UsersIcon } from "@phosphor-icons/react";
import { useEffect, useRef, useState } from "react";
import { api } from "../../lib/api";
import { plural } from "../../lib/format";
import type { Room } from "../../lib/types";
import { IconButton } from "../ui/Button";
import { Alert } from "../ui/Feedback";
import { Card, IconTile } from "../ui/Surface";
import { RoomDetailsDrawer } from "./RoomDetails";
import { RoomCover } from "./RoomPhotos";

interface Props {
  /** Nº de pessoas informado no formulário (0 = ainda não informado). */
  attendees: number;
  /** Dia escolhido no formulário: a agenda da sala abre nele. */
  date?: Date;
}

/**
 * "Conheça as salas" no formulário de reserva: as salas que comportam a
 * atividade, com fotos. Só para o solicitante ter uma ideia dos espaços —
 * quem escolhe a sala continua sendo o SAD.
 */
export function RoomsPreview({ attendees, date }: Props) {
  const [rooms, setRooms] = useState<Room[] | null>(null);
  const [openRoom, setOpenRoom] = useState<Room | null>(null);
  const scroller = useRef<HTMLUListElement>(null);

  useEffect(() => {
    api<{ rooms: Room[] }>("/rooms?status=ACTIVE")
      .then((res) => setRooms(res.rooms))
      .catch(() => setRooms([]));
  }, []);

  if (!rooms || rooms.length === 0) return null;

  // Da menor para a maior: as primeiras são as que o SAD tende a alocar.
  // (Salas Ativas sempre têm capacidade; o "?? 0" só satisfaz o tipo.)
  const fitting = rooms
    .filter((room) => !attendees || (room.capacity ?? 0) >= attendees)
    .sort((a, b) => (a.capacity ?? 0) - (b.capacity ?? 0));

  function scrollBy(direction: 1 | -1) {
    const el = scroller.current;
    if (el) el.scrollBy({ left: direction * el.clientWidth * 0.8, behavior: "smooth" });
  }

  return (
    <Card className="p-5 sm:p-6">
      <div className="flex items-start gap-3">
        <IconTile icon={ImagesIcon} size="sm" tone="info" />
        <div className="min-w-0 flex-1 pt-0.5">
          <h2 className="text-lg leading-tight font-semibold">Conheça as salas</h2>
          <p className="mt-1 text-sm text-muted">
            {attendees
              ? `${plural(fitting.length, "sala comporta", "salas comportam")} ${plural(attendees, "pessoa", "pessoas")}.`
              : "Informe o número de pessoas para ver só as salas que comportam a atividade."}{" "}
            Quem define a sala é o SAD; se precisar de um espaço específico, diga na descrição.
          </p>
        </div>
        {fitting.length > 2 && (
          <div className="hidden shrink-0 gap-1 sm:flex">
            <IconButton icon={CaretLeftIcon} label="Salas anteriores" size="sm" variant="secondary" onClick={() => scrollBy(-1)} />
            <IconButton icon={CaretRightIcon} label="Próximas salas" size="sm" variant="secondary" onClick={() => scrollBy(1)} />
          </div>
        )}
      </div>

      {fitting.length === 0 ? (
        <Alert tone="warning" className="mt-4">
          Nenhuma sala comporta {plural(attendees, "pessoa", "pessoas")}. Envie mesmo assim: o SAD vai procurar uma alternativa.
        </Alert>
      ) : (
        <ul
          ref={scroller}
          aria-label="Salas que comportam a atividade"
          className="-mx-5 mt-4 flex snap-x snap-mandatory scroll-px-5 gap-3 overflow-x-auto px-5 pb-2 scrollbar-none sm:-mx-6 sm:scroll-px-6 sm:px-6"
        >
          {fitting.map((room) => (
            <li key={room.id} className="w-56 shrink-0 snap-start overflow-hidden rounded-xl border border-border bg-surface">
              <RoomCover room={room} />
              <div className="p-3">
                <p className="truncate text-sm font-semibold" title={room.name}>
                  {room.name}
                </p>
                <p className="mt-0.5 flex items-center gap-1 text-xs text-muted">
                  <UsersIcon size={14} aria-hidden /> até {room.capacity} · <span className="truncate">{room.building}</span>
                </p>
                <button
                  type="button"
                  onClick={() => setOpenRoom(room)}
                  className="mt-2 text-xs font-medium text-primary hover:underline focus-visible:rounded-sm focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
                >
                  Detalhes e agenda<span className="sr-only"> de {room.name}</span>
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}

      {openRoom && <RoomDetailsDrawer room={openRoom} initialDate={date} onClose={() => setOpenRoom(null)} />}
    </Card>
  );
}
