import { LINKEDIN_URLS } from "../constants/linkedin-urls"

const homeDir = process.env.HOME || '/home/lucas'

export const DEFAULTS = {
    userDataDir: `${homeDir}/.config/interactionBot/chrome-profile`,
    linkedin: {
        postUrl: `${LINKEDIN_URLS.contentSearch}?keywords=%23react%20%23job&origin=GLOBAL_SEARCH_HEADER`,
        feedURL: LINKEDIN_URLS.feed,
        searchJobTag: 'Front-end',
        jobURL: '',
        recruiterURL: '',
        message: '',
        defaultJobsApplyLength: 20
    }
}
