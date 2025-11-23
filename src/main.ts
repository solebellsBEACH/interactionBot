import { Browser, firefox } from 'playwright';
import { LinkedinCoreFeatures } from './features/linkedin-core';
import { env } from './shared/env';



async function main(): Promise<void> {

  const linkedinCoreFeatures = new LinkedinCoreFeatures()
  const browser = await firefox.launchPersistentContext( 
  env.userDataDir,
    {
       headless: false,
       slowMo: 50,
    }
  )

  await linkedinCoreFeatures.openLinkedin(browser)


  console.log('LinkedIn aberto. Feche a janela para encerrar.');
}

main().catch((error) => {
  console.error('Falha ao abrir o LinkedIn:', error);
  process.exit(1);
});