import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "../api/client";
import { Layout } from "../components/Layout";

type GptItem = {
  createdAt: string;
  fieldLabel?: string;
  fieldKey?: string;
  source?: string;
  model?: string;
  answer?: string;
  error?: string;
  success: boolean;
};

type Settings = { autoConfirmGpt: boolean; autoConfirmDelayMs: number };

function normalize(v: string) {
  return v.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().trim();
}

export function Gpt() {
  const qc = useQueryClient();
  const [filter, setFilter] = useState("");
  const [settingsStatus, setSettingsStatus] = useState("");

  const { data: gptData, refetch } = useQuery({
    queryKey: ["gpt-responses"],
    queryFn: () => api.get<{ items: GptItem[] }>("/api/admin/gpt-responses?limit=200"),
    refetchInterval: 10000,
  });

  const { data: settingsData } = useQuery({
    queryKey: ["prompts-settings"],
    queryFn: () => api.get<{ settings: Settings }>("/api/admin/prompts/current"),
  });

  const settingsMutation = useMutation({
    mutationFn: (autoConfirmGpt: boolean) =>
      api.post<{ settings: Settings }>("/api/admin/prompts/settings", { autoConfirmGpt, autoConfirmDelayMs: 1000 }),
    onSuccess: (data) => {
      qc.setQueryData(["prompts-settings"], data);
      setSettingsStatus("Configuração salva.");
    },
    onError: (e) => setSettingsStatus((e as Error).message),
  });

  const items = gptData?.items ?? [];
  const settings = settingsData?.settings;

  const visible = filter
    ? items.filter((item) => {
        const hay = normalize([item.fieldLabel, item.fieldKey, item.source, item.model, item.answer, item.error].filter(Boolean).join(" "));
        return hay.includes(normalize(filter));
      })
    : items;

  const formatDate = (v?: string) => {
    if (!v) return "-";
    const d = new Date(v);
    return isNaN(d.getTime()) ? "-" : d.toLocaleString("pt-BR");
  };

  return (
    <Layout>
      <div className="page-header">
        <div>
          <h1>Respostas GPT</h1>
          <p className="page-header-lead">Histórico de interações com o GPT e configurações de confirmação automática</p>
        </div>
        <button style={{ width: "auto", padding: "8px 14px" }} onClick={() => refetch()}>
          Atualizar
        </button>
      </div>

      <div className="grid" style={{ gridTemplateColumns: "1fr 2fr", marginBottom: 14 }}>
        <div className="card">
          <h2>Configuração do GPT</h2>
          <div className="stack">
            <div className="toggle-row">
              <label className="toggle-wrap" htmlFor="gpt-auto-confirm">
                <input
                  type="checkbox"
                  id="gpt-auto-confirm"
                  role="switch"
                  checked={settings?.autoConfirmGpt ?? false}
                  disabled={settingsMutation.isPending}
                  onChange={(e) => settingsMutation.mutate(e.target.checked)}
                />
                <span className="toggle-track"><span className="toggle-thumb"></span></span>
              </label>
              <label className="toggle-label" htmlFor="gpt-auto-confirm">Confirmação automática</label>
            </div>
            <p className="helper">
              {settings?.autoConfirmGpt
                ? `Ativado — confirma automaticamente em ${settings.autoConfirmDelayMs}ms se ninguém responder.`
                : "Desativado — o painel aguarda sua resposta no Dashboard."}
            </p>
            {settingsStatus && (
              <p className={`status ${settingsMutation.isError ? "danger" : "ok"}`}>{settingsStatus}</p>
            )}
          </div>
        </div>

        <div className="card">
          <h2>Sobre o modo automático</h2>
          <p className="helper" style={{ margin: 0 }}>
            Quando <strong>ativado</strong>, o bot confirma a resposta do GPT automaticamente após o delay configurado (1000ms).
            Use somente se confiar nas respostas do GPT para seus formulários de candidatura.
          </p>
          <p className="helper" style={{ marginTop: 8 }}>
            Quando <strong>desativado</strong>, um modal aparece no Dashboard sempre que o bot precisar de confirmação —
            você pode aprovar, corrigir ou pular.
          </p>
        </div>
      </div>

      <div className="card">
        <div className="toolbar" style={{ marginBottom: 10 }}>
          <div>
            <h2 style={{ margin: 0 }}>Histórico de Respostas</h2>
            <div className="meta">{visible.length} de {items.length} registro(s)</div>
          </div>
          <input
            type="search"
            placeholder="Filtrar por campo, fonte ou resposta"
            style={{ flex: "1 1 280px", minWidth: 220 }}
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
          />
        </div>
        <div className="table-wrap">
          <table>
            <thead>
              <tr><th>Data</th><th>Campo</th><th>Fonte</th><th>Modelo</th><th>Resposta</th><th>Status</th></tr>
            </thead>
            <tbody>
              {visible.map((item, i) => (
                <tr key={i}>
                  <td><span className="meta">{formatDate(item.createdAt)}</span></td>
                  <td>{item.fieldLabel ?? item.fieldKey ?? "-"}</td>
                  <td>{item.source ?? "-"}</td>
                  <td><span className="meta">{item.model ?? "-"}</span></td>
                  <td style={{ maxWidth: 320, wordBreak: "break-word" }}>
                    {item.success
                      ? item.answer ?? "(vazio)"
                      : <span className="danger">ERRO: {item.error ?? "sem detalhe"}</span>}
                  </td>
                  <td>
                    {item.success
                      ? <span className="badge badge-ok">ok</span>
                      : <span className="badge badge-danger">erro</span>}
                  </td>
                </tr>
              ))}
              {!visible.length && (
                <tr><td colSpan={6} className="muted">{items.length ? "Nenhum resultado para o filtro." : "Sem respostas registradas."}</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </Layout>
  );
}
