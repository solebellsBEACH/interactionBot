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
  startOffset?: number
}

export type AppliedJobResult = {
  urn: string
  title: string
  company: string
  location: string
  url: string
  appliedAt: string
  appliedAgeDays: number | null
  page: number
}

export type AppliedJobsRangePreset = 'week' | 'month' | 'quarter' | 'custom'

export type ScanAppliedJobsOptions = {
  periodPreset?: AppliedJobsRangePreset
  customDays?: number
}

export type AppliedJobsScanResult = {
  total: number
  scannedPages: number
  totalPages: number | null
  filterPreset: AppliedJobsRangePreset
  filterDays: number
  filterLabel: string
  stoppedEarly: boolean
  jobs: AppliedJobResult[]
}
