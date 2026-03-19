import { useState, useEffect } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "../api/client";
import { Layout } from "../components/Layout";

type StackEntry = { months: number; years: string; durationLabel: string; sourceCompanies: string[]; sourceTitles: string[] };
type LinkedinProfile = { name?: string; headline?: string; location?: string; website?: string; about?: string; connections?: string; currentCompany?: string; topEducation?: string; capturedAt?: string };
type ProfileData = {
  summary: string;
  birthDate: string;
  compensation: { hourlyUsd: string; hourlyBrl: string; clt: string; pj: string };
  stackExperience: Record<string, StackEntry>;
  linkedinProfile: LinkedinProfile | null;
  profileReview: { raw: string; createdAt: string } | null;
  updatedAt: string;
};

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function waitForProcess(id: string, timeoutMs = 600_000): Promise<{ status: string; summary: string; error?: string }> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const state = await api.get<{ running: { id: string; status: string; summary: string; error?: string } | null; history: { id: string; status: string; summary: string; error?: string }[] }>("/api/admin/processes");
    const p = state.running?.id === id ? state.running : state.history.find((h) => h.id === id);
    if (p && p.status !== "running") return p;
    await sleep(2000);
  }
  throw new Error("Tempo limite aguardando o processo.");
}

export function Profile() {
  const qc = useQueryClient();
  const { data, isLoading } = useQuery({
    queryKey: ["profile"],
    queryFn: () => api.get<{ profile: ProfileData }>("/api/admin/profile"),
  });

  const profile = data?.profile;

  const [form, setForm] = useState({ birthDate: "", hourlyUsd: "", hourlyBrl: "", clt: "", pj: "" });
  const [saveStatus, setSaveStatus] = useState("");
  const [captureStatus, setCaptureStatus] = useState("");
  const [captureStep, setCaptureStep] = useState("");
  const [capturePolling, setCapturePolling] = useState(false);

  useEffect(() => {
    if (profile) {
      setForm({
        birthDate: profile.birthDate ?? "",
        hourlyUsd: profile.compensation?.hourlyUsd ?? "",
        hourlyBrl: profile.compensation?.hourlyBrl ?? "",
        clt: profile.compensation?.clt ?? "",
        pj: profile.compensation?.pj ?? "",
      });
    }
  }, [profile]);

  const saveMutation = useMutation({
    mutationFn: () =>
      api.post("/api/admin/profile", {
        birthDate: form.birthDate,
        hourlyUsd: form.hourlyUsd,
        hourlyBrl: form.hourlyBrl,
        clt: form.clt,
        pj: form.pj,
      }),
    onSuccess: () => {
      setSaveStatus("Perfil salvo com sucesso.");
      qc.invalidateQueries({ queryKey: ["profile"] });
    },
    onError: (e) => setSaveStatus((e as Error).message),
  });

  const captureMutation = useMutation({
    mutationFn: async () => {
      const { id } = await api.post<{ id: string }>("/api/admin/processes/profile-review", {});
      setCapturePolling(true);
      // Poll runtime steps during capture
      const poll = setInterval(async () => {
        try {
          const rt = await api.get<{ activeStep: { label: string } | null }>("/api/admin/runtime");
          if (rt.activeStep?.label) setCaptureStep(rt.activeStep.label);
        } catch { /* ignore */ }
      }, 2000);

      try {
        const proc = await waitForProcess(id, 10 * 60 * 1000);
        if (proc.status !== "succeeded") throw new Error(proc.error || proc.summary || "Falha.");
        return proc;
      } finally {
        clearInterval(poll);
        setCapturePolling(false);
        setCaptureStep("");
      }
    },
    onSuccess: (proc) => {
      setCaptureStatus(proc.summary);
      qc.invalidateQueries({ queryKey: ["profile"] });
    },
    onError: (e) => setCaptureStatus((e as Error).message),
  });

  const formatDate = (v?: string) => {
    if (!v) return "-";
    const d = new Date(v);
    return isNaN(d.getTime()) ? v : d.toLocaleString("pt-BR");
  };

  if (isLoading) return <Layout><p className="muted">Carregando…</p></Layout>;

  const stackEntries = Object.entries(profile?.stackExperience ?? {});

  return (
    <Layout>
      <div className="page-header">
        <div>
          <h1>Perfil</h1>
          <p className="page-header-lead">Dados pessoais, compensação e experiência mapeada</p>
        </div>
      </div>

      <div className="grid" style={{ marginBottom: 14 }}>
        {/* Edit form */}
        <div className="card">
          <h2>Editar Dados</h2>
          <form className="stack" onSubmit={(e) => { e.preventDefault(); saveMutation.mutate(); }}>
            <div>
              <label>Data de nascimento</label>
              <input value={form.birthDate} onChange={(e) => setForm({ ...form, birthDate: e.target.value })} placeholder="DD/MM/AAAA" />
            </div>
            <div className="row">
              <div><label>Hora/USD</label><input value={form.hourlyUsd} onChange={(e) => setForm({ ...form, hourlyUsd: e.target.value })} /></div>
              <div><label>Hora/BRL</label><input value={form.hourlyBrl} onChange={(e) => setForm({ ...form, hourlyBrl: e.target.value })} /></div>
            </div>
            <div className="row">
              <div><label>Pretensão CLT</label><input value={form.clt} onChange={(e) => setForm({ ...form, clt: e.target.value })} /></div>
              <div><label>Pretensão PJ</label><input value={form.pj} onChange={(e) => setForm({ ...form, pj: e.target.value })} /></div>
            </div>
            <button type="submit" disabled={saveMutation.isPending}>
              {saveMutation.isPending ? "Salvando…" : "Salvar perfil"}
            </button>
            {saveStatus && (
              <p className={`status ${saveMutation.isError ? "danger" : "ok"}`}>{saveStatus}</p>
            )}
          </form>
        </div>

        {/* Capture */}
        <div className="card">
          <h2>Capturar Perfil LinkedIn</h2>
          <div className="stack">
            <p className="helper">
              Visita seu perfil LinkedIn e extrai dados automaticamente — experiências, educação, habilidades e stacks.
            </p>
            {capturePolling && (
              <div style={{ background: "rgba(14,122,109,0.08)", borderRadius: 6, padding: "10px 14px", fontSize: "0.88rem" }}>
                <strong>Capturando…</strong>
                {captureStep && <span style={{ marginLeft: 8, color: "#0b5c52" }}>{captureStep}</span>}
                <a href="/admin/dashboard" target="_blank" style={{ float: "right", fontSize: "0.82rem" }}>Ver no Dashboard ↗</a>
              </div>
            )}
            <button className="secondary" disabled={captureMutation.isPending} onClick={() => captureMutation.mutate()}>
              {captureMutation.isPending ? "Capturando…" : "Capturar perfil"}
            </button>
            {captureStatus && (
              <p className={`status ${captureMutation.isError ? "danger" : "ok"}`}>{captureStatus}</p>
            )}
          </div>
        </div>
      </div>

      {/* Stack experience */}
      {stackEntries.length > 0 && (
        <div className="card" style={{ marginBottom: 14 }}>
          <h2>Experiência de Stack</h2>
          <div className="table-wrap" style={{ marginTop: 10 }}>
            <table>
              <thead>
                <tr><th>Stack</th><th>Duração</th><th>Empresas</th></tr>
              </thead>
              <tbody>
                {stackEntries.map(([key, entry]) => (
                  <tr key={key}>
                    <td><strong>{key}</strong></td>
                    <td><span className="meta">{entry.durationLabel}</span></td>
                    <td className="meta">{entry.sourceCompanies.slice(0, 3).join(", ") || "-"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* LinkedIn profile snapshot */}
      {profile?.linkedinProfile && (
        <div className="card" style={{ marginBottom: 14 }}>
          <h2>Snapshot LinkedIn</h2>
          <p className="helper" style={{ marginBottom: 10 }}>Capturado em {formatDate(profile.linkedinProfile.capturedAt)}</p>
          <div className="info-row"><span className="info-label">Nome</span><span className="info-value">{profile.linkedinProfile.name}</span></div>
          <div className="info-row"><span className="info-label">Headline</span><span className="info-value">{profile.linkedinProfile.headline}</span></div>
          <div className="info-row"><span className="info-label">Localização</span><span className="info-value">{profile.linkedinProfile.location}</span></div>
          <div className="info-row"><span className="info-label">Empresa atual</span><span className="info-value">{profile.linkedinProfile.currentCompany}</span></div>
          <div className="info-row"><span className="info-label">Formação</span><span className="info-value">{profile.linkedinProfile.topEducation}</span></div>
          <div className="info-row"><span className="info-label">Conexões</span><span className="info-value">{profile.linkedinProfile.connections}</span></div>
        </div>
      )}

      {/* Profile review */}
      {profile?.profileReview?.raw && (
        <div className="card">
          <h2>Revisão do Perfil (JSON)</h2>
          <p className="helper" style={{ marginBottom: 10 }}>Gerado em {formatDate(profile.profileReview.createdAt)}</p>
          <pre className="code-block">{profile.profileReview.raw}</pre>
        </div>
      )}
    </Layout>
  );
}
