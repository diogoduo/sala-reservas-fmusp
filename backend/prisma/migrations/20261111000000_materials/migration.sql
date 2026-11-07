-- Fase 18 — controle de pranchões: estoque, retiradas (com devolução em partes),
-- movimentações e o histórico.

-- CreateEnum
CREATE TYPE "material_movement_kind" AS ENUM ('CHECKOUT', 'RETURN', 'MOVE', 'ADJUST');

-- CreateTable
CREATE TABLE "material_items" (
    "id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "total" INTEGER NOT NULL,
    "home_location" TEXT NOT NULL,
    "notes" TEXT,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "material_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "material_loans" (
    "id" UUID NOT NULL,
    "item_id" UUID NOT NULL,
    "quantity" INTEGER NOT NULL,
    "returned_quantity" INTEGER NOT NULL DEFAULT 0,
    "location" TEXT NOT NULL,
    "event_id" UUID,
    "reservation_protocol" TEXT,
    "purpose" TEXT,
    "taken_by" TEXT NOT NULL,
    "taken_at" TIMESTAMPTZ(3) NOT NULL,
    "expected_return_at" DATE,
    "returned_by" TEXT,
    "returned_at" TIMESTAMPTZ(3),
    "recorded_by_name" TEXT NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "material_loans_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "material_movements" (
    "id" UUID NOT NULL,
    "item_id" UUID NOT NULL,
    "loan_id" UUID,
    "kind" "material_movement_kind" NOT NULL,
    "quantity" INTEGER NOT NULL,
    "from_location" TEXT,
    "to_location" TEXT,
    "person" TEXT,
    "at" TIMESTAMPTZ(3) NOT NULL,
    "notes" TEXT,
    "recorded_by_name" TEXT NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "material_movements_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "material_items_name_key" ON "material_items"("name");

-- CreateIndex
CREATE INDEX "material_loans_item_id_returned_at_idx" ON "material_loans"("item_id", "returned_at");

-- CreateIndex
CREATE INDEX "material_movements_item_id_at_idx" ON "material_movements"("item_id", "at");

-- AddForeignKey
ALTER TABLE "material_loans" ADD CONSTRAINT "material_loans_item_id_fkey" FOREIGN KEY ("item_id") REFERENCES "material_items"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "material_loans" ADD CONSTRAINT "material_loans_event_id_fkey" FOREIGN KEY ("event_id") REFERENCES "events"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "material_movements" ADD CONSTRAINT "material_movements_item_id_fkey" FOREIGN KEY ("item_id") REFERENCES "material_items"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "material_movements" ADD CONSTRAINT "material_movements_loan_id_fkey" FOREIGN KEY ("loan_id") REFERENCES "material_loans"("id") ON DELETE SET NULL ON UPDATE CASCADE;


-- Regras que o banco garante.
ALTER TABLE "material_items" ADD CONSTRAINT "material_items_total_check" CHECK ("total" >= 0);
ALTER TABLE "material_loans" ADD CONSTRAINT "material_loans_quantity_check" CHECK ("quantity" > 0 AND "returned_quantity" >= 0 AND "returned_quantity" <= "quantity");
ALTER TABLE "material_movements" ADD CONSTRAINT "material_movements_quantity_check" CHECK ("quantity" <> 0);
