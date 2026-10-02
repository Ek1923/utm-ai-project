import { useState, useEffect, useCallback } from 'react';
// IntegrationsTab removed — only BotApisTab remains

/* ── Types ─────────────────────────────────────────────────────────────────── */
interface ApiIntegration {
  id: string; name: string; description: string; baseUrl: string;
  apiKey: string; type: string; enabled: boolean; agents: string[];
  calls: number; lastUsed: string | null; createdAt: string;
}
interface BotKey {
  id: string; name: string; agent_id: string; api_key: string;
  enabled: number; calls: number; created_at: string;
}

/* ── Constants ─────────────────────────────────────────────────────────────── */
const ALL_AGENTS = [
  { id: 'apex1',    name: 'APEX-1',   color: '#00ffd5' },
  { id: 'apex2',    name: 'APEX-2',   color: '#b400ff' },
  { id: 'forge',    name: 'FORGE',    color: '#ff6b00' },
  { id: 'spark',    name: 'SPARK',    color: '#ffb800' },
  { id: 'atlas',    name: 'ATLAS',    color: '#00b4ff' },
  { id: 'tactix',   name: 'TACTIX',  color: '#00ff9d' },
  { id: 'vega',     name: 'VEGA',    color: '#ff2d55' },
  { id: 'optic',    name: 'OPTIC',    color: '#a78bfa' },
  { id: 'jarvis',   name: 'JARVIS',   color: '#c8a86b' },
];

const BOT_AGENTS = [
  ...ALL_AGENTS,
  { id: 'all', name: 'ALLE AGENTS', color: '#00ffd5' },
];

const PRESETS = [
  { type: 'google_maps',   name: 'Google Maps',   icon: '🗺',  baseUrl: 'https://maps.googleapis.com/maps/api',       description: 'Locatie, routes en kaartdata' },
  { type: 'openweather',   name: 'OpenWeather',   icon: '⛅',  baseUrl: 'https://api.openweathermap.org/data/2.5',    description: 'Realtime weer en voorspellingen' },
  { type: 'newsapi',       name: 'News API',      icon: '📰',  baseUrl: 'https://newsapi.org/v2',                     description: 'Nieuws en artikelen wereldwijd' },
  { type: 'openai',        name: 'OpenAI',        icon: '🤖',  baseUrl: 'https://api.openai.com/v1',                  description: 'GPT modellen als fallback' },
  { type: 'wolfram',       name: 'Wolfram Alpha', icon: '🧮',  baseUrl: 'https://api.wolframalpha.com/v2',            description: 'Wiskundige berekeningen' },
  { type: 'github',        name: 'GitHub',        icon: '🐙',  baseUrl: 'https://api.github.com',                     description: 'Repositories en code' },
  { type: 'wikipedia',     name: 'Wikipedia',     icon: '📖',  baseUrl: 'https://en.wikipedia.org/api/rest_v1',       description: 'Encyclopedische kennis (geen key nodig)' },
  { type: 'custom',        name: 'Eigen API',     icon: '⚡',  baseUrl: '',                                           description: 'Voeg je eigen API toe' },
];

const TYPE_COLORS: Record<string, string> = {
  google_maps: '#4285f4', openweather: '#f8a100', newsapi: '#d9344c',
  openai: '#10a37f', wolfram: '#f96932', github: '#8b949e',
  wikipedia: '#eaecf0', custom: '#00ffd5',
};

const EMPTY_FORM = { name: '', description: '', baseUrl: '', apiKey: '', type: 'custom', agents: [] as string[] };

/* ── Main component ────────────────────────────────────────────────────────── */
export function ApiManagerPage() {
  return (
    <div className="flex flex-col h-full overflow-hidden" style={{ background: 'var(--bg-panel)', fontFamily: 'monospace' }}>
      <BotApisTab />
    </div>
  );
}

/* ── INTEGRATIONS TAB (unused — kept for reference) ──────────────────────── */
// @ts-ignore - intentionally unused
function IntegrationsTab() {
  const [integrations, setIntegrations] = useState<ApiIntegration[]>([]);
  const [selected, setSelected]         = useState<ApiIntegration | null>(null);
  const [showAdd, setShowAdd]           = useState(false);
  const [form, setForm]                 = useState({ ...EMPTY_FORM });
  const [saving, setSaving]             = useState(false);
  const [feedback, setFeedback]         = useState<{ id: string; msg: string; ok: boolean } | null>(null);
  const [allOn, setAllOn]               = useState(true);

  const load = useCallback(async () => {
    try {
      const res  = await fetch('/api/integrations');
      const data = await res.json();
      setIntegrations(data.integrations ?? []);
    } catch { /* server offline */ }
  }, []);

  useEffect(() => { load(); const iv = setInterval(load, 5000); return () => clearInterval(iv); }, [load]);

  const flash = (id: string, msg: string, ok: boolean) => {
    setFeedback({ id, msg, ok });
    setTimeout(() => setFeedback(null), 2500);
  };

  const toggle = async (integration: ApiIntegration) => {
    const res = await fetch(`/api/integrations/${integration.id}`, {
      method: 'PATCH', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ enabled: !integration.enabled }),
    });
    if (res.ok) {
      setIntegrations(prev => prev.map(i => i.id === integration.id ? { ...i, enabled: !i.enabled } : i));
      flash(integration.id, integration.enabled ? 'UITGESCHAKELD' : 'INGESCHAKELD', true);
    }
  };

  const toggleAll = async () => {
    const newState = !allOn;
    setAllOn(newState);
    for (const i of integrations) {
      await fetch(`/api/integrations/${i.id}`, {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ enabled: newState }),
      });
    }
    setIntegrations(prev => prev.map(i => ({ ...i, enabled: newState })));
  };

  const deleteApi = async (id: string) => {
    await fetch(`/api/integrations/${id}`, { method: 'DELETE' });
    setIntegrations(prev => prev.filter(i => i.id !== id));
    if (selected?.id === id) setSelected(null);
  };

  const applyPreset = (preset: typeof PRESETS[0]) =>
    setForm({ name: preset.name, description: preset.description, baseUrl: preset.baseUrl, apiKey: '', type: preset.type, agents: [] });

  const toggleAgent = (agentId: string) =>
    setForm(prev => ({
      ...prev,
      agents: prev.agents.includes(agentId) ? prev.agents.filter(a => a !== agentId) : [...prev.agents, agentId],
    }));

  const toggleSelectedAgent = async (agentId: string) => {
    if (!selected) return;
    const newAgents = selected.agents.includes(agentId)
      ? selected.agents.filter(a => a !== agentId)
      : [...selected.agents, agentId];
    const res = await fetch(`/api/integrations/${selected.id}`, {
      method: 'PATCH', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ agents: newAgents }),
    });
    if (res.ok) {
      const upd = { ...selected, agents: newAgents };
      setSelected(upd);
      setIntegrations(prev => prev.map(i => i.id === selected.id ? upd : i));
    }
  };

  const saveNew = async () => {
    if (!form.name || !form.baseUrl) return;
    setSaving(true);
    try {
      const res  = await fetch('/api/integrations', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(form),
      });
      const data = await res.json();
      setIntegrations(prev => [...prev, data.integration]);
      setShowAdd(false); setForm({ ...EMPTY_FORM });
      flash(data.integration.id, 'API TOEGEVOEGD', true);
    } finally { setSaving(false); }
  };

  const fmtDate = (d: string | null) => d ? new Date(d).toLocaleString('nl-NL', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }) : 'Nooit';
  const activeCount = integrations.filter(i => i.enabled).length;

  return (
    <div className="flex h-full overflow-hidden">
      {/* Left panel */}
      <div className="flex flex-col border-r" style={{ width: '340px', borderColor: 'rgba(0,255,213,0.1)', background: 'rgba(0,4,12,0.8)' }}>
        <div className="px-4 py-3 border-b" style={{ borderColor: 'rgba(0,255,213,0.08)' }}>
          <div className="flex items-center justify-between mb-2">
            <div>
              <div className="text-xs text-slate-500 tracking-widest">◈ API BEHEER</div>
              <div className="font-bold text-base tracking-wider" style={{ color: '#00ffd5' }}>INTEGRATIES</div>
            </div>
            <div className="text-right">
              <div className="font-bold text-lg" style={{ color: activeCount > 0 ? '#00ff9d' : '#ff2d55' }}>{activeCount}</div>
              <div className="text-xs text-slate-500">ACTIEF</div>
            </div>
          </div>
          <div className="flex gap-2">
            <button onClick={toggleAll} className="flex-1 py-1.5 text-xs font-bold tracking-widest transition-all"
              style={{ background: allOn ? 'rgba(0,255,157,0.12)' : 'rgba(255,45,85,0.12)', border: `1px solid ${allOn ? '#00ff9d' : '#ff2d55'}`, color: allOn ? '#00ff9d' : '#ff2d55', boxShadow: allOn ? '0 0 8px rgba(0,255,157,0.2)' : '0 0 8px rgba(255,45,85,0.2)' }}>
              {allOn ? '⏸ ALLES UIT' : '▶ ALLES AAN'}
            </button>
            <button onClick={() => { setShowAdd(true); setSelected(null); }} className="flex-1 py-1.5 text-xs font-bold tracking-widest transition-all"
              style={{ background: 'rgba(0,255,213,0.08)', border: '1px solid rgba(0,255,213,0.3)', color: '#00ffd5' }}
              onMouseEnter={e => e.currentTarget.style.background = 'rgba(0,255,213,0.15)'}
              onMouseLeave={e => e.currentTarget.style.background = 'rgba(0,255,213,0.08)'}>
              + NIEUWE API
            </button>
          </div>
        </div>

        <div className="flex-1 overflow-y-auto">
          {integrations.length === 0 && (
            <div className="flex flex-col items-center justify-center h-full text-slate-600 text-xs text-center px-6 gap-2">
              <div style={{ fontSize: '32px' }}>⚡</div>
              <div>Nog geen APIs geconfigureerd</div>
            </div>
          )}
          {integrations.map(api => {
            const color = TYPE_COLORS[api.type] ?? '#00ffd5';
            const isSel = selected?.id === api.id;
            const fb = feedback?.id === api.id;
            return (
              <div key={api.id} onClick={() => { setSelected(isSel ? null : api); setShowAdd(false); }}
                className="cursor-pointer transition-all border-b"
                style={{ borderColor: 'rgba(255,255,255,0.04)', background: isSel ? `${color}12` : 'transparent', borderLeft: `3px solid ${api.enabled ? color : 'rgba(255,255,255,0.1)'}`, padding: '10px 14px' }}
                onMouseEnter={e => { if (!isSel) e.currentTarget.style.background = 'rgba(255,255,255,0.02)'; }}
                onMouseLeave={e => { if (!isSel) e.currentTarget.style.background = 'transparent'; }}>
                <div className="flex items-center justify-between gap-2">
                  <div className="flex items-center gap-2 min-w-0">
                    <div className="text-lg leading-none">{PRESETS.find(p => p.type === api.type)?.icon ?? '⚡'}</div>
                    <div className="min-w-0">
                      <div className="font-bold text-xs tracking-wide truncate" style={{ color: api.enabled ? color : 'rgba(255,255,255,0.3)' }}>{api.name}</div>
                      <div className="text-xs text-slate-600 truncate" style={{ fontSize: '10px' }}>{api.description || api.baseUrl}</div>
                    </div>
                  </div>
                  <div className="flex items-center gap-1.5 shrink-0">
                    {fb && <div className="text-xs font-bold" style={{ color: feedback!.ok ? '#00ff9d' : '#ff2d55', fontSize: '9px' }}>{feedback!.msg}</div>}
                    <button onClick={e => { e.stopPropagation(); toggle(api); }} className="relative transition-all"
                      style={{ width: '36px', height: '18px', borderRadius: '9px', background: api.enabled ? color : 'rgba(255,255,255,0.1)', border: 'none', cursor: 'pointer', boxShadow: api.enabled ? `0 0 8px ${color}66` : 'none' }}>
                      <div style={{ position: 'absolute', top: '3px', left: api.enabled ? '21px' : '3px', width: '12px', height: '12px', borderRadius: '50%', background: '#fff', transition: 'left 0.2s ease' }} />
                    </button>
                  </div>
                </div>
                <div className="flex items-center gap-1.5 mt-1.5 flex-wrap">
                  {api.agents.map(aId => {
                    const ag = ALL_AGENTS.find(a => a.id === aId);
                    return ag ? <span key={aId} className="text-xs px-1.5 py-0.5 font-bold" style={{ background: `${ag.color}18`, border: `1px solid ${ag.color}44`, color: ag.color, fontSize: '9px', borderRadius: '4px' }}>{ag.name}</span> : null;
                  })}
                  {api.agents.length === 0 && <span className="text-xs text-slate-700" style={{ fontSize: '9px' }}>Geen agents</span>}
                  <span className="ml-auto text-slate-700" style={{ fontSize: '9px' }}>{api.calls} calls</span>
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* Right panel */}
      <div className="flex-1 overflow-y-auto p-5">
        {showAdd && (
          <div>
            <div className="flex items-center justify-between mb-4">
              <div>
                <div className="text-xs text-slate-500 tracking-widest">+ NIEUWE INTEGRATIE</div>
                <div className="font-bold text-base tracking-wider" style={{ color: '#00ffd5' }}>API TOEVOEGEN</div>
              </div>
              <button onClick={() => setShowAdd(false)} className="text-slate-600 hover:text-white text-lg">✕</button>
            </div>
            <div className="mb-5">
              <div className="text-xs text-slate-500 tracking-widest mb-2">SNELSTART — KIES EEN PRESET</div>
              <div className="grid gap-2" style={{ gridTemplateColumns: 'repeat(4, 1fr)' }}>
                {PRESETS.map(p => (
                  <button key={p.type} onClick={() => applyPreset(p)} className="flex flex-col items-center gap-1 py-3 px-2 transition-all text-center"
                    style={{ border: `1px solid ${form.type === p.type ? (TYPE_COLORS[p.type] ?? '#00ffd5') : 'rgba(255,255,255,0.06)'}`, background: form.type === p.type ? `${TYPE_COLORS[p.type] ?? '#00ffd5'}12` : 'rgba(255,255,255,0.02)', borderRadius: '6px', cursor: 'pointer', color: form.type === p.type ? (TYPE_COLORS[p.type] ?? '#00ffd5') : 'rgba(255,255,255,0.4)' }}
                    onMouseEnter={e => { if (form.type !== p.type) e.currentTarget.style.borderColor = 'rgba(255,255,255,0.15)'; }}
                    onMouseLeave={e => { if (form.type !== p.type) e.currentTarget.style.borderColor = 'rgba(255,255,255,0.06)'; }}>
                    <span style={{ fontSize: '20px' }}>{p.icon}</span>
                    <span className="font-bold text-xs">{p.name}</span>
                  </button>
                ))}
              </div>
            </div>
            <div className="grid gap-3" style={{ gridTemplateColumns: '1fr 1fr' }}>
              <Field label="NAAM" value={form.name} onChange={v => setForm(f => ({ ...f, name: v }))} placeholder="Bijv. Google Maps" />
              <Field label="BASE URL" value={form.baseUrl} onChange={v => setForm(f => ({ ...f, baseUrl: v }))} placeholder="https://api.example.com" />
              <div style={{ gridColumn: '1 / -1' }}><Field label="OMSCHRIJVING" value={form.description} onChange={v => setForm(f => ({ ...f, description: v }))} placeholder="Waarvoor gebruik je deze API?" /></div>
            </div>
            <div className="mt-4">
              <div className="text-xs text-slate-500 tracking-widest mb-2">AGENTS TOEGANG GEVEN</div>
              <div className="flex flex-wrap gap-2">
                {ALL_AGENTS.map(ag => {
                  const on = form.agents.includes(ag.id);
                  return (
                    <button key={ag.id} onClick={() => toggleAgent(ag.id)} className="px-3 py-1.5 text-xs font-bold tracking-wider transition-all"
                      style={{ border: `1px solid ${on ? ag.color : 'rgba(255,255,255,0.1)'}`, background: on ? `${ag.color}20` : 'transparent', color: on ? ag.color : 'rgba(255,255,255,0.3)', boxShadow: on ? `0 0 8px ${ag.color}44` : 'none', borderRadius: '5px', cursor: 'pointer' }}>
                      {on ? '✓ ' : ''}{ag.name}
                    </button>
                  );
                })}
              </div>
            </div>
            <button onClick={saveNew} disabled={saving || !form.name || !form.baseUrl} className="mt-5 w-full py-2.5 font-bold tracking-widest text-sm transition-all"
              style={{ background: 'rgba(0,255,213,0.12)', border: '1px solid #00ffd5', color: '#00ffd5', boxShadow: '0 0 12px rgba(0,255,213,0.2)', opacity: (!form.name || !form.baseUrl) ? 0.4 : 1, cursor: (!form.name || !form.baseUrl) ? 'not-allowed' : 'pointer' }}>
              {saving ? '⏳ OPSLAAN...' : '▶ API OPSLAAN'}
            </button>
          </div>
        )}

        {selected && !showAdd && (() => {
          const color = TYPE_COLORS[selected.type] ?? '#00ffd5';
          const preset = PRESETS.find(p => p.type === selected.type);
          return (
            <div>
              <div className="flex items-start justify-between mb-5">
                <div className="flex items-center gap-3">
                  <div style={{ fontSize: '36px' }}>{preset?.icon ?? '⚡'}</div>
                  <div>
                    <div className="font-bold text-xl tracking-wider" style={{ color, textShadow: `0 0 12px ${color}` }}>{selected.name}</div>
                    <div className="text-xs text-slate-500 mt-0.5">{selected.description}</div>
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <button onClick={() => toggle(selected)} className="flex items-center gap-2 px-4 py-2 font-bold text-xs tracking-widest transition-all"
                    style={{ background: selected.enabled ? 'rgba(0,255,157,0.12)' : 'rgba(255,45,85,0.12)', border: `1px solid ${selected.enabled ? '#00ff9d' : '#ff2d55'}`, color: selected.enabled ? '#00ff9d' : '#ff2d55', boxShadow: selected.enabled ? '0 0 12px rgba(0,255,157,0.25)' : '0 0 12px rgba(255,45,85,0.25)' }}>
                    <div className="w-2 h-2 rounded-full" style={{ background: selected.enabled ? '#00ff9d' : '#ff2d55', animation: selected.enabled ? 'pulse 1.5s infinite' : 'none' }} />
                    {selected.enabled ? 'ONLINE' : 'OFFLINE'}
                  </button>
                  <button onClick={() => { if (confirm('API verwijderen?')) deleteApi(selected.id); }} className="px-3 py-2 text-xs font-bold tracking-widest transition-all"
                    style={{ border: '1px solid rgba(255,45,85,0.3)', color: 'rgba(255,45,85,0.6)', background: 'transparent' }}
                    onMouseEnter={e => { e.currentTarget.style.background = 'rgba(255,45,85,0.12)'; e.currentTarget.style.color = '#ff2d55'; }}
                    onMouseLeave={e => { e.currentTarget.style.background = 'transparent'; e.currentTarget.style.color = 'rgba(255,45,85,0.6)'; }}>
                    🗑 VERWIJDER
                  </button>
                </div>
              </div>
              <div className="grid gap-px mb-5" style={{ gridTemplateColumns: 'repeat(3, 1fr)', background: 'rgba(255,255,255,0.04)' }}>
                {[{ label: 'TOTAAL CALLS', value: String(selected.calls) }, { label: 'LAATSTE GEBRUIK', value: fmtDate(selected.lastUsed) }, { label: 'AANGEMAAKT', value: fmtDate(selected.createdAt) }].map(s => (
                  <div key={s.label} className="px-4 py-3" style={{ background: 'rgba(0,4,12,0.8)' }}>
                    <div className="text-xs text-slate-600 tracking-widest" style={{ fontSize: '9px' }}>{s.label}</div>
                    <div className="font-bold mt-0.5" style={{ color, fontSize: '13px' }}>{s.value}</div>
                  </div>
                ))}
              </div>
              <div className="mb-5">
                <InfoBox label="BASE URL" value={selected.baseUrl} color={color} />
              </div>
              <div className="mb-5">
                <div className="text-xs text-slate-500 tracking-widest mb-3">AGENT TOEGANG</div>
                <div className="flex flex-wrap gap-2">
                  {ALL_AGENTS.map(ag => {
                    const on = selected.agents.includes(ag.id);
                    return (
                      <button key={ag.id} onClick={() => toggleSelectedAgent(ag.id)} className="px-3 py-2 text-xs font-bold tracking-wider transition-all"
                        style={{ border: `1px solid ${on ? ag.color : 'rgba(255,255,255,0.08)'}`, background: on ? `${ag.color}18` : 'transparent', color: on ? ag.color : 'rgba(255,255,255,0.25)', boxShadow: on ? `0 0 10px ${ag.color}33` : 'none', borderRadius: '5px', cursor: 'pointer' }}>
                        {on ? '✓ ' : ''}{ag.name}
                      </button>
                    );
                  })}
                </div>
              </div>
              <div className="px-4 py-3 font-mono text-xs" style={{ background: selected.enabled ? 'rgba(0,255,157,0.04)' : 'rgba(255,45,85,0.04)', border: `1px solid ${selected.enabled ? 'rgba(0,255,157,0.2)' : 'rgba(255,45,85,0.2)'}` }}>
                <div className="flex items-center gap-2">
                  <div className="w-2 h-2 rounded-full" style={{ background: selected.enabled ? '#00ff9d' : '#ff2d55', animation: selected.enabled ? 'pulse 1.5s infinite' : 'none' }} />
                  <span style={{ color: selected.enabled ? '#00ff9d' : '#ff2d55' }}>
                    {selected.enabled ? `API ACTIEF — ${selected.agents.length} agent(s) hebben toegang` : 'API UITGESCHAKELD'}
                  </span>
                </div>
              </div>
            </div>
          );
        })()}

        {!selected && !showAdd && (
          <div className="flex flex-col items-center justify-center h-full text-slate-600 text-center gap-3">
            <div style={{ fontSize: '48px', opacity: 0.3 }}>⚡</div>
            <div className="text-sm">Selecteer een API of voeg een nieuwe toe</div>
            <button onClick={() => setShowAdd(true)} className="mt-2 px-6 py-2 text-xs font-bold tracking-widest transition-all"
              style={{ border: '1px solid rgba(0,255,213,0.3)', color: '#00ffd5', background: 'rgba(0,255,213,0.06)' }}
              onMouseEnter={e => e.currentTarget.style.background = 'rgba(0,255,213,0.12)'}
              onMouseLeave={e => e.currentTarget.style.background = 'rgba(0,255,213,0.06)'}>
              + EERSTE API TOEVOEGEN
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

/* ── BOT APIS TAB ──────────────────────────────────────────────────────────── */
function BotApisTab() {
  const [keys, setKeys]                     = useState<BotKey[]>([]);
  const [selected, setSelected]             = useState<BotKey | null>(null);
  const [showCreate, setShowCreate]         = useState(false);
  const [form, setForm]                     = useState({ agentId: 'vega', name: '' });
  const [creating, setCreating]             = useState(false);
  const [newRawKey, setNewRawKey]           = useState<string | null>(null);
  const [copied, setCopied]                 = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const res  = await fetch('/api/botkeys');
      const data = await res.json();
      setKeys(data.keys ?? []);
    } catch { /* offline */ }
  }, []);

  useEffect(() => { load(); }, [load]);

  const createKey = async () => {
    if (!form.name || !form.agentId) return;
    setCreating(true);
    try {
      const res  = await fetch('/api/botkeys', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ agentId: form.agentId, name: form.name }),
      });
      const data = await res.json();
      setNewRawKey(data.rawKey);
      setKeys(prev => [data.key, ...prev]);
      setSelected(data.key);
      setShowCreate(false);
      setForm({ agentId: 'vega', name: '' });
    } finally { setCreating(false); }
  };

  const toggleKey = async (key: BotKey) => {
    await fetch(`/api/botkeys/${key.id}`, {
      method: 'PATCH', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ enabled: !key.enabled }),
    });
    setKeys(prev => prev.map(k => k.id === key.id ? { ...k, enabled: key.enabled ? 0 : 1 } : k));
    if (selected?.id === key.id) setSelected(prev => prev ? { ...prev, enabled: prev.enabled ? 0 : 1 } : null);
  };

  const deleteKey = async (id: string) => {
    await fetch(`/api/botkeys/${id}`, { method: 'DELETE' });
    setKeys(prev => prev.filter(k => k.id !== id));
    if (selected?.id === id) setSelected(null);
  };

  const copy = async (text: string, id: string) => {
    await navigator.clipboard.writeText(text);
    setCopied(id);
    setTimeout(() => setCopied(null), 2000);
  };

  const agentFor = (id: string) => BOT_AGENTS.find(a => a.id === id);
  const endpoint = (agentId: string) => `http://localhost:3001/api/bot/${agentId}`;

  return (
    <div className="flex h-full overflow-hidden">
      {/* Left panel */}
      <div className="flex flex-col border-r" style={{ width: '300px', borderColor: 'rgba(0,255,213,0.1)', background: 'rgba(0,4,12,0.8)' }}>

        {/* Header */}
        <div className="px-4 py-3 border-b" style={{ borderColor: 'rgba(0,255,213,0.08)' }}>
          <div className="flex items-center justify-between mb-2">
            <div>
              <div className="text-xs text-slate-500 tracking-widest">◈ BOT APIS</div>
              <div className="font-bold text-base tracking-wider" style={{ color: '#00ffd5' }}>API SLEUTELS</div>
            </div>
            <div className="text-right">
              <div className="font-bold text-lg" style={{ color: '#00ffd5' }}>{keys.length}</div>
              <div className="text-xs text-slate-500">SLEUTELS</div>
            </div>
          </div>
          <button onClick={() => { setShowCreate(true); setSelected(null); setNewRawKey(null); }}
            className="w-full py-1.5 text-xs font-bold tracking-widest transition-all"
            style={{ background: 'rgba(0,255,213,0.08)', border: '1px solid rgba(0,255,213,0.3)', color: '#00ffd5' }}
            onMouseEnter={e => e.currentTarget.style.background = 'rgba(0,255,213,0.15)'}
            onMouseLeave={e => e.currentTarget.style.background = 'rgba(0,255,213,0.08)'}>
            + GENEREER API SLEUTEL
          </button>
        </div>

        {/* Keys list */}
        <div className="flex-1 overflow-y-auto">
          {keys.length === 0 && (
            <div className="flex flex-col items-center justify-center h-full text-slate-600 text-xs text-center px-6 gap-2">
              <div style={{ fontSize: '32px' }}>◈</div>
              <div>Nog geen API sleutels</div>
              <div className="text-slate-700">Genereer een sleutel om je bots extern te bereiken</div>
            </div>
          )}
          {keys.map(key => {
            const ag    = agentFor(key.agent_id);
            const color = ag?.color ?? '#00ffd5';
            const isSel = selected?.id === key.id;
            return (
              <div key={key.id} onClick={() => { setSelected(isSel ? null : key); setShowCreate(false); }}
                className="cursor-pointer transition-all border-b"
                style={{ borderColor: 'rgba(255,255,255,0.04)', background: isSel ? `${color}10` : 'transparent', borderLeft: `3px solid ${key.enabled ? color : 'rgba(255,255,255,0.1)'}`, padding: '10px 14px' }}
                onMouseEnter={e => { if (!isSel) e.currentTarget.style.background = 'rgba(255,255,255,0.02)'; }}
                onMouseLeave={e => { if (!isSel) e.currentTarget.style.background = 'transparent'; }}>
                <div className="flex items-center justify-between">
                  <div>
                    <div className="font-bold text-xs tracking-wide" style={{ color: key.enabled ? color : 'rgba(255,255,255,0.3)' }}>{key.name}</div>
                    <div className="flex items-center gap-1.5 mt-1">
                      <span className="text-xs font-bold px-1.5 py-0.5" style={{ background: `${color}18`, border: `1px solid ${color}44`, color, fontSize: '8px' }}>{ag?.name ?? key.agent_id}</span>
                      <span className="text-slate-700" style={{ fontSize: '9px' }}>{key.calls} calls</span>
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    <button onClick={e => { e.stopPropagation(); toggleKey(key); }} className="relative"
                      style={{ width: '32px', height: '16px', borderRadius: '10px', background: key.enabled ? color : 'rgba(255,255,255,0.1)', border: 'none', cursor: 'pointer', flexShrink: 0 }}>
                      <div style={{ position: 'absolute', top: '2px', left: key.enabled ? '18px' : '2px', width: '12px', height: '12px', borderRadius: '50%', background: '#fff', transition: 'left 0.2s' }} />
                    </button>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* Right panel */}
      <div className="flex-1 overflow-y-auto p-5">

        {/* CREATE FORM */}
        {showCreate && (
          <div>
            <div className="flex items-center justify-between mb-5">
              <div>
                <div className="text-xs text-slate-500 tracking-widest">+ NIEUWE SLEUTEL</div>
                <div className="font-bold text-xl tracking-wider" style={{ color: '#00ffd5' }}>API SLEUTEL GENEREREN</div>
              </div>
              <button onClick={() => setShowCreate(false)} className="text-slate-600 hover:text-white text-lg">✕</button>
            </div>

            {/* Agent picker */}
            <div className="mb-5">
              <div className="text-xs text-slate-500 tracking-widest mb-3">KIES BOT / AGENT</div>
              <div className="grid gap-2" style={{ gridTemplateColumns: 'repeat(3, 1fr)' }}>
                {BOT_AGENTS.map(ag => {
                  const isOn = form.agentId === ag.id;
                  return (
                    <button key={ag.id} onClick={() => setForm(f => ({ ...f, agentId: ag.id }))}
                      className="py-3 px-3 text-center font-bold transition-all"
                      style={{ border: `1px solid ${isOn ? ag.color : 'rgba(255,255,255,0.07)'}`, background: isOn ? `${ag.color}14` : 'rgba(255,255,255,0.02)', color: isOn ? ag.color : 'rgba(255,255,255,0.35)', boxShadow: isOn ? `0 0 12px ${ag.color}30` : 'none', cursor: 'pointer', borderRadius: '5px' }}
                      onMouseEnter={e => { if (!isOn) { e.currentTarget.style.borderColor = 'rgba(255,255,255,0.2)'; e.currentTarget.style.color = 'rgba(255,255,255,0.6)'; }}}
                      onMouseLeave={e => { if (!isOn) { e.currentTarget.style.borderColor = 'rgba(255,255,255,0.07)'; e.currentTarget.style.color = 'rgba(255,255,255,0.35)'; }}}>
                      <div className="text-xs tracking-wider">{ag.name}</div>
                      {ag.id === 'all' && <div style={{ fontSize: '8px', color: 'rgba(255,255,255,0.3)', marginTop: '3px' }}>Alle bots tegelijk</div>}
                    </button>
                  );
                })}
              </div>
            </div>

            <div className="mb-5">
              <label className="block text-xs text-slate-500 tracking-widest mb-1">NAAM SLEUTEL</label>
              <input value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))}
                placeholder="Bijv. n8n productie, mijn app, ..."
                className="w-full px-3 py-2 font-mono text-xs outline-none"
                style={{ background: 'rgba(0,0,0,0.4)', border: '1px solid rgba(0,255,213,0.15)', color: 'rgba(255,255,255,0.8)', borderRadius: '4px' }}
                onFocus={e => e.target.style.borderColor = 'rgba(0,255,213,0.5)'}
                onBlur={e => e.target.style.borderColor = 'rgba(0,255,213,0.15)'}
                onKeyDown={e => e.key === 'Enter' && createKey()} />
            </div>

            <button onClick={createKey} disabled={creating || !form.name}
              className="w-full py-2.5 font-bold tracking-widest text-sm transition-all"
              style={{ background: 'rgba(0,255,213,0.12)', border: '1px solid #00ffd5', color: '#00ffd5', boxShadow: '0 0 12px rgba(0,255,213,0.15)', opacity: !form.name ? 0.4 : 1, cursor: !form.name ? 'not-allowed' : 'pointer' }}>
              {creating ? '⏳ GENEREREN...' : '▶ GENEREER SLEUTEL'}
            </button>
          </div>
        )}

        {/* KEY DETAIL */}
        {selected && !showCreate && (() => {
          const ag    = agentFor(selected.agent_id);
          const color = ag?.color ?? '#00ffd5';
          const url   = endpoint(selected.agent_id);
          const isNew = newRawKey !== null;

          return (
            <div>
              {/* Header */}
              <div className="flex items-start justify-between mb-5">
                <div>
                  <div className="text-xs text-slate-500 tracking-widest mb-1">API SLEUTEL</div>
                  <div className="font-bold text-xl tracking-wider" style={{ color, textShadow: `0 0 12px ${color}` }}>{selected.name}</div>
                  <span className="text-xs font-bold px-2 py-0.5 mt-1 inline-block" style={{ background: `${color}18`, border: `1px solid ${color}44`, color }}>
                    {ag?.name ?? selected.agent_id}
                  </span>
                </div>
                <div className="flex gap-2">
                  <button onClick={() => toggleKey(selected)}
                    className="flex items-center gap-2 px-4 py-2 font-bold text-xs tracking-widest transition-all"
                    style={{ background: selected.enabled ? 'rgba(0,255,157,0.12)' : 'rgba(255,45,85,0.12)', border: `1px solid ${selected.enabled ? '#00ff9d' : '#ff2d55'}`, color: selected.enabled ? '#00ff9d' : '#ff2d55' }}>
                    <div className="w-2 h-2 rounded-full" style={{ background: selected.enabled ? '#00ff9d' : '#ff2d55', animation: selected.enabled ? 'pulse 1.5s infinite' : 'none' }} />
                    {selected.enabled ? 'ACTIEF' : 'UITGESCHAKELD'}
                  </button>
                  <button onClick={() => { if (confirm('Sleutel verwijderen?')) deleteKey(selected.id); }}
                    className="px-3 py-2 text-xs font-bold tracking-widest"
                    style={{ border: '1px solid rgba(255,45,85,0.3)', color: 'rgba(255,45,85,0.6)', background: 'transparent', cursor: 'pointer' }}
                    onMouseEnter={e => { e.currentTarget.style.background = 'rgba(255,45,85,0.1)'; e.currentTarget.style.color = '#ff2d55'; }}
                    onMouseLeave={e => { e.currentTarget.style.background = 'transparent'; e.currentTarget.style.color = 'rgba(255,45,85,0.6)'; }}>
                    🗑 VERWIJDER
                  </button>
                </div>
              </div>

              {/* Stats */}
              <div className="grid gap-px mb-5" style={{ gridTemplateColumns: 'repeat(2, 1fr)', background: 'rgba(255,255,255,0.04)' }}>
                {[{ label: 'TOTAAL CALLS', value: String(selected.calls) }, { label: 'AANGEMAAKT', value: new Date(selected.created_at).toLocaleString('nl-NL') }].map(s => (
                  <div key={s.label} className="px-4 py-3" style={{ background: 'rgba(0,4,12,0.8)' }}>
                    <div className="text-xs text-slate-600 tracking-widest" style={{ fontSize: '9px' }}>{s.label}</div>
                    <div className="font-bold mt-0.5" style={{ color, fontSize: '13px' }}>{s.value}</div>
                  </div>
                ))}
              </div>

              {/* NEW KEY — show once */}
              {isNew && newRawKey && (
                <div className="mb-5 px-4 py-3 font-mono" style={{ background: 'rgba(255,184,0,0.06)', border: '1px solid rgba(255,184,0,0.4)' }}>
                  <div className="flex items-center justify-between mb-2">
                    <div className="text-xs font-bold tracking-widest" style={{ color: '#ffb800' }}>⚠ KOPIEER DEZE SLEUTEL — WORDT NIET OPNIEUW GETOOND</div>
                    <button onClick={() => { copy(newRawKey, 'rawkey'); setNewRawKey(null); }}
                      className="text-xs font-bold px-3 py-1"
                      style={{ background: copied === 'rawkey' ? 'rgba(0,255,157,0.15)' : 'rgba(255,184,0,0.15)', border: `1px solid ${copied === 'rawkey' ? '#00ff9d' : '#ffb800'}`, color: copied === 'rawkey' ? '#00ff9d' : '#ffb800', cursor: 'pointer' }}>
                      {copied === 'rawkey' ? '✓ GEKOPIEERD' : '⎘ KOPIEER'}
                    </button>
                  </div>
                  <div className="text-xs break-all" style={{ color: '#ffb800', fontSize: '11px', letterSpacing: '0.05em' }}>{newRawKey}</div>
                </div>
              )}

              {/* Endpoint URL */}
              <div className="mb-4">
                <div className="text-xs text-slate-500 tracking-widest mb-2">ENDPOINT URL</div>
                <div className="flex items-center gap-2 px-3 py-2 font-mono" style={{ background: 'rgba(0,0,0,0.4)', border: `1px solid ${color}25` }}>
                  <span className="text-xs flex-1 break-all" style={{ color, fontSize: '11px' }}>{url}</span>
                  <button onClick={() => copy(url, 'url')}
                    className="text-xs font-bold px-2 py-1 shrink-0"
                    style={{ background: copied === 'url' ? 'rgba(0,255,157,0.15)' : `${color}15`, border: `1px solid ${copied === 'url' ? '#00ff9d' : color}44`, color: copied === 'url' ? '#00ff9d' : color, cursor: 'pointer' }}>
                    {copied === 'url' ? '✓' : '⎘'}
                  </button>
                </div>
              </div>

              {/* n8n / external usage instructions */}
              <div className="mb-4">
                <div className="text-xs text-slate-500 tracking-widest mb-2">GEBRUIK IN N8N / EXTERN</div>
                <div className="px-4 py-3 font-mono text-xs" style={{ background: 'rgba(0,0,0,0.5)', border: '1px solid rgba(255,255,255,0.06)' }}>
                  <div className="mb-3">
                    <div className="text-slate-600 mb-1" style={{ fontSize: '9px' }}>HTTP REQUEST NODE — INSTELLINGEN</div>
                    {[
                      { k: 'Method',       v: 'POST' },
                      { k: 'URL',          v: url },
                      { k: 'Auth Header',  v: 'X-Api-Key: nxs_...' },
                    ].map(r => (
                      <div key={r.k} className="flex gap-3 mb-0.5">
                        <span style={{ color: 'rgba(255,255,255,0.3)', minWidth: '90px', fontSize: '10px' }}>{r.k}</span>
                        <span style={{ color, fontSize: '10px' }}>{r.v}</span>
                      </div>
                    ))}
                  </div>
                  <div className="mb-3">
                    <div className="text-slate-600 mb-1" style={{ fontSize: '9px' }}>BODY (JSON)</div>
                    <pre className="text-xs" style={{ color: '#00ff9d', fontSize: '10px', lineHeight: '1.7' }}>{`{
  "message": "{{ $json.input }}",
  "api_key": "nxs_jouw_sleutel"
}`}</pre>
                  </div>
                  <div>
                    <div className="text-slate-600 mb-1" style={{ fontSize: '9px' }}>RESPONSE</div>
                    <pre className="text-xs" style={{ color: '#ffb800', fontSize: '10px', lineHeight: '1.7' }}>{`{
  "agent": "${ag?.name ?? selected.agent_id}",
  "response": "...",
  "calls": ${selected.calls + 1}
}`}</pre>
                  </div>
                </div>
              </div>

              {/* cURL example */}
              <div>
                <div className="text-xs text-slate-500 tracking-widest mb-2">CURL VOORBEELD</div>
                <div className="px-3 py-2.5 font-mono relative" style={{ background: 'rgba(0,0,0,0.5)', border: '1px solid rgba(255,255,255,0.05)' }}>
                  <pre className="text-xs leading-relaxed" style={{ color: 'rgba(180,220,255,0.7)', fontSize: '10px', whiteSpace: 'pre-wrap' }}>{`curl -X POST ${url} \\
  -H "Content-Type: application/json" \\
  -H "X-Api-Key: nxs_jouw_sleutel" \\
  -d '{"message":"Hallo ${ag?.name ?? 'NEXUS'}!"}'`}</pre>
                  <button onClick={() => copy(`curl -X POST ${url} \\\n  -H "Content-Type: application/json" \\\n  -H "X-Api-Key: nxs_jouw_sleutel" \\\n  -d '{"message":"Hallo!"}'`, 'curl')}
                    className="absolute top-2 right-2 text-xs font-bold px-2 py-0.5"
                    style={{ background: copied === 'curl' ? 'rgba(0,255,157,0.15)' : 'rgba(255,255,255,0.05)', border: `1px solid ${copied === 'curl' ? '#00ff9d' : 'rgba(255,255,255,0.1)'}`, color: copied === 'curl' ? '#00ff9d' : 'rgba(255,255,255,0.4)', cursor: 'pointer', fontSize: '9px' }}>
                    {copied === 'curl' ? '✓' : '⎘'}
                  </button>
                </div>
              </div>
            </div>
          );
        })()}

        {/* Empty state */}
        {!selected && !showCreate && (
          <div className="flex flex-col items-center justify-center h-full text-slate-600 text-center gap-4">
            <div className="text-5xl font-mono" style={{ color: 'rgba(0,255,213,0.1)', letterSpacing: '0.1em' }}>◈</div>
            <div>
              <div className="text-sm mb-1">Maak REST APIs van je NEXUS bots</div>
              <div className="text-xs text-slate-700 max-w-xs">Genereer een sleutel per bot en roep ze aan vanuit n8n, je eigen app, of elke HTTP client</div>
            </div>
            <div className="grid gap-3 mt-2 w-full max-w-sm">
              {BOT_AGENTS.slice(0, 4).map(ag => (
                <div key={ag.id} className="flex items-center gap-3 px-3 py-2 font-mono text-xs" style={{ border: `1px solid ${ag.color}20`, background: `${ag.color}05` }}>
                  <div className="w-2 h-2 rounded-full" style={{ background: ag.color, boxShadow: `0 0 6px ${ag.color}` }} />
                  <span style={{ color: ag.color, fontWeight: 700 }}>{ag.name}</span>
                  <span className="text-slate-700 ml-auto" style={{ fontSize: '9px' }}>POST /api/bot/{ag.id}</span>
                </div>
              ))}
            </div>
            <button onClick={() => setShowCreate(true)} className="mt-2 px-6 py-2 text-xs font-bold tracking-widest transition-all"
              style={{ border: '1px solid rgba(0,255,213,0.3)', color: '#00ffd5', background: 'rgba(0,255,213,0.06)' }}
              onMouseEnter={e => e.currentTarget.style.background = 'rgba(0,255,213,0.12)'}
              onMouseLeave={e => e.currentTarget.style.background = 'rgba(0,255,213,0.06)'}>
              + GENEREER EERSTE SLEUTEL
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

/* ── Shared helpers ────────────────────────────────────────────────────────── */
function Field({ label, value, onChange, placeholder, secret }: {
  label: string; value: string; onChange: (v: string) => void; placeholder?: string; secret?: boolean;
}) {
  return (
    <div>
      <label className="block text-xs text-slate-500 tracking-widest mb-1">{label}</label>
      <input type={secret ? 'password' : 'text'} value={value} onChange={e => onChange(e.target.value)} placeholder={placeholder}
        className="w-full px-3 py-2 font-mono text-xs outline-none"
        style={{ background: 'rgba(0,0,0,0.4)', border: '1px solid rgba(0,255,213,0.15)', color: 'rgba(255,255,255,0.8)', borderRadius: '4px' }}
        onFocus={e => e.target.style.borderColor = 'rgba(0,255,213,0.5)'}
        onBlur={e => e.target.style.borderColor = 'rgba(0,255,213,0.15)'} />
    </div>
  );
}

function InfoBox({ label, value, color }: { label: string; value: string; color: string }) {
  return (
    <div className="px-3 py-2.5" style={{ background: 'rgba(0,0,0,0.3)', border: '1px solid rgba(255,255,255,0.05)' }}>
      <div className="text-xs text-slate-600 tracking-widest mb-1" style={{ fontSize: '9px' }}>{label}</div>
      <div className="font-mono text-xs truncate" style={{ color, fontSize: '11px' }}>{value}</div>
    </div>
  );
}
