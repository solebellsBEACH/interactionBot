import { Locator, Page, } from "playwright";
import { HandleActions, Role } from "../interfaces/element-handle";

export type FormFieldValue = {
    key?: string
    label?: string | null
    value: string
}

export type FormValues = {
    inputValues: FormFieldValue[]
    selectValues: FormFieldValue[]
}

export class ElementHandle {
    private _page: Page
    private DEFAULT_TIMEOUT:number

    constructor(page: Page, timeout?:number){
        this._page = page
        this.DEFAULT_TIMEOUT=timeout||5_000
    }

    async handleByRole(handle:HandleActions, role:Role, options:{name?:string}, contentText?:string){
        try {
            const element = this._page.getByRole(role, options);
            await element.waitFor({ state: 'visible', timeout:this.DEFAULT_TIMEOUT });
            return this._runHandleActions(handle, element, contentText) || element
        } catch (error) {
            console.error({
                label:options.name,
                error
            })
        }
    }

    async handleByPlaceholder(handle:HandleActions, placeholder:string, contentText:string){
        try {
            const element = this._page.getByPlaceholder(placeholder); 
            await element.waitFor({ state: 'visible', timeout:this.DEFAULT_TIMEOUT });
            return this._runHandleActions(handle, element, contentText)|| element
        } catch (error) {
             console.error({
            label:placeholder,
            error
        })
        }
    }

    async handleForm(): Promise<FormValues | undefined>{
        const forms = this._page.locator('.jobs-easy-apply-modal form, .jobs-easy-apply-content form, form')
        const count = await forms.count()

        for (let i = 0; i < count; i++) {
            const element = forms.nth(i)
            try {
                await element.waitFor({ state: 'visible', timeout:this.DEFAULT_TIMEOUT });
                return this._getFormValues(element)
            } catch (error) {
                // try next visible form if exists
                if (i === count - 1) throw error
            }
        }
    }

    private async _getFormValues(element: Locator): Promise<FormValues> {
        const selectValues = await this._getSelectValues(element)
        const inputValues = await this._getInputValues(element)
       
        return {
            selectValues,
            inputValues
        };
    }

    private async  _getInputValues(element:Locator): Promise<FormFieldValue[]>{
        const inputs = await element.getByRole('textbox').all();
        return await Promise.all(
            inputs.map(async (item) => {
                const value = await item.inputValue()
                const meta = await this._getControlMeta(item)
                const label = meta.labelText || meta.placeholder || meta.ariaLabel || meta.name || meta.id
                const key = this._normalizeKey(label || undefined)
                return {
                    key,
                    label,
                    value
                }
            })
        );
    }

    private async _getSelectValues(element:Locator): Promise<FormFieldValue[]>{
        const selects = await element.locator('select').all()
        if (selects.length === 0) return []

        return Promise.all(
            selects.map(async (select) => {
                const meta = await this._getControlMeta(select)
                const selectedOption = await select.locator('option:checked').allInnerTexts()
                let value = selectedOption[0]?.trim() || ''

                if (!value) {
                    const fallbackOptions = await select.locator('option').allInnerTexts()
                    const idx = fallbackOptions.findIndex((item) => item.includes('Select an option'))
                    if (idx >= 0 && fallbackOptions[idx + 1]) {
                        value = fallbackOptions[idx + 1].trim()
                    }
                }

                const label = meta.labelText || meta.ariaLabel || meta.name || meta.id
                const key = this._normalizeKey(label || undefined)

                return {
                    key,
                    label,
                    value
                }
            })
        )
    }

    private async _runHandleActions(handle: HandleActions, element: Locator, contentText?:string){
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
            let labelText: string | null = null

            if (ariaLabelledBy) {
                for (const ref of ariaLabelledBy.split(' ')) {
                    const labelEl = document.getElementById(ref)
                    labelText = getText(labelEl)
                    if (labelText) break
                }
            }

            if (!labelText && id) {
                const labelEl = document.querySelector(`label[for="${id}"]`)
                labelText = getText(labelEl)
            }

            if (!labelText) {
                const closestLabel = el.closest('label')
                labelText = getText(closestLabel)
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
    
}
