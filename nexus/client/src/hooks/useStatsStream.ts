import { useEffect, useRef, useState } from 'react';

export interface AgentInfo { id: string; name: string; loaded: boolean; }
export interface AgentStats {
  feedback: number; trained: number; commands: number;
  trainRuns: number; collectRuns: number; collectedPairs: number;
}
export interface StatsPayload {
  agents: AgentInfo[];
  ollamaModels: string[];
  stats: Record<string, AgentStats>;
  pingMs: number;
}

export function useStatsStream(): StatsPayload | null {
  const [payload, setPayload] = useState<StatsPayload | null>(null);
  const esRef = useRef<EventSource | null>(null);

  useEffect(() => {
    let active = true;

    function connect() {
      if (!active) return;
      const t0 = performance.now();
      const es = new EventSource('/api/stats/live');
      esRef.current = es;

      es.onmessage = (e) => {
        try {
          const ev = JSON.parse(e.data);
          if (ev.type === 'update') {
            setPayload({
              agents:       ev.agents       ?? [],
              ollamaModels: ev.ollamaModels ?? [],
              stats:        ev.stats        ?? {},
              pingMs:       Math.round(performance.now() - t0),
            });
          }
        } catch {}
      };

      es.onerror = () => {
        es.close();
        esRef.current = null;
        // Reconnect after 3s if still mounted
        if (active) setTimeout(connect, 3000);
      };
    }

    connect();

    return () => {
      active = false;
      esRef.current?.close();
      esRef.current = null;
    };
  }, []);

  return payload;
}
