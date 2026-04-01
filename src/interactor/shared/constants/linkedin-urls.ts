export const LINKEDIN_BASE_URL = 'https://www.linkedin.com'

export const LINKEDIN_URLS = {
  base: LINKEDIN_BASE_URL,
  feed: `${LINKEDIN_BASE_URL}/feed/`,
  login: `${LINKEDIN_BASE_URL}/login`,
  checkpointLogin: `${LINKEDIN_BASE_URL}/checkpoint/lg/sign-in-another-account`,
  logoutMobile: `${LINKEDIN_BASE_URL}/m/logout/`,
  logoutUas: `${LINKEDIN_BASE_URL}/uas/logout`,
  profileMe: `${LINKEDIN_BASE_URL}/in/me/`,
  jobSearch: `${LINKEDIN_BASE_URL}/jobs/search/`,
} as const
