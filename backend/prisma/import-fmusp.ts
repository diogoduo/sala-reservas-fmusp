/**
 * Carrega o catálogo real de salas da FMUSP (salas, cadeiras, dimensões e o
 * inventário de equipamentos com modelo e patrimônio) a partir de
 * prisma/data/fmusp.json.
 *
 * Esse arquivo NÃO fica no git: são dados internos da faculdade, montados a
 * partir das planilhas "CHAVES" do SAD. Sem ele, o projeto roda com as salas
 * fictícias do seed.
 *
 *   npm run db:import-fmusp            (usa prisma/data/fmusp.json)
 *   npm run db:import-fmusp -- outro.json
 *
 * Idempotente: sala é identificada por prédio + andar + nome. O inventário de
 * cada sala importada é substituído pelo da planilha; o status (Ativa/Em
 * manutenção/Inativa) de uma sala que já existe é preservado.
 */
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { PrismaClient, RoomStatus, RoomType } from "@prisma/client";

interface EquipmentItem {
  resource: string;
  model: string | null;
  assetTags: string | null;
  quantity: number;
}

interface RoomData {
  code: string;
  name: string;
  building: string;
  floor: string;
  type: RoomType;
  capacity: number;
  extraSeats?: number;
  dimensions?: string;
  equipmentNotes?: string;
  equipment: EquipmentItem[];
}

interface FmuspData {
  retireRooms: { building: string; floor: string; name: string }[];
  resources: { name: string; description: string | null; requestable: boolean }[];
  rooms: RoomData[];
}

const prisma = new PrismaClient();

function loadData(): FmuspData {
  const file = path.resolve(process.argv[2] ?? path.join(__dirname, "data", "fmusp.json"));
  if (!existsSync(file)) {
    console.error(`Arquivo não encontrado: ${file}\nOs dados reais da FMUSP não ficam no repositório.`);
    process.exit(1);
  }
  return JSON.parse(readFileSync(file, "utf8")) as FmuspData;
}

async function main() {
  const data = loadData();

  const summary = await prisma.$transaction(
    async (tx) => {
      // Tipos de recurso novos (nobreak, monitor…). Os que já existem mantêm a
      // descrição e as opções que o SAD configurou; só `requestable` é ajustado.
      for (const resource of data.resources) {
        await tx.resource.upsert({
          where: { name: resource.name },
          update: { requestable: resource.requestable },
          create: resource,
        });
      }

      const resourceIds = new Map((await tx.resource.findMany({ select: { id: true, name: true } })).map((r) => [r.name, r.id]));
      const missing = [...new Set(data.rooms.flatMap((room) => room.equipment.map((item) => item.resource)))].filter(
        (name) => !resourceIds.has(name),
      );
      if (missing.length > 0) throw new Error(`Recursos não cadastrados: ${missing.join(", ")}`);

      let created = 0;
      let updated = 0;
      for (const room of data.rooms) {
        const key = { building: room.building, floor: room.floor, name: room.name };
        const fields = {
          capacity: room.capacity,
          roomType: room.type,
          extraSeats: room.extraSeats ?? null,
          dimensions: room.dimensions ?? null,
          equipmentNotes: room.equipmentNotes ?? null,
        };
        const existing = await tx.room.findUnique({ where: { building_floor_name: key }, select: { id: true } });
        const row = existing
          ? await tx.room.update({ where: { id: existing.id }, data: fields })
          : await tx.room.create({ data: { ...key, ...fields, status: RoomStatus.ACTIVE } });
        if (existing) updated++;
        else created++;

        await tx.roomResource.deleteMany({ where: { roomId: row.id } });
        await tx.roomResource.createMany({
          data: room.equipment.map((item) => ({
            roomId: row.id,
            resourceId: resourceIds.get(item.resource)!,
            quantity: item.quantity,
            model: item.model,
            assetTags: item.assetTags,
          })),
        });
      }

      // Salas fictícias do seed: podem ter reservas de teste, então ficam Inativas em vez de excluídas.
      const retired = await tx.room.updateMany({
        where: { OR: data.retireRooms, status: { not: RoomStatus.INACTIVE } },
        data: { status: RoomStatus.INACTIVE },
      });

      return { created, updated, retired: retired.count };
    },
    { timeout: 60_000 },
  );

  const items = data.rooms.reduce((sum, room) => sum + room.equipment.length, 0);
  console.log(
    `Salas: ${summary.created} criadas, ${summary.updated} atualizadas; ${items} itens de inventário; ` +
      `${summary.retired} sala(s) fictícia(s) marcada(s) como Inativa.`,
  );
}

main()
  .catch((error) => {
    console.error(error);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
