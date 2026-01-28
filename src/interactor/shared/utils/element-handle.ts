import { Locator, Page, } from "playwright";
import { HandleActions, Role } from "../interfaces/element-handle.types";

export type FormFieldValue = {
    key?: string
    label?: string | null
    value: string
}

export type FormPromptField = FormFieldValue & {
    type: 'input' | 'select'
    options?: string[]
}

export type FormValues = {
    inputValues: FormFieldValue[]
    selectValues: FormFieldValue[]
}

type SelectEntry = {
    label: string
    value: string
    index: number
}

export class ElementHandle {
    private _page: Page
    private DEFAULT_TIMEOUT: number

    constructor(page: Page, timeout?: number) {
        this._page = page
        this.DEFAULT_TIMEOUT = timeout || 5_000
    }

    async handleByRole(handle: HandleActions, role: Role, options: { name?: string | RegExp }, contentText?: string) {
        try {
            const element = this._page.getByRole(role, options);
            await element.allInnerTexts().then(console.log)
            await element.waitFor({ state: 'visible', timeout: this.DEFAULT_TIMEOUT });
            
            return this._runHandleActions(handle, element, contentText) || element
        } catch (error) {
            console.error({
                label: options.name,
                error
            })
        }
    }

    async handleByPlaceholder(handle: HandleActions, placeholder: string | RegExp, contentText: string) {
        try {
            const element = this._page.getByPlaceholder(placeholder);
            await element.waitFor({ state: 'visible', timeout: this.DEFAULT_TIMEOUT });
            return this._runHandleActions(handle, element, contentText) || element
        } catch (error) {
            console.error({
                label: placeholder,
                error
            })
        }
    }

    async handleForm(prompt?: (field: FormPromptField) => Promise<string | null>): Promise<FormValues | undefined> {
        const forms = this._page.locator('.jobs-easy-apply-modal form, .jobs-easy-apply-content form, form')
        const count = await forms.count()

        for (let i = 0; i < count; i++) {
            const element = forms.nth(i)
            try {
                await element.waitFor({ state: 'visible', timeout: this.DEFAULT_TIMEOUT });
                return this._getFormValues(element, prompt)
            } catch (error) {
                // try next visible form if exists
                if (i === count - 1) throw error
            }
        }
    }

    private async _getFormValues(element: Locator, prompt?: (field: FormPromptField) => Promise<string | null>): Promise<FormValues> {
        const selectValues = await this._getSelectValues(element, prompt)
        const inputValues = await this._getInputValues(element, prompt)

        return {
            selectValues,
            inputValues
        };
    }

    private async _getInputValues(element: Locator, prompt?: (field: FormPromptField) => Promise<string | null>): Promise<FormFieldValue[]> {
        const inputs = await element.getByRole('textbox').all();
        const values: FormFieldValue[] = []

        for (const item of inputs) {
            const value = await item.inputValue()
            const meta = await this._getControlMeta(item)
            const label = meta.labelText || meta.placeholder || meta.ariaLabel || meta.name || meta.id
            const key = this._normalizeKey(label || undefined)
            let finalValue = value

            if (prompt && !value.trim()) {
                const editable = await item.isEditable().catch(() => false)
                if (editable) {
                    const answer = await prompt({
                        type: 'input',
                        key,
                        label,
                        value
                    })
                    if (answer && answer.trim()) {
                        await item.fill(answer)
                        finalValue = answer
                    }
                }
            }

            values.push({
                key,
                label,
                value: finalValue
            })
        }

        return values
    }

    private async _getSelectValues(element: Locator, prompt?: (field: FormPromptField) => Promise<string | null>): Promise<FormFieldValue[]> {
        const selects = await element.locator('select').all()
        if (selects.length === 0) return []

        const values: FormFieldValue[] = []

        for (const select of selects) {
            const meta = await this._getControlMeta(select)
            const selectedOption = await select.locator('option:checked').allInnerTexts()
            let value = selectedOption[0]?.trim() || ''
            const allEntries = await this._getSelectEntries(select)
            const allLabels = allEntries.map((entry) => entry.label)

            const label = meta.labelText || meta.ariaLabel || meta.name || meta.id
            const key = this._normalizeKey(label || undefined)

            const missing = !value || this._isSelectPlaceholder(value)
            if (prompt && missing) {
                const promptEntries = allEntries.filter((entry) => entry.label && !this._isSelectPlaceholder(entry.label))
                const entries = promptEntries.length ? promptEntries : allEntries
                const options = entries.map((entry) => entry.label)
                const answer = await prompt({
                    type: 'select',
                    key,
                    label,
                    value,
                    options
                })
                const resolvedIndex = this._resolveSelectIndex(answer, entries)
                if (resolvedIndex !== null) {
                    const selected = entries[resolvedIndex]
                    await select.selectOption({ index: selected.index })
                    value = selected.label
                }
            }

            values.push({
                key,
                label,
                value
            })
        }

        return values
    }

    private async _runHandleActions(handle: HandleActions, element: Locator, contentText?: string) {
        switch (handle) {
            case HandleActions.click:
                await element.click()
                break;

            case HandleActions.fill:
                await element.fill(contentText || "")
                break;
        }

        return element
    }

    private async _getControlMeta(control: Locator) {
        return control.evaluate((el) => {
            const ariaLabel = el.getAttribute('aria-label')
            const ariaLabelledBy = el.getAttribute('aria-labelledby')
            const placeholder = el.getAttribute('placeholder')
            const name = (el as HTMLInputElement).name || null
            const id = (el as HTMLInputElement).id || null

            const getText = (node: Element | null) => node?.textContent?.trim() || null
            const findIn = (root: Element | null, selector: string) => {
                if (!root) return null
                if (root.matches(selector)) return root
                return root.querySelector(selector)
            }
            const getTextFromSelectors = (root: Element | null, selectors: string[]) => {
                if (!root) return null
                for (const selector of selectors) {
                    const node = findIn(root, selector)
                    const text = getText(node)
                    if (text) return text
                }
                return null
            }
            let labelText: string | null = null

            if (ariaLabelledBy) {
                const parts = ariaLabelledBy
                    .split(' ')
                    .map((ref) => getText(document.getElementById(ref)))
                    .filter(Boolean) as string[]
                if (parts.length) labelText = parts.join(' ')
            }

            if (!labelText && id) {
                const labelEl = document.querySelector(`label[for="${id}"]`)
                labelText = getText(labelEl)
            }

            if (!labelText) {
                const closestLabel = el.closest('label')
                labelText = getText(closestLabel)
            }

            if (!labelText) {
                const container = el.closest(
                    '[data-test-form-element], [data-test-form-element-label], [data-test-form-element-title], .jobs-easy-apply-form-element, .fb-dash-form-element, fieldset'
                ) || el.parentElement
                labelText = getTextFromSelectors(container, [
                    '[data-test-form-element-label]',
                    '[data-test-form-element-title]',
                    '.jobs-easy-apply-form-element__label',
                    'label',
                    'legend'
                ])
            }

            return {
                ariaLabel,
                ariaLabelledBy,
                placeholder,
                name,
                id,
                labelText
            }
        })
    }

    private _normalizeKey(label?: string | null) {
        if (!label) return undefined
        return label
            .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
            .toLowerCase()
            .trim()
            .replace(/[^a-z0-9]+/g, '-')
            .replace(/^-+|-+$/g, '')
    }

    private _isSelectPlaceholder(value: string) {
        const normalized = value.toLowerCase()
        const hasSelectOption = normalized.includes('select') && normalized.includes('option')
        return (
            hasSelectOption ||
            normalized.includes('selecione') ||
            normalized.includes('selecionar') ||
            normalized.includes('choose')
        )
    }

    private _resolveSelectIndex(answer: string | null | undefined, entries: SelectEntry[]) {
        if (!answer) return null
        const trimmed = answer.trim()
        if (!trimmed) return null

        const asNumber = Number(trimmed)
        if (!Number.isNaN(asNumber) && asNumber >= 1 && asNumber <= entries.length) {
            return asNumber - 1
        }

        const lowered = trimmed.toLowerCase()
        const directLabel = entries.findIndex((entry) => entry.label.toLowerCase() === lowered)
        if (directLabel >= 0) return directLabel

        const directValue = entries.findIndex((entry) => entry.value.toLowerCase() === lowered)
        if (directValue >= 0) return directValue

        const partial = entries.findIndex((entry) => entry.label.toLowerCase().includes(lowered))
        return partial >= 0 ? partial : null
    }

    private async _getSelectEntries(select: Locator): Promise<SelectEntry[]> {
        return select.locator('option').evaluateAll((options) =>
            options.map((option, index) => ({
                label: (option.textContent || '').trim(),
                value: (option as HTMLOptionElement).value || '',
                index
            }))
        )
    }

}
