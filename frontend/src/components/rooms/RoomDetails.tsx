import { ArmchairIcon, CoffeeIcon, CurrencyCircleDollarIcon, RulerIcon, UsersFourIcon, UsersIcon, type Icon } from "@phosphor-icons/react";
import type { ReactNode } from "react";
import { plural } from "../../lib/format";
import { roomPriceText } from "../../lib/prices";
import { coffeeLimit } from "../../lib/rooms";
import { ROOM_TYPE_LABELS } from "../../lib/types";
import type { Room } from "../../lib/types";
import { AvailabilityCalendar } from "../solicitante/AvailabilityCalendar";
import { RoomResourceChips } from "../solicitante/RoomSearch";
import { Dialog } from "../ui/Dialog";
import { Alert } from "../ui/Feedback";
import { RoomFeatures } from "./RoomFeatures";
import { PhotoMosaic } from "./RoomPhotos";

function Fact({ icon: FactIcon, label, children }: { icon: Icon; label: string; children: ReactNode }) {
  return (
    <div className="min-w-0 rounded-xl bg-surface-muted px-3 py-2.5">
      <dt className="flex items-center gap-1.5 text-xs text-muted">
        <FactIcon size={14} aria-hidden /> {label}
      </dt>
      <dd className="mt-0.5 text-sm font-semibold break-words">{children}</dd>
    </div>
  );
}

/** Painel da sala: fotos, capacidade, dimensões, coffee break, regras, recursos e a agenda. */
export function RoomDetailsDrawer({ room, onClose, initialDate }: { room: Room; onClose: () => void; initialDate?: Date }) {
  const coffee = coffeeLimit(room);
  return (
    <Dialog
      open
      variant="drawer"
      onClose={onClose}
      title={room.name}
      description={`${ROOM_TYPE_LABELS[room.roomType]} · ${room.building}, ${room.floor}`}
    >
      <div className="space-y-6">
        <PhotoMosaic room={room} />

        <dl className="grid grid-cols-2 gap-2 sm:grid-cols-3">
          <Fact icon={UsersIcon} label="Capacidade">
            {room.capacity !== null
              ? plural(room.capacity, room.roomType === "SUPPORT_AREA" ? "pessoa" : "lugar", room.roomType === "SUPPORT_AREA" ? "pessoas" : "lugares")
              : room.roomType === "SUPPORT_AREA"
                ? "Sem limite cadastrado"
                : "A definir"}
          </Fact>
          {room.recommendedAbove ? (
            <Fact icon={UsersFourIcon} label="Indicado para">
              Mais de {room.recommendedAbove} pessoas
            </Fact>
          ) : null}
          <Fact icon={CurrencyCircleDollarIcon} label="Locação para eventos">
            {roomPriceText(room.price)}
          </Fact>
          {coffee !== null && (
            <Fact icon={CoffeeIcon} label="Coffee break">
              {coffee === "sem limite" ? "Pode ter" : `Até ${coffee} pessoas`}
            </Fact>
          )}
          {room.extraSeats ? (
            <Fact icon={ArmchairIcon} label="Cadeiras extras">
              {room.extraSeats}
            </Fact>
          ) : null}
          {room.dimensions && (
            <Fact icon={RulerIcon} label="Dimensões">
              {room.dimensions}
            </Fact>
          )}
        </dl>

        <RoomFeatures room={room} />

        {room.requiresBoardApproval && (
          <Alert tone="warning" title="Exige autorização da Diretoria Executiva">
            O uso deste espaço depende de autorização da Diretoria Executiva, pedida pelo SAD na análise.
          </Alert>
        )}

        {room.usageRules && (
          <section>
            <h3 className="text-sm font-semibold">Regras de uso</h3>
            <p className="mt-1 text-sm whitespace-pre-line text-muted">{room.usageRules}</p>
          </section>
        )}

        {room.resources.some((r) => r.resource.requestable) && (
          <section>
            <h3 className="text-sm font-semibold">Recursos da sala</h3>
            <div className="mt-2">
              <RoomResourceChips room={room} max={Infinity} />
            </div>
          </section>
        )}

        <section>
          <h3 className="text-sm font-semibold">Agenda</h3>
          <p className="text-xs text-muted">Dias com horário ocupado ficam marcados. Toque num dia para ver os horários.</p>
          <div className="mt-3">
            <AvailabilityCalendar roomId={room.id} initialDate={initialDate} />
          </div>
        </section>
      </div>
    </Dialog>
  );
}
