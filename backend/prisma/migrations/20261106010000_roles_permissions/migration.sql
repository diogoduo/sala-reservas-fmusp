-- Fase 9 — Perfis e permissões.
-- Papel NUCEV (Núcleo de Eventos) e as permissões que o SAD concede a cada
-- pessoa: pedir Graduação, Pós-Graduação e Defesa passa a ser exclusivo de quem
-- tem a permissão. As reservas que já existem continuam valendo; ninguém recebe
-- permissão automaticamente (o SAD concede na tela Pessoas).

ALTER TYPE "user_role" ADD VALUE 'NUCEV';

CREATE TYPE "permission" AS ENUM ('REQUEST_UNDERGRADUATE', 'REQUEST_GRADUATE', 'REQUEST_DEFENSE');

ALTER TABLE "users" ADD COLUMN "permissions" "permission"[] DEFAULT ARRAY[]::"permission"[];
