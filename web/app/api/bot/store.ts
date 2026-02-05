import { randomUUID } from 'crypto'

type JobStatus = 'running' | 'success' | 'error'

export type BotJob = {
  id: string
  status: JobStatus
  startedAt: string
  endedAt?: string
  output: string[]
  error?: string
}

const jobs = new Map<string, BotJob>()

export const createJob = () => {
  const job: BotJob = {
    id: randomUUID(),
    status: 'running',
    startedAt: new Date().toISOString(),
    output: []
  }
  jobs.set(job.id, job)
  return job
}

export const appendOutput = (id: string, chunk: string) => {
  const job = jobs.get(id)
  if (!job) return
  job.output.push(chunk)
  if (job.output.length > 2000) {
    job.output.splice(0, job.output.length - 2000)
  }
}

export const completeJob = (id: string) => {
  const job = jobs.get(id)
  if (!job) return
  job.status = 'success'
  job.endedAt = new Date().toISOString()
}

export const failJob = (id: string, error: string) => {
  const job = jobs.get(id)
  if (!job) return
  job.status = 'error'
  job.error = error
  job.endedAt = new Date().toISOString()
}

export const getJob = (id: string) => {
  return jobs.get(id) || null
}
