import { describe, expect, it } from "vitest";
import { rankRoomOptions, type RoomWithResources } from "../../src/reservations/allocation";
import type { BusyInterval } from "../../src/reservations/conflicts";
import { atTime } from "../dates";

const PROJECTOR = "projetor";
const MICROPHONE = "microfone";

function room(id: string, capacity: number, resources: Record<string, number> = {}): RoomWithResources {
  return {
    id,
    name: id,
    capacity,
    roomType: "CLASSROOM",
    resources: Object.entries(resources).map(([resourceId, quantity]) => ({ roomId: id, resourceId, quantity })),
  } as unknown as RoomWithResources;
}

const occurrences = [
  { start: atTime("2026-11-19", "10:00"), end: atTime("2026-11-19", "12:00") },
  { start: atTime("2026-11-26", "10:00"), end: atTime("2026-11-26", "12:00") },
];
const busyOn = (roomId: string, day: string, from: string, to: string): BusyInterval => ({ roomId, start: atTime(day, from), end: atTime(day, to) });

function rank(
  rooms: RoomWithResources[],
  { busy = [], requested = [{ resourceId: PROJECTOR }], attendees = 30, coffeeBreak = false }: {
    busy?: BusyInterval[];
    requested?: { resourceId: string; quantity?: number }[];
    attendees?: number;
    coffeeBreak?: boolean;
  } = {},
) {
  return rankRoomOptions({ expectedAttendees: attendees, requestedResources: requested, coffeeBreak }, occurrences, rooms, busy);
}

describe("ranking de salas (rankRoomOptions)", () => {
  it("1º comporta os participantes", () => {
    const options = rank([room("pequena", 20, { [PROJECTOR]: 1 }), room("grande", 40, { [PROJECTOR]: 1 })]);
    expect(options.map((o) => o.room.id)).toEqual(["grande", "pequena"]);
    expect(options[1]!.fitsCapacity).toBe(false);
  });

  it("2º está livre em todas as datas", () => {
    const options = rank([room("ocupada", 40, { [PROJECTOR]: 1 }), room("livre", 60)], {
      busy: [busyOn("ocupada", "2026-11-26", "11:00", "13:00")],
    });
    // A livre ganha mesmo sem o projetor.
    expect(options.map((o) => o.room.id)).toEqual(["livre", "ocupada"]);
    expect(options[1]!.conflictingDates).toEqual([occurrences[1]!.start]);
  });

  it("3º tem os recursos, na quantidade pedida", () => {
    const options = rank([room("um-projetor", 40, { [PROJECTOR]: 1, [MICROPHONE]: 1 }), room("completa", 80, { [PROJECTOR]: 2, [MICROPHONE]: 1 })], {
      requested: [{ resourceId: PROJECTOR, quantity: 2 }, { resourceId: MICROPHONE }],
    });
    expect(options.map((o) => o.room.id)).toEqual(["completa", "um-projetor"]);
    expect(options[1]!.missingResources).toEqual([{ resourceId: PROJECTOR, requested: 2, available: 1 }]);
  });

  it("recurso que nenhuma sala tem (item avulso da TI) não pesa", () => {
    const options = rank([room("a", 40, { [PROJECTOR]: 1 })], { requested: [{ resourceId: PROJECTOR }, { resourceId: "chromebook" }] });
    expect(options[0]!.missingResources).toEqual([]);
  });

  it("4º menos datas em conflito; 5º a menor sala que comporta", () => {
    const options = rank([room("auditorio", 300), room("sala-40", 40), room("sala-35", 35), room("duas-datas", 30), room("uma-data", 30)], {
      requested: [],
      busy: [
        busyOn("duas-datas", "2026-11-19", "09:00", "10:30"),
        busyOn("duas-datas", "2026-11-26", "11:30", "12:30"),
        busyOn("uma-data", "2026-11-19", "11:00", "11:30"),
      ],
    });
    expect(options.map((o) => o.room.id)).toEqual(["sala-35", "sala-40", "auditorio", "uma-data", "duas-datas"]);
  });

  it("encostar no horário de outra reserva não é conflito", () => {
    const options = rank([room("a", 40)], {
      requested: [],
      busy: [busyOn("a", "2026-11-19", "08:00", "10:00"), busyOn("a", "2026-11-26", "12:00", "13:00")],
    });
    expect(options[0]!.conflictingDates).toEqual([]);
  });

  it("coffee break vai para as salas que permitem (Portaria 2794, Art. 5º)", () => {
    const options = rank([room("Sala 101", 40), room("Sala 2366", 50)], { requested: [], coffeeBreak: true });
    expect(options.map((o) => [o.room.id, o.coffeeBreakAllowed])).toEqual([
      ["Sala 2366", true],
      ["Sala 101", false],
    ]);
  });
});
