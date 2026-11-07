-- Mapa 3D da faculdade: prédios (posição, contorno dos andares, escadas, elevadores e
-- acessos) e a posição de cada sala no andar. Os dados vêm de prisma/data/campus-map.json
-- (fora do git), pelo npm run db:mapa.

-- AlterTable
ALTER TABLE "rooms" ADD COLUMN     "map_x" DOUBLE PRECISION,
ADD COLUMN     "map_y" DOUBLE PRECISION;

-- CreateTable
CREATE TABLE "map_buildings" (
    "id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "x" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "y" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "color" TEXT,
    "floors" JSONB NOT NULL,
    "landmarks" JSONB NOT NULL,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "map_buildings_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "map_buildings_name_key" ON "map_buildings"("name");

