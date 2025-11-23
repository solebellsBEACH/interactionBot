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

## Teste UI com Playwright Test
```bash
npm test         # modo CLI
npm run test:ui  # modo UI interativo do Playwright
```

O teste em `tests/linkedin.spec.ts` abre o LinkedIn e valida o título da página. Assumir que há acesso à internet para carregar o site.
