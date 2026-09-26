import { CheckIcon } from "@phosphor-icons/react";
import { useId, useState } from "react";
import { cn } from "../../lib/cn";
import { resourceIcon } from "../../lib/icons";
import { ROOM_STATUS_LABELS, ROOM_TYPE_LABELS } from "../../lib/types";
import type { Resource, Room, RoomStatus, RoomType } from "../../lib/types";
import { Input, Select } from "../ui/Field";
import { QuantityStepper } from "../ui/QuantityStepper";

export interface RoomFormValues {
  name: string;
  building: string;
  floor: string;
  capacity: number;
  roomType: RoomType;
  status: RoomStatus;
  resources: { resourceId: string; quantity: number }[];
}

const ROOM_TYPES = Object.keys(ROOM_TYPE_LABELS) as RoomType[];
const ROOM_STATUSES = Object.keys(ROOM_STATUS_LABELS) as RoomStatus[];

function fromRoom(room: Room | null): RoomFormValues {
  if (!room) return { name: "", building: "", floor: "", capacity: 1, roomType: "CLASSROOM", status: "ACTIVE", resources: [] };
  return {
    name: room.name,
    building: room.building,
    floor: room.floor,
    capacity: room.capacity,
    roomType: room.roomType,
    status: room.status,
    resources: room.resources.map((r) => ({ resourceId: r.resourceId, quantity: r.quantity })),
  };
}

interface Props {
  /** null = criando uma sala nova */
  room: Room | null;
  resources: Resource[];
  /** Prédios já cadastrados, sugeridos ao digitar. */
  buildings: string[];
  formId: string;
  onSubmit: (values: RoomFormValues) => void;
}

/** Formulário de sala (fica dentro do painel lateral; os botões ficam no rodapé do painel). */
export function RoomForm({ room, resources, buildings, formId, onSubmit }: Props) {
  const [values, setValues] = useState<RoomFormValues>(() => fromRoom(room));
  const datalistId = useId();

  function toggleResource(resourceId: string) {
    setValues((v) => ({
      ...v,
      resources: v.resources.some((r) => r.resourceId === resourceId)
        ? v.resources.filter((r) => r.resourceId !== resourceId)
        : [...v.resources, { resourceId, quantity: 1 }],
    }));
  }

  function setQuantity(resourceId: string, quantity: number) {
    setValues((v) => ({ ...v, resources: v.resources.map((r) => (r.resourceId === resourceId ? { ...r, quantity } : r)) }));
  }

  return (
    <form
      id={formId}
      onSubmit={(e) => {
        e.preventDefault();
        onSubmit(values);
      }}
      className="space-y-8"
    >
      <section className="grid gap-4 sm:grid-cols-2">
        <Input
          label="Nome/Número da sala"
          required
          value={values.name}
          onChange={(e) => setValues({ ...values, name: e.target.value })}
          containerClassName="sm:col-span-2"
        />
        <Input
          label="Prédio/Bloco"
          required
          list={datalistId}
          value={values.building}
          onChange={(e) => setValues({ ...values, building: e.target.value })}
        />
        <datalist id={datalistId}>
          {buildings.map((b) => (
            <option key={b} value={b} />
          ))}
        </datalist>
        <Input label="Andar/Pavimento" required placeholder="Ex.: Térreo, 2º andar" value={values.floor} onChange={(e) => setValues({ ...values, floor: e.target.value })} />
        <Select label="Tipo de espaço" value={values.roomType} onChange={(e) => setValues({ ...values, roomType: e.target.value as RoomType })}>
          {ROOM_TYPES.map((t) => (
            <option key={t} value={t}>
              {ROOM_TYPE_LABELS[t]}
            </option>
          ))}
        </Select>
        <Input
          label="Capacidade"
          required
          type="number"
          inputMode="numeric"
          min={1}
          value={values.capacity}
          onChange={(e) => setValues({ ...values, capacity: Number(e.target.value) })}
        />
        <fieldset className="sm:col-span-2">
          <legend className="text-sm font-medium">Status</legend>
          <div className="mt-2 flex flex-wrap gap-2">
            {ROOM_STATUSES.map((status) => (
              <label
                key={status}
                className="inline-flex h-10 items-center rounded-full border border-border-strong px-4 text-sm font-medium text-muted transition-colors hover:text-foreground has-[:checked]:border-primary has-[:checked]:bg-primary-soft has-[:checked]:text-primary-soft-foreground has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-ring"
              >
                <input
                  type="radio"
                  name="status"
                  className="sr-only"
                  checked={values.status === status}
                  onChange={() => setValues({ ...values, status })}
                />
                {ROOM_STATUS_LABELS[status]}
              </label>
            ))}
          </div>
          {values.status !== "ACTIVE" && (
            <p className="mt-2 text-xs text-muted">Salas fora do status Ativa não aparecem na consulta nem na alocação.</p>
          )}
        </fieldset>
      </section>

      <section>
        <h3 className="text-base font-semibold">Recursos da sala</h3>
        <p className="text-sm text-muted">O que fica disponível no espaço. A quantidade conta na escolha da sala mais adequada.</p>
        {resources.length === 0 ? (
          <p className="mt-3 text-sm text-muted">Nenhum recurso cadastrado ainda — cadastre na tela "Recursos" primeiro.</p>
        ) : (
          <ul className="mt-4 divide-y divide-border rounded-xl border border-border">
            {resources.map((r) => {
              const linked = values.resources.find((x) => x.resourceId === r.id);
              const ResourceIcon = resourceIcon(r.name);
              return (
                <li key={r.id} className="flex items-center gap-3 px-3 py-2.5">
                  <label className="flex min-w-0 flex-1 items-center gap-3 has-[:focus-visible]:rounded-md has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-ring">
                    <input type="checkbox" className="sr-only" checked={!!linked} onChange={() => toggleResource(r.id)} />
                    <span
                      aria-hidden
                      className={cn(
                        "grid size-5 shrink-0 place-items-center rounded-md border transition-colors",
                        linked ? "border-primary bg-primary text-primary-foreground" : "border-border-strong",
                      )}
                    >
                      {linked && <CheckIcon size={14} weight="bold" />}
                    </span>
                    <ResourceIcon size={20} className={linked ? "text-primary" : "text-muted"} aria-hidden />
                    <span className="truncate text-sm font-medium">{r.name}</span>
                  </label>
                  {linked && (
                    <QuantityStepper
                      label={`Quantidade de ${r.name}`}
                      value={String(linked.quantity)}
                      onChange={(quantity) => setQuantity(r.id, Number(quantity))}
                    />
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </section>
    </form>
  );
}
