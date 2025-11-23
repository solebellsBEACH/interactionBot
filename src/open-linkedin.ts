import { Browser, chromium } from 'playwright';

async function main(): Promise<void> {
  const browser = await chromium.launch({
    headless: false,
    slowMo: 50
  });

  await openLinkedin(browser)



  console.log('LinkedIn aberto. Feche a janela para encerrar.');
}

main().catch((error) => {
  console.error('Falha ao abrir o LinkedIn:', error);
  process.exit(1);
});

async function openLinkedin(browser: Browser){
    const page = await browser.newPage({
    viewport: { width: 1280, height: 800 }
  });

  await page.goto('https://www.linkedin.com/', {
    waitUntil: 'domcontentloaded'
  });

}