import { LINKEDIN_URLS } from "../constants/linkedin-urls"

const homeDir = process.env.HOME || '/home/lucas'

export const DEFAULTS = {
    userDataDir: `${homeDir}/.config/interactionBot/chrome-profile`,
    linkedin: {
        feedURL: LINKEDIN_URLS.feed,
        searchJobTag: 'Front-end',
        jobURL: '',
        defaultJobsApplyLength: 20
    }
}
