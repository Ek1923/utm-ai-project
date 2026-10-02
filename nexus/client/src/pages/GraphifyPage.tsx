import { useEffect, useRef, useState } from 'react';

const AGENTS = [
  { id: 'apex1',    name: 'APEX-1',   color: '#00ffd5', icon: '◈' },
  { id: 'apex2',    name: 'APEX-2',   color: '#b400ff', icon: '◉' },
  { id: 'forge',    name: 'FORGE',    color: '#ff6b00', icon: '</>' },
  { id: 'spark',    name: 'SPARK',    color: '#ffb800', icon: '✦' },
  { id: 'atlas',    name: 'ATLAS',    color: '#00b4ff', icon: '◎' },
  { id: 'tactix',   name: 'TACTIX',   color: '#00ff9d', icon: '⬡' },
  { id: 'vega',     name: 'VEGA',     color: '#ff2d55', icon: '★' },
  { id: 'optic',  name: 'OPTIC',  color: '#a78bfa', icon: '◉' },
  { id: 'jarvis', name: 'JARVIS', color: '#c8a86b', icon: '◈' },
];

interface AgentStats { commands: number; feedback: number; trained: number; }
interface HistoryPoint { t: number; stats: Record<string, AgentStats>; }

const MAX_POINTS = 30;

function Sparkline({ points, color, width = 180, height = 36 }: {
  points: number[];
  color: string;
  width?: number;
  height?: number;
}) {
  if (points.length < 2) {
    return (
      <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`}>
        <line x1={0} y1={height / 2} x2={width} y2={height / 2} stroke={`${color}22`} strokeWidth={1} />
      </svg>
    );
  }

  const min = Math.min(...points);
  const max = Math.max(...points);
  const range = max - min || 1;
  const pad = 3;

  const coords = points.map((v, i) => {
    const x = (i / (MAX_POINTS - 1)) * (width - pad * 2) + pad;
    const y = height - pad - ((v - min) / range) * (height - pad * 2);
    return `${x},${y}`;
  });

  const pathD = 'M' + coords.join(' L');
  const areaD = `M${pad},${height - pad} L${coords.join(' L')} L${(points.length - 1) / (MAX_POINTS - 1) * (width - pad * 2) + pad},${height - pad} Z`;

  const latest = points[points.length - 1];
  const lastX  = ((points.length - 1) / (MAX_POINTS - 1)) * (width - pad * 2) + pad;
  const lastY  = height - pad - ((latest - min) / range) * (height - pad * 2);

  return (
    <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`} style={{ overflow: 'visible' }}>
      {/* Area fill */}
      <path d={areaD} fill={`${color}0d`} />
      {/* Line */}
      <path d={pathD} fill="none" stroke={color} strokeWidth={1.5} strokeLinejoin="round" strokeLinecap="round" />
      {/* Latest dot */}
      <circle cx={lastX} cy={lastY} r={2.5} fill={color} style={{ filter: `drop-shadow(0 0 4px ${color})` }} />
    </svg>
  );
}

export function GraphifyPage() {
  const [history, setHistory] = useState<HistoryPoint[]>([]);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    const poll = async () => {
      try {
        const res = await fetch('/api/agents/stats');
        const data = await res.json();
        setHistory(prev => {
          const next = [...prev, { t: Date.now(), stats: data.stats ?? {} }];
          return next.slice(-MAX_POINTS);
        });
      } catch { /* ignore */ }
    };
    poll();
    timerRef.current = setInterval(poll, 5000);
    return () => { if (timerRef.current) clearInterval(timerRef.current); };
  }, []);

  const latest = history[history.length - 1]?.stats ?? {};
  const totalCmds     = Object.values(latest).reduce((s: number, v: AgentStats) => s + (v?.commands ?? 0), 0);
  const totalFeedback = Object.values(latest).reduce((s: number, v: AgentStats) => s + (v?.feedback ?? 0), 0);
  const totalTrained  = Object.values(latest).reduce((s: number, v: AgentStats) => s + (v?.trained ?? 0), 0);

  return (
    <div className="h-full overflow-y-auto" style={{ background: 'var(--bg-panel)' }}>
      <div className="p-5">

        {/* Header */}
        <div className="mb-5">
          <div className="text-xs font-mono text-slate-500 tracking-widest mb-1">◈ GRAPHIFY</div>
          <div className="font-bold text-lg tracking-wider" style={{ color: '#00ffd5' }}>AGENT STATISTIEKEN</div>
          <div className="text-xs text-slate-500 mt-0.5">Live grafiek — {MAX_POINTS}× samples · elke 5s bijgewerkt</div>
        </div>

        {/* Summary row */}
        <div className="grid grid-cols-3 gap-3 mb-6">
          {[
            { label: 'TOTAAL COMMANDO\'S', value: totalCmds,     color: '#00ffd5' },
            { label: 'FEEDBACK PAREN',     value: totalFeedback, color: '#b400ff' },
            { label: 'TRAINING RUNS',      value: totalTrained,  color: '#ff6b00' },
          ].map(s => (
            <div key={s.label} className="px-4 py-3" style={{ border: `1px solid ${s.color}22`, background: `${s.color}06`, borderRadius: '5px' }}>
              <div className="font-mono text-slate-600 tracking-widest mb-1" style={{ fontSize: '9px' }}>{s.label}</div>
              <div className="font-mono font-bold" style={{ color: s.color, fontSize: '28px', textShadow: `0 0 14px ${s.color}` }}>{s.value}</div>
            </div>
          ))}
        </div>

        {/* Agent sparkline cards */}
        <div className="grid grid-cols-2 gap-3 mb-6">
          {AGENTS.map(agent => {
            const cmdHistory  = history.map(h => h.stats[agent.id]?.commands  ?? 0);
            const fbHistory   = history.map(h => h.stats[agent.id]?.feedback  ?? 0);
            const cur         = latest[agent.id];
            const cmds        = cur?.commands  ?? 0;
            const feedback    = cur?.feedback  ?? 0;
            const trained     = cur?.trained   ?? 0;

            return (
              <div key={agent.id} style={{ border: `1px solid ${agent.color}22`, background: `${agent.color}05`, borderRadius: '5px', padding: '12px 14px' }}>
                {/* Agent header */}
                <div className="flex items-center justify-between mb-2">
                  <div className="flex items-center gap-2">
                    <span className="font-mono font-bold" style={{ color: agent.color, fontSize: '13px', textShadow: `0 0 8px ${agent.color}` }}>{agent.icon}</span>
                    <span className="font-mono font-bold" style={{ color: agent.color, fontSize: '11px', letterSpacing: '0.1em' }}>{agent.name}</span>
                  </div>
                  <div className="flex items-center gap-3 font-mono" style={{ fontSize: '9px' }}>
                    <span style={{ color: cmds > 0 ? agent.color : 'rgba(255,255,255,0.2)' }}>{cmds} cmds</span>
                    {feedback > 0 && <span style={{ color: '#b400ff' }}>▲{feedback}</span>}
                    {trained > 0  && <span style={{ color: '#ffb800', border: '1px solid #ffb80030', padding: '0 3px' }}>T{trained}</span>}
                  </div>
                </div>

                {/* Commands sparkline */}
                <div className="mb-1">
                  <div className="font-mono text-slate-700 mb-1" style={{ fontSize: '8px' }}>COMMANDO'S OVER TIJD</div>
                  <Sparkline points={cmdHistory} color={agent.color} width={220} height={32} />
                </div>

                {/* Feedback sparkline (only if has data) */}
                {feedback > 0 && (
                  <div className="mt-2">
                    <div className="font-mono text-slate-700 mb-1" style={{ fontSize: '8px' }}>FEEDBACK PAREN</div>
                    <Sparkline points={fbHistory} color="#b400ff" width={220} height={22} />
                  </div>
                )}
              </div>
            );
          })}
        </div>

        {/* Combined bar chart: current command counts */}
        <div style={{ border: '1px solid rgba(0,255,213,0.1)', background: 'rgba(0,0,0,0.2)', borderRadius: '5px', padding: '16px' }}>
          <div className="font-mono text-slate-600 tracking-widest mb-4" style={{ fontSize: '10px' }}>◈ HUIDIGE ACTIVITEIT — ALLE AGENTS</div>
          <div className="flex items-end gap-3" style={{ height: '80px' }}>
            {(() => {
              const maxVal = Math.max(1, ...AGENTS.map(a => latest[a.id]?.commands ?? 0));
              return AGENTS.map(agent => {
                const val = latest[agent.id]?.commands ?? 0;
                const pct = (val / maxVal) * 100;
                return (
                  <div key={agent.id} className="flex flex-col items-center gap-1 flex-1">
                    <div className="font-mono" style={{ color: agent.color, fontSize: '8px' }}>{val > 0 ? val : ''}</div>
                    <div className="w-full relative" style={{ height: '56px', display: 'flex', alignItems: 'flex-end' }}>
                      <div
                        className="w-full transition-all duration-700"
                        style={{
                          height: `${Math.max(2, pct)}%`,
                          background: `linear-gradient(to top, ${agent.color}55, ${agent.color})`,
                          boxShadow: val > 0 ? `0 0 8px ${agent.color}44` : 'none',
                          borderRadius: '2px 2px 0 0',
                          minHeight: '2px',
                        }}
                      />
                    </div>
                    <div className="font-mono" style={{ color: `${agent.color}99`, fontSize: '7px' }}>{agent.name.split('-')[0]}</div>
                  </div>
                );
              });
            })()}
          </div>
        </div>

        {/* History size indicator */}
        <div className="mt-3 flex items-center gap-2">
          <div className="flex gap-1">
            {Array.from({ length: MAX_POINTS }).map((_, i) => (
              <div key={i} style={{ width: '3px', height: '3px', borderRadius: '50%', background: i < history.length ? 'rgba(0,255,213,0.5)' : 'rgba(255,255,255,0.06)' }} />
            ))}
          </div>
          <span className="font-mono text-slate-700" style={{ fontSize: '9px' }}>{history.length}/{MAX_POINTS} samples</span>
        </div>

      </div>
    </div>
  );
}
