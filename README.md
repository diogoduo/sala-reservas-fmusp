# Sistema de Reserva de Salas — FMUSP

Sistema para alunos, docentes e funcionários da Faculdade de Medicina da USP
solicitarem salas, e para a Secretaria analisar cada pedido, alocar a sala mais
adequada e aprovar ou rejeitar — com avisos por e-mail em cada etapa.

**React · TypeScript · Tailwind CSS v4 · Node.js/Express · Prisma · PostgreSQL**

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="docs/screenshots/admin-analise-escuro.png">
  <img src="docs/screenshots/admin-analise-claro.png" alt="Painel do Admin analisando uma solicitação: as salas aparecem ordenadas da mais para a menos adequada, com a recomendada em destaque e o botão de aprovar as 8 datas da série">
</picture>

## Telas

| | |
|---|---|
| ![Login do Dev Mode com as contas de teste](docs/screenshots/login.png) | ![Minhas reservas: próxima reserva em destaque, contagem de pendentes e aprovadas e as datas de cada pedido](docs/screenshots/minhas-reservas.png) |
| **Login** (Dev Mode, simulando a Senha Única USP) | **Minhas reservas** — status de cada data e cancelamento |
| ![Escolha do tipo de atividade em cards](docs/screenshots/escolher-atividade.png) | ![Formulário com recorrência semanal, prévia das datas da série e resumo lateral](docs/screenshots/formulario.png) |
| **Reservar uma sala** — cada atividade tem seu formulário | **Formulário** — prévia das datas da série e checklist ao vivo |
| ![Agenda do Auditório com o dia 15 selecionado mostrando o horário reservado](docs/screenshots/agenda.png) | ![Fila de solicitações do Admin com filtros por status](docs/screenshots/admin-solicitacoes.png) |
| **Consultar salas** — agenda com os horários de cada dia | **Solicitações** — fila do Admin, com filtros e busca |

<p align="center">
  <img src="docs/screenshots/celular-minhas-reservas.png" width="260" alt="Minhas reservas no celular, com barra de navegação inferior">
  &nbsp;&nbsp;
  <img src="docs/screenshots/celular-analise-escuro.png" width="260" alt="Análise de solicitação no celular, no tema escuro">
</p>
<p align="center"><em>No celular, com tema claro e escuro.</em></p>

<sub>Screenshots feitos com dados de demonstração.</sub>

## Estrutura

Monorepo simples com duas aplicações independentes:

```
sala-reservas-fmusp/
├── docker-compose.yml        # PostgreSQL 16 + Mailpit (SMTP de desenvolvimento)
├── backend/                  # Node.js + Express + TypeScript + Prisma
│   ├── prisma/
│   │   ├── schema.prisma
│   │   ├── migrations/       # init + db_constraints (CHECKs e exclusão de sobreposição)
│   │   └── seed.ts
│   └── src/                  # app, config/env (zod), rotas, middleware de erros
└── frontend/                 # React + TypeScript + Vite + Tailwind v4
```

## Pré-requisitos
Node.js ≥ 20 e Docker (ou um PostgreSQL 14+ com a extensão `btree_gist` disponível).

## Primeiros passos

```bash
# 1. Banco e servidor SMTP de desenvolvimento
docker compose up -d

# 2. Back-end
cd backend
cp .env.example .env
npm install
npx prisma migrate dev      # aplica as duas migrations e gera o client
npm run db:seed             # recursos, salas e usuários fictícios
npm run dev                 # http://localhost:3333/api/health

# 3. Front-end (outro terminal)
cd frontend
cp .env.example .env
npm install
npm run dev                 # http://localhost:5173
```

A página inicial mostra o status da API e do banco — se ambos aparecerem como
`ok`/`up`, a Fase 1 está funcionando.

## Fase 2 — Autenticação

- Sessão via cookie httpOnly assinado (JWT com `SESSION_SECRET`), sem tabela de sessão.
- `AUTH_MODE=mock` (padrão em dev): tela "Dev Mode" lista os usuários do seed e
  permite logar em um clique, ou digitar um e-mail novo de domínio autorizado
  para simular o primeiro acesso. **Bloqueado automaticamente se `NODE_ENV=production`.**
- `AUTH_MODE=senhaunica`: fluxo OAuth 1.0a completo (`request_token` → tela de
  autorização da USP → `access_token` → dados do usuário), implementado em
  `backend/src/auth/senhaunica.ts` sem depender de biblioteca de terceiros
  (assinatura HMAC-SHA1 feita à mão em `oauth1.ts`, testada contra os vetores
  do RFC 5849).
  ⚠️ **O endpoint de dados do usuário (`SENHAUNICA_USER_INFO_PATH`) não pôde
  ser confirmado com uma fonte oficial** — os três primeiros passos seguem o
  padrão OAuth 1.0a documentado publicamente, mas esse último path é uma
  estimativa. Ajuste-o no `.env` (ou peça o valor certo à STI/USP) antes de
  testar com um consumidor real.
- `AUTH_MODE=oidc`: rota reservada, responde `501 Not Implemented` por enquanto.
- Domínio de e-mail e papel (`ADMIN_EMAILS`) são validados/atribuídos no
  primeiro login, nos três modos — reaproveitando a mesma regra do `CHECK`
  do banco.

## Fase 3 — CRUD administrativo de salas e recursos

- `GET /api/rooms` e `GET /api/resources`: qualquer usuário autenticado pode
  listar (necessário para a busca do solicitante na Fase 5).
- `POST`/`PATCH`/`DELETE` em `/api/rooms` e `/api/resources`: só Admin.
- Vínculo sala↔recurso (`room_resources`, com quantidade) é editado junto com
  a sala: o `PATCH` substitui todo o conjunto vinculado quando `resources` é enviado.
- Excluir uma sala com reservas/séries vinculadas é bloqueado pelo banco (FK
  `ON DELETE RESTRICT`) e devolve um erro amigável sugerindo marcar a sala como
  **Inativa** em vez de excluir.
- Front-end: painel do Admin com abas **Salas** e **Recursos**
  (`frontend/src/components/admin/`), visível só para `role = ADMIN`.
  Solicitantes veem um aviso de que a busca de salas chega na Fase 5.

## Fase 4 — Motor de reservas

Tudo em `backend/src/reservations/` + `POST /api/reservations`:

- **Regras** (`rules.ts`): horário 07:30–22:30 (calculado no fuso `APP_TIMEZONE`
  via `Intl.DateTimeFormat`, testado manualmente contra os limites), duração
  30 min–15 h, e antecedência mínima — implementada como **72 horas corridas**
  até o início do evento (não como "3 dias de calendário"; ajuste em
  `MIN_ADVANCE_MS` se a intenção for outra).
- **Recorrência** (`recurrence.ts`): usa a biblioteca `rrule` para expandir a
  regra RFC 5545 em ocorrências concretas, com um teto de 260 ocorrências e um
  horizonte padrão de 2 anos quando a série não tem `until`.
  ⚠️ Não tive como rodar `npm install`/testar essa integração de verdade neste
  ambiente (sem rede) — a lógica segue a API documentada da lib, mas vale
  conferir na prática assim que instalar as dependências.
- **Conflitos** (`conflicts.ts`): compara cada ocorrência com reservas
  `PENDING`/`APPROVED` e com `room_blocks` da mesma sala, usando a mesma
  semântica de intervalo `[início, fim)` da exclusion constraint do banco.
- **Concorrência**: a criação com sala definida roda em uma transação que
  primeiro trava a linha da sala (`SELECT ... FOR UPDATE`), só então checa
  conflito e grava — e ainda captura a violação da exclusion constraint como
  rede de segurança final, caso o banco pegue algo que a checagem em
  aplicação não pegou (o código de erro citado aqui antes, `P2004`, estava
  errado — ver Fase 6).
- **Solicitação parcial**: se alguma data da recorrência colidir, a API responde
  `409 RESERVATION_CONFLICT` com `{ conflictingDates, availableDates }` **sem
  criar nada**. O cliente reenvia o mesmo POST com `skipDates` contendo as
  datas conflitantes para criar só as livres (ou ajusta os horários e tenta de novo).
- Reserva **sem sala definida** (`roomId` omitido) pula checagem de conflito —
  fica para o Admin alocar e então aprovar (Fase 6).
- `GET /api/reservations` e `GET /api/reservations/:id`: só para eu conseguir
  testar a Fase 4 sem front-end ainda. O painel "Minhas Reservas" completo
  (com cancelamento) é a Fase 8; a tela de calendário/formulário é a Fase 5.

## Fase 5 — Calendário e formulário de solicitação (front-end)

- **Backend:** novo `GET /api/rooms/:id/availability?from=&to=` — lista os
  intervalos ocupados (reservas ativas + bloqueios) de uma sala num período.
  É só leitura para orientar a busca; não substitui a checagem de conflito
  feita dentro da transação em `POST /api/reservations`.
- **Busca de salas** (`frontend/src/components/solicitante/RoomSearch.tsx`):
  filtros por tipo, capacidade mínima e prédio; cada sala pode expandir um
  **calendário mensal simples** (`AvailabilityCalendar.tsx`) que pinta os dias
  com pelo menos um horário ocupado.
  ⚠️ Troquei o FullCalendar (sugerido lá na Fase 0) por uma grade de calendário
  feita à mão com React + Tailwind puro. Motivo: integrar o FullCalendar (+
  plugins timeGrid/RRule) é complexo o bastante para eu não conseguir validar
  sem rodar `npm install` e ver renderizar de verdade — e sem isso, o risco de
  entregar algo quebrado era alto. Se quiser mesmo o FullCalendar (visual mais
  rico, visão por hora), me avisa que eu troco numa iteração à parte.
- **Formulário de solicitação** (`ReservationForm.tsx`): todos os campos do
  espec — sala (ou "sem preferência"), data/horário, recorrência (dias da
  semana + semanal/quinzenal + até quando), título, descrição, nº de
  participantes, checklist de recursos, observações para TI, aceite do
  regulamento.
  - **Validação em tempo real** (`lib/reservationValidation.ts`) espelha as
    regras do back-end (horário, duração, antecedência, capacidade) só para
    feedback imediato — o servidor continua sendo a fonte da verdade.
  - Em caso de **conflito** (recorrência com alguma data ocupada), mostra as
    datas conflitantes e um botão para confirmar só as livres, usando o
    mecanismo `skipDates` da Fase 4.

## Correção pós-Fase 5 — solicitante não escolhe a sala

Ajuste de regra de negócio: o solicitante **não** seleciona uma sala específica.
Ele descreve a necessidade (participantes, recursos, finalidade) e a reserva
nasce com `roomId = null`; o Admin aloca a sala mais adequada ao aprovar (Fase 6).

- `POST /api/reservations` não aceita mais `roomId` nem `skipDates` — sempre
  cria com sala em branco. A checagem de conflito e o lock de linha
  (`src/reservations/conflicts.ts`) saíram da criação e ficam prontos para
  serem reaproveitados na Fase 6, quando o Admin escolhe a sala.
- Front-end: `ReservationForm` não tem mais campo de sala; `RoomSearch` virou
  um catálogo só de consulta (mostra tipos, capacidades, recursos e a agenda
  de cada sala), sem ação de "solicitar nesta sala".
- Validação de capacidade contra a sala saiu do formulário (não há sala ainda
  para comparar) — volta a fazer sentido no painel de aprovação da Fase 6.

## Fase 6 — Aprovação e alocação de salas (Admin)

Back-end em `backend/src/routes/admin.ts` (montado em `/api/admin`, só Admin);
front-end na nova aba **Solicitações** do painel do Admin
(`frontend/src/components/admin/RequestsAdmin.tsx` e `ReviewPanel.tsx`).

- `GET /api/admin/reservations?status=`: fila de solicitações com os dados do
  solicitante. O front agrupa as ocorrências de uma mesma série num card só.
- `GET /api/admin/reservations/:id/room-options?scope=`: avalia todas as salas
  **Ativas** e devolve já ordenadas da mais para a menos adequada
  (`src/reservations/allocation.ts`): comporta os participantes → livre em
  todas as datas → tem todos os recursos pedidos → menos datas em conflito →
  menor capacidade que comporta. É só leitura; a checagem que vale é a da aprovação.
- `POST /api/admin/reservations/:id/approve` `{ roomId, scope, skipConflicting? }`:
  aloca a sala e aprova numa transação só — trava a linha da sala
  (`SELECT … FOR UPDATE`), exige sala Ativa, valida capacidade
  (`CAPACITY_EXCEEDED`) e checa conflito com reservas ativas e bloqueios.
  Recurso faltando **não** bloqueia (o Admin pode providenciar um equipamento
  móvel); só aparece como aviso na tela.
  - Série com conflito parcial: `409 RESERVATION_CONFLICT` com
    `{ conflictingDates, availableDates }`, sem aprovar nada. Reenviando com
    `skipConflicting: true`, aprova as datas livres e deixa as ocupadas
    **pendentes**, para alocar em outra sala depois.
- `POST /api/admin/reservations/:id/reject` `{ reason, scope }`: justificativa
  obrigatória. Rejeitar libera o horário (a exclusion constraint só considera
  PENDING/APPROVED).
- **Escopo:** `single` age só na ocorrência da URL; `series` age em todas as
  ocorrências da série que ainda estão pendentes e não começaram.
- **Duas pessoas revisando ao mesmo tempo:** o `UPDATE` só altera linhas ainda
  `PENDING` e confere quantas mudou; se alguém revisou antes, a transação é
  desfeita e a API responde `409 RESERVATION_NOT_PENDING`.
- **Rede de segurança:** se a exclusion constraint do banco pegar uma
  sobreposição que a checagem em aplicação deixou passar, a API responde
  `409 RESERVATION_CONFLICT`.
  ⚠️ Correção do que a Fase 4 dizia: o Prisma 6 **não** devolve `P2004` nesse
  caso. A violação (SQLSTATE `23P01`) chega como
  `PrismaClientUnknownRequestError`, com o código só dentro da mensagem —
  conferido na prática contra o Postgres local (`isOverlapViolation` em
  `conflicts.ts`).
- `conflicts.ts` agora carrega a ocupação em 2 consultas (reservas + bloqueios
  da janela inteira) em vez de 2 por ocorrência, e aceita ids a ignorar: uma
  solicitação antiga que já nasceu com sala (de antes da correção pós-Fase 5)
  não conflita consigo mesma ao ser aprovada naquela sala. Na fila, essas
  aparecem com "Sala indicada".
- Aprovar e rejeitar avisam o solicitante por e-mail (ver Fase 7).

## Formulários por tipo de atividade

Ao clicar em **Reservar uma sala**, o solicitante escolhe primeiro a atividade
— Graduação, Pós-Graduação, Cultura e Extensão, Concurso ou Defesa/Dissertação
— e cada uma tem seus próprios campos em **Informações da reserva**. O
agendamento de datas e a lista de recursos (o catálogo cadastrado pelo Admin)
são iguais para todos os tipos.

- **Banco:** `reservations.activity_type` (enum) + `activity_details` (JSONB),
  na migration `activity_types`. Ficam nulos nas solicitações anteriores.
- **Validação por tipo** em `src/schemas/reservation.ts` (zod
  `discriminatedUnion` em `activityType`). Campos de outros tipos são
  descartados, assim como o que não se aplica: taxa de atividade gratuita,
  descrição de "Outros" quando outro tipo de reserva foi marcado.
- `src/reservations/activities.ts` converte cada formulário para as colunas
  comuns que a fila do Admin e a checagem de capacidade usam:
  - **título:** `código — disciplina` na Graduação/Pós,
    `Defesa de Doutorado — candidato` na Defesa, título informado nos demais;
  - **nº de pessoas:** nº de alunos, de participantes ou público previsto.
- **Front:** `ActivityFields.tsx` (campos de cada tipo) e `lib/activities.ts`
  (rótulos e linhas de detalhe no card do Admin). Trocar de tipo no meio do
  preenchimento não apaga o que já foi digitado.
- **Opções fixas:** "Tipo" da Graduação (Aula teórica, Aula prática, Prova,
  Reposição de aula, Outro), "Ano" (1º ao 6º) e "Nível" da Defesa (Mestrado,
  Mestrado Profissional, Doutorado).
- **Concurso:** "Público previsto" é o total de pessoas na sala e é o número
  usado na checagem de capacidade.
- ⚠️ **Código de disciplina:** por enquanto só o formato é conferido (3 letras
  + 4 números, ex.: `MCM0101`). Próximo passo: tabela de disciplinas no banco
  para validar de verdade — e transformar "Responsável pela disciplina" em
  select, como no sistema antigo.

### Recursos com quantidade e detalhe

O catálogo de recursos inclui os equipamentos do formulário antigo do
Anfiteatro: Chromebook, Webconferência, Bloqueio de internet para prova,
Equipamento pessoal e Outro equipamento, além dos que já existiam. O "Nenhum"
do formulário antigo não virou recurso: basta não marcar nada.

- Cada recurso pode **pedir quantidade** (`requests_quantity`, ex.: Computador,
  Chromebook) e/ou **pedir um detalhe** com texto de exemplo (`detail_prompt`,
  ex.: "Ex.: Zoom, Teams, Google Meet" na Webconferência). O Admin configura
  isso na aba **Recursos**.
- `reservations.requested_resources` passou de uma lista de ids para
  `[{ resourceId, quantity?, detail? }]`; a migration `resource_request_options`
  converte o que já existia. O back-end guarda quantidade e detalhe só nos
  recursos que pedem isso (`src/reservations/requested-resources.ts`).
- **Na escolha da sala** (Fase 6), a quantidade conta: uma sala com 1
  computador aparece como "Computador de Apoio: só 1 (pedido: 2)". Só pesam
  recursos que alguma sala tem cadastrado; os demais (Chromebook,
  Webconferência, Equipamento pessoal…) são itens avulsos que a TI
  providencia e não dependem da sala.
- Recurso com **opções fixas** (`detail_options`) mostra um select em vez de
  texto livre, e a escolha é obrigatória: é o caso do "Bloqueio de internet
  para prova", em que se escolhe a plataforma liberada (Canvas, e-Disciplinas
  ou TestPortal).

### Testar a API pelo terminal

`reserva.json` (aula avulsa de Graduação) e `recorrente.json` (disciplina de
Pós, toda quinta) são exemplos prontos para enviar com `curl.exe`. No
PowerShell:

```powershell
# login (Dev Mode) — guarda o cookie de sessão em cookies.txt
'{"email":"aluno@usp.br"}' | curl.exe -c cookies.txt -H "Content-Type: application/json" --data-binary "@-" http://localhost:3333/api/auth/mock/login

curl.exe -b cookies.txt -H "Content-Type: application/json" --data-binary "@reserva.json" http://localhost:3333/api/reservations
curl.exe -b cookies.txt -H "Content-Type: application/json" --data-binary "@recorrente.json" http://localhost:3333/api/reservations
```

Os `resourceId` dos exemplos são do banco local em que foram escritos. Em
outro banco, pegue os seus em `GET /api/resources`.

## Fase 8 — Minhas Reservas

A aba **Minhas reservas** passou a ser a tela inicial do solicitante
(`frontend/src/components/solicitante/MyReservations.tsx`).

- Lista as próprias solicitações em **Próximas** e **Anteriores**. As datas de
  uma série ficam num card só, e cada data mostra o próprio status: sala
  alocada (aprovada), "aguardando alocação" (pendente), justificativa
  (rejeitada) ou data do cancelamento.
- `POST /api/reservations/:id/cancel` `{ scope }`: o solicitante cancela uma
  data (`single`) ou todas as próximas datas ativas da série (`series`).
  - Vale só para reservas **pendentes ou aprovadas que ainda não começaram**
    (`RESERVATION_IN_PAST` / `RESERVATION_NOT_CANCELLABLE` nos outros casos).
  - Só o dono pode cancelar: para outras pessoas, a API responde 404, sem
    revelar que a reserva existe.
  - Cancelar **libera o horário da sala** na hora: a exclusion constraint só
    considera PENDING/APPROVED.
- Na fila do Admin, a aba **Canceladas** mostra quando o solicitante cancelou.
- Cancelar avisa a Secretaria por e-mail (ver Fase 7).

## Fase 7 — Avisos por e-mail

Nodemailer em `backend/src/mail/`. Em dev, os e-mails vão para o **Mailpit**
do `docker-compose` e aparecem em http://localhost:8025 — nada sai de verdade.

| Quando | Para quem | O quê |
|---|---|---|
| Solicitação enviada | solicitante | confirmação, com as datas |
| Solicitação enviada | Secretaria (todos os Admins) | nova solicitação para analisar |
| Aprovada | solicitante | sala e datas (e quantas datas da série seguem em análise) |
| Aprovada, com recursos pedidos | TI (`TI_EMAIL_ADDRESS`) | o que preparar, onde e quando |
| Rejeitada | solicitante | justificativa |
| Cancelada pelo solicitante | Secretaria | horário liberado |
| Cancelada, e já estava aprovada com recursos | TI | recursos dispensados |

- **Um e-mail por ação, não por data:** aprovar uma série de 10 datas gera um
  e-mail com as 10 datas.
- Datas formatadas no fuso `APP_TIMEZONE`, não no do servidor.
- Cada e-mail tem versão em texto e em HTML, geradas do mesmo conteúdo
  (`layout.ts`). O que o usuário digita (título, justificativa, observações) é
  escapado no HTML.
- **Envio fora da transação e sem bloquear a resposta** (`sendInBackground`):
  a reserva já foi gravada, então uma falha de SMTP só vai para o log, sem
  virar erro para quem clicou. Em produção, o próximo passo seria uma tabela de
  *outbox* com novas tentativas.

## Interface

Redesign completo do front-end, responsivo do celular ao computador, com tema
claro e escuro.

- **Tokens de cor semânticos** em `frontend/src/index.css` (`bg-surface`,
  `text-muted`, `bg-primary`…): o tema escuro troca os valores num lugar só,
  sem `dark:` espalhado pelos componentes. Os pares de texto e fundo têm
  contraste de pelo menos 4,5:1 nos dois temas. O tema pode ser claro, escuro
  ou seguir o sistema, e é aplicado antes de o React montar (sem "piscar").
- **Componentes próprios** em `components/ui/`: botão, campos com rótulo,
  dica e erro, selos, cards, controle segmentado, avatar e o diálogo/painel
  lateral sobre o `<dialog>` nativo (Esc fecha, o foco fica preso, o fundo
  fica inerte).
- **Navegação com URL por tela** (react-router 7): `/minhas-reservas`,
  `/reservar`, `/salas`; `/admin/solicitacoes`, `/admin/salas`,
  `/admin/recursos`. Barra lateral a partir de 1024 px, barra inferior no
  celular. O Admin vê na navegação quantas solicitações estão pendentes.
  ⚠️ Em produção, o servidor estático precisa devolver o `index.html` para
  qualquer caminho desconhecido (fallback de SPA).
- **Interações:**
  - toasts para o resultado das ações;
  - diálogo de confirmação próprio no lugar do `window.confirm`;
  - painel lateral de análise com a sala "Recomendada";
  - escolha da atividade em cards;
  - prévia das datas de uma série e checklist do que falta, no formulário;
  - recursos em cards com ícone e quantidade;
  - calendário que mostra os horários ocupados do dia clicado;
  - esqueletos de carregamento.
- **Acessibilidade:**
  - foco sempre visível e alvos de toque de 44 px;
  - rótulos em todos os campos e ícones decorativos escondidos dos leitores
    de tela;
  - toasts anunciados via `aria-live`;
  - foco levado ao conteúdo a cada troca de página;
  - respeito ao "reduzir movimento" do sistema.
- **Ícones:** Phosphor. **Fontes:** Inter e Plus Jakarta Sans, servidas pelo
  próprio app (Fontsource), sem chamadas a serviços externos.

## Decisões de modelagem (Fase 1)

- **Reservas recorrentes** ficam em `reservation_series` (regra RRule) e cada
  ocorrência vira uma linha em `reservations`. Assim conflito, aprovação e
  cancelamento funcionam data a data.
- **Sobreposição** é barrada em duas camadas: transação com `SELECT … FOR UPDATE`
  na sala (Fase 4) e *exclusion constraint* no PostgreSQL (`btree_gist`).
- **Horário, duração, aceite de termos e domínio de e-mail** também têm `CHECK`
  no banco (migration `db_constraints`), além da validação amigável no back-end.
- `reservations.room_id` é **opcional**: sem sala preferencial, nada é
  pré-bloqueado, e o Admin só consegue aprovar depois de alocar uma sala.
- Prisma fixado na série **6.x** (schema clássico com `url = env(...)`).
