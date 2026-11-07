-- Fase 19 — disciplinas e os docentes de cada uma: quem tem disciplinas ligadas pede
-- as reservas de Graduação (ou Pós) só delas.

-- CreateTable
CREATE TABLE "disciplines" (
    "id" UUID NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "department" TEXT,
    "level" "activity_type" NOT NULL DEFAULT 'UNDERGRADUATE',
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "disciplines_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "discipline_teachers" (
    "discipline_id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "discipline_teachers_pkey" PRIMARY KEY ("discipline_id","user_id")
);

-- CreateIndex
CREATE UNIQUE INDEX "disciplines_code_key" ON "disciplines"("code");

-- CreateIndex
CREATE INDEX "discipline_teachers_user_id_idx" ON "discipline_teachers"("user_id");

-- AddForeignKey
ALTER TABLE "discipline_teachers" ADD CONSTRAINT "discipline_teachers_discipline_id_fkey" FOREIGN KEY ("discipline_id") REFERENCES "disciplines"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "discipline_teachers" ADD CONSTRAINT "discipline_teachers_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;


ALTER TABLE "disciplines" ADD CONSTRAINT "disciplines_code_check" CHECK ("code" ~ '^[A-Z]{3}[0-9]{4}$');
ALTER TABLE "disciplines" ADD CONSTRAINT "disciplines_level_check" CHECK ("level" IN ('UNDERGRADUATE', 'GRADUATE'));
