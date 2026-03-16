# Playwright (TypeScript) - Abrir LinkedIn com UI

Aplicação mínima em Node.js/Playwright que abre o LinkedIn com interface gráfica (`headless: false`).

## Pré-requisitos
- Node.js 18+ instalado.
- API NestJS rodando em `http://localhost:3001` (repo `/home/lucas/projects/interactionBot-api`).

### Variáveis
- `API_BASE_URL` (default: `http://localhost:3001`)
- `LOG_FORMAT=pretty|json` (opcional; use `json` para logs estruturados)
- `LOG_LEVEL=debug|info|warn|error` (opcional; padrão efetivo `info`)

## Instalação
```bash
npm install
npm run install:browsers
```

## Executar
```bash
npm run open:linkedin
```

Se você vai usar recursos que dependem de prompt/analises, garanta que a API esteja ativa.

Isso inicia o Chromium do Playwright em modo UI (executado com `ts-node`) e navega para `https://www.linkedin.com/`. Feche a janela para encerrar o script.

## Painel Admin
Ao executar o bot, um painel admin HTTP local sobe junto para controlar os processos:
- URL padrão: `http://127.0.0.1:5050/admin`
- Processos disponíveis: busca de vagas, Easy Apply, conexão, upvote de posts, análise de perfil e reset de sessão.
- Área de monitoramento: respostas recentes do GPT usadas no preenchimento automático.
- Bloco novo `Control Plane SaaS`: workspaces, memberships, contas LinkedIn, billing/quotas, campanhas, jobs, runs, falhas, métricas, auditoria e runtime remoto persistido na API.

Variáveis opcionais:
- `ADMIN_ENABLED=true|false` (padrão: `true`)
- `ADMIN_HOST` (padrão: `127.0.0.1`)
- `ADMIN_PORT` (padrão: `5050`)

Se `5050` estiver ocupada, o bot tenta automaticamente as próximas portas livres (`5051`, `5052`, ...). Se preferir sempre escolher uma porta livre automaticamente, use `ADMIN_PORT=0`.

### Usar o bloco `Control Plane SaaS`
- Suba o `interactionBot-api`.
- Abra o admin local.
- Informe `API base URL` e um bearer token de usuário emitido pelo backend.
- O painel passa a consumir diretamente `/auth/*`, `/control-plane/*`, `/linkedin-accounts`, `/billing/*`, `/campaigns/*`, `/worker-jobs/*`, `/worker-runs/*`, `/observability/*` e `/admin/runtime/stream`.
- A troca de workspace emite um novo token pelo próprio backend; a seleção de conta LinkedIn filtra os cards account-scoped e o stream remoto.

O token do painel SaaS fica apenas em `sessionStorage` do navegador; `API base URL` e a última conta selecionada ficam em `localStorage`.

## CLI (Interactor)
Executa ações específicas no LinkedIn via `src/interactor/cli.ts`.

### Uso básico
```bash
npx ts-node src/interactor/cli.ts --action profile --profileUrl "https://www.linkedin.com/in/usuario"
```

### Ações disponíveis
- `profile`: abre perfil (usa `--profileUrl` opcional).
- `dashboard`: abre dashboard (usa `--profileUrl` opcional).
- `dashboard-profile`: abre dashboard do perfil (usa `--profileUrl` opcional).
- `dashboard-network`: abre a rede.
- `connections-visit`: visita conexões (usa `--maxConnections`, `--delayMs`, `--maxScrollRounds`, `--maxIdleRounds`).
- `easy-apply`: aplica em uma vaga (usa `--jobUrl`).
- `search-jobs`: busca vagas por tag (usa `--tag`).
- `catch-jobs`: busca vagas e tenta Easy Apply (usa `--tag` opcional).
- `connect`: envia conexão (usa `--profileUrl` e `--message` opcional).
- `upvote`: curte posts por tag (usa `--tag`, `--maxLikes`).

### Flags
- `--action`: ação a executar.
- `--tag`: tag de busca (se não informado, usa `env.linkedinURLs.searchJobTag`).
- `--jobUrl`: URL da vaga.
- `--profileUrl`: URL do perfil.
- `--message`: mensagem para convite de conexão.
- `--maxResults`: limite total de resultados.
- `--maxPages`: limite de páginas na busca.
- `--maxApplicants`: filtra vagas com candidaturas <= valor informado.
- `--postedWithinDays`: filtra vagas publicadas nos últimos N dias.
- `--datePosted`: atalho para período (`24h`, `day`, `week`, `month`, `semana`, `mes`, `mês`, `1d`, `7d`, `30d`).
- `--easyApplyOnly`: filtra somente Easy Apply (`true` ou `false`).
- `--includeUnknownApplicants`: inclui vagas sem número de candidaturas (`true` ou `false`).
- `--maxLikes`: limite de curtidas no `upvote`.
- `--maxConnections`: limite de conexões a visitar.
- `--delayMs`: delay entre visitas/ações (em ms).
- `--maxScrollRounds`: limite de scrolls por lista.
- `--maxIdleRounds`: limite de tentativas ociosas.
- `--headless`: executa o navegador em modo headless (`true` ou `false`).

Se `--postedWithinDays` for informado, ele tem precedência sobre `--datePosted`.

### Exemplos
```bash
npx ts-node src/interactor/cli.ts --action search-jobs --tag "frontend" --maxResults 20 --easyApplyOnly true --postedWithinDays 7

npx ts-node src/interactor/cli.ts --action catch-jobs --tag "backend" --maxResults 10 --easyApplyOnly true

npx ts-node src/interactor/cli.ts --action connect --profileUrl "https://www.linkedin.com/in/usuario" --message "Oi! Vamos nos conectar?"
```

## Worker por Job
Para preparar o bot para SaaS, existe um entrypoint separado por job em `src/interactor/worker.ts`.

Na fase atual do control plane, a `workspace` é o escopo operacional principal do bot. `tenant` continua existindo para billing e organização, mas os endpoints operacionais da API resolvem estado por `workspace` autenticada.
Dentro da workspace, cada sessão operacional do LinkedIn agora é isolada por `linkedin_account_id`.
As quotas operacionais da fase 3 são aplicadas no backend por `workspace + linkedin_account` quando o bot dispara jobs, campanhas ou aplicações via API.

### Como usar
Via JSON inline:
```bash
API_AUTH_TOKEN=ibw_xxx BOT_TENANT_ID=tenant-a BOT_WORKSPACE_ID=workspace-a npm run worker -- --job '{"id":"job-1","runId":"run-1","userId":"user-a","type":"profile-review","headless":true}'
```

Via arquivo:
```bash
API_AUTH_TOKEN=ibw_xxx BOT_TENANT_ID=tenant-a BOT_WORKSPACE_ID=workspace-a npm run worker -- --jobFile ./worker-job.json
```

### Payloads suportados
- `easy-apply`: `{ "jobUrl": "https://www.linkedin.com/jobs/view/..." }`
- `search-jobs`: `{ "tag": "backend", "apply": true, "maxApplies": 5, "waitBetweenMs": 1500, "options": { ... } }`
- `apply-jobs`: `{ "jobUrls": ["..."], "waitBetweenMs": 1500 }`
- `connect`: `{ "profileUrl": "https://www.linkedin.com/in/...", "message": "..." }`
- `upvote-posts`: `{ "tag": "node", "maxLikes": 3 }`
- `scan-applied-jobs`: `{ "periodPreset": "last-7-days" }`
- `profile-review`: `{}`
- `reset-session`: `{}`

### Persistência de estado
- `API_AUTH_TOKEN` ou `BOT_API_TOKEN`: bearer token emitido pelo control plane.
- `BOT_TENANT_ID`: tenant resolvido pelo control plane.
- `BOT_WORKSPACE_ID`: workspace resolvida pelo control plane. Este é o escopo principal para `user-profile`, `worker-runs`, `admin runtime` e fallback local por pasta.
- `BOT_LINKEDIN_ACCOUNT_ID`: conta LinkedIn operacional do job. Este é o escopo preferencial para `userDataDir`, `user-profile` local e chamadas account-scoped da API.
- `BOT_USER_ID`: ator humano opcional do job. Continua útil para auditoria, mas não é mais a chave principal de tenant.
- `BOT_SESSION_MODE=persistent|ephemeral`: controla se o Chromium usa diretório persistente por escopo ou um diretório temporário por execução. O queue worker da API força `ephemeral`.
- `BOT_WORKER_TIMEOUT_MS`: timeout operacional repassado pelo worker plane para logs e diagnóstico local.
- `USER_PROFILE_STORAGE=local|api|auto`: controla onde o perfil consolidado é salvo.
- Em `local`, o perfil fica em `data/profiles/<linkedin-account-ou-workspace-ou-tenant-ou-user>.json`.
- Em `api`, o worker tenta usar `/user-profile` e publicar execução em `/worker-runs/...`.
- Em `auto`, usa API quando existe contexto autenticado do control plane; se a API falhar, o fallback local continua funcionando.
- Para o painel admin persistir prompts, logs e próximas steps na API, defina `API_AUTH_TOKEN`.
- Quando `BOT_LINKEDIN_ACCOUNT_ID` estiver definido, o bot envia `x-linkedin-account-id` automaticamente para a API.
- Em `BOT_SESSION_MODE=ephemeral`, o `userDataDir` é criado por `workspace + linkedin_account + runId + jobId` e removido ao fim da execução.

## Admin Runtime Remoto
Quando o bot sobe com `API_AUTH_TOKEN`, ele hidrata o contexto autenticado em `/auth/me` e o admin deixa de depender só de memória local:

- `AdminPromptBroker` passa a persistir prompts e settings na API.
- `adminRuntimeStore` publica logs e steps na API.
- o frontend do admin recebe snapshots por SSE em `/api/admin/stream`, alimentados pelo backend persistido.

Se a API falhar ou não houver token do control plane, o admin continua com fallback local para não bloquear o fluxo.

## Billing e quotas
Os limites operacionais agora vivem no control plane:
- plano base por tenant em `/billing/plan`
- overrides por workspace em `/billing/workspace-limits`
- histórico de rejeições em `/billing/rejections`

Na prática, isso afeta:
- criação de campanhas ativas
- criação de contas LinkedIn
- enqueue de `worker-jobs`
- execuções do scheduler
- concorrência real do queue worker

Se um enqueue falhar por quota, a API responde `409` e o bot deve tratar isso como limite operacional, não como erro transitório.

## Observabilidade
Quando `LOG_FORMAT=json`, o bot passa a emitir logs estruturados com `runId`, `tenantId`, `workspaceId`, `linkedinAccountId` e `userId` quando esses valores existem no ambiente.

No worker, esse contexto também é enviado para `/worker-runs/:runId/events`, então os eventos remotos ficam correlacionáveis com a execução local.

## Worker stateless
Na fase 4, o worker foi preparado para execução isolada:
- cada job pode subir Chromium com `userDataDir` efêmero
- o isolamento operacional é `workspace + linkedin_account`
- o diretório temporário é limpo no encerramento normal e por sinal
- isso reduz reuso acidental de cookies/sessão entre contas e clientes

## Teste das funções do bot
```bash
npm test
```

Esse comando executa todas as ações do bot via `src/interactor/cli.ts`, valida os logs esperados e gera métricas de tempo/memória em `test-logs/`.

### Variáveis úteis
- `BOT_TEST_PROFILE_URL`, `BOT_TEST_JOB_URL`, `BOT_TEST_TAG`, `BOT_TEST_MESSAGE`
- `BOT_TEST_TIMEOUT_MS` (default: 180000)
- `BOT_TEST_HEADLESS` (default: true)
- `BOT_TEST_MAX_RESULTS`, `BOT_TEST_MAX_PAGES`, `BOT_TEST_POSTED_DAYS`, `BOT_TEST_MAX_LIKES`

## Testes da Fase 1
```bash
npm run test:phase1
```

Esse comando valida o parser do worker, o contexto por job e o fallback local do `user-profile`.
Também cobre o escopo preferencial por `workspace` e por `linkedin_account_id` quando existe contexto SaaS.

## Testes da Fase 4
```bash
npm run test:phase4
```

Esse comando adiciona a cobertura do `userDataDir` efêmero por execução, mantendo os testes anteriores do parser do worker e do `user-profile`.

## Teste UI com Playwright Test
```bash
npm run test:playwright
npm run test:ui  # modo UI interativo do Playwright
```

O teste em `tests/linkedin.spec.ts` abre o LinkedIn e valida o título da página. Assumir que há acesso à internet para carregar o site.
