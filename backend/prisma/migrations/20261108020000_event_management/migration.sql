-- Fase 12: gestão do evento. Pré-reserva = reservas aprovadas ligadas ao evento,
-- com validade (pre_reserved_until): bloqueiam a sala pela mesma regra de
-- conflito das outras reservas e, vencidas, são canceladas pelo sistema.
ALTER TABLE "reservations" ADD COLUMN "event_id" UUID, ADD COLUMN "pre_reserved_until" TIMESTAMPTZ(3);
CREATE INDEX "reservations_event_id_idx" ON "reservations"("event_id");
ALTER TABLE "reservations" ADD CONSTRAINT "reservations_event_id_fkey" FOREIGN KEY ("event_id") REFERENCES "events"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "events"
  ADD COLUMN "assignee_id" UUID,
  ADD COLUMN "assignee_name" TEXT,
  ADD COLUMN "pre_reserved_until" TIMESTAMPTZ(3),
  ADD COLUMN "rejection_reason" TEXT;

CREATE TYPE "quote_status" AS ENUM ('SENT', 'APPROVED', 'REJECTED', 'CHANGES_REQUESTED', 'SUPERSEDED');

CREATE TABLE "event_quotes" (
    "id" UUID NOT NULL,
    "event_id" UUID NOT NULL,
    "version" INTEGER NOT NULL,
    "estimate" JSONB NOT NULL,
    "total_cents" INTEGER NOT NULL,
    "exemption_reason" TEXT,
    "notes" TEXT,
    "status" "quote_status" NOT NULL DEFAULT 'SENT',
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by_id" UUID,
    "created_by_name" TEXT,
    "decided_at" TIMESTAMPTZ(3),
    "decided_by_name" TEXT,
    "decision_note" TEXT,

    CONSTRAINT "event_quotes_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "event_quotes_total_check" CHECK ("total_cents" >= 0 AND "version" > 0)
);
CREATE UNIQUE INDEX "event_quotes_event_id_version_key" ON "event_quotes"("event_id", "version");
ALTER TABLE "event_quotes" ADD CONSTRAINT "event_quotes_event_id_fkey" FOREIGN KEY ("event_id") REFERENCES "events"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "event_messages" (
    "id" UUID NOT NULL,
    "event_id" UUID NOT NULL,
    "author_id" UUID,
    "author_name" TEXT NOT NULL,
    "author_role" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "event_messages_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "event_messages_event_id_created_at_idx" ON "event_messages"("event_id", "created_at");
ALTER TABLE "event_messages" ADD CONSTRAINT "event_messages_event_id_fkey" FOREIGN KEY ("event_id") REFERENCES "events"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TYPE "authorization_status" AS ENUM ('PENDING', 'AUTHORIZED', 'DENIED');

CREATE TABLE "event_authorizations" (
    "id" UUID NOT NULL,
    "event_id" UUID NOT NULL,
    "token" TEXT NOT NULL,
    "recipient" TEXT NOT NULL,
    "spaces" TEXT NOT NULL,
    "note" TEXT,
    "status" "authorization_status" NOT NULL DEFAULT 'PENDING',
    "requested_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "requested_by_name" TEXT,
    "responded_at" TIMESTAMPTZ(3),
    "response_note" TEXT,

    CONSTRAINT "event_authorizations_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "event_authorizations_token_key" ON "event_authorizations"("token");
CREATE INDEX "event_authorizations_event_id_idx" ON "event_authorizations"("event_id");
ALTER TABLE "event_authorizations" ADD CONSTRAINT "event_authorizations_event_id_fkey" FOREIGN KEY ("event_id") REFERENCES "events"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "event_notices" (
    "id" UUID NOT NULL,
    "event_id" UUID NOT NULL,
    "to" TEXT[],
    "subject" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "link" TEXT,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "sent_at" TIMESTAMPTZ(3),

    CONSTRAINT "event_notices_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "event_notices_event_id_created_at_idx" ON "event_notices"("event_id", "created_at");
ALTER TABLE "event_notices" ADD CONSTRAINT "event_notices_event_id_fkey" FOREIGN KEY ("event_id") REFERENCES "events"("id") ON DELETE CASCADE ON UPDATE CASCADE;
