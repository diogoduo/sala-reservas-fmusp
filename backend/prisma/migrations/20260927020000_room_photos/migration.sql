-- Fotos das salas. Os arquivos ficam em disco (PHOTO_STORAGE_DIR); aqui só os metadados.
CREATE TABLE "room_photos" (
    "id" UUID NOT NULL,
    "room_id" UUID NOT NULL,
    "caption" TEXT,
    "position" INTEGER NOT NULL DEFAULT 0,
    "width" INTEGER NOT NULL,
    "height" INTEGER NOT NULL,
    "source_name" TEXT,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "room_photos_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "room_photos_room_id_position_idx" ON "room_photos"("room_id", "position");

-- Só vale quando source_name não é nulo (fotos do import); uploads pela tela ficam com NULL.
CREATE UNIQUE INDEX "room_photos_room_id_source_name_key" ON "room_photos"("room_id", "source_name");

ALTER TABLE "room_photos" ADD CONSTRAINT "room_photos_room_id_fkey" FOREIGN KEY ("room_id") REFERENCES "rooms"("id") ON DELETE CASCADE ON UPDATE CASCADE;
