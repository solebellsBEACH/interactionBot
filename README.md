# Playwright (TypeScript) - Abrir LinkedIn com UI

Aplicação mínima em Node.js/Playwright que abre o LinkedIn com interface gráfica (`headless: false`).

## Pré-requisitos
- Node.js 18+ instalado.

## Instalação
```bash
npm install
npm run install:browsers
```

## Executar
```bash
npm run open:linkedin
```

Isso inicia o Chromium do Playwright em modo UI (executado com `ts-node`) e navega para `https://www.linkedin.com/`. Feche a janela para encerrar o script.

## Painel Admin
Ao executar o bot, um painel admin HTTP local sobe junto para controlar os processos:
- URL padrão: `http://127.0.0.1:5050/admin`
- Processos disponíveis: busca de vagas + Easy Apply no mesmo fluxo, conexão e upvote de posts.
- Área de monitoramento: respostas recentes do GPT usadas no preenchimento automático.

Variáveis opcionais:
- `ADMIN_ENABLED=true|false` (padrão: `true`)
- `ADMIN_HOST` (padrão: `127.0.0.1`)
- `ADMIN_PORT` (padrão: `5050`)

## Teste UI com Playwright Test
```bash
npm test         # modo CLI
npm run test:ui  # modo UI interativo do Playwright
```

O teste em `tests/linkedin.spec.ts` abre o LinkedIn e valida o título da página. Assumir que há acesso à internet para carregar o site.
