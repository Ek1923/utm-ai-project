import { useState, useEffect, useRef } from 'react';
import { NeuralNetView } from './NeuralNetView';
import { useStatsStream } from '../hooks/useStatsStream';

const LORA_AGENTS = ['jarvis', 'forge', 'atlas', 'spark', 'tactix', 'vega'];
const LORA_COLORS: Record<string, string> = {
  jarvis: '#c8a86b', forge: '#ff6b00', atlas: '#00b4ff',
  spark: '#ffb800', tactix: '#00ff9d', vega: '#ff2d55',
};
const AGENT_COLORS: Record<string, string> = {
  ...LORA_COLORS, apex1: '#00ffd5', apex2: '#b400ff', nexus_ui: '#7700ff',
};

interface DatasetInfo  { count: number; files: string[] }
export interface TrainingMetrics {
  step: number; max_steps: number; loss: number; epoch: number; elapsed: number;
}

interface NeuralOverlayProps { onClose: () => void }

export function NeuralOverlay({ onClose }: NeuralOverlayProps) {
  const [activeAgents,    setActiveAgents]    = useState<string[]>([]);
  const [datasets,        setDatasets]        = useState<Record<string, DatasetInfo>>({});
  const [trainingMetrics, setTrainingMetrics] = useState<Record<string, TrainingMetrics>>({});
  const streamAborts = useRef<Map<string, AbortController>>(new Map());
  const stream = useStatsStream();

  // Poll active training agents
  useEffect(() => {
    const poll = async () => {
      try {
        const r = await fetch('/api/training/active');
        const d = await r.json();
        setActiveAgents(d.active ?? []);
      } catch {}
    };
    poll();
    const iv = setInterval(poll, 1500);
    return () => clearInterval(iv);
  }, []);

  // Subscribe to live training_metrics SSE for each QLoRA training agent
  const loraTrainingKey = activeAgents.filter(a => LORA_AGENTS.includes(a)).join(',');
  useEffect(() => {
    const active = loraTrainingKey ? loraTrainingKey.split(',') : [];
    const aborts = streamAborts.current;

    // Close streams for agents that are no longer training
    for (const [id, ctrl] of aborts) {
      if (!active.includes(id)) { ctrl.abort(); aborts.delete(id); }
    }

    // Open streams for newly-training agents
    active.forEach(agentId => {
      if (aborts.has(agentId)) return;
      const ctrl = new AbortController();
      aborts.set(agentId, ctrl);

      (async () => {
        try {
          const res = await fetch(`/api/training/lora/${agentId}/stream`, { signal: ctrl.signal });
          if (!res.body) return;
          const reader = res.body.getReader();
          const dec    = new TextDecoder();
          while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            for (const line of dec.decode(value).split('\n')) {
              if (!line.startsWith('data: ')) continue;
              try {
                const ev = JSON.parse(line.slice(6));
                if (ev.type === 'training_metrics') {
                  const { agent: _a, ...m } = ev.data as TrainingMetrics & { agent: string };
                  setTrainingMetrics(p => ({ ...p, [agentId]: m }));
                }
                if (ev.type === 'training_done') {
                  // Keep metrics briefly so the panel can show final state
                  setTimeout(() => setTrainingMetrics(p => { const n = {...p}; delete n[agentId]; return n; }), 4000);
                  aborts.delete(agentId);
                }
              } catch {}
            }
          }
        } catch {}
      })();
    });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loraTrainingKey]);

  // Poll dataset sizes
  useEffect(() => {
    const poll = async () => {
      try {
        const r = await fetch('/api/training/datasets');
        const d = await r.json();
        setDatasets(d.datasets ?? {});
      } catch {}
    };
    poll();
    const iv = setInterval(poll, 5000);
    return () => clearInterval(iv);
  }, []);

  // Close on ESC
  useEffect(() => {
    const handler = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [onClose]);

  const stats        = stream?.stats ?? {};
  const isTraining   = activeAgents.length > 0;
  const totalDatasets = Object.entries(datasets)
    .filter(([k]) => k !== 'ALL_AGENTS')
    .reduce((s, [, v]) => s + v.count, 0);

  const loraTraining = activeAgents.filter(a => LORA_AGENTS.includes(a));

  return (
    <div
      className="fixed inset-0"
      style={{ zIndex: 50, background: '#00040c', display: 'flex', flexDirection: 'column' }}
    >
      {/* ── Top header bar ──────────────────────────────────────────────── */}
      <div
        className="flex items-center justify-between px-5 shrink-0"
        style={{
          height: '44px',
          borderBottom: '1px solid rgba(0,255,213,0.18)',
          background: 'rgba(0,4,12,0.95)',
          backdropFilter: 'blur(12px)',
        }}
      >
        {/* Left: title */}
        <div className="flex items-center gap-3">
          <div
            style={{
              width: '24px', height: '24px',
              clipPath: 'polygon(50% 0%, 93% 25%, 93% 75%, 50% 100%, 7% 75%, 7% 25%)',
              background: 'linear-gradient(135deg, #00ffd5, #0044ff)',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              fontSize: '10px', color: '#000', fontWeight: 900,
            }}
          >◉</div>
          <div>
            <div className="font-mono font-bold tracking-[0.25em]" style={{ color: '#00ffd5', fontSize: '12px', textShadow: '0 0 10px #00ffd5' }}>
              NEURAL TOPOLOGY
            </div>
            <div className="font-mono text-slate-600" style={{ fontSize: '9px', letterSpacing: '0.15em' }}>
              PROJECT NEXUS · 9 AGENTS · REAL-TIME
            </div>
          </div>

          {/* LIVE badge */}
          <div className="flex items-center gap-1.5 px-2 py-0.5 ml-3" style={{ border: '1px solid rgba(0,255,157,0.3)', background: 'rgba(0,255,157,0.05)' }}>
            <div className="w-1.5 h-1.5 rounded-full animate-pulse" style={{ background: '#00ff9d', boxShadow: '0 0 6px #00ff9d' }} />
            <span className="font-mono font-bold" style={{ fontSize: '8px', color: '#00ff9d', letterSpacing: '0.15em' }}>LIVE</span>
          </div>
        </div>

        {/* Center: training status */}
        <div className="flex items-center gap-3">
          {isTraining ? (
            loraTraining.map(agentId => (
              <div
                key={agentId}
                className="flex items-center gap-2 px-3 py-1"
                style={{
                  border: `1px solid ${LORA_COLORS[agentId] ?? '#00ffd5'}55`,
                  background: `${LORA_COLORS[agentId] ?? '#00ffd5'}0a`,
                }}
              >
                <div className="w-1.5 h-1.5 rounded-full" style={{ background: LORA_COLORS[agentId] ?? '#00ffd5', boxShadow: `0 0 8px ${LORA_COLORS[agentId] ?? '#00ffd5'}`, animation: 'pulse 0.7s infinite' }} />
                <span className="font-mono font-bold" style={{ fontSize: '9px', color: LORA_COLORS[agentId] ?? '#00ffd5' }}>
                  {agentId.toUpperCase()} QLoRA
                </span>
              </div>
            ))
          ) : (
            <span className="font-mono text-slate-600" style={{ fontSize: '9px', letterSpacing: '0.12em' }}>NO ACTIVE TRAINING</span>
          )}
        </div>

        {/* Right: dataset totals + close */}
        <div className="flex items-center gap-4">
          <div className="flex items-center gap-3 font-mono" style={{ fontSize: '10px' }}>
            <span style={{ color: 'rgba(255,255,255,0.25)' }}>DATASETS</span>
            <span style={{ color: '#ffb800', fontWeight: 700, textShadow: '0 0 8px #ffb800' }}>{totalDatasets.toLocaleString()}</span>
            <span style={{ color: 'rgba(255,255,255,0.18)' }}>voorbeelden</span>
          </div>
          <button
            onClick={onClose}
            className="font-mono font-bold"
            style={{
              width: '28px', height: '28px',
              border: '1px solid rgba(255,255,255,0.12)',
              color: 'rgba(255,255,255,0.4)',
              background: 'transparent',
              fontSize: '14px',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              cursor: 'pointer',
              transition: 'all 0.15s',
            }}
            onMouseEnter={e => { e.currentTarget.style.background = 'rgba(255,45,85,0.15)'; e.currentTarget.style.color = '#ff2d55'; e.currentTarget.style.borderColor = '#ff2d5544'; }}
            onMouseLeave={e => { e.currentTarget.style.background = 'transparent'; e.currentTarget.style.color = 'rgba(255,255,255,0.4)'; e.currentTarget.style.borderColor = 'rgba(255,255,255,0.12)'; }}
          >
            ✕
          </button>
        </div>
      </div>

      {/* ── Main area: 3D scene + right panel ──────────────────────────── */}
      <div className="flex flex-1 overflow-hidden">

        {/* 3D Neural Net — takes up main space */}
        <div className="flex-1 relative" style={{ minWidth: 0 }}>
          <NeuralNetView activeAgents={activeAgents} trainingAgents={loraTraining} trainingMetrics={trainingMetrics} />
        </div>

        {/* ── Right data panel ─────────────────────────────────────────── */}
        <div
          className="flex flex-col shrink-0 overflow-y-auto"
          style={{
            width: '260px',
            borderLeft: '1px solid rgba(0,255,213,0.1)',
            background: 'rgba(0,4,12,0.92)',
            backdropFilter: 'blur(12px)',
          }}
        >

          {/* ── PyTorch Training Section ───────────────────────────────── */}
          <div style={{ borderBottom: '1px solid rgba(255,255,255,0.06)', padding: '12px 14px' }}>
            <div className="font-mono font-bold tracking-widest mb-3" style={{ fontSize: '9px', color: 'rgba(255,255,255,0.35)', letterSpacing: '0.2em' }}>
              ▶ PYTORCH TRAINING
            </div>

            {activeAgents.length === 0 ? (
              <div className="font-mono text-slate-700" style={{ fontSize: '10px' }}>
                Geen training actief.<br />
                <span style={{ color: 'rgba(255,255,255,0.2)', fontSize: '9px' }}>
                  Start via ForgeLab → ▶ TRAIN
                </span>
              </div>
            ) : (
              <div className="flex flex-col gap-2">
                {activeAgents.map(agentId => {
                  const color = AGENT_COLORS[agentId] ?? '#00ffd5';
                  const isLora = LORA_AGENTS.includes(agentId);
                  return (
                    <div
                      key={agentId}
                      style={{
                        border: `1px solid ${color}33`,
                        background: `${color}08`,
                        padding: '8px 10px',
                      }}
                    >
                      <div className="flex items-center gap-2 mb-1.5">
                        <div className="w-1.5 h-1.5 rounded-full shrink-0" style={{ background: color, boxShadow: `0 0 8px ${color}`, animation: 'pulse 0.7s infinite' }} />
                        <span className="font-mono font-bold" style={{ color, fontSize: '11px' }}>{agentId.toUpperCase()}</span>
                        <span className="font-mono" style={{ fontSize: '8px', color: `${color}99`, border: `1px solid ${color}33`, padding: '0 4px' }}>
                          {isLora ? 'QLoRA' : 'MODELFILE'}
                        </span>
                      </div>
                      {isLora && (
                        <div className="font-mono text-slate-600" style={{ fontSize: '9px', lineHeight: 1.6 }}>
                          <div>Phi-3.5-mini · 4-bit NF4</div>
                          <div style={{ color: 'rgba(255,255,255,0.2)' }}>Live metrics → ForgeLab</div>
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          {/* ── PyTorch data uitleg ────────────────────────────────────── */}
          <div style={{ borderBottom: '1px solid rgba(255,255,255,0.06)', padding: '12px 14px' }}>
            <div className="font-mono font-bold tracking-widest mb-2" style={{ fontSize: '9px', color: 'rgba(255,255,255,0.35)', letterSpacing: '0.2em' }}>
              ◎ WAAR DATA VOLGEN
            </div>
            <div className="flex flex-col gap-2">
              {[
                { label: 'LIVE METRICS',  value: 'ForgeLab → ▶ TRAIN',  color: '#ff6b00', note: 'loss · epoch · progress' },
                { label: 'TRAININGSDATA', value: 'data/agents/<agent>/', color: '#00b4ff', note: '.jsonl bestanden' },
                { label: 'MODEL OUTPUT',  value: 'training/lora/output/', color: '#c8a86b', note: 'LoRA adapter weights' },
                { label: 'GGUF MODEL',    value: 'training/lora/gguf/',   color: '#00ff9d', note: 'Ollama-ready model' },
              ].map(r => (
                <div key={r.label} style={{ padding: '6px 8px', background: 'rgba(255,255,255,0.02)', border: '1px solid rgba(255,255,255,0.04)' }}>
                  <div className="flex items-center justify-between mb-0.5">
                    <span className="font-mono" style={{ fontSize: '8px', color: 'rgba(255,255,255,0.25)', letterSpacing: '0.1em' }}>{r.label}</span>
                  </div>
                  <div className="font-mono font-bold" style={{ color: r.color, fontSize: '9px' }}>{r.value}</div>
                  <div className="font-mono" style={{ color: 'rgba(255,255,255,0.2)', fontSize: '8px' }}>{r.note}</div>
                </div>
              ))}
            </div>
          </div>

          {/* ── Dataset per agent ─────────────────────────────────────── */}
          <div style={{ borderBottom: '1px solid rgba(255,255,255,0.06)', padding: '12px 14px' }}>
            <div className="font-mono font-bold tracking-widest mb-2" style={{ fontSize: '9px', color: 'rgba(255,255,255,0.35)', letterSpacing: '0.2em' }}>
              ⬡ DATASET OVERZICHT
            </div>
            <div className="flex flex-col gap-1">
              {Object.entries(datasets)
                .filter(([k]) => k !== 'ALL_AGENTS')
                .map(([agentId, ds]) => {
                  const color  = AGENT_COLORS[agentId] ?? '#ffffff';
                  const maxCount = Math.max(...Object.entries(datasets).filter(([k]) => k !== 'ALL_AGENTS').map(([, v]) => v.count), 1);
                  const pct = Math.round((ds.count / maxCount) * 100);
                  return (
                    <div key={agentId} className="flex flex-col gap-0.5">
                      <div className="flex items-center justify-between font-mono" style={{ fontSize: '9px' }}>
                        <span style={{ color: `${color}cc`, fontWeight: 700 }}>{agentId.toUpperCase()}</span>
                        <span style={{ color: 'rgba(255,255,255,0.35)' }}>{ds.count.toLocaleString()}</span>
                      </div>
                      <div style={{ height: '2px', background: 'rgba(255,255,255,0.05)', borderRadius: '3px', overflow: 'hidden' }}>
                        <div style={{ height: '100%', width: `${pct}%`, background: color, boxShadow: `0 0 4px ${color}`, borderRadius: '3px', transition: 'width 0.6s ease' }} />
                      </div>
                    </div>
                  );
                })}
              {datasets['ALL_AGENTS'] && (
                <div className="font-mono mt-2 px-2 py-1" style={{ background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.06)', fontSize: '9px' }}>
                  <span style={{ color: 'rgba(255,255,255,0.3)' }}>ALL_AGENTS </span>
                  <span style={{ color: '#00ffd5', fontWeight: 700 }}>{datasets['ALL_AGENTS'].count}</span>
                  <span style={{ color: 'rgba(255,255,255,0.2)' }}> gedeeld</span>
                </div>
              )}
            </div>
          </div>

          {/* ── Agent stats ───────────────────────────────────────────── */}
          <div style={{ padding: '12px 14px' }}>
            <div className="font-mono font-bold tracking-widest mb-2" style={{ fontSize: '9px', color: 'rgba(255,255,255,0.35)', letterSpacing: '0.2em' }}>
              ✦ AGENT STATS
            </div>
            <div className="flex flex-col gap-1.5">
              {Object.entries(stats).map(([agentId, s]) => {
                const color = AGENT_COLORS[agentId] ?? '#ffffff';
                const total = s.commands + s.trained * 4 + (s.trainRuns ?? 0) * 10 + Math.floor((s.collectedPairs ?? 0) / 5);
                return (
                  <div key={agentId} style={{ padding: '5px 8px', background: `${color}06`, border: `1px solid ${color}18` }}>
                    <div className="flex items-center justify-between font-mono mb-0.5" style={{ fontSize: '9px' }}>
                      <span style={{ color, fontWeight: 700 }}>{agentId.toUpperCase()}</span>
                      <span style={{ color: 'rgba(255,255,255,0.2)' }}>{total}p</span>
                    </div>
                    <div className="flex gap-2 font-mono" style={{ fontSize: '8px', color: 'rgba(255,255,255,0.3)' }}>
                      <span>cmd <span style={{ color }}>{s.commands}</span></span>
                      <span>fb <span style={{ color }}>{s.feedback}</span></span>
                      {(s.trainRuns ?? 0) > 0 && <span>train <span style={{ color: '#ff6b00' }}>{s.trainRuns}</span></span>}
                      {(s.collectedPairs ?? 0) > 0 && <span>data <span style={{ color: '#00b4ff' }}>{s.collectedPairs}</span></span>}
                    </div>
                  </div>
                );
              })}
              {Object.keys(stats).length === 0 && (
                <div className="font-mono text-slate-700" style={{ fontSize: '9px' }}>Nog geen interacties.</div>
              )}
            </div>
          </div>

        </div>
      </div>
    </div>
  );
}