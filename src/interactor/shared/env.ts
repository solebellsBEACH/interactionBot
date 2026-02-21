import fs from "fs";
import path from "path";
import { DEFAULTS } from "./config/defaults";

const loadEnvFromFile = (filePath: string) => {
  if (!fs.existsSync(filePath)) return

  const content = fs.readFileSync(filePath, "utf-8")
  for (const line of content.split(/\r?\n/)) {
    const trimmed = line.trim()
    if (!trimmed || trimmed.startsWith("#")) continue

    const idx = trimmed.indexOf("=")
    if (idx === -1) continue

    const key = trimmed.slice(0, idx).trim()
    let value = trimmed.slice(idx + 1).trim()
    if (!key) continue

    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1)
    }

    if (!(key in process.env)) {
      process.env[key] = value
    }
  }
}

loadEnvFromFile(path.resolve(process.cwd(), ".env"))

const readString = (key: string, fallback = '') => {
  const value = process.env[key]
  if (value === undefined || value === null) return fallback
  const trimmed = value.trim()
  return trimmed || fallback
}

const readBool = (key: string, fallback = false) => {
  const value = readString(key)
  if (!value) return fallback
  return value.toLowerCase() === 'true'
}

const readNumber = (key: string, fallback = 0) => {
  const value = Number(readString(key))
  return Number.isNaN(value) ? fallback : value
}

export const env = {
  userDataDir: readString('USER_DATA_DIR', DEFAULTS.userDataDir),
  linkedinAuth: {
    email: readString('LINKEDIN_EMAIL'),
    password: readString('LINKEDIN_PASSWORD'),
  },
  gpt: {
    enabled: readBool('GPT_ENABLED') || Boolean(readString('OPENAI_API_KEY')),
    apiKey: readString('OPENAI_API_KEY'),
    model: readString('GPT_MODEL', 'gpt-4o-mini'),
    baseUrl: readString('GPT_BASE_URL'),
    requestTimeoutMs: readNumber('GPT_TIMEOUT_MS', 20_000),
    temperature: readNumber('GPT_TEMPERATURE', 0.2),
    maxTokens: readNumber('GPT_MAX_TOKENS', 64),
  },
  easyApply: {
    isStandalone: readBool('EASY_APPLY_STANDALONE'),
    promptTimeoutMs: readNumber('EASY_APPLY_PROMPT_TIMEOUT_MS', 120_000),
  },
  api: {
    baseUrl: readString('API_BASE_URL', 'http://localhost:3001'),
  },
  linkedinURLs: {
    postUrl: readString('LINKEDIN_POST_URL', DEFAULTS.linkedin.postUrl),
    feedURL: readString('LINKEDIN_FEED_URL', DEFAULTS.linkedin.feedURL),
    searchJobTag: readString('LINKEDIN_SEARCH_TAG', DEFAULTS.linkedin.searchJobTag),
    jobURL: readString('LINKEDIN_JOB_URL', DEFAULTS.linkedin.jobURL),
    recruiterURL: readString('LINKEDIN_RECRUITER_URL', DEFAULTS.linkedin.recruiterURL),
    message: readString('LINKEDIN_CONNECT_MESSAGE', DEFAULTS.linkedin.message),
    defaultJobsApplyLength: readNumber('LINKEDIN_DEFAULT_JOBS_APPLY_LENGTH', DEFAULTS.linkedin.defaultJobsApplyLength)
  }
}
