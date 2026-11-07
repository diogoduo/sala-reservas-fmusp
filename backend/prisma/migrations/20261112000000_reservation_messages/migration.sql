-- Fase 19 — conversa de cada reserva, entre quem pediu e o SAD (pelo protocolo).

-- CreateTable
CREATE TABLE "reservation_messages" (
    "id" UUID NOT NULL,
    "protocol" TEXT NOT NULL,
    "author_id" UUID,
    "author_name" TEXT NOT NULL,
    "author_role" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "reservation_messages_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "reservation_messages_protocol_created_at_idx" ON "reservation_messages"("protocol", "created_at");

-- AddForeignKey
ALTER TABLE "reservation_messages" ADD CONSTRAINT "reservation_messages_author_id_fkey" FOREIGN KEY ("author_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;


ALTER TABLE "reservation_messages" ADD CONSTRAINT "reservation_messages_body_check" CHECK (length(btrim("body")) > 0);
