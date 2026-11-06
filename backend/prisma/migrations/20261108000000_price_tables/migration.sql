-- Fase 9, bloco 4: tabela de preços da Portaria 2794, com vigência.
CREATE TYPE "price_unit" AS ENUM ('HOUR', 'DAY');

CREATE TABLE "price_categories" (
    "id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "unit" "price_unit" NOT NULL,
    "didactic" BOOLEAN NOT NULL DEFAULT false,
    "position" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "price_categories_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "price_categories_name_key" ON "price_categories"("name");

CREATE TABLE "price_tables" (
    "id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "valid_from" DATE NOT NULL,
    "minimum_hours" INTEGER NOT NULL DEFAULT 2,
    "prep_hours_before" INTEGER NOT NULL DEFAULT 1,
    "prep_hours_after" INTEGER NOT NULL DEFAULT 1,
    "coffee_surcharge_percent" INTEGER NOT NULL DEFAULT 20,
    "institutional_discount_percent" INTEGER NOT NULL DEFAULT 25,
    "notes" TEXT,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "price_tables_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "price_tables_rules_check" CHECK (
      "minimum_hours" >= 0 AND "prep_hours_before" >= 0 AND "prep_hours_after" >= 0
      AND "coffee_surcharge_percent" BETWEEN 0 AND 100
      AND "institutional_discount_percent" BETWEEN 0 AND 100
    )
);
CREATE UNIQUE INDEX "price_tables_valid_from_key" ON "price_tables"("valid_from");

-- Valor de cada categoria em cada tabela, em centavos. Nulo = a definir.
CREATE TABLE "price_entries" (
    "table_id" UUID NOT NULL,
    "category_id" UUID NOT NULL,
    "amount_cents" INTEGER,

    CONSTRAINT "price_entries_pkey" PRIMARY KEY ("table_id", "category_id"),
    CONSTRAINT "price_entries_amount_check" CHECK ("amount_cents" IS NULL OR "amount_cents" >= 0)
);
ALTER TABLE "price_entries" ADD CONSTRAINT "price_entries_table_id_fkey" FOREIGN KEY ("table_id") REFERENCES "price_tables"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "price_entries" ADD CONSTRAINT "price_entries_category_id_fkey" FOREIGN KEY ("category_id") REFERENCES "price_categories"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "rooms" ADD COLUMN "price_category_id" UUID;
ALTER TABLE "rooms" ADD CONSTRAINT "rooms_price_category_id_fkey" FOREIGN KEY ("price_category_id") REFERENCES "price_categories"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Categorias: Art. 2º (espaços didáticos, por hora, com mínimo e preparação) e
-- Art. 3º (áreas de apoio). Hall do NINA e a área de coffee do 5º andar não
-- estão na portaria: entram com o valor a definir.
INSERT INTO "price_categories" ("id", "name", "unit", "didactic", "position") VALUES
  (gen_random_uuid(), 'Teatro da FMUSP', 'HOUR', true, 1),
  (gen_random_uuid(), 'Anfiteatros', 'HOUR', true, 2),
  (gen_random_uuid(), 'Salas de aula e salas de reunião', 'HOUR', true, 3),
  (gen_random_uuid(), 'Átrio (por átrio)', 'HOUR', false, 4),
  (gen_random_uuid(), 'Área de vivência / terraço – 5º andar', 'HOUR', false, 5),
  (gen_random_uuid(), 'Foyer do Teatro', 'DAY', false, 6),
  (gen_random_uuid(), 'Hall de transição – 4º andar', 'DAY', false, 7),
  (gen_random_uuid(), 'Copa – 5º andar', 'DAY', false, 8),
  (gen_random_uuid(), 'Copa do Teatro', 'DAY', false, 9),
  (gen_random_uuid(), 'Hall do NINA', 'DAY', false, 10),
  (gen_random_uuid(), 'Área de coffee do 5º andar', 'HOUR', false, 11);

INSERT INTO "price_tables" ("id", "name", "valid_from", "notes") VALUES
  (gen_random_uuid(), 'Portaria 2794/2026', '2026-06-02',
   'Valores de referência da Portaria FMUSP nº 2794, de 02/06/2026. Reajuste anual pelo IPC-FIPE (Arts. 2º §2º e 3º §3º).');

INSERT INTO "price_entries" ("table_id", "category_id", "amount_cents")
SELECT t."id", c."id", v."amount"
FROM "price_tables" t
CROSS JOIN (VALUES
  ('Teatro da FMUSP', 62500),
  ('Anfiteatros', 37500),
  ('Salas de aula e salas de reunião', 12500),
  ('Átrio (por átrio)', 150000),
  ('Área de vivência / terraço – 5º andar', 120000),
  ('Foyer do Teatro', 50000),
  ('Hall de transição – 4º andar', 50000),
  ('Copa – 5º andar', 45000),
  ('Copa do Teatro', 30000),
  ('Hall do NINA', NULL),
  ('Área de coffee do 5º andar', NULL)
) AS v("name", "amount")
JOIN "price_categories" c ON c."name" = v."name"
WHERE t."valid_from" = '2026-06-02';

-- Cada espaço que já existe recebe a sua categoria: pelo tipo (Teatro,
-- anfiteatros, demais salas) ou, nas áreas de apoio, pelo nome.
UPDATE "rooms" r
SET "price_category_id" = c."id"
FROM "price_categories" c
WHERE c."name" = CASE
  WHEN r."room_type" = 'THEATER' THEN 'Teatro da FMUSP'
  WHEN r."room_type" = 'AUDITORIUM' THEN 'Anfiteatros'
  WHEN r."room_type" IN ('CLASSROOM', 'MEETING_ROOM', 'BOARD_ROOM', 'COMPUTER_LAB', 'LABORATORY', 'MULTIPURPOSE') THEN 'Salas de aula e salas de reunião'
  WHEN r."name" LIKE 'Átrio%' THEN 'Átrio (por átrio)'
  WHEN r."name" LIKE 'Hall de transição%' THEN 'Hall de transição – 4º andar'
  WHEN r."name" LIKE 'Hall do Teatro%' OR r."name" LIKE 'Foyer do Teatro%' THEN 'Foyer do Teatro'
  WHEN r."name" LIKE 'Hall do NINA%' THEN 'Hall do NINA'
  WHEN r."name" LIKE 'Copa do 5º%' THEN 'Copa – 5º andar'
  WHEN r."name" LIKE 'Copa do Teatro%' THEN 'Copa do Teatro'
  WHEN r."name" LIKE 'Área de coffee do 5º%' THEN 'Área de coffee do 5º andar'
END;
