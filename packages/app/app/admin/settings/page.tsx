'use client'

import { useState } from 'react'
import { useQuery, useMutation } from '@tanstack/react-query'
import { api } from '@/lib/api'

type ConfigData = { apiBaseUrl: string; tenantId: string | null; workspaceId: string | null; remoteAdminState: boolean }
type ProcessRecord = { id: string; type?: string; status: string; summary: string; error?: string; endedAt?: string }

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

export default function SettingsPage() {
  const { data: configData, refetch: refetchConfig } = useQuery({
    queryKey: ['config'],
    queryFn: () => api.get<ConfigData>('/api/admin/config'),
  })

  const { data: processState, refetch: refetchProcesses } = useQuery({
    queryKey: ['processes'],
    queryFn: () => api.get<{ running: ProcessRecord | null; history: ProcessRecord[] }>('/api/admin/processes'),
    refetchInterval: 10000,
  })

  const [connectUrl, setConnectUrl] = useState('')
  const [connectMsg, setConnectMsg] = useState('')
  const [connectStatus, setConnectStatus] = useState('')
  const [upvoteTag, setUpvoteTag] = useState('')
  const [upvoteMax, setUpvoteMax] = useState('')
  const [upvoteStatus, setUpvoteStatus] = useState('')
  const [resetStatus, setResetStatus] = useState('')

  const connectMutation = useMutation({
    mutationFn: async () => {
      const { id } = await api.post<{ id: string }>('/api/admin/processes/connect', {
        profileUrl: connectUrl,
        message: connectMsg || undefined,
      })
      const proc = await waitForProcess(id, 5 * 60 * 1000)
      if (proc.status !== 'succeeded') throw new Error(proc.error || proc.summary || 'Falha ao conectar.')
      return proc
    },
    onSuccess: (proc) => {
      setConnectStatus(proc.summary)
      setConnectUrl('')
      setConnectMsg('')
      refetchProcesses()
    },
    onError: (e) => setConnectStatus((e as Error).message),
  })

  const upvoteMutation = useMutation({
    mutationFn: async () => {
      const { id } = await api.post<{ id: string }>('/api/admin/processes/upvote-posts', {
        tag: upvoteTag,
        maxLikes: upvoteMax ? Number(upvoteMax) : undefined,
      })
      const proc = await waitForProcess(id, 10 * 60 * 1000)
      if (proc.status !== 'succeeded') throw new Error(proc.error || proc.summary || 'Falha no upvote.')
      return proc
    },
    onSuccess: (proc) => {
      setUpvoteStatus(proc.summary)
      setUpvoteTag('')
      setUpvoteMax('')
      refetchProcesses()
    },
    onError: (e) => setUpvoteStatus((e as Error).message),
  })

  const resetMutation = useMutation({
    mutationFn: async () => {
      if (!confirm('Isso vai deslogar do LinkedIn e remover todos os dados locais. Continuar?')) {
        throw new Error('Cancelado.')
      }
      const { id } = await api.post<{ id: string }>('/api/admin/processes/reset-session', {})
      const proc = await waitForProcess(id, 2 * 60 * 1000)
      if (proc.status !== 'succeeded') throw new Error(proc.error || proc.summary || 'Falha ao limpar.')
      return proc
    },
    onSuccess: (proc) => {
      setResetStatus(proc.summary)
      refetchProcesses()
    },
    onError: (e) => {
      if ((e as Error).message !== 'Cancelado.') setResetStatus((e as Error).message)
    },
  })

  const formatDate = (v?: string) => {
    if (!v) return '-'
    const d = new Date(v)
    return isNaN(d.getTime()) ? '-' : d.toLocaleString('pt-BR')
  }

  return (
    <>
      <div className="page-header">
        <div>
          <h1>Configurações</h1>
          <p className="page-header-lead">Informações do ambiente e configurações da conta</p>
        </div>
        <button
          style={{ width: 'auto', padding: '8px 14px', background: 'linear-gradient(135deg,var(--brand-2),#dd8a2f)' }}
          onClick={() => { refetchConfig(); refetchProcesses() }}
        >
          Recarregar
        </button>
      </div>

      <div className="grid" style={{ marginBottom: 14 }}>
        <div className="card">
          <h2>Informações do Ambiente</h2>
          <p className="helper" style={{ margin: '0 0 10px' }}>Dados técnicos do servidor e control plane.</p>
          <div className="info-row"><span className="info-label">API Base URL</span><span className="info-value">{configData?.apiBaseUrl || '—'}</span></div>
          <div className="info-row"><span className="info-label">Tenant ID</span><span className="info-value">{configData?.tenantId || '—'}</span></div>
          <div className="info-row"><span className="info-label">Workspace ID</span><span className="info-value">{configData?.workspaceId || '—'}</span></div>
          <div className="info-row"><span className="info-label">Modo Control Plane</span><span className="info-value">{configData?.remoteAdminState ? 'Ativado' : 'Desativado'}</span></div>
        </div>

        <div className="card">
          <h2>Status dos Processos</h2>
          <div className="info-row">
            <span className="info-label">Processo ativo</span>
            <span className="info-value">
              {processState?.running
                ? `${processState.running.type} (${processState.running.id})`
                : 'Nenhum'}
            </span>
          </div>
          <div style={{ marginTop: 14 }}>
            <div style={{ fontSize: '0.75rem', textTransform: 'uppercase', letterSpacing: '0.08em', color: 'var(--muted)', fontWeight: 600, borderBottom: '1px solid var(--line)', paddingBottom: 6, marginBottom: 8 }}>
              Últimos processos
            </div>
            {(processState?.history ?? []).slice(0, 4).map((p) => (
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
      </div>

      <div className="grid" style={{ marginBottom: 14 }}>
        <div className="card">
          <h2>Enviar Convite de Conexão</h2>
          <form className="stack" onSubmit={(e) => { e.preventDefault(); connectMutation.mutate() }}>
            <p className="helper">Envia um pedido de conexão para outro usuário no LinkedIn, com mensagem opcional.</p>
            <div>
              <label>URL do perfil LinkedIn</label>
              <input value={connectUrl} onChange={(e) => setConnectUrl(e.target.value)} placeholder="https://www.linkedin.com/in/..." required />
            </div>
            <div>
              <label>Mensagem (opcional)</label>
              <textarea value={connectMsg} onChange={(e) => setConnectMsg(e.target.value)} placeholder="Olá! Gostaria de me conectar…" style={{ minHeight: 60 }} />
            </div>
            <button className="secondary" type="submit" disabled={connectMutation.isPending}>
              {connectMutation.isPending ? 'Enviando…' : 'Enviar convite'}
            </button>
            {connectStatus && (
              <p className={`status ${connectMutation.isError ? 'danger' : 'ok'}`}>{connectStatus}</p>
            )}
          </form>
        </div>

        <div className="card">
          <h2>Upvote em Posts</h2>
          <form className="stack" onSubmit={(e) => { e.preventDefault(); upvoteMutation.mutate() }}>
            <p className="helper">Busca posts por tag e curte automaticamente os mais relevantes.</p>
            <div className="row">
              <div>
                <label>Tag</label>
                <input value={upvoteTag} onChange={(e) => setUpvoteTag(e.target.value)} placeholder="javascript" required />
              </div>
              <div>
                <label>Máx. curtidas</label>
                <input type="number" value={upvoteMax} onChange={(e) => setUpvoteMax(e.target.value)} min={1} placeholder="10" />
              </div>
            </div>
            <button className="secondary" type="submit" disabled={upvoteMutation.isPending}>
              {upvoteMutation.isPending ? 'Iniciando…' : 'Iniciar upvote'}
            </button>
            {upvoteStatus && (
              <p className={`status ${upvoteMutation.isError ? 'danger' : 'ok'}`}>{upvoteStatus}</p>
            )}
          </form>
        </div>
      </div>

      <div className="card" style={{ marginBottom: 14, borderColor: 'rgba(165,35,35,0.25)' }}>
        <h2>Sessão e Dados Locais</h2>
        <div className="stack">
          <p className="helper">
            Desloga do LinkedIn e apaga todos os dados locais do bot — perfil, histórico de respostas GPT e logs.{' '}
            <strong>Esta ação é irreversível.</strong>
          </p>
          <button
            className="danger-button"
            style={{ maxWidth: 320 }}
            disabled={resetMutation.isPending}
            onClick={() => resetMutation.mutate()}
          >
            {resetMutation.isPending ? 'Limpando…' : 'Deslogar e limpar tudo'}
          </button>
          {resetStatus && (
            <p className={`status ${resetMutation.isError ? 'danger' : 'ok'}`}>{resetStatus}</p>
          )}
        </div>
      </div>
    </>
  )
}
