-- Fase 11: pedidos de evento (vários dias e espaços). As fases 12 e 13
-- acrescentam análise, pré-reserva, orçamento emitido e pagamento.
CREATE TYPE "event_status" AS ENUM ('SUBMITTED', 'IN_REVIEW', 'QUOTE_SENT', 'CHANGES_REQUESTED', 'QUOTE_APPROVED', 'PRE_RESERVED', 'PAYMENT_SUBMITTED', 'PAYMENT_VALIDATED', 'CONFIRMED', 'CANCELLED', 'REJECTED', 'EXPIRED');

-- Protocolo próprio dos eventos: EV-000001/2026.
CREATE SEQUENCE "event_protocol_seq";

CREATE TABLE "events" (
    "id" UUID NOT NULL,
    "protocol" TEXT NOT NULL,
    "user_id" UUID NOT NULL,
    "title" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "target_audience" TEXT NOT NULL,
    "expected_attendees" INTEGER NOT NULL,
    "entity" TEXT NOT NULL,
    "institutional" BOOLEAN NOT NULL,
    "has_registration_fee" BOOLEAN NOT NULL,
    "sponsored" BOOLEAN NOT NULL,
    "responsible" TEXT NOT NULL,
    "responsible_contact" TEXT NOT NULL,
    "department" TEXT NOT NULL,
    "coffee_break" BOOLEAN NOT NULL DEFAULT false,
    "coffee_attendees" INTEGER,
    "infrastructure" TEXT,
    "notes" TEXT,
    "estimate" JSONB,
    "status" "event_status" NOT NULL DEFAULT 'SUBMITTED',
    "cancelled_at" TIMESTAMPTZ(3),
    "cancellation_reason" TEXT,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "events_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "events_attendees_check" CHECK ("expected_attendees" > 0 AND ("coffee_attendees" IS NULL OR "coffee_attendees" > 0))
);
CREATE UNIQUE INDEX "events_protocol_key" ON "events"("protocol");
CREATE INDEX "events_status_created_at_idx" ON "events"("status", "created_at");
CREATE INDEX "events_user_id_created_at_idx" ON "events"("user_id", "created_at");
ALTER TABLE "events" ADD CONSTRAINT "events_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE TABLE "event_days" (
    "id" UUID NOT NULL,
    "event_id" UUID NOT NULL,
    "date" DATE NOT NULL,
    "start_time" TIMESTAMPTZ(3) NOT NULL,
    "end_time" TIMESTAMPTZ(3) NOT NULL,
    "setup_minutes" INTEGER NOT NULL DEFAULT 0,
    "teardown_minutes" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "event_days_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "event_days_time_check" CHECK ("end_time" > "start_time" AND "setup_minutes" >= 0 AND "teardown_minutes" >= 0)
);
CREATE UNIQUE INDEX "event_days_event_id_date_key" ON "event_days"("event_id", "date");
ALTER TABLE "event_days" ADD CONSTRAINT "event_days_event_id_fkey" FOREIGN KEY ("event_id") REFERENCES "events"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "event_space_requests" (
    "id" UUID NOT NULL,
    "event_id" UUID NOT NULL,
    "position" INTEGER NOT NULL DEFAULT 0,
    "price_category_id" UUID,
    "room_id" UUID,
    "count" INTEGER NOT NULL DEFAULT 1,
    "min_capacity" INTEGER,
    "purpose" TEXT,
    "coffee_in_room" BOOLEAN NOT NULL DEFAULT false,
    "dates" DATE[],

    CONSTRAINT "event_space_requests_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "event_space_requests_count_check" CHECK ("count" > 0 AND ("min_capacity" IS NULL OR "min_capacity" > 0))
);
CREATE INDEX "event_space_requests_event_id_idx" ON "event_space_requests"("event_id");
ALTER TABLE "event_space_requests" ADD CONSTRAINT "event_space_requests_event_id_fkey" FOREIGN KEY ("event_id") REFERENCES "events"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "event_space_requests" ADD CONSTRAINT "event_space_requests_price_category_id_fkey" FOREIGN KEY ("price_category_id") REFERENCES "price_categories"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "event_space_requests" ADD CONSTRAINT "event_space_requests_room_id_fkey" FOREIGN KEY ("room_id") REFERENCES "rooms"("id") ON DELETE SET NULL ON UPDATE CASCADE;
