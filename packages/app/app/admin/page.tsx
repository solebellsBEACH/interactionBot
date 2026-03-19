import Link from 'next/link'

const links = [
  { href: '/admin/dashboard', label: 'Dashboard', desc: 'Processos, logs e prompts em tempo real' },
  { href: '/admin/jobs', label: 'Vagas', desc: 'Busca e candidatura em vagas LinkedIn' },
  { href: '/admin/profile', label: 'Perfil', desc: 'Dados pessoais e experiência mapeada' },
  { href: '/admin/gpt', label: 'Respostas GPT', desc: 'Histórico e configuração de confirmação automática' },
  { href: '/admin/settings', label: 'Configurações', desc: 'Ambiente, conexões e reset de sessão' },
]

export default function HomePage() {
  return (
    <>
      <div className="page-header">
        <div>
          <h1>InteractionBot</h1>
          <p className="page-header-lead">Automação LinkedIn — painel de controle</p>
        </div>
      </div>

      <div className="grid" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))' }}>
        {links.map(({ href, label, desc }) => (
          <Link key={href} href={href} style={{ textDecoration: 'none' }}>
            <div className="card" style={{ cursor: 'pointer', transition: 'border-color 0.15s' }}>
              <h2 style={{ marginBottom: 6 }}>{label}</h2>
              <p className="helper" style={{ margin: 0 }}>{desc}</p>
            </div>
          </Link>
        ))}
      </div>
    </>
  )
}
