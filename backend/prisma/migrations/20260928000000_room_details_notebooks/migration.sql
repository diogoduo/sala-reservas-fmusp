-- Colunas de marcar da planilha "CHAVES - Cadeiras": tipo de cadeira, porta
-- de 900 mm e atendimento especial.
CREATE TYPE "seat_type" AS ENUM ('SCHOOL', 'UNIVERSITY_FIXED', 'UNIVERSITY_MOBILE');

ALTER TABLE "rooms" ADD COLUMN     "seat_types" "seat_type"[] DEFAULT ARRAY[]::"seat_type"[],
ADD COLUMN     "special_needs" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "wide_door" BOOLEAN NOT NULL DEFAULT false,
ALTER COLUMN "capacity" DROP NOT NULL;

-- Capacidade "a definir" (NULL) só em sala que não está Ativa, como uma sala
-- em reforma. Sala Ativa entra na alocação e precisa da capacidade.
-- (rooms_capacity_check, capacity > 0, continua valendo quando há valor.)
ALTER TABLE "rooms"
  ADD CONSTRAINT "rooms_active_capacity_check" CHECK ("status" <> 'ACTIVE' OR "capacity" IS NOT NULL);

-- Notebooks do SAD: backup no SAD ou transferidos para o NIT (TI da faculdade).
CREATE TYPE "notebook_location" AS ENUM ('SAD', 'NIT');

CREATE TABLE "notebooks" (
    "id" UUID NOT NULL,
    "asset_tag" TEXT NOT NULL,
    "model" TEXT,
    "location" "notebook_location" NOT NULL,
    "notes" TEXT,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "notebooks_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "notebooks_asset_tag_key" ON "notebooks"("asset_tag");
