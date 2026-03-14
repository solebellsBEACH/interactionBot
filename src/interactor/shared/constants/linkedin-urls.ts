export const LINKEDIN_BASE_URL = 'https://www.linkedin.com'

export const LINKEDIN_URLS = {
  base: LINKEDIN_BASE_URL,
  feed: `${LINKEDIN_BASE_URL}/feed/`,
  login: `${LINKEDIN_BASE_URL}/login`,
  checkpointLogin: `${LINKEDIN_BASE_URL}/checkpoint/lg/sign-in-another-account`,
  logoutMobile: `${LINKEDIN_BASE_URL}/m/logout/`,
  logoutUas: `${LINKEDIN_BASE_URL}/uas/logout`,
  profileMe: `${LINKEDIN_BASE_URL}/in/me/`,
  connections: `${LINKEDIN_BASE_URL}/mynetwork/invite-connect/connections/`,
  networkManager: `${LINKEDIN_BASE_URL}/mynetwork/network-manager/people/`,
  peopleSearch: `${LINKEDIN_BASE_URL}/search/results/people/`,
  contentSearch: `${LINKEDIN_BASE_URL}/search/results/content/`,
  jobSearch: `${LINKEDIN_BASE_URL}/jobs/search/`,
  appliedJobs: `${LINKEDIN_BASE_URL}/my-items/saved-jobs/?cardType=APPLIED`,
  feedUpdateBase: `${LINKEDIN_BASE_URL}/feed/update/`,
  voyagerConnections: [
    `${LINKEDIN_BASE_URL}/voyager/api/relationships/dash/connections`,
    `${LINKEDIN_BASE_URL}/voyager/api/relationships/connections`
  ]
} as const
