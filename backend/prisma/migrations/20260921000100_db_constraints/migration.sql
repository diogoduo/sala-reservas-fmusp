-- =============================================================================
-- Regras de integridade que o Prisma não modela.
-- São a "última linha de defesa": o back-end valida antes (com mensagens amigáveis),
-- mas o banco recusa qualquer dado que viole as regras, mesmo sob concorrência.
--
-- Requer permissão para CREATE EXTENSION (superusuário no Docker de dev; em
-- produção, peça ao DBA para criar a extensão btree_gist previamente).
-- =============================================================================

CREATE EXTENSION IF NOT EXISTS btree_gist;

-- ----------------------------------------------------------------------------
-- users
-- ----------------------------------------------------------------------------
ALTER TABLE "users"
  ADD CONSTRAINT "users_email_lowercase_check"
    CHECK ("email" = lower("email")),
  ADD CONSTRAINT "users_email_domain_check"
    CHECK ("email" ~ '@(usp[.]br|fm[.]usp[.]br|hc[.]fm[.]usp[.]br)$');

-- ----------------------------------------------------------------------------
-- rooms / room_resources
-- ----------------------------------------------------------------------------
ALTER TABLE "rooms"
  ADD CONSTRAINT "rooms_capacity_check" CHECK ("capacity" > 0);

ALTER TABLE "room_resources"
  ADD CONSTRAINT "room_resources_quantity_check" CHECK ("quantity" > 0);

-- ----------------------------------------------------------------------------
-- reservations
-- ----------------------------------------------------------------------------
ALTER TABLE "reservations"
  -- fim depois do início
  ADD CONSTRAINT "reservations_time_order_check"
    CHECK ("end_time" > "start_time"),
  -- duração entre 30 minutos e 15 horas
  ADD CONSTRAINT "reservations_duration_check"
    CHECK ("end_time" - "start_time" BETWEEN INTERVAL '30 minutes' AND INTERVAL '15 hours'),
  -- mesmo dia e dentro de 07:30–22:30 (horário de São Paulo)
  ADD CONSTRAINT "reservations_business_hours_check"
    CHECK (
      ("start_time" AT TIME ZONE 'America/Sao_Paulo')::date
        = ("end_time" AT TIME ZONE 'America/Sao_Paulo')::date
      AND ("start_time" AT TIME ZONE 'America/Sao_Paulo')::time >= TIME '07:30'
      AND ("end_time" AT TIME ZONE 'America/Sao_Paulo')::time <= TIME '22:30'
    ),
  ADD CONSTRAINT "reservations_attendees_check"
    CHECK ("expected_attendees" > 0),
  -- o aceite do regulamento é obrigatório
  ADD CONSTRAINT "reservations_terms_check"
    CHECK ("terms_accepted" = true),
  -- aprovar exige sala definida
  ADD CONSTRAINT "reservations_approved_room_check"
    CHECK ("status" <> 'APPROVED' OR "room_id" IS NOT NULL),
  -- rejeitar exige justificativa
  ADD CONSTRAINT "reservations_rejection_reason_check"
    CHECK ("status" <> 'REJECTED' OR length(btrim(coalesce("rejection_reason", ''))) > 0);

-- Nenhuma sobreposição entre reservas ativas (PENDING/APPROVED) da mesma sala.
-- Intervalo [início, fim): uma reserva pode começar exatamente quando outra termina.
ALTER TABLE "reservations"
  ADD CONSTRAINT "reservations_no_overlap_excl"
    EXCLUDE USING gist (
      "room_id" WITH =,
      tstzrange("start_time", "end_time", '[)') WITH &&
    )
    WHERE ("room_id" IS NOT NULL AND "status" IN ('PENDING', 'APPROVED'));

-- ----------------------------------------------------------------------------
-- room_blocks (bloqueios administrativos/manutenção)
-- ----------------------------------------------------------------------------
ALTER TABLE "room_blocks"
  ADD CONSTRAINT "room_blocks_time_order_check"
    CHECK ("end_time" > "start_time"),
  ADD CONSTRAINT "room_blocks_no_overlap_excl"
    EXCLUDE USING gist (
      "room_id" WITH =,
      tstzrange("start_time", "end_time", '[)') WITH &&
    );

-- Observação: conflito ENTRE reservas e bloqueios não pode ser expresso como
-- constraint (tabelas diferentes). É garantido na Fase 4 pelo back-end, dentro de
-- transação que trava a linha da sala (SELECT ... FOR UPDATE).
