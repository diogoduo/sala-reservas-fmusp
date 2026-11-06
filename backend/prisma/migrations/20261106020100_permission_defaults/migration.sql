-- Quem entra pela primeira vez já pode pedir Cultura e Extensão e Concurso.
ALTER TABLE "users" ALTER COLUMN "permissions" SET DEFAULT ARRAY['REQUEST_CULTURE_EXTENSION', 'REQUEST_PUBLIC_EXAM']::"permission"[];

-- Até aqui esses dois tipos eram abertos a todos: quem já tem cadastro continua
-- podendo pedir. Não tira nem muda nenhuma outra permissão. Ordem alfabética,
-- como o app grava.
UPDATE "users"
SET "permissions" = ARRAY(
  SELECT d.p
  FROM (
    SELECT DISTINCT unnest(COALESCE("permissions", ARRAY[]::"permission"[]) || ARRAY['REQUEST_CULTURE_EXTENSION', 'REQUEST_PUBLIC_EXAM']::"permission"[]) AS p
  ) AS d
  ORDER BY d.p::text
);
