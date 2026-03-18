(() => {
  const NAV_ITEMS = [
    { href: "/admin", label: "Home", icon: "⌂", id: "" },
    { href: "/admin/dashboard", label: "Dashboard", icon: "◈", id: "dashboard" },
    { href: "/admin/jobs", label: "Vagas", icon: "◉", id: "jobs" },
    { href: "/admin/profile", label: "Perfil", icon: "◎", id: "profile" },
    { href: "/admin/gpt", label: "Respostas GPT", icon: "⊹", id: "gpt" },
    { href: "/admin/settings", label: "Configurações", icon: "◬", id: "settings" },
  ];

  function isActive(item) {
    const p = window.location.pathname;
    if (item.id === "") {
      return p === "/admin" || p === "/admin/";
    }
    return p === `/admin/${item.id}` || p.startsWith(`/admin/${item.id}/`);
  }

  function escapeHtml(v) {
    return String(v ?? "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  function renderNav() {
    const sidebar = document.getElementById("sidebar");
    if (!sidebar) return;

    const links = NAV_ITEMS.map((item) => {
      const active = isActive(item);
      return `<a href="${escapeHtml(item.href)}" class="nav-item${active ? " nav-item--active" : ""}">
        <span class="nav-icon">${item.icon}</span>
        ${escapeHtml(item.label)}
      </a>`;
    }).join("");

    sidebar.innerHTML = `
      <div class="nav-logo">
        <div class="nav-logo-mark">IB</div>
        <div>
          <div class="nav-logo-name">InteractionBot</div>
          <div class="nav-logo-sub">Painel Admin</div>
        </div>
      </div>
      <nav class="nav-links">${links}</nav>
      <div class="nav-status">
        <div id="nav-process-pill" class="nav-status-pill">Verificando…</div>
      </div>
    `;
  }

  async function updateProcessStatus() {
    const pill = document.getElementById("nav-process-pill");
    if (!pill) return;
    try {
      const res = await fetch("/api/admin/processes");
      if (!res.ok) throw new Error("err");
      const data = await res.json();
      if (data.running) {
        pill.textContent = `▶ ${data.running.type}`;
        pill.className = "nav-status-pill nav-status-pill--running";
      } else {
        pill.textContent = "Sem processo ativo";
        pill.className = "nav-status-pill";
      }
    } catch {
      pill.textContent = "Sem processo ativo";
      pill.className = "nav-status-pill";
    }
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", () => {
      renderNav();
      updateProcessStatus();
      setInterval(updateProcessStatus, 4000);
    });
  } else {
    renderNav();
    updateProcessStatus();
    setInterval(updateProcessStatus, 4000);
  }
})();
