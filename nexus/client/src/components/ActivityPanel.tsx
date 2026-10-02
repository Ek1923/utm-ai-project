import { useEffect, useRef, useState } from 'react';
import { useStatsStream } from '../hooks/useStatsStream';
import type { AgentStats } from '../hooks/useStatsStream';

interface AgentInfo { id: string; name: string; loaded: boolean; }
interface LiveData {
  agents: AgentInfo[];
  ollamaModels: string[];
  stats: Record<string, AgentStats>;
  pingMs: number;
  fetchedAt: number;
}

const AGENT_META: Record<string, { label: string; role: string; color: string; icon: string }> = {
  apex1:    { label: 'APEX-1',    role: 'ORCHESTRATOR', color: '#00ffd5', icon: '◈' },
  apex2:    { label: 'APEX-2',    role: 'QUALITY',      color: '#b400ff', icon: '◇' },
  forge:    { label: 'FORGE',     role: 'DEVELOPER',    color: '#ff6b00', icon: '⚙' },
  spark:    { label: 'SPARK',     role: 'IDEATION',     color: '#ffb800', icon: '✦' },
  atlas:    { label: 'ATLAS',     role: 'KNOWLEDGE',    color: '#00b4ff', icon: '◎' },
  tactix:   { label: 'TACTIX',    role: 'PLANNING',     color: '#00ff9d', icon: '⊕' },
  vega:     { label: 'VEGA',    role: 'VICE-GEN',     color: '#ff2d55', icon: '★' },
  optic:    { label: 'OPTIC',   role: 'DATA',         color: '#a78bfa', icon: '◉' },
  nexus_ui: { label: 'OPTIC',   role: 'DATA',         color: '#a78bfa', icon: '◉' },
  jarvis:   { label: 'JARVIS',  role: 'PROJECTS',     color: '#c8a86b', icon: '◈' },
};

interface ActivityPanelProps {
  type: 'agents' | 'system';
  title: string;
  subtitle?: string;
}

export function ActivityPanel({ type, title, subtitle }: ActivityPanelProps) {
  const stream = useStatsStream();
  const [data, setData] = useState<LiveData | null>(null);
  const [uptimeSec, setUptimeSec] = useState(0);
  const [tick, setTick] = useState(0);

  useEffect(() => {
    const t0 = Date.now();
    const iv = setInterval(() => {
      setUptimeSec(Math.floor((Date.now() - t0) / 1000));
      setTick(t => t + 1);
    }, 1000);
    return () => clearInterval(iv);
  }, []);

  useEffect(() => {
    if (!stream) return;
    setData({ agents: stream.agents, ollamaModels: stream.ollamaModels, stats: stream.stats, pingMs: stream.pingMs, fetchedAt: Date.now() });
  }, [stream]);

  function fmtUptime(s: number) {
    if (s < 60)   return `${s}s`;
    if (s < 3600) return `${Math.floor(s / 60)}m ${s % 60}s`;
    return `${Math.floor(s / 3600)}h ${Math.floor((s % 3600) / 60)}m`;
  }

  const hh = new Date().getHours().toString().padStart(2, '0');
  const mm = new Date().getMinutes().toString().padStart(2, '0');
  const ss = new Date().getSeconds().toString().padStart(2, '0');
  const isLive = data !== null;

  return (
    <div style={{ height: '100%', minHeight: 0, display: 'flex', flexDirection: 'column', border: '1px solid rgba(0,255,213,0.18)', background: 'var(--bg-card)', position: 'relative', overflow: 'hidden' }}>

      {/* Scan line */}
      <div className="scan-anim" style={{ position: 'absolute', inset: 0, pointerEvents: 'none', zIndex: 0 }} />

      {/* Header */}
      <div style={{ padding: '7px 12px 6px', borderBottom: '1px solid rgba(0,255,213,0.14)', background: 'rgba(0,255,213,0.05)', flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'space-between', zIndex: 1 }}>
        <div>
          <div style={{ fontSize: 10.5, fontWeight: 700, letterSpacing: '0.18em', color: '#00ffd5', textShadow: '0 0 10px rgba(0,255,213,0.5)' }}>{title}</div>
          {subtitle && <div style={{ fontSize: 8, color: 'rgba(0,255,213,0.4)', letterSpacing: '0.12em', marginTop: 1 }}>{subtitle}</div>}
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          {/* Live dot */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
            <div style={{ width: 5, height: 5, borderRadius: '50%', background: isLive ? '#00ff9d' : '#ffb800', boxShadow: isLive ? '0 0 6px #00ff9d' : '0 0 6px #ffb800', animation: 'pulse 1.8s ease-in-out infinite' }} />
            <span style={{ fontSize: 7.5, color: isLive ? '#00ff9d' : '#ffb800', letterSpacing: '0.1em' }}>{isLive ? 'LIVE' : 'WAIT'}</span>
          </div>
          {/* Clock */}
          <span style={{ fontSize: 9.5, fontFamily: 'monospace', color: 'rgba(255,255,255,0.35)', letterSpacing: '0.05em' }}>
            {hh}<span style={{ opacity: tick % 2 === 0 ? 1 : 0.25 }}>:</span>{mm}<span style={{ opacity: tick % 2 === 0 ? 1 : 0.25 }}>:</span>{ss}
          </span>
        </div>
      </div>

      {/* Content */}
      <div style={{ flex: 1, overflowY: 'auto', padding: '8px 10px', zIndex: 1 }}>
        {type === 'agents'
          ? <AgentActivityBars data={data} />
          : <SystemTelemetry data={data} uptimeSec={uptimeSec} fmtUptime={fmtUptime} />
        }
      </div>
    </div>
  );
}

// ── Agent activity bars ───────────────────────────────────────────────────────
function AgentActivityBars({ data }: { data: LiveData | null }) {
  const agentIds  = ['apex1', 'forge', 'spark', 'atlas', 'tactix', 'vega', 'apex2', 'nexus_ui'];
  const maxCmds   = Math.max(1, ...agentIds.map(id => data?.stats[id]?.commands ?? 0));

  const prevRef = useRef<Record<string, { cmds: number; trainRuns: number; collectRuns: number; collectedPairs: number }>>({});
  const [flashes, setFlashes] = useState<Record<string, { label: string; key: number; color: string }>>({});

  useEffect(() => {
    if (!data) return;
    agentIds.forEach(id => {
      const s   = data.stats[id];
      const cur = { cmds: s?.commands ?? 0, trainRuns: s?.trainRuns ?? 0, collectRuns: s?.collectRuns ?? 0, collectedPairs: s?.collectedPairs ?? 0 };
      const prev = prevRef.current[id];
      if (prev !== undefined) {
        if (cur.trainRuns > prev.trainRuns) {
          triggerFlash(id, '+TRAIN', '#ffb800');
        } else if (cur.collectRuns > prev.collectRuns) {
          const diff = cur.collectedPairs - prev.collectedPairs;
          triggerFlash(id, `+${diff > 0 ? diff : '?'}p`, '#00b4ff');
        } else if (cur.cmds > prev.cmds) {
          triggerFlash(id, `+${cur.cmds - prev.cmds}`, '#00ff9d');
        }
      }
      prevRef.current[id] = cur;
    });
  }, [data]); // eslint-disable-line

  function triggerFlash(id: string, label: string, color: string) {
    const key = Date.now() + Math.random();
    setFlashes(p => ({ ...p, [id]: { label, key, color } }));
    setTimeout(() => setFlashes(p => { const n = { ...p }; if (n[id]?.key === key) delete n[id]; return n; }), 2200);
  }

  const totalCmds     = agentIds.reduce((s, id) => s + (data?.stats[id]?.commands ?? 0), 0);
  const loadedCount   = agentIds.filter(id => data?.agents.find(a => a.id === id)?.loaded).length;

  return (
    <div>
      {/* Summary strip */}
      <div style={{ display: 'flex', gap: 6, marginBottom: 10, padding: '5px 8px', background: 'rgba(0,255,213,0.04)', border: '1px solid rgba(0,255,213,0.1)' }}>
        <Chip label="AGENTS" value={`${loadedCount}/${agentIds.length}`} color="#00ffd5" />
        <div style={{ width: 1, background: 'rgba(255,255,255,0.08)' }} />
        <Chip label="CMDS" value={String(totalCmds)} color="#ffb800" />
        <div style={{ width: 1, background: 'rgba(255,255,255,0.08)' }} />
        <Chip label="STATUS" value={loadedCount === agentIds.length ? 'NOMINAL' : loadedCount > 0 ? 'PARTIAL' : 'OFFLINE'} color={loadedCount === agentIds.length ? '#00ff9d' : loadedCount > 0 ? '#ffb800' : '#ff2d55'} />
      </div>

      {/* Agent rows */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 7 }}>
        {agentIds.map(id => {
          const meta          = AGENT_META[id];
          const stats         = data?.stats[id];
          const cmds          = stats?.commands      ?? 0;
          const feedback      = stats?.feedback      ?? 0;
          const trainRuns     = stats?.trainRuns     ?? 0;
          const collectRuns   = stats?.collectRuns   ?? 0;
          const collectedPairs = stats?.collectedPairs ?? 0;
          const pct           = Math.round((cmds / maxCmds) * 100);
          const loaded        = data?.agents.find(a => a.id === id)?.loaded ?? false;
          const flash         = flashes[id];
          const { color, label, role, icon } = meta;
          const dimColor      = loaded ? color : 'rgba(255,255,255,0.1)';

          return (
            <div key={id} style={{ padding: '6px 8px', background: loaded ? `${color}08` : 'rgba(255,255,255,0.02)', border: `1px solid ${loaded ? color + '22' : 'rgba(255,255,255,0.06)'}`, borderLeft: `2px solid ${loaded ? color : 'rgba(255,255,255,0.07)'}`, position: 'relative' }}>

              {/* Row 1: Name + status + value */}
              <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 5 }}>
                {/* Icon */}
                <span style={{ color: dimColor, fontSize: 11, width: 12, textAlign: 'center', flexShrink: 0 }}>{icon}</span>

                {/* Name */}
                <span style={{ color: loaded ? color : 'rgba(255,255,255,0.2)', fontSize: 10.5, fontWeight: 700, letterSpacing: '0.08em', flex: 1 }}>{label}</span>

                {/* Role badge */}
                <span style={{ fontSize: 7, color: `${dimColor}99`, letterSpacing: '0.1em', border: `1px solid ${dimColor}25`, padding: '1px 4px', flexShrink: 0 }}>{role}</span>

                {/* Status dot */}
                <div style={{ width: 5, height: 5, borderRadius: '50%', background: loaded ? color : '#2a2a2a', boxShadow: loaded ? `0 0 5px ${color}` : 'none', flexShrink: 0 }} />
              </div>

              {/* Row 2: Stats pills */}
              <div style={{ display: 'flex', gap: 4, marginBottom: 6, flexWrap: 'wrap' }}>
                <StatPill icon="⌘" value={cmds}          color={cmds > 0 ? color : 'rgba(255,255,255,0.1)'} label="cmd" />
                {feedback > 0      && <StatPill icon="▲" value={feedback}      color="#00ff9d" label="fb"    />}
                {trainRuns > 0     && <StatPill icon="▶" value={`×${trainRuns}`} color="#ffb800" label="train" />}
                {collectRuns > 0   && <StatPill icon="⬇" value={collectedPairs} color="#00b4ff" label="pairs" />}
              </div>

              {/* Row 3: Bar */}
              <div style={{ height: 3, background: 'rgba(255,255,255,0.07)', borderRadius: 2, overflow: 'hidden' }}>
                <div style={{
                  height: '100%',
                  width: data === null ? '0%' : cmds === 0 ? '3%' : `${pct}%`,
                  background: cmds === 0 ? 'rgba(255,255,255,0.06)' : `linear-gradient(to right, ${color}55, ${color})`,
                  boxShadow: cmds > 0 ? `0 0 6px ${color}70` : 'none',
                  borderRadius: 2,
                  transition: 'width 0.7s ease',
                }} />
              </div>

              {/* Flash badge */}
              {flash && (
                <span key={flash.key} className="flash-badge font-mono font-bold"
                  style={{ position: 'absolute', top: 2, right: 6, color: flash.color, fontSize: 10, textShadow: `0 0 8px ${flash.color}`, pointerEvents: 'none' }}>
                  {flash.label}
                </span>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ── System telemetry ──────────────────────────────────────────────────────────
function SystemTelemetry({ data, uptimeSec, fmtUptime }: {
  data: LiveData | null;
  uptimeSec: number;
  fmtUptime: (s: number) => string;
}) {
  const totalCmds      = Object.values(data?.stats ?? {}).reduce((s, v) => s + v.commands, 0);
  const totalFeedback  = Object.values(data?.stats ?? {}).reduce((s, v) => s + v.feedback, 0);
  const totalTrainRuns = Object.values(data?.stats ?? {}).reduce((s, v) => s + (v.trainRuns ?? 0), 0);
  const totalCollected = Object.values(data?.stats ?? {}).reduce((s, v) => s + (v.collectedPairs ?? 0), 0);
  const loadedCount    = data?.agents.filter(a => a.loaded).length ?? 0;
  const totalAgents    = data?.agents.length ?? 8;
  const ollamaOnline   = (data?.ollamaModels.length ?? 0) > 0;

  const pingColor = data === null ? '#ffb800' : data.pingMs < 0 ? '#ff2d55' : data.pingMs < 50 ? '#00ff9d' : data.pingMs < 200 ? '#ffb800' : '#ff2d55';

  const sections: {
    heading: string;
    items: { icon: string; label: string; value: string; color: string; bar?: number; sub?: string }[];
  }[] = [
    {
      heading: 'CONNECTIVITEIT',
      items: [
        {
          icon: '⚡', label: 'SERVER PING',
          value: data === null ? '...' : data.pingMs < 0 ? 'OFFLINE' : `${data.pingMs}ms`,
          color: pingColor,
          bar: data ? Math.max(0, 100 - Math.min(data.pingMs, 100)) : 0,
          sub: data?.pingMs && data.pingMs > 0 ? (data.pingMs < 50 ? 'UITSTEKEND' : data.pingMs < 150 ? 'GOED' : 'TRAAG') : undefined,
        },
        {
          icon: '◎', label: 'CAMELLLO ENGINE',
          value: data === null ? '...' : ollamaOnline ? `${data.ollamaModels.length} MODELS` : 'OFFLINE',
          color: ollamaOnline ? '#00ff9d' : '#ff2d55',
          bar: data ? (loadedCount / Math.max(totalAgents, 1)) * 100 : 0,
          sub: ollamaOnline ? data?.ollamaModels.slice(0, 2).join(', ') : 'camelllo.exe starten',
        },
        {
          icon: '⬡', label: 'AGENTS GELADEN',
          value: data === null ? '...' : `${loadedCount} / ${totalAgents}`,
          color: loadedCount === totalAgents ? '#00ffd5' : loadedCount > 0 ? '#ffb800' : '#ff2d55',
          bar: data ? (loadedCount / Math.max(totalAgents, 1)) * 100 : 0,
          sub: loadedCount === totalAgents ? 'VOLLEDIG OPERATIONEEL' : loadedCount > 0 ? 'GEDEELTELIJK' : 'GEEN AGENTS',
        },
      ],
    },
    {
      heading: 'SESSIE ACTIVITEIT',
      items: [
        {
          icon: '⌘', label: 'COMMANDO\'S',
          value: data === null ? '...' : String(totalCmds),
          color: '#ffb800',
          bar: Math.min(100, totalCmds * 2),
          sub: totalCmds === 0 ? 'STANDBY' : `ACTIEF`,
        },
        {
          icon: '▲', label: 'FEEDBACK PAIRS',
          value: data === null ? '...' : String(totalFeedback),
          color: '#b400ff',
          bar: Math.min(100, (totalFeedback / 200) * 100),
          sub: totalFeedback > 0 ? `${totalFeedback} trainingsdata` : 'GEEN DATA',
        },
      ],
    },
    {
      heading: 'FORGE TRAINING',
      items: [
        {
          icon: '▶', label: 'TRAIN RUNS',
          value: data === null ? '...' : totalTrainRuns > 0 ? `${totalTrainRuns}×` : 'NOOIT',
          color: '#ff6b00',
          bar: Math.min(100, totalTrainRuns * 20),
          sub: totalTrainRuns > 0 ? 'MODEL VERBETERD' : 'WACHT OP DATA',
        },
        {
          icon: '⬇', label: 'GECOLLECTEERD',
          value: data === null ? '...' : String(totalCollected),
          color: '#00b4ff',
          bar: Math.min(100, (totalCollected / 100) * 100),
          sub: totalCollected > 0 ? `${totalCollected} paren opgeslagen` : 'LEEG',
        },
      ],
    },
    {
      heading: 'SYSTEEM',
      items: [
        {
          icon: '◷', label: 'UPTIME',
          value: fmtUptime(uptimeSec),
          color: '#00ffd5',
          bar: Math.min(100, (uptimeSec / 3600) * 100),
          sub: uptimeSec > 3600 ? '> 1 uur actief' : 'RECENT GESTART',
        },
      ],
    },
  ];

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      {sections.map(sec => (
        <div key={sec.heading}>
          {/* Section heading */}
          <div style={{ fontSize: 7, color: 'rgba(0,245,255,0.3)', letterSpacing: '0.2em', marginBottom: 6, display: 'flex', alignItems: 'center', gap: 6 }}>
            {sec.heading}
            <div style={{ flex: 1, height: 1, background: 'rgba(0,245,255,0.08)' }} />
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            {sec.items.map((row, i) => (
              <div key={i} style={{ padding: '6px 8px', background: `${row.color}08`, border: `1px solid ${row.color}18`, borderLeft: `2px solid ${row.color}55` }}>
                {/* Top row */}
                <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 4 }}>
                  <span style={{ color: row.color, fontSize: 11, width: 12, textAlign: 'center', flexShrink: 0 }}>{row.icon}</span>
                  <span style={{ fontSize: 8.5, color: 'rgba(255,255,255,0.4)', letterSpacing: '0.1em', flex: 1 }}>{row.label}</span>
                  <span style={{ fontSize: 11, fontWeight: 700, color: row.color, fontFamily: 'monospace', letterSpacing: '0.04em' }}>{row.value}</span>
                </div>
                {/* Bar */}
                <div style={{ height: 3, background: 'rgba(255,255,255,0.07)', borderRadius: 2, overflow: 'hidden', marginBottom: row.sub ? 3 : 0 }}>
                  <div style={{
                    height: '100%',
                    width: `${row.bar ?? 0}%`,
                    background: `linear-gradient(to right, ${row.color}55, ${row.color})`,
                    boxShadow: `0 0 5px ${row.color}60`,
                    borderRadius: 2,
                    transition: 'width 0.9s ease',
                  }} />
                </div>
                {/* Sub */}
                {row.sub && (
                  <div style={{ fontSize: 7.5, color: `${row.color}66`, marginTop: 2, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{row.sub}</div>
                )}
              </div>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}

// ── Mini helpers ──────────────────────────────────────────────────────────────
function StatPill({ icon, value, color, label }: { icon: string; value: string | number; color: string; label: string }) {
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 3, fontSize: 8, padding: '1px 5px', border: `1px solid ${color}28`, color, background: `${color}0c`, fontFamily: 'monospace' }}
      title={label}>
      <span style={{ fontSize: 8 }}>{icon}</span>{value}
    </span>
  );
}

function Chip({ label, value, color }: { label: string; value: string; color: string }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', flex: 1 }}>
      <span style={{ fontSize: 7, color: 'rgba(255,255,255,0.2)', letterSpacing: '0.12em' }}>{label}</span>
      <span style={{ fontSize: 10.5, fontWeight: 700, color, fontFamily: 'monospace' }}>{value}</span>
    </div>
  );
}
