import { Page } from "playwright";

export type Role = Parameters<Page['getByRole']>[0];
export enum HandleActions {
    click = 'click',
    fill = "fill"
}
