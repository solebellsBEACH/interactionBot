import { NextResponse } from 'next/server'
import { spawn } from 'child_process'
import fs from 'fs'
import path from 'path'
import { appendOutput, completeJob, createJob, failJob } from '../store'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const allowedActions = new Set([
  'profile',
  'easy-apply',
  'search-jobs',
  'catch-jobs',
  'connect',
  'upvote'
])

type Payload = {
  jobUrl?: string
  tag?: string
  profileUrl?: string
  message?: string
  maxResults?: number
  maxLikes?: number
  headless?: boolean
}

const clean = (value?: string) => (value || '').trim()

const buildArgs = (action: string, payload: Payload) => {
  const args = ['--action', action]
  if (clean(payload.jobUrl)) args.push('--jobUrl', clean(payload.jobUrl))
  if (clean(payload.tag)) args.push('--tag', clean(payload.tag))
  if (clean(payload.profileUrl)) args.push('--profileUrl', clean(payload.profileUrl))
  if (clean(payload.message)) args.push('--message', clean(payload.message))
  if (typeof payload.maxResults === 'number' && !Number.isNaN(payload.maxResults)) {
    args.push('--maxResults', String(payload.maxResults))
  }
  if (typeof payload.maxLikes === 'number' && !Number.isNaN(payload.maxLikes)) {
    args.push('--maxLikes', String(payload.maxLikes))
  }
  if (payload.headless) {
    args.push('--headless', 'true')
  }
  return args
}

export async function POST(request: Request) {
  let body: { action?: string; payload?: Payload } | null = null
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'invalid-json' }, { status: 400 })
  }

  const action = body?.action || ''
  if (!allowedActions.has(action)) {
    return NextResponse.json({ error: 'invalid-action' }, { status: 400 })
  }

  const payload = body?.payload || {}
  const job = createJob()

  const repoRoot = resolveRepoRoot()
  const cliPath = resolveCliPath(repoRoot)
  const runner = process.env.BOT_RUNNER || process.execPath
  const runnerArgs = [
    '-r',
    'ts-node/register',
    cliPath,
    ...buildArgs(action, payload)
  ]

  const child = spawn(runner, runnerArgs, {
    cwd: repoRoot,
    env: process.env,
    stdio: ['ignore', 'pipe', 'pipe']
  })

  child.stdout.on('data', (data) => {
    appendOutput(job.id, data.toString())
  })

  child.stderr.on('data', (data) => {
    appendOutput(job.id, data.toString())
  })

  child.on('close', (code) => {
    if (code === 0) {
      completeJob(job.id)
    } else {
      failJob(job.id, `exit-code:${code ?? 'unknown'}`)
    }
  })

  child.on('error', (error) => {
    failJob(job.id, `spawn-error:${error.message}`)
  })

  return NextResponse.json({ jobId: job.id })
}

const resolveRepoRoot = () => {
  const envRoot = (process.env.BOT_REPO_PATH || '').trim()
  if (envRoot && fs.existsSync(envRoot)) return envRoot

  const parent = path.resolve(process.cwd(), '..')
  const candidates = [
    path.join(parent, 'interactionBot'),
    path.join(parent, 'interaction-bot'),
    parent
  ]

  for (const candidate of candidates) {
    const cli = path.join(candidate, 'src', 'interactor', 'cli.ts')
    if (fs.existsSync(cli)) return candidate
  }

  return parent
}

const resolveCliPath = (repoRoot: string) => {
  const override = (process.env.BOT_CLI_PATH || '').trim()
  if (override) {
    return path.isAbsolute(override) ? override : path.join(repoRoot, override)
  }
  return path.join(repoRoot, 'src', 'interactor', 'cli.ts')
}
