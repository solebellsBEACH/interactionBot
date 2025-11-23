import { Page } from "playwright";

export class LinkedinFeatures {

    async sendConnection(page: Page, inMailOptions?:{message:string}){
        const connectButton = page.getByRole('button', {
        name: 'Convidar Marcelo Xavier para se conectar'
    });

    await connectButton.waitFor({ state: 'visible', timeout: 10_000 });
    await connectButton.click();

    if(inMailOptions){
        const addNoteButton = page.getByRole('button', {
            name: 'Adicionar nota'
        });

        await addNoteButton.waitFor({ state: 'visible', timeout: 10_000 });
        await addNoteButton.click();

        const input = page.getByPlaceholder('Ex.: Nos conhecemos em…')
        await input.waitFor({ state: 'visible', timeout: 10_000 });
        await input.fill(inMailOptions.message)

        const sendMessageButton = page.getByRole('button', {
            name: 'Enviar'
        });
        await sendMessageButton.waitFor({ state: 'visible', timeout: 10_000 });
        await sendMessageButton.click()
        

    }else{
        const sendWithoutNoteButton = page.getByRole('button', {
            name: 'Enviar sem nota'
        });

        await sendWithoutNoteButton.waitFor({ state: 'visible', timeout: 10_000 });
        await sendWithoutNoteButton.click();

        }
    }


}