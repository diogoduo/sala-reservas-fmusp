-- Opções fixas para o detalhe de um recurso (vira um select no formulário),
-- ex.: plataforma liberada no "Bloqueio de internet para prova".
ALTER TABLE "resources" ADD COLUMN "detail_options" TEXT[] DEFAULT ARRAY[]::TEXT[];
