const ITEMS = [
  { label: 'APEX-1',    value: 'ROUTING',     color: '#00d9ff' },
  { label: 'FORGE',     value: 'WATCHING',    color: '#ff7a2a' },
  { label: 'SPARK',     value: 'STANDBY',     color: '#fbbf24' },
  { label: 'ATLAS',     value: 'INDEXED',     color: '#38bdf8' },
  { label: 'TACTIX',    value: 'PLANNING',    color: '#22d3a8' },
  { label: 'VEGA',      value: 'ONLINE',      color: '#f43f5e' },
  { label: 'CAMELLLO',  value: 'LOCAL',       color: '#00d9ff' },
  { label: 'VOICE',     value: 'TTS READY',   color: '#a78bfa' },
  { label: 'DB',        value: 'CONNECTED',   color: '#22d3a8' },
  { label: 'SYSTEM',    value: 'OPERATIONAL', color: '#22d3a8' },
];

export function TickerBar() {
  const doubled = [...ITEMS, ...ITEMS];

  return (
    <div style={{
      height: '26px',
      background: 'rgba(8,13,22,0.95)',
      borderBottom: '1px solid rgba(0,190,255,0.06)',
      overflow: 'hidden',
      position: 'relative',
      flexShrink: 0,
    }}>
      {/* Left fade */}
      <div style={{
        position: 'absolute', left: 0, top: 0, bottom: 0, width: '32px', zIndex: 2,
        background: 'linear-gradient(to right, rgba(8,13,22,1), transparent)',
        pointerEvents: 'none',
      }} />

      {/* Ticker */}
      <div style={{ overflow: 'hidden', height: '100%', display: 'flex', alignItems: 'center' }}>
        <div className="ticker-inner" style={{ gap: 0 }}>
          {doubled.map((item, i) => (
            <span
              key={i}
              style={{
                display: 'inline-flex', alignItems: 'center', gap: '5px',
                padding: '0 16px',
                borderRight: '1px solid rgba(0,190,255,0.06)',
              }}
            >
              <span style={{ fontSize: '10px', fontWeight: 500, color: 'rgba(120,160,200,0.45)', letterSpacing: '0.06em' }}>
                {item.label}
              </span>
              <span style={{ width: '1px', height: '8px', background: 'rgba(0,190,255,0.15)' }} />
              <span style={{ fontSize: '10px', fontWeight: 600, color: item.color, letterSpacing: '0.04em', opacity: 0.85 }}>
                {item.value}
              </span>
            </span>
          ))}
        </div>
      </div>

      {/* Right fade */}
      <div style={{
        position: 'absolute', right: 0, top: 0, bottom: 0, width: '32px', zIndex: 2,
        background: 'linear-gradient(to left, rgba(8,13,22,1), transparent)',
        pointerEvents: 'none',
      }} />
    </div>
  );
}
