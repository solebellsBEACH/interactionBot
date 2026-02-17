import { spawn } from 'child_process'
import fs from 'fs'
import path from 'path'
import { setTimeout as delay } from 'timers/promises'

const PROJECT_ROOT = process.cwd()
const ENV_FILE = path.join(PROJECT_ROOT, '.env')

const envFile = loadEnvFile(ENV_FILE)
const readEnv = (key, fallback = '') => {
  if (key in process.env && typeof process.env[key] === 'string') {
    return process.env[key]
  }
  if (key in envFile) return envFile[key]
  return fallback
}

const CLI_PATH = resolveCliPath()
const HEADLESS = readEnv('BOT_TEST_HEADLESS', 'true')
const TIMEOUT_MS = Number(readEnv('BOT_TEST_TIMEOUT_MS', '180000'))
const OUTPUT_DIR = createOutputDir()

const baseConfig = {
  profileUrl: readEnv('BOT_TEST_PROFILE_URL', readEnv('LINKEDIN_PROFILE_URL', '')),
  jobUrl: readEnv('BOT_TEST_JOB_URL', readEnv('LINKEDIN_JOB_URL', '')),
  tag: readEnv('BOT_TEST_TAG', readEnv('LINKEDIN_SEARCH_TAG', '')),
  message: readEnv('BOT_TEST_MESSAGE', readEnv('LINKEDIN_CONNECT_MESSAGE', ''))
}

const features = [
  {
    name: 'profile',
    action: 'profile',
    args: { profileUrl: baseConfig.profileUrl },
    required: ['profileUrl']
  },
  {
    name: 'dashboard',
    action: 'dashboard',
    args: { profileUrl: baseConfig.profileUrl },
    required: []
  },
  {
    name: 'dashboard-profile',
    action: 'dashboard-profile',
    args: { profileUrl: baseConfig.profileUrl },
    required: []
  },
  {
    name: 'dashboard-network',
    action: 'dashboard-network',
    args: {},
    required: []
  },
  {
    name: 'connections-visit',
    action: 'connections-visit',
    args: {
      maxConnections: readEnv('BOT_TEST_MAX_CONNECTIONS', '1'),
      delayMs: readEnv('BOT_TEST_DELAY_MS', '250'),
      maxScrollRounds: readEnv('BOT_TEST_SCROLL_ROUNDS', '1'),
      maxIdleRounds: readEnv('BOT_TEST_IDLE_ROUNDS', '1')
    },
    required: []
  },
  {
    name: 'easy-apply',
    action: 'easy-apply',
    args: { jobUrl: baseConfig.jobUrl },
    required: ['jobUrl']
  },
  {
    name: 'search-jobs',
    action: 'search-jobs',
    args: {
      tag: baseConfig.tag,
      maxResults: readEnv('BOT_TEST_MAX_RESULTS', '1'),
      maxPages: readEnv('BOT_TEST_MAX_PAGES', '1'),
      postedWithinDays: readEnv('BOT_TEST_POSTED_DAYS', '1')
    },
    required: ['tag']
  },
  {
    name: 'catch-jobs',
    action: 'catch-jobs',
    args: {
      tag: baseConfig.tag,
      maxResults: readEnv('BOT_TEST_MAX_RESULTS', '1'),
      maxPages: readEnv('BOT_TEST_MAX_PAGES', '1'),
      postedWithinDays: readEnv('BOT_TEST_POSTED_DAYS', '1'),
      easyApplyOnly: readEnv('BOT_TEST_EASY_APPLY_ONLY', 'true')
    },
    required: []
  },
  {
    name: 'connect',
    action: 'connect',
    args: {
      profileUrl: baseConfig.profileUrl,
      message: baseConfig.message || 'Oi! Gostaria de adicionar voce na minha rede.'
    },
    required: ['profileUrl']
  },
  {
    name: 'upvote',
    action: 'upvote',
    args: {
      tag: baseConfig.tag,
      maxLikes: readEnv('BOT_TEST_MAX_LIKES', '1')
    },
    required: []
  }
]

const results = []

const main = async () => {
  const start = Date.now()
  const missing = validatePrereqs()
  if (missing.length) {
    record('preflight', 'fail', `faltando: ${missing.join(', ')}`)
  } else {
    record('preflight', 'pass', 'ok')
  }

  for (const feature of features) {
    await runFeature(feature)
  }

  const totalMs = Date.now() - start
  const memory = process.memoryUsage()
  record('metrics-runner', 'info', `rss ${(memory.rss / 1024 / 1024).toFixed(1)} MB`)
  record('metrics-total', 'info', `${totalMs}ms`)

  printSummary()

  const failures = results.filter((item) => item.status === 'fail')
  if (failures.length > 0) {
    process.exitCode = 1
  }
}

const runFeature = async (feature) => {
  const start = Date.now()
  const logFile = path.join(OUTPUT_DIR, `${feature.name}.log`)

  try {
    ensureRequired(feature)

    const args = buildArgs(feature)
    const env = {
      ...process.env,
      DISCORD_ENABLED: 'false',
      DISCORD_INTERACTIVE: 'false',
      DISCORD_COMMANDS_ENABLED: 'false',
      DISCORD_CONSOLE_ONLY: 'true'
    }

    const child = spawn(process.execPath, args, {
      cwd: PROJECT_ROOT,
      env,
      stdio: ['ignore', 'pipe', 'pipe']
    })

    const memorySampler = startMemorySampler(child.pid)
    const outputChunks = []

    child.stdout.on('data', (chunk) => outputChunks.push(chunk.toString()))
    child.stderr.on('data', (chunk) => outputChunks.push(chunk.toString()))

    const exitCode = await waitForExit(child, TIMEOUT_MS)
    const durationMs = Date.now() - start
    const memoryStats = memorySampler.stop()

    const output = outputChunks.join('')
    fs.writeFileSync(logFile, output)

    const logChecks = verifyLogs(feature, output, exitCode)
    if (logChecks.status === 'fail') {
      return recordFeature(feature, 'fail', `${logChecks.details} | ${formatMetrics(durationMs, memoryStats)} | log ${logFile}`)
    }

    return recordFeature(feature, 'pass', `${formatMetrics(durationMs, memoryStats)} | log ${logFile}`)
  } catch (error) {
    const durationMs = Date.now() - start
    const message = error instanceof Error ? error.message : 'erro desconhecido'
    return recordFeature(feature, 'fail', `${message} | ${durationMs}ms | log ${logFile}`)
  }
}

const buildArgs = (feature) => {
  const args = ['-r', 'ts-node/register', CLI_PATH, '--action', feature.action, '--headless', HEADLESS]
  const payload = feature.args || {}

  for (const [key, value] of Object.entries(payload)) {
    if (value === undefined || value === null) continue
    const normalized = String(value).trim()
    if (!normalized) continue
    args.push(`--${key}`, normalized)
  }

  return args
}

const ensureRequired = (feature) => {
  if (!feature.required || feature.required.length === 0) return
  const missing = feature.required.filter((key) => {
    const value = feature.args?.[key]
    if (value === undefined || value === null) return true
    return String(value).trim() === ''
  })

  if (missing.length) {
    throw new Error(`${feature.action} missing: ${missing.join(', ')}`)
  }
}

const verifyLogs = (feature, output, exitCode) => {
  const expectedStart = `[bot] Iniciando ação: ${feature.action}`
  if (!output.includes(expectedStart)) {
    return { status: 'fail', details: 'log inicio ausente' }
  }
  if (exitCode !== 0) {
    return { status: 'fail', details: `exit-code ${exitCode}` }
  }
  if (!output.includes('Ação concluída.')) {
    return { status: 'fail', details: 'log de conclusao ausente' }
  }
  return { status: 'pass', details: 'ok' }
}

const waitForExit = (child, timeoutMs) =>
  new Promise((resolve) => {
    let settled = false
    const timeout = setTimeout(() => {
      if (settled) return
      settled = true
      child.kill('SIGTERM')
      setTimeout(() => {
        if (!child.killed) {
          child.kill('SIGKILL')
        }
      }, 2000)
      resolve('timeout')
    }, timeoutMs)

    child.on('close', (code) => {
      if (settled) return
      settled = true
      clearTimeout(timeout)
      resolve(code === null ? 1 : code)
    })

    child.on('error', () => {
      if (settled) return
      settled = true
      clearTimeout(timeout)
      resolve(1)
    })
  })

const recordFeature = (feature, status, details) => {
  const entry = { name: `feature:${feature.name}`, status, details }
  results.push(entry)
  return entry
}

const record = (name, status, details = '') => {
  results.push({ name, status, details })
}

const printSummary = () => {
  console.log('\nResumo:')
  for (const entry of results) {
    console.log(`- [${entry.status}] ${entry.name}${entry.details ? ` -> ${entry.details}` : ''}`)
  }
}

const formatMetrics = (durationMs, memoryStats) => {
  const parts = [`${durationMs}ms`]
  if (memoryStats.samples > 0) {
    parts.push(`rss max ${memoryStats.maxKb} kB`)
    parts.push(`rss avg ${memoryStats.avgKb} kB`)
  }
  return parts.join(' | ')
}

const validatePrereqs = () => {
  const missing = []
  if (!fs.existsSync(CLI_PATH)) missing.push(`cli:${CLI_PATH}`)
  if (!readEnv('LINKEDIN_EMAIL')) missing.push('LINKEDIN_EMAIL')
  if (!readEnv('LINKEDIN_PASSWORD')) missing.push('LINKEDIN_PASSWORD')
  if (!baseConfig.profileUrl) missing.push('BOT_TEST_PROFILE_URL or LINKEDIN_PROFILE_URL')
  if (!baseConfig.jobUrl) missing.push('BOT_TEST_JOB_URL or LINKEDIN_JOB_URL')
  if (!baseConfig.tag) missing.push('BOT_TEST_TAG or LINKEDIN_SEARCH_TAG')
  return missing
}

const readRssKb = (pid) => {
  if (!pid) return null
  if (process.platform !== 'linux') return null
  try {
    const status = fs.readFileSync(`/proc/${pid}/status`, 'utf8')
    const match = status.match(/^VmRSS:\s+(\d+)\s+kB/m)
    return match ? Number(match[1]) : null
  } catch {
    return null
  }
}

const startMemorySampler = (pid) => {
  let max = 0
  let total = 0
  let samples = 0
  const interval = setInterval(() => {
    const rss = readRssKb(pid)
    if (rss === null) return
    max = Math.max(max, rss)
    total += rss
    samples += 1
  }, 500)

  return {
    stop() {
      clearInterval(interval)
      const avg = samples ? Math.round(total / samples) : 0
      return { maxKb: max, avgKb: avg, samples }
    }
  }
}

function loadEnvFile(filePath) {
  const values = {}
  if (!fs.existsSync(filePath)) return values
  const content = fs.readFileSync(filePath, 'utf8')
  for (const line of content.split(/\r?\n/)) {
    const trimmed = line.trim()
    if (!trimmed || trimmed.startsWith('#')) continue
    const idx = trimmed.indexOf('=')
    if (idx === -1) continue
    const key = trimmed.slice(0, idx).trim()
    let value = trimmed.slice(idx + 1).trim()
    if (!key) continue
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1)
    }
    if (!(key in values)) {
      values[key] = value
    }
  }
  return values
}

function resolveCliPath() {
  const override = readEnv('BOT_CLI_PATH')
  if (override) {
    return path.isAbsolute(override) ? override : path.join(PROJECT_ROOT, override)
  }
  return path.join(PROJECT_ROOT, 'src', 'interactor', 'cli.ts')
}

function createOutputDir() {
  const stamp = new Date().toISOString().replace(/[:.]/g, '-')
  const dir = path.join(PROJECT_ROOT, 'test-logs', stamp)
  fs.mkdirSync(dir, { recursive: true })
  return dir
}

main().catch((error) => {
  record('test-runner', 'fail', error instanceof Error ? error.message : 'erro desconhecido')
  printSummary()
  process.exitCode = 1
})
