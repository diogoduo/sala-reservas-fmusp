/**
 * Áreas de apoio e salas de coffee break da FMUSP (Fase 9, bloco 3), a partir
 * do documento de requisitos SAD/NUCEV (§6) e da Portaria 2794 (Arts. 3º e 5º).
 * Usado pelo import das salas reais, pela base de demonstração e por
 * `npm run db:espacos` (para um banco que já tem as salas importadas).
 *
 * Só cria o que falta: área de apoio que já existe (mesmo prédio, andar e
 * nome) fica como o SAD deixou. Nada aqui é dado interno: são os espaços e as
 * regras que o próprio documento lista.
 */
import { Prisma, PrismaClient, RoomType } from "@prisma/client";

type Db = PrismaClient | Prisma.TransactionClient;

export interface SupportArea {
  name: string;
  building: string;
  floor: string;
  /** null = sem limite cadastrado (ex.: átrio). */
  capacity: number | null;
  coffeeAllowed: boolean;
  recommendedAbove?: number;
  requiresBoardApproval?: boolean;
  usageRules?: string;
}

const ATRIUM_RULES =
  "Uso regulado pela Portaria FMUSP nº 2747/2025, com autorização da Diretoria Executiva. Indicado para eventos com mais de 250 pessoas.";
const PANTRY_RULES = "Apoio ao coffee break e ao buffet; não recebe público.";

export const SUPPORT_AREAS: SupportArea[] = [
  { name: "Átrio esquerdo (SVO)", building: "Prédio Principal", floor: "Térreo", capacity: null, coffeeAllowed: true, recommendedAbove: 250, requiresBoardApproval: true, usageRules: ATRIUM_RULES },
  { name: "Átrio do relógio de ponto", building: "Prédio Principal", floor: "Térreo", capacity: null, coffeeAllowed: true, recommendedAbove: 250, requiresBoardApproval: true, usageRules: ATRIUM_RULES },
  { name: "Hall de transição do 4º andar", building: "Prédio Principal", floor: "4º andar", capacity: 60, coffeeAllowed: true },
  { name: "Área de coffee do 5º andar", building: "Prédio Principal", floor: "5º andar", capacity: 250, coffeeAllowed: true },
  { name: "Copa do 5º andar", building: "Prédio Principal", floor: "5º andar", capacity: null, coffeeAllowed: false, usageRules: PANTRY_RULES },
  { name: "Hall do Teatro", building: "Teatro", floor: "1º andar", capacity: 255, coffeeAllowed: true },
  { name: "Copa do Teatro", building: "Teatro", floor: "1º andar", capacity: null, coffeeAllowed: false, usageRules: PANTRY_RULES },
  { name: "Hall do NINA", building: "Instituto Oscar Freire (IOF)", floor: "2º andar", capacity: 100, coffeeAllowed: true },
];

/** Portaria 2794, Art. 5º §1º: salas de aula de uso interativo, que podem ter coffee break. */
export const COFFEE_ROOM_NAME = /(^|\D)(2366|2368|2223|1357)(\D|$)/;
export const COFFEE_ROOM_RULES =
  "Coffee break só com autorização do Núcleo de Eventos, com adicional de 20% sobre o valor da sala (Portaria 2794, Art. 5º).";

/** O que uma sala nova recebe pelo nome: as de coffee break já vêm marcadas. */
export function coffeeDefaults(name: string) {
  return COFFEE_ROOM_NAME.test(name) ? { coffeeAllowed: true, usageRules: COFFEE_ROOM_RULES } : {};
}

/** Cria as áreas de apoio que faltam. Devolve quantas criou. */
export async function createMissingSupportAreas(db: Db): Promise<number> {
  let created = 0;
  for (const area of SUPPORT_AREAS) {
    const key = { building: area.building, floor: area.floor, name: area.name };
    if (await db.room.findUnique({ where: { building_floor_name: key }, select: { id: true } })) continue;
    await db.room.create({
      data: {
        ...key,
        roomType: RoomType.SUPPORT_AREA,
        capacity: area.capacity,
        coffeeAllowed: area.coffeeAllowed,
        recommendedAbove: area.recommendedAbove ?? null,
        requiresBoardApproval: area.requiresBoardApproval ?? false,
        usageRules: area.usageRules ?? null,
      },
    });
    created++;
  }
  return created;
}

// `npm run db:espacos`: só cria as áreas de apoio que faltam (não apaga nem muda nada).
if (require.main === module) {
  const prisma = new PrismaClient();
  createMissingSupportAreas(prisma)
    .then((created) => console.log(`Áreas de apoio: ${created} criada(s); as que já existiam ficaram como estavam.`))
    .catch((error) => {
      console.error(error);
      process.exit(1);
    })
    .finally(() => prisma.$disconnect());
}
