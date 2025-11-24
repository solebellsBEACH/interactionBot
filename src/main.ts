import { firefox } from 'playwright';
import { LinkedinCoreFeatures } from './features/linkedin-core';
import { env } from './shared/env';
import { LinkedinFeatures } from './features/linkedin';

async function main(): Promise<void> {
  const browser = await firefox.launchPersistentContext( 
  env.userDataDir,
    {
       headless: false,
       slowMo: 50,
    }
  )
  
  const linkedinCoreFeatures = new LinkedinCoreFeatures()
  const page = await linkedinCoreFeatures.openLinkedin(browser)
  const linkedinFeatures = new LinkedinFeatures(page)

  await linkedinFeatures.sendConnection({
    message:'Example message',
  })

  console.log('LinkedIn aberto. Feche a janela para encerrar.');
}

main().catch((error) => {
  console.error('Falha ao abrir o LinkedIn:', error);
  process.exit(1);
});
