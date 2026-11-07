/**
 * Eventos da base de demonstração (Fases 11 a 13): um em cada etapa, para o
 * painel de Eventos e o quadro já abrirem cheios na apresentação. Tudo fictício
 * (pessoas, títulos, comprovantes); as salas são as da base (reais com
 * --salas-reais). As salas pré-reservadas e confirmadas entram como reservas do
 * evento e respeitam a ocupação das outras reservas da base.
 */
import { randomBytes } from "node:crypto";
import type { EventStatus, Prisma, PrismaClient } from "@prisma/client";
import { estimateQuote } from "../../src/quotes/estimate";
import { regularScheduleIssue } from "../../src/reservations/rules";

type SpaceSpec =
  | { category: string; count: number; minCapacity?: number; purpose: string; rooms: string[] }
  | { room: string; purpose: string; coffeeInRoom?: boolean };

interface EventSpec {
  person: string;
  title: string;
  kind: string;
  entity: string;
  attendees: number;
  fee: boolean;
  sponsored: boolean;
  description: string;
  audience: string;
  stage: EventStatus;
  /** Primeiro dia útil livre a partir de N dias. */
  daysAhead: number;
  dayCount: 1 | 2;
  start: string;
  end: string;
  setup: number;
  spaces: SpaceSpec[];
  coffee?: number;
  exempt?: string;
  changesNote?: string;
  messages?: [who: "person" | "nucev", text: string][];
  authorization?: "PENDING" | "AUTHORIZED";
}

export interface DemoEventHelpers {
  /** Id e nome de uma pessoa da base pelo e-mail. */
  person: (email: string) => { id: string; name: string; email: string };
  sad: { id: string; name: string };
  nucev: { id: string; name: string };
  futureOpenDays: (offset: number) => string[];
  at: (key: string, time: string) => Date;
  /** Sala (fictícia ou, com --salas-reais, a real correspondente) pelo nome usado nas reservas da base. */
  roomId: (name: string) => Promise<string | null>;
  isFree: (room: string, start: Date, end: Date) => boolean;
  occupy: (room: string, start: Date, end: Date) => void;
}

const INSTITUTIONAL = ["DEPARTMENT", "DIRECTORATE", "ACADEMIC_DIVISION", "COMMISSION", "STAFF", "HC", "USP_UNIT", "SES", "ADOLFO_LUTZ"];
const PDF = Buffer.from("%PDF-1.4\n% Comprovante fictício da base de demonstração\n");
const PRE_RESERVED_OR_LATER: EventStatus[] = ["PRE_RESERVED", "QUOTE_SENT", "CHANGES_REQUESTED", "QUOTE_APPROVED", "PAYMENT_SUBMITTED", "PAYMENT_VALIDATED", "CONFIRMED"];
const QUOTED: EventStatus[] = ["QUOTE_SENT", "CHANGES_REQUESTED", "QUOTE_APPROVED", "PAYMENT_SUBMITTED", "PAYMENT_VALIDATED", "CONFIRMED"];
const APPROVED: EventStatus[] = ["QUOTE_APPROVED", "PAYMENT_SUBMITTED", "PAYMENT_VALIDATED", "CONFIRMED"];

const SALAS = "Salas de aula e salas de reunião";

function specs(): EventSpec[] {
  const base = { fee: false, sponsored: false, setup: 60, start: "08:00", end: "18:00" };
  return [
    {
      ...base, person: "camila.rocha.demo@usp.br", title: "Simpósio de Saúde Mental na Graduação", kind: "SEMINAR", entity: "CAOC", attendees: 180,
      description: "08:30 Credenciamento\n09:00 Conferência de abertura\n10:30 Mesas-redondas\n14:00 Oficinas", audience: "Alunos de graduação",
      stage: "SUBMITTED", daysAhead: 18, dayCount: 1, coffee: 180,
      spaces: [{ room: "Teatro Principal", purpose: "Abertura e conferências" }, { room: "Hall do Teatro (Foyer)", purpose: "Coffee break" }],
    },
    {
      ...base, person: "ricardo.alves.demo@usp.br", title: "Jornada de Cirurgia Robótica", kind: "CONGRESS", entity: "DEPARTMENT", attendees: 120, fee: true,
      description: "Dia 1: conferências e casos clínicos\nDia 2: oficinas práticas em grupos", audience: "Residentes e cirurgiões",
      stage: "IN_REVIEW", daysAhead: 20, dayCount: 2,
      spaces: [{ category: SALAS, count: 3, minCapacity: 30, purpose: "Oficinas", rooms: [] }, { room: "Hall de transição do 4º andar", purpose: "Coffee break" }],
      coffee: 60,
    },
    {
      ...base, person: "helena.martins.demo@usp.br", title: "Curso de Ultrassonografia Point-of-Care", kind: "COURSE", entity: "DEPARTMENT", attendees: 60, fee: true,
      description: "Aulas teóricas pela manhã e prática supervisionada à tarde.", audience: "Residentes de clínica médica",
      stage: "PRE_RESERVED", daysAhead: 16, dayCount: 1,
      spaces: [{ category: SALAS, count: 2, minCapacity: 30, purpose: "Aulas e prática", rooms: ["Sala 103", "Sala 104"] }],
    },
    {
      ...base, person: "marina.costa.demo@usp.br", title: "Congresso de Saúde Coletiva", kind: "CONGRESS", entity: "DEPARTMENT", attendees: 260, sponsored: true,
      description: "08:30 Credenciamento\n09:00 Conferência\n11:00 Mesas temáticas\n14:00 Apresentação de trabalhos", audience: "Pesquisadores, alunos e profissionais do SUS",
      stage: "QUOTE_SENT", daysAhead: 22, dayCount: 2, coffee: 260, authorization: "PENDING",
      spaces: [
        { room: "Teatro Principal", purpose: "Plenária" },
        { category: SALAS, count: 2, minCapacity: 40, purpose: "Apresentação de trabalhos", rooms: ["Sala 101", "Sala 102"] },
        { room: "Átrio esquerdo (SVO)", purpose: "Coffee break e pôsteres" },
      ],
      messages: [["person", "O patrocínio inclui os estandes no átrio. Precisamos de pontos de energia."], ["nucev", "Anotado. Os estandes entram no uso do átrio; o orçamento já considera os dois dias."]],
    },
    {
      ...base, person: "aluno@usp.br", title: "Fórum de Residência Médica", kind: "STUDENT_ACTIVITY", entity: "LEAGUE", attendees: 90,
      description: "Palestras sobre os programas de residência e roda de conversa com residentes.", audience: "Alunos do 5º e 6º anos",
      stage: "CHANGES_REQUESTED", daysAhead: 24, dayCount: 1,
      spaces: [{ room: "Anfiteatro B", purpose: "Palestras" }],
      changesNote: "Somos uma liga acadêmica, sem inscrição e sem patrocínio: pedimos a análise de isenção (Art. 4º II).",
    },
    {
      ...base, person: "bruno.ferreira.demo@usp.br", title: "Encontro de Ligas Acadêmicas", kind: "LEAGUE", entity: "USP_UNIT", attendees: 80, fee: true,
      description: "Apresentação das ligas e sessões de casos clínicos.", audience: "Alunos de graduação",
      stage: "QUOTE_APPROVED", daysAhead: 26, dayCount: 1, start: "13:00", end: "18:00", setup: 30,
      spaces: [{ room: "Anfiteatro C", purpose: "Sessões" }],
    },
    {
      ...base, person: "docente@fm.usp.br", title: "Workshop de Simulação Realística", kind: "COURSE", entity: "DEPARTMENT", attendees: 40, fee: true,
      description: "Cenários de simulação em pequenos grupos, com debriefing.", audience: "Residentes e enfermagem",
      stage: "PAYMENT_SUBMITTED", daysAhead: 14, dayCount: 1,
      spaces: [{ room: "Laboratório de Habilidades", purpose: "Simulação" }, { category: SALAS, count: 1, minCapacity: 20, purpose: "Debriefing", rooms: ["Sala 203"] }],
    },
    {
      ...base, person: "graduacao.demo@fm.usp.br", title: "Cerimônia do Jaleco", kind: "CEREMONY", entity: "ACADEMIC_DIVISION", attendees: 200,
      description: "18:00 Recepção das famílias\n19:00 Cerimônia\n20:30 Encerramento", audience: "Alunos do 1º ano e famílias",
      stage: "CONFIRMED", daysAhead: 12, dayCount: 1, start: "18:00", end: "21:00", setup: 120, exempt: "Evento institucional da FMUSP, sem inscrição e sem patrocínio (Portaria 2794, Art. 4º I).",
      spaces: [{ room: "Teatro Principal", purpose: "Cerimônia" }],
    },
    {
      ...base, person: "camila.rocha.demo@usp.br", title: "Feira de Estágios", kind: "STUDENT_ACTIVITY", entity: "CAOC", attendees: 300,
      description: "Estandes de instituições de estágio.", audience: "Alunos de graduação",
      stage: "REJECTED", daysAhead: 10, dayCount: 1,
      spaces: [{ room: "Átrio do relógio de ponto", purpose: "Estandes" }],
    },
  ];
}

export async function seedDemoEvents(prisma: PrismaClient, h: DemoEventHelpers): Promise<number> {
  const setting = await prisma.appSetting.findUnique({ where: { key: "event_payment_instructions" } });
  const instructions = setting?.value ?? "Dados para o pagamento: a definir pelo SAD e pelo NUCEV.";
  const categories = await prisma.priceCategory.findMany();
  const categoryId = (name: string) => categories.find((c) => c.name === name)?.id ?? null;
  const now = new Date();
  let created = 0;

  for (const spec of specs()) {
    const who = h.person(spec.person);
    const wantRooms = PRE_RESERVED_OR_LATER.includes(spec.stage);
    // Os dias: os primeiros dias úteis seguidos em que as salas pedidas estão livres.
    const candidates = h.futureOpenDays(spec.daysAhead);
    const roomsOf = (s: SpaceSpec) => ("room" in s ? [s.room] : s.rooms);
    const allRooms = spec.spaces.flatMap(roomsOf);
    let days: string[] = [];
    for (let i = 0; i + spec.dayCount <= candidates.length; i++) {
      const pick = candidates.slice(i, i + spec.dayCount);
      const free = pick.every((d) => allRooms.every((r) => h.isFree(r, h.at(d, spec.start), h.at(d, spec.end))));
      if (free || !wantRooms) {
        days = pick;
        break;
      }
    }
    if (days.length === 0) continue;

    const window = (d: string) => ({ start: new Date(h.at(d, spec.start).getTime() - spec.setup * 60_000), end: h.at(d, spec.end) });
    const spaces = await Promise.all(
      spec.spaces.map(async (s, position) =>
        "room" in s
          ? { position, roomId: await h.roomId(s.room), priceCategoryId: null, count: 1, minCapacity: null, purpose: s.purpose, coffeeInRoom: s.coffeeInRoom ?? false }
          : { position, roomId: null, priceCategoryId: categoryId(s.category), count: s.count, minCapacity: s.minCapacity ?? null, purpose: s.purpose, coffeeInRoom: false },
      ),
    );
    const institutional = INSTITUTIONAL.includes(spec.entity);
    const quoteDays = days.map((d) => {
      const w = window(d);
      const clock = (x: Date) => x.toLocaleTimeString("en-GB", { timeZone: "America/Sao_Paulo", hour: "2-digit", minute: "2-digit", hourCycle: "h23" });
      return { date: d, start: clock(w.start), end: clock(w.end) };
    });
    const requestItems = spaces
      .filter((s) => s.roomId || s.priceCategoryId)
      .map((s) => ({ roomId: s.roomId ?? undefined, categoryId: s.roomId ? undefined : (s.priceCategoryId ?? undefined), count: s.count, coffeeInRoom: s.coffeeInRoom }));
    const estimate = await estimateQuote(prisma, { days: quoteDays, items: requestItems, institutional });

    const [row] = await prisma.$queryRaw<{ n: bigint }[]>`SELECT nextval('event_protocol_seq') AS n`;
    const protocol = `EV-${String(row!.n).padStart(6, "0")}/${days[0]!.slice(0, 4)}`;
    const createdAt = new Date(now.getTime() - (4 + created) * 86_400_000);
    const preReservedUntil = wantRooms && spec.stage !== "CONFIRMED" ? h.at(h.futureOpenDays(6)[0] ?? days[0]!, "23:59") : null;

    const event = await prisma.event.create({
      data: {
        protocol, userId: who.id, title: spec.title, kind: spec.kind, description: spec.description, targetAudience: spec.audience,
        expectedAttendees: spec.attendees, entity: spec.entity, institutional, hasRegistrationFee: spec.fee, sponsored: spec.sponsored,
        responsible: who.name, responsibleContact: who.email, department: "Organização fictícia da demonstração",
        coffeeBreak: Boolean(spec.coffee), coffeeAttendees: spec.coffee ?? null,
        estimate: estimate as unknown as Prisma.InputJsonValue, status: spec.stage, createdAt,
        ...(spec.stage !== "SUBMITTED" && { assigneeId: h.nucev.id, assigneeName: h.nucev.name }),
        preReservedUntil,
        ...(spec.stage === "REJECTED" && { rejectionReason: "O átrio já está comprometido com outro evento institucional nessa data. Sugerimos outra semana." }),
        days: { create: days.map((d) => ({ date: new Date(`${d}T00:00:00Z`), startTime: h.at(d, spec.start), endTime: h.at(d, spec.end), setupMinutes: spec.setup })) },
        spaces: { create: spaces.map((s) => ({ ...s, dates: [] })) },
      },
    });

    // Salas do evento (pré-reserva do SAD, ou reserva confirmada).
    if (wantRooms) {
      for (const s of spec.spaces) {
        for (const name of roomsOf(s)) {
          const roomId = await h.roomId(name);
          if (!roomId) continue;
          for (const d of days) {
            const w = window(d);
            await prisma.reservation.create({
              data: {
                protocol, userId: who.id, roomId, eventId: event.id, preReservedUntil, title: spec.title,
                description: `Evento ${protocol} — ${s.purpose} (${spec.stage === "CONFIRMED" ? "reserva confirmada" : "pré-reserva do SAD"}).`,
                activityType: "CULTURE_EXTENSION", expectedAttendees: Math.min(spec.attendees, "room" in s ? spec.attendees : (s.minCapacity ?? spec.attendees)),
                termsAccepted: true, noAlcoholCommitment: true, setupMinutes: Math.min(spec.setup, 240), startTime: w.start, endTime: w.end,
                outsideRegularHours: regularScheduleIssue(w.start, w.end) !== null,
                status: "APPROVED", reviewedById: h.sad.id, reviewedAt: createdAt,
              },
            });
            h.occupy(name, w.start, w.end);
          }
        }
      }
    }

    // Orçamento enviado (das salas pré-reservadas) e a resposta.
    if (QUOTED.includes(spec.stage)) {
      const reserved = await prisma.reservation.findMany({ where: { eventId: event.id } });
      const byRoom = new Map<string, typeof reserved>();
      for (const r of reserved) byRoom.set(r.roomId!, [...(byRoom.get(r.roomId!) ?? []), r]);
      const clock = (x: Date) => x.toLocaleTimeString("en-GB", { timeZone: "America/Sao_Paulo", hour: "2-digit", minute: "2-digit", hourCycle: "h23" });
      const quoteEstimate = await estimateQuote(prisma, {
        days: quoteDays,
        items: [...byRoom.entries()].map(([roomId, list]) => ({
          roomId, count: 1, coffeeInRoom: false,
          days: list.map((r) => ({ date: r.startTime.toLocaleDateString("en-CA", { timeZone: "America/Sao_Paulo" }), start: clock(r.startTime), end: clock(r.endTime) })),
        })),
        institutional,
        exemptionReason: spec.exempt,
      });
      const quoteStatus = spec.stage === "QUOTE_SENT" ? "SENT" : spec.stage === "CHANGES_REQUESTED" ? "CHANGES_REQUESTED" : "APPROVED";
      await prisma.eventQuote.create({
        data: {
          eventId: event.id, version: 1, estimate: quoteEstimate as unknown as Prisma.InputJsonValue, totalCents: quoteEstimate.quote.totalCents,
          exemptionReason: spec.exempt ?? null, notes: "Valores da Portaria 2794. Equipe técnica de áudio e vídeo à parte.",
          status: quoteStatus, createdAt: new Date(createdAt.getTime() + 86_400_000), createdById: h.nucev.id, createdByName: h.nucev.name,
          ...(quoteStatus !== "SENT" && { decidedAt: new Date(createdAt.getTime() + 2 * 86_400_000), decidedByName: who.name, decisionNote: spec.changesNote ?? null }),
        },
      });
      if (APPROVED.includes(spec.stage)) {
        const exempt = quoteEstimate.quote.totalCents === 0;
        await prisma.event.update({
          where: { id: event.id },
          data: {
            paymentExpectedCents: quoteEstimate.quote.totalCents,
            paymentInstructions: exempt ? null : instructions,
            paymentRequestedAt: exempt ? null : new Date(createdAt.getTime() + 2 * 86_400_000),
            ...((exempt || spec.stage === "CONFIRMED" || spec.stage === "PAYMENT_VALIDATED") && {
              paymentValidatedAt: new Date(createdAt.getTime() + 3 * 86_400_000),
              paymentValidatedByName: exempt ? "Isento (sem pagamento)" : h.nucev.name,
            }),
            ...(spec.stage === "CONFIRMED" && { confirmedAt: new Date(createdAt.getTime() + 3 * 86_400_000), confirmedByName: h.sad.name }),
          },
        });
      }
      if (spec.stage === "PAYMENT_SUBMITTED") {
        await prisma.eventReceipt.create({
          data: { eventId: event.id, fileName: "comprovante-demonstracao.pdf", mimeType: "application/pdf", size: PDF.length, data: new Uint8Array(PDF), uploadedByName: who.name },
        });
      }
    }

    // Autorização da Diretoria (átrios): pendente (link para a apresentação) ou já respondida.
    if (spec.authorization) {
      const token = randomBytes(24).toString("base64url");
      await prisma.eventAuthorization.create({
        data: {
          eventId: event.id, token, recipient: "diretoria.demo@fm.usp.br", spaces: "Átrio esquerdo (SVO)", status: spec.authorization,
          requestedByName: h.nucev.name, note: "Estandes de patrocinadores e coffee break no átrio.",
          ...(spec.authorization === "AUTHORIZED" && { respondedAt: now, responseNote: "De acordo." }),
        },
      });
      // Link relativo: abre no próprio site da demonstração.
      await prisma.eventNotice.create({
        data: {
          eventId: event.id, to: ["diretoria.demo@fm.usp.br"], subject: `Autorização para uso de espaço: ${spec.title}`,
          body: `O NUCEV pede autorização para o uso do Átrio esquerdo (SVO) no evento ${protocol}.\nUse o link para autorizar ou negar.`,
          link: `/autorizacao/${token}`,
        },
      });
    }

    for (const [i, [author, text]] of (spec.messages ?? []).entries()) {
      const a = author === "person" ? { id: who.id, name: who.name, role: "USER" } : { id: h.nucev.id, name: h.nucev.name, role: "NUCEV" };
      await prisma.eventMessage.create({
        data: { eventId: event.id, authorId: a.id, authorName: a.name, authorRole: a.role, body: text, createdAt: new Date(createdAt.getTime() + (i + 1) * 3_600_000) },
      });
    }

    // Fase 16: o evento confirmado já com a organização começada.
    if (spec.stage === "CONFIRMED") await seedOrganization(prisma, h, event.id, days[0]!, who.name);
    // Antes da confirmação, quem pediu já informou palestrantes, participantes e veículos.
    if (spec.title === "Congresso de Saúde Coletiva") await seedGuests(prisma, event.id, who.name);
    created++;
  }
  return created;
}

/**
 * Fase 16 — a organização do evento confirmado da base (Cerimônia do Jaleco):
 * programação, responsáveis, um palestrante, participantes, logística e
 * pendências (uma já concluída). Nomes fictícios.
 */
async function seedOrganization(prisma: PrismaClient, h: DemoEventHelpers, eventId: string, day: string, requester: string) {
  await prisma.eventPlan.create({
    data: {
      eventId,
      buffetNeeded: true,
      buffetDetails: "Coquetel para 200 pessoas no Foyer, das 20:30 às 21:00 (fornecedor a confirmar).",
      parkingNeeded: true,
      parkingSpots: 4,
      parkingDetails: "Diretoria e paraninfo, pela entrada da Dr. Arnaldo.",
      structure: "Mesa de honra no palco, púlpito, 200 jalecos separados por turma.",
      equipment: "2 microfones sem fio, 1 de lapela, projeção no telão.",
      notes: "Fotógrafo contratado pela Comissão de Formatura.",
      updatedByName: h.nucev.name,
    },
  });
  const items: [string, string, string, string | null][] = [
    ["18:00", "18:45", "Recepção das famílias", null],
    ["19:00", "20:15", "Cerimônia de entrega dos jalecos", "Prof. Dr. Paraninfo (demo)"],
    ["20:15", "20:30", "Juramento e encerramento", "Diretoria (demo)"],
  ];
  await prisma.eventScheduleItem.createMany({
    data: items.map(([start, end, title, speaker]) => ({ eventId, startsAt: h.at(day, start), endsAt: h.at(day, end), title, location: "Teatro", speaker })),
  });
  await prisma.eventPerson.createMany({
    data: [
      { eventId, kind: "ORGANIZER", name: h.nucev.name, affiliation: "NUCEV · coordenação", contact: "vanessa.demo@fm.usp.br", addedByName: h.nucev.name },
      { eventId, kind: "ORGANIZER", name: "Secretaria de Graduação (demo)", affiliation: "Lista dos alunos e jalecos", contact: "graduacao.demo@fm.usp.br", addedByName: h.nucev.name },
      { eventId, kind: "SPEAKER", name: "Prof. Dr. Paraninfo (demo)", affiliation: "Convidado externo", contact: "paraninfo.demo@fm.usp.br", notes: "Chega às 18:30; vaga no estacionamento.", addedByName: requester },
      ...["Ana Beatriz Lima", "Bruno Carvalho", "Carla Mendes", "Diego Fernandes", "Eduarda Ribeiro", "Felipe Araújo", "Gabriela Nunes", "Henrique Castro", "Isabela Moura", "João Pedro Alves", "Larissa Teixeira", "Mateus Oliveira"].map(
        (name) => ({ eventId, kind: "PARTICIPANT" as const, name: `${name} (demo)`, affiliation: "1º ano · Medicina", addedByName: requester }),
      ),
    ],
  });
  await prisma.eventVehicle.createMany({
    data: [
      { eventId, plate: "FMU1D26", model: "Corolla preto", driver: "Prof. Dr. Paraninfo (demo)", notes: "Chega às 18:30.", addedByName: requester },
      { eventId, plate: "DEM2026", model: "Spin prata", driver: "Diretoria (demo)", addedByName: requester },
    ],
  });
  const due = (offset: number) => new Date(`${h.futureOpenDays(offset)[0] ?? day}T00:00:00Z`);
  await prisma.operationalTask.createMany({
    data: [
      { eventId, title: "Confirmar o fornecedor do coquetel", assigneeId: h.nucev.id, assigneeName: h.nucev.name, dueDate: due(5), createdById: h.nucev.id, createdByName: h.nucev.name },
      { eventId, title: "Separar os jalecos por turma", assigneeId: h.sad.id, assigneeName: h.sad.name, dueDate: due(9), createdById: h.nucev.id, createdByName: h.nucev.name },
      { eventId, title: "Reservar as vagas do estacionamento", status: "DONE", doneAt: new Date(), doneByName: h.nucev.name, assigneeId: h.nucev.id, assigneeName: h.nucev.name, createdById: h.nucev.id, createdByName: h.nucev.name },
    ],
  });
}

/** Listas informadas por quem pediu, antes da confirmação (Congresso, ainda no orçamento). */
async function seedGuests(prisma: PrismaClient, eventId: string, requester: string) {
  await prisma.eventPerson.createMany({
    data: [
      { eventId, kind: "SPEAKER", name: "Dra. Convidada da Saúde Pública (demo)", affiliation: "Fiocruz", contact: "convidada.demo@fiocruz.br", notes: "Passagem e hospedagem por conta do evento.", addedByName: requester },
      ...["Aline Prado", "Caio Martins", "Fernanda Rocha", "Rafael Duarte"].map((name) => ({ eventId, kind: "PARTICIPANT" as const, name: `${name} (demo)`, affiliation: "Saúde Coletiva", addedByName: requester })),
    ],
  });
  await prisma.eventVehicle.create({ data: { eventId, plate: "SAU3C45", model: "HB20 branco", driver: "Dra. Convidada da Saúde Pública (demo)", addedByName: requester } });
}
