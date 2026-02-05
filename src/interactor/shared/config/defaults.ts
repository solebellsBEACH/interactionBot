const homeDir = process.env.HOME || '/home/lucas'

export const DEFAULTS = {
    userDataDir: `${homeDir}/.config/interactionBot/chrome-profile`,
    linkedin: {
        postUrl: 'https://www.linkedin.com/search/results/content/?keywords=%23react%20%23job&origin=GLOBAL_SEARCH_HEADER',
        feedURL: 'https://www.linkedin.com/feed/',
        searchJobTag: 'Front-end',
        jobURL: '',
        recruiterURL: '',
        message: '',
        defaultJobsApplyLength: 20
    }
}
