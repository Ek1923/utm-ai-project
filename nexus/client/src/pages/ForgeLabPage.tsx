import { useState, useRef, useCallback, useEffect } from 'react';

// FORGE uses deepseek-coder as its dedicated training base model
const FORGE_MODEL = { name: 'deepseek-coder', params: 6.7, label: 'DeepSeek-Coder 6.7B' };

const LORA_AGENTS = [
  { id: 'forge',  name: 'FORGE',  color: '#ff6b00', icon: '</>',  role: 'Developer / Code AI',       canCollect: true,  primary: true  },
  { id: 'atlas',  name: 'ATLAS',  color: '#00b4ff', icon: '◎',   role: 'Knowledge / Research',      canCollect: true,  primary: false },
  { id: 'spark',  name: 'SPARK',  color: '#ffb800', icon: '✦',   role: 'Creative / Ideas',          canCollect: true,  primary: false },
  { id: 'tactix', name: 'TACTIX', color: '#00ff9d', icon: '⬡',   role: 'Strategy / Planning',       canCollect: true,  primary: false },
  { id: 'vega',   name: 'VEGA',   color: '#ff2d55', icon: '★',   role: 'Vice-General / Generalist', canCollect: true,  primary: false },
  { id: 'optic',  name: 'OPTIC',  color: '#a78bfa', icon: '◉',   role: 'Data Analysis / ML',        canCollect: true,  primary: false },
  { id: 'jarvis', name: 'JARVIS', color: '#c8a86b', icon: '◈',   role: 'Project Executor',          canCollect: true,  primary: false },
  { id: 'apex1',  name: 'APEX-1', color: '#00ffd5', icon: '⬟',   role: 'General Commander',         canCollect: true,  primary: false },
  { id: 'apex2',  name: 'APEX-2', color: '#b400ff', icon: '⬟',   role: 'Strategic General',         canCollect: true,  primary: false },
] as const;

const MODELFILE_AGENTS = [
  { id: 'nexus_ui', name: 'OPTIC (legacy)', color: '#7700ff', icon: '⊕', canCollect: false },
] as const;

type AgentStatus = 'idle' | 'training' | 'collecting' | 'done' | 'error';
interface AgentLog  { lines: string[]; status: AgentStatus }
interface Metrics   { step: number; max_steps: number; loss: number; epoch: number; elapsed: number }
interface Dataset   { count: number }

interface SourceStat { done: number; pairs: number; errors: number }
interface CollectState {
  source:  string;
  topic:   string;
  status:  string;
  total:   number;
  sources: Record<string, SourceStat>;
}

const SOURCE_ICONS: Record<string, string> = {
  'Wikipedia':    '📖',
  'Stack Overflow': '💬',
  'Dev.to':       '✍',
  'GitHub README':'🐙',
  'arXiv':        '🔬',
  'Hacker News':  '🔶',
};
const SOURCE_COLORS: Record<string, string> = {
  'Wikipedia':    '#a78bfa',
  'Stack Overflow': '#f97316',
  'Dev.to':       '#22d3ee',
  'GitHub README':'#4ade80',
  'arXiv':        '#f43f5e',
  'Hacker News':  '#fb923c',
};

function fmtElapsed(s: number) {
  const m = Math.floor(s / 60);
  return m > 0 ? `${m}m ${s % 60}s` : `${s}s`;
}
function lossColor(l: number) {
  return l <= 0 ? '#555' : l < 1.2 ? '#00ff9d' : l < 2.0 ? '#ffb800' : '#ff2d55';
}
function fmtParams(b: number) {
  if (b >= 1000) return `${(b / 1000).toFixed(1)}T`;
  return `${b.toFixed(1)}B`;
}

export function ForgeLabPage() {
  const [logs,        setLogs]        = useState<Record<string, AgentLog>>({});
  const [metrics,     setMetrics]     = useState<Record<string, Metrics>>({});
  const [datasets,    setDatasets]    = useState<Record<string, Dataset>>({});
  const [logOpen,     setLogOpen]     = useState<string | null>(null);
  const [forgeParams, setForgeParams] = useState(FORGE_MODEL.params);
  const [collectState, setCollectState] = useState<Record<string, CollectState>>({});

  const abortRefs  = useRef<Record<string, AbortController>>({});
  const logRef     = useRef<HTMLDivElement | null>(null);
  const stickRef   = useRef(true);

  useEffect(() => {
    const el = logRef.current;
    if (el && stickRef.current) el.scrollTop = el.scrollHeight;
  }, [logs]);

  useEffect(() => {
    const load = () => fetch('/api/training/datasets').then(r => r.json())
      .then(d => setDatasets(d.datasets ?? {})).catch(() => {});
    load();
    const iv = setInterval(load, 6000);
    return () => clearInterval(iv);
  }, []);

  useEffect(() => {
    fetch('/api/training/active').then(r => r.json()).then(d => {
      (d.active ?? []).forEach((id: string) => runStream(id, `/api/training/lora/${id}/stream`, 'training', '↺ Reconnecting...', 'GET'));
      (d.collecting ?? []).forEach((id: string) => setLogs(p => ({ ...p, [id]: { lines: ['⬇ Collectie loopt...'], status: 'collecting' } })));
    }).catch(() => {});
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Animate forge params when training
  useEffect(() => {
    const forgeLog = logs['forge'];
    if (!forgeLog || forgeLog.status !== 'training') return;
    const m = metrics['forge'];
    if (!m || !m.max_steps) return;
    // LoRA rank 8 adds ~16M trainable params — animate growing during training
    const loraParams = 0.016; // 16M = 0.016B
    const progress = m.step / m.max_steps;
    setForgeParams(FORGE_MODEL.params + loraParams * progress);
  }, [metrics, logs]);

  const runStream = useCallback(async (agentId: string, url: string, initStatus: AgentStatus, initMsg: string, method: 'POST' | 'GET' = 'POST') => {
    abortRefs.current[agentId]?.abort();
    const ctrl = new AbortController();
    abortRefs.current[agentId] = ctrl;

    setLogs(p => ({ ...p, [agentId]: { lines: [initMsg], status: initStatus } }));
    setMetrics(p => { const n = { ...p }; delete n[agentId]; return n; });

    const add = (line: string) => setLogs(p => ({
      ...p, [agentId]: { ...p[agentId], lines: [...(p[agentId]?.lines ?? []), line] },
    }));

    let trainingStepsComplete = false;

    try {
      const res = await fetch(url, { method, signal: ctrl.signal });
      if (!res.body) throw new Error('No stream');
      const reader = res.body.getReader();
      const dec = new TextDecoder();
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        for (const line of dec.decode(value).split('\n')) {
          if (!line.startsWith('data: ')) continue;
          try {
            const ev = JSON.parse(line.slice(6));
            if (ev.type === 'training_log') add(ev.data.message);
            if (ev.type === 'collect_progress') {
              const d = ev.data as CollectState & { agent?: string };
              const id = d.agent ?? agentId;
              setCollectState(p => ({ ...p, [id]: { source: d.source ?? '', topic: d.topic ?? '', status: d.status ?? '', total: d.total ?? 0, sources: d.sources ?? {} } }));
            }
            if (ev.type === 'training_metrics') {
              const { agent: _a, ...m } = ev.data as { agent: string } & Metrics;
              if (m.max_steps > 0 && m.step >= m.max_steps) trainingStepsComplete = true;
              setMetrics(p => ({ ...p, [agentId]: m }));
            }
            if (ev.type === 'training_done') {
              setMetrics(p => { const n = { ...p }; delete n[agentId]; return n; });
              const finalStatus = (ev.data.success || trainingStepsComplete) ? 'done' : 'error';
              setLogs(p => ({ ...p, [agentId]: { ...p[agentId], status: finalStatus } }));
              if (agentId === 'forge' && (ev.data.success || trainingStepsComplete)) {
                setForgeParams(FORGE_MODEL.params + 0.016);
              }
              fetch('/api/training/datasets').then(r => r.json()).then(d => setDatasets(d.datasets ?? {})).catch(() => {});
            }
          } catch { /* skip */ }
        }
      }
      if (trainingStepsComplete) {
        setMetrics(p => { const n = { ...p }; delete n[agentId]; return n; });
        setLogs(p => {
          const cur = p[agentId];
          if (cur && (cur.status === 'training' || cur.status === 'collecting'))
            return { ...p, [agentId]: { ...cur, status: 'done' } };
          return p;
        });
      }
    } catch (err) {
      if ((err as Error).name !== 'AbortError') {
        add(`✗ ${(err as Error).message}`);
        setLogs(p => ({ ...p, [agentId]: { ...p[agentId], status: 'error' } }));
      }
    }
  }, []);

  const trainLora   = (id: string) => runStream(id, `/api/training/lora/${id}`,    'training',   '▶ QLoRA starten...');
  const trainFile   = (id: string) => runStream(id, `/api/training/agent/${id}`,   'training',   '▶ Modelfile bouwen...');
  const collectData = (id: string) => runStream(id, `/api/training/collect/${id}`, 'collecting', '⬇ Data ophalen...');

  const stopAgent = useCallback(async (id: string) => {
    abortRefs.current[id]?.abort();
    try { await fetch(`/api/training/lora/${id}/stop`, { method: 'POST' }); } catch {}
    setLogs(p => ({ ...p, [id]: { ...p[id], status: 'idle', lines: [...(p[id]?.lines ?? []), '⛔ Gestopt door gebruiker'] } }));
    setMetrics(p => { const n = { ...p }; delete n[id]; return n; });
  }, []);

  const forgeLog    = logs['forge'];
  const forgeStatus = forgeLog?.status ?? 'idle';
  const forgeMetric = metrics['forge'];
  const forgeBusy   = forgeStatus === 'training' || forgeStatus === 'collecting';
  const forgeDs     = datasets['forge'];

  function AgentRow({ id, name, color, icon, canCollect, isLora }: {
    id: string; name: string; color: string; icon: string; canCollect: boolean; isLora: boolean;
  }) {
    const log      = logs[id];
    const m        = metrics[id];
    const status   = log?.status ?? 'idle';
    const isBusy   = status === 'training' || status === 'collecting';
    const ds       = datasets[id];
    const progress = m?.max_steps ? m.step / m.max_steps : null;
    const isOpen   = logOpen === id;
    const cs       = collectState[id];

    const statusColor = status === 'done'       ? '#00ff9d'
                      : status === 'error'      ? '#ff2d55'
                      : status === 'collecting' ? '#00b4ff'
                      : isBusy                  ? color
                      : 'rgba(255,255,255,0.08)';

    return (
      <div style={{
        borderBottom: '1px solid rgba(255,255,255,0.04)',
        background: isBusy ? `${color}05` : 'transparent',
        transition: 'background 0.3s',
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '12px', padding: '9px 16px' }}>
          <div style={{ width: 5, height: 5, borderRadius: '50%', flexShrink: 0, background: statusColor, boxShadow: isBusy ? `0 0 6px ${statusColor}` : 'none', animation: isBusy ? 'pulse 1.2s ease-in-out infinite' : 'none' }} />
          <span className="font-mono font-bold" style={{ color, fontSize: '10px', width: '22px', textAlign: 'center', flexShrink: 0 }}>{icon}</span>
          <span className="font-mono font-bold" style={{ color, fontSize: '10px', letterSpacing: '0.1em', width: '72px', flexShrink: 0 }}>{name}</span>
          <span className="font-mono" style={{ fontSize: '9px', color: ds?.count ? `${color}80` : 'rgba(255,255,255,0.12)', width: '76px', flexShrink: 0 }}>
            {ds?.count ? `${ds.count} pairs` : '—'}
          </span>
          <div style={{ flex: 1, height: '2px', background: 'rgba(255,255,255,0.04)', borderRadius: '4px', overflow: 'hidden' }}>
            {isBusy && (progress !== null
              ? <div style={{ height: '100%', width: `${Math.round(progress * 100)}%`, background: color, boxShadow: `0 0 4px ${color}`, transition: 'width 0.4s ease', borderRadius: '4px' }} />
              : <div style={{ height: '100%', width: '30%', background: color, animation: 'scan-bar 1.8s ease-in-out infinite', borderRadius: '4px' }} />)}
            {status === 'done'  && <div style={{ height: '100%', width: '100%', background: '#00ff9d' }} />}
            {status === 'error' && <div style={{ height: '100%', width: '100%', background: '#ff2d55' }} />}
          </div>
          {m && (
            <div style={{ display: 'flex', gap: '10px', flexShrink: 0 }}>
              <span className="font-mono" style={{ fontSize: '10px', color: lossColor(m.loss), fontWeight: 700 }}>{m.loss.toFixed(3)}</span>
              <span className="font-mono" style={{ fontSize: '9px', color: 'rgba(255,255,255,0.28)' }}>{m.step}/{m.max_steps}</span>
              <span className="font-mono" style={{ fontSize: '9px', color: 'rgba(255,255,255,0.2)' }}>{fmtElapsed(m.elapsed)}</span>
            </div>
          )}
          {!m && status !== 'idle' && (
            <span className="font-mono" style={{ fontSize: '9px', color: statusColor, letterSpacing: '0.1em', flexShrink: 0 }}>
              {status === 'done' ? '✓ KLAAR' : status === 'error' ? '✗ FOUT' : status === 'training' ? 'TRAINING' : 'COLLECT'}
            </span>
          )}
          <div style={{ display: 'flex', gap: '5px', flexShrink: 0 }}>
            {isBusy ? (
              <button onClick={() => stopAgent(id)} className="font-mono" style={{ padding: '2px 9px', fontSize: '8px', border: '1px solid #ff2d55', color: '#ff2d55', background: 'rgba(255,45,85,0.1)', cursor: 'pointer', fontWeight: 700, letterSpacing: '0.05em' }}
                onMouseEnter={e => e.currentTarget.style.background = 'rgba(255,45,85,0.2)'}
                onMouseLeave={e => e.currentTarget.style.background = 'rgba(255,45,85,0.1)'}>
                STOP
              </button>
            ) : (
              <>
                {canCollect && <button onClick={() => collectData(id)} className="font-mono" style={{ padding: '2px 7px', fontSize: '8px', border: '1px solid rgba(0,180,255,0.25)', color: '#00b4ff', background: 'transparent', cursor: 'pointer' }}
                  onMouseEnter={e => e.currentTarget.style.background = 'rgba(0,180,255,0.08)'}
                  onMouseLeave={e => e.currentTarget.style.background = 'transparent'}>DATA</button>}
                <button onClick={() => isLora ? trainLora(id) : trainFile(id)} className="font-mono" style={{ padding: '2px 7px', fontSize: '8px', border: `1px solid ${color}35`, color, background: 'transparent', cursor: 'pointer' }}
                  onMouseEnter={e => e.currentTarget.style.background = `${color}0e`}
                  onMouseLeave={e => e.currentTarget.style.background = 'transparent'}>TRAIN</button>
              </>
            )}
            {(log?.lines?.length ?? 0) > 0 && (
              <button onClick={() => setLogOpen(isOpen ? null : id)} className="font-mono" style={{ padding: '2px 5px', fontSize: '10px', color: isOpen ? color : 'rgba(255,255,255,0.18)', background: 'transparent', border: 'none', cursor: 'pointer' }}>
                {isOpen ? '▲' : '▼'}
              </button>
            )}
          </div>
        </div>
        {/* Mini collect panel voor niet-forge agents */}
        {status === 'collecting' && cs && cs.source && (
          <div style={{ padding: '5px 16px 5px 52px', background: 'rgba(0,0,0,0.25)', borderTop: `1px solid ${color}10`, display: 'flex', alignItems: 'center', gap: '8px' }}>
            <span style={{ fontSize: '11px' }}>{SOURCE_ICONS[cs.source] ?? '🔍'}</span>
            <span className="font-mono" style={{ fontSize: '8px', color: SOURCE_COLORS[cs.source] ?? color }}>{cs.source}</span>
            <span className="font-mono" style={{ fontSize: '8px', color: 'rgba(255,255,255,0.3)', flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{cs.topic}</span>
            <span className="font-mono" style={{ fontSize: '9px', color, fontWeight: 700 }}>{cs.total} paren</span>
          </div>
        )}

        {isOpen && (log?.lines?.length ?? 0) > 0 && (
          <div ref={logRef}
            onScroll={e => { const el = e.currentTarget; stickRef.current = el.scrollHeight - el.scrollTop - el.clientHeight < 60; }}
            style={{ maxHeight: '160px', overflowY: 'auto', padding: '6px 16px 6px 52px', background: 'rgba(0,0,0,0.35)', borderTop: `1px solid ${color}12` }}>
            {log.lines.map((line, i) => {
              const l = line.toLowerCase();
              const c = line.includes('✓') || l.includes('complete') || l.includes('klaar') ? '#00ff9d'
                      : line.includes('✗') || l.includes('fail') || l.includes('error')    ? '#ff2d55'
                      : line.includes('[STAGE]') ? color
                      : line.includes('[warn]')  ? 'rgba(255,184,0,0.45)'
                      : 'rgba(255,255,255,0.32)';
              return <div key={i} className="font-mono" style={{ fontSize: '9px', lineHeight: '1.7', color: c }}>{line}</div>;
            })}
          </div>
        )}
      </div>
    );
  }

  const anyBusy = Object.values(logs).some(l => l.status === 'training' || l.status === 'collecting');
  const forgeProgress = forgeMetric?.max_steps ? forgeMetric.step / forgeMetric.max_steps : 0;

  return (
    <div className="h-full overflow-y-auto" style={{ background: 'var(--bg-panel)' }}>

      {/* ── FORGE PRIMARY SECTION ─────────────────────────────────────────── */}
      <div style={{
        margin: '14px 14px 0',
        border: '1px solid rgba(255,107,0,0.25)',
        background: 'linear-gradient(135deg, rgba(255,107,0,0.05) 0%, rgba(0,0,0,0) 60%)',
        borderRadius: '2px',
      }}>
        {/* Header */}
        <div style={{ padding: '12px 16px 10px', borderBottom: '1px solid rgba(255,107,0,0.12)', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
            <span className="font-mono font-bold" style={{ color: '#ff6b00', fontSize: '12px', letterSpacing: '0.15em' }}>
              &lt;/&gt; FORGE
            </span>
            <div style={{ width: '1px', height: '14px', background: 'rgba(255,107,0,0.3)' }} />
            <span className="font-mono" style={{ fontSize: '9px', color: 'rgba(255,255,255,0.35)', letterSpacing: '0.1em' }}>
              {FORGE_MODEL.label} · QLoRA · 4-bit NF4
            </span>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            {forgeBusy && <div style={{ width: 5, height: 5, borderRadius: '50%', background: '#ff6b00', animation: 'pulse 1s infinite', boxShadow: '0 0 6px #ff6b00' }} />}
            <span className="font-mono" style={{ fontSize: '8px', color: forgeBusy ? '#ff6b00' : 'rgba(255,255,255,0.2)', letterSpacing: '0.1em' }}>
              {forgeBusy ? 'TRAINING ACTIEF' : forgeStatus === 'done' ? '✓ KLAAR' : 'STANDBY'}
            </span>
          </div>
        </div>

        {/* Param counter + stats */}
        <div style={{ padding: '10px 16px', display: 'grid', gridTemplateColumns: '1fr 1fr 1fr 1fr', gap: '12px' }}>
          {[
            { label: 'PARAMETERS', value: fmtParams(forgeParams), color: '#ff6b00', glow: forgeBusy },
            { label: 'BASE MODEL', value: fmtParams(FORGE_MODEL.params), color: 'rgba(255,255,255,0.5)', glow: false },
            { label: 'DATASET', value: forgeDs?.count ? `${forgeDs.count} pairs` : '—', color: '#00b4ff', glow: false },
            { label: 'LOSS', value: forgeMetric ? forgeMetric.loss.toFixed(3) : '—', color: forgeMetric ? lossColor(forgeMetric.loss) : 'rgba(255,255,255,0.3)', glow: forgeBusy },
          ].map(s => (
            <div key={s.label} style={{ padding: '8px 10px', background: 'rgba(0,0,0,0.25)', border: '1px solid rgba(255,255,255,0.06)' }}>
              <div className="font-mono" style={{ fontSize: '7px', color: 'rgba(255,255,255,0.3)', letterSpacing: '0.15em', marginBottom: '4px' }}>{s.label}</div>
              <div className="font-mono font-bold" style={{ fontSize: '15px', color: s.color, letterSpacing: '0.05em', textShadow: s.glow ? `0 0 12px ${s.color}` : 'none', transition: 'all 0.3s' }}>{s.value}</div>
            </div>
          ))}
        </div>

        {/* Progress bar */}
        <div style={{ padding: '0 16px 12px' }}>
          <div style={{ height: '3px', background: 'rgba(255,255,255,0.04)', borderRadius: '4px', overflow: 'hidden' }}>
            {forgeBusy && forgeProgress > 0 && (
              <div style={{ height: '100%', width: `${Math.round(forgeProgress * 100)}%`, background: 'linear-gradient(90deg, #ff6b00, #ffb800)', boxShadow: '0 0 8px #ff6b00', transition: 'width 0.5s ease', borderRadius: '4px' }} />
            )}
            {!forgeBusy && forgeProgress === 0 && (
              <div style={{ height: '100%', width: '0%', background: '#ff6b00' }} />
            )}
            {forgeStatus === 'done' && <div style={{ height: '100%', width: '100%', background: 'linear-gradient(90deg, #00ff9d, #00b4ff)' }} />}
          </div>
          {forgeMetric && (
            <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: '4px' }}>
              <span className="font-mono" style={{ fontSize: '8px', color: 'rgba(255,255,255,0.25)' }}>
                STAP {forgeMetric.step} / {forgeMetric.max_steps} · EPOCH {forgeMetric.epoch}
              </span>
              <span className="font-mono" style={{ fontSize: '8px', color: 'rgba(255,255,255,0.25)' }}>
                {fmtElapsed(forgeMetric.elapsed)}
              </span>
            </div>
          )}
        </div>

        {/* ── Live collection panel — shown during data collection ── */}
        {forgeStatus === 'collecting' && collectState['forge'] && (() => {
          const cs = collectState['forge'];
          const totalPairs = cs.total;
          const sources = Object.entries(cs.sources);
          const maxPairs = Math.max(...sources.map(([, s]) => s.pairs), 1);
          return (
            <div style={{ margin: '0 16px 12px', border: '1px solid rgba(0,180,255,0.15)', background: 'rgba(0,0,0,0.3)' }}>
              {/* Header */}
              <div style={{ padding: '7px 12px', borderBottom: '1px solid rgba(0,180,255,0.1)', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                  <div style={{ width: 6, height: 6, borderRadius: '50%', background: '#00b4ff', animation: 'pulse 1s infinite', boxShadow: '0 0 6px #00b4ff' }} />
                  <span className="font-mono" style={{ fontSize: '9px', color: '#00b4ff', letterSpacing: '0.12em', fontWeight: 700 }}>LIVE DATA COLLECTIE</span>
                </div>
                <span className="font-mono" style={{ fontSize: '10px', color: '#00ff9d', fontWeight: 700 }}>{totalPairs} paren</span>
              </div>

              {/* Active fetch row */}
              {cs.source && cs.status !== 'done' && (
                <div style={{ padding: '6px 12px', borderBottom: '1px solid rgba(255,255,255,0.04)', display: 'flex', alignItems: 'center', gap: '8px', background: 'rgba(0,180,255,0.04)' }}>
                  <span style={{ fontSize: '12px' }}>{SOURCE_ICONS[cs.source] ?? '🔍'}</span>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div className="font-mono" style={{ fontSize: '9px', color: SOURCE_COLORS[cs.source] ?? '#00b4ff', letterSpacing: '0.08em', marginBottom: '1px' }}>{cs.source}</div>
                    <div className="font-mono" style={{ fontSize: '8px', color: 'rgba(255,255,255,0.45)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{cs.topic}</div>
                  </div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '5px' }}>
                    <div style={{ width: 4, height: 4, borderRadius: '50%', background: cs.status === 'generating' ? '#ffb800' : '#00b4ff', animation: 'pulse 0.8s infinite' }} />
                    <span className="font-mono" style={{ fontSize: '8px', color: cs.status === 'generating' ? '#ffb800' : '#00b4ff', letterSpacing: '0.08em' }}>
                      {cs.status === 'generating' ? 'GENEREREN' : cs.status === 'fetching' ? 'OPHALEN' : cs.status.toUpperCase()}
                    </span>
                  </div>
                </div>
              )}

              {/* Per-source breakdown */}
              {sources.length > 0 && (
                <div style={{ padding: '8px 12px', display: 'flex', flexDirection: 'column', gap: '5px' }}>
                  {sources.map(([src, stat]) => {
                    const color = SOURCE_COLORS[src] ?? '#888';
                    const barW  = maxPairs > 0 ? Math.round((stat.pairs / maxPairs) * 100) : 0;
                    return (
                      <div key={src} style={{ display: 'grid', gridTemplateColumns: '20px 1fr auto', gap: '6px', alignItems: 'center' }}>
                        <span style={{ fontSize: '11px', textAlign: 'center' }}>{SOURCE_ICONS[src] ?? '🔍'}</span>
                        <div>
                          <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '2px' }}>
                            <span className="font-mono" style={{ fontSize: '8px', color: 'rgba(255,255,255,0.4)', letterSpacing: '0.05em' }}>{src}</span>
                            <span className="font-mono" style={{ fontSize: '8px', color }}>
                              {stat.done} topics · {stat.pairs} paren{stat.errors > 0 ? ` · ${stat.errors}✗` : ''}
                            </span>
                          </div>
                          <div style={{ height: '3px', background: 'rgba(255,255,255,0.06)', borderRadius: '2px', overflow: 'hidden' }}>
                            <div style={{ height: '100%', width: `${barW}%`, background: color, boxShadow: `0 0 4px ${color}`, transition: 'width 0.4s ease', borderRadius: '2px' }} />
                          </div>
                        </div>
                        <span className="font-mono" style={{ fontSize: '9px', color, fontWeight: 700, minWidth: '28px', textAlign: 'right' }}>{stat.pairs}</span>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          );
        })()}

        {/* Log */}
        {forgeLog?.lines?.length > 0 && (
          <div>
            <button
              onClick={() => setLogOpen(logOpen === 'forge' ? null : 'forge')}
              style={{ width: '100%', padding: '6px 16px', background: 'rgba(0,0,0,0.2)', border: 'none', borderTop: '1px solid rgba(255,107,0,0.1)', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '6px' }}
            >
              <span className="font-mono" style={{ fontSize: '8px', color: 'rgba(255,255,255,0.25)', letterSpacing: '0.1em' }}>
                {logOpen === 'forge' ? '▲ VERBERG LOG' : '▼ TOON LOG'}
              </span>
              <span className="font-mono" style={{ fontSize: '8px', color: 'rgba(255,107,0,0.5)' }}>
                {forgeLog.lines.length} regels
              </span>
            </button>
            {logOpen === 'forge' && (
              <div ref={logRef}
                onScroll={e => { const el = e.currentTarget; stickRef.current = el.scrollHeight - el.scrollTop - el.clientHeight < 60; }}
                style={{ maxHeight: '180px', overflowY: 'auto', padding: '8px 16px', background: 'rgba(0,0,0,0.4)' }}>
                {forgeLog.lines.map((line, i) => {
                  const l = line.toLowerCase();
                  const c = line.includes('✓') || l.includes('complete') || l.includes('klaar') ? '#00ff9d'
                          : line.includes('✗') || l.includes('fail') || l.includes('error')    ? '#ff2d55'
                          : line.includes('[STAGE]') ? '#ff6b00'
                          : line.includes('[warn]')  ? '#ffb80070'
                          : 'rgba(255,255,255,0.3)';
                  return <div key={i} className="font-mono" style={{ fontSize: '9px', lineHeight: '1.7', color: c }}>{line}</div>;
                })}
              </div>
            )}
          </div>
        )}

        {/* Action buttons */}
        <div style={{ padding: '10px 16px 12px', display: 'flex', gap: '8px', borderTop: '1px solid rgba(255,107,0,0.08)' }}>
          {forgeBusy ? (
            <button onClick={() => stopAgent('forge')} className="font-mono" style={{ padding: '5px 16px', fontSize: '9px', border: '1px solid #ff2d55', color: '#ff2d55', background: 'rgba(255,45,85,0.08)', cursor: 'pointer', fontWeight: 700, letterSpacing: '0.08em' }}
              onMouseEnter={e => e.currentTarget.style.background = 'rgba(255,45,85,0.18)'}
              onMouseLeave={e => e.currentTarget.style.background = 'rgba(255,45,85,0.08)'}>
              ⛔ TRAINING STOPPEN
            </button>
          ) : (
            <>
              <button onClick={() => collectData('forge')} className="font-mono" style={{ padding: '5px 14px', fontSize: '9px', border: '1px solid rgba(0,180,255,0.3)', color: '#00b4ff', background: 'transparent', cursor: 'pointer', letterSpacing: '0.08em' }}
                onMouseEnter={e => e.currentTarget.style.background = 'rgba(0,180,255,0.08)'}
                onMouseLeave={e => e.currentTarget.style.background = 'transparent'}>
                ⬇ DATA VERZAMELEN
              </button>
              <button onClick={() => trainLora('forge')} className="font-mono font-bold" style={{ padding: '5px 16px', fontSize: '9px', border: '1px solid #ff6b00', color: '#ff6b00', background: 'rgba(255,107,0,0.08)', cursor: 'pointer', letterSpacing: '0.08em' }}
                onMouseEnter={e => { e.currentTarget.style.background = 'rgba(255,107,0,0.18)'; e.currentTarget.style.boxShadow = '0 0 12px rgba(255,107,0,0.3)'; }}
                onMouseLeave={e => { e.currentTarget.style.background = 'rgba(255,107,0,0.08)'; e.currentTarget.style.boxShadow = 'none'; }}>
                ▶ FORGE TRAINEN
              </button>
            </>
          )}
        </div>
      </div>

      {/* ── OVERIGE AGENTS ─────────────────────────────────────────────────── */}
      <div style={{ margin: '10px 14px 0', border: '1px solid rgba(255,255,255,0.06)', borderRadius: '2px' }}>
        <div style={{ padding: '8px 16px', borderBottom: '1px solid rgba(255,255,255,0.04)', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <span className="font-mono" style={{ fontSize: '8px', color: 'rgba(255,255,255,0.2)', letterSpacing: '0.15em' }}>OVERIGE AGENTS · PHI-3.5-MINI · QLORA</span>
          {anyBusy && !forgeBusy && <div style={{ display: 'flex', alignItems: 'center', gap: '5px' }}>
            <div style={{ width: 4, height: 4, borderRadius: '50%', background: '#00b4ff', animation: 'pulse 1s infinite' }} />
            <span className="font-mono" style={{ fontSize: '7px', color: '#00b4ff' }}>ACTIEF</span>
          </div>}
        </div>
        <div style={{ padding: '3px 16px 2px', borderBottom: '1px solid rgba(255,255,255,0.03)', display: 'grid', gridTemplateColumns: '11px 22px 72px 76px 1fr auto', gap: '12px', alignItems: 'center' }}>
          {['', '', 'AGENT', 'DATASET', 'VOORTGANG', 'ACTIES'].map((h, i) => (
            <span key={i} className="font-mono" style={{ fontSize: '6px', color: 'rgba(255,255,255,0.12)', letterSpacing: '0.15em' }}>{h}</span>
          ))}
        </div>
        {LORA_AGENTS.filter(a => !a.primary).map(a => <AgentRow key={a.id} {...a} isLora={true} />)}
      </div>

      {/* ── MODELFILE AGENTS ───────────────────────────────────────────────── */}
      <div style={{ margin: '10px 14px 14px', border: '1px solid rgba(255,255,255,0.06)', borderRadius: '2px' }}>
        <div style={{ padding: '8px 16px', borderBottom: '1px solid rgba(255,255,255,0.04)' }}>
          <span className="font-mono" style={{ fontSize: '8px', color: 'rgba(255,255,255,0.2)', letterSpacing: '0.15em' }}>SYSTEM AGENTS · MODELFILE · FEW-SHOT</span>
        </div>
        {MODELFILE_AGENTS.map(a => <AgentRow key={a.id} {...a} isLora={false} />)}
      </div>

    </div>
  );
}
