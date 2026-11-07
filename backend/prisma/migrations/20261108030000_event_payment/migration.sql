-- Fase 13: pagamento e confirmação do evento. O solicitante envia o
-- comprovante, o NUCEV valida e o SAD confirma a reserva.
ALTER TABLE "events"
  ADD COLUMN "payment_expected_cents" INTEGER,
  ADD COLUMN "payment_instructions" TEXT,
  ADD COLUMN "payment_requested_at" TIMESTAMPTZ(3),
  ADD COLUMN "payment_validated_at" TIMESTAMPTZ(3),
  ADD COLUMN "payment_validated_by_name" TEXT,
  ADD COLUMN "confirmed_at" TIMESTAMPTZ(3),
  ADD COLUMN "confirmed_by_name" TEXT;

CREATE TYPE "receipt_status" AS ENUM ('PENDING', 'VALIDATED', 'REFUSED');

CREATE TABLE "event_receipts" (
    "id" UUID NOT NULL,
    "event_id" UUID NOT NULL,
    "file_name" TEXT NOT NULL,
    "mime_type" TEXT NOT NULL,
    "size" INTEGER NOT NULL,
    "data" BYTEA NOT NULL,
    "uploaded_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "uploaded_by_name" TEXT NOT NULL,
    "status" "receipt_status" NOT NULL DEFAULT 'PENDING',
    "reviewed_at" TIMESTAMPTZ(3),
    "reviewed_by_name" TEXT,
    "review_note" TEXT,

    CONSTRAINT "event_receipts_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "event_receipts_event_id_uploaded_at_idx" ON "event_receipts"("event_id", "uploaded_at");
ALTER TABLE "event_receipts" ADD CONSTRAINT "event_receipts_event_id_fkey" FOREIGN KEY ("event_id") REFERENCES "events"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "app_settings" (
    "key" TEXT NOT NULL,
    "value" TEXT NOT NULL,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,
    "updated_by_name" TEXT,

    CONSTRAINT "app_settings_pkey" PRIMARY KEY ("key")
);

-- Texto inicial das orientações de pagamento; o SAD e o NUCEV editam na tela Preços.
INSERT INTO "app_settings" ("key", "value", "updated_at") VALUES (
  'event_payment_instructions',
  E'Dados para o pagamento (conta, GRU ou boleto): a definir pelo SAD e pelo NUCEV.\nDepois de pagar, envie o comprovante (PDF ou foto) nesta página. O NUCEV confere e o SAD confirma a reserva: só então os espaços ficam garantidos.',
  CURRENT_TIMESTAMP
);
