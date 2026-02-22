export type EasyApplyJobResult = {
  title: string
  company: string
  location: string
  url: string
  promoted: boolean
  easyApply: boolean
  applicants: number | null
  postedAt?: string | null
}

export type SearchJobTagOptions = {
  location?: string
  geoId?: string | number
  maxPages?: number
  maxResults?: number
  easyApplyOnly?: boolean
  onlyNonPromoted?: boolean
  maxApplicants?: number
  includeUnknownApplicants?: boolean
  includeDetails?: boolean
  postedWithinDays?: number
  workplaceTypes?: string[]
}
