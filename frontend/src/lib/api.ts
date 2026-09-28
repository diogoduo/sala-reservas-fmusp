export interface ApiErrorBody {
  error: { code: string; message: string; details?: unknown };
}

/** Erro devolvido pela API no formato { error: { code, message, details? } }. */
export class ApiError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
    message: string,
    public readonly details?: unknown,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

/** Disparado quando a API pede o código de acesso da demonstração (ver AccessGate). */
export const ACCESS_REQUIRED_EVENT = "reservas:codigo-de-acesso";

export async function api<T>(path: string, init: RequestInit = {}): Promise<T> {
  const response = await fetch(`/api${path}`, {
    credentials: "include",
    ...init,
    headers: { "Content-Type": "application/json", ...init.headers },
  });

  if (!response.ok) {
    const body = (await response.json().catch(() => null)) as ApiErrorBody | null;
    if (body?.error.code === "ACCESS_CODE_REQUIRED") window.dispatchEvent(new Event(ACCESS_REQUIRED_EVENT));
    throw new ApiError(
      response.status,
      body?.error.code ?? "UNKNOWN",
      body?.error.message ?? "Não foi possível concluir a operação.",
      body?.error.details,
    );
  }

  return (response.status === 204 ? undefined : await response.json()) as T;
}
