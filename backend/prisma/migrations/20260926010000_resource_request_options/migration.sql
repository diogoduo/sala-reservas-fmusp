-- Recursos que pedem quantidade (Computador, Chromebook) ou um detalhe
-- (Webconferência: qual plataforma; Videoconferência: IP/modelo; Outro equipamento: qual).

ALTER TABLE "resources"
  ADD COLUMN "requests_quantity" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "detail_prompt" TEXT;

-- requested_resources passa de ["<id>", ...] para
-- [{"resourceId": "<id>", "quantity"?: n, "detail"?: "..."}, ...].
UPDATE "reservations"
SET "requested_resources" = (
  SELECT coalesce(jsonb_agg(jsonb_build_object('resourceId', item)), '[]'::jsonb)
  FROM jsonb_array_elements_text("requested_resources") AS item
)
WHERE jsonb_typeof("requested_resources" -> 0) = 'string';
