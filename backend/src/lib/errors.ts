/**
 * Erro de negócio com código estável (para o front tratar) e mensagem amigável
 * em português. Ex.: BOOKING_TOO_SOON, OUTSIDE_BUSINESS_HOURS,
 * RESERVATION_CONFLICT, RESERVATION_IN_PAST, EMAIL_DOMAIN_NOT_ALLOWED.
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
