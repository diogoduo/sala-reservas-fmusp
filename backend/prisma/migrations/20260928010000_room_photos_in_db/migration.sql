-- As versões das fotos passam a ficar no banco (antes: arquivos em disco, em
-- PHOTO_STORAGE_DIR). Assim o app roda em hospedagem sem disco persistente.
-- Fotos antigas em disco não são convertidas: rode `npm run db:import-fmusp`
-- de novo para reimportá-las.
DELETE FROM "room_photos";

ALTER TABLE "room_photos" ADD COLUMN "large" BYTEA NOT NULL,
ADD COLUMN "thumb" BYTEA NOT NULL;
