/**
 * Carrega o catálogo real de salas da FMUSP (salas, cadeiras, dimensões, o
 * inventário de equipamentos com modelo e patrimônio, e as fotos) a partir de
 * prisma/data/fmusp.json e da pasta de fotos FM/ na raiz do projeto.
 *
 * Nada disso fica no git: são dados internos da faculdade, montados a partir
 * das planilhas "CHAVES" do SAD. Sem eles, o projeto roda com as salas
 * fictícias do seed.
 *
 *   npm run db:import-fmusp                        (prisma/data/fmusp.json + ../FM)
 *   npm run db:import-fmusp -- outro.json --fotos=C:/fotos
 *   npm run db:import-fmusp -- --sem-fotos
 *
 * Idempotente: sala é identificada por prédio + andar + nome. O inventário de
 * cada sala importada é substituído pelo da planilha; o status (Ativa/Em
 * manutenção/Inativa) de uma sala que já existe é preservado. Foto já
 * importada (mesmo arquivo de origem) não é importada de novo.
 */
import { randomUUID } from "node:crypto";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { PrismaClient, RoomStatus, RoomType } from "@prisma/client";
import { writePhotoFiles } from "../src/photos/storage";

interface EquipmentItem {
  resource: string;
  model: string | null;
  assetTags: string | null;
  quantity: number;
}

/** Fotos de uma pasta de FM/. `match` filtra os arquivos (regex); `caption` vira prefixo da legenda. */
interface PhotoSource {
  folder: string;
  match?: string;
  caption?: string;
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
  photos?: PhotoSource[];
}

interface FmuspData {
  retireRooms: { building: string; floor: string; name: string }[];
  resources: { name: string; description: string | null; requestable: boolean }[];
  rooms: RoomData[];
}

const prisma = new PrismaClient();

const args = process.argv.slice(2);
const dataFile = path.resolve(args.find((a) => !a.startsWith("--")) ?? path.join(__dirname, "data", "fmusp.json"));
const photosDir = path.resolve(args.find((a) => a.startsWith("--fotos="))?.slice("--fotos=".length) ?? path.join(__dirname, "..", "..", "FM"));
const skipPhotos = args.includes("--sem-fotos");

function loadData(): FmuspData {
  if (!existsSync(dataFile)) {
    console.error(`Arquivo não encontrado: ${dataFile}\nOs dados reais da FMUSP não ficam no repositório.`);
    process.exit(1);
  }
  return JSON.parse(readFileSync(dataFile, "utf8")) as FmuspData;
}

// ---------------------------------------------------------------------------
// Legendas a partir do nome do arquivo: "1104_PROJETOR_LONGE.JPG" → "Projetor (de longe)"
// ---------------------------------------------------------------------------

const WORDS: Record<string, string> = {
  CADEIRAS: "cadeiras",
  PORTA: "porta",
  PROJETOR: "projetor",
  TV: "TV",
  PC: "computador",
  "MICROSCÓPIO": "microscópio",
  BANHEIRO: "banheiro",
  PROFUNDIDADE: "vista do fundo",
  ENTRADA: "entrada",
  TELA: "tela",
  QUADRO: "quadro",
};
const MODIFIERS: Record<string, string> = { LONGE: "de longe", PERTO: "de perto" };

/** Partes do nome depois do código da sala ("2366_68_V1" → ["V1"]). */
function nameTokens(file: string) {
  const tokens = path.parse(file).name.normalize("NFC").toUpperCase().split("_").slice(1);
  if (tokens[0] === "68") tokens.shift();
  return tokens;
}

function captionFromFile(file: string): string | null {
  const parts: string[] = [];
  for (const token of nameTokens(file)) {
    const modifier = MODIFIERS[token];
    if (modifier && parts.length > 0) {
      parts[parts.length - 1] += ` (${modifier})`;
    } else if (/^V\d+$/.test(token)) {
      parts.push(`vista ${token.slice(1)}`);
    } else {
      const [, word = token, number] = token.match(/^(.*?)(\d*)$/) ?? [];
      const label = WORDS[word] ?? word.toLowerCase();
      parts.push(number ? `${label} (${number})` : label);
    }
  }
  if (parts.length === 0) return null;
  const text = parts.length === 1 ? parts[0]! : `${parts.slice(0, -1).join(", ")} e ${parts.at(-1)}`;
  return text.charAt(0).toUpperCase() + text.slice(1);
}

/** A capa deve mostrar a sala: cadeiras/vista geral primeiro, porta e banheiro por último. */
function coverScore(file: string) {
  const first = nameTokens(file)[0] ?? "";
  if (first.startsWith("CADEIRAS") || first === "V1") return 0;
  if (/^V\d+$/.test(first)) return 1;
  if (["PROJETOR", "TV", "PC", "TELA"].includes(first)) return 2;
  if (first === "PORTA") return 4;
  if (first === "BANHEIRO") return 5;
  return 3;
}

async function importPhotos(data: FmuspData) {
  if (skipPhotos) return;
  if (!existsSync(photosDir)) {
    console.log(`Pasta de fotos não encontrada (${photosDir}); salas importadas sem fotos.`);
    return;
  }

  let added = 0;
  for (const room of data.rooms) {
    if (!room.photos?.length) continue;
    const row = await prisma.room.findUniqueOrThrow({
      where: { building_floor_name: { building: room.building, floor: room.floor, name: room.name } },
      select: { id: true, photos: { select: { sourceName: true, position: true } } },
    });
    const already = new Set(row.photos.map((p) => p.sourceName));
    let position = row.photos.reduce((max, p) => Math.max(max, p.position), -1) + 1;

    // Fotos próprias da sala primeiro, depois as compartilhadas (ex.: "1366 A e B integradas").
    const files = room.photos.flatMap((source) => {
      const dir = path.join(photosDir, source.folder);
      if (!existsSync(dir)) {
        console.warn(`  ${room.name}: pasta "${source.folder}" não encontrada`);
        return [];
      }
      const pattern = source.match ? new RegExp(source.match, "i") : null;
      return readdirSync(dir)
        .filter((file) => /\.(jpe?g|png|webp)$/i.test(file) && (!pattern || pattern.test(file)))
        .sort((a, b) => coverScore(a) - coverScore(b) || a.localeCompare(b))
        .map((file) => ({ source, file, sourceName: `${source.folder}/${file}` }));
    });

    let roomAdded = 0;
    for (const { source, file, sourceName } of files) {
      if (already.has(sourceName)) continue;
      const id = randomUUID();
      const { width, height } = await writePhotoFiles(id, path.join(photosDir, source.folder, file));
      const caption = [source.caption, captionFromFile(file)].filter(Boolean).join(" · ") || null;
      await prisma.roomPhoto.create({ data: { id, roomId: row.id, caption, width, height, position: position++, sourceName } });
      roomAdded++;
    }
    if (roomAdded > 0) console.log(`  ${room.name}: ${roomAdded} foto(s)`);
    added += roomAdded;
  }
  console.log(`Fotos: ${added} importada(s).`);
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

  // Fora da transação: gerar as versões das fotos leva alguns segundos por foto.
  await importPhotos(data);
}

main()
  .catch((error) => {
    console.error(error);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
