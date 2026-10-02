import { LivePhase, LiveMessage } from '../hooks/useLiveMode';

const AGENT_NEON: Record<string, string> = {
  apex1: '#00ffd5', apex2: '#b400ff', forge: '#ff6b00',
  spark: '#ffb800', atlas: '#00b4ff', tactix: '#00ff9d',
  vega: '#ff2d55', nexus_ui: '#7700ff',
};

interface LiveModePanelProps {
  isLive: boolean;
  phase: LivePhase;
  lastTranscript: string;
  lastAgent: string;
  lastAgentText: string;
  liveHistory: LiveMessage[];
  onStop: () => void;
  onStart: () => void;
}

const PHASE_LABEL: Record<LivePhase, string> = {
  idle: 'LUISTEREN',
  listening: 'LUISTEREN...',
  thinking: 'DENKEN...',
  speaking: 'ANTWOORDEN...',
};

const PHASE_COLOR: Record<LivePhase, string> = {
  idle: '#00ffd5',
  listening: '#00ff9d',
  thinking: '#ffb800',
  speaking: '#00b4ff',
};

const PHASE_ICON: Record<LivePhase, string> = {
  idle: '◎',
  listening: '◉',
  thinking: '◈',
  speaking: '▶',
};

export function LiveModePanel({
  isLive, phase, lastTranscript, lastAgent,
  liveHistory, onStop, onStart
}: LiveModePanelProps) {
  const phaseColor = PHASE_COLOR[phase];
  const agentColor = AGENT_NEON[lastAgent] ?? '#00ffd5';

  if (!isLive) {
    // The LIVE button (not active)
    return (
      <button
        onClick={onStart}
        className="flex items-center gap-2 px-4 py-2 font-mono font-bold text-xs tracking-widest transition-all shrink-0"
        style={{
          border: '1px solid rgba(0,255,157,0.4)',
          color: '#00ff9d',
          background: 'rgba(0,255,157,0.05)',
          boxShadow: '0 0 12px rgba(0,255,157,0.1)',
          letterSpacing: '0.2em',
        }}
        onMouseEnter={e => {
          e.currentTarget.style.background = 'rgba(0,255,157,0.12)';
          e.currentTarget.style.boxShadow = '0 0 20px rgba(0,255,157,0.3)';
        }}
        onMouseLeave={e => {
          e.currentTarget.style.background = 'rgba(0,255,157,0.05)';
          e.currentTarget.style.boxShadow = '0 0 12px rgba(0,255,157,0.1)';
        }}
      >
        <span style={{ fontSize: '8px', animation: 'pulse 2s infinite' }}>●</span>
        LIVE
      </button>
    );
  }

  // Active live mode — full overlay panel
  return (
    <div
      className="flex flex-col"
      style={{
        position: 'absolute',
        inset: 0,
        zIndex: 50,
        background: 'rgba(0,4,12,0.97)',
        backdropFilter: 'blur(4px)',
      }}
    >
      {/* Scan bar animation */}
      <div className="scan-bar" style={{ position: 'absolute', top: 0, left: 0, right: 0, height: '2px', zIndex: 1 }} />

      {/* Header */}
      <div
        className="flex items-center gap-3 px-6 py-3 shrink-0"
        style={{ borderBottom: `1px solid ${phaseColor}22` }}
      >
        <div
          className="w-3 h-3 rounded-full"
          style={{
            background: '#ff2d55',
            boxShadow: '0 0 8px #ff2d55',
            animation: 'pulse 0.8s ease-in-out infinite',
          }}
        />
        <span className="font-mono font-bold tracking-widest" style={{ color: '#ff2d55', textShadow: '0 0 10px #ff2d55', fontSize: '13px' }}>
          ◉ LIVE SESSION
        </span>

        <div className="flex-1" />

        {/* Phase indicator */}
        <div
          className="flex items-center gap-2 px-3 py-1 font-mono text-xs font-bold"
          style={{
            border: `1px solid ${phaseColor}44`,
            color: phaseColor,
            textShadow: `0 0 8px ${phaseColor}`,
            background: `${phaseColor}08`,
            animation: phase !== 'idle' ? 'pulse 1s infinite' : 'none',
            letterSpacing: '0.15em',
          }}
        >
          <span style={{ animation: phase === 'listening' ? 'blink 0.6s infinite' : 'none' }}>
            {PHASE_ICON[phase]}
          </span>
          {PHASE_LABEL[phase]}
        </div>

        {/* Stop button */}
        <button
          onClick={onStop}
          className="px-4 py-1 font-mono text-xs font-bold tracking-widest transition-all"
          style={{
            border: '1px solid rgba(255,45,85,0.5)',
            color: '#ff2d55',
            background: 'rgba(255,45,85,0.08)',
          }}
          onMouseEnter={e => { e.currentTarget.style.background = 'rgba(255,45,85,0.15)'; }}
          onMouseLeave={e => { e.currentTarget.style.background = 'rgba(255,45,85,0.08)'; }}
        >
          ⬛ STOP
        </button>
      </div>

      {/* Waveform / visualization */}
      <div
        className="flex items-center justify-center gap-1 py-4 shrink-0"
        style={{ borderBottom: `1px solid ${phaseColor}11` }}
      >
        {[...Array(24)].map((_, i) => {
          const isActive = phase === 'listening' || phase === 'speaking';
          return (
            <div
              key={i}
              style={{
                width: '3px',
                height: isActive ? `${8 + (i % 3 === 0 ? 20 : i % 2 === 0 ? 12 : 6)}px` : '4px',
                background: phaseColor,
                opacity: isActive ? 0.6 + (i % 3) * 0.13 : 0.2,
                transition: 'height 0.15s ease',
                borderRadius: '4px',
                animation: isActive ? `pulse ${0.3 + (i % 5) * 0.1}s ease-in-out ${i * 0.04}s infinite` : 'none',
              }}
            />
          );
        })}
      </div>

      {/* Conversation history */}
      <div className="flex-1 overflow-y-auto px-6 py-4 space-y-4 font-mono">
        {liveHistory.length === 0 && (
          <div className="flex flex-col items-center justify-center h-full gap-3 opacity-40">
            <div className="text-4xl" style={{ color: '#00ff9d', animation: 'pulse 2s infinite' }}>◉</div>
            <div className="text-xs tracking-widest text-slate-500">SPREEK NU OM TE BEGINNEN</div>
          </div>
        )}

        {liveHistory.map((msg, i) => {
          if (msg.role === 'user') {
            return (
              <div key={i} className="flex items-start gap-3 justify-end">
                <div
                  className="max-w-md px-4 py-2 text-sm"
                  style={{
                    background: 'rgba(0,255,157,0.05)',
                    border: '1px solid rgba(0,255,157,0.2)',
                    color: '#a0ffd0',
                  }}
                >
                  <div className="text-xs mb-1 opacity-50" style={{ fontSize: '9px' }}>JIJ</div>
                  {msg.content}
                </div>
                <div
                  className="w-6 h-6 flex items-center justify-center text-xs flex-shrink-0"
                  style={{ border: '1px solid #00ff9d44', color: '#00ff9d' }}
                >
                  ▸
                </div>
              </div>
            );
          }

          const neon = AGENT_NEON[msg.agent ?? 'vega'] ?? '#00ffd5';
          const name = (msg.agent ?? 'AGENT').toUpperCase();
          return (
            <div key={i} className="flex items-start gap-3">
              <div
                className="w-6 h-6 flex items-center justify-center text-xs font-bold flex-shrink-0 mt-1"
                style={{ border: `1px solid ${neon}`, color: neon, boxShadow: `0 0 6px ${neon}40` }}
              >
                {name[0]}
              </div>
              <div className="flex-1">
                <div className="text-xs font-bold mb-1" style={{ color: neon, textShadow: `0 0 6px ${neon}` }}>
                  {name}
                </div>
                <div
                  className="text-xs leading-relaxed pl-3 border-l"
                  style={{ color: '#c0d0e0', borderColor: `${neon}30`, fontSize: '12px' }}
                >
                  <pre className="whitespace-pre-wrap font-mono">{msg.content.replace(/\[NEXUS_ACTION:[^\]]*\]/g, '').trim()}</pre>
                </div>
              </div>
            </div>
          );
        })}

        {/* Live typing indicator */}
        {(phase === 'thinking' || phase === 'speaking') && (
          <div className="flex items-center gap-2 pl-9">
            <div className="flex gap-1">
              {[0, 1, 2].map(i => (
                <div
                  key={i}
                  className="w-1.5 h-1.5 rounded-full"
                  style={{
                    background: agentColor,
                    animation: `pulse 0.6s ease-in-out ${i * 0.15}s infinite`,
                  }}
                />
              ))}
            </div>
            <span className="text-xs opacity-40" style={{ color: agentColor, fontSize: '10px' }}>
              {phase === 'thinking' ? 'denkt...' : 'antwoordt...'}
            </span>
          </div>
        )}
      </div>

      {/* Current transcript at bottom */}
      {phase === 'listening' && (
        <div
          className="px-6 py-3 shrink-0 font-mono"
          style={{ borderTop: '1px solid rgba(0,255,157,0.1)', background: 'rgba(0,255,157,0.03)' }}
        >
          <div className="text-xs text-slate-600 mb-1" style={{ fontSize: '9px' }}>LUISTEREN...</div>
          <div className="text-sm" style={{ color: '#00ff9d', minHeight: '20px' }}>
            {lastTranscript || <span className="opacity-30 animate-pulse">▌</span>}
          </div>
        </div>
      )}
    </div>
  );
}
