import { firefox } from 'playwright';
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

  const page = await browser.newPage();
  const linkedinFeatures = new LinkedinFeatures(page)


    await linkedinFeatures.sendConnection(env.linkedinURLs.feedURL,{
    message:'Example message',
  })


  // await linkedinFeatures.sendConnection(env.linkedinURLs.feedURL,{
  //   message:'Example message',
  // })

  console.log('LinkedIn aberto. Feche a janela para encerrar.');
}

main().catch((error) => {
  console.error('Falha ao abrir o LinkedIn:', error);
  process.exit(1);
});
