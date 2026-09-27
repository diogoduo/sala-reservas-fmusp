import type { Prisma } from "@prisma/client";

/** Fotos de uma sala como a API devolve: na ordem da galeria (a primeira é a capa). */
export const roomPhotosInclude = {
  select: { id: true, caption: true, position: true, width: true, height: true },
  orderBy: [{ position: "asc" }, { createdAt: "asc" }],
} satisfies Prisma.Room$photosArgs;
