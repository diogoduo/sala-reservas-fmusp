import { CheckIcon, LockSimpleIcon } from "@phosphor-icons/react";
import { useId, useState } from "react";
import { cn } from "../../lib/cn";
import { resourceIcon } from "../../lib/icons";
import { ROOM_STATUS_LABELS, ROOM_TYPE_LABELS } from "../../lib/types";
import type { Resource, Room, RoomStatus, RoomType } from "../../lib/types";
import { Input, Select, Textarea } from "../ui/Field";
import { QuantityStepper } from "../ui/QuantityStepper";

export interface RoomFormValues {
  name: string;
  building: string;
  floor: string;
  capacity: number;
  extraSeats: number | null;
  dimensions: string;
  equipmentNotes: string;
  roomType: RoomType;
  status: RoomStatus;
  resources: { resourceId: string; quantity: number; model: string; assetTags: string }[];
}

const ROOM_TYPES = Object.keys(ROOM_TYPE_LABELS) as RoomType[];
const ROOM_STATUSES = Object.keys(ROOM_STATUS_LABELS) as RoomStatus[];

function fromRoom(room: Room | null): RoomFormValues {
  if (!room) {
    return {
      name: "",
      building: "",
      floor: "",
      capacity: 1,
      extraSeats: null,
      dimensions: "",
      equipmentNotes: "",
      roomType: "CLASSROOM",
      status: "ACTIVE",
      resources: [],
    };
  }
  return {
    name: room.name,
    building: room.building,
    floor: room.floor,
    capacity: room.capacity,
    extraSeats: room.extraSeats,
    dimensions: room.dimensions ?? "",
    equipmentNotes: room.equipmentNotes ?? "",
    roomType: room.roomType,
    status: room.status,
    resources: room.resources.map((r) => ({
      resourceId: r.resourceId,
      quantity: r.quantity,
      model: r.model ?? "",
      assetTags: r.assetTags ?? "",
    })),
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
        : [...v.resources, { resourceId, quantity: 1, model: "", assetTags: "" }],
    }));
  }

  function updateLink(resourceId: string, patch: Partial<RoomFormValues["resources"][number]>) {
    setValues((v) => ({ ...v, resources: v.resources.map((r) => (r.resourceId === resourceId ? { ...r, ...patch } : r)) }));
  }

  // Primeiro o que o solicitante vê; depois a infraestrutura (nobreak, splitter…), que é só inventário.
  const groups = [
    { title: "Recursos da sala", hint: "Aparecem para o solicitante. A quantidade conta na escolha da sala mais adequada.", items: resources.filter((r) => r.requestable) },
    { title: "Só inventário", hint: "Infraestrutura que o solicitante não vê.", items: resources.filter((r) => !r.requestable) },
  ].filter((group) => group.items.length > 0);

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
          hint="Cadeiras da plateia."
          value={values.capacity}
          onChange={(e) => setValues({ ...values, capacity: Number(e.target.value) })}
        />
        <Input
          label="Cadeiras extras"
          type="number"
          inputMode="numeric"
          min={0}
          placeholder="Opcional"
          hint="Professor, rodinha, bancos."
          value={values.extraSeats ?? ""}
          onChange={(e) => setValues({ ...values, extraSeats: e.target.value === "" ? null : Number(e.target.value) })}
        />
        <Input
          label="Dimensões"
          placeholder="Ex.: 10,30 × 9,60 m"
          hint="Largura × comprimento."
          value={values.dimensions}
          onChange={(e) => setValues({ ...values, dimensions: e.target.value })}
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

      {resources.length === 0 ? (
        <section>
          <h3 className="text-base font-semibold">Recursos da sala</h3>
          <p className="mt-1 text-sm text-muted">Nenhum recurso cadastrado ainda — cadastre na tela "Recursos" primeiro.</p>
        </section>
      ) : (
        groups.map((group) => (
          <section key={group.title}>
            <h3 className="text-base font-semibold">{group.title}</h3>
            <p className="text-sm text-muted">{group.hint} Modelo e patrimônio só o SAD vê.</p>
            <ul className="mt-4 divide-y divide-border rounded-xl border border-border">
              {group.items.map((r) => {
                const linked = values.resources.find((x) => x.resourceId === r.id);
                const ResourceIcon = resourceIcon(r.name);
                return (
                  <li key={r.id} className="px-3 py-2.5">
                    <div className="flex items-center gap-3">
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
                          onChange={(quantity) => updateLink(r.id, { quantity: Number(quantity) })}
                        />
                      )}
                    </div>
                    {linked && (
                      <div className="mt-2.5 mb-1 grid gap-2 pl-8 sm:grid-cols-2">
                        <Input
                          aria-label={`Modelo de ${r.name}`}
                          placeholder="Modelo"
                          value={linked.model}
                          onChange={(e) => updateLink(r.id, { model: e.target.value })}
                          className="h-9"
                        />
                        <Input
                          aria-label={`Patrimônio de ${r.name}`}
                          placeholder="Patrimônio (FM / USP)"
                          value={linked.assetTags}
                          onChange={(e) => updateLink(r.id, { assetTags: e.target.value })}
                          className="h-9"
                        />
                      </div>
                    )}
                  </li>
                );
              })}
            </ul>
          </section>
        ))
      )}

      <section>
        <Textarea
          label={
            <span className="inline-flex items-center gap-1.5">
              Outros equipamentos <LockSimpleIcon size={14} className="text-muted" aria-label="só o SAD vê" />
            </span>
          }
          placeholder="Ex.: impressora, microscópio, caixinhas de som…"
          hint="Texto livre, só o SAD vê. Para o que não é um tipo de recurso."
          value={values.equipmentNotes}
          onChange={(e) => setValues({ ...values, equipmentNotes: e.target.value })}
        />
      </section>
    </form>
  );
}
