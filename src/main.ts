import { firefox } from 'playwright';
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

  const page = await linkedinCoreFeatures.openLinkedin(browser)

  const connectButton = page.getByRole('button', {
    name: 'Convidar Natalia Castoldi para se conectar'
  });

  await connectButton.waitFor({ state: 'visible', timeout: 10_000 });
  await connectButton.click();

  const sendWithoutNoteButton = page.getByRole('button', {
    name: 'Enviar sem nota'
  });

  await sendWithoutNoteButton.waitFor({ state: 'visible', timeout: 10_000 });
  await sendWithoutNoteButton.click();


  console.log('LinkedIn aberto. Feche a janela para encerrar.');
}

main().catch((error) => {
  console.error('Falha ao abrir o LinkedIn:', error);
  process.exit(1);
});
