import { useState, useEffect } from 'react';

const AGENT_COLOR: Record<string, string> = {
  apex1:    '#00ffd5',
  apex2:    '#b400ff',
  forge:    '#ff7a2a',
  spark:    '#fbbf24',
  atlas:    '#38bdf8',
  tactix:   '#22d3a8',
  vega:     '#f43f5e',
  optic:    '#a78bfa',
  nexus_ui: '#a78bfa',
  jarvis:   '#c8a86b',
  'phi3.5': '#00d9ff',
};

const AGENT_INITIALS: Record<string, string> = {
  apex1:    'A1',
  apex2:    'A2',
  forge:    'FG',
  spark:    'SK',
  atlas:    'AT',
  tactix:   'TX',
  vega:     'VG',
  optic:    'OP',
  nexus_ui: 'OP',
  jarvis:   'JV',
  'phi3.5': 'PH',
};

function normalizeId(id: string): string {
  return id
    .replace(':latest', '')
    .replace('nexusui', 'nexus_ui')
    .toLowerCase();
}

function loadPhoto(id: string): string | null {
  try { return localStorage.getItem(`nexus_agent_photo_${id}`); }
  catch { return null; }
}

export function AgentAvatar({
  id,
  size    = 40,
  active  = false,
}: {
  id:      string;
  size?:   number;
  active?: boolean;
}) {
  const key      = normalizeId(id);
  const color    = AGENT_COLOR[key]    ?? '#00d9ff';
  const initials = AGENT_INITIALS[key] ?? id.slice(0, 2).toUpperCase();

  const [photo, setPhoto] = useState<string | null>(() => loadPhoto(key));

  useEffect(() => {
    setPhoto(loadPhoto(key));
    const onStorage = (e: StorageEvent) => {
      if (e.key === `nexus_agent_photo_${key}`) setPhoto(e.newValue);
    };
    const onPhotoUpdate = (e: CustomEvent<{ id: string; photo: string | null }>) => {
      if (e.detail.id === key) setPhoto(e.detail.photo);
    };
    window.addEventListener('storage', onStorage);
    window.addEventListener('nexus-photo-update', onPhotoUpdate as EventListener);
    return () => {
      window.removeEventListener('storage', onStorage);
      window.removeEventListener('nexus-photo-update', onPhotoUpdate as EventListener);
    };
  }, [key]);

  const ringColor  = active ? `${color}70` : `${color}28`;
  const glowStyle  = active ? `0 0 10px ${color}50` : 'none';

  /* ── Photo ───────────────────────────────────────────────────────── */
  if (photo) {
    return (
      <div style={{
        width: size, height: size,
        borderRadius: '50%',
        overflow: 'hidden',
        border: `2px solid ${ringColor}`,
        boxShadow: glowStyle,
        flexShrink: 0,
        transition: 'border-color 0.18s, box-shadow 0.18s, transform 0.18s',
        transform: active ? 'scale(1.06)' : 'scale(1)',
      }}>
        <img src={photo} alt={key} style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
      </div>
    );
  }

  /* ── Initials fallback ───────────────────────────────────────────── */
  return (
    <div style={{
      width: size, height: size,
      borderRadius: '50%',
      border: `2px solid ${ringColor}`,
      background: `radial-gradient(circle at 40% 35%, ${color}1a, ${color}07 70%)`,
      boxShadow: glowStyle,
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      flexShrink: 0,
      transition: 'border-color 0.18s, box-shadow 0.18s, transform 0.18s',
      transform: active ? 'scale(1.06)' : 'scale(1)',
      userSelect: 'none',
    }}>
      <span style={{
        fontSize: size * 0.33,
        fontWeight: 700,
        color: active ? color : `${color}99`,
        letterSpacing: '-0.02em',
        lineHeight: 1,
        transition: 'color 0.18s',
        fontFamily: "'Segoe UI Variable', 'Segoe UI', system-ui, sans-serif",
      }}>
        {initials}
      </span>
    </div>
  );
}
