-- Fase 16 (ajuste): quem pediu o evento informa palestrantes, participantes e
-- veículos (placas para a liberação de vagas), antes ou depois da confirmação.

-- AlterTable
ALTER TABLE "event_people" ADD COLUMN     "added_by_name" TEXT;

-- CreateTable
CREATE TABLE "event_vehicles" (
    "id" UUID NOT NULL,
    "event_id" UUID NOT NULL,
    "plate" TEXT NOT NULL,
    "model" TEXT,
    "driver" TEXT,
    "notes" TEXT,
    "added_by_name" TEXT,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "event_vehicles_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "event_vehicles_event_id_plate_key" ON "event_vehicles"("event_id", "plate");

-- AddForeignKey
ALTER TABLE "event_vehicles" ADD CONSTRAINT "event_vehicles_event_id_fkey" FOREIGN KEY ("event_id") REFERENCES "events"("id") ON DELETE CASCADE ON UPDATE CASCADE;


-- Placa no formato antigo (ABC1234) ou Mercosul (ABC1D23), sem traço.
ALTER TABLE "event_vehicles" ADD CONSTRAINT "event_vehicles_plate_check" CHECK ("plate" ~ '^[A-Z]{3}[0-9][A-Z0-9][0-9]{2}$');
