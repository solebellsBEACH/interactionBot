import { Link, useLocation } from "react-router-dom";
import "./Layout.css";

const NAV_LINKS = [
  { to: "/admin", label: "Início", exact: true },
  { to: "/admin/dashboard", label: "Dashboard" },
  { to: "/admin/jobs", label: "Vagas" },
  { to: "/admin/profile", label: "Perfil" },
  { to: "/admin/gpt", label: "Respostas GPT" },
  { to: "/admin/settings", label: "Configurações" },
];

export function Sidebar() {
  const { pathname } = useLocation();

  return (
    <aside className="sidebar">
      <div className="sidebar-brand">InteractionBot</div>
      <nav className="sidebar-nav">
        {NAV_LINKS.map(({ to, label, exact }) => {
          const active = exact ? pathname === to : pathname.startsWith(to) && to !== "/admin";
          return (
            <Link key={to} to={to} className={`sidebar-link${active ? " active" : ""}`}>
              {label}
            </Link>
          );
        })}
      </nav>
    </aside>
  );
}

export function Layout({ children }: { children: React.ReactNode }) {
  return (
    <div className="layout">
      <Sidebar />
      <main className="main-content">{children}</main>
    </div>
  );
}
