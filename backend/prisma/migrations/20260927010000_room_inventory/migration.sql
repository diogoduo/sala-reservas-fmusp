-- Salas reais da FMUSP e inventário de equipamentos.
-- Tipos de espaço no vocabulário da faculdade.
ALTER TYPE "room_type" ADD VALUE 'COMPUTER_LAB';
ALTER TYPE "room_type" ADD VALUE 'BOARD_ROOM';
ALTER TYPE "room_type" ADD VALUE 'THEATER';

-- Recurso que só entra no inventário (nobreak, splitter…), sem aparecer no formulário de reserva.
ALTER TABLE "resources" ADD COLUMN "requestable" BOOLEAN NOT NULL DEFAULT true;

-- Modelo e patrimônio de cada equipamento na sala (só o SAD vê).
ALTER TABLE "room_resources"
  ADD COLUMN "model" TEXT,
  ADD COLUMN "asset_tags" TEXT;

-- Cadeiras extras, dimensões e outros equipamentos da sala.
ALTER TABLE "rooms"
  ADD COLUMN "extra_seats" INTEGER,
  ADD COLUMN "dimensions" TEXT,
  ADD COLUMN "equipment_notes" TEXT;
