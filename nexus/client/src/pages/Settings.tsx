import { useState, useEffect, useCallback } from 'react';

interface SystemConfig {
  port: number;
  host: string;
  ollamaUrl: string;
  ollamaExe: string;
  maxConversationHistory: number;
  defaultLanguage: string;
  voiceEnabled: boolean;
  locationEnabled: boolean;
  autoTrainOnFeedback: boolean;
  requireActionConfirmation: boolean;
  requireSendConfirmation: boolean;
  projectsDir: string;
}

const SECTION_META = {
  server: { label: 'SERVER', color: '#00ffd5', icon: '◈' },
  ollama: { label: 'CAMELLLO', color: '#ff6b00', icon: '⚙' },
  memory: { label: 'GEHEUGEN', color: '#b400ff', icon: '◉' },
  features: { label: 'FEATURES', color: '#00ff9d', icon: '⬡' },
  storage: { label: 'OPSLAG', color: '#00b4ff', icon: '◎' },
};

export function Settings() {
  const [config, setConfig] = useState<SystemConfig | null>(null);
  const [draft, setDraft] = useState<SystemConfig | null>(null);
  const [saved, setSaved] = useState(false);
  const [saving, setSaving] = useState(false);
  const [testResult, setTestResult] = useState<{ ok: boolean; msg: string } | null>(null);

  const load = useCallback(async () => {
    try {
      const res = await fetch('/api/config');
      const data = await res.json();
      setConfig(data.config);
      setDraft(data.config);
    } catch { /* server offline */ }
  }, []);

  useEffect(() => { load(); }, [load]);

  const save = async () => {
    if (!draft) return;
    setSaving(true);
    try {
      const res = await fetch('/api/config', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(draft),
      });
      const data = await res.json();
      setConfig(data.config);
      setSaved(true);
      setTimeout(() => setSaved(false), 2500);
    } finally {
      setSaving(false);
    }
  };

  const reset = async () => {
    if (!confirm('Alle instellingen terugzetten naar standaard?')) return;
    const res = await fetch('/api/config/reset', { method: 'POST' });
    const data = await res.json();
    setConfig(data.config);
    setDraft(data.config);
  };

  const testOllama = async () => {
    setTestResult(null);
    try {
      const t0 = Date.now();
      const res = await fetch('/api/agents');
      const data = await res.json();
      const ms = Date.now() - t0;
      const online = (data.ollamaModels?.length ?? 0) > 0;
      setTestResult({ ok: online, msg: online ? `Verbonden — ${data.ollamaModels.length} modellen geladen in ${ms}ms` : 'Camelllo niet bereikbaar — is camelllo.exe gestart?' });
    } catch {
      setTestResult({ ok: false, msg: 'Kon server niet bereiken' });
    }
    setTimeout(() => setTestResult(null), 5000);
  };

  const set = (key: keyof SystemConfig, value: unknown) => {
    setDraft(d => d ? { ...d, [key]: value } : d);
  };

  const isDirty = JSON.stringify(config) !== JSON.stringify(draft);

  if (!draft) {
    return (
      <div className="flex items-center justify-center h-full font-mono text-slate-500" style={{ fontSize: '12px' }}>
        <div className="text-center">
          <div className="text-2xl mb-3 opacity-30">◎</div>
          Verbinden met server...
        </div>
      </div>
    );
  }

  return (
    <div className="h-full overflow-y-auto" style={{ background: 'var(--bg-panel)' }}>
      <div className="max-w-2xl mx-auto px-6 py-6">

        {/* Header */}
        <div className="flex items-center justify-between mb-6">
          <div>
            <div className="text-xs font-mono text-slate-500 tracking-widest mb-1">◎ SYSTEEM INSTELLINGEN</div>
            <div className="font-bold text-xl tracking-wider" style={{ color: '#00ffd5' }}>NEXUS CONFIG</div>
            <div className="text-xs text-slate-500 mt-0.5">Wijzigingen worden opgeslagen in <code style={{ color: '#ffb800' }}>data/system-config.json</code></div>
          </div>
          <div className="flex gap-2">
            <button onClick={reset} className="px-3 py-1.5 text-xs font-mono font-bold tracking-widest transition-all" style={{ border: '1px solid rgba(255,45,85,0.3)', color: 'rgba(255,45,85,0.6)', background: 'transparent' }}
              onMouseEnter={e => { e.currentTarget.style.background = 'rgba(255,45,85,0.08)'; e.currentTarget.style.color = '#ff2d55'; }}
              onMouseLeave={e => { e.currentTarget.style.background = 'transparent'; e.currentTarget.style.color = 'rgba(255,45,85,0.6)'; }}>
              ↺ RESET
            </button>
            <button onClick={save} disabled={!isDirty || saving} className="px-4 py-1.5 text-xs font-mono font-bold tracking-widest transition-all" style={{
              border: `1px solid ${saved ? '#00ff9d' : isDirty ? '#00ffd5' : 'rgba(0,255,213,0.2)'}`,
              color: saved ? '#00ff9d' : isDirty ? '#00ffd5' : 'rgba(0,255,213,0.3)',
              background: saved ? 'rgba(0,255,157,0.08)' : isDirty ? 'rgba(0,255,213,0.08)' : 'transparent',
              boxShadow: (isDirty || saved) ? `0 0 10px ${saved ? '#00ff9d' : '#00ffd5'}33` : 'none',
              opacity: !isDirty && !saved ? 0.4 : 1,
            }}>
              {saving ? '⏳ OPSLAAN...' : saved ? '✓ OPGESLAGEN' : '▶ OPSLAAN'}
            </button>
          </div>
        </div>

        {/* Deployment note */}
        <div className="mb-5 px-4 py-3 font-mono text-xs" style={{ background: 'rgba(255,184,0,0.06)', border: '1px solid rgba(255,184,0,0.2)', borderRadius: '5px' }}>
          <div className="font-bold mb-1" style={{ color: '#ffb800' }}>⚡ SERVER DEPLOYMENT</div>
          <div className="text-slate-500 space-y-0.5">
            <div>Alle instellingen kunnen ook via <span style={{ color: '#ffb800' }}>omgevingsvariabelen</span> worden overschreven:</div>
            <div><code style={{ color: '#00ffd5' }}>CAMELLLO_URL</code> · <code style={{ color: '#00ffd5' }}>CAMELLLO_EXE</code> · <code style={{ color: '#00ffd5' }}>PORT</code> · <code style={{ color: '#00ffd5' }}>HOST</code> · <code style={{ color: '#00ffd5' }}>PROJECTS_DIR</code></div>
          </div>
        </div>

        {/* ── SERVER ─────────────────────────────────── */}
        <Section color={SECTION_META.server.color} icon={SECTION_META.server.icon} label="SERVER">
          <Row label="PORT" desc="Poort waarop de backend draait">
            <NumInput value={draft.port} onChange={v => set('port', v)} min={1024} max={65535} />
          </Row>
          <Row label="HOST" desc="Bind-adres (0.0.0.0 = alle interfaces)">
            <TextInput value={draft.host} onChange={v => set('host', v)} placeholder="0.0.0.0" />
          </Row>
        </Section>

        {/* ── CAMELLLO ─────────────────────────────────── */}
        <Section color={SECTION_META.ollama.color} icon={SECTION_META.ollama.icon} label="CAMELLLO">
          <Row label="CAMELLLO URL" desc="Adres van de Camelllo inference engine">
            <TextInput value={draft.ollamaUrl} onChange={v => set('ollamaUrl', v)} placeholder="http://localhost:11500" />
          </Row>
          <Row label="CAMELLLO EXECUTABLE" desc='"camelllo.exe" of volledig pad naar de executable'>
            <TextInput value={draft.ollamaExe} onChange={v => set('ollamaExe', v)} placeholder="camelllo.exe" />
          </Row>
          <div className="mt-2 flex items-center gap-3">
            <button onClick={testOllama} className="px-3 py-1.5 text-xs font-mono font-bold tracking-wider transition-all"
              style={{ border: '1px solid rgba(255,107,0,0.4)', color: '#ff6b00', background: 'rgba(255,107,0,0.06)' }}
              onMouseEnter={e => e.currentTarget.style.background = 'rgba(255,107,0,0.12)'}
              onMouseLeave={e => e.currentTarget.style.background = 'rgba(255,107,0,0.06)'}>
              ◉ TEST VERBINDING
            </button>
            {testResult && (
              <div className="font-mono text-xs" style={{ color: testResult.ok ? '#00ff9d' : '#ff2d55' }}>
                {testResult.ok ? '✓' : '✗'} {testResult.msg}
              </div>
            )}
          </div>
        </Section>

        {/* ── MEMORY ─────────────────────────────────── */}
        <Section color={SECTION_META.memory.color} icon={SECTION_META.memory.icon} label="GEHEUGEN">
          <Row label="CONVERSATIE GEHEUGEN" desc="Hoeveel eerdere berichten de agent onthoudt (per gesprek)">
            <NumInput value={draft.maxConversationHistory} onChange={v => set('maxConversationHistory', v)} min={0} max={20} />
          </Row>
          <Row label="TAAL" desc="Standaardtaal voor antwoorden (nl, en, de, fr, ...)">
            <TextInput value={draft.defaultLanguage} onChange={v => set('defaultLanguage', v)} placeholder="nl" />
          </Row>
        </Section>

        {/* ── FEATURES ───────────────────────────────── */}
        <Section color={SECTION_META.features.color} icon={SECTION_META.features.icon} label="FEATURES">
          <Row label="SPRAAK" desc="Tekst-naar-spraak antwoorden aanzetten">
            <Toggle value={draft.voiceEnabled} onChange={v => set('voiceEnabled', v)} color="#00ff9d" />
          </Row>
          <Row label="AUTO-TRAINING" desc="Agents automatisch trainen bij positieve feedback">
            <Toggle value={draft.autoTrainOnFeedback} onChange={v => set('autoTrainOnFeedback', v)} color="#ff6b00" />
          </Row>
          <Row label="ACTIE VERIFICATIE" desc="Vraag om bevestiging (TOESTAAN / WEIGEREN) voordat een app wordt geopend of een systeemactie wordt uitgevoerd">
            <Toggle value={draft.requireActionConfirmation} onChange={v => set('requireActionConfirmation', v)} color="#ffb800" />
          </Row>
          <Row label="VERZEND VERIFICATIE" desc="Vraag een 2e keer om bevestiging voordat een getypt bericht in een app wordt verzonden (Enter)">
            <Toggle value={draft.requireSendConfirmation} onChange={v => set('requireSendConfirmation', v)} color="#ff2d55" />
          </Row>
        </Section>

        {/* ── STORAGE ────────────────────────────────── */}
        <Section color={SECTION_META.storage.color} icon={SECTION_META.storage.icon} label="OPSLAG">
          <Row label="PROJECTEN MAP" desc="Waar nieuwe projecten worden aangemaakt">
            <TextInput value={draft.projectsDir} onChange={v => set('projectsDir', v)} placeholder="/opt/nexus/projects" wide />
          </Row>
        </Section>

        <div className="mt-4 text-center font-mono text-slate-700" style={{ fontSize: '9px' }}>
          NEXUS v0.1.0 · Project NEXUS Multi-Agent System · Alle rechten voorbehouden
        </div>
      </div>
    </div>
  );
}

// ── Sub-components ──────────────────────────────────────────────────

function Section({ children, color, icon, label }: { children: React.ReactNode; color: string; icon: string; label: string }) {
  return (
    <div className="mb-5">
      <div className="flex items-center gap-2 mb-3">
        <span style={{ color, fontSize: '14px' }}>{icon}</span>
        <span className="font-mono font-bold tracking-widest" style={{ color, fontSize: '11px', textShadow: `0 0 8px ${color}` }}>{label}</span>
        <div className="flex-1 h-px" style={{ background: `linear-gradient(to right, ${color}44, transparent)` }} />
      </div>
      <div className="space-y-0" style={{ border: '1px solid rgba(255,255,255,0.05)', borderRadius: '5px', overflow: 'hidden' }}>
        {children}
      </div>
    </div>
  );
}

function Row({ label, desc, children }: { label: string; desc: string; children: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between px-4 py-3 border-b" style={{ borderColor: 'rgba(255,255,255,0.04)', background: 'rgba(0,0,0,0.2)' }}>
      <div className="mr-4">
        <div className="font-mono font-bold text-xs tracking-wider" style={{ color: 'rgba(255,255,255,0.7)', fontSize: '11px' }}>{label}</div>
        <div className="text-slate-600 mt-0.5" style={{ fontSize: '10px' }}>{desc}</div>
      </div>
      <div className="shrink-0">{children}</div>
    </div>
  );
}

function TextInput({ value, onChange, placeholder, wide }: { value: string; onChange: (v: string) => void; placeholder?: string; wide?: boolean }) {
  return (
    <input
      value={value}
      onChange={e => onChange(e.target.value)}
      placeholder={placeholder}
      className="font-mono text-xs outline-none px-2 py-1"
      style={{ background: 'rgba(0,0,0,0.4)', border: '1px solid rgba(0,255,213,0.15)', color: '#00ffd5', width: wide ? '240px' : '180px', borderRadius: '4px' }}
      onFocus={e => e.target.style.borderColor = 'rgba(0,255,213,0.5)'}
      onBlur={e => e.target.style.borderColor = 'rgba(0,255,213,0.15)'}
    />
  );
}

function NumInput({ value, onChange, min, max }: { value: number; onChange: (v: number) => void; min: number; max: number }) {
  return (
    <input
      type="number"
      value={value}
      min={min}
      max={max}
      onChange={e => onChange(parseInt(e.target.value) || min)}
      className="font-mono text-xs outline-none px-2 py-1 text-center"
      style={{ background: 'rgba(0,0,0,0.4)', border: '1px solid rgba(0,255,213,0.15)', color: '#00ffd5', width: '80px', borderRadius: '4px' }}
      onFocus={e => e.target.style.borderColor = 'rgba(0,255,213,0.5)'}
      onBlur={e => e.target.style.borderColor = 'rgba(0,255,213,0.15)'}
    />
  );
}

function Toggle({ value, onChange, color }: { value: boolean; onChange: (v: boolean) => void; color: string }) {
  return (
    <button
      onClick={() => onChange(!value)}
      style={{ width: '44px', height: '22px', borderRadius: '11px', background: value ? color : 'rgba(255,255,255,0.1)', border: 'none', cursor: 'pointer', position: 'relative', transition: 'background 0.2s', boxShadow: value ? `0 0 10px ${color}55` : 'none' }}
    >
      <div style={{ position: 'absolute', top: '3px', left: value ? '25px' : '3px', width: '16px', height: '16px', borderRadius: '50%', background: '#fff', transition: 'left 0.2s ease' }} />
    </button>
  );
}
