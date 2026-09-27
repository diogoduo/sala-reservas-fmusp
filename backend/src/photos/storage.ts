import { mkdir, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import sharp from "sharp";
import { env } from "../config/env";
import { AppError } from "../lib/errors";

/**
 * Fotos das salas em disco. Cada foto vira duas versões webp, com o id como
 * nome: "thumb" (cards e miniaturas) e "large" (galeria em tela cheia). As
 * originais das câmeras (6000×4000, ~6 MB) não são guardadas.
 *
 * O nome nunca é reaproveitado (foto nova = id novo), então os arquivos podem
 * ser servidos com cache "immutable".
 */
export const PHOTO_DIR = path.resolve(env.PHOTO_STORAGE_DIR);

const SIZES = {
  thumb: { max: 720, quality: 72 },
  large: { max: 1920, quality: 80 },
} as const;

type PhotoSize = keyof typeof SIZES;

const fileOf = (id: string, size: PhotoSize) => path.join(PHOTO_DIR, `${id}-${size}.webp`);

/** Gera e grava as versões da foto. Devolve as dimensões da versão grande (para o layout reservar o espaço). */
export async function writePhotoFiles(id: string, input: Buffer | string): Promise<{ width: number; height: number }> {
  // rotate() sem argumento aplica a orientação do EXIF (foto tirada com o celular em pé).
  const source = sharp(input, { failOn: "error" }).rotate();
  try {
    await source.metadata();
  } catch {
    throw new AppError(400, "INVALID_IMAGE", "O arquivo enviado não é uma imagem válida.");
  }

  await mkdir(PHOTO_DIR, { recursive: true });
  let large = { width: 0, height: 0 };
  try {
    for (const size of Object.keys(SIZES) as PhotoSize[]) {
      const { max, quality } = SIZES[size];
      const { data, info } = await source
        .clone()
        .resize({ width: max, height: max, fit: "inside", withoutEnlargement: true })
        .webp({ quality })
        .toBuffer({ resolveWithObject: true });
      await writeFile(fileOf(id, size), data);
      if (size === "large") large = { width: info.width, height: info.height };
    }
  } catch {
    // Ex.: JPEG cortado no meio — o cabeçalho é lido, mas a imagem não decodifica.
    await removePhotoFiles(id);
    throw new AppError(400, "INVALID_IMAGE", "Não foi possível ler a imagem. O arquivo pode estar corrompido.");
  }
  return large;
}

export async function removePhotoFiles(id: string) {
  await Promise.all((Object.keys(SIZES) as PhotoSize[]).map((size) => rm(fileOf(id, size), { force: true })));
}
