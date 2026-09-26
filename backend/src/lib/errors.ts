/**
 * Erro de negócio com código estável (para o front tratar) e mensagem amigável
 * em português. Códigos previstos para as próximas fases:
 *   BOOKING_TOO_SOON, OUTSIDE_BUSINESS_HOURS, DURATION_OUT_OF_RANGE,
 *   CAPACITY_EXCEEDED, ROOM_UNAVAILABLE, EMAIL_DOMAIN_NOT_ALLOWED, ...
 */
export class AppError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
    message: string,
    public readonly details?: unknown,
  ) {
    super(message);
    this.name = "AppError";
  }
}
