-- O SAD altera e cancela qualquer reserva: quem cancelou, o motivo e quando o
-- SAD alterou pela última vez.
ALTER TABLE "reservations" ADD COLUMN     "cancellation_reason" TEXT,
ADD COLUMN     "cancelled_by_id" UUID,
ADD COLUMN     "modified_by_admin_at" TIMESTAMPTZ(3);

ALTER TABLE "reservations" ADD CONSTRAINT "reservations_cancelled_by_id_fkey" FOREIGN KEY ("cancelled_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Regulamento (portarias) aceito no "Li e concordo". Linha única, editada pelo SAD.
CREATE TABLE "regulation" (
    "id" INTEGER NOT NULL DEFAULT 1,
    "title" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,
    "updated_by_id" UUID,

    CONSTRAINT "regulation_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "regulation_single_row_check" CHECK ("id" = 1)
);

INSERT INTO "regulation" ("id", "title", "body", "updated_at") VALUES (
  1,
  'Regulamento de Uso dos Espaços da FMUSP',
  E'As portarias que regulam o uso das salas serão publicadas aqui pelo SAD.\n\nAo enviar uma solicitação, você se compromete a:\n- usar o espaço só para a atividade informada;\n- respeitar o horário reservado, incluindo a montagem e a desmontagem;\n- deixar a sala e os equipamentos como encontrou;\n- avisar o SAD se não for mais usar a reserva.',
  CURRENT_TIMESTAMP
);

-- Arquivos anexos ao regulamento (os PDFs das portarias), guardados no banco.
CREATE TABLE "regulation_files" (
    "id" UUID NOT NULL,
    "file_name" TEXT NOT NULL,
    "mime_type" TEXT NOT NULL,
    "size" INTEGER NOT NULL,
    "data" BYTEA NOT NULL,
    "position" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "regulation_files_pkey" PRIMARY KEY ("id")
);
