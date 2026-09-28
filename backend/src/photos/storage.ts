import sharp from "sharp";
import { AppError } from "../lib/errors";

/**
 * Fotos das salas. Cada foto vira duas versões webp, guardadas no banco
 * (room_photos.thumb / .large): "thumb" para cards e miniaturas, "large" para
 * a galeria em tela cheia. As originais das câmeras (6000×4000, ~6 MB) não são
 * guardadas.
 *
 * O id nunca é reaproveitado (foto nova = id novo), então as versões podem ser
 * servidas com cache "immutable".
 */
const SIZES = {
  thumb: { max: 720, quality: 72 },
  large: { max: 1920, quality: 80 },
} as const;

export type PhotoSize = keyof typeof SIZES;

export interface PhotoVersions {
  thumb: Uint8Array<ArrayBuffer>;
  large: Uint8Array<ArrayBuffer>;
  /** Dimensões da versão grande, para o layout reservar o espaço antes de carregar. */
  width: number;
  height: number;
}

export async function renderPhotoVersions(input: Buffer | string): Promise<PhotoVersions> {
  // rotate() sem argumento aplica a orientação do EXIF (foto tirada com o celular em pé).
  const source = sharp(input, { failOn: "error" }).rotate();
  try {
    await source.metadata();
  } catch {
    throw new AppError(400, "INVALID_IMAGE", "O arquivo enviado não é uma imagem válida.");
  }

  const render = (size: PhotoSize) =>
    source
      .clone()
      .resize({ width: SIZES[size].max, height: SIZES[size].max, fit: "inside", withoutEnlargement: true })
      .webp({ quality: SIZES[size].quality })
      .toBuffer({ resolveWithObject: true });

  try {
    const [thumb, large] = await Promise.all([render("thumb"), render("large")]);
    // new Uint8Array(buffer): cópia com ArrayBuffer próprio, o tipo que o Prisma espera em colunas Bytes.
    return { thumb: new Uint8Array(thumb.data), large: new Uint8Array(large.data), width: large.info.width, height: large.info.height };
  } catch {
    // Ex.: JPEG cortado no meio — o cabeçalho é lido, mas a imagem não decodifica.
    throw new AppError(400, "INVALID_IMAGE", "Não foi possível ler a imagem. O arquivo pode estar corrompido.");
  }
}
