-- Alteração da reserva pelo próprio solicitante: volta para análise (PENDING)
-- marcada como alterada, com um retrato de como estava antes.
ALTER TABLE "reservations"
  ADD COLUMN "modified_by_requester_at" TIMESTAMPTZ(3),
  ADD COLUMN "previous_snapshot" JSONB;
