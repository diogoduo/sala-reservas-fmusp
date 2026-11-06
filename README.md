# Sistema de Reserva de Salas — FMUSP

Sistema para alunos, docentes e funcionários da Faculdade de Medicina da USP
solicitarem salas, e para o SAD (Serviço de Apoio Didático) analisar cada pedido, alocar a sala mais
adequada e aprovar ou rejeitar — com avisos por e-mail em cada etapa.

**React · TypeScript · Tailwind CSS v4 · Node.js/Express · Prisma · PostgreSQL**

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="docs/screenshots/admin-analise-escuro.png">
  <img src="docs/screenshots/admin-analise-claro.png" alt="Painel do SAD analisando uma solicitação: as salas aparecem ordenadas da mais para a menos adequada, com a recomendada em destaque e o botão de aprovar as 8 datas da série">
</picture>

## Telas

| | |
|---|---|
| ![Login do Dev Mode com as contas de teste](docs/screenshots/login.png) | ![Minhas reservas: próxima reserva em destaque, contagem de pendentes e aprovadas e as datas de cada pedido](docs/screenshots/minhas-reservas.png) |
| **Login** (Dev Mode, simulando a Senha Única USP) | **Minhas reservas** — status de cada data e cancelamento |
| ![Escolha do tipo de atividade em cards](docs/screenshots/escolher-atividade.png) | ![Formulário com recorrência semanal, prévia das datas da série e resumo lateral](docs/screenshots/formulario.png) |
| **Reservar uma sala** — cada atividade tem seu formulário | **Formulário** — prévia das datas da série e checklist ao vivo |
| ![Agenda do Auditório com o dia 15 selecionado mostrando o horário reservado](docs/screenshots/agenda.png) | ![Fila de solicitações do Admin com filtros por status](docs/screenshots/admin-solicitacoes.png) |
| **Consultar salas** — agenda com os horários de cada dia | **Solicitações** — fila do SAD, com filtros e busca |
| ![Salas livres: 3 salas livres no dia 15/10 das 19h às 21h e o Auditório ocupado pela Semana de Saúde Pública](docs/screenshots/salas-livres.png) | ![Cadastro de salas com estatísticas, filtros por status e cards de cada sala](docs/screenshots/admin-salas.png) |
| **Salas livres** — "qual sala está livre dia 15, das 19 às 21?" | **Salas** — cadastro com capacidade, status e recursos |

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
├── render.yaml               # deploy da demonstração (Render + banco no Neon)
├── .github/workflows/ci.yml  # typecheck, build e testes a cada push na main e em PRs
├── backend/                  # Node.js + Express + TypeScript + Prisma
│   ├── prisma/
│   │   ├── schema.prisma
│   │   ├── migrations/       # histórico do schema: CHECKs, exclusão de sobreposição, portarias…
│   │   ├── seed.ts           # salas, recursos e usuários fictícios
│   │   ├── seed-demo.ts      # base de demonstração inteira inventada
│   │   └── import-fmusp.ts   # catálogo real da FMUSP (dados fora do git)
│   ├── src/                  # app, config/env (zod), rotas, regras das reservas
│   └── test/                 # testes (Vitest): unit/ sem banco, api/ com PostgreSQL
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
npm run db:deploy           # aplica todas as migrations de prisma/migrations
npx prisma generate         # gera o client do Prisma
npm run db:seed             # recursos, salas e usuários fictícios
npm run db:import-fmusp     # opcional: salas reais e fotos (precisa de prisma/data/fmusp.json e FM/)
npm run dev                 # http://localhost:3333/api/health

# 3. Front-end (outro terminal)
cd frontend
cp .env.example .env
npm install
npm run dev                 # http://localhost:5173
```

A página inicial mostra o status da API e do banco — se ambos aparecerem como
`ok`/`up`, a Fase 1 está funcionando.

## Testes automatizados

Vitest no back-end, em `backend/test/`:

```bash
cd backend
npm run test:unit   # só as regras, sem banco
npm test            # tudo; precisa do PostgreSQL do docker compose
```

- **`unit/`** (sem banco): recorrência (quarta às 21:00, sábado às 23:00,
  montagem, quinzenal, horário de verão, limites e cerca de 3 mil combinações
  comparadas com a prévia do formulário), feriados e prazo de 3 dias úteis
  (conferidos contra as cópias do front-end), horário regular, duração,
  antecedência, montagem, ranking de salas e conflitos.
- **`api/`** (rotas de verdade): permissões, id malformado, aprovação
  concorrente na mesma sala, pedido vencido, criação de série e login pela
  Senha Única contra um servidor OAuth falso. Usam o banco `reservas_test`
  (criado e migrado sozinho no mesmo PostgreSQL; outro endereço em
  `TEST_DATABASE_URL`), que é apagado a cada arquivo. Por segurança, só rodam
  num banco local cujo nome termina em `_test`.
- Os testes não leem o `.env` e não enviam e-mail.

O GitHub Actions (`.github/workflows/ci.yml`) roda typecheck, build e os testes
do back-end (com um PostgreSQL próprio) e typecheck e build do front-end a cada
push na `main` e em todo pull request. O deploy no Render continua manual.

## Fase 2 — Autenticação

- Sessão via cookie httpOnly assinado (JWT com `SESSION_SECRET`), sem tabela de sessão.
- `AUTH_MODE=mock` (padrão em dev): tela "Dev Mode" lista os usuários do seed e
  permite logar em um clique, ou digitar um e-mail novo de domínio autorizado
  para simular o primeiro acesso. **Bloqueado automaticamente se `NODE_ENV=production`.**
- `AUTH_MODE=senhaunica`: fluxo OAuth 1.0a completo, implementado em
  `backend/src/auth/senhaunica.ts` sem depender de biblioteca de terceiros
  (assinatura HMAC-SHA1 feita à mão em `oauth1.ts`). Segue o protocolo das
  bibliotecas da comunidade (`uspdev/senhaunica` e `uspdev/senhaunica-socialite`):
  `POST /request_token` → `/authorize?oauth_token=…&callback_id=…` (o
  `SENHAUNICA_CALLBACK_ID` cadastrado na USP) → `POST /access_token` →
  `POST /usuariousp`, assinado para POST. O e-mail é o `emailUspUsuario` ou,
  se vier vazio, o `emailPrincipalUsuario`. Erros da USP chegam ao navegador
  só como `SENHAUNICA_UPSTREAM_ERROR`; o corpo da resposta fica no log.
  ⚠️ **Ainda não testado com um consumidor real da USP.** O fluxo passa nos
  testes contra um servidor OAuth falso que confere as assinaturas
  (`test/api/senhaunica.test.ts`), mas só vale como validado depois de um
  login de verdade com `SENHAUNICA_KEY`, `SENHAUNICA_SECRET` e
  `SENHAUNICA_CALLBACK_ID`.
- `AUTH_MODE=oidc`: rota reservada, responde `501 Not Implemented` por enquanto.
- O usuário é identificado pelo nº USP e, se não houver cadastro com ele, pelo
  e-mail (cadastro antigo). Quem troca de e-mail na USP continua sendo o mesmo
  usuário.
- Domínio de e-mail e papel (`ADMIN_EMAILS`) são validados/atribuídos no
  primeiro login, nos três modos — reaproveitando a mesma regra do `CHECK`
  do banco. Depois do primeiro login, `ADMIN_EMAILS` não muda mais o papel.
- Em produção, o servidor não sobe com o `SESSION_SECRET` de exemplo do
  `.env.example` (quem conhece o valor poderia forjar uma sessão de admin). O
  `render.yaml` gera um segredo próprio (`generateValue`).

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

- **Regras** (`rules.ts`): horário de funcionamento (hoje 07h–22h, de segunda a
  sábado, fora feriados — ver [Portarias 2793 e 2794](#portarias-fmusp-nº-2793-e-27942026);
  calculado no fuso `APP_TIMEZONE` via `Intl.DateTimeFormat`), duração
  30 min–15 h, e antecedência mínima — implementada como **72 horas corridas**
  até o início do evento (não como "3 dias de calendário"; ajuste em
  `MIN_ADVANCE_MS` se a intenção for outra).
- **Recorrência** (`recurrence.ts`): usa a biblioteca `rrule` para expandir a
  regra RFC 5545 em ocorrências concretas. A regra é avaliada no horário local
  de `APP_TIMEZONE`: `BYDAY=WE` é quarta em São Paulo, mesmo numa aula às
  21:00, que em UTC já é quinta. A API só aceita o formato que o formulário
  gera (`FREQ=WEEKLY;INTERVAL=1 a 4;BYDAY=…`, sem dias repetidos), uma série
  vai até no máximo 1 ano depois da primeira data e tem no máximo 260 datas.
  Datas em feriado saem da série (`withoutHolidays`, em `portaria.ts`). A
  série e todas as datas são gravadas numa transação só, com os e-mails
  depois do commit.
- **Conflitos** (`conflicts.ts`): `overlaps` usa a mesma semântica de
  intervalo `[início, fim)` da exclusion constraint do banco (uma reserva pode
  começar quando outra termina); `loadBusyIntervals` carrega, em 2 consultas,
  as reservas `PENDING`/`APPROVED` e os `room_blocks` das salas no período;
  `findConflictingOccurrences` aponta as datas que colidem; `lockRoomForUpdate`
  trava a sala; `isOverlapViolation` reconhece a violação da constraint.
- **Concorrência**: toda gravação com sala (aprovação, reserva e alteração
  feitas pelo SAD) roda numa transação que primeiro trava a linha da sala
  (`SELECT ... FOR UPDATE`), só então checa conflito e grava, e ainda captura
  a violação da exclusion constraint como rede de segurança final (o código de
  erro citado aqui antes, `P2004`, estava errado — ver Fase 6).
- **Solicitação parcial** (`skipDates`) e pedido com sala: saíram na correção
  pós-Fase 5. O solicitante não escolhe sala, então o pedido não checa
  conflito; a aprovação parcial de uma série fica na Fase 6 (`skipConflicting`).
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
  (`SELECT … FOR UPDATE`), exige sala Ativa e checa conflito com reservas
  ativas e bloqueios. Capacidade e recurso faltando **não** bloqueiam: o SAD
  pode passar por cima das portarias (a tela avisa qual artigo está sendo
  violado), e o Admin pode providenciar um equipamento móvel. Pedido cuja
  data já passou não pode ser aprovado (`RESERVATION_IN_PAST`), só rejeitado;
  a tela avisa e desabilita o botão de aprovar.
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

### Mostrar o app rodando localmente (sem deploy)

Com o back-end e o front no ar, um túnel temporário da Cloudflare gera um link
público `https://….trycloudflare.com` que aponta para o seu computador. Não
precisa de conta, e o link dura enquanto o comando estiver rodando:

```powershell
cloudflared tunnel --url http://localhost:5173
```

O `vite.config.ts` libera só os domínios de túnel (`.trycloudflare.com` e
`.devtunnels.ms`, do VS Code); qualquer outro host continua bloqueado. Quem
tiver o link usa o Dev Mode e os dados do banco local, inclusive como Admin.

### Demonstração online (Render + Neon)

Para deixar o sistema no ar sem depender do computador ligado:

- **Render**, plano grátis: um serviço web só. O Express serve a API e também
  o front-end compilado (`frontend/dist`), com fallback para as rotas do
  React. Tudo fica na mesma origem, então o cookie de sessão funciona sem
  CORS. A configuração está em `render.yaml`.
- **Neon**, plano grátis: o PostgreSQL, com a extensão `btree_gist`. As fotos
  ficam no banco, então o servidor não precisa de disco.

O modo demonstração é ligado por variáveis de ambiente:

| Variável | Na demonstração | Para quê |
|---|---|---|
| `ACCESS_CODE` | código combinado | Antes de qualquer tela, o site pede esse código. Sem ele, a API responde `ACCESS_CODE_REQUIRED` (só `/api/health` e `/api/access` ficam abertos). O cookie guarda um HMAC do código, e trocar o código derruba os acessos antigos. São 10 tentativas erradas por IP a cada 15 min. |
| `DEMO_MODE` | `true` | Libera o login de teste (`AUTH_MODE=mock`) em produção, desde que `ACCESS_CODE` esteja definido. Sem essa combinação, o servidor não sobe. |
| `BREVO_API_KEY` | chave do Brevo | Envia os e-mails pela API HTTP do Brevo (grátis, 300/dia), e não por SMTP, que hospedagens grátis costumam bloquear. O remetente de `MAIL_FROM` precisa estar verificado no Brevo. |
| `MAIL_REDIRECT_TO` | seu e-mail | Todo e-mail da demonstração vai para este endereço, com o destinatário original no assunto, porque as contas de teste (`aluno@usp.br`…) podem ser caixas reais da USP. Com `DEMO_MODE` e sem esta variável, elas não recebem nada. |
| `MAIL_REDIRECT_EXCEPT` | e-mail da TI | Endereços que recebem direto, sem redirecionar (ex.: o e-mail real da TI, também em `TI_EMAIL_ADDRESS`). |
| `FRONTEND_URL` | (vazio) | Vem sozinho de `RENDER_EXTERNAL_URL`. |

Para conferir a configuração de e-mail, use `POST /api/admin/test-email {"to": "..."}` (só o SAD). Ele envia na hora e devolve o erro do Brevo, se houver.

**Passo a passo:**

1. No Neon, crie um projeto na região **AWS US East (N. Virginia)**, a mesma
   do serviço no Render. Copie a connection string.
2. Carregue o banco do seu computador. Os dados reais e as fotos saem daqui,
   e não do GitHub. Em `backend/`, crie `.env.neon` (fora do git) com
   `DATABASE_URL=<connection string>` e rode:

   ```bash
   export $(grep DATABASE_URL .env.neon)   # no PowerShell: $env:DATABASE_URL="..."
   npx prisma migrate deploy
   npm run db:seed          # recursos e contas de teste
   npm run db:import-fmusp  # salas reais, inventário, notebooks e fotos
   ```
3. No Render, crie um **Blueprint** a partir deste repositório. Ele lê o
   `render.yaml` e pede `DATABASE_URL` (a mesma do Neon) e `ACCESS_CODE`.
4. Abra o endereço `https://….onrender.com` e digite o código.

No plano grátis, o serviço "dorme" depois de 15 minutos sem acesso, e o
primeiro acesso depois disso leva cerca de 1 minuto. Antes de apresentar, abra
o site um pouco antes.

### Base de demonstração (fictícia)

Para apresentar o sistema sem dados da faculdade, `prisma/seed-demo.ts` monta
uma base inteira inventada:

- 20 salas (teatro, anfiteatros, salas de aula, laboratórios, reunião,
  conselho e multiuso, uma delas em reforma);
- no lugar das fotos, ilustrações desenhadas pelo próprio script
  (`prisma/demo/illustrations.ts`), com a legenda "imagem ilustrativa";
- inventário com modelos e patrimônios fictícios (`PAT-…`) e 12 notebooks;
- pessoas fictícias (e-mails `…demo@usp.br`) além das contas de teste;
- cerca de 100 reservas numa janela em volta do dia em que o comando roda
  (por padrão, 7 dias de histórico e 4 semanas à frente), de segunda a sábado
  e fora dos feriados, em todas as situações: aprovadas, pendentes, alteradas,
  rejeitadas, canceladas, ausências registradas e uma reserva do SAD fora das
  portarias (num domingo). No futuro ficam sempre pedidos pendentes, um pedido
  de Cultura e Extensão em análise, uma reserva alterada e séries semanais.

O regulamento e os recursos não são apagados. Rode no dia da apresentação ou
na véspera: o que o script deixa "no futuro" depende da hora em que ele roda.

```bash
npm run db:seed-demo                                   # num banco vazio (só com as migrations)
npm run db:seed-demo -- --reset                        # APAGA e recria (janela: hoje −7 dias a hoje +4 semanas)
npm run db:seed-demo -- --reset --start=2026-11-09 --days=35   # outra janela
npm run db:seed-demo -- --reset --month=2026-10        # o mês inteiro
npm run db:seed-demo -- --preview=pasta                # só gera as ilustrações em PNG
npm run db:seed-demo -- --reset --salas-reais          # salas reais (fmusp.json + FM/) com as reservas fictícias
```

**Salas reais na demonstração (`--salas-reais`, Fase 9):** no lugar das 20
salas fictícias, carrega as salas reais com fotos, inventário e notebooks (o
mesmo do `db:import-fmusp`, então precisa do `prisma/data/fmusp.json` e da
pasta `FM/`) e põe as mesmas reservas fictícias nelas: cada sala fictícia vira
uma sala real parecida (`REAL_ROOM_FOR` em `prisma/seed-demo.ts`). Com
`--reset`, as salas reais e as áreas de apoio que já estão no banco ficam (as
fotos não são carregadas de novo, e rodar outra vez leva segundos); as outras
salas são apagadas. É o modo da apresentação: salas de verdade e uma Agenda
cheia, com pessoas e pedidos fictícios.

O `--reset` apaga todas as reservas e séries, as salas (com fotos e
inventário), os bloqueios, os notebooks, as sanções, o histórico e os usuários
que não são as 4 contas de teste, e volta a numeração dos protocolos para 000001.

Sem `--reset`, o script se recusa a rodar num banco que já tem salas ou
reservas. Para a apresentação, o caminho mais seguro é um banco separado no
mesmo projeto do Neon (`CREATE DATABASE reservas_demo`, depois
`prisma migrate deploy` e o seed com a `DATABASE_URL` apontando para ele). No
Render, basta trocar o nome do banco na `DATABASE_URL` para alternar entre a
base fictícia e a real.

## Fase 8 — Minhas Reservas

A aba **Minhas reservas** passou a ser a tela inicial do solicitante
(`frontend/src/components/solicitante/MyReservations.tsx`).

- Lista as próprias solicitações em **Próximas** e **Anteriores**. As datas de
  uma série ficam num card só, e cada data mostra o próprio status: sala
  alocada (aprovada), "aguardando alocação" (pendente), justificativa
  (rejeitada) ou data do cancelamento.
- `POST /api/reservations/:id/cancel` `{ scope }`: o solicitante cancela uma
  data (`single`) ou todas as próximas datas ativas da série (`series`).
  - A reserva **aprovada** é cancelada pelo sistema até **3 dias úteis antes**
    da data (Portaria 2793, Art. 9º; `CANCEL_DEADLINE_PASSED` depois disso —
    aí só o SAD cancela). O pedido ainda **pendente** pode ser retirado até o
    horário começar. Numa série, as datas aprovadas fora do prazo continuam de
    pé (`keptIds` na resposta).
  - Só o dono pode cancelar: para outras pessoas, a API responde 404, sem
    revelar que a reserva existe.
  - Cancelar **libera o horário da sala** na hora: a exclusion constraint só
    considera PENDING/APPROVED.
- Na fila do Admin, a aba **Canceladas** mostra quando o solicitante cancelou.
- Cancelar avisa o SAD por e-mail (ver Fase 7).

## Alterar uma reserva (solicitante)

- Em **Minhas reservas**, cada reserva pendente ou aprovada tem o botão
  **Alterar** até **3 dias úteis antes** da data (o mesmo prazo do
  cancelamento, Portaria 2793, Art. 9º). Ele abre o mesmo formulário, já
  preenchido (`/minhas-reservas/:id/editar`).
- `PUT /api/reservations/:id` recebe os campos do formulário mais `{ scope }`:
  - `single` altera só aquela data;
  - `series` altera esta e as próximas datas da série, com a mesma mudança de
    data e horário em todas.

  Valem as regras da criação (horário de funcionamento, antecedência), mais:
  - o tipo de atividade não muda (`ACTIVITY_TYPE_LOCKED`), nem a recorrência;
  - depois do prazo de 3 dias úteis, a API recusa com `EDIT_TOO_SOON`.
- A reserva volta para **Pendente**, marcada como alterada
  (`modified_by_requester_at`), e a sala é liberada. `previous_snapshot` guarda
  como ela estava na última análise do SAD: status, horário, sala e
  participantes.
- O SAD vê as alteradas na aba **Alteradas** de Solicitações, e não em
  Pendentes. O painel de análise mostra um quadro "antes × agora" e já deixa
  marcada a sala anterior, se ela ainda servir.
- E-mails:
  - confirmação ao solicitante;
  - aviso ao SAD;
  - aviso à TI, se a reserva estava aprovada e tinha recursos pedidos.

## O SAD reserva, altera e cancela qualquer reserva

- **Reservar** (`POST /api/admin/reservations`, tela `/admin/reservar`): a
  reserva feita pelo SAD **não passa pela fila**. Ela já nasce aprovada, na
  sala escolhida.
  - É o mesmo formulário, com a sala obrigatória e a repetição semanal ou
    quinzenal.
  - Não precisa dos 3 dias de antecedência.
  - A sala é travada, e o sistema confere o horário de funcionamento, a
    capacidade e o conflito em **todas** as datas. Se alguma estiver ocupada,
    a API responde `RESERVATION_CONFLICT` com as datas e nada é gravado.
  - Atalhos que abrem o formulário já preenchido:
    - "Nova reserva" em Solicitações e na Agenda (com o dia);
    - o "+" de cada sala na linha do tempo da Agenda (sala e dia);
    - "Reservar" em cada sala livre de **Salas livres** (sala, dia e horário
      pesquisados).
  - A TI é avisada se houver recursos ou observações. O próprio SAD não
    recebe "reserva aprovada".
- Em **Solicitações**, na **Agenda** e no painel de uma reserva, o SAD tem
  **Alterar** e **Cancelar** para toda reserva pendente ou aprovada que ainda
  não terminou.
- **Alterar** (`PUT /api/admin/reservations/:id`, tela
  `/admin/reservas/:id/editar`): o mesmo formulário do solicitante, sem as
  travas dele.
  - Não precisa dos 3 dias de antecedência, só de um horário que ainda não
    passou.
  - Pode trocar o tipo de atividade e, numa reserva aprovada, a sala.
  - **Não volta para análise**: a aprovada continua aprovada. Por isso vale a
    mesma checagem de conflito e de capacidade da aprovação, com a sala
    travada (`SELECT … FOR UPDATE`). Se a sala estiver ocupada, a API responde
    `RESERVATION_CONFLICT`.
  - Numa série, dá para alterar só a data ou esta e as próximas.
  - Grava `modified_by_admin_at`. O solicitante recebe um e-mail com o "antes"
    e o novo horário; a TI também, se a reserva estava aprovada com recursos.
- **Cancelar** (`POST /api/admin/reservations/:id/cancel`) exige o **motivo**,
  que vai para o solicitante por e-mail e aparece em Minhas reservas
  ("Cancelada pelo SAD: …"). O horário fica livre na hora.
  - `cancelled_by_id` registra quem cancelou: o solicitante ou o SAD.

## Agenda (SAD)

Tela `/admin/agenda`: tudo o que acontece num dia.

- **Dia a dia**: setas, "Hoje", escolha da data e um calendário do mês com a
  quantidade de reservas ativas em cada dia (em destaque os dias com
  pendências).
- **Reservas do dia**, filtradas por situação: pendentes, alteradas,
  aprovadas, canceladas e rejeitadas. Cada uma abre o painel com todos os
  dados, mais Analisar, Alterar e Cancelar.
- **Salas no dia**: linha do tempo de 07h a 22h (estendida quando há reserva
  em horário extraordinário) com cada sala ativa. Mostra as
  reservas aprovadas, as pendentes com sala e os bloqueios, e separa as salas
  ocupadas das livres o dia todo.
- A data e a reserva aberta ficam na URL (`?data=2026-10-15&reserva=…`).
- API (só o SAD): `GET /api/admin/agenda?date=AAAA-MM-DD` (o dia no fuso
  `APP_TIMEZONE`) e `GET /api/admin/agenda/month?month=AAAA-MM` (contagem por
  dia e situação).

A **agenda de cada sala** (Consultar salas → Ver sala e agenda, e Salas
livres) agora mostra a reserva inteira do dia escolhido:
- todos veem o título e o tipo de atividade (Graduação, Cultura e Extensão…);
- o SAD vê também o solicitante, os participantes, os recursos, as
  observações e a descrição, com um atalho para a Agenda.

## Regulamento (portarias)

- O "Li e concordo" do formulário de reserva abre o **regulamento**, com o
  texto e os PDFs das portarias. O botão "Li e concordo" do diálogo já marca o
  aceite.
- O SAD edita tudo em **Regulamento** (`/admin/regulamento`), sem depender de
  deploy:
  - o texto aceita parágrafos, títulos com `## `, listas com `- ` e
    `**negrito**`;
  - os PDFs das portarias são anexados ali mesmo e ficam guardados no banco.
- O solicitante lê o regulamento em `/regulamento`.
- API: `GET /api/regulamento`; só para o SAD, `PUT /api/regulamento`,
  `POST /api/regulamento/files?nome=…` (o corpo é o PDF) e
  `DELETE /api/regulamento/files/:id`. O PDF abre em
  `GET /api/regulamento/files/:id`.

O formulário de reserva começa **em branco**: sem data, sem horário e sem
nenhuma opção pré-marcada. O aviso de horário só aparece depois que data,
início e término são preenchidos.

## Portarias FMUSP nº 2793 e 2794/2026

As duas portarias de 02/06/2026 — **2793** (uso dos espaços) e **2794**
(valores de referência) — são as regras do sistema. O texto integral está no
Regulamento (migration `20260929000000_portarias_2793_2794`, que só substitui o
texto se o SAD ainda não o tiver editado pela tela).

**O solicitante fica preso às regras; o SAD pode passar por cima delas.** Nas
telas do SAD (Nova reserva, Alterar, Analisar), o que sai da portaria não
bloqueia: aparece um aviso dizendo qual portaria e artigo está sendo violado
(`frontend/src/lib/portarias.ts`), e o botão vira "… mesmo assim". Depois de
aprovada, a reserva continua marcada como "fora das portarias" na fila, na
Agenda e no painel. A API do SAD só recusa o que não é regra de portaria
(conflito de sala, horário no passado, duração).

**Taxas e coffee break ficaram para depois**: o formulário não pergunta sobre
coffee break nem mostra estimativa de taxa. As colunas `coffee_break` e os
campos de patrocínio/custeio/áreas de apoio continuam aceitos pela API, mas
opcionais.

Onde cada regra está:

| Regra | Como o sistema aplica |
| --- | --- |
| **Horário** (Art. 6º): dias úteis e sábados, 07h–22h | O solicitante não pede em domingo, feriado/ponto facultativo nem fora das 07h–22h. Numa série, os feriados ficam de fora (`skippedDates`). Feriados em `lib/calendar.ts` (nacionais, 9 de julho, 25 de janeiro, Carnaval, Sexta-feira Santa e Corpus Christi); pontos facultativos decretados a cada ano não entram. |
| Horário extraordinário (Art. 6º §1º) | Só o SAD reserva, com aviso do Art. 6º na tela. A reserva fica com `outside_regular_hours`, que libera o CHECK de horário do banco. Numa série do SAD, os feriados ficam de fora, a menos que ele marque "reservar também nos feriados" (`keepHolidays`). |
| **Protocolo** (Art. 8º §1º, b) | Todo pedido recebe um nº (`000123/2026`, sequência `reservation_protocol_seq`); as datas de uma série compartilham o número. Aparece na confirmação, em Minhas reservas, na fila e na Agenda do SAD e em todos os e-mails; a busca da fila aceita o protocolo. |
| Informações inexatas (Art. 8º, parágrafo único) | Aviso junto ao aceite do formulário. |
| **Cancelamento** (Art. 9º): 3 dias úteis antes | Ver [Fase 8](#fase-8--minhas-reservas) e [Alterar](#alterar-uma-reserva-solicitante). Minhas reservas mostra até quando dá para cancelar. |
| **Ausências** (Art. 9º §2º): 3 em 12 meses | O SAD registra "Não compareceu" (`POST/DELETE /api/admin/reservations/:id/no-show`) em reserva aprovada que já começou. O painel do pedido mostra as ausências do solicitante e avisa a recorrência. |
| **Sanções** (Art. 9º §2º, 11, 17, 22) | Advertência, multa ou suspensão de novas reservas — até 1 ano ou "até a regularização" (inadimplência), podendo cancelar as reservas futuras (`POST /api/admin/users/:id/sanctions`, `POST /api/admin/sanctions/:id/lift`). Suspenso não pede nem altera (`USER_SUSPENDED`). Lista das suspensões em vigor em Solicitações. |
| **Chaves** (Art. 10) | Confirmação, Minhas reservas ("retire as chaves às …") e e-mail de aprovação: comparecer ao SAD/NE 10 minutos antes. |
| **Realocação** (Art. 12) | Trocar a sala de uma reserva aprovada mostra o aviso de que depende de autorização da Divisão Acadêmica e da Diretoria. |
| **Cadeiras sobressalentes** (Art. 5º §2º) | Capacidade = cadeiras da sala; as "cadeiras extras" deixam de aparecer para o solicitante e o formulário avisa. O SAD pode alocar uma sala menor que o público, com aviso. |
| **Prioridades** (Art. 7º) | Cada pedido mostra a prioridade (1ª graduação … 8ª outras) na fila e no painel do SAD. Novo tipo **Reunião / Administrativo** (reuniões administrativas, Diretoria, Representação dos Funcionários). |
| **Montagem** (Art. 19) | Campo "Montagem" (até 4 h): o período reservado começa antes da atividade (`setup_minutes`); entra no conflito e no aviso à TI. |
| **CCEx** (Art. 20–21) | Cultura e Extensão pede programação, público-alvo, entidade organizadora (Art. 4º; externas precisam de autorização da Divisão Acadêmica), contato do responsável e a situação na CCEx. Ao aprovar (ou reservar), o SAD marca o que conferiu — autorização da CCEx, aprovação da Divisão Acadêmica, taxa paga/isenção (`approval_checklist`); o que faltar vira aviso. |
| Taxas e isenções (2793 Arts. 13–16; 2794) | Para depois (fora do formulário por enquanto). |
| Coffee break (2794 Art. 5º) | Cada espaço diz se pode ter coffee break e para quantas pessoas (Fase 9, bloco 3). O formulário ainda não pergunta: entra com o formulário de evento. |
| **Bebidas alcoólicas** (Art. 23) | Compromisso obrigatório no formulário do solicitante (`no_alcohol_commitment`). Na reserva do SAD, sem o compromisso aparece o aviso do Art. 23. |
| Equipe de áudio e vídeo (Art. 18) | Aviso no formulário para sábados, domingos e feriados (mínimo de 2 técnicos, pagos à FFM). |

## Catálogo real de salas e inventário

As salas da faculdade vêm das planilhas do SAD: cadeiras, dimensões e os
equipamentos de cada sala, com modelo e patrimônio.

- `npm run db:import-fmusp` (em `backend/`) carrega esses dados de
  `backend/prisma/data/fmusp.json`.
  - O arquivo **não fica no git**, porque os números de patrimônio são dados
    internos. Sem ele, o projeto roda com as salas fictícias do seed.
  - O import pode rodar de novo. Ele identifica a sala por prédio, andar e
    nome, substitui o inventário pelo da planilha e mantém o status que o SAD
    deu a ela.
  - As salas fictícias do seed saem do banco se nada aponta para elas. Se já
    têm reservas de teste, ficam **Inativas**.
- Cada sala tem:
  - capacidade (cadeiras da plateia), cadeiras extras e dimensões;
  - tipo: Anfiteatro, Sala de Aula, Sala de Informática, Sala de Reunião,
    Congregação/CTA ou Teatro;
  - tipo de cadeira (Escolar, Universitária fixa, Universitária móvel; pode
    ter mais de um), porta de 900 mm e **atendimento especial**. Essas
    informações aparecem para o solicitante, e a consulta de salas filtra as
    salas com atendimento especial.
- **Capacidade "a definir"**: uma sala fora de uso (em reforma, por exemplo)
  pode ficar sem capacidade. Sala **Ativa** precisa dela, porque entra na
  alocação. A API recusa com `CAPACITY_REQUIRED`, e o banco garante a mesma
  regra (`rooms_active_capacity_check`).
- Cada recurso da sala tem quantidade, modelo e patrimônio(s). O que não é um
  tipo de recurso vai em **Outros equipamentos**, em texto livre.
- **Só a equipe (SAD e NUCEV) vê modelo, patrimônio e outros equipamentos.**
  Para o solicitante, `GET /api/rooms` e `GET /api/rooms/:id` omitem esses campos.
- Recursos com `requestable = false` (nobreak, monitor, splitter…) ficam só no
  inventário:
  - não aparecem no formulário de reserva nem na consulta de salas;
  - a API recusa um pedido deles com `RESOURCE_NOT_REQUESTABLE`.
- Tela **Recursos**, aba **Inventário** (`/admin/recursos?aba=inventario`):
  - busca por patrimônio, modelo ou sala, com o termo destacado;
  - filtros por recurso e por prédio;
  - **Exportar CSV**, que abre direto no Excel;
  - **Editar**, que abre o painel da sala.
- Tela **Recursos**, aba **Notebooks** (`/admin/recursos?aba=notebooks`):
  controle de patrimônio dos notebooks do SAD, que não são reservados pelo
  sistema.
  - Dois grupos: **Backup no SAD** e **Transferidos para o NIT** (a TI da
    faculdade).
  - Cadastrar, informar o modelo, mover de um grupo para o outro, excluir e
    exportar CSV.
  - API `/api/notebooks`, só para o SAD. O import carrega os patrimônios da
    planilha e não mexe no que o SAD já editou.

## Fotos das salas

- Onde aparecem:
  - **Consultar salas**: cada card tem a foto de capa, que abre a galeria.
    **Ver sala e agenda** mostra um mosaico de fotos, a capacidade, as
    cadeiras extras, as dimensões, os recursos e a agenda.
  - **Formulário de reserva**: o bloco **Conheça as salas** mostra, com fotos,
    as salas que comportam o número de pessoas informado, da menor para a
    maior. Serve só para o solicitante ter uma ideia; quem define a sala
    continua sendo o SAD.
  - **Minhas reservas**: a sala de uma reserva aprovada tem o botão
    "N fotos".
  - Telas do SAD: miniatura da sala em Salas livres, na escolha da sala ao
    analisar um pedido e no inventário.
- **Galeria em tela cheia**: setas da tela ou do teclado, miniaturas e deslizar
  no celular. O Esc fecha só a galeria, mesmo com um painel aberto por baixo.
- API (só Admin):
  - `POST /api/rooms/:id/photos`: o corpo é o próprio arquivo
    (`Content-Type` `image/jpeg`, `image/png` ou `image/webp`, até 30 MB), com
    legenda opcional em `?caption=`;
  - `PATCH /api/rooms/:id/photos/:photoId` altera a legenda;
  - `PUT /api/rooms/:id/photos/order` define a nova ordem (a primeira é a
    capa);
  - `DELETE /api/rooms/:id/photos/:photoId` remove a foto e os arquivos.
- **Arquivos**: o back-end (sharp) gera duas versões WebP de cada foto,
  `thumb` (720 px) e `large` (1920 px), respeita a orientação do EXIF e
  descarta a original. As fotos originais (cerca de 700 MB) viraram 19 MB.
  - As versões ficam **no próprio banco** (`room_photos.thumb` e `.large`), e
    não em disco. Assim o app roda em hospedagem sem disco persistente, e o
    import manda as fotos direto para o banco. As listagens nunca carregam
    esses bytes.
  - São servidas em `/api/fotos/<id>-thumb.webp` e `-large.webp`, só para
    quem está logado.
  - Foto nova ganha um id novo, então o navegador pode guardá-las em cache
    para sempre (`immutable`).
- No painel da sala (**Salas → Editar**), o SAD adiciona várias fotos de uma
  vez, escolhe a capa, edita a legenda e remove fotos. Essas ações valem na
  hora, sem depender do "Salvar alterações".
- `npm run db:import-fmusp` também importa as fotos da pasta `FM/` (fora do
  git):
  - a legenda vem do nome do arquivo (`1104_PROJETOR_LONGE.JPG` →
    "Projetor (de longe)");
  - a foto das cadeiras vira a capa;
  - rodar de novo não duplica as fotos.

## Salas livres (SAD)

Consulta rápida para o SAD responder na hora "qual sala está livre no dia 30,
das 10 às 11?".

- `GET /api/admin/availability?start=&end=` (só Admin): cada sala ativa, livre
  ou ocupada no intervalo. Se estiver ocupada, diz por quê: reserva pendente ou
  aprovada, com título e solicitante, ou bloqueio. Um evento pode começar
  exatamente quando outro termina.
- Tela `/admin/salas-livres`:
  - dia e horário com atalhos (hoje, amanhã, 30 min / 1 h / 2 h,
    manhã / tarde / noite) e filtros de capacidade e tipo;
  - resultado atualizado enquanto se digita;
  - **Copiar resposta**, com uma frase pronta para mandar a quem perguntou;
  - agenda da sala aberta já no dia pesquisado.

  A pesquisa fica na URL, então dá para voltar a ela ou compartilhar o link.

## Fase 7 — Avisos por e-mail

Nodemailer em `backend/src/mail/`. Em dev, os e-mails vão para o **Mailpit**
do `docker-compose` e aparecem em http://localhost:8025 — nada sai de verdade.

| Quando | Para quem | O quê |
|---|---|---|
| Solicitação enviada | solicitante | confirmação, com as datas |
| Solicitação enviada | SAD (todos os Admins) | nova solicitação para analisar |
| Aprovada | solicitante | sala e datas (e quantas datas da série seguem em análise) |
| Aprovada, com recursos pedidos | TI (`TI_EMAIL_ADDRESS`) | o que preparar, onde e quando |
| Rejeitada | solicitante | justificativa |
| Cancelada pelo solicitante | SAD | horário liberado |
| Cancelada, e já estava aprovada com recursos | TI | recursos dispensados |
| Alterada pelo solicitante | solicitante | confirmação, com o novo horário |
| Alterada pelo solicitante | SAD | como estava e como ficou, para nova análise |
| Alterada, e já estava aprovada com recursos | TI | aguardar a nova aprovação |
| Alterada pelo SAD | solicitante | como estava e como ficou (continua aprovada/pendente) |
| Alterada pelo SAD, aprovada com recursos ou observações | TI | novas datas, sala e o que preparar |
| Cancelada pelo SAD | solicitante | o motivo |
| Cancelada pelo SAD, e estava aprovada com recursos | TI | recursos dispensados |

Na aprovação, a TI recebe o e-mail quando a reserva pede recursos **ou**
quando tem observações para a TI/infraestrutura, mesmo sem recursos.

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

## Fase 9 — Fundação (perfis, espaços, preços e histórico)

Primeira fase do módulo de Eventos do SAD/NUCEV: a base sobre a qual entram o
formulário de evento, o orçamento e a pré-reserva. Feita em blocos.

### Histórico (auditoria)

Tudo o que muda dados fica registrado: quem fez, quando e o que mudou.

- **Tabela `audit_logs`** (migration `audit_log`), gravada por
  `src/audit/log.ts` **na mesma transação** da alteração: se a ação falha, não
  sobra linha no histórico; se a linha não grava, a ação é desfeita.
- Cada linha tem quem fez (`actor_id` e o nome na hora, que fica mesmo se a
  pessoa for excluída), a ação (`reservation.approve`, `room.update`…), o que
  foi alterado (`entity_type` + `entity_id`), um texto para a lista e:
  - **`changes`**: só os campos que mudaram, `{ campo: { from, to } }`. Salvar
    uma sala sem mudar nada não gera linha;
  - **`details`**: o contexto (datas afetadas, motivo, escopo, sala).
- **Reservas** são registradas pelo **protocolo**: uma ação sobre uma série
  inteira gera uma linha só, com as datas em `details`. Fica registrado o
  pedido, a alteração e o cancelamento pelo solicitante; a aprovação (com a
  sala), a rejeição (com o motivo), a reserva, a alteração e o cancelamento
  pelo SAD; e as ausências.
- Também ficam registrados: salas (cadastro, alterações com o inventário,
  exclusão e fotos), recursos, regulamento (o título e se o texto mudou; o
  texto inteiro não é copiado), PDFs das portarias, notebooks e sanções. A
  suspensão que cancela reservas futuras gera uma linha por pedido cancelado.
- **API** (só o SAD): `GET /api/audit?entityType=&entityId=&actorId=&q=&from=&to=&limit=&cursor=`,
  do mais recente para o mais antigo, em páginas de até 100 (`nextCursor`).
- **Telas:**
  - **Histórico** (`/admin/historico`): busca por protocolo, sala, recurso ou
    pessoa, filtro pelo que mudou e por período (na URL). A lista é agrupada
    por dia e mostra "antes → depois" de cada campo. Nas listas, como os
    recursos de uma sala, mostra o que entrou e o que saiu;
  - **Histórico do pedido**, no painel de cada reserva (Agenda, Solicitações e
    Analisar): todas as ações sobre aquele protocolo.
- O que aconteceu antes desta fase não tem histórico.
- `db:seed-demo --reset` também apaga o histórico.

### Perfis e permissões

Três papéis e, por pessoa, permissões que o SAD concede.

| Papel | O que faz |
|---|---|
| **Solicitante** | Pede reservas e acompanha as próprias. |
| **SAD** | Tudo: analisa, aloca, aprova, reserva, altera e cancela; salas, recursos, regulamento, sanções e pessoas. |
| **NUCEV** (Núcleo de Eventos) | Acompanha as mesmas telas do SAD (Agenda, Solicitações, Salas livres, Histórico, inventário das salas) **só para consultar**. No módulo de Eventos, vai cuidar da análise ao encerramento; a pré-reserva, a reserva confirmada e as alterações de espaço ficam com o SAD. |

- **Cada tipo de atividade, menos Reunião, tem uma permissão** em
  `users.permissions` (migrations `roles_permissions`,
  `permission_open_types` e `permission_defaults`). Sem ela, a API recusa
  com `ACTIVITY_NOT_ALLOWED`, e o formulário nem mostra o tipo (mas explica a
  quem pedir). O SAD reserva qualquer tipo pelas próprias telas.

  | Permissão | Quem tem |
  |---|---|
  | Graduação, Pós-Graduação, Defesa (`REQUEST_UNDERGRADUATE`, `REQUEST_GRADUATE`, `REQUEST_DEFENSE`) | Só quem recebeu do SAD |
  | Cultura e Extensão, Concurso (`REQUEST_CULTURE_EXTENSION`, `REQUEST_PUBLIC_EXAM`) | Todo cadastro, por padrão; o SAD pode tirar (ex.: de quem só pede defesas) |
  | Reunião | Todos, sem permissão |

  - As reservas que já existiam continuam valendo. Ninguém ganhou Graduação,
    Pós ou Defesa automaticamente; quem já tinha cadastro ganhou Cultura e
    Extensão e Concurso, que antes eram abertos a todos.
  - ⚠️ **Docentes:** o plano é liberar cada docente para as próprias
    disciplinas, a partir da planilha de disciplinas e docentes responsáveis
    (pendente). Até lá, o SAD concede a permissão à mão.
- **Vale na hora:** o papel e as permissões são lidos do banco a cada
  requisição (`attachUser`), e não do cookie da sessão. Mudar o papel de
  alguém ou tirar uma permissão não espera a pessoa entrar de novo. Cadastro
  excluído perde a sessão.
- **Na API:** as rotas de `/api/admin` aceitam o NUCEV só em consultas
  (`staffReadOnly`: GET passa, qualquer ação responde `403`). Notebooks,
  pessoas e as edições de salas, recursos e regulamento são só do SAD.
- **Tela Pessoas** (`/admin/pessoas`, só o SAD): busca por nome, e-mail ou
  nº USP, filtro por papel e por permissão, e **Editar acesso** (papel e
  permissões). **Cadastrar pessoa** dá o acesso antes do primeiro login: na
  Senha Única, a pessoa é reconhecida pelo e-mail e já entra com ele.
  - Ninguém do SAD tira o próprio acesso de SAD (`SELF_DEMOTION`), para não
    ficar sem ninguém por engano.
  - API: `GET /api/admin/users?q=&role=&permission=&cursor=`,
    `POST /api/admin/users` e `PATCH /api/admin/users/:id { role?, permissions? }`.
    Toda mudança vai para o Histórico, com o antes e o depois.
- **Contas de teste** (seed e base de demonstração; fictícias, com ".demo" no
  e-mail): Sueli (pede só Defesa, Pós-Graduação e Reunião), Juliana (só
  Graduação, Pós-Graduação e Reunião), Vanessa e Maria (NUCEV), além das que
  já existiam. O Docente Teste tem o padrão mais Graduação e Pós. Na base de
  demonstração, quem tem pedidos de Graduação, Pós ou Defesa recebe a
  permissão correspondente. A tela de login mostra primeiro o SAD, o NUCEV e
  quem tem permissões fora do padrão; a lista de Pessoas mostra só o que foge
  do padrão ("Pedir Graduação", "Sem Concurso").

### Espaços: áreas de apoio e coffee break

O cadastro de salas passa a ser o cadastro de **espaços**, a fonte que o
formulário de evento e o orçamento vão usar.

- **Tipo novo "Área de apoio"** (`SUPPORT_AREA`; migrations
  `support_area_type` e `room_event_fields`). Área de apoio pode ficar Ativa
  sem capacidade (o átrio não tem limite cadastrado); sala, não (CHECK
  `rooms_active_capacity_check`). Na sugestão de sala do SAD e em Salas
  livres, as áreas de apoio vêm depois das salas.
- **Campos novos** em cada espaço, na tela da sala (seção "Eventos e coffee
  break") e no Histórico:

  | Campo | Para quê |
  |---|---|
  | Pode ter coffee break (`coffee_allowed`) | Substitui a regra que estava fixa no código (Portaria 2794, Art. 5º) |
  | Máximo de pessoas no coffee (`coffee_capacity`) | Vazio = a capacidade do espaço |
  | Indicado para eventos acima de (`recommended_above`) | Ex.: átrios, acima de 250. É orientação, não capacidade máxima |
  | Exige autorização da Diretoria Executiva (`requires_board_approval`) | Ex.: átrios. O SAD vê o aviso ao analisar e ao reservar |
  | Regras de uso (`usage_rules`) | Texto que aparece para quem consulta o espaço |

- **Consultar salas:** filtro "Só espaços com coffee break"; o painel do espaço
  mostra o coffee, a indicação de público, o aviso da Diretoria e as regras.
- **Carga das áreas de apoio** (`backend/prisma/support-areas.ts`, do
  documento SAD/NUCEV §6 e da Portaria 2794, Art. 3º): Átrio esquerdo (SVO) e
  Átrio do relógio de ponto (acima de 250, com autorização da Diretoria), Hall
  de transição do 4º andar (60), Área de coffee do 5º andar (250), Hall do
  Teatro (Foyer, 255), Hall do NINA (100), Copa do 5º andar e Copa do Teatro. Só cria
  o que falta e não mexe no que o SAD editou. Entra no `db:import-fmusp` e no
  `db:seed-demo`; num banco que já tem as salas, `npm run db:espacos`.
- A migration marca como "pode ter coffee" as salas 2366, 2368, 2223 e 1357
  (Portaria 2794, Art. 5º §1º), com a regra dos 20% nas regras de uso.
- Os átrios ficam no Subsolo; o Hall do Teatro é o Foyer do Teatro da Portaria
  2794 (cadastrado como "Hall do Teatro (Foyer)"). Nas listas, as áreas de
  apoio vêm depois das salas.
- ⚠️ **A confirmar:** se a "Área de coffee do 5º andar" é a área de
  vivência/terraço da Portaria 2794. O pedido automático de autorização à
  Diretoria (e-mail e acompanhamento) entra com o módulo de Eventos.


### Preços (Portaria 2794)

Tabela de preços com **vigência**: o reajuste anual é uma tabela nova, a partir
de uma data, e a anterior continua guardada (o orçamento usa a tabela que vale
na data do evento). Migration `price_tables`, que já carrega a Portaria 2794
(02/06/2026) e liga cada espaço à sua categoria.

| Categoria | Valor |
|---|---|
| Teatro da FMUSP | R$ 625,00/hora |
| Anfiteatros | R$ 375,00/hora |
| Salas de aula e salas de reunião (inclui informática, Congregação e CTA) | R$ 125,00/hora |
| Átrio (por átrio) | R$ 1.500,00/hora |
| Área de vivência / terraço – 5º andar | R$ 1.200,00/hora |
| Foyer do Teatro (o "Hall do Teatro") | R$ 500,00/dia |
| Hall de transição – 4º andar | R$ 500,00/dia |
| Copa – 5º andar | R$ 450,00/dia |
| Copa do Teatro | R$ 300,00/dia |
| Hall do NINA · Área de coffee do 5º andar | a definir |

- **Regras da tabela** (também com vigência): cobrança mínima de 2 h e +1 h
  antes e +1 h depois em cada dia, nos espaços didáticos (Art. 2º); coffee
  break em sala de aula +20% (Art. 5º §2º); desconto institucional de 25%,
  não cumulativo (Art. 4º III). Pernoite não é cobrado (Art. 3º §2º).
  ⚠️ Isenções (Art. 4º I e II): regra a definir.
- **Modelo:** `price_categories` (o que se cobra: unidade por hora ou por
  dia, espaço didático ou não), `price_tables` (vigência e regras) e
  `price_entries` (valor em centavos; nulo = a definir). Cada espaço aponta
  para uma categoria (`rooms.price_category_id`); espaço novo recebe a
  categoria pelo tipo (ou, nas áreas de apoio, pelo nome), no cadastro, no
  import e na base de demonstração.
- **Tela Preços** (`/admin/precos`): o SAD edita os valores e as regras e
  cria a tabela do reajuste (copiada da atual); uma tabela futura pode ser
  excluída, a que já vale não. O NUCEV só consulta. Toda mudança vai para o
  Histórico, com o valor antes e depois.
- **Na sala:** todos veem "Locação para eventos" com o valor vigente; no
  formulário da sala, o SAD escolhe a categoria.
- API: `GET /api/prices`, `PATCH /api/prices/tables/:id`,
  `POST /api/prices/tables { copyFromId, name, validFrom }`,
  `DELETE /api/prices/tables/:id` (só futura), `POST/PATCH /api/prices/categories`.


## Fase 10 — Orçamento automático (Portaria 2794)

O cálculo fica num lugar só (`backend/src/quotes/engine.ts`, função pura) e
cada regra tem o seu teste (`test/unit/quote.test.ts`):

| Regra | Como entra no cálculo |
|---|---|
| Espaço didático por hora (Art. 2º) | Em cada dia: horas de uso, com a cobrança mínima (2 h), mais 1 h antes e 1 h depois (§1º) |
| Área de apoio por hora (Art. 3º) | Horas de uso, já com montagem e desmontagem; sem mínimo e sem preparação |
| Área de apoio por dia | Um valor por dia de uso |
| Pernoite (Art. 3º §2º) | Não conta: cada dia é cobrado só no horário de uso |
| Coffee break na própria sala de aula (Art. 5º §2º) | +20% sobre o valor da sala; só nas salas de aula com coffee liberado |
| Desconto institucional (Art. 4º III) | 25% sobre o total, sem somar com outros |
| Isenção (Art. 4º I e II) | Marcada por quem analisa, com o motivo; zera o total |
| Valor a definir | A linha fica sem valor e o total sai como parcial |

- O orçamento usa a **tabela de preços que vale no primeiro dia do evento**, e
  as regras dela.
- Exemplo do documento SAD/NUCEV (um dia de 10 h): 10 salas grandes e 3
  pequenas = 13 × 12 h × R$ 125 = **R$ 19.500**; com o desconto
  institucional, **R$ 14.625**.
- `POST /api/quotes/estimate { days: [{ date, start, end }], items: [{ categoryId | roomId, count, coffeeInRoom }], institutional, exemptionReason? }`
  calcula sem gravar; o formulário de evento (Fase 11) e o **simulador da
  tela Preços** usam. O orçamento enviado ao solicitante, com versões, entra
  com a gestão do evento (Fase 12).
- A equipe técnica de áudio e vídeo (Art. 4º II, Art. 18 da 2793) é cobrada à
  parte e não entra no cálculo.


## Fase 11 — Solicitar evento

Item **Eventos** no menu de quem pede Cultura e Extensão (eventos são
atividades de Cultura e Extensão, Portaria 2793, Cap. XI; quem não tem essa
permissão, como a Sueli e a Juliana, não vê o item). Formulário em etapas:

1. **Evento:** nome, tipo, objetivo e programação, público previsto e
   público-alvo, entidade organizadora, inscrição e patrocínio, responsável.
   Unidade da FMUSP/HC, USP, SES ou Adolfo Lutz já leva o desconto
   institucional; evento da FMUSP sem inscrição e sem patrocínio aparece como
   "pode ser isento" (Art. 4º I), para o NUCEV conferir.
2. **Dias e horários:** um ou vários dias, cada um com montagem e
   desmontagem (entram no uso dos espaços); aviso de domingo; 3 dias de
   antecedência.
3. **Espaços:** por categoria e quantidade ("4 salas de aula para 40
   pessoas") ou por nome (Teatro, um átrio), em todos ou em alguns dias, com a
   finalidade. Cada linha mostra, dia a dia, quantos espaços que servem estão
   livres e sugere os livres (`POST /api/events/availability`, só orienta). O
   SAD define as salas na análise.
4. **Coffee e infraestrutura:** coffee break com o número de pessoas; a tela
   lista os espaços que podem ter coffee, com a capacidade, e avisa se o
   escolhido não comporta. Equipamentos e observações.
5. **Resumo:** tudo o que foi pedido, a disponibilidade e o **orçamento
   estimado** (Fase 10), com o aceite do regulamento.

- O pedido entra como **Recebido**, com protocolo próprio
  (`EV-000001/2026`, sequência `event_protocol_seq`) e o orçamento estimado
  guardado. Rascunho no navegador: recarregar a página não perde o
  preenchimento.
- **Meus eventos** (`/eventos`) e a tela do evento, com a situação e o que
  acontece agora; o solicitante cancela antes da pré-reserva.
- **SAD e NUCEV:** lista **Eventos** (`/admin/eventos`) com filtro por
  situação e busca, e a mesma tela do evento. A análise, o orçamento oficial
  e a pré-reserva entram na Fase 12.
- Modelo: `events`, `event_days` e `event_space_requests` (migration
  `events`); as situações já cobrem as Fases 12 e 13 (Recebido, Em análise,
  Orçamento enviado, Alteração pedida, Orçamento aprovado, Pré-reservado,
  Comprovante enviado, Pagamento validado, Confirmado, Cancelado, Recusado e
  Pré-reserva vencida; "em andamento" e "finalizado" vêm das datas).
- API: `POST /api/events`, `GET /api/events/mine`, `GET /api/events` (SAD e
  NUCEV), `GET /api/events/:id`, `POST /api/events/:id/cancel`,
  `POST /api/events/availability`.

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
  `/reservar`, `/salas`, `/regulamento`; `/admin/solicitacoes`, `/admin/agenda`,
  `/admin/salas-livres`, `/admin/salas`, `/admin/recursos`, `/admin/regulamento`, `/admin/pessoas`,
  `/admin/historico`. Barra lateral a partir de 1024 px, barra inferior no
  celular; com mais de 5 itens, os últimos ficam no botão **Mais**. O Admin vê
  na navegação quantas solicitações estão pendentes.
  Em produção, o próprio Express devolve o `index.html` para essas rotas
  (fallback de SPA, em `backend/src/app.ts`).
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
