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
  const raw = process.env[key]
  if (raw === undefined || raw === null) return fallback
  const trimmed = raw.trim()
  if (!trimmed) return fallback
  const value = Number(trimmed)
  return Number.isNaN(value) ? fallback : value
}

export const env = {
  userDataDir: readString('USER_DATA_DIR', DEFAULTS.userDataDir),
  worker: {
    sessionMode: readString('BOT_SESSION_MODE', 'persistent'),
    timeoutMs: readNumber('BOT_WORKER_TIMEOUT_MS', 0),
  },
  admin: {
    enabled: readBool('ADMIN_ENABLED', true),
    host: readString('ADMIN_HOST', '127.0.0.1'),
    port: readNumber('ADMIN_PORT', 5050),
  },
  discord: {
    enabled: readBool('DISCORD_ENABLED'),
    webhookUrl: readString('DISCORD_WEBHOOK_URL'),
    botToken: readString('DISCORD_BOT_TOKEN'),
    channelId: readString('DISCORD_CHANNEL_ID'),
    requestTimeoutMs: readNumber('DISCORD_TIMEOUT_MS', 120_000),
    interactive: readBool('DISCORD_INTERACTIVE'),
    consoleOnly: readBool('DISCORD_CONSOLE_ONLY'),
    commandPrefix: readString('DISCORD_COMMAND_PREFIX', '!'),
    commandsEnabled: readBool('DISCORD_COMMANDS_ENABLED', true),
  },
  linkedinAuth: {
    email: readString('LINKEDIN_EMAIL'),
    password: readString('LINKEDIN_PASSWORD'),
  },
  gpt: {
    enabled: readBool('GPT_ENABLED', true),
    baseUrl: readString('LLAMA_BASE_URL', 'http://localhost:11434'),
    model: readString('LLAMA_MODEL', 'llama3.2'),
    requestTimeoutMs: readNumber('GPT_TIMEOUT_MS', 90_000),
    temperature: readNumber('GPT_TEMPERATURE', 0.1),
    maxTokens: readNumber('GPT_MAX_TOKENS', 64),
  },
  easyApply: {
    isStandalone: readBool('EASY_APPLY_STANDALONE'),
    promptTimeoutMs: readNumber('EASY_APPLY_PROMPT_TIMEOUT_MS', 120_000),
  },
  api: {
    baseUrl: readString('API_BASE_URL', 'http://localhost:3001'),
    authToken: readString('API_AUTH_TOKEN', readString('BOT_API_TOKEN')),
  },
  linkedinURLs: {
    postUrl: readString('LINKEDIN_POST_URL', DEFAULTS.linkedin.postUrl),
    feedURL: readString('LINKEDIN_FEED_URL', DEFAULTS.linkedin.feedURL),
    searchJobTag: readString('LINKEDIN_SEARCH_TAG', DEFAULTS.linkedin.searchJobTag),
    jobURL: readString('LINKEDIN_JOB_URL', DEFAULTS.linkedin.jobURL),
    recruiterURL: readString('LINKEDIN_RECRUITER_URL', DEFAULTS.linkedin.recruiterURL),
    message: readString('LINKEDIN_CONNECT_MESSAGE', DEFAULTS.linkedin.message),
    defaultJobsApplyLength: readNumber('LINKEDIN_DEFAULT_JOBS_APPLY_LENGTH', DEFAULTS.linkedin.defaultJobsApplyLength)
  },
  redis: {
    url: readString('REDIS_URL'),
  },
  queue: {
    enabled: readBool('WORKER_QUEUE_ENABLED'),
  },
  db: {
    url: readString('DATABASE_URL'),
    profileStorage: readString('USER_PROFILE_STORAGE', 'file'),
  },
}
