'use client'

import { useState } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { api } from '@/lib/api'

type JobResult = {
  url: string
  title?: string
  company?: string
  location?: string
  easyApply?: boolean
}

type AppliedJob = {
  url?: string
  title?: string
  company?: string
  location?: string
  appliedAt?: string
}

type ProcessRecord = { id: string; status: string; summary: string; error?: string }

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

async function waitForProcess(id: string, timeoutMs = 600_000): Promise<ProcessRecord> {
  const start = Date.now()
  while (Date.now() - start < timeoutMs) {
    const state = await api.get<{ running: ProcessRecord | null; history: ProcessRecord[] }>('/api/admin/processes')
    const p = state.running?.id === id ? state.running : state.history.find((h) => h.id === id)
    if (p && p.status !== 'running') return p
    await sleep(1500)
  }
  throw new Error('Tempo limite aguardando o processo.')
}

export default function JobsPage() {
  const qc = useQueryClient()
  const [jobs, setJobs] = useState<JobResult[]>([])
  const [selectedUrls, setSelectedUrls] = useState<Set<string>>(new Set())
  const [showFlowHint, setShowFlowHint] = useState(false)
  const [applyStatus, setApplyStatus] = useState('')
  const [scanStatus, setScanStatus] = useState('')
  const [easyApplyStatus, setEasyApplyStatus] = useState('')
  const [appliedJobs, setAppliedJobs] = useState<AppliedJob[]>([])
  const [easyApplyUrl, setEasyApplyUrl] = useState('')

  const [tag, setTag] = useState('')
  const [maxResults, setMaxResults] = useState('')
  const [location, setLocation] = useState('')
  const [maxPages, setMaxPages] = useState('')
  const [easyApplyOnly, setEasyApplyOnly] = useState(true)
  const [onlyNonPromoted, setOnlyNonPromoted] = useState(false)
  const [waitMs, setWaitMs] = useState('1500')
  const [maxApplicants, setMaxApplicants] = useState('')

  const searchMutation = useMutation({
    mutationFn: async () => {
      const { id } = await api.post<{ id: string }>('/api/admin/processes/search-jobs', {
        tag,
        apply: false,
        options: {
          maxResults: maxResults ? Number(maxResults) : undefined,
          location: location || undefined,
          maxPages: maxPages ? Number(maxPages) : undefined,
          easyApplyOnly,
          onlyNonPromoted,
          maxApplicants: maxApplicants ? Number(maxApplicants) : undefined,
        },
      })
      const proc = await waitForProcess(id, 5 * 60 * 1000)
      if (proc.status !== 'succeeded') throw new Error(proc.error || proc.summary || 'Falha na busca.')
      return proc
    },
    onSuccess: (proc) => {
      const output = (proc as unknown as { output?: { jobs?: JobResult[] } }).output
      const found = output?.jobs ?? []
      setJobs(found)
      setSelectedUrls(new Set())
      setShowFlowHint(found.length > 0)
      qc.invalidateQueries({ queryKey: ['processes'] })
    },
  })

  const applyMutation = useMutation({
    mutationFn: async () => {
      const urls = Array.from(selectedUrls)
      const { id } = await api.post<{ id: string }>('/api/admin/processes/apply-jobs', {
        jobUrls: urls,
        waitBetweenMs: waitMs ? Number(waitMs) : undefined,
      })
      const proc = await waitForProcess(id, 10 * 60 * 1000)
      if (proc.status !== 'succeeded') throw new Error(proc.error || proc.summary || 'Falha ao aplicar.')
      return proc
    },
    onSuccess: (proc) => {
      setApplyStatus(proc.summary)
      setSelectedUrls(new Set())
      qc.invalidateQueries({ queryKey: ['processes'] })
    },
    onError: (e) => setApplyStatus((e as Error).message),
  })

  const scanMutation = useMutation({
    mutationFn: async () => {
      const { id } = await api.post<{ id: string }>('/api/admin/processes/scan-applied-jobs', {})
      const proc = await waitForProcess(id, 10 * 60 * 1000)
      if (proc.status !== 'succeeded') throw new Error(proc.error || proc.summary || 'Falha na varredura.')
      return proc
    },
    onSuccess: (proc) => {
      setScanStatus(proc.summary)
      const output = (proc as unknown as { output?: { jobsPreview?: AppliedJob[] } }).output
      setAppliedJobs(output?.jobsPreview ?? [])
    },
    onError: (e) => setScanStatus((e as Error).message),
  })

  const easyApplyMutation = useMutation({
    mutationFn: async (jobUrl: string) => {
      const { id } = await api.post<{ id: string }>('/api/admin/processes/easy-apply', { jobUrl: jobUrl || undefined })
      const proc = await waitForProcess(id, 5 * 60 * 1000)
      if (proc.status !== 'succeeded') throw new Error(proc.error || proc.summary || 'Falha ao aplicar.')
      return proc
    },
    onSuccess: (proc) => {
      setEasyApplyStatus(proc.summary)
      qc.invalidateQueries({ queryKey: ['processes'] })
    },
    onError: (e) => setEasyApplyStatus((e as Error).message),
  })

  const toggleSelect = (url: string) => {
    setSelectedUrls((prev) => {
      const next = new Set(prev)
      if (next.has(url)) next.delete(url)
      else next.add(url)
      return next
    })
  }

  const formatDate = (v?: string) => {
    if (!v) return '-'
    const d = new Date(v)
    return isNaN(d.getTime()) ? '-' : d.toLocaleString('pt-BR')
  }

  return (
    <>
      <div className="page-header">
        <div>
          <h1>Vagas</h1>
          <p className="page-header-lead">Busca, seleção e candidatura em vagas LinkedIn</p>
        </div>
      </div>

      <div className="grid" style={{ marginBottom: 14 }}>
        <div className="card">
          <h2>Buscar Vagas</h2>
          <form className="stack" onSubmit={(e) => { e.preventDefault(); searchMutation.mutate() }}>
            <div>
              <label>Tag / Cargo</label>
              <input value={tag} onChange={(e) => setTag(e.target.value)} placeholder="ex: frontend react" required />
            </div>
            <div className="row">
              <div>
                <label>Localização</label>
                <input value={location} onChange={(e) => setLocation(e.target.value)} placeholder="Brasil, São Paulo…" />
              </div>
              <div>
                <label>Máx. resultados</label>
                <input type="number" value={maxResults} onChange={(e) => setMaxResults(e.target.value)} placeholder="25" />
              </div>
            </div>
            <div className="row">
              <div>
                <label>Máx. páginas</label>
                <input type="number" value={maxPages} onChange={(e) => setMaxPages(e.target.value)} placeholder="5" />
              </div>
              <div>
                <label>Máx. candidatos</label>
                <input type="number" value={maxApplicants} onChange={(e) => setMaxApplicants(e.target.value)} placeholder="sem limite" />
              </div>
            </div>
            <div style={{ display: 'flex', gap: 16 }}>
              <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontWeight: 500 }}>
                <input type="checkbox" checked={easyApplyOnly} onChange={(e) => setEasyApplyOnly(e.target.checked)} style={{ width: 'auto' }} />
                Somente Easy Apply
              </label>
              <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontWeight: 500 }}>
                <input type="checkbox" checked={onlyNonPromoted} onChange={(e) => setOnlyNonPromoted(e.target.checked)} style={{ width: 'auto' }} />
                Excluir vagas patrocinadas
              </label>
            </div>
            <div>
              <label>Pausa entre candidaturas (ms, padrão 1500 ≈ 1,5s)</label>
              <input type="number" value={waitMs} onChange={(e) => setWaitMs(e.target.value)} />
            </div>
            <button type="submit" disabled={searchMutation.isPending}>
              {searchMutation.isPending ? 'Buscando…' : 'Buscar vagas'}
            </button>
            {searchMutation.isError && (
              <p className="status danger">{(searchMutation.error as Error).message}</p>
            )}
          </form>
        </div>

        <div className="card">
          <h2>Aplicar em Vaga Específica</h2>
          <form className="stack" onSubmit={(e) => { e.preventDefault(); easyApplyMutation.mutate(easyApplyUrl) }}>
            <p className="helper">Cole a URL de uma vaga no LinkedIn para iniciar o Easy Apply diretamente.</p>
            <div>
              <label>URL da vaga LinkedIn</label>
              <input value={easyApplyUrl} onChange={(e) => setEasyApplyUrl(e.target.value)} placeholder="https://www.linkedin.com/jobs/view/..." />
            </div>
            <button type="submit" className="secondary" disabled={easyApplyMutation.isPending}>
              {easyApplyMutation.isPending ? 'Aplicando…' : 'Iniciar Easy Apply'}
            </button>
            {easyApplyStatus && (
              <p className={`status ${easyApplyMutation.isError ? 'danger' : 'ok'}`}>{easyApplyStatus}</p>
            )}
          </form>

          <div style={{ marginTop: 20 }}>
            <h2>Varredura de Vagas Aplicadas</h2>
            <div className="stack">
              <p className="helper">Escaneia as candidaturas mais recentes enviadas no LinkedIn.</p>
              <button className="secondary" disabled={scanMutation.isPending} onClick={() => scanMutation.mutate()}>
                {scanMutation.isPending ? 'Varrendo…' : 'Iniciar varredura'}
              </button>
              {scanStatus && (
                <p className={`status ${scanMutation.isError ? 'danger' : 'ok'}`}>{scanStatus}</p>
              )}
            </div>
          </div>
        </div>
      </div>

      {showFlowHint && (
        <div className="flow-hint">
          Vagas carregadas. Selecione as desejadas na tabela abaixo e clique em <strong>Aplicar selecionadas</strong>.
        </div>
      )}

      {jobs.length > 0 && (
        <div className="card" style={{ marginBottom: 14 }}>
          <div className="toolbar" style={{ marginBottom: 10 }}>
            <div>
              <h2 style={{ margin: 0 }}>Vagas Encontradas</h2>
              <div className="meta">{jobs.length} vaga(s) · {selectedUrls.size} selecionada(s)</div>
            </div>
            <button
              style={{ width: 'auto', padding: '8px 14px' }}
              disabled={selectedUrls.size === 0 || applyMutation.isPending}
              onClick={() => {
                if (!confirm(`Aplicar em ${selectedUrls.size} vaga(s) selecionada(s)?`)) return
                applyMutation.mutate()
              }}
            >
              {applyMutation.isPending ? 'Aplicando…' : `Aplicar selecionadas (${selectedUrls.size})`}
            </button>
          </div>
          {applyStatus && (
            <p className={`status ${applyMutation.isError ? 'danger' : 'ok'}`} style={{ marginBottom: 8 }}>{applyStatus}</p>
          )}
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th style={{ width: 32 }}></th>
                  <th>Cargo</th>
                  <th>Empresa</th>
                  <th>Local</th>
                  <th>Easy Apply</th>
                  <th>Link</th>
                </tr>
              </thead>
              <tbody>
                {jobs.map((job) => (
                  <tr key={job.url}>
                    <td>
                      <input
                        type="checkbox"
                        style={{ width: 'auto' }}
                        checked={selectedUrls.has(job.url)}
                        onChange={() => toggleSelect(job.url)}
                        disabled={!job.easyApply}
                      />
                    </td>
                    <td>{job.title ?? '-'}</td>
                    <td>{job.company ?? '-'}</td>
                    <td>{job.location ?? '-'}</td>
                    <td>{job.easyApply ? <span className="badge badge-ok">sim</span> : <span className="badge badge-muted">não</span>}</td>
                    <td><a href={job.url} target="_blank" rel="noreferrer">Abrir</a></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {appliedJobs.length > 0 && (
        <div className="card">
          <h2>Vagas Aplicadas</h2>
          <div className="table-wrap" style={{ maxHeight: 220, marginTop: 10 }}>
            <table>
              <thead>
                <tr><th>#</th><th>Vaga</th><th>Empresa</th><th>Local</th><th>Aplicada</th><th>Link</th></tr>
              </thead>
              <tbody>
                {appliedJobs.map((j, i) => (
                  <tr key={i}>
                    <td className="meta">{i + 1}</td>
                    <td>{j.title ?? '-'}</td>
                    <td>{j.company ?? '-'}</td>
                    <td>{j.location ?? '-'}</td>
                    <td><span className="meta">{formatDate(j.appliedAt)}</span></td>
                    <td>{j.url ? <a href={j.url} target="_blank" rel="noreferrer">Abrir</a> : '-'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </>
  )
}
