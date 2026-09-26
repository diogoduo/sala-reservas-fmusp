-- Formulários por tipo de atividade (Graduação, Pós, Cultura e Extensão,
-- Concurso, Defesa). Os campos de cada tipo ficam em activity_details (JSONB),
-- validados no back-end; nulos nas solicitações anteriores a esta migration.

CREATE TYPE "activity_type" AS ENUM ('UNDERGRADUATE', 'GRADUATE', 'CULTURE_EXTENSION', 'PUBLIC_EXAM', 'DEFENSE');

ALTER TABLE "reservations"
  ADD COLUMN "activity_type" "activity_type",
  ADD COLUMN "activity_details" JSONB;
