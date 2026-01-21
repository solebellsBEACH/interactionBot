export const EASY_APPLY_SELECTORS = {
    modal: '.jobs-easy-apply-modal, .artdeco-modal',
    form: '.jobs-easy-apply-content form, .jobs-easy-apply-modal form, form'
}

export const EASY_APPLY_TIMEOUTS = {
    openButton: 12_000,
    openPoll: 400,
    formVisible: 10_000,
    formChange: 8_000,
    formPoll: 400
}

export const EASY_APPLY_LABELS = {
    easyApplyButton: /candidatura simplificada|candidatar-se facilmente|easy apply/i,
    submit: /enviar candidatura|submit application/i,
    next: /proximo|próximo|continuar|next|avancar|avançar|seguinte/i,
    review: /revisar candidatura|review application|revisar|review/i
}

export const EASY_APPLY_BUTTON_SELECTORS = {
    open: [
        'button[data-control-name*="inapply" i], [role="button"][data-control-name*="inapply" i], button[data-control-name*="easy-apply" i], [role="button"][data-control-name*="easy-apply" i]',
        'button.jobs-apply-button, [role="button"].jobs-apply-button',
        'button[aria-label*="Easy Apply" i], [role="button"][aria-label*="Easy Apply" i], button[aria-label*="Candidatura simplificada" i], [role="button"][aria-label*="Candidatura simplificada" i], button[aria-label*="Candidatar-se facilmente" i], [role="button"][aria-label*="Candidatar-se facilmente" i]',
        'button:has-text("Candidatura simplificada"), [role="button"]:has-text("Candidatura simplificada"), button:has-text("Candidatar-se facilmente"), [role="button"]:has-text("Candidatar-se facilmente"), button:has-text("Easy Apply"), [role="button"]:has-text("Easy Apply")',
        'button[data-test-id*="jobs-apply" i], [role="button"][data-test-id*="jobs-apply" i], button[data-test-id*="easy-apply" i], [role="button"][data-test-id*="easy-apply" i]'
    ],
    submit: [
        'button:has-text("Enviar candidatura"), button:has-text("Submit application")',
        'button[aria-label*="Submit application" i], button[aria-label*="Enviar candidatura" i]',
        'button[data-easy-apply-submit-button]',
        'footer button.artdeco-button--primary'
    ],
    next: [
        'button[data-control-name*="continue"], button[data-test-id*="continue"], button[data-easy-apply-next-step]',
        'button:has-text("Próximo"), button:has-text("Proximo"), button:has-text("Continuar"), button:has-text("Next"), button:has-text("Avançar"), button:has-text("Avancar"), button:has-text("Seguinte")',
        '[role="button"][aria-label*="continuar" i], [role="button"][aria-label*="next" i], [role="button"]:has-text("Continuar"), [role="button"]:has-text("Next")',
        'footer button:has-text("Continuar"), footer button:has-text("Próximo"), footer button:has-text("Proximo"), footer button:has-text("Next"), footer button:has-text("Avançar"), footer button:has-text("Avancar")'
    ],
    review: [
        'button:has-text("Revisar candidatura"), button:has-text("Review application"), button:has-text("Revisar"), button:has-text("Review")',
        'button[data-control-name*="review" i], button[data-test-id*="review" i]',
        'footer button:has-text("Revisar"), footer button:has-text("Review")'
    ]
}

export const EASY_APPLY_FORBIDDEN_REGEX = /(remover|remove|excluir|delete|descartar|cancelar|fechar|close|dismiss)/i
