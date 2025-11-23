import { Browser, firefox } from 'playwright';

const env = {
  linkedinURLs:{
    recruiterURL:"https://www.linkedin.com/in/natalia-castoldi-69086b182/",
  }
}

async function main(): Promise<void> {
  const browser = await firefox.launch(
    {
       headless: false,
       slowMo: 50,
    }
  )

  await openLinkedin(browser)

  // await signIn()
  // await connectWithRecruiters()

  console.log('LinkedIn aberto. Feche a janela para encerrar.');
}

main().catch((error) => {
  console.error('Falha ao abrir o LinkedIn:', error);
  process.exit(1);
});

async function openLinkedin(browser: Browser){
  try {
    const page = await browser.newPage();
    await page.goto(env.linkedinURLs.recruiterURL, {
    waitUntil: 'domcontentloaded'
    });
  } catch (error) {
    throw(error)
  }
}
