export const LINKEDIN_ACTION_LABELS = {
    sendWithoutNote: /Enviar sem nota|Send without a note|Enviar|Send/i,
    addNote: /Adicionar nota|Add a note/i,
    send: /Enviar|Send/i,
    connect: /Conectar|Connect|Invite/i,
    more: /Mais|More/i
}

export const LINKEDIN_SELECTORS = {
    likeButtons: 'button[aria-label*="Reagir com gostei"], button[aria-label*="Like"]',
    postLinks: 'a[href*="/feed/update/"], a[href*="/posts/"]'
}

export const LINKEDIN_PLACEHOLDERS = {
    noteMessage: /Nos conhecemos em|We met at|Let me introduce/i
}
