# Playwright (TypeScript) - Abrir LinkedIn com UI

Aplicação mínima em Node.js/Playwright que abre o LinkedIn com interface gráfica (`headless: false`).

## Pré-requisitos
- Node.js 18+ instalado.
- API NestJS rodando em `http://localhost:3001` (repo `/home/lucas/projects/interactionBot-api`).

### Variáveis
- `API_BASE_URL` (default: `http://localhost:3001`)

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

## Teste UI com Playwright Test
```bash
npm run test:playwright
npm run test:ui  # modo UI interativo do Playwright
```

O teste em `tests/linkedin.spec.ts` abre o LinkedIn e valida o título da página. Assumir que há acesso à internet para carregar o site.
