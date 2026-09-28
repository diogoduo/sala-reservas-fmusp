import { NotebookLocation } from "@prisma/client";
import { z } from "zod";

const optionalText = (max: number) => z.string().trim().max(max).nullish().transform((v) => v || null);

export const createNotebookSchema = z.object({
  assetTag: z.string().trim().min(1, "Informe o patrimônio.").max(60),
  model: optionalText(120),
  location: z.nativeEnum(NotebookLocation),
  notes: optionalText(500),
});

export const updateNotebookSchema = createNotebookSchema.partial();
