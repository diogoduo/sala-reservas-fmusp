-- Fase 17 — passagem de plantão: geral (resumo, pendências, prioridades, próximo
-- responsável, retrato do dia) e por evento (feito, por quem, pendente, situação).

-- CreateEnum
CREATE TYPE "handover_situation" AS ENUM ('ON_TRACK', 'ATTENTION', 'PROBLEM');

-- CreateTable
CREATE TABLE "shift_handovers" (
    "id" UUID NOT NULL,
    "date" DATE NOT NULL,
    "shift_label" TEXT,
    "summary" TEXT,
    "pending" TEXT,
    "priorities" TEXT,
    "next_responsible_id" UUID,
    "next_responsible_name" TEXT,
    "notes" TEXT,
    "snapshot" JSONB NOT NULL,
    "created_by_id" UUID,
    "created_by_name" TEXT NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "acknowledged_at" TIMESTAMPTZ(3),
    "acknowledged_by_name" TEXT,

    CONSTRAINT "shift_handovers_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "shift_handover_events" (
    "id" UUID NOT NULL,
    "handover_id" UUID NOT NULL,
    "event_id" UUID,
    "event_label" TEXT NOT NULL,
    "situation" "handover_situation" NOT NULL DEFAULT 'ON_TRACK',
    "done" TEXT,
    "done_by" TEXT,
    "pending" TEXT,
    "next_responsible_name" TEXT,
    "notes" TEXT,

    CONSTRAINT "shift_handover_events_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "shift_handovers_date_created_at_idx" ON "shift_handovers"("date", "created_at");

-- CreateIndex
CREATE INDEX "shift_handover_events_event_id_idx" ON "shift_handover_events"("event_id");

-- AddForeignKey
ALTER TABLE "shift_handovers" ADD CONSTRAINT "shift_handovers_next_responsible_id_fkey" FOREIGN KEY ("next_responsible_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "shift_handovers" ADD CONSTRAINT "shift_handovers_created_by_id_fkey" FOREIGN KEY ("created_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "shift_handover_events" ADD CONSTRAINT "shift_handover_events_handover_id_fkey" FOREIGN KEY ("handover_id") REFERENCES "shift_handovers"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "shift_handover_events" ADD CONSTRAINT "shift_handover_events_event_id_fkey" FOREIGN KEY ("event_id") REFERENCES "events"("id") ON DELETE SET NULL ON UPDATE CASCADE;

