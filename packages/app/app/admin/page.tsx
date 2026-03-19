'use client'

import Link from 'next/link'
import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { api } from '@/lib/api'

// ── Types ────────────────────────────────────────────────────────────────────

type AppliedJob = {
  url: string
  title?: string
  company?: string
  location?: string
  appliedAt?: string
  source: string
  tag?: string
}

type Summary = {
  totalApplied: number
  thisWeek: number
  topCompany: string | null
  topKeyword: string | null
  timeSeries: { date: string; count: number }[]
  topCompanies: { company: string; count: number }[]
  topKeywords: { keyword: string; count: number }[]
  recentJobs: AppliedJob[]
}

// ── Chart components ──────────────────────────────────────────────────────────

function TimeSeriesChart({ data }: { data: { date: string; count: number }[] }) {
  if (!data.length) return <p className="muted" style={{ textAlign: 'center', padding: '24px 0' }}>Sem dados.</p>

  // Fill last 30 days
  const filled: { date: string; count: number }[] = []
  const today = new Date()
  const map = new Map(data.map((d) => [d.date, d.count]))
  for (let i = 29; i >= 0; i--) {
    const d = new Date(today)
    d.setDate(d.getDate() - i)
    const key = d.toISOString().slice(0, 10)
    filled.push({ date: key, count: map.get(key) ?? 0 })
  }

  const max = Math.max(...filled.map((d) => d.count), 1)

  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'flex-end', gap: 2, height: 80, marginBottom: 4 }}>
        {filled.map((d) => (
          <div
            key={d.date}
            title={`${d.date}: ${d.count} candidatura(s)`}
            style={{
              flex: 1,
              height: `${(d.count / max) * 100}%`,
              background: 'var(--brand)',
              borderRadius: '2px 2px 0 0',
              minHeight: d.count ? 3 : 0,
              opacity: d.count ? 1 : 0.15,
            }}
          />
        ))}
      </div>
      <div style={{ display: 'flex', justifyContent: 'space-between' }}>
        <span className="meta">{filled[0]?.date}</span>
        <span className="meta">{filled[29]?.date}</span>
      </div>
    </div>
  )
}

function HBarChart({ data, color }: { data: { label: string; count: number }[]; color: string }) {
  if (!data.length) return <p className="muted" style={{ padding: '8px 0' }}>Sem dados.</p>
  const max = Math.max(...data.map((d) => d.count), 1)
  return (
    <div className="stack" style={{ gap: 8 }}>
      {data.map((d) => (
        <div key={d.label}>
          <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.82rem', marginBottom: 3 }}>
            <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: '70%' }}>{d.label}</span>
            <span className="meta">{d.count}</span>
          </div>
          <div style={{ background: 'var(--line)', borderRadius: 3, height: 6, overflow: 'hidden' }}>
            <div style={{ width: `${(d.count / max) * 100}%`, height: '100%', background: color, borderRadius: 3, transition: 'width 0.4s' }} />
          </div>
        </div>
      ))}
    </div>
  )
}

// ── Stat card ─────────────────────────────────────────────────────────────────

function StatCard({ label, value, sub }: { label: string; value: string | number; sub?: string }) {
  return (
    <div className="card" style={{ textAlign: 'center' }}>
      <div style={{ fontSize: '2rem', fontWeight: 700, color: 'var(--brand)', lineHeight: 1.1 }}>{value}</div>
      <div style={{ fontWeight: 600, fontSize: '0.88rem', marginTop: 6 }}>{label}</div>
      {sub && <div className="meta" style={{ marginTop: 2 }}>{sub}</div>}
    </div>
  )
}

// ── Page ──────────────────────────────────────────────────────────────────────

const NAV_LINKS = [
  { href: '/admin/dashboard', label: 'Dashboard', desc: 'Processos, logs e prompts em tempo real' },
  { href: '/admin/jobs', label: 'Vagas', desc: 'Busca e candidatura em vagas LinkedIn' },
  { href: '/admin/profile', label: 'Perfil', desc: 'Dados pessoais e experiência mapeada' },
  { href: '/admin/gpt', label: 'Respostas GPT', desc: 'Histórico e confirmação automática' },
  { href: '/admin/settings', label: 'Configurações', desc: 'Ambiente, conexões e reset de sessão' },
]

export default function HomePage() {
  const { data: summary, isLoading } = useQuery({
    queryKey: ['analytics-summary'],
    queryFn: () => api.get<Summary>('/api/admin/analytics/summary'),
    refetchInterval: 30_000,
  })

  const [companyFilter, setCompanyFilter] = useState('')
  const [dateOrder, setDateOrder] = useState<'desc' | 'asc'>('desc')

  const { data: jobsData } = useQuery({
    queryKey: ['analytics-jobs', companyFilter, dateOrder],
    queryFn: () =>
      api.get<{ jobs: AppliedJob[] }>(
        `/api/admin/analytics/applied-jobs?limit=100&order=${dateOrder}${companyFilter ? `&company=${encodeURIComponent(companyFilter)}` : ''}`
      ),
    refetchInterval: 30_000,
  })

  const formatDate = (v?: string) => {
    if (!v) return '-'
    const d = new Date(v)
    return isNaN(d.getTime()) ? '-' : d.toLocaleDateString('pt-BR')
  }

  const allJobs = jobsData?.jobs ?? []

  return (
    <>
      {/* Header */}
      <div className="page-header">
        <div>
          <h1>InteractionBot</h1>
          <p className="page-header-lead">Painel de controle e analytics de candidaturas</p>
        </div>
      </div>

      {/* Quick nav */}
      <div className="grid" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(180px, 1fr))', marginBottom: 20 }}>
        {NAV_LINKS.map(({ href, label, desc }) => (
          <Link key={href} href={href} style={{ textDecoration: 'none' }}>
            <div className="card" style={{ cursor: 'pointer' }}>
              <h2 style={{ marginBottom: 4, fontSize: '0.95rem' }}>{label}</h2>
              <p className="helper" style={{ margin: 0, fontSize: '0.8rem' }}>{desc}</p>
            </div>
          </Link>
        ))}
      </div>

      {/* Stat cards */}
      <div className="grid" style={{ gridTemplateColumns: 'repeat(4, 1fr)', marginBottom: 14 }}>
        <StatCard label="Total aplicadas" value={isLoading ? '…' : summary?.totalApplied ?? 0} />
        <StatCard label="Esta semana" value={isLoading ? '…' : summary?.thisWeek ?? 0} />
        <StatCard label="Top empresa" value={isLoading ? '…' : (summary?.topCompany ?? '—')} sub="mais candidaturas" />
        <StatCard label="Top keyword" value={isLoading ? '…' : (summary?.topKeyword ?? '—')} sub="mais buscada" />
      </div>

      {/* Charts row */}
      <div className="grid" style={{ gridTemplateColumns: '2fr 1fr 1fr', marginBottom: 14 }}>
        <div className="card">
          <h2 style={{ marginBottom: 12 }}>Candidaturas — últimos 30 dias</h2>
          <TimeSeriesChart data={summary?.timeSeries ?? []} />
        </div>

        <div className="card">
          <h2 style={{ marginBottom: 12 }}>Top Empresas</h2>
          <HBarChart
            data={(summary?.topCompanies ?? []).map((c) => ({ label: c.company, count: c.count }))}
            color="var(--brand)"
          />
        </div>

        <div className="card">
          <h2 style={{ marginBottom: 12 }}>Top Keywords</h2>
          <HBarChart
            data={(summary?.topKeywords ?? []).map((k) => ({ label: k.keyword, count: k.count }))}
            color="var(--brand-2)"
          />
        </div>
      </div>

      {/* Applied jobs table */}
      <div className="card">
        <div className="toolbar" style={{ marginBottom: 10 }}>
          <div>
            <h2 style={{ margin: 0 }}>Vagas Aplicadas</h2>
            <div className="meta">{allJobs.length} registro(s){companyFilter ? ' (filtrado)' : ''}</div>
          </div>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
            <input
              type="search"
              placeholder="Filtrar por empresa…"
              style={{ width: 200 }}
              value={companyFilter}
              onChange={(e) => setCompanyFilter(e.target.value)}
            />
            <button
              style={{ width: 'auto', padding: '8px 12px', background: 'transparent', border: '1px solid var(--line)', color: 'var(--ink)', fontWeight: 500 }}
              onClick={() => setDateOrder((o) => (o === 'desc' ? 'asc' : 'desc'))}
              title="Ordenar por data"
            >
              Data {dateOrder === 'desc' ? '↓' : '↑'}
            </button>
          </div>
        </div>

        <div className="table-wrap" style={{ maxHeight: 380 }}>
          <table>
            <thead>
              <tr>
                <th>#</th>
                <th>Cargo</th>
                <th>Empresa</th>
                <th>Local</th>
                <th>Keyword</th>
                <th>Fonte</th>
                <th>Data</th>
                <th>Link</th>
              </tr>
            </thead>
            <tbody>
              {allJobs.map((j, i) => (
                <tr key={j.url ?? i}>
                  <td className="meta">{i + 1}</td>
                  <td>{j.title ?? '-'}</td>
                  <td>{j.company ?? '-'}</td>
                  <td>{j.location ?? '-'}</td>
                  <td><span className="meta">{j.tag ?? '-'}</span></td>
                  <td><span className="badge badge-muted">{j.source}</span></td>
                  <td><span className="meta">{formatDate(j.appliedAt)}</span></td>
                  <td>{j.url ? <a href={j.url} target="_blank" rel="noreferrer">Abrir</a> : '-'}</td>
                </tr>
              ))}
              {!allJobs.length && !isLoading && (
                <tr>
                  <td colSpan={8} className="muted">
                    {summary?.totalApplied === 0
                      ? 'Nenhuma candidatura registrada ainda. Execute uma busca ou varredura para popular os dados.'
                      : 'Nenhum resultado para o filtro.'}
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </>
  )
}
