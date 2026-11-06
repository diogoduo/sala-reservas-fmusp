/**
 * Base de DEMONSTRAÇÃO, toda fictícia: 20 salas com ilustrações no lugar das
 * fotos, inventário com modelos e patrimônios inventados, notebooks, pessoas e
 * cerca de 100 reservas (aprovadas, pendentes, alteradas, rejeitadas e
 * canceladas), para apresentar o sistema sem dados da faculdade.
 *
 * As reservas ficam numa janela em volta do dia em que o comando roda: por
 * padrão, 7 dias de histórico e 4 semanas à frente. Rode no dia da apresentação
 * (ou na véspera) para que a Agenda de hoje e os pedidos pendentes estejam no futuro.
 *
 *   npm run db:seed-demo -- --reset                       (janela: hoje −7 dias a hoje +4 semanas)
 *   npm run db:seed-demo -- --reset --start=2026-11-09 --days=35
 *   npm run db:seed-demo -- --reset --month=2026-10       (o mês inteiro, como antes)
 *   npm run db:seed-demo -- --preview=pasta               (só gera as ilustrações em PNG)
 *   npm run db:seed-demo -- --reset --salas-reais         (salas reais da FMUSP, com as reservas fictícias)
 *
 * --reset APAGA reservas, séries, salas (com fotos e inventário), bloqueios,
 * notebooks, sanções e os usuários que não são as contas de teste, e volta a
 * numeração de protocolos para 000001. O regulamento (texto e PDFs) e os
 * recursos ficam. Sem --reset, só roda num banco sem salas e sem reservas.
 *
 * --salas-reais (para a apresentação): no lugar das 20 salas fictícias, carrega
 * as salas reais (prisma/data/fmusp.json e as fotos de FM/, como o
 * db:import-fmusp) e põe as reservas fictícias nelas (REAL_ROOM_FOR). Com
 * --reset, as salas reais que já estão no banco ficam (fotos e inventário não
 * são carregados de novo); só as outras salas são apagadas. Aceita
 * --fotos=pasta e --sem-fotos, como o import.
 */
import { PrismaClient, type ActivityType, type Prisma, type ReservationStatus, type RoomStatus, type RoomType, type Permission, type SeatType, type UserRole } from "@prisma/client";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import sharp from "sharp";
import { DEFAULT_PERMISSIONS, sortPermissions } from "../src/auth/permissions";
import { holidayName, weekdayOf } from "../src/lib/calendar";
import { renderPhotoVersions } from "../src/photos/storage";
import { PALETTES, roomIllustration, VIEWS } from "./demo/illustrations";
import { importFmusp, loadFmuspData } from "./import-fmusp";
import { createMissingSupportAreas, SUPPORT_AREAS } from "./support-areas";

const prisma = new PrismaClient();
// "--reset" vira { reset: "true" }; "--start=2026-11-09" vira { start: "2026-11-09" }.
const args: Record<string, string> = Object.fromEntries(
  process.argv.slice(2).map((a) => {
    const [key, ...value] = a.replace(/^--/, "").split("=");
    return [key!, value.length > 0 ? value.join("=") : "true"];
  }),
);
const REAL_ROOMS = args["salas-reais"] === "true";

/**
 * --salas-reais: cada sala fictícia vira uma sala real parecida (tipo e
 * capacidade), sem repetir, para as reservas continuarem sem conflito.
 */
const REAL_ROOM_FOR: Record<string, string> = {
  "Teatro Principal": "Teatro",
  "Anfiteatro A": "Anfiteatro de Anatomia 1303",
  "Anfiteatro B": "Anfiteatro 3104",
  "Anfiteatro C": "Anfiteatro 1306",
  "Sala do Conselho": "Sala de Aula 2353",
  "Sala de Reunião 1": "Sala de Reunião 2218",
  "Sala de Reunião 2": "Sala de Reunião 2107-A",
  "Laboratório de Habilidades": "Sala de Aula 3196",
  "Sala 101": "Sala de Aula 1107",
  "Sala 102": "Sala de Aula 2366",
  "Sala 103": "Sala de Aula 2220",
  "Sala 104": "Sala de Aula 3202",
  "Sala 201": "Anfiteatro 1104",
  "Sala 202": "Sala de Aula 2368",
  "Sala 203": "Sala de Aula 2223",
  "Sala de Estudos": "Sala de Aula 1357",
  "Laboratório de Informática 1": "Sala de Informática 1154",
  "Laboratório de Informática 2": "Sala de Informática 1366 A",
  "Espaço Multiuso": "Anfiteatro 2303",
  "Sala 301": "Congregação 3000",
};

// ---------------------------------------------------------------------------
// Datas (fuso de São Paulo, sem horário de verão desde 2019)
// ---------------------------------------------------------------------------

const TZ = "America/Sao_Paulo";
const dateKey = (d: Date) =>
  new Intl.DateTimeFormat("en-CA", { timeZone: TZ, year: "numeric", month: "2-digit", day: "2-digit" }).format(d);
const at = (key: string, time: string) => new Date(`${key}T${time}:00-03:00`);
const addMinutes = (d: Date, m: number) => new Date(d.getTime() + m * 60_000);
const addDaysTo = (d: Date, days: number) => new Date(d.getTime() + days * 86_400_000);
const now = new Date();
const today = dateKey(now);
const shiftKey = (key: string, days: number) => dateKey(addDaysTo(at(key, "12:00"), days));

/** Janela das reservas: --month (o mês inteiro) ou --start/--days (padrão: hoje −7 dias, 35 dias). */
function windowOf(): string[] {
  if (args.month) {
    const [year, month] = args.month.split("-").map(Number) as [number, number];
    const days = new Date(Date.UTC(year, month, 0)).getUTCDate();
    return Array.from({ length: days }, (_, i) => `${args.month}-${String(i + 1).padStart(2, "0")}`);
  }
  const start = args.start ?? shiftKey(today, -7);
  const length = Number(args.days ?? 35);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(start) || !(length >= 7 && length <= 92)) {
    throw new Error("Use --start=AAAA-MM-DD e --days entre 7 e 92.");
  }
  return Array.from({ length }, (_, i) => shiftKey(start, i));
}
const windowDays = windowOf();
const windowLabel = `${windowDays[0]} a ${windowDays.at(-1)}`;
/** Dias de funcionamento (Portaria 2793, Art. 6º): segunda a sábado, fora feriados. */
const openDays = windowDays.filter((d) => weekdayOf(d) !== 0 && holidayName(d) === null);
/** Dias de funcionamento a partir de `offset` dias depois de hoje (para pedidos ainda em análise). */
const futureOpenDays = (offset: number) => openDays.filter((d) => d >= shiftKey(today, offset));

// Sorteio com semente: a mesma janela gera sempre a mesma base.
let seed = Number(windowDays[0]!.replace(/-/g, ""));
const random = () => {
  seed = (seed + 0x6d2b79f5) | 0;
  let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
};
const pick = <T>(list: readonly T[]): T => list[Math.floor(random() * list.length)]!;

// ---------------------------------------------------------------------------
// Catálogo fictício
// ---------------------------------------------------------------------------

const RESOURCES: { name: string; description: string | null; requestable: boolean; requestsQuantity?: boolean; detailPrompt?: string; detailOptions?: string[] }[] = [
  { name: "Datashow/Projetor", description: "Projetor multimídia", requestable: true },
  { name: "Lousa Interativa", description: "Lousa digital interativa", requestable: true },
  { name: "Ar-condicionado", description: null, requestable: true },
  { name: "Sistema de Som", description: "Caixas e mesa de som", requestable: true },
  { name: "Equipamento de Videoconferência", description: "Câmera, microfone e codec", requestable: true, detailPrompt: "Ex.: IP, modelo do equipamento" },
  { name: "Microfones", description: "Microfones sem fio / de lapela", requestable: true },
  { name: "Computador de Apoio", description: "Computador fixo na sala", requestable: true, requestsQuantity: true },
  { name: "Chromebook", description: "Chromebooks para uso dos participantes", requestable: true, requestsQuantity: true },
  { name: "Webconferência", description: "Transmissão ou reunião online", requestable: true, detailPrompt: "Ex.: Zoom, Teams, Google Meet" },
  {
    name: "Bloqueio de internet para prova",
    description: "Bloqueia a internet durante a avaliação, liberando só a plataforma da prova",
    requestable: true,
    detailPrompt: "Plataforma da prova",
    detailOptions: ["Canvas", "e-Disciplinas", "TestPortal"],
  },
  { name: "Equipamento pessoal", description: "O solicitante traz o próprio notebook/equipamento", requestable: true },
  { name: "Outro equipamento", description: null, requestable: true, detailPrompt: "Qual?" },
  { name: "Televisão", description: "TV para exibir apresentações e vídeos", requestable: true },
  { name: "Webcam", description: "Câmera para transmissão ou webconferência", requestable: true },
  { name: "Passador de slides", description: "Controle sem fio para apresentações", requestable: true },
  { name: "Nobreak", description: null, requestable: false },
  { name: "Monitor", description: null, requestable: false },
  { name: "Amplificador", description: null, requestable: false },
  { name: "Receptor de microfone", description: null, requestable: false },
  { name: "Splitter de vídeo", description: null, requestable: false },
  { name: "Controle do projetor", description: null, requestable: false },
];

type Equipment = [resource: string, quantity: number, model: string | null];

interface DemoRoom {
  name: string;
  building: string;
  floor: string;
  capacity: number | null;
  roomType: RoomType;
  status?: RoomStatus;
  seatTypes: SeatType[];
  dimensions: string;
  extraSeats?: number;
  wideDoor?: boolean;
  specialNeeds?: boolean;
  equipmentNotes?: string;
  equipment: Equipment[];
}

const projector = (model = "Epson PowerLite W52"): Equipment[] => [
  ["Datashow/Projetor", 1, model],
  ["Controle do projetor", 1, null],
  ["Computador de Apoio", 1, "Dell OptiPlex 3000"],
  ["Ar-condicionado", 1, "Springer Midea 30.000 BTU"],
];

const ROOMS: DemoRoom[] = [
  {
    name: "Teatro Principal", building: "Edifício Central", floor: "Térreo", capacity: 220, roomType: "THEATER", seatTypes: ["UNIVERSITY_FIXED"],
    dimensions: "18,40 × 24,10 m", extraSeats: 6, wideDoor: true, specialNeeds: true, equipmentNotes: "Mesa de som de 16 canais e iluminação cênica com 12 refletores.",
    equipment: [...projector("Epson Pro L1505U"), ["Sistema de Som", 1, "Yamaha MG16XU"], ["Microfones", 6, "Shure BLX24/SM58"], ["Receptor de microfone", 3, "Shure BLX4"], ["Amplificador", 1, "Ciclotron DBK 4800"], ["Nobreak", 1, "SMS Station II 3 kVA"], ["Passador de slides", 1, "Logitech R400"]],
  },
  {
    name: "Anfiteatro A", building: "Edifício Central", floor: "1º andar", capacity: 120, roomType: "AUDITORIUM", seatTypes: ["UNIVERSITY_FIXED"],
    dimensions: "12,60 × 16,80 m", extraSeats: 2, wideDoor: true, specialNeeds: true,
    equipment: [...projector("Epson PowerLite L520U"), ["Sistema de Som", 1, "JBL EON One"], ["Microfones", 2, "Sennheiser XSW 1"], ["Equipamento de Videoconferência", 1, "Logitech Rally"], ["Nobreak", 1, "APC Smart-UPS 1500"]],
  },
  {
    name: "Anfiteatro B", building: "Edifício Central", floor: "1º andar", capacity: 90, roomType: "AUDITORIUM", seatTypes: ["UNIVERSITY_FIXED"],
    dimensions: "10,80 × 14,20 m", wideDoor: true,
    equipment: [...projector(), ["Sistema de Som", 1, "JBL EON One"], ["Microfones", 2, "Sennheiser XSW 1"], ["Lousa Interativa", 1, "Samsung Flip 55"]],
  },
  {
    name: "Anfiteatro C", building: "Edifício Central", floor: "2º andar", capacity: 64, roomType: "AUDITORIUM", seatTypes: ["UNIVERSITY_FIXED"],
    dimensions: "9,40 × 11,60 m",
    equipment: [...projector(), ["Sistema de Som", 1, "Frahm MS 4 Pro"], ["Microfones", 1, "Leson MS-115"]],
  },
  {
    name: "Sala do Conselho", building: "Edifício Central", floor: "3º andar", capacity: 26, roomType: "BOARD_ROOM", seatTypes: [],
    dimensions: "8,20 × 12,40 m", wideDoor: true, specialNeeds: true, equipmentNotes: "Mesa em U com 26 lugares e microfone em cada posição.",
    equipment: [["Televisão", 2, "LG 75UR8750"], ["Microfones", 13, "Bosch CCS 1000 D"], ["Equipamento de Videoconferência", 1, "Poly Studio X50"], ["Computador de Apoio", 1, "Dell OptiPlex 7010"], ["Ar-condicionado", 2, "Daikin 24.000 BTU"]],
  },
  {
    name: "Sala de Reunião 1", building: "Edifício Central", floor: "3º andar", capacity: 12, roomType: "MEETING_ROOM", seatTypes: [],
    dimensions: "5,10 × 7,30 m",
    equipment: [["Televisão", 1, "Samsung Crystal 65\""], ["Webcam", 1, "Logitech C920"], ["Ar-condicionado", 1, "LG Dual Inverter 18.000 BTU"]],
  },
  {
    name: "Sala de Reunião 2", building: "Edifício Central", floor: "3º andar", capacity: 8, roomType: "MEETING_ROOM", seatTypes: [],
    dimensions: "4,20 × 5,60 m",
    equipment: [["Televisão", 1, "Samsung Crystal 55\""], ["Webcam", 1, "Logitech C920"]],
  },
  {
    name: "Laboratório de Habilidades", building: "Edifício Central", floor: "2º andar", capacity: 20, roomType: "LABORATORY", seatTypes: ["SCHOOL"],
    dimensions: "8,80 × 10,20 m", equipmentNotes: "6 bancadas e manequins de simulação.",
    equipment: [["Televisão", 1, "LG 65UR8750"], ["Computador de Apoio", 1, "Dell OptiPlex 3000"], ["Ar-condicionado", 1, "Springer Midea 24.000 BTU"]],
  },
  {
    name: "Sala 101", building: "Anexo Didático", floor: "1º andar", capacity: 40, roomType: "CLASSROOM", seatTypes: ["UNIVERSITY_MOBILE"],
    dimensions: "7,40 × 9,60 m", extraSeats: 1, wideDoor: true, specialNeeds: true, equipment: projector(),
  },
  { name: "Sala 102", building: "Anexo Didático", floor: "1º andar", capacity: 40, roomType: "CLASSROOM", seatTypes: ["UNIVERSITY_MOBILE"], dimensions: "7,40 × 9,60 m", extraSeats: 1, equipment: projector() },
  { name: "Sala 103", building: "Anexo Didático", floor: "1º andar", capacity: 30, roomType: "CLASSROOM", seatTypes: ["SCHOOL"], dimensions: "6,20 × 8,10 m", equipment: projector("BenQ MS560") },
  { name: "Sala 104", building: "Anexo Didático", floor: "1º andar", capacity: 30, roomType: "CLASSROOM", seatTypes: ["SCHOOL"], dimensions: "6,20 × 8,10 m", equipment: [...projector("BenQ MS560"), ["Lousa Interativa", 1, "Samsung Flip 65"]] },
  {
    name: "Sala 201", building: "Anexo Didático", floor: "2º andar", capacity: 50, roomType: "CLASSROOM", seatTypes: ["UNIVERSITY_MOBILE"],
    dimensions: "8,60 × 10,40 m", wideDoor: true, equipment: [...projector(), ["Sistema de Som", 1, "Frahm MS 4 Pro"], ["Microfones", 1, "Leson MS-115"]],
  },
  { name: "Sala 202", building: "Anexo Didático", floor: "2º andar", capacity: 36, roomType: "CLASSROOM", seatTypes: ["UNIVERSITY_MOBILE"], dimensions: "7,00 × 8,80 m", equipment: projector() },
  { name: "Sala 203", building: "Anexo Didático", floor: "2º andar", capacity: 24, roomType: "CLASSROOM", seatTypes: ["UNIVERSITY_MOBILE"], dimensions: "5,80 × 7,20 m", equipment: [["Televisão", 1, "LG 65UR8750"], ["Ar-condicionado", 1, "LG Dual Inverter 18.000 BTU"]] },
  { name: "Sala de Estudos", building: "Anexo Didático", floor: "2º andar", capacity: 16, roomType: "CLASSROOM", seatTypes: ["SCHOOL"], dimensions: "5,20 × 6,40 m", equipment: [["Televisão", 1, "Samsung Crystal 55\""]] },
  {
    name: "Laboratório de Informática 1", building: "Anexo Didático", floor: "Térreo", capacity: 30, roomType: "COMPUTER_LAB", seatTypes: ["SCHOOL"],
    dimensions: "8,40 × 11,20 m", wideDoor: true,
    equipment: [...projector(), ["Computador de Apoio", 30, "Lenovo ThinkCentre M70q"], ["Monitor", 30, "Dell P2422H"], ["Nobreak", 4, "SMS Net 4+ 1500"]],
  },
  {
    name: "Laboratório de Informática 2", building: "Anexo Didático", floor: "Térreo", capacity: 20, roomType: "COMPUTER_LAB", seatTypes: ["SCHOOL"],
    dimensions: "6,80 × 9,20 m",
    equipment: [...projector("BenQ MS560"), ["Computador de Apoio", 20, "Lenovo ThinkCentre M70q"], ["Monitor", 20, "Dell P2422H"]],
  },
  {
    name: "Espaço Multiuso", building: "Anexo Didático", floor: "Térreo", capacity: 60, roomType: "MULTIPURPOSE", seatTypes: ["SCHOOL"],
    dimensions: "11,00 × 13,50 m", wideDoor: true, specialNeeds: true, equipmentNotes: "Mesas redondas dobráveis e divisórias móveis.",
    equipment: [["Televisão", 2, "LG 75UR8750"], ["Sistema de Som", 1, "JBL PartyBox 310"], ["Microfones", 2, "Sennheiser XSW 1"], ["Splitter de vídeo", 1, "Multilaser HDMI 1x4"]],
  },
  {
    name: "Sala 301", building: "Anexo Didático", floor: "3º andar", capacity: null, roomType: "CLASSROOM", status: "MAINTENANCE", seatTypes: [],
    dimensions: "7,40 × 9,60 m", equipmentNotes: "Em reforma até o fim do semestre: troca de piso e da rede elétrica.", equipment: [],
  },
];

const NOTEBOOKS: { model: string; location: "SAD" | "NIT"; notes?: string }[] = [
  { model: "Dell Latitude 3440", location: "SAD" },
  { model: "Dell Latitude 3440", location: "SAD" },
  { model: "Dell Latitude 3440", location: "SAD", notes: "Bateria segura só 1 hora" },
  { model: "Lenovo ThinkPad E14 Gen 5", location: "SAD" },
  { model: "Lenovo ThinkPad E14 Gen 5", location: "SAD" },
  { model: "HP ProBook 440 G10", location: "SAD", notes: "Emprestado à secretaria até o dia 30" },
  { model: "HP ProBook 440 G10", location: "SAD" },
  { model: "Acer Aspire 5", location: "SAD", notes: "Teclado com a tecla Enter falhando" },
  { model: "Dell Latitude 5420", location: "NIT" },
  { model: "Dell Latitude 5420", location: "NIT" },
  { model: "Lenovo IdeaPad 3", location: "NIT", notes: "Aguardando formatação" },
  { model: "Lenovo IdeaPad 3", location: "NIT" },
];

// Contas da tela de login (Mock USP) — as mesmas de prisma/seed.ts, uma de cada perfil.
// Sueli e Juliana pedem só os tipos delas e Reunião (sem Cultura e Extensão e Concurso).
const DEV_USERS: { uspNumber: string; name: string; email: string; role: UserRole; permissions: Permission[] }[] = [
  { uspNumber: "1000001", name: "SAD — Serviço de Apoio Didático", email: "admin@fm.usp.br", role: "ADMIN", permissions: DEFAULT_PERMISSIONS },
  { uspNumber: "1000002", name: "Aluno Teste", email: "aluno@usp.br", role: "USER", permissions: DEFAULT_PERMISSIONS },
  { uspNumber: "1000003", name: "Docente Teste", email: "docente@fm.usp.br", role: "USER", permissions: [...DEFAULT_PERMISSIONS, "REQUEST_UNDERGRADUATE", "REQUEST_GRADUATE"] },
  { uspNumber: "1000004", name: "Funcionário HC Teste", email: "funcionario@hc.fm.usp.br", role: "USER", permissions: DEFAULT_PERMISSIONS },
  { uspNumber: "1000005", name: "Sueli — Pós-Graduação (demo)", email: "sueli.demo@fm.usp.br", role: "USER", permissions: ["REQUEST_DEFENSE", "REQUEST_GRADUATE"] },
  { uspNumber: "1000006", name: "Juliana — Graduação (demo)", email: "juliana.demo@fm.usp.br", role: "USER", permissions: ["REQUEST_GRADUATE", "REQUEST_UNDERGRADUATE"] },
  { uspNumber: "1000007", name: "Vanessa — NUCEV (demo)", email: "vanessa.demo@fm.usp.br", role: "NUCEV", permissions: DEFAULT_PERMISSIONS },
  { uspNumber: "1000008", name: "Maria — NUCEV (demo)", email: "maria.demo@fm.usp.br", role: "NUCEV", permissions: DEFAULT_PERMISSIONS },
];

// Pessoas fictícias (".demo" no e-mail para não coincidir com caixas reais).
const PEOPLE = {
  helena: { name: "Profa. Helena Martins", email: "helena.martins.demo@usp.br", dept: "Departamento de Medicina Interna" },
  ricardo: { name: "Prof. Ricardo Alves", email: "ricardo.alves.demo@usp.br", dept: "Departamento de Cirurgia" },
  eduardo: { name: "Prof. Eduardo Lima", email: "eduardo.lima.demo@usp.br", dept: "Departamento de Morfologia" },
  marina: { name: "Profa. Marina Costa", email: "marina.costa.demo@usp.br", dept: "Departamento de Saúde Coletiva" },
  paulo: { name: "Dr. Paulo Mendes", email: "paulo.mendes.demo@usp.br", dept: "Programa de Pós-Graduação em Ciências Médicas" },
  camila: { name: "Camila Rocha", email: "camila.rocha.demo@usp.br", dept: "Centro Acadêmico" },
  bruno: { name: "Bruno Ferreira", email: "bruno.ferreira.demo@usp.br", dept: "Liga Acadêmica de Cardiologia" },
  graduacao: { name: "Secretaria de Graduação", email: "graduacao.demo@fm.usp.br", dept: "Serviço de Graduação" },
  posgrad: { name: "Comissão de Pós-Graduação", email: "posgrad.demo@fm.usp.br", dept: "Comissão de Pós-Graduação" },
  aluno: { name: "Aluno Teste", email: "aluno@usp.br", dept: "Liga Acadêmica de Neurologia" },
  docente: { name: "Docente Teste", email: "docente@fm.usp.br", dept: "Departamento de Fisiologia" },
  sad: { name: "SAD — Serviço de Apoio Didático", email: "admin@fm.usp.br", dept: "SAD" },
} as const;
type Person = keyof typeof PEOPLE;

// ---------------------------------------------------------------------------
// Modelos de pedido (o formulário de cada tipo de atividade)
// ---------------------------------------------------------------------------

interface Request {
  person: Person;
  type: ActivityType;
  title: string;
  details: Record<string, unknown>;
  description: string;
  attendees: number;
  duration: number;
  starts: string[];
  rooms: string[];
  resources?: [string, number?, string?][];
  setup?: number;
  supportNotes?: string;
}

const grad = (person: Person, code: string, name: string, students: number, classType: string, year: number, extra: Partial<Request> = {}): Request => ({
  person,
  type: "UNDERGRADUATE",
  title: `${code} — ${name}`,
  details: { classType, courseYear: year, disciplineCode: code, disciplineName: name, studentCount: students, disciplineOwner: PEOPLE[person].name, department: PEOPLE[person].dept },
  description: classType === "EXAM" ? `Prova de ${name} para o ${year}º ano.` : `Aula de ${name} para a turma do ${year}º ano.`,
  attendees: students,
  duration: 120,
  starts: ["08:00", "10:00", "14:00", "16:00"],
  rooms: [],
  ...extra,
});

const pos = (person: Person, code: string, name: string, students: number, extra: Partial<Request> = {}): Request => ({
  person,
  type: "GRADUATE",
  title: `${code} — ${name}`,
  details: { disciplineCode: code, disciplineName: name, studentCount: students, disciplineOwner: PEOPLE[person].name, department: PEOPLE[person].dept },
  description: `Disciplina de pós-graduação: ${name}.`,
  attendees: students,
  duration: 180,
  starts: ["09:00", "14:00", "18:00"],
  rooms: [],
  ...extra,
});

const culture = (person: Person, kind: string, title: string, entity: string, people: number, program: string, extra: Partial<Request> = {}): Request => ({
  person,
  type: "CULTURE_EXTENSION",
  title,
  details: {
    kind, activityTitle: title, participantCount: people, targetAudience: "Alunos de graduação e residentes", program, entity,
    free: true, ccexStatus: "AUTHORIZED", ccexProcess: `CCEx ${100 + Math.floor(random() * 800)}/2026`,
    responsible: PEOPLE[person].name, responsibleContact: PEOPLE[person].email, department: PEOPLE[person].dept,
  },
  description: `${title}. Atividade aberta à comunidade acadêmica.`,
  attendees: people,
  duration: 180,
  starts: ["09:00", "13:00", "14:00", "18:00"],
  rooms: [],
  ...extra,
});

const defense = (candidate: string, work: string, level: string): Request => ({
  person: "posgrad",
  type: "DEFENSE",
  title: `Defesa de ${level === "DOCTORATE" ? "Doutorado" : "Mestrado"} — ${candidate}`,
  details: { work, candidate, advisor: PEOPLE.paulo.name, department: PEOPLE.paulo.dept, level, audience: 25 },
  description: `Defesa pública: "${work}".`,
  attendees: 25,
  duration: 180,
  starts: ["09:00", "14:00"],
  rooms: ["Sala do Conselho", "Anfiteatro C"],
  resources: [["Datashow/Projetor"], ["Webconferência", undefined, "Zoom"]],
  setup: 30,
});

const meeting = (person: Person, kind: string, title: string, people: number, rooms: string[]): Request => ({
  person,
  type: "ADMINISTRATIVE",
  title,
  details: { kind, meetingTitle: title, participantCount: people, responsible: PEOPLE[person].name, department: PEOPLE[person].dept },
  description: `${title}.`,
  attendees: people,
  duration: 90,
  starts: ["09:00", "10:30", "14:00", "16:00"],
  rooms,
  resources: [["Televisão"]],
});

const SINGLES: Request[] = [
  grad("ricardo", "DEM0155", "Farmacologia Básica", 140, "EXAM", 2, { rooms: ["Teatro Principal"], duration: 180, resources: [["Bloqueio de internet para prova", undefined, "e-Disciplinas"]] }),
  grad("docente", "DEM0170", "Fisiologia Cardiovascular", 85, "EXAM", 2, { rooms: ["Anfiteatro B"] }),
  grad("helena", "DEM0142", "Semiologia Médica", 40, "MAKEUP", 3, { rooms: ["Sala 101", "Sala 102"] }),
  grad("eduardo", "DEM0215", "Neuroanatomia", 30, "PRACTICAL", 1, { rooms: ["Laboratório de Habilidades", "Sala 103"] }),
  grad("marina", "DEM0330", "Epidemiologia", 48, "LECTURE", 3, { rooms: ["Sala 201"] }),
  grad("docente", "DEM0172", "Fisiologia Renal", 36, "LECTURE", 2, { rooms: ["Sala 202", "Sala 102"] }),
  grad("eduardo", "DEM0211", "Histologia", 28, "PRACTICAL", 1, { rooms: ["Sala 104", "Sala 103"], resources: [["Lousa Interativa"]] }),
  grad("marina", "DEM0305", "Bioestatística", 20, "EXAM", 4, { rooms: ["Laboratório de Informática 2"], resources: [["Computador de Apoio", 20], ["Bloqueio de internet para prova", undefined, "Canvas"]] }),
  pos("paulo", "PGD5031", "Bioética em Pesquisa", 22, { rooms: ["Sala 203", "Sala 202"] }),
  pos("ricardo", "PGD5044", "Técnicas Cirúrgicas Avançadas", 18, { rooms: ["Laboratório de Habilidades"] }),
  pos("paulo", "PGD5050", "Escrita Científica", 15, { rooms: ["Sala de Estudos", "Sala 203"], resources: [["Equipamento pessoal"]] }),
  culture("camila", "SEMINAR", "Ciclo de Palestras: Saúde Mental na Graduação", "CAOC", 80, "18:00 Abertura\n18:15 Palestra\n19:30 Roda de conversa", { rooms: ["Anfiteatro B"], duration: 150, resources: [["Sistema de Som"], ["Microfones", 2]] }),
  culture("bruno", "LEAGUE", "Liga de Cardiologia — Aula aberta: ECG na prática", "LEAGUE", 60, "18:30 Aula\n20:00 Casos clínicos", { rooms: ["Anfiteatro C"], duration: 150, starts: ["18:30"] }),
  culture("ricardo", "COURSE", "Curso de Suporte Básico de Vida", "DEPARTMENT", 30, "08:00 Teoria\n10:00 Prática em manequins", { rooms: ["Laboratório de Habilidades", "Espaço Multiuso"], duration: 240, starts: ["08:00"], setup: 60 }),
  culture("camila", "CEREMONY", "Cerimônia de Boas-Vindas aos Calouros", "CAOC", 200, "19:00 Abertura\n19:30 Homenagens\n20:30 Encerramento", { rooms: ["Teatro Principal"], duration: 180, starts: ["19:00"], setup: 60, resources: [["Sistema de Som"], ["Microfones", 4], ["Datashow/Projetor"]] }),
  culture("marina", "CONGRESS", "Jornada de Saúde Coletiva", "DEPARTMENT", 95, "08:30 Credenciamento\n09:00 Conferência\n14:00 Mesas temáticas", { rooms: ["Anfiteatro A"], duration: 480, starts: ["08:00"], setup: 60, resources: [["Webconferência", undefined, "YouTube"], ["Microfones", 3]] }),
  culture("aluno", "LEAGUE", "Liga de Neurologia — Reunião científica", "LEAGUE", 35, "19:00 Apresentação de casos", { rooms: ["Sala 202", "Sala 101"], duration: 120, starts: ["19:00"] }),
  culture("camila", "STUDENT_ACTIVITY", "Workshop de Currículo e Residência", "CAOC", 50, "14:00 Oficina\n16:00 Perguntas", { rooms: ["Espaço Multiuso", "Sala 201"], duration: 180 }),
  defense("Mariana Souza", "Biomarcadores de inflamação em pacientes com sepse", "DOCTORATE"),
  defense("Lucas Pereira", "Telemedicina na atenção primária: um estudo de coorte", "MASTERS"),
  defense("Fernanda Oliveira", "Efeitos do exercício na função endotelial", "DOCTORATE"),
  {
    person: "graduacao", type: "PUBLIC_EXAM", title: "Concurso Docente — Clínica Geral (prova didática)",
    details: { examTitle: "Concurso Docente — Clínica Geral (prova didática)", audience: 40, candidateCount: 4, responsible: PEOPLE.graduacao.name, department: PEOPLE.helena.dept, candidateNames: "Candidato A\nCandidato B\nCandidato C\nCandidato D" },
    description: "Prova didática do concurso para professor doutor.", attendees: 40, duration: 480, starts: ["08:00"], rooms: ["Anfiteatro C", "Sala do Conselho"], resources: [["Datashow/Projetor"]],
  },
  meeting("graduacao", "MEETING", "Reunião da Comissão de Graduação", 18, ["Sala do Conselho", "Sala de Reunião 1"]),
  meeting("helena", "MEETING", "Reunião do Departamento de Medicina Interna", 12, ["Sala de Reunião 1"]),
  meeting("graduacao", "DIRECTORATE", "Reunião da Diretoria com coordenadores de curso", 10, ["Sala de Reunião 1", "Sala do Conselho"]),
  meeting("posgrad", "MEETING", "Reunião da Comissão de Pós-Graduação", 8, ["Sala de Reunião 2", "Sala de Reunião 1"]),
  meeting("graduacao", "STAFF", "Assembleia da Representação dos Funcionários", 50, ["Espaço Multiuso"]),
];

/** Aulas que se repetem toda semana na janela. `pending`: série pedida há pouco, ainda em análise (só datas daqui a 7 dias ou mais). */
const SERIES: { request: Request; weekdays: number[]; start: string; room: string; pending?: boolean }[] = [
  { request: grad("helena", "DEM0142", "Semiologia Médica", 95, "LECTURE", 3, { resources: [["Microfones", 1]] }), weekdays: [2, 4], start: "08:00", room: "Anfiteatro A" },
  { request: grad("eduardo", "DEM0210", "Anatomia Aplicada", 48, "LECTURE", 1), weekdays: [1, 3], start: "10:00", room: "Sala 201" },
  { request: pos("paulo", "PGD5012", "Metodologia da Pesquisa Clínica", 30), weekdays: [3], start: "14:00", room: "Sala 202" },
  { request: grad("marina", "DEM0305", "Bioestatística", 30, "PRACTICAL", 4, { resources: [["Computador de Apoio", 30]] }), weekdays: [5], start: "13:00", room: "Laboratório de Informática 1" },
  {
    request: culture("ricardo", "COURSE", "Curso de Atualização em Emergências", "DEPARTMENT", 80, "08:00 Aula teórica\n10:30 Discussão de casos", { duration: 240 }),
    weekdays: [6], start: "08:00", room: "Anfiteatro B",
  },
  { request: grad("marina", "DEM0128", "Habilidades Clínicas", 20, "PRACTICAL", 2), weekdays: [1, 4], start: "14:00", room: "Laboratório de Habilidades" },
  { request: pos("ricardo", "PGD5020", "Seminários Avançados em Cirurgia", 20, { duration: 120 }), weekdays: [4], start: "18:00", room: "Sala 203", pending: true },
];

const REJECTIONS = [
  "Não há sala com essa capacidade livre no horário. Sugerimos o mesmo horário na semana seguinte.",
  "O horário pedido já está ocupado por aulas da graduação, que têm prioridade (Portaria 2793, Art. 7º).",
  "Falta a autorização da CCEx para o evento (Portaria 2793, Art. 20).",
];
const SAD_CANCELS = ["Sala interditada para manutenção do ar-condicionado.", "Atividade remanejada pela coordenação do curso."];

// ---------------------------------------------------------------------------

async function renderPreview(dir: string) {
  mkdirSync(dir, { recursive: true });
  for (const [i, room] of ROOMS.entries()) {
    for (const [v, view] of VIEWS.entries()) {
      const svg = roomIllustration(room.roomType, room.capacity ?? 30, PALETTES[i % PALETTES.length]!, view.camera);
      writeFileSync(join(dir, `${String(i + 1).padStart(2, "0")}-${v}.png`), await sharp(Buffer.from(svg)).png().toBuffer());
    }
  }
  console.log(`Ilustrações em ${dir}`);
}

type RoomKey = { building: string; floor: string; name: string };

/** `keepRooms`: salas que ficam (com fotos e inventário); as demais são apagadas. */
async function reset(keepRooms: RoomKey[] = []) {
  const keep = DEV_USERS.map((u) => u.email);
  await prisma.$transaction([
    prisma.auditLog.deleteMany(),
    prisma.userSanction.deleteMany(),
    prisma.reservation.deleteMany(),
    prisma.reservationSeries.deleteMany(),
    prisma.roomBlock.deleteMany(),
    // Fotos e inventário vão junto (cascade).
    prisma.room.deleteMany(keepRooms.length > 0 ? { where: { NOT: keepRooms } } : undefined),
    prisma.notebook.deleteMany(),
    prisma.user.deleteMany({ where: { email: { notIn: keep } } }),
  ]);
  // Protocolos recomeçam do 000001.
  await prisma.$queryRaw`SELECT setval('reservation_protocol_seq', 1, false)`;
}

async function main() {
  if (args.preview) return renderPreview(args.preview);

  // Com --salas-reais, o fmusp.json precisa estar aqui antes de apagar qualquer coisa.
  const realKeys: RoomKey[] = REAL_ROOMS
    ? [...loadFmuspData().rooms, ...SUPPORT_AREAS].map(({ building, floor, name }) => ({ building, floor, name }))
    : [];
  const [roomCount, reservationCount] = await Promise.all([prisma.room.count(), prisma.reservation.count()]);
  if ((roomCount > 0 || reservationCount > 0) && !args.reset) {
    throw new Error(`O banco já tem ${roomCount} salas e ${reservationCount} reservas. Para APAGAR e trocar pela base de demonstração, rode com --reset.`);
  }
  if (args.reset) await reset(realKeys);

  // Recursos (mantém os que já existem, só garante os da demonstração).
  const resourceId = new Map<string, string>();
  for (const r of RESOURCES) {
    const data = { description: r.description, requestable: r.requestable, requestsQuantity: r.requestsQuantity ?? false, detailPrompt: r.detailPrompt ?? null, detailOptions: r.detailOptions ?? [] };
    const row = await prisma.resource.upsert({ where: { name: r.name }, update: { requestable: r.requestable }, create: { name: r.name, ...data } });
    resourceId.set(r.name, row.id);
  }

  // Pessoas
  const userId = new Map<string, string>();
  for (const u of DEV_USERS) {
    const permissions = sortPermissions(u.permissions);
    const row = await prisma.user.upsert({ where: { email: u.email }, update: { name: u.name, role: u.role, permissions }, create: { ...u, permissions } });
    userId.set(u.email, row.id);
  }
  for (const [key, p] of Object.entries(PEOPLE)) {
    if (userId.has(p.email)) continue;
    const row = await prisma.user.create({ data: { uspNumber: `demo-${key}`, name: p.name, email: p.email, role: "USER" } });
    userId.set(p.email, row.id);
  }
  const uid = (person: Person) => userId.get(PEOPLE[person].email)!;
  const sadId = uid("sad");

  // Salas. As reservas abaixo usam os nomes das salas fictícias; com
  // --salas-reais, cada nome aponta para a sala real de REAL_ROOM_FOR.
  const roomByName = new Map<string, { id: string; capacity: number | null }>();
  /** "Sala 202 — Anexo Didático, 2º andar", para o "antes" das reservas alteradas. */
  const roomText = new Map<string, string>();
  if (REAL_ROOMS) {
    // Salas reais, inventário, notebooks, áreas de apoio e fotos, como o db:import-fmusp.
    await importFmusp(prisma, { photosDir: args.fotos, skipPhotos: args["sem-fotos"] === "true" });
    for (const [demoName, realName] of Object.entries(REAL_ROOM_FOR)) {
      const row = await prisma.room.findFirst({ where: { name: realName }, select: { id: true, capacity: true, name: true, building: true, floor: true } });
      if (!row) throw new Error(`Sala real não encontrada: ${realName} (confira REAL_ROOM_FOR e o fmusp.json).`);
      roomByName.set(demoName, { id: row.id, capacity: row.capacity });
      roomText.set(demoName, `${row.name} — ${row.building}, ${row.floor}`);
    }
  }
  // Salas fictícias, inventário (patrimônios fictícios) e ilustrações
  let assetTag = 271350;
  for (const [i, room] of REAL_ROOMS ? [] : ROOMS.entries()) {
    // Um recurso por sala: a última linha vale (ex.: os 30 computadores do laboratório).
    const equipment = [...new Map(room.equipment.map((e) => [e[0], e])).values()];
    const row = await prisma.room.create({
      data: {
        name: room.name, building: room.building, floor: room.floor, capacity: room.capacity, roomType: room.roomType, status: room.status ?? "ACTIVE",
        seatTypes: room.seatTypes, dimensions: room.dimensions, extraSeats: room.extraSeats ?? null, wideDoor: room.wideDoor ?? false,
        specialNeeds: room.specialNeeds ?? false, equipmentNotes: room.equipmentNotes ?? null,
        resources: {
          create: equipment.map(([name, quantity, model]) => ({
            resourceId: resourceId.get(name)!,
            quantity,
            model,
            assetTags: model ? Array.from({ length: Math.min(quantity, 4) }, () => `PAT-${assetTag++}`).join(", ") + (quantity > 4 ? " …" : "") : null,
          })),
        },
      },
    });
    roomByName.set(room.name, { id: row.id, capacity: room.capacity });
    roomText.set(room.name, `${room.name} — ${room.building}, ${room.floor}`);
    const views = room.roomType === "CLASSROOM" || room.roomType === "AUDITORIUM" || room.roomType === "THEATER" ? VIEWS : VIEWS.slice(0, 2);
    for (const [position, view] of views.entries()) {
      const svg = roomIllustration(room.roomType, room.capacity ?? 30, PALETTES[i % PALETTES.length]!, view.camera);
      const versions = await renderPhotoVersions(Buffer.from(svg));
      await prisma.roomPhoto.create({ data: { roomId: row.id, caption: view.caption, position, sourceName: `demo-${position}`, ...versions } });
    }
    process.stdout.write(".");
  }
  if (!REAL_ROOMS) {
    console.log(`\n${ROOMS.length} salas`);
    // Áreas de apoio e de coffee break (as mesmas das salas reais), sem fotos.
    console.log(`${await createMissingSupportAreas(prisma)} áreas de apoio`);
  }

  // Notebooks fictícios (com --salas-reais, ficam os reais, do import).
  for (const [i, nb] of REAL_ROOMS ? [] : NOTEBOOKS.entries()) {
    await prisma.notebook.create({ data: { assetTag: `PAT-${380120 + i * 7}`, model: nb.model, location: nb.location, notes: nb.notes ?? null } });
  }

  // Ocupação das salas (reservas aprovadas e bloqueios) para nada se sobrepor.
  const busy = new Map<string, [number, number][]>();
  const isFree = (room: string, start: Date, end: Date) =>
    (busy.get(room) ?? []).every(([s, e]) => end.getTime() <= s || start.getTime() >= e);
  const occupy = (room: string, start: Date, end: Date) => busy.set(room, [...(busy.get(room) ?? []), [start.getTime(), end.getTime()]]);

  // Dois bloqueios de manutenção nos próximos dias (aparecem na Agenda e em Salas livres).
  const upcoming = futureOpenDays(1);
  const blocks: [string, string, string, string, string][] = [
    ["Sala 103", upcoming[3] ?? openDays.at(-6)!, "08:00", "18:00", "Manutenção do ar-condicionado"],
    ["Sala 202", upcoming[9] ?? openDays.at(-3)!, "07:00", "12:00", "Troca do projetor"],
  ];
  for (const [room, day, s, e, reason] of blocks) {
    await prisma.roomBlock.create({ data: { roomId: roomByName.get(room)!.id, createdById: sadId, reason, startTime: at(day, s), endTime: at(day, e) } });
    occupy(room, at(day, s), at(day, e));
  }

  const nextProtocol = async (createdAt: Date) => {
    const [row] = await prisma.$queryRaw<{ n: bigint }[]>`SELECT nextval('reservation_protocol_seq') AS n`;
    return `${String(row!.n).padStart(6, "0")}/${dateKey(createdAt).slice(0, 4)}`;
  };
  const requested = (r: Request): Prisma.InputJsonValue =>
    (r.resources ?? []).map(([name, quantity, detail]) => ({ resourceId: resourceId.get(name)!, ...(quantity ? { quantity } : {}), ...(detail ? { detail } : {}) }));
  const base = (r: Request, start: Date, end: Date) => ({
    userId: uid(r.person),
    title: r.title.slice(0, 200),
    description: r.description,
    activityType: r.type,
    activityDetails: r.details as Prisma.InputJsonValue,
    expectedAttendees: r.attendees,
    requestedResources: requested(r),
    supportNotes: r.supportNotes ?? null,
    termsAccepted: true,
    noAlcoholCommitment: true,
    setupMinutes: r.setup ?? 0,
    startTime: start,
    endTime: end,
  });
  const checklist = { ccexAuthorized: true, academicDivisionApproved: true, feeSettled: true, directorateHomologated: false };
  let created = 0;

  // Séries semanais
  for (const s of SERIES) {
    const days = (s.pending ? futureOpenDays(7) : openDays).filter((d) => s.weekdays.includes(weekdayOf(d)));
    if (days.length === 0) continue;
    const createdAt = s.pending ? addDaysTo(now, -2) : addDaysTo(at(windowDays[0]!, "09:00"), -5);
    const firstStart = at(days[0]!, s.start);
    const series = await prisma.reservationSeries.create({
      data: {
        userId: uid(s.request.person), roomId: s.pending ? null : roomByName.get(s.room)!.id, title: s.request.title, description: s.request.description,
        rrule: `FREQ=WEEKLY;INTERVAL=1;BYDAY=${s.weekdays.map((w) => ["SU", "MO", "TU", "WE", "TH", "FR", "SA"][w]).join(",")}`,
        startTime: firstStart, endTime: addMinutes(firstStart, s.request.duration), untilDate: new Date(`${days.at(-1)}T00:00:00Z`), createdAt,
      },
    });
    const protocol = await nextProtocol(createdAt);
    for (const day of days) {
      const start = addMinutes(at(day, s.start), -(s.request.setup ?? 0));
      const end = addMinutes(at(day, s.start), s.request.duration);
      if (!s.pending && !isFree(s.room, start, end)) continue;
      if (!s.pending) occupy(s.room, start, end);
      await prisma.reservation.create({
        data: {
          ...base(s.request, start, end),
          protocol, seriesId: series.id, createdAt,
          ...(s.pending
            ? { status: "PENDING" as ReservationStatus }
            : {
                status: "APPROVED" as ReservationStatus, roomId: roomByName.get(s.room)!.id, reviewedById: sadId, reviewedAt: addDaysTo(createdAt, 1),
                approvalChecklist: s.request.type === "CULTURE_EXTENSION" ? checklist : undefined,
              }),
        },
      });
      created++;
    }
  }

  // Reuniões da Liga de Cardiologia nos primeiros dias do mês em que ninguém
  // apareceu: o Bruno chega a 3 ausências, a recorrência do Art. 9º §2º.
  const ligaRequest = culture("bruno", "LEAGUE", "Liga de Cardiologia — Reunião semanal", "LEAGUE", 20, "18:30 Discussão de artigos", { duration: 90 });
  for (const day of openDays.filter((d) => at(d, "20:00") < now).slice(0, 3)) {
    const start = at(day, "18:30");
    const end = at(day, "20:00");
    if (!isFree("Sala 203", start, end)) continue;
    occupy("Sala 203", start, end);
    const createdAt = addDaysTo(start, -6);
    await prisma.reservation.create({
      data: {
        ...base(ligaRequest, start, end), protocol: await nextProtocol(createdAt), createdAt, status: "APPROVED",
        roomId: roomByName.get("Sala 203")!.id, reviewedById: sadId, reviewedAt: addDaysTo(createdAt, 1), approvalChecklist: checklist,
        noShowAt: addMinutes(start, 30), noShowById: sadId,
      },
    });
    created++;
  }

  // Casos garantidos para a apresentação, sempre no futuro: um pedido de Cultura
  // e Extensão em análise, uma reserva alterada pelo solicitante e, para as
  // contas de teste, uma reserva aprovada e um pedido pendente.
  const highlight = async (r: Request, day: string | undefined, time: string, extra: Partial<Prisma.ReservationUncheckedCreateInput>) => {
    if (!day) return;
    const start = addMinutes(at(day, time), -(r.setup ?? 0));
    const end = addMinutes(at(day, time), r.duration);
    const createdAt = addDaysTo(now, -3);
    const room = extra.roomId ? ROOMS.find((x) => roomByName.get(x.name)?.id === extra.roomId)?.name : undefined;
    if (room) {
      if (!isFree(room, start, end)) return;
      occupy(room, start, end);
    }
    await prisma.reservation.create({ data: { ...base(r, start, end), protocol: await nextProtocol(createdAt), createdAt, ...extra } });
    created++;
  };
  await highlight(
    culture("camila", "CONGRESS", "Simpósio de Medicina Esportiva", "CAOC", 110, "08:30 Credenciamento\n09:00 Conferência de abertura\n10:30 Mesa-redonda", {
      duration: 210,
      setup: 60,
      resources: [["Sistema de Som"], ["Microfones", 3], ["Datashow/Projetor"]],
    }),
    futureOpenDays(5)[0],
    "08:30",
    { status: "PENDING" },
  );
  const modifiedDay = futureOpenDays(6)[1];
  await highlight(grad("docente", "DEM0172", "Fisiologia Renal", 36, "LECTURE", 2), modifiedDay, "10:00", {
    status: "PENDING",
    modifiedByRequesterAt: addMinutes(now, -180),
    previousSnapshot: modifiedDay
      ? {
          status: "APPROVED",
          startTime: addDaysTo(at(modifiedDay, "10:00"), -2).toISOString(),
          endTime: addDaysTo(at(modifiedDay, "12:00"), -2).toISOString(),
          roomId: null,
          roomName: roomText.get("Sala 202") ?? "Sala 202",
          expectedAttendees: 36,
          title: "DEM0172 — Fisiologia Renal",
        }
      : undefined,
  });
  await highlight(
    culture("aluno", "LEAGUE", "Liga de Neurologia — Reunião científica", "LEAGUE", 35, "19:00 Apresentação de casos", { duration: 120 }),
    futureOpenDays(2)[0],
    "19:00",
    { status: "APPROVED", roomId: roomByName.get("Sala 101")!.id, reviewedById: sadId, reviewedAt: addDaysTo(now, -2), approvalChecklist: checklist },
  );
  await highlight(
    culture("aluno", "LEAGUE", "Jornada de Neurologia", "LEAGUE", 60, "14:00 Palestras\n16:00 Casos clínicos", { duration: 180 }),
    futureOpenDays(8)[0],
    "14:00",
    { status: "PENDING" },
  );

  // Pedidos avulsos espalhados pela janela, com todas as situações.
  const target = Number(args.total ?? 100);
  let template = 0;
  let noShows = 0;
  let attempts = 0;
  while (created < target && attempts < 2000) {
    attempts++;
    const r = SINGLES[template % SINGLES.length]!;
    template++;
    const day = pick(openDays);
    const startTime = pick(r.starts);
    const start = addMinutes(at(day, startTime), -(r.setup ?? 0));
    const end = addMinutes(at(day, startTime), r.duration);
    if (dateKey(end) !== day || at(day, "22:00") < end || start < at(day, "07:00")) continue;
    const past = start <= now;
    const roll = random();
    const status: ReservationStatus | "MODIFIED" = past
      ? roll < 0.8 ? "APPROVED" : roll < 0.9 ? "CANCELLED" : "REJECTED"
      : roll < 0.5 ? "APPROVED" : roll < 0.75 ? "PENDING" : roll < 0.83 ? "MODIFIED" : roll < 0.91 ? "REJECTED" : "CANCELLED";
    const fits = r.rooms.filter((name) => (roomByName.get(name)?.capacity ?? 0) >= r.attendees);
    const room = status === "APPROVED" ? fits.find((name) => isFree(name, start, end)) : undefined;
    if (status === "APPROVED" && !room) continue;
    if (room) occupy(room, start, end);

    const createdAt = new Date(Math.min(addDaysTo(start, -(4 + Math.floor(random() * 12))).getTime(), addMinutes(now, -90).getTime()));
    const reviewedAt = new Date(Math.min(addDaysTo(createdAt, 1).getTime(), addMinutes(now, -30).getTime()));
    const protocol = await nextProtocol(createdAt);
    const data: Prisma.ReservationUncheckedCreateInput = { ...base(r, start, end), protocol, createdAt };
    switch (status) {
      case "APPROVED":
        Object.assign(data, { status, roomId: roomByName.get(room!)!.id, reviewedById: sadId, reviewedAt });
        if (r.type === "CULTURE_EXTENSION") data.approvalChecklist = checklist;
        // Mais duas ausências, de outras pessoas, em datas que já passaram.
        if (past && noShows < 2 && random() < 0.08) {
          Object.assign(data, { noShowAt: addMinutes(start, 30), noShowById: sadId });
          noShows++;
        }
        break;
      case "PENDING":
        data.status = "PENDING";
        break;
      case "MODIFIED": {
        const before = addDaysTo(start, -2);
        Object.assign(data, {
          status: "PENDING",
          modifiedByRequesterAt: addMinutes(now, -60 * (2 + Math.floor(random() * 40))),
          previousSnapshot: {
            status: "APPROVED",
            startTime: before.toISOString(),
            endTime: new Date(before.getTime() + (end.getTime() - start.getTime())).toISOString(),
            roomId: null,
            roomName: r.rooms[0] ? (roomText.get(r.rooms[0]) ?? r.rooms[0]) : null,
            expectedAttendees: r.attendees,
            title: r.title,
          },
        });
        break;
      }
      case "REJECTED":
        Object.assign(data, { status, rejectionReason: pick(REJECTIONS), reviewedById: sadId, reviewedAt });
        break;
      case "CANCELLED": {
        const bySad = random() < 0.4;
        Object.assign(data, {
          status, cancelledAt: reviewedAt, cancelledById: bySad ? sadId : uid(r.person), cancellationReason: bySad ? pick(SAD_CANCELS) : null,
        });
        break;
      }
    }
    await prisma.reservation.create({ data });
    created++;
  }

  // Uma reserva do SAD fora das portarias (domingo): aparece com o aviso na Agenda.
  const sunday = windowDays.find((d) => weekdayOf(d) === 0 && d >= shiftKey(today, 3));
  if (sunday && isFree("Teatro Principal", at(sunday, "08:00"), at(sunday, "13:00"))) {
    const createdAt = addDaysTo(now, -3);
    await prisma.reservation.create({
      data: {
        ...base(
          {
            person: "sad", type: "PUBLIC_EXAM", title: "Processo seletivo da Residência — aplicação da prova",
            details: { examTitle: "Processo seletivo da Residência — aplicação da prova", audience: 200, candidateCount: 190, responsible: PEOPLE.sad.name, department: "SAD", candidateNames: "Lista enviada pela comissão do processo seletivo" },
            description: "Aplicação da prova objetiva, autorizada pela Divisão Acadêmica.", attendees: 200, duration: 300, starts: ["08:00"], rooms: ["Teatro Principal"],
          },
          at(sunday, "08:00"),
          at(sunday, "13:00"),
        ),
        protocol: await nextProtocol(createdAt), createdAt, status: "APPROVED", roomId: roomByName.get("Teatro Principal")!.id,
        reviewedById: sadId, reviewedAt: createdAt, outsideRegularHours: true,
      },
    });
    created++;
  }

  // Fase 9: Graduação, Pós e Defesa são exclusivos de quem tem permissão. Quem
  // pediu esses tipos nesta base recebe a permissão correspondente (Cultura e
  // Extensão e Concurso já vêm no padrão de todo cadastro).
  const restricted: Record<string, Permission> = { UNDERGRADUATE: "REQUEST_UNDERGRADUATE", GRADUATE: "REQUEST_GRADUATE", DEFENSE: "REQUEST_DEFENSE" };
  const asked = await prisma.reservation.findMany({
    where: { activityType: { in: ["UNDERGRADUATE", "GRADUATE", "DEFENSE"] }, user: { role: "USER" } },
    select: { userId: true, activityType: true },
    distinct: ["userId", "activityType"],
  });
  const grants = new Map<string, Set<Permission>>();
  for (const a of asked) grants.set(a.userId, (grants.get(a.userId) ?? new Set()).add(restricted[a.activityType!]!));
  for (const [id, perms] of grants) {
    const user = await prisma.user.findUniqueOrThrow({ where: { id }, select: { permissions: true } });
    await prisma.user.update({ where: { id }, data: { permissions: sortPermissions([...user.permissions, ...perms]) } });
  }

  // Resumo, com o que a apresentação precisa ver no futuro.
  const counts = await prisma.reservation.groupBy({ by: ["status"], _count: true });
  const future = { startTime: { gt: now } };
  const [pendingFuture, approvedFuture, modifiedFuture, cultureFuture, seriesCount] = await Promise.all([
    prisma.reservation.count({ where: { ...future, status: "PENDING", modifiedByRequesterAt: null } }),
    prisma.reservation.count({ where: { ...future, status: "APPROVED" } }),
    prisma.reservation.count({ where: { ...future, status: "PENDING", modifiedByRequesterAt: { not: null } } }),
    prisma.reservation.count({ where: { ...future, status: "PENDING", activityType: "CULTURE_EXTENSION" } }),
    prisma.reservationSeries.count(),
  ]);
  console.log(`${created} reservas de ${windowLabel}:`, Object.fromEntries(counts.map((c) => [c.status, c._count])));
  console.log(
    `No futuro: ${pendingFuture} pedidos pendentes, ${approvedFuture} aprovadas, ${modifiedFuture} alteradas, ${cultureFuture} pedidos de Cultura e Extensão em análise; ${seriesCount} séries.`,
  );
  console.log(REAL_ROOMS ? "Base de demonstração pronta, nas salas reais." : "Base de demonstração pronta.");
}

main()
  .catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
