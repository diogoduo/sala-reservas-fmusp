-- Fase 16 — organização do evento confirmado (documento SAD/NUCEV, 5.1):
-- logística (buffet, estacionamento, estrutura, equipamentos), programação,
-- pessoas (organização, palestrantes, participantes), pendências da equipe
-- (operational_tasks, que o checklist da Fase 17 também usa) e o encerramento.

-- CreateEnum
CREATE TYPE "event_person_kind" AS ENUM ('ORGANIZER', 'SPEAKER', 'PARTICIPANT');

-- CreateEnum
CREATE TYPE "task_status" AS ENUM ('OPEN', 'DONE');

-- AlterTable
ALTER TABLE "events" ADD COLUMN     "actual_attendees" INTEGER,
ADD COLUMN     "closed_at" TIMESTAMPTZ(3),
ADD COLUMN     "closed_by_name" TEXT,
ADD COLUMN     "closing_notes" TEXT;

-- CreateTable
CREATE TABLE "event_plans" (
    "event_id" UUID NOT NULL,
    "buffet_needed" BOOLEAN NOT NULL DEFAULT false,
    "buffet_details" TEXT,
    "parking_needed" BOOLEAN NOT NULL DEFAULT false,
    "parking_spots" INTEGER,
    "parking_details" TEXT,
    "structure" TEXT,
    "equipment" TEXT,
    "notes" TEXT,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,
    "updated_by_name" TEXT,

    CONSTRAINT "event_plans_pkey" PRIMARY KEY ("event_id")
);

-- CreateTable
CREATE TABLE "event_schedule_items" (
    "id" UUID NOT NULL,
    "event_id" UUID NOT NULL,
    "starts_at" TIMESTAMPTZ(3) NOT NULL,
    "ends_at" TIMESTAMPTZ(3) NOT NULL,
    "title" TEXT NOT NULL,
    "location" TEXT,
    "speaker" TEXT,
    "notes" TEXT,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "event_schedule_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "event_people" (
    "id" UUID NOT NULL,
    "event_id" UUID NOT NULL,
    "kind" "event_person_kind" NOT NULL,
    "name" TEXT NOT NULL,
    "affiliation" TEXT,
    "contact" TEXT,
    "notes" TEXT,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "event_people_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "operational_tasks" (
    "id" UUID NOT NULL,
    "event_id" UUID,
    "title" TEXT NOT NULL,
    "details" TEXT,
    "assignee_id" UUID,
    "assignee_name" TEXT,
    "due_date" DATE,
    "status" "task_status" NOT NULL DEFAULT 'OPEN',
    "done_at" TIMESTAMPTZ(3),
    "done_by_name" TEXT,
    "created_by_id" UUID,
    "created_by_name" TEXT NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "operational_tasks_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "event_schedule_items_event_id_starts_at_idx" ON "event_schedule_items"("event_id", "starts_at");

-- CreateIndex
CREATE INDEX "event_people_event_id_kind_name_idx" ON "event_people"("event_id", "kind", "name");

-- CreateIndex
CREATE INDEX "operational_tasks_event_id_status_idx" ON "operational_tasks"("event_id", "status");

-- CreateIndex
CREATE INDEX "operational_tasks_status_due_date_idx" ON "operational_tasks"("status", "due_date");

-- AddForeignKey
ALTER TABLE "event_plans" ADD CONSTRAINT "event_plans_event_id_fkey" FOREIGN KEY ("event_id") REFERENCES "events"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "event_schedule_items" ADD CONSTRAINT "event_schedule_items_event_id_fkey" FOREIGN KEY ("event_id") REFERENCES "events"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "event_people" ADD CONSTRAINT "event_people_event_id_fkey" FOREIGN KEY ("event_id") REFERENCES "events"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "operational_tasks" ADD CONSTRAINT "operational_tasks_event_id_fkey" FOREIGN KEY ("event_id") REFERENCES "events"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "operational_tasks" ADD CONSTRAINT "operational_tasks_assignee_id_fkey" FOREIGN KEY ("assignee_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "operational_tasks" ADD CONSTRAINT "operational_tasks_created_by_id_fkey" FOREIGN KEY ("created_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;


-- Regras que o banco garante.
ALTER TABLE "event_schedule_items" ADD CONSTRAINT "event_schedule_items_time_check" CHECK ("ends_at" > "starts_at");
ALTER TABLE "event_plans" ADD CONSTRAINT "event_plans_parking_spots_check" CHECK ("parking_spots" IS NULL OR "parking_spots" >= 0);
ALTER TABLE "events" ADD CONSTRAINT "events_actual_attendees_check" CHECK ("actual_attendees" IS NULL OR "actual_attendees" >= 0);
ALTER TABLE "operational_tasks" ADD CONSTRAINT "operational_tasks_done_check" CHECK (("status" = 'DONE') = ("done_at" IS NOT NULL));
