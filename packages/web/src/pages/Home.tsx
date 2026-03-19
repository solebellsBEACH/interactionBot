import { Link } from "react-router-dom";
import { Layout } from "../components/Layout";

export function Home() {
  const links = [
    { to: "/admin/dashboard", label: "Dashboard", desc: "Processos, logs e prompts em tempo real" },
    { to: "/admin/jobs", label: "Vagas", desc: "Busca e candidatura em vagas LinkedIn" },
    { to: "/admin/profile", label: "Perfil", desc: "Dados pessoais e experiência mapeada" },
    { to: "/admin/gpt", label: "Respostas GPT", desc: "Histórico e configuração de confirmação automática" },
    { to: "/admin/settings", label: "Configurações", desc: "Ambiente, conexões e reset de sessão" },
  ];

  return (
    <Layout>
      <div className="page-header">
        <div>
          <h1>InteractionBot</h1>
          <p className="page-header-lead">Automação LinkedIn — painel de controle</p>
        </div>
      </div>

      <div className="grid" style={{ gridTemplateColumns: "repeat(auto-fill, minmax(220px, 1fr))" }}>
        {links.map(({ to, label, desc }) => (
          <Link key={to} to={to} style={{ textDecoration: "none" }}>
            <div className="card" style={{ cursor: "pointer", transition: "border-color 0.15s" }}>
              <h2 style={{ marginBottom: 6 }}>{label}</h2>
              <p className="helper" style={{ margin: 0 }}>{desc}</p>
            </div>
          </Link>
        ))}
      </div>
    </Layout>
  );
}
