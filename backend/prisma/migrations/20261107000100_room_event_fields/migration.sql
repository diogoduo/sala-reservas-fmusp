-- Fase 9, bloco 3: o que o módulo de Eventos precisa saber de cada espaço.
ALTER TABLE "rooms"
  ADD COLUMN "coffee_allowed" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "coffee_capacity" INTEGER,
  ADD COLUMN "recommended_above" INTEGER,
  ADD COLUMN "requires_board_approval" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "usage_rules" TEXT;

ALTER TABLE "rooms"
  ADD CONSTRAINT "rooms_coffee_capacity_check" CHECK ("coffee_capacity" IS NULL OR "coffee_capacity" > 0),
  ADD CONSTRAINT "rooms_recommended_above_check" CHECK ("recommended_above" IS NULL OR "recommended_above" > 0);

-- Área de apoio pode ficar Ativa sem capacidade (o átrio não tem um limite
-- cadastrado; "acima de 250" é indicação, não capacidade). Sala, não.
ALTER TABLE "rooms" DROP CONSTRAINT "rooms_active_capacity_check";
ALTER TABLE "rooms"
  ADD CONSTRAINT "rooms_active_capacity_check" CHECK ("status" <> 'ACTIVE' OR "capacity" IS NOT NULL OR "room_type" = 'SUPPORT_AREA');

-- Portaria 2794, Art. 5º: das salas de aula, só as de uso interativo recebem
-- coffee break (2366/2368 Sala do Futuro, 2223 Design Thinking, 1357), com
-- autorização do Núcleo de Eventos e adicional de 20%. Até aqui a regra estava
-- fixa no código; agora é um campo que o SAD muda na tela da sala.
UPDATE "rooms"
SET "coffee_allowed" = true,
    "usage_rules" = COALESCE("usage_rules", 'Coffee break só com autorização do Núcleo de Eventos, com adicional de 20% sobre o valor da sala (Portaria 2794, Art. 5º).')
WHERE "name" ~ '(^|[^0-9])(2366|2368|2223|1357)([^0-9]|$)';
