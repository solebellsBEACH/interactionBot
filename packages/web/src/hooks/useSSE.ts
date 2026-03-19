import { useEffect, useRef, useState } from "react";

export function useSSE<T>(url: string, enabled = true) {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  const esRef = useRef<EventSource | null>(null);

  useEffect(() => {
    if (!enabled) return;

    const es = new EventSource(url);
    esRef.current = es;

    es.addEventListener("snapshot", (e) => {
      try {
        setData(JSON.parse((e as MessageEvent).data));
        setError(null);
      } catch {
        setError("Falha ao parsear dados do stream.");
      }
    });

    es.onerror = () => {
      setError("Conexão com o stream perdida.");
    };

    return () => {
      es.close();
      esRef.current = null;
    };
  }, [url, enabled]);

  return { data, error };
}
