'use client'

import { useEffect, useMemo, useState } from 'react'

type Stage = 'idle' | 'running' | 'success' | 'error'

type BotJob = {
  id: string
  status: Stage
  startedAt: string
  endedAt?: string
  output: string[]
  error?: string
}

type ActionOption = {
  value: string
  label: string
  description: string
}

const actionOptions: ActionOption[] = [
  {
    value: 'easy-apply',
    label: 'Easy Apply',
    description: 'Abre o job e preenche o formulário automaticamente.'
  },
  {
    value: 'search-jobs',
    label: 'Buscar Jobs',
    description: 'Pesquisa vagas por tag e lista resultados.'
  },
  {
    value: 'catch-jobs',
    label: 'Capturar Jobs',
    description: 'Varre vagas e inicia o Easy Apply automaticamente.'
  },
  {
    value: 'connect',
    label: 'Conectar',
    description: 'Envia convite para um perfil específico.'
  },
  {
    value: 'upvote',
    label: 'Upvote Posts',
    description: 'Curte posts no feed com filtros simples.'
  },
  {
    value: 'profile',
    label: 'Perfil',
    description: 'Scrape de perfil (modo leitura).'
  }
]

export default function Home() {
  const [action, setAction] = useState(actionOptions[0].value)
  const [jobUrl, setJobUrl] = useState('')
  const [tag, setTag] = useState('')
  const [profileUrl, setProfileUrl] = useState('')
  const [message, setMessage] = useState('')
  const [maxResults, setMaxResults] = useState('')
  const [maxLikes, setMaxLikes] = useState('')
  const [headless, setHeadless] = useState(false)

  const [stage, setStage] = useState<Stage>('idle')
  const [statusText, setStatusText] = useState('Aguardando comando')
  const [jobId, setJobId] = useState<string | null>(null)
  const [log, setLog] = useState('')

  const selectedAction = useMemo(
    () => actionOptions.find((option) => option.value === action),
    [action]
  )

  const needsJobUrl = action === 'easy-apply'
  const needsTag = action === 'search-jobs' || action === 'catch-jobs' || action === 'upvote'
  const needsMaxResults = action === 'search-jobs' || action === 'catch-jobs'
  const needsProfileUrl = action === 'connect'
  const needsMessage = action === 'connect'
  const needsMaxLikes = action === 'upvote'

  useEffect(() => {
    if (!jobId) return

    let active = true
    let timer: ReturnType<typeof setTimeout> | null = null
    let delay = 2000

    const poll = async () => {
      try {
        const response = await fetch(`/api/bot/status?id=${jobId}`)
        const data = await response.json()
        if (!active) return
        if (!response.ok) {
          setStage('error')
          setStatusText(data?.error || 'Falha ao consultar status')
          return
        }

        const job: BotJob = data.job
        setLog(job.output.join(''))
        setStage(job.status)
        if (job.status === 'running') {
          setStatusText('Bot em execução...')
          delay = Math.min(delay + 500, 5000)
          if (active) {
            timer = setTimeout(poll, delay)
          }
        } else if (job.status === 'success') {
          setStatusText('Execução concluída')
        } else {
          setStatusText(job.error || 'Execução falhou')
        }
      } catch (error) {
        if (!active) return
        setStage('error')
        setStatusText('Erro de rede ao consultar status')
      }
    }

    poll()

    return () => {
      active = false
      if (timer) clearTimeout(timer)
    }
  }, [jobId])

  const handleSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    setStage('running')
    setStatusText('Iniciando bot...')
    setLog('')
    setJobId(null)

    if ((action === 'search-jobs' || action === 'catch-jobs') && !tag.trim()) {
      setStage('error')
      setStatusText('Informe uma tag para buscar vagas.')
      return
    }

    if (action === 'connect' && !profileUrl.trim()) {
      setStage('error')
      setStatusText('Informe o link do perfil para conectar.')
      return
    }

    const payload = {
      jobUrl: jobUrl.trim() || undefined,
      tag: tag.trim() || undefined,
      profileUrl: profileUrl.trim() || undefined,
      message: message.trim() || undefined,
      maxResults: maxResults ? Number(maxResults) : undefined,
      maxLikes: maxLikes ? Number(maxLikes) : undefined,
      headless
    }

    try {
      const response = await fetch('/api/bot/run', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ action, payload })
      })
      const data = await response.json()
      if (!response.ok) {
        setStage('error')
        setStatusText(data?.error || 'Falha ao iniciar o bot')
        return
      }

      setJobId(data.jobId)
      setStage('running')
      setStatusText('Bot em execução...')
    } catch (error) {
      setStage('error')
      setStatusText('Falha na conexão com o servidor')
    }
  }

  const reset = () => {
    setStage('idle')
    setStatusText('Aguardando comando')
    setLog('')
    setJobId(null)
  }

  return (
    <div className="page">
      <div className="bg-orb one" />
      <div className="bg-orb two" />

      <header className="hero">
        <div>
          <div className="eyebrow">Painel Operacional</div>
          <h1>Interaction Bot</h1>
          <p>
            Centralize as rotinas do LinkedIn em um painel que dispara fluxos do bot,
            acompanha logs e mantém a execução sob controle.
          </p>
        </div>
        <div className="hero-card">
          <h3>Fluxo Atual</h3>
          <ul>
            <li>
              <span>Ação</span>
              <strong>{selectedAction?.label || 'N/A'}</strong>
            </li>
            <li>
              <span>Status</span>
              <strong>{statusText}</strong>
            </li>
            <li>
              <span>Headless</span>
              <strong>{headless ? 'Sim' : 'Não'}</strong>
            </li>
          </ul>
        </div>
      </header>

      <section className="panel">
        <h2>Acionar Bot</h2>
        <p>{selectedAction?.description}</p>
        <form onSubmit={handleSubmit}>
          <div className="form-grid">
            <div className="field">
              <label htmlFor="action">Ação</label>
              <select
                id="action"
                value={action}
                onChange={(event) => setAction(event.target.value)}
              >
                {actionOptions.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
            </div>

            {needsJobUrl ? (
              <div className="field">
                <label htmlFor="jobUrl">Job URL</label>
                <input
                  id="jobUrl"
                  value={jobUrl}
                  onChange={(event) => setJobUrl(event.target.value)}
                  placeholder="https://www.linkedin.com/jobs/view/..."
                />
              </div>
            ) : null}

            {needsTag ? (
              <div className="field">
                <label htmlFor="tag">Tag de busca</label>
                <input
                  id="tag"
                  value={tag}
                  onChange={(event) => setTag(event.target.value)}
                  placeholder="frontend, product, growth"
                />
              </div>
            ) : null}

            {needsMaxResults ? (
              <div className="field">
                <label htmlFor="maxResults">Max resultados</label>
                <input
                  id="maxResults"
                  value={maxResults}
                  onChange={(event) => setMaxResults(event.target.value)}
                  placeholder="Ex: 20"
                />
              </div>
            ) : null}

            {needsProfileUrl ? (
              <div className="field">
                <label htmlFor="profileUrl">Perfil LinkedIn</label>
                <input
                  id="profileUrl"
                  value={profileUrl}
                  onChange={(event) => setProfileUrl(event.target.value)}
                  placeholder="https://www.linkedin.com/in/usuario"
                />
              </div>
            ) : null}

            {needsMessage ? (
              <div className="field">
                <label htmlFor="message">Mensagem</label>
                <textarea
                  id="message"
                  value={message}
                  onChange={(event) => setMessage(event.target.value)}
                  placeholder="Mensagem opcional para convite"
                />
              </div>
            ) : null}

            {needsMaxLikes ? (
              <div className="field">
                <label htmlFor="maxLikes">Max likes</label>
                <input
                  id="maxLikes"
                  value={maxLikes}
                  onChange={(event) => setMaxLikes(event.target.value)}
                  placeholder="Ex: 15"
                />
              </div>
            ) : null}

            <div className="field">
              <label htmlFor="headless">Headless</label>
              <select
                id="headless"
                value={headless ? 'yes' : 'no'}
                onChange={(event) => setHeadless(event.target.value === 'yes')}
              >
                <option value="no">Não</option>
                <option value="yes">Sim</option>
              </select>
            </div>
          </div>

          <div className="actions">
            <button className="primary" type="submit">
              Executar
            </button>
            <button className="ghost" type="button" onClick={reset}>
              Limpar
            </button>
          </div>
        </form>
      </section>

      <section className="panel">
        <h2>Execução</h2>
        <div className="status-row">
          <span className={`badge ${stage}`}>{stage}</span>
          <span>{statusText}</span>
          {jobId ? <span>Job ID: {jobId}</span> : null}
        </div>
        <div className="log">{log || 'Logs aparecerão aqui assim que o bot iniciar.'}</div>
      </section>
    </div>
  )
}
