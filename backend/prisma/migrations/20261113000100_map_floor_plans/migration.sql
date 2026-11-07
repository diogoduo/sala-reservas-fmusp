-- Mapa 3D: a planta tratada de cada andar (paredes em branco), usada como piso.

-- CreateTable
CREATE TABLE "map_floor_plans" (
    "id" UUID NOT NULL,
    "building_id" UUID NOT NULL,
    "floor" TEXT NOT NULL,
    "image" BYTEA NOT NULL,
    "mime_type" TEXT NOT NULL,
    "bounds" JSONB NOT NULL,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "map_floor_plans_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "map_floor_plans_building_id_floor_key" ON "map_floor_plans"("building_id", "floor");

-- AddForeignKey
ALTER TABLE "map_floor_plans" ADD CONSTRAINT "map_floor_plans_building_id_fkey" FOREIGN KEY ("building_id") REFERENCES "map_buildings"("id") ON DELETE CASCADE ON UPDATE CASCADE;

