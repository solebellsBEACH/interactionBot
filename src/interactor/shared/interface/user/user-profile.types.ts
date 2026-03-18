export type UserProfileCompensation = {
  hourlyUsd: string
  hourlyBrl: string
  clt: string
  pj: string
}

export type UserProfileStackExperience = {
  firstSeenAt: string
  months: number
  years: string
  durationLabel: string
  sourceCompanies: string[]
  sourceTitles: string[]
}

export type UserProfileLinkedinExperience = {
  title: string
  company: string
  employmentType: string
  location: string
  dateRangeLabel: string
  description: string
  startDate: string | null
  endDate: string | null
  isCurrent: boolean
  stacks: string[]
}

export type UserProfileLinkedinEducation = {
  school: string
  degree: string
  period: string
}

export type UserProfileLinkedinProject = {
  title: string
  description: string
}

export type UserProfileLinkedinSnapshot = {
  capturedAt: string
  name: string
  headline: string
  location: string
  website: string
  connections: string
  currentCompany: string
  topEducation: string
  about: string
  avatarUrl: string
  backgroundImageUrl: string
  topSkills: string[]
  languages: string[]
  experiences: UserProfileLinkedinExperience[]
  education: UserProfileLinkedinEducation[]
  projects: UserProfileLinkedinProject[]
  totalExperienceMonths: number
  totalExperienceLabel: string
}

export type UserProfileReview = {
  createdAt: string
  raw: string
  parsed: Record<string, unknown> | null
}

export type UserProfile = {
  summary: string
  answers: Record<string, string>
  birthDate: string
  compensation: UserProfileCompensation
  stackExperience: Record<string, UserProfileStackExperience>
  linkedinProfile: UserProfileLinkedinSnapshot | null
  profileReview: UserProfileReview | null
  updatedAt: string
}
