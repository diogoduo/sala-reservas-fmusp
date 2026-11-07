/**
 * Mapa 3D da faculdade: lê prisma/data/campus-map.json (fora do git, tirado das
 * plantas) e grava os prédios (posição, contorno dos andares, escadas, elevadores
 * e acessos) e a posição das salas. Pode rodar de novo: só atualiza.
 *
 *   npm run db:mapa                 (usa prisma/data/campus-map.json)
 *   npm run db:mapa -- --arquivo=…  (outro arquivo)
 *
 * Não apaga nada: salas que não estão no arquivo ficam com a posição que têm
 * (ou automática, no andar delas).
 */
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { PrismaClient, type Prisma } from "@prisma/client";
import sharp from "sharp";

interface Rect { x: number; y: number; w: number; h: number; label?: string }
interface Landmark { floor: string; kind: "STAIRS" | "ELEVATOR" | "ENTRANCE" | "RESTROOM"; label: string; x: number; y: number }
interface MapFile {
  scale: number;
  floorOffsets?: Record<string, [number, number]>;
  buildings: { name: string; x: number; y: number; color?: string; floors: Record<string, Rect[]>; landmarks: Landmark[] }[];
  rooms: ({ number: string; x: number; y: number } | { name: string; x: number; y: number })[];
  /** Plantas renderizadas (PNG): o recorte é em pixels da planta a 2000 px de largura. */
  plans?: { building: string; floor: string; file: string; renderWidth: number; crop: [number, number, number, number] }[];
}

/** "Sala de Reunião 2107-A" termina em "2107-A" (e não em "2107"); espaços e traços não contam. */
function endsWithNumber(name: string, number: string) {
  const norm = (v: string) => v.toUpperCase().replace(/[\s-]+/g, "");
  const n = norm(name);
  const want = norm(number);
  return n.endsWith(want) && !/\d/.test(n.charAt(n.length - want.length - 1));
}

export async function importCampusMap(prisma: PrismaClient, file = path.join(__dirname, "data", "campus-map.json")) {
  const map = JSON.parse(readFileSync(file, "utf8")) as MapFile;
  const k = map.scale;
  const offset = (building: string, floor: string) => map.floorOffsets?.[`${building}|${floor}`] ?? [0, 0];
  const round = (v: number) => Math.round(v * 100) / 100;

  for (const b of map.buildings) {
    const floors = Object.fromEntries(
      Object.entries(b.floors).map(([floor, rects]) => {
        const [dx, dy] = offset(b.name, floor);
        return [floor, rects.map((r) => ({ x: round((r.x + dx) * k), y: round((r.y + dy) * k), w: round(r.w * k), h: round(r.h * k), label: r.label ?? null }))];
      }),
    );
    const landmarks = b.landmarks.map((l) => {
      const [dx, dy] = l.floor === "*" ? [0, 0] : offset(b.name, l.floor);
      return { ...l, x: round((l.x + dx) * k), y: round((l.y + dy) * k) };
    });
    const data = { x: round(b.x * k), y: round(b.y * k), color: b.color ?? null, floors: floors as Prisma.InputJsonValue, landmarks: landmarks as Prisma.InputJsonValue };
    await prisma.mapBuilding.upsert({ where: { name: b.name }, update: data, create: { name: b.name, ...data } });
  }

  const rooms = await prisma.room.findMany({ select: { id: true, name: true, building: true, floor: true } });
  const missing: string[] = [];
  let placed = 0;
  for (const entry of map.rooms) {
    const room =
      "name" in entry
        ? rooms.find((r) => r.name === entry.name)
        : rooms.find((r) => endsWithNumber(r.name, entry.number));
    if (!room) {
      missing.push("name" in entry ? entry.name : entry.number);
      continue;
    }
    const [dx, dy] = offset(room.building, room.floor);
    await prisma.room.update({ where: { id: room.id }, data: { mapX: round((entry.x + dx) * k), mapY: round((entry.y + dy) * k) } });
    placed++;
  }
  // As plantas: recorta o prédio, tira as anotações (vermelho) e as rotas de fuga
  // (roxo) e deixa só as paredes, em branco sobre transparente.
  let plans = 0;
  for (const plan of map.plans ?? []) {
    const building = await prisma.mapBuilding.findUnique({ where: { name: plan.building } });
    const source = path.join(path.dirname(file), plan.file);
    if (!building || !existsSync(source)) continue;
    const f = plan.renderWidth / 2000;
    const [dx, dy] = offset(plan.building, plan.floor);
    const [cx, cy, cw, ch] = plan.crop;
    // O andar desenhado deslocado: o recorte acompanha, para todos os andares caírem no mesmo lugar.
    const left = Math.round((cx - dx) * f);
    const top = Math.round((cy - dy) * f);
    const { data, info } = await sharp(source).extract({ left, top, width: Math.round(cw * f), height: Math.round(ch * f) }).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
    const out = Buffer.alloc(info.width * info.height * 4);
    for (let i = 0; i < data.length; i += 4) {
      const [r, g, b] = [data[i]!, data[i + 1]!, data[i + 2]!];
      const annotation = (r > 140 && g < 120 && b < 120) || (b > 120 && b > g + 35 && r > 80);
      const lum = 0.299 * r + 0.587 * g + 0.114 * b;
      const alpha = annotation || lum > 170 ? 0 : Math.min(255, Math.round((200 - lum) * 1.6));
      out[i] = 255;
      out[i + 1] = 255;
      out[i + 2] = 255;
      out[i + 3] = alpha;
    }
    const image = await sharp(out, { raw: { width: info.width, height: info.height, channels: 4 } })
      .resize({ width: Math.min(info.width, 2600) })
      .webp({ quality: 82, alphaQuality: 90 })
      .toBuffer();
    const bounds = { x: round(cx * k), y: round(cy * k), w: round(cw * k), h: round(ch * k) };
    await prisma.mapFloorPlan.upsert({
      where: { buildingId_floor: { buildingId: building.id, floor: plan.floor } },
      update: { image, mimeType: "image/webp", bounds },
      create: { buildingId: building.id, floor: plan.floor, image, mimeType: "image/webp", bounds },
    });
    plans++;
  }
  return { buildings: map.buildings.length, placed, missing, plans };
}

if (require.main === module) {
  const arg = process.argv.find((a) => a.startsWith("--arquivo="));
  const prisma = new PrismaClient();
  importCampusMap(prisma, arg ? path.resolve(arg.split("=")[1]!) : undefined)
    .then((r) => {
      console.log(`Mapa: ${r.buildings} prédio(s), ${r.placed} sala(s) posicionada(s), ${r.plans} planta(s).`);
      if (r.missing.length) console.log(`Sem sala correspondente no banco (ficam de fora): ${r.missing.join(", ")}`);
    })
    .catch((e) => {
      console.error(e);
      process.exit(1);
    })
    .finally(() => prisma.$disconnect());
}
