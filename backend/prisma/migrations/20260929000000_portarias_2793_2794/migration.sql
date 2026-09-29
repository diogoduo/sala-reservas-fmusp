-- =============================================================================
-- Portarias FMUSP nº 2793 (uso dos espaços) e nº 2794 (valores), de 02/06/2026.
-- =============================================================================

-- Reunião / Administrativo (Art. 7º, itens 3 e 7)
ALTER TYPE "activity_type" ADD VALUE 'ADMINISTRATIVE';

-- Sanções (Art. 9º §2º, Art. 11, Art. 17, Art. 22)
CREATE TYPE "sanction_type" AS ENUM ('WARNING', 'FINE', 'SUSPENSION');

ALTER TABLE "reservations"
  ADD COLUMN "protocol" TEXT,
  ADD COLUMN "setup_minutes" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "outside_regular_hours" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "no_alcohol_commitment" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "coffee_break" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "approval_checklist" JSONB,
  ADD COLUMN "no_show_at" TIMESTAMPTZ(3),
  ADD COLUMN "no_show_by_id" UUID;

-- ----------------------------------------------------------------------------
-- Nº de protocolo (Art. 8º §1º, b): "000123/2026". Um por pedido — as datas de
-- uma série compartilham o número. Os pedidos que já existiam recebem números
-- na ordem em que foram feitos.
-- ----------------------------------------------------------------------------
CREATE SEQUENCE "reservation_protocol_seq";

WITH "requests" AS (
  SELECT COALESCE("series_id", "id") AS "request_id", MIN("created_at") AS "first_created"
  FROM "reservations"
  GROUP BY COALESCE("series_id", "id")
), "numbered" AS (
  SELECT "request_id", "first_created", ROW_NUMBER() OVER (ORDER BY "first_created", "request_id") AS "n"
  FROM "requests"
)
UPDATE "reservations" AS r
SET "protocol" = lpad("numbered"."n"::text, 6, '0') || '/' || EXTRACT(YEAR FROM ("numbered"."first_created" AT TIME ZONE 'America/Sao_Paulo'))::int
FROM "numbered"
WHERE COALESCE(r."series_id", r."id") = "numbered"."request_id";

SELECT setval('"reservation_protocol_seq"', (SELECT COUNT(DISTINCT COALESCE("series_id", "id")) FROM "reservations") + 1, false);

ALTER TABLE "reservations" ALTER COLUMN "protocol" SET NOT NULL;
CREATE INDEX "reservations_protocol_idx" ON "reservations"("protocol");

-- ----------------------------------------------------------------------------
-- Horário (Art. 6º): dias úteis e sábados, das 07h às 22h. Fora disso (domingo,
-- feriado, ponto facultativo ou outro horário) só com autorização da Divisão
-- Acadêmica — a reserva fica marcada com outside_regular_hours. Feriados não
-- cabem num CHECK: o back-end confere. As reservas que já existiam fora da nova
-- janela (ex.: 07:30–22:30 da regra anterior) ficam marcadas como extraordinárias.
-- ----------------------------------------------------------------------------
ALTER TABLE "reservations" DROP CONSTRAINT "reservations_business_hours_check";

UPDATE "reservations"
SET "outside_regular_hours" = true
WHERE ("start_time" AT TIME ZONE 'America/Sao_Paulo')::time < TIME '07:00'
   OR ("end_time" AT TIME ZONE 'America/Sao_Paulo')::time > TIME '22:00'
   OR EXTRACT(ISODOW FROM ("start_time" AT TIME ZONE 'America/Sao_Paulo')) = 7;

ALTER TABLE "reservations"
  ADD CONSTRAINT "reservations_business_hours_check"
    CHECK (
      ("start_time" AT TIME ZONE 'America/Sao_Paulo')::date
        = ("end_time" AT TIME ZONE 'America/Sao_Paulo')::date
      AND (
        "outside_regular_hours"
        OR (
          ("start_time" AT TIME ZONE 'America/Sao_Paulo')::time >= TIME '07:00'
          AND ("end_time" AT TIME ZONE 'America/Sao_Paulo')::time <= TIME '22:00'
          AND EXTRACT(ISODOW FROM ("start_time" AT TIME ZONE 'America/Sao_Paulo')) <> 7
        )
      )
    ),
  -- Montagem (Art. 19): de 0 a 4 horas, dentro do período reservado.
  ADD CONSTRAINT "reservations_setup_minutes_check"
    CHECK ("setup_minutes" BETWEEN 0 AND 240 AND "start_time" + make_interval(mins => "setup_minutes") < "end_time");

ALTER TABLE "reservations" ADD CONSTRAINT "reservations_no_show_by_id_fkey" FOREIGN KEY ("no_show_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- ----------------------------------------------------------------------------
-- Sanções aos solicitantes
-- ----------------------------------------------------------------------------
CREATE TABLE "user_sanctions" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "type" "sanction_type" NOT NULL,
    "reason" TEXT NOT NULL,
    "until" DATE,
    "created_by_id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lifted_at" TIMESTAMPTZ(3),
    "lifted_by_id" UUID,

    CONSTRAINT "user_sanctions_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "user_sanctions_reason_check" CHECK (length(btrim("reason")) > 0),
    -- Data de fim só na suspensão.
    CONSTRAINT "user_sanctions_until_check" CHECK ("type" = 'SUSPENSION' OR "until" IS NULL)
);

CREATE INDEX "user_sanctions_user_id_created_at_idx" ON "user_sanctions"("user_id", "created_at");
ALTER TABLE "user_sanctions" ADD CONSTRAINT "user_sanctions_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "user_sanctions" ADD CONSTRAINT "user_sanctions_created_by_id_fkey" FOREIGN KEY ("created_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "user_sanctions" ADD CONSTRAINT "user_sanctions_lifted_by_id_fkey" FOREIGN KEY ("lifted_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- ----------------------------------------------------------------------------
-- Regulamento: o texto provisório dá lugar às portarias. Só se o SAD ainda não
-- tiver editado o texto pela tela (updated_by_id nulo).
-- ----------------------------------------------------------------------------
UPDATE "regulation"
SET "title" = 'Regulamento de Uso dos Espaços da FMUSP (Portarias nº 2793 e 2794/2026)',
    "updated_at" = CURRENT_TIMESTAMP,
    "body" = $regulamento$Vale para toda reserva o que determinam as Portarias FMUSP nº 2793 (uso dos espaços) e nº 2794 (valores de referência), de 02 de junho de 2026. O texto integral das duas está logo abaixo.

## Em resumo
- Os espaços funcionam em **dias úteis e aos sábados, das 07h às 22h**. Domingos, feriados, pontos facultativos e outros horários só com autorização prévia da Divisão Acadêmica e custeio da equipe de apoio.
- O pedido só é considerado cadastrado depois de gerado o **número de protocolo** — anote-o para acompanhar.
- O cancelamento é feito pelo sistema com no mínimo **3 dias úteis** de antecedência. Não usar o espaço sem cancelar 3 ou mais vezes em 12 meses gera notificação e pode levar a sanções.
- O responsável comparece ao SAD/NE **10 minutos antes** para orientações e retirada das chaves.
- **Não é permitido colocar cadeiras sobressalentes** em nenhuma sala ou anfiteatro.
- É **proibido o comércio e o consumo de bebidas alcoólicas**.
- A **montagem** do evento é reservada no sistema e faz parte do uso do espaço.
- Atividades fora da graduação, pós-graduação, residência e pesquisa (eventos, congressos, palestras, cursos, campanhas…) precisam de **autorização prévia da CCEx** e podem ter **taxa de utilização**.
- **Coffee break e alimentação não são permitidos nas salas de aula**, exceto nas salas 2366/2368, 2223 e 1357, com autorização do Núcleo de Eventos.
- Informações inexatas, omitidas ou inconsistentes levam ao indeferimento do pedido e/ou à suspensão das reservas da mesma atividade.

# Portaria nº 2793, de 02 de junho de 2026
Dispõe sobre o uso dos espaços didáticos, administrativos e de apoio da Faculdade de Medicina da Universidade de São Paulo (FMUSP).

O Vice-Diretor da Faculdade de Medicina da Universidade de São Paulo, Professor Doutor Paulo Manuel Pêgo Fernandes, usando de suas atribuições legais e regimentais,

CONSIDERANDO a necessidade de revisar, consolidar e atualizar as normas referentes à utilização dos espaços didáticos e de apoio no âmbito da FMUSP, e

CONSIDERANDO a deliberação da 991ª Sessão Ordinária da Congregação da FMUSP de 05.12.2025,

RESOLVE:

## Capítulo I – Disposições gerais
**Art. 1º** – Os espaços didáticos, auditórios, anfiteatros, salas de aula, ambientes de apoio, áreas de circulação e demais locais destinados à realização de atividades acadêmicas, administrativas e eventos institucionais da FMUSP têm seu uso disciplinado por esta Portaria.

**Art. 2º** – Os interesses institucionais da FMUSP e da USP prevalecerão sobre solicitações individuais ou externas, devendo o uso dos espaços seguir as normas internas, diretrizes acadêmicas e administrativas da Faculdade.

**Art. 3º** – Os espaços regidos por esta Portaria, bem como toda a infraestrutura neles existente, constituem bens públicos integrantes do patrimônio da FMUSP, e sua utilização deve observar rigorosamente as regras de segurança, acessibilidade, preservação patrimonial e demais padrões institucionais estabelecidos.

**Art. 4º** – Os espaços regidos por esta Portaria poderão ser utilizados pelas seguintes unidades e representações da FMUSP, desde que previamente agendados e respeitadas as prioridades de uso estabelecidas:
1. Departamentos da FMUSP e suas atividades acadêmicas;
2. Divisão Acadêmica da FMUSP e seus respectivos Serviços;
3. Centro Acadêmico Oswaldo Cruz (CAOC) e as extensões estudantis por ele aprovadas;
4. Associação Atlética Acadêmica Oswaldo Cruz (AAAOC);
5. Centro Acadêmico XXI de Junho (CA XXI);
6. Departamento Científico (DC);
7. MedEnsina;
8. Medicina Jr.;
9. Extensão Médica Acadêmica (EMA);
10. Representação dos Funcionários da FMUSP.

**§1º** – O uso dos espaços por entidades externas à FMUSP dependerá de autorização expressa da Divisão Acadêmica, incluindo, mas não restrito a:
a) outras Unidades da USP;
b) agremiações estudantis vinculadas a outras Unidades da USP;
c) instituições públicas;
d) organizações sociais;
e) pessoas jurídicas de direito privado.

## Capítulo II – Dos espaços disponíveis
**Art. 5º** – A FMUSP dispõe dos seguintes espaços destinados a atividades acadêmicas e administrativas:
1. Teatro da FMUSP;
2. Anfiteatros: Patologia, Anatomia, Microbiologia, Parasitologia, Farmacologia, Fisiologia, Técnica Cirúrgica e Paramédicos;
3. Salas didáticas;
4. Salas de informática;
5. Salas de reuniões;
6. Outros espaços designados para essas finalidades.

**§1º** – Cada um dos espaços tratados nesta Portaria terá sua própria regulamentação de uso e procedimentos, em conformidade com as normas aqui estabelecidas.

**§2º** – Não será permitida a colocação de nenhuma cadeira sobressalente em nenhuma das salas e anfiteatros.

## Capítulo III – Dias e horários de funcionamento
**Art. 6º** – Os espaços destinados a atividades acadêmicas e administrativas estarão disponíveis para utilização em dias úteis e aos sábados, das 07h às 22h, observadas as prioridades e condições previstas nesta Portaria.

**§1º** – A utilização dos espaços aos domingos, feriados e pontos facultativos, bem como fora do horário regular, somente poderá ocorrer mediante:
a) autorização prévia da Divisão Acadêmica;
b) custeio da equipe de serviços de apoio.

## Capítulo IV – Prioridades de uso
**Art. 7º** – Os espaços acadêmicos e salas administradas pela Divisão Acadêmica, por meio do Serviço de Apoio Didático (SAD), ligado ao Núcleo de Eventos (NE), destinam-se prioritariamente, nesta ordem:
1. aulas e provas da graduação;
2. aulas da pós-graduação;
3. atividades promovidas pela Diretoria da FMUSP e concursos docentes;
4. defesas de dissertação e tese;
5. cursos dos Departamentos aprovados na CCEx;
6. atividades de CAOC, CA XXI de Junho, DC, MedEnsina, Medicina Jr., EMA e demais agremiações estudantis, bem como as extensões estudantis por eles aprovadas;
7. reuniões administrativas da FMUSP e Representação dos Funcionários da FMUSP;
8. outras atividades autorizadas pela Diretoria.

## Capítulo V – Reservas
**Art. 8º** – Os pedidos de reserva de quaisquer dos espaços regidos por esta Portaria deverão ser realizados exclusivamente por meio eletrônico, por usuários cadastrados na Comunidade FMUSP, através do Sistema de Reservas da FMUSP, disponível em www.fm.usp.br.

**§1º** – O procedimento de solicitação observará as seguintes disposições:
a) O formulário eletrônico deverá ser preenchido integralmente e de forma correta, contendo todas as informações necessárias ao registro do pedido de reserva;
b) O pedido de reserva somente será considerado cadastrado após a geração do número de protocolo, que deverá ser anotado pelo solicitante para acompanhamento;
c) A confirmação ou resposta referente ao pedido será enviada pelo próprio Sistema de Reservas;
d) O espaço solicitado será preparado de acordo com as informações registradas no Sistema;
e) Situações excepcionais ou necessidades específicas deverão ser tratadas diretamente com o SAD/NE.

**§2º** – Somente usuários devidamente cadastrados no Sistema de Reservas poderão realizar solicitações.

**Parágrafo único** – A inexatidão, omissão ou inconsistência das informações prestadas pelo solicitante, constatadas a qualquer tempo, acarretará o indeferimento do pedido e/ou a suspensão de todas as reservas vinculadas à mesma atividade, sem prejuízo das demais medidas administrativas, civis ou penais cabíveis.

**Art. 9º** – O cancelamento de reservas deverá ser solicitado com antecedência mínima de três dias úteis da data de realização da atividade.

**§1º** – O cancelamento deverá ser realizado através do Sistema de Reservas da FMUSP.

**§2º** – A recorrência de não utilização do espaço sem cancelamento prévio acarretará notificação formal ao responsável, podendo resultar na aplicação das sanções previstas nesta Portaria. Considera-se recorrência a ocorrência de 3 (três) ou mais casos dentro do período de 12 (doze) meses, incluindo:
a) advertência;
b) multa, quando aplicável;
c) suspensão temporária de novas reservas.

## Capítulo VI – Do acesso, responsabilidades e sanções
**Art. 10º** – O responsável pela aula/evento deverá comparecer ao SAD/NE com 10 minutos de antecedência para orientações e retirada de chaves.

**Art. 11º** – O uso inadequado poderá acarretar:
1. advertência;
2. multa;
3. suspensão temporária;
4. bloqueio de reservas por até 1 ano.

## Capítulo VII – Realocação de espaços
**Art. 12º** – Identificada a necessidade e mediante autorização da Divisão Acadêmica e da Diretoria, o SAD/NE realizará a realocação da atividade para outro espaço equivalente, comunicando a alteração aos responsáveis pela reserva.

## Capítulo VIII – Das isenções
**Art. 13º** – A reserva poderá ser autorizada **sem cobrança** nos seguintes casos:
1. aulas e provas da graduação e pós-graduação;
2. atividades acadêmicas das Comissões da FMUSP sem cobrança aos participantes;
3. concursos públicos e reuniões administrativas;
4. atividades estudantis (CAOC, CA XXI de Junho, DC, EMA, MedEnsina, Medicina Jr., ligas acadêmicas) sem cobrança ou com cobrança apenas para custeio da realização do evento;
5. atividades acadêmicas de outras unidades da USP, sem cobrança;
6. atividades acadêmicas ou científicas em parceria com instituições públicas ou privadas, a critério da Diretoria.

**Parágrafo único** – Havendo cobrança de taxa de inscrição por participante, a isenção da taxa de utilização do espaço ficará condicionada à apresentação prévia, pelo responsável pelo evento, de demonstrativo financeiro estimado que comprove que os valores a serem arrecadados se destinam exclusivamente ao custeio da realização da atividade. **A isenção do espaço não abrange os custos de equipe técnica de áudio e vídeo**, que são devidos em qualquer caso e devem constar obrigatoriamente do demonstrativo financeiro. O demonstrativo será analisado e aprovado pela Divisão Acadêmica antes da confirmação da reserva.

## Capítulo IX – Das taxas de utilização
**Art. 14º** – Estarão sujeitas ao pagamento de taxa de utilização todas as atividades ou reservas que não se enquadrem nas hipóteses de isenção previstas no Artigo 13º desta Portaria.

**§1º** – A taxa de utilização será definida pela Divisão Acadêmica em documento específico aprovado pela Diretoria da FMUSP.

**§2º** – A taxa deverá ser recolhida à Fundação Faculdade de Medicina (FFM) com antecedência mínima de 30 (trinta) dias da data do evento, após a autorização de uso.

**§3º** – A reserva somente será confirmada mediante entrega ao Serviço de Apoio Didático (SAD/NE) de cópia do comprovante de pagamento da referida taxa.

**§4º** – As taxas poderão incluir valores referentes a:
a) uso do espaço;
b) uso de equipamentos;
c) equipe técnica e/ou serviços de apoio;
d) utilização em horários extraordinários (finais de semana, feriados, pontos facultativos ou fora do expediente).

**§5º** – Pedidos de redução ou isenção da taxa de utilização deverão ser encaminhados ao SAD/NE, por meio de documento assinado pelos responsáveis pelo evento, contendo justificativa detalhada, e serão analisados pela Divisão Acadêmica e submetidos à decisão da Diretoria.

**§6º** – Situações não previstas serão avaliadas pelo SAD/NE e decididas pela Diretoria da FMUSP.

**§7º** – Os valores das taxas de utilização serão reajustados anualmente, de acordo com a variação do Índice de Preços ao Consumidor – FIPE (IPC-FIPE).

**Art. 15º** – As unidades pertencentes ao Sistema FMUSP/HC, Universidade de São Paulo (USP), Secretaria de Estado da Saúde (SES) e Instituto Adolfo Lutz terão desconto de 25% (vinte e cinco por cento) sobre as taxas de utilização dos espaços regidos por esta Portaria.

**§1º** – O desconto previsto no caput não se aplica aos Centros de Estudo.

**§2º** – O pagamento das taxas com desconto deverá ser realizado por transferência entre Grupos de Despesa (CGs), não sendo permitido o pagamento por meio de Centro de Estudos.

**Art. 16º** – Eventos com inscrições ou taxas de participação acima de R$ 150,00 (cento e cinquenta reais), ou que contem com patrocinadores, deverão prever em seu planejamento financeiro os seguintes custos:
1. custo do espaço, que poderá ser isento caso o evento se enquadre nas hipóteses previstas no Artigo 13º desta Portaria;
2. custo da equipe técnica de áudio e vídeo, conforme valores definidos em portaria vigente.

**Art. 17º** – Unidades ou áreas com eventos pendentes de pagamento ou em situação de inadimplência terão suas reservas vigentes canceladas e ficarão impedidas de realizar novas reservas até a regularização integral da situação financeira junto à FFM.

**§1º** – O SAD/NE será comunicado pela FFM sobre as situações de inadimplência para as providências cabíveis.

## Capítulo X – Dos equipamentos e equipe técnica
**Art. 18º** – Os espaços regidos por esta Portaria dispõem de equipamentos de áudio e vídeo incluídos na reserva.

**§1º** – Nos finais de semana, feriados e pontos facultativos, a utilização dos equipamentos de áudio e vídeo exigirá a presença de equipe técnica especializada, composta por no mínimo 2 (dois) técnicos, podendo esse número ser ampliado conforme o porte e as necessidades do evento.

**§2º** – Os valores relativos à equipe técnica de que trata o §1º serão definidos conforme portaria vigente e deverão ser recolhidos à FFM previamente à realização do evento.

**Art. 19º** – A montagem do evento deverá ser previamente reservada no Sistema de Reservas da FMUSP, sendo considerada parte integrante da utilização do espaço.

**§1º** – Sobre o período de montagem incidirá o custo das horas reservadas, conforme tabela de taxas vigente.

**§2º** – A presença de equipe técnica é obrigatória durante toda a montagem do evento, sem possibilidade de dispensa, com valores definidos conforme portaria vigente.

**§3º** – O não cumprimento das exigências de montagem previstas neste artigo poderá implicar a suspensão da atividade, sem prejuízo das demais sanções previstas nesta Portaria.

## Capítulo XI – Fluxo da utilização de espaços para atividades não ligadas ao ensino e pesquisa no âmbito da FMUSP
**Art. 20º** – Toda e qualquer atividade realizada nas dependências da FMUSP que não integre os currículos de graduação, os programas de pós-graduação, a residência médica ou as linhas de pesquisa da FMUSP — incluindo, entre outras, eventos, encontros, simpósios, congressos, seminários, debates, palestras, workshops, campanhas, ações institucionais e demais atividades correlatas — deverá, obrigatoriamente, solicitar autorização prévia mediante pedido formal endereçado à Comissão de Cultura e Extensão Universitária (CCEx).

**§1º** – A solicitação deverá ser formalizada e conterá, no mínimo:
a) data da atividade;
b) objeto da atividade;
c) programação completa;
d) público-alvo estimado;
e) horário de início e término;
f) previsão de uso de espaços, equipamentos, apoio técnico;
g) identificação dos responsáveis pela atividade.

**§2º** – Após manifestação da CCEx quanto ao mérito da atividade, o pedido será encaminhado ao SAD/NE, para análise operacional, verificação de disponibilidade dos espaços e demais requisitos técnicos.

**§3º** – A utilização dos espaços dependerá do cumprimento das seguintes etapas:
a) autorização da CCEx;
b) análise de viabilidade operacional pelo SAD/NE;
c) aprovação da Divisão Acadêmica;
d) homologação da Diretoria da FMUSP, quando aplicável.

**Art. 21º** – As atividades tratadas neste Capítulo estarão sujeitas ao pagamento de taxas de utilização, conforme estabelecido no Capítulo IX – Das Taxas de Utilização, salvo nas hipóteses de isenção previstas no Capítulo VIII – Das Isenções.

**§1º** – A taxa deverá ser recolhida à Fundação Faculdade de Medicina (FFM), nos prazos e condições definidas pela Divisão Acadêmica.

**§2º** – A reserva somente será considerada efetivada após apresentação ao SAD/NE do comprovante de recolhimento da taxa correspondente, quando exigida.

## Capítulo XII – Disposições finais
**Art. 22º** – A realização das atividades estará condicionada ao cumprimento de todas as normas operacionais, de segurança, logística e uso dos espaços estabelecidas pelo SAD/NE, Divisão Acadêmica e Diretoria da FMUSP.

**§1º** – Além do que é previsto pela legislação em vigor e pelo Regimento Geral da Universidade de São Paulo, o não cumprimento das normas estabelecidas nesta Portaria e das regulamentações de procedimentos acarretará penalidades determinadas pela Diretoria da FMUSP, conforme a gravidade da ocorrência, podendo incluir:
a) advertência verbal ou escrita;
b) restrição de acesso aos espaços regidos por esta Portaria, de forma temporária ou definitiva.

**§2º** – Os casos omissos ou situações excepcionais serão avaliados pelo SAD/NE e encaminhados à Divisão Acadêmica e à Diretoria da FMUSP para deliberação.

**Art. 23º** – É expressamente proibido o comércio e o consumo de bebidas alcoólicas em quaisquer dos eventos realizados nos espaços regidos por esta Portaria, devendo constar tal compromisso no formulário de requisição de reserva.

**Art. 24º** – Esta Portaria entra em vigor na data de sua assinatura, revogadas as disposições em contrário.

Em 02 de junho de 2026. Prof. Dr. Paulo Manuel Pêgo Fernandes, Vice-Diretor da FMUSP.

# Portaria nº 2794, de 02 de junho de 2026
Dispõe sobre o estabelecimento de valores de referência para reserva e utilização dos espaços didáticos e áreas de apoio da Faculdade de Medicina da Universidade de São Paulo (FMUSP).

O Vice-Diretor da Faculdade de Medicina da Universidade de São Paulo, Professor Doutor Paulo Manuel Pêgo Fernandes, usando de suas atribuições legais e regimentais,

CONSIDERANDO o disposto na Portaria FMUSP nº 2747/2025, que disciplina o uso dos átrios e ambientes de apoio da FMUSP;

CONSIDERANDO o disposto na Portaria FMUSP nº 2753/2025, que estabelece as normas gerais de uso dos espaços didáticos, administrativos e de apoio da FMUSP, inclusive quanto às taxas de utilização;

CONSIDERANDO a necessidade de atualização dos valores fixados pela Portaria FMUSP nº 2557/2022, vigentes desde maio de 2022, sem reajuste até o presente momento,

RESOLVE:

**Art. 1º – Do objeto** – O presente instrumento estabelece os valores de referência para cobrança por hora relativos à reserva e utilização dos espaços didáticos e das áreas de apoio da FMUSP, bem como os critérios gerais de cobrança, descontos e acréscimos, para aplicação no âmbito do Núcleo de Eventos da Divisão Acadêmica.

**Art. 2º – Dos valores dos espaços didáticos** – Ficam estabelecidos os seguintes valores para reserva dos espaços didáticos, observada a cobrança mínima de 2 (duas) horas:
- **Teatro da FMUSP:** R$ 625,00 / hora
- **Anfiteatros:** R$ 375,00 / hora
- **Salas de aula e salas de reunião:** R$ 125,00 / hora

**§1º** – Sobre cada reserva de espaço didático será acrescida automaticamente 1 (uma) hora antes do início e 1 (uma) hora após o término, destinadas à organização e preparação do espaço pela equipe técnica, sendo esses períodos incluídos no cômputo total cobrado.

**§2º** – Os valores estabelecidos no caput serão reajustados anualmente, de acordo com a variação do Índice de Preços ao Consumidor – FIPE (IPC-FIPE).

**Art. 3º – Dos valores das áreas de apoio** – Ficam estabelecidos os seguintes valores para reserva das áreas de apoio:
- **Átrio:** R$ 1.500,00 / hora (por cada Átrio)
- **Área de vivência / terraço – 5º andar:** R$ 1.200,00 / hora
- **Foyer do Teatro:** R$ 500,00 / dia
- **Hall de transição – 4º andar:** R$ 500,00 / dia
- **Copa – 5º andar:** R$ 450,00 / dia
- **Copa do Teatro:** R$ 300,00 / dia

**§1º** – O período de utilização das áreas de apoio, incluindo montagem e desmontagem, será cobrado conforme o Art. 3º.

**§2º** – O período de pernoite, assim entendido o intervalo sem uso ativo do espaço entre o encerramento das atividades de um dia e o início das atividades do dia seguinte, não será cobrado, desde que o espaço permaneça reservado para continuidade do evento.

**§3º** – Os valores estabelecidos no caput serão reajustados anualmente, de acordo com a variação do Índice de Preços ao Consumidor – FIPE (IPC-FIPE).

**Art. 4º – Dos critérios de cobrança e descontos** – A cobrança pela utilização dos espaços observará os seguintes critérios:
I. Eventos institucionais da FMUSP ou eventos estudantis, sem cobrança de inscrição e sem patrocínio, serão isentos de cobrança, nos termos das Portarias vigentes.
II. Eventos estudantis com aprovação do Centro Acadêmico Oswaldo Cruz (CAOC), do Departamento Científico (DC), do Centro Acadêmico XXI de Junho (CA XXI), da Extensão Médica Acadêmica (EMA), do MedEnsina, da Medicina Jr. ou de ligas acadêmicas vinculadas à FMUSP, sem patrocinadores e com cobrança de inscrição destinada exclusivamente à cobertura de custos operacionais, poderão ter isenção de cobrança do espaço, mediante análise do Núcleo de Eventos e aprovação da Divisão Acadêmica, não sendo a isenção extensiva aos custos de equipe técnica de áudio e vídeo, que são devidos em qualquer caso.

**Parágrafo único** – Eventos que contarem com qualquer forma de patrocínio, incluindo patrocínio financeiro, cessão de produtos, serviços ou espaços por terceiros, estarão sujeitos à cobrança integral dos espaços utilizados, incluindo áreas de apoio destinadas à instalação de estandes ou exposições.

III. As unidades pertencentes ao Sistema FMUSP/HC, Universidade de São Paulo (USP), Secretaria de Estado da Saúde (SES) e Instituto Adolfo Lutz terão desconto de 25% (vinte e cinco por cento) aplicado automaticamente sobre os valores de utilização dos espaços, não sendo cumulativo com os demais descontos previstos neste artigo.
IV. Eventos com cobrança de inscrição e/ou patrocínio estarão sujeitos à cobrança integral dos valores estabelecidos nesta Portaria, devendo o organizador prever em seu planejamento financeiro o custo do espaço — que poderá ser isento caso se enquadre nas hipóteses previstas nesta Portaria — e o custo da equipe técnica, conforme portaria vigente.

**Art. 5º – Do uso de salas de aula para coffee break** – É vedada a utilização das salas de aula para realização de coffee break, refeições ou serviços de alimentação em geral.

**§1º** – Excetuam-se da vedação prevista no caput as salas de uso interativo abaixo relacionadas, nas quais o uso com coffee break poderá ser autorizado pelo Núcleo de Eventos:
- **Sala 2366 / 2368** – Sala do Futuro;
- **Sala 2223** – Sala Design Thinking;
- **Sala 1357**.

**§2º** – Nas salas referidas no §1º, quando autorizadas para uso com coffee break, será aplicado adicional de 20% (vinte por cento) sobre o valor/hora da respectiva sala, destinado a compensar os custos operacionais decorrentes de limpeza reforçada, reorganização do espaço e maior desgaste do mobiliário e da infraestrutura.

**Art. 6º – Das disposições operacionais** – A aplicação dos valores, descontos e acréscimos previstos nesta Portaria observará as seguintes disposições:
I. As solicitações de reserva e a aplicação dos valores e descontos previstos nesta Portaria observarão os fluxos, prazos e critérios definidos nas Portarias FMUSP vigentes, cabendo ao Núcleo de Eventos (NE) a análise técnica e o encaminhamento para aprovação pela Divisão Acadêmica.
II. Situações excepcionais ou não previstas nesta Portaria serão analisadas pelo Núcleo de Eventos e deliberadas pela Divisão Acadêmica.

**Art. 7º – Da vigência** – Esta Portaria entra em vigor na data de sua assinatura, revogando-se as disposições em contrário, em especial a Portaria FMUSP nº 2557/2022.

Em 02 de junho de 2026. Prof. Dr. Paulo Manuel Pêgo Fernandes, Vice-Diretor da FMUSP.$regulamento$
WHERE "id" = 1 AND "updated_by_id" IS NULL;
