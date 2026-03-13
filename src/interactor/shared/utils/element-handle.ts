import { Locator, Page, } from "playwright";
import { EASY_APPLY_SELECTORS } from "../constants/easy-apply";
import { HandleActions, Role } from "../interface/element-handle/element-handle.types";
import { FormFieldValue, FormPromptField, FormValues } from "../interface/forms/form.types";
import { logger } from "../services/logger";
import { normalizeKey, normalizeTextBasic } from "../utils/normalize";

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
            await element.allInnerTexts().then((texts) => logger.debug('element-handle texts', texts))
            await element.waitFor({ state: 'visible', timeout: this.DEFAULT_TIMEOUT });

            return this._runHandleActions(handle, element, contentText) || element
        } catch (error) {
            logger.error('element-handle error', {
                label: options.name,
                error
            })
        }
    }

    async handleByLocator(handle: HandleActions, selector: string, options?: {
            has?: Locator | undefined;
            hasNot?: Locator;
            hasNotText?: string | RegExp;
            hasText?: string | RegExp;
        } , contentText?: string) {
        try {
            const element = this._page.locator(selector,  options);
            await element.waitFor({ state: 'visible', timeout: this.DEFAULT_TIMEOUT });

            return this._runHandleActions(handle, element, contentText) || element
        } catch (error) {
            logger.error('element-handle error', {
                label: selector,
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
            logger.error('element-handle error', {
                label: placeholder,
                error
            })
        }
    }

    async handleForm(prompt?: (field: FormPromptField) => Promise<string | null>): Promise<FormValues | undefined> {
        const forms = this._page.locator(EASY_APPLY_SELECTORS.form)
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

        const containers = this._page.locator(EASY_APPLY_SELECTORS.content)
        const containersCount = await containers.count()
        for (let i = 0; i < containersCount; i++) {
            const container = containers.nth(i)
            try {
                await container.waitFor({ state: 'visible', timeout: this.DEFAULT_TIMEOUT })
                return this._getFormValues(container, prompt)
            } catch (error) {
                if (i === containersCount - 1) throw error
            }
        }
    }

    private async _getFormValues(element: Locator, prompt?: (field: FormPromptField) => Promise<string | null>): Promise<FormValues> {
        await this._handleCheckboxes(element)
        const selectValues = await this._getSelectValues(element, prompt)
        const radioValues = await this._getRadioValues(element, prompt)
        const inputValues = await this._getInputValues(element, prompt)

        return {
            selectValues: [...selectValues, ...radioValues],
            inputValues
        };
    }

    private async _getInputValues(element: Locator, prompt?: (field: FormPromptField) => Promise<string | null>): Promise<FormFieldValue[]> {
        const inputs = await element
            .locator('input, textarea, [contenteditable="true"], [contenteditable=""], [role="textbox"], [role="spinbutton"], [role="combobox"]')
            .all()
        const values: FormFieldValue[] = []
        const seenKeys = new Set<string>()

        for (const item of inputs) {
            const visible = await item.isVisible().catch(() => false)
            if (!visible) continue

            const tag = await item.evaluate((el) => el.tagName.toLowerCase()).catch(() => '')
            const type = tag === 'input' ? (await item.getAttribute('type'))?.toLowerCase() : null
            if (tag === 'input' && type && this._isSkippableInputType(type)) continue

            if (tag === 'input' && type === 'file') {
                const meta = await this._getControlMeta(item)
                const label = meta.labelText || meta.placeholder || meta.ariaLabel || meta.name || meta.id
                const key = normalizeKey(label || undefined)
                const uniqueKey = meta.id || meta.name || key
                if (uniqueKey && seenKeys.has(uniqueKey)) continue
                if (uniqueKey) seenKeys.add(uniqueKey)

                const value = await this._readFieldValue(item)
                let finalValue = value
                if (prompt && !value.trim()) {
                    const answer = await prompt({
                        type: 'input',
                        key,
                        label,
                        value
                    })
                    if (answer && answer.trim()) {
                        await item.setInputFiles(answer.trim()).catch(() => undefined)
                        finalValue = answer.trim()
                    }
                }

                values.push({
                    key,
                    label,
                    value: finalValue
                })
                continue
            }

            const target = await this._resolveEditableTarget(item)
            const targetVisible = await target.isVisible().catch(() => false)
            if (!targetVisible) continue

            const meta = await this._getControlMeta(target)
            const label = meta.labelText || meta.placeholder || meta.ariaLabel || meta.name || meta.id
            const key = normalizeKey(label || undefined)
            const uniqueKey = meta.id || meta.name || key
            if (uniqueKey && seenKeys.has(uniqueKey)) continue
            if (uniqueKey) seenKeys.add(uniqueKey)

            const value = await this._readFieldValue(target)
            let finalValue = value

            const missing =
                !value.trim() ||
                (meta.placeholder && value.trim() === meta.placeholder.trim()) ||
                this._isSelectPlaceholder(value)
            if (prompt && missing) {
                const editable = await target.isEditable().catch(() => false)
                if (editable) {
                    const answer = await prompt({
                        type: 'input',
                        key,
                        label,
                        value
                    })
                    if (answer && answer.trim()) {
                        await this._fillField(target, answer, item)
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

    private async _handleCheckboxes(element: Locator) {
        const checkboxes = element.locator('input[type="checkbox"], [role="checkbox"]')
        const count = await checkboxes.count().catch(() => 0)
        if (count === 0) return

        for (let i = 0; i < count; i++) {
            const checkbox = checkboxes.nth(i)
            try {
                if (!(await checkbox.isVisible())) continue
                if (await checkbox.isDisabled()) continue
            } catch {
                continue
            }

            const alreadyChecked = await this._isCheckboxChecked(checkbox)
            if (alreadyChecked) continue

            const meta = await this._getControlMeta(checkbox)
            const label = meta.labelText || meta.ariaLabel || meta.name || meta.id || ''
            const required = await this._isCheckboxRequired(checkbox)
            const shouldCheck = required || this._isTermsConsentLabel(label)
            if (!shouldCheck) continue

            try {
                if ((await checkbox.getAttribute('type')) === 'checkbox') {
                    await checkbox.check({ force: true })
                } else {
                    await checkbox.click({ force: true })
                }
            } catch {
                try {
                    await checkbox.click({ force: true })
                } catch {
                    // ignore if cannot click
                }
            }
        }
    }

    private async _isCheckboxChecked(checkbox: Locator) {
        try {
            const type = await checkbox.getAttribute('type')
            if (type === 'checkbox') {
                return await checkbox.isChecked().catch(() => false)
            }
            const aria = await checkbox.getAttribute('aria-checked')
            return aria === 'true'
        } catch {
            return false
        }
    }

    private async _isCheckboxRequired(checkbox: Locator) {
        try {
            const aria = await checkbox.getAttribute('aria-required')
            if (aria === 'true') return true
            const required = await checkbox.getAttribute('required')
            if (required !== null) return true
        } catch {
            // ignore
        }
        return await checkbox.evaluate((el) => {
            const attrRequired = el.getAttribute('required')
            const ariaRequired = el.getAttribute('aria-required')
            if (attrRequired !== null || ariaRequired === 'true') return true
            const container = el.closest('[data-test-form-element], .jobs-easy-apply-form-element, fieldset')
            if (!container) return false
            if (container.getAttribute('aria-required') === 'true') return true
            if (container.querySelector('[aria-required="true"], .required, .required-field, [data-required="true"]')) {
                return true
            }
            const text = (container.textContent || '').toLowerCase()
            return text.includes('required') || text.includes('obrigatório') || text.includes('obrigatorio')
        }).catch(() => false)
    }

    private _isTermsConsentLabel(label: string) {
        const normalized = normalizeTextBasic(label)
        if (!normalized) return false
        const keywords = [
            'terms',
            'termos',
            'terms of use',
            'privacy',
            'privacidade',
            'policy',
            'politica',
            'política',
            'consent',
            'consentimento',
            'agree',
            'i agree',
            'aceito',
            'aceitar',
            'smartrecruiters',
            'experian',
            'condicoes',
            'condições'
        ]
        return keywords.some((keyword) => normalized.includes(keyword))
    }

    private async _getRadioValues(element: Locator, prompt?: (field: FormPromptField) => Promise<string | null>): Promise<FormFieldValue[]> {
        const values: FormFieldValue[] = []

        const inputRadios = await element.locator('input[type="radio"]').all()
        if (inputRadios.length > 0) {
            const groups = new Map<string, Locator[]>()
            for (let i = 0; i < inputRadios.length; i++) {
                const radio = inputRadios[i]
                const name = (await radio.getAttribute('name')) || `__radio_${i}`
                const list = groups.get(name) || []
                list.push(radio)
                groups.set(name, list)
            }

            for (const [name, radios] of groups.entries()) {
                const entry = await this._handleRadioGroup(radios, prompt, name)
                if (entry) values.push(entry)
            }
        }

        const radioGroups = await element.locator('[role="radiogroup"]').all()
        for (const group of radioGroups) {
            const hasInputRadio = await group.locator('input[type="radio"]').count().catch(() => 0)
            if (hasInputRadio > 0) continue
            const radios = await group.locator('[role="radio"]').all()
            const entry = await this._handleRadioGroup(radios, prompt)
            if (entry) values.push(entry)
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
            const key = normalizeKey(label || undefined)

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

    private _isSkippableInputType(type: string) {
        return ['hidden', 'checkbox', 'radio', 'button', 'submit', 'reset', 'image'].includes(type)
    }

    private async _resolveEditableTarget(control: Locator): Promise<Locator> {
        try {
            const nested = control.locator('input, textarea, [contenteditable="true"], [contenteditable=""]')
            if ((await nested.count()) > 0) return nested.first()
        } catch {
            // ignore
        }
        return control
    }

    private async _readFieldValue(control: Locator): Promise<string> {
        try {
            const value = await control.inputValue()
            return value || ''
        } catch {
            // ignore
        }

        try {
            const text = await control.innerText()
            return text.trim()
        } catch {
            // ignore
        }

        try {
            const text = await control.textContent()
            return (text || '').trim()
        } catch {
            return ''
        }
    }

    private async _fillField(target: Locator, value: string, source?: Locator) {
        const trimmed = value.trim()
        try {
            await target.fill(trimmed)
        } catch {
            try {
                await target.click({ force: true })
                await target.press('Control+A').catch(() => undefined)
                await target.type(trimmed, { delay: 15 })
            } catch {
                // ignore
            }
        }

        const ref = source || target
        const role = await ref.getAttribute('role').catch(() => null)
        const hasPopup = await ref.getAttribute('aria-haspopup').catch(() => null)
        if (role === 'combobox' || hasPopup === 'listbox') {
            await target.press('Enter').catch(() => undefined)
        }
    }

    private async _handleRadioGroup(
        radios: Locator[],
        prompt?: (field: FormPromptField) => Promise<string | null>,
        groupName?: string
    ): Promise<FormFieldValue | null> {
        if (radios.length === 0) return null

        const options: Array<{ label: string; locator: Locator }> = []
        let selected: string | null = null

        for (let i = 0; i < radios.length; i++) {
            const radio = radios[i]
            const visible = await radio.isVisible().catch(() => false)
            if (!visible) continue

            const label = await this._getRadioOptionLabel(radio)
            const fallback = (await radio.getAttribute('value')) || `option ${i + 1}`
            const optionLabel = label || fallback

            options.push({ label: optionLabel, locator: radio })

            const checked = await this._isRadioChecked(radio)
            if (checked) selected = optionLabel
        }

        if (options.length === 0) return null

        const groupLabel = await this._getRadioGroupLabel(radios[0])
        const label = groupLabel || groupName || options[0].label
        const key = normalizeKey(label || undefined)

        if (!selected && prompt) {
            const entries = options.map((option, index) => ({
                label: option.label,
                value: option.label,
                index
            }))
            const answer = await prompt({
                type: 'select',
                key,
                label,
                value: '',
                options: options.map((option) => option.label)
            })
            const resolvedIndex = this._resolveSelectIndex(answer, entries)
            if (resolvedIndex !== null) {
                const chosen = options[resolvedIndex]
                await chosen.locator.click({ force: true }).catch(() => undefined)
                selected = chosen.label
            }
        }

        return {
            key,
            label,
            value: selected || ''
        }
    }

    private async _getRadioGroupLabel(radio: Locator) {
        try {
            const container = radio.locator(
                'xpath=ancestor-or-self::*[self::fieldset or @role=\"radiogroup\" or @data-test-form-element or contains(@class,\"jobs-easy-apply-form-element\")][1]'
            )
            if ((await container.count()) > 0) {
                const meta = await this._getControlMeta(container.first())
                const label = meta.labelText || meta.ariaLabel || meta.name || meta.id
                if (label) return label
            }
        } catch {
            // ignore
        }

        const meta = await this._getControlMeta(radio)
        return meta.labelText || meta.ariaLabel || meta.name || meta.id || null
    }

    private async _getRadioOptionLabel(radio: Locator) {
        const meta = await this._getControlMeta(radio)
        const label = meta.labelText || meta.ariaLabel || meta.name || meta.id
        if (label) return label
        const text = await radio.innerText().catch(() => '')
        return text.trim() || null
    }

    private async _isRadioChecked(radio: Locator) {
        try {
            const type = await radio.getAttribute('type')
            if (type === 'radio') {
                return await radio.isChecked().catch(() => false)
            }
            const aria = await radio.getAttribute('aria-checked')
            return aria === 'true'
        } catch {
            return false
        }
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
