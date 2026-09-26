import type { UserRole } from "@prisma/client";

// Estende o Request do Express com o usuário autenticado (preenchido pelo
// middleware `attachUser`). `req.user` fica ausente quando não há sessão.
declare global {
  namespace Express {
    interface Request {
      user?: {
        id: string;
        email: string;
        name: string;
        role: UserRole;
      };
    }
  }
}

export {};
