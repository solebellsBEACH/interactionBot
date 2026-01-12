export const EASY_APPLY_SELECTORS = {
    modal: '.jobs-easy-apply-modal, .artdeco-modal',
    form: '.jobs-easy-apply-content form, .jobs-easy-apply-modal form, form'
}

export const EASY_APPLY_TIMEOUTS = {
    formVisible: 10_000,
    formChange: 8_000,
    formPoll: 400
}

export const EASY_APPLY_LABELS = {
    easyApplyButton: /candidatura simplificada|easy apply/i,
    submit: /enviar candidatura|submit application/i,
    next: /proximo|próximo|continuar|next|avancar|avançar|seguinte/i,
    review: /revisar candidatura|review application|revisar|review/i
}

export const EASY_APPLY_BUTTON_SELECTORS = {
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
