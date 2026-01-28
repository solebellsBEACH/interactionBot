export const LINKEDIN_ACTION_LABELS = {
    sendWithoutNote: /Enviar sem nota|Send without a note/i,
    addNote: 'Adicionar nota',
    send: 'Enviar',
    connect: /Conectar|Connect/i
}

export const LINKEDIN_SELECTORS = {
    likeButtons: 'button[aria-label*="Reagir com gostei"], button[aria-label*="Like"]',
    postLinks: 'a[href*="/feed/update/"], a[href*="/posts/"]'
}

export const LINKEDIN_PLACEHOLDERS = {
    noteMessage: /Nos conhecemos em/i
}
