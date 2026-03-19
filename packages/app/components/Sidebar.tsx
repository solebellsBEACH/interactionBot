'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'

const NAV_LINKS = [
  { href: '/admin', label: 'Início', exact: true },
  { href: '/admin/dashboard', label: 'Dashboard' },
  { href: '/admin/jobs', label: 'Vagas' },
  { href: '/admin/profile', label: 'Perfil' },
  { href: '/admin/gpt', label: 'Respostas GPT' },
  { href: '/admin/settings', label: 'Configurações' },
]

export function Sidebar() {
  const pathname = usePathname()

  return (
    <aside className="sidebar">
      <div className="sidebar-brand">InteractionBot</div>
      <nav className="sidebar-nav">
        {NAV_LINKS.map(({ href, label, exact }) => {
          const active = exact ? pathname === href : pathname.startsWith(href) && href !== '/admin'
          return (
            <Link key={href} href={href} className={`sidebar-link${active ? ' active' : ''}`}>
              {label}
            </Link>
          )
        })}
      </nav>
    </aside>
  )
}
