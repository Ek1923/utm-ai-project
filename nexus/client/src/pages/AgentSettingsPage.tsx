import { useState, useEffect, useRef } from 'react';

const DEFAULT_AGENTS = [
  { id: 'apex1',  name: 'APEX-1',  color: '#00ffd5', icon: '⬟',  role: 'General Commander',         model: 'apex1:latest',   description: 'I am APEX-1, General Commander of NEXUS. I analyze every request deeply and dispatch the right agents with precision. Together with APEX-2 I form the command layer of NEXUS.' },
  { id: 'apex2',  name: 'APEX-2',  color: '#b400ff', icon: '⬟',  role: 'Strategic General',          model: 'apex2:latest',   description: 'I am APEX-2, Strategic General of NEXUS. I refine every agent response to production quality and make the final strategic call. I work alongside APEX-1 to keep NEXUS sharp.' },
  { id: 'forge',  name: 'FORGE',   color: '#ff7a2a', icon: '</>',  role: 'Developer & Code AI',       model: 'forge:latest',   description: 'I am FORGE, master developer of NEXUS. I write and debug code in any language, solve technical problems and run commands on your system. Precise, fast, no-nonsense.' },
  { id: 'spark',  name: 'SPARK',   color: '#fbbf24', icon: '✦',  role: 'Creative & Ideas',           model: 'spark:latest',   description: 'I am SPARK, the creative powerhouse of NEXUS. I generate bold ideas, unexpected angles and fresh concepts. I think outside the box and inspire.' },
  { id: 'atlas',  name: 'ATLAS',   color: '#38bdf8', icon: '◎',  role: 'Knowledge & Research',       model: 'atlas:latest',   description: 'I am ATLAS, the knowledge base of NEXUS. I answer factual questions on any topic with depth and accuracy — science, history, technology, and more.' },
  { id: 'tactix', name: 'TACTIX',  color: '#22d3a8', icon: '⬡',  role: 'Strategy & Planning',        model: 'tactix:latest',  description: 'I am TACTIX, master strategist of NEXUS. I build step-by-step plans, break down complex goals and keep the bigger picture in focus at all times.' },
  { id: 'vega',   name: 'VEGA',    color: '#f43f5e', icon: '★',  role: 'Vice-General & Generalist',  model: 'vega:latest',    description: 'I am VEGA, Vice-General of NEXUS. I handle general conversation, mixed tasks and anything the specialists don\'t cover. Warm, versatile and always reliable.' },
  { id: 'optic',  name: 'OPTIC',   color: '#a78bfa', icon: '◉',  role: 'Data Analysis & ML',         model: 'optic:latest',   description: 'I am OPTIC, Data Intelligence Specialist of NEXUS. I work with datasets, statistics, machine learning metrics, HuggingFace models and data visualizations. Analytical, precise and pattern-driven.' },
  { id: 'jarvis', name: 'JARVIS',  color: '#c8a86b', icon: '◈',  role: 'Project Executor',           model: 'jarvis:latest',  description: 'I am JARVIS, Advanced Project Executor of NEXUS. I build complete websites for businesses, set up Etsy stores and deliver end-to-end projects. I work closely with FORGE for the technical implementation.' },
];

const STORAGE_KEY   = 'nexus_agent_config';
const PHOTO_KEY_PFX = 'nexus_agent_photo_';

function loadConfig(): typeof DEFAULT_AGENTS {
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (!saved) return DEFAULT_AGENTS.map(a => ({ ...a }));
    const parsed = JSON.parse(saved);
    return DEFAULT_AGENTS.map(def => {
      const s = parsed.find((p: { id: string }) => p.id === def.id);
      return s ? { ...def, ...s } : { ...def };
    });
  } catch { return DEFAULT_AGENTS.map(a => ({ ...a })); }
}

function loadPhoto(id: string): string | null {
  return localStorage.getItem(PHOTO_KEY_PFX + id);
}

function savePhoto(id: string, data: string) {
  localStorage.setItem(PHOTO_KEY_PFX + id, data);
}

/* ── Default avatar (initials + color ring) ─────────────────────── */
function DefaultAvatar({ name, color, size }: { name: string; color: string; size: number }) {
  const initials = name.split(/[\s-]/).map(w => w[0] ?? '').slice(0, 2).join('').toUpperCase() || 'AG';
  return (
    <div style={{
      width: size, height: size,
      borderRadius: '50%',
      background: `radial-gradient(circle at 40% 35%, ${color}22, ${color}09 70%)`,
      border: `1.5px solid ${color}40`,
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      fontSize: size * 0.3, fontWeight: 700,
      color, letterSpacing: '-0.02em',
      flexShrink: 0,
    }}>
      {initials}
    </div>
  );
}

/* ── Photo avatar ────────────────────────────────────────────────── */
function PhotoAvatar({ src, name, color, size }: { src: string | null; name: string; color: string; size: number }) {
  if (src) return (
    <div style={{ width: size, height: size, borderRadius: '50%', overflow: 'hidden', border: `2px solid ${color}40`, flexShrink: 0 }}>
      <img src={src} alt={name} style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
    </div>
  );
  return <DefaultAvatar name={name} color={color} size={size} />;
}

export function AgentSettingsPage() {
  const [agents, setAgents] = useState(loadConfig);
  const [photos, setPhotos] = useState<Record<string, string | null>>({});
  const [selected, setSelected] = useState<string | null>(null);
  const [saved, setSaved] = useState<Record<string, boolean>>({});
  const fileRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    setAgents(loadConfig());
    const p: Record<string, string | null> = {};
    DEFAULT_AGENTS.forEach(a => { p[a.id] = loadPhoto(a.id); });
    setPhotos(p);
  }, []);

  const selectedAgent = agents.find(a => a.id === selected);

  const updateAgent = (id: string, field: string, value: string) => {
    setAgents(prev => prev.map(a => a.id === id ? { ...a, [field]: value } : a));
  };

  const saveAgent = (id: string) => {
    const all = agents.map(a => ({ id: a.id, name: a.name, description: a.description, role: a.role }));
    localStorage.setItem(STORAGE_KEY, JSON.stringify(all));
    setSaved(prev => ({ ...prev, [id]: true }));
    setTimeout(() => setSaved(prev => ({ ...prev, [id]: false })), 2000);
  };

  const handlePhotoUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (!selected) return;
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = ev => {
      const data = ev.target?.result as string;
      savePhoto(selected, data);
      setPhotos(prev => ({ ...prev, [selected]: data }));
      window.dispatchEvent(new CustomEvent('nexus-photo-update', { detail: { id: selected, photo: data } }));
    };
    reader.readAsDataURL(file);
    e.target.value = '';
  };

  const resetPhoto = () => {
    if (!selected) return;
    localStorage.removeItem(PHOTO_KEY_PFX + selected);
    setPhotos(prev => ({ ...prev, [selected]: null }));
    window.dispatchEvent(new CustomEvent('nexus-photo-update', { detail: { id: selected, photo: null } }));
  };

  return (
    <div style={{ display: 'flex', height: '100%', overflow: 'hidden', background: 'var(--bg-0)' }}>

      {/* ── Agent grid ─────────────────────────────────────────────── */}
      <div style={{
        flex: 1, overflowY: 'auto', padding: '24px',
        maxWidth: selected ? '420px' : '100%',
        transition: 'max-width 0.25s ease',
      }}>
        {/* Header */}
        <div style={{ marginBottom: '20px' }}>
          <div style={{ fontSize: '11px', fontWeight: 500, color: 'rgba(100,140,180,0.5)', letterSpacing: '0.1em', marginBottom: '4px', textTransform: 'uppercase' }}>
            Nexus Team
          </div>
          <div style={{ fontSize: '20px', fontWeight: 700, color: 'var(--text-1)', letterSpacing: '-0.01em' }}>
            Agent Profiles
          </div>
          <div style={{ fontSize: '12px', color: 'rgba(100,140,180,0.5)', marginTop: '4px' }}>
            Click an agent to edit their profile, description, and photo
          </div>
        </div>

        {/* Grid */}
        <div style={{
          display: 'grid',
          gap: '10px',
          gridTemplateColumns: selected ? '1fr' : 'repeat(auto-fill, minmax(200px, 1fr))',
        }}>
          {agents.map(agent => {
            const isActive = selected === agent.id;
            const photo = photos[agent.id] ?? null;
            return (
              <div
                key={agent.id}
                onClick={() => setSelected(isActive ? null : agent.id)}
                style={{
                  padding: selected ? '12px 16px' : '20px 16px',
                  borderRadius: '12px',
                  border: `1px solid ${isActive ? agent.color + '40' : 'rgba(0,190,255,0.08)'}`,
                  background: isActive ? `${agent.color}0a` : 'rgba(15,23,36,0.5)',
                  cursor: 'pointer', transition: 'all 0.18s',
                  display: 'flex',
                  flexDirection: selected ? 'row' : 'column',
                  alignItems: selected ? 'center' : 'center',
                  gap: '12px',
                  backdropFilter: 'blur(12px)',
                }}
                onMouseEnter={e => { if (!isActive) e.currentTarget.style.borderColor = 'rgba(0,190,255,0.18)'; }}
                onMouseLeave={e => { if (!isActive) e.currentTarget.style.borderColor = 'rgba(0,190,255,0.08)'; }}
              >
                <PhotoAvatar src={photo} name={agent.name} color={agent.color} size={selected ? 44 : 64} />

                <div style={{ flex: 1, minWidth: 0, textAlign: selected ? 'left' : 'center' }}>
                  <div style={{ fontSize: '13px', fontWeight: 700, color: agent.color, letterSpacing: '0.03em' }}>
                    {agent.name}
                  </div>
                  <div style={{ fontSize: '11px', color: 'rgba(120,160,200,0.5)', marginTop: '2px' }}>
                    {agent.role}
                  </div>
                  {!selected && (
                    <div style={{ fontSize: '10px', color: 'rgba(100,140,180,0.3)', marginTop: '4px',
                      overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: '180px' }}>
                      {agent.model}
                    </div>
                  )}
                </div>

                {saved[agent.id] && (
                  <div style={{ fontSize: '10px', fontWeight: 600, color: '#22d3a8', whiteSpace: 'nowrap' }}>✓ Saved</div>
                )}
              </div>
            );
          })}
        </div>
      </div>

      {/* ── Edit panel ─────────────────────────────────────────────── */}
      {selectedAgent && (
        <div style={{
          width: '380px', flexShrink: 0, overflowY: 'auto',
          borderLeft: '1px solid rgba(0,190,255,0.07)',
          background: 'rgba(10,16,28,0.95)',
          padding: '28px 24px',
          backdropFilter: 'blur(28px)',
        }}>
          {/* Profile photo + name */}
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', marginBottom: '28px', gap: '14px' }}>
            {/* Clickable photo */}
            <div
              onClick={() => fileRef.current?.click()}
              style={{ position: 'relative', cursor: 'pointer' }}
              title="Click to change photo"
            >
              <PhotoAvatar src={photos[selectedAgent.id] ?? null} name={selectedAgent.name} color={selectedAgent.color} size={88} />
              {/* Hover overlay */}
              <div style={{
                position: 'absolute', inset: 0, borderRadius: '50%',
                background: 'rgba(0,0,0,0.55)',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                opacity: 0, transition: 'opacity 0.15s',
                fontSize: '18px',
              }}
                onMouseEnter={e => { e.currentTarget.style.opacity = '1'; }}
                onMouseLeave={e => { e.currentTarget.style.opacity = '0'; }}
              >
                📷
              </div>
              {/* Ring indicator */}
              <div style={{
                position: 'absolute', inset: '-3px', borderRadius: '50%',
                border: `2px solid ${selectedAgent.color}30`,
              }} />
            </div>

            {/* Photo buttons */}
            <div style={{ display: 'flex', gap: '6px' }}>
              <button
                onClick={() => fileRef.current?.click()}
                style={{ fontSize: '11px', color: 'rgba(100,140,180,0.5)', background: 'transparent',
                  border: '1px solid rgba(0,190,255,0.1)', borderRadius: '20px', padding: '3px 12px',
                  cursor: 'pointer', fontFamily: 'inherit', transition: 'all 0.15s' }}
                onMouseEnter={e => { e.currentTarget.style.color = 'var(--accent)'; e.currentTarget.style.borderColor = 'rgba(0,190,255,0.25)'; }}
                onMouseLeave={e => { e.currentTarget.style.color = 'rgba(100,140,180,0.5)'; e.currentTarget.style.borderColor = 'rgba(0,190,255,0.1)'; }}
              >
                Change photo
              </button>
              {photos[selectedAgent.id] && (
                <button
                  onClick={resetPhoto}
                  style={{ fontSize: '11px', color: 'rgba(244,63,94,0.5)', background: 'transparent',
                    border: '1px solid rgba(244,63,94,0.15)', borderRadius: '20px', padding: '3px 12px',
                    cursor: 'pointer', fontFamily: 'inherit', transition: 'all 0.15s' }}
                  onMouseEnter={e => { e.currentTarget.style.color = '#f43f5e'; e.currentTarget.style.borderColor = 'rgba(244,63,94,0.35)'; }}
                  onMouseLeave={e => { e.currentTarget.style.color = 'rgba(244,63,94,0.5)'; e.currentTarget.style.borderColor = 'rgba(244,63,94,0.15)'; }}
                >
                  Reset
                </button>
              )}
            </div>

            <div style={{ textAlign: 'center' }}>
              <div style={{ fontSize: '17px', fontWeight: 700, color: selectedAgent.color, letterSpacing: '0.04em' }}>
                {selectedAgent.name}
              </div>
              <div style={{ fontSize: '11px', color: 'rgba(120,160,200,0.45)', marginTop: '3px' }}>
                {selectedAgent.role}
              </div>
            </div>
          </div>

          {/* Hidden file input */}
          <input ref={fileRef} type="file" accept="image/*" style={{ display: 'none' }} onChange={handlePhotoUpload} />

          {/* Model badge */}
          <div style={{
            display: 'inline-flex', alignItems: 'center', gap: '6px', marginBottom: '24px',
            padding: '5px 12px', borderRadius: '8px',
            background: `${selectedAgent.color}0a`, border: `1px solid ${selectedAgent.color}20`,
          }}>
            <span style={{ fontSize: '10px', fontWeight: 600, color: 'rgba(120,160,200,0.5)', letterSpacing: '0.06em' }}>MODEL</span>
            <span style={{ width: '1px', height: '10px', background: 'rgba(0,190,255,0.15)' }} />
            <span style={{ fontSize: '11px', fontWeight: 600, color: selectedAgent.color, fontFamily: "'Cascadia Code', Consolas, monospace" }}>
              {selectedAgent.model}
            </span>
          </div>

          {/* Name field */}
          <div style={{ marginBottom: '16px' }}>
            <label style={{ display: 'block', fontSize: '11px', fontWeight: 500, color: 'rgba(120,160,200,0.5)', letterSpacing: '0.06em', marginBottom: '6px', textTransform: 'uppercase' }}>
              Name
            </label>
            <input
              value={selectedAgent.name}
              onChange={e => updateAgent(selectedAgent.id, 'name', e.target.value)}
              style={{
                width: '100%', padding: '9px 12px',
                background: 'rgba(15,23,36,0.8)',
                border: `1px solid rgba(0,190,255,0.12)`,
                borderRadius: '8px',
                color: 'var(--text-1)', fontSize: '14px', fontWeight: 600,
                outline: 'none', fontFamily: 'inherit', transition: 'border-color 0.15s, box-shadow 0.15s',
              }}
              onFocus={e => { e.target.style.borderColor = selectedAgent.color + '60'; e.target.style.boxShadow = `0 0 0 3px ${selectedAgent.color}10`; }}
              onBlur={e => { e.target.style.borderColor = 'rgba(0,190,255,0.12)'; e.target.style.boxShadow = 'none'; }}
            />
          </div>

          {/* Description field */}
          <div style={{ marginBottom: '16px' }}>
            <label style={{ display: 'block', fontSize: '11px', fontWeight: 500, color: 'rgba(120,160,200,0.5)', letterSpacing: '0.06em', marginBottom: '6px', textTransform: 'uppercase' }}>
              Description &amp; Personality
            </label>
            <div style={{ fontSize: '11px', color: 'rgba(100,140,180,0.38)', marginBottom: '8px', lineHeight: 1.4 }}>
              Defines how this agent thinks and communicates. Used during training.
            </div>
            <textarea
              value={selectedAgent.description}
              onChange={e => updateAgent(selectedAgent.id, 'description', e.target.value)}
              rows={7}
              style={{
                width: '100%', padding: '10px 12px',
                background: 'rgba(15,23,36,0.8)',
                border: `1px solid rgba(0,190,255,0.12)`,
                borderRadius: '8px',
                color: 'rgba(210,228,248,0.85)', fontSize: '13px', lineHeight: '1.65',
                outline: 'none', resize: 'vertical', fontFamily: 'inherit',
                transition: 'border-color 0.15s, box-shadow 0.15s',
              }}
              onFocus={e => { e.target.style.borderColor = selectedAgent.color + '55'; e.target.style.boxShadow = `0 0 0 3px ${selectedAgent.color}0d`; }}
              onBlur={e => { e.target.style.borderColor = 'rgba(0,190,255,0.12)'; e.target.style.boxShadow = 'none'; }}
            />
          </div>

          {/* Role field */}
          <div style={{ marginBottom: '24px' }}>
            <label style={{ display: 'block', fontSize: '11px', fontWeight: 500, color: 'rgba(120,160,200,0.5)', letterSpacing: '0.06em', marginBottom: '6px', textTransform: 'uppercase' }}>
              Role
            </label>
            <input
              value={selectedAgent.role}
              onChange={e => updateAgent(selectedAgent.id, 'role', e.target.value)}
              style={{
                width: '100%', padding: '9px 12px',
                background: 'rgba(15,23,36,0.8)',
                border: `1px solid rgba(0,190,255,0.12)`,
                borderRadius: '8px',
                color: 'rgba(120,160,200,0.7)', fontSize: '13px',
                outline: 'none', fontFamily: 'inherit', transition: 'border-color 0.15s',
              }}
              onFocus={e => { e.target.style.borderColor = 'rgba(0,190,255,0.28)'; }}
              onBlur={e => { e.target.style.borderColor = 'rgba(0,190,255,0.12)'; }}
            />
          </div>

          {/* Save */}
          <button
            onClick={() => saveAgent(selectedAgent.id)}
            style={{
              width: '100%', padding: '11px',
              borderRadius: '9px',
              border: `1px solid ${saved[selectedAgent.id] ? '#22d3a855' : selectedAgent.color + '45'}`,
              background: saved[selectedAgent.id] ? 'rgba(34,211,168,0.1)' : `${selectedAgent.color}12`,
              color: saved[selectedAgent.id] ? '#22d3a8' : selectedAgent.color,
              fontSize: '13px', fontWeight: 600, letterSpacing: '0.04em',
              cursor: 'pointer', fontFamily: 'inherit', transition: 'all 0.15s',
            }}
            onMouseEnter={e => { if (!saved[selectedAgent.id]) e.currentTarget.style.background = `${selectedAgent.color}20`; }}
            onMouseLeave={e => { if (!saved[selectedAgent.id]) e.currentTarget.style.background = `${selectedAgent.color}12`; }}
          >
            {saved[selectedAgent.id] ? '✓ Saved' : 'Save Profile'}
          </button>

          <div style={{ marginTop: '12px', textAlign: 'center', fontSize: '11px', color: 'rgba(100,140,180,0.3)' }}>
            Saved locally — applied on next training run
          </div>
        </div>
      )}
    </div>
  );
}
