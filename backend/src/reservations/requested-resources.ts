import type { Prisma } from "@prisma/client";
import { AppError } from "../lib/errors";

/**
 * Item de `reservations.requested_resources` (coluna JSONB). É `type` e não
 * `interface` para o Prisma aceitar direto como valor JSON.
 */
export type RequestedResource = {
  resourceId: string;
  /** Só em recursos com `requestsQuantity` (padrão 1). */
  quantity?: number;
  /** Só em recursos com `detailPrompt` (ex.: qual plataforma de webconferência). */
  detail?: string;
};

/** Lê a coluna JSONB, ignorando itens fora do formato esperado. */
export function parseRequestedResources(json: Prisma.JsonValue): RequestedResource[] {
  if (!Array.isArray(json)) return [];
  return json.flatMap((value) => {
    if (!value || typeof value !== "object" || Array.isArray(value)) return [];
    const item = value as Prisma.JsonObject;
    if (typeof item.resourceId !== "string") return [];
    return [
      {
        resourceId: item.resourceId,
        quantity: typeof item.quantity === "number" ? item.quantity : undefined,
        detail: typeof item.detail === "string" ? item.detail : undefined,
      },
    ];
  });
}

/**
 * Confere que os recursos pedidos existem e não se repetem, e guarda só o que
 * se aplica a cada um: quantidade (padrão 1) se o recurso pede quantidade,
 * detalhe se o recurso pede detalhe.
 */
export async function normalizeRequestedResources(
  db: Prisma.TransactionClient,
  requested: RequestedResource[],
): Promise<RequestedResource[]> {
  if (requested.length === 0) return [];

  const ids = requested.map((r) => r.resourceId);
  if (new Set(ids).size !== ids.length) {
    throw new AppError(400, "DUPLICATE_RESOURCE", "Cada recurso só pode ser pedido uma vez.");
  }

  const catalog = await db.resource.findMany({ where: { id: { in: ids } } });
  if (catalog.length !== ids.length) {
    throw new AppError(400, "RESOURCE_NOT_FOUND", "Um ou mais recursos solicitados não existem.");
  }
  const byId = new Map(catalog.map((r) => [r.id, r]));

  return requested.map(({ resourceId, quantity, detail }) => {
    const resource = byId.get(resourceId)!;
    return {
      resourceId,
      ...(resource.requestsQuantity ? { quantity: quantity ?? 1 } : {}),
      ...(resource.detailPrompt && detail ? { detail } : {}),
    };
  });
}
