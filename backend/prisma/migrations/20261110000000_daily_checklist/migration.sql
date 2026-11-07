-- Fase 17 — checklist do dia: tarefas da equipe com prioridade e quem alterou por último.

-- AlterTable
ALTER TABLE "operational_tasks" ADD COLUMN     "priority" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "updated_by_name" TEXT;

