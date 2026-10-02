import { useEffect, useState } from 'react';

interface AgentInfo  { id: string; name: string; loaded: boolean; }
interface AgentStats { feedback: number; trained: number; commands: number; }
interface LiveData {
  agents:       AgentInfo[];
  ollamaModels: string[];
  stats:        Record<string, AgentStats>;
  pingMs:       number;
}

export function MetricsBar() {
  const [data,      setData]      = useState<LiveData | null>(null);
  const [uptimeSec, setUptimeSec] = useState(0);
  const [,          setTick]      = useState(0);

  useEffect(() => {
    const start = Date.now();
    const iv = setInterval(() => {
      setUptimeSec(Math.floor((Date.now() - start) / 1000));
      setTick(t => t + 1);
    }, 1000);
    return () => clearInterval(iv);
  }, []);

  useEffect(() => {
    async function fetchAll() {
      const t0 = performance.now();
      try {
        const [agentsRes, statsRes] = await Promise.all([
          fetch('/api/agents'),
          fetch('/api/agents/stats'),
        ]);
        const pingMs     = Math.round(performance.now() - t0);
        const agentsJson = await agentsRes.json();
        const statsJson  = await statsRes.json();
        setData({ agents: agentsJson.agents ?? [], ollamaModels: agentsJson.ollamaModels ?? [], stats: statsJson.stats ?? {}, pingMs });
      } catch {
        setData(prev => prev ? { ...prev, pingMs: -1 } : null);
      }
    }
    fetchAll();
    const iv = setInterval(fetchAll, 5000);
    return () => clearInterval(iv);
  }, []);

  const loadedCount   = data?.agents.filter(a => a.loaded).length ?? 0;
  const totalAgents   = data?.agents.length ?? 8;
  const totalCmds     = Object.values(data?.stats ?? {}).reduce((s, v) => s + v.commands, 0);
  const totalFeedback = Object.values(data?.stats ?? {}).reduce((s, v) => s + v.feedback, 0);
  const forgeTrained  = data?.stats['forge']?.trained ?? 0;
  const ollamaOnline  = (data?.ollamaModels.length ?? 0) > 0;
  const health        = data === null ? null : ollamaOnline ? Math.round((loadedCount / Math.max(totalAgents, 1)) * 100) : 40;

  function fmtUptime(s: number) {
    if (s < 60)   return `${s}s`;
    if (s < 3600) return `${Math.floor(s / 60)}m ${s % 60}s`;
    return `${Math.floor(s / 3600)}h ${Math.floor((s % 3600) / 60)}m`;
  }

  const metrics: {
    id: string; label: string;
    value: string; sub: string;
    color: string; bar?: number; pulse?: boolean;
  }[] = [
    {
      id: 'health', label: 'Health',
      value:  health === null ? '—' : `${health}%`,
      sub:    health === null ? 'Init' : health === 100 ? 'Nominal' : health >= 50 ? 'Partial' : 'Degraded',
      color:  health === null ? '#fbbf24' : health === 100 ? '#22d3a8' : health >= 50 ? '#fbbf24' : '#f43f5e',
      bar:    health ?? 0,
      pulse:  health !== null && health < 100,
    },
    {
      id: 'agents', label: 'Agents',
      value:  data === null ? '—' : `${loadedCount} / ${totalAgents}`,
      sub:    loadedCount === totalAgents ? 'All loaded' : loadedCount > 0 ? 'Partial' : 'Offline',
      color:  loadedCount === totalAgents ? '#00d9ff' : loadedCount > 0 ? '#fbbf24' : '#f43f5e',
      bar:    data === null ? 0 : (loadedCount / Math.max(totalAgents, 1)) * 100,
    },
    {
      id: 'commands', label: 'Commands',
      value:  data === null ? '—' : String(totalCmds),
      sub:    totalCmds === 0 ? 'Standby' : `Up ${fmtUptime(uptimeSec)}`,
      color:  '#fbbf24',
    },
    {
      id: 'feedback', label: 'Train data',
      value:  data === null ? '—' : String(totalFeedback),
      sub:    totalFeedback === 0 ? 'No data' : forgeTrained > 0 ? `×${forgeTrained} trained` : 'Ready',
      color:  '#a78bfa',
      bar:    Math.min((totalFeedback / 500) * 100, 100),
    },
    {
      id: 'forge', label: 'FORGE',
      value:  data === null ? '—' : forgeTrained > 0 ? `×${forgeTrained}` : 'Init',
      sub:    forgeTrained > 0 ? 'Self-improved' : 'Awaiting train',
      color:  '#ff7a2a',
      pulse:  forgeTrained === 0,
    },
    {
      id: 'camelllo', label: 'Camelllo',
      value:  data === null ? '—' : ollamaOnline ? 'Online' : 'Offline',
      sub:    data === null ? 'Pinging…' : ollamaOnline ? `${data.ollamaModels.length} models · ${data.pingMs}ms` : 'Not running',
      color:  data === null ? '#fbbf24' : ollamaOnline ? '#22d3a8' : '#f43f5e',
      pulse:  !ollamaOnline && data !== null,
    },
  ];

  return (
    <div style={{
      display: 'grid',
      gridTemplateColumns: 'repeat(6, 1fr)',
      flexShrink: 0,
      background: 'rgba(10,16,28,0.92)',
      borderBottom: '1px solid rgba(0,190,255,0.07)',
      backdropFilter: 'blur(20px)',
    }}>
      {metrics.map((m, i) => (
        <div
          key={m.id}
          style={{
            padding: '9px 16px 8px',
            borderRight: i < 5 ? '1px solid rgba(0,190,255,0.06)' : 'none',
            display: 'flex', flexDirection: 'column', gap: '3px',
          }}
        >
          {/* Label */}
          <div style={{ fontSize: '10px', fontWeight: 500, color: 'rgba(120,160,200,0.45)', letterSpacing: '0.04em' }}>
            {m.label}
          </div>

          {/* Value */}
          <div style={{
            fontSize: '15px', fontWeight: 700, lineHeight: 1, letterSpacing: '0.02em',
            color: m.color,
            animation: m.pulse ? 'pulse 2s ease-in-out infinite' : 'none',
          }}>
            {m.value}
          </div>

          {/* Sub */}
          <div style={{ fontSize: '10px', color: 'rgba(120,160,200,0.35)', letterSpacing: '0.02em' }}>
            {m.sub}
          </div>

          {/* Bar */}
          {m.bar !== undefined && (
            <div style={{ marginTop: '2px', height: '2px', background: 'rgba(0,190,255,0.08)', borderRadius: '2px', overflow: 'hidden' }}>
              <div style={{
                height: '100%',
                width: `${Math.min(m.bar, 100)}%`,
                background: `linear-gradient(90deg, ${m.color}70, ${m.color})`,
                borderRadius: '2px',
                transition: 'width 0.6s ease',
              }} />
            </div>
          )}
        </div>
      ))}
    </div>
  );
}
