import type { RoomPhoto } from "./types";

/** "thumb" (~720 px) para cards e miniaturas; "large" (~1920 px) para a galeria. */
export function photoUrl(photo: Pick<RoomPhoto, "id">, size: "thumb" | "large" = "thumb") {
  return `/api/fotos/${photo.id}-${size}.webp`;
}
