'use client'

import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { useSSE } from '@/hooks/useSSE'
import { api } from '@/lib/api'

type ProcessRecord = {
  id: string
  type: string
  status: string
  startedAt: string
  endedAt?: string
  summary: string
  error?: string
}

type StepEntry = { id: string; label: string; status: string; source: string; createdAt: string }
type LogEntry = { id: string; level: string; message: string; createdAt: string; scope?: string }
type PromptItem = {
  id: string
  type: string
  fieldLabel?: string
  fieldKey?: string
  gptAnswer?: string
  question?: string
}
type SSEPayload = {
  runtime: { activeStep: StepEntry | null; steps: StepEntry[]; logs: LogEntry[] }
  prompt: { item: PromptItem | null; settings: { autoConfirmGpt: boolean; autoConfirmDelayMs: number } }
}

export default function DashboardPage() {
  const { data: sseData } = useSSE<SSEPayload>('/api/admin/stream')
  const { data: processState, refetch } = useQuery({
    queryKey: ['processes'],
    queryFn: () => api.get<{ running: ProcessRecord | null; history: ProcessRecord[] }>('/api/admin/processes'),
    refetchInterval: 5000,
  })

  const [manualValue, setManualValue] = useState('')
  const [promptStatus, setPromptStatus] = useState('')

  const prompt = sseData?.prompt.item ?? null
  const runtime = sseData?.runtime

  const respond = async (action: string, value?: string) => {
    if (!prompt) return
    try {
      await api.post('/api/admin/prompts/respond', { id: prompt.id, action, value })
      setPromptStatus('Resposta enviada.')
    } catch (e) {
      setPromptStatus((e as Error).message)
    }
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
          <h1>Dashboard</h1>
          <p className="page-header-lead">Processos, logs e prompts em tempo real</p>
        </div>
        <button style={{ width: 'auto', padding: '8px 14px' }} onClick={() => refetch()}>
          Atualizar
        </button>
      </div>

      {prompt && (
        <div style={{ marginBottom: 14, background: '#fff8ee', border: '1px solid #e0c07a', borderRadius: 8, padding: 18 }}>
          <h2 style={{ marginBottom: 8 }}>
            {prompt.type === 'confirm-gpt' ? 'GPT sugeriu uma resposta' : 'Bot precisa da sua resposta'}
          </h2>
          {prompt.fieldLabel && <p className="helper">Campo: <strong>{prompt.fieldLabel}</strong></p>}
          {prompt.gptAnswer && (
            <p style={{ marginTop: 8 }}>
              Sugestão: <em>{prompt.gptAnswer}</em>
            </p>
          )}
          {prompt.type === 'answer-field' && (
            <div style={{ marginTop: 10 }}>
              <label>Sua resposta</label>
              <input value={manualValue} onChange={(e) => setManualValue(e.target.value)} />
            </div>
          )}
          <div className="row" style={{ marginTop: 12, gap: 8 }}>
            {prompt.type === 'confirm-gpt' && (
              <button onClick={() => respond('confirm')}>✓ Aceitar sugestão do GPT</button>
            )}
            <button className="secondary" onClick={() => respond('manual', manualValue)}>✎ Usar outra resposta</button>
            <button style={{ background: '#9e8f7a' }} onClick={() => respond('skip')}>⏭ Pular opção/campo</button>
          </div>
          {promptStatus && <p className="status ok" style={{ marginTop: 8 }}>{promptStatus}</p>}
        </div>
      )}

      <div className="grid" style={{ marginBottom: 14 }}>
        <div className="card">
          <h2>Processo Ativo</h2>
          {processState?.running ? (
            <div className="info-row">
              <span className="info-label">Tipo</span>
              <span className="info-value">{processState.running.type}</span>
            </div>
          ) : (
            <p className="muted" style={{ marginTop: 8, fontSize: '0.88rem' }}>Nenhum processo em execução.</p>
          )}
          {runtime?.activeStep && (
            <div style={{ marginTop: 10 }}>
              <span className="badge badge-muted">{runtime.activeStep.label}</span>
            </div>
          )}
        </div>

        <div className="card">
          <h2>Histórico</h2>
          {(processState?.history ?? []).slice(0, 5).map((p) => (
            <div className="info-row" key={p.id}>
              <span className="info-label" style={{ minWidth: 100 }}>{p.type}</span>
              <span className="info-value">
                <span className={p.status === 'failed' ? 'danger' : 'ok'}>{p.status}</span>
                {' · '}{formatDate(p.endedAt)}
              </span>
            </div>
          ))}
        </div>
      </div>

      <div className="card" style={{ marginBottom: 14 }}>
        <h2>Etapas de Execução</h2>
        <div className="table-wrap" style={{ maxHeight: 240, overflow: 'auto', marginTop: 10 }}>
          <table>
            <thead>
              <tr><th>Hora</th><th>Fonte</th><th>Label</th><th>Status</th></tr>
            </thead>
            <tbody>
              {(runtime?.steps ?? []).map((s) => (
                <tr key={s.id}>
                  <td><span className="meta">{formatDate(s.createdAt)}</span></td>
                  <td>{s.source}</td>
                  <td>{s.label}</td>
                  <td><span className={`badge ${s.status === 'error' ? 'badge-danger' : s.status === 'done' ? 'badge-ok' : 'badge-muted'}`}>{s.status}</span></td>
                </tr>
              ))}
              {!runtime?.steps.length && <tr><td colSpan={4} className="muted">Sem etapas.</td></tr>}
            </tbody>
          </table>
        </div>
      </div>

      <div className="card">
        <h2>Logs</h2>
        <div className="table-wrap" style={{ maxHeight: 340, overflow: 'auto', marginTop: 10 }}>
          <table>
            <thead>
              <tr><th>Hora</th><th>Nível</th><th>Escopo</th><th>Mensagem</th></tr>
            </thead>
            <tbody>
              {(runtime?.logs ?? []).map((l) => (
                <tr key={l.id}>
                  <td><span className="meta">{formatDate(l.createdAt)}</span></td>
                  <td><span className={`badge ${l.level === 'error' ? 'badge-danger' : l.level === 'warn' ? 'badge-muted' : 'badge-ok'}`}>{l.level}</span></td>
                  <td className="meta">{l.scope ?? ''}</td>
                  <td style={{ wordBreak: 'break-word', maxWidth: 400 }}>{l.message}</td>
                </tr>
              ))}
              {!runtime?.logs.length && <tr><td colSpan={4} className="muted">Sem logs.</td></tr>}
            </tbody>
          </table>
        </div>
      </div>
    </>
  )
}
