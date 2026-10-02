
interface ApexVoiceIndicatorProps {
  isPlaying: boolean;
  isFetching: boolean;
  text?: string;
}

export function ApexVoiceIndicator({ isPlaying, isFetching, text }: ApexVoiceIndicatorProps) {
  return (
    <div className="flex items-center gap-3 px-3 py-2 mx-3 mb-2" style={{ border: '1px solid rgba(0,255,213,0.3)', background: 'rgba(0,255,213,0.04)', boxShadow: '0 0 15px rgba(0,255,213,0.1)' }}>
      {/* Waveform bars */}
      <div className="flex gap-0.5 items-end" style={{ height: '24px' }}>
        {[...Array(7)].map((_, i) => (
          <div
            key={i}
            style={{
              width: '3px',
              borderRadius: '3px',
              background: '#00ffd5',
              boxShadow: isPlaying ? '0 0 4px #00ffd5' : 'none',
              height: isPlaying ? `${8 + Math.abs(Math.sin((i + Date.now() / 200) * 0.8)) * 16}px` : '3px',
              transition: 'height 0.1s ease',
              animation: isPlaying ? `pulse 0.${3 + i}s ease-in-out infinite alternate` : 'none',
            }}
          />
        ))}
      </div>

      <div className="flex-1 min-w-0">
        <div className="text-xs font-bold tracking-widest neon-teal">
          {isFetching ? 'âŸ³ GENERATING VOICE...' : isPlaying ? 'â–¶ APEX-1 BROADCASTING' : 'â—¼ VOICE READY'}
        </div>
        {text && <div className="text-xs text-slate-500 truncate mt-0.5 italic" style={{ fontSize: '10px' }}>{text}</div>}
      </div>

      {(isPlaying || isFetching) && (
        <div className="flex items-center gap-1">
          <div className="w-1.5 h-1.5 rounded-full bg-teal-400 animate-ping" />
          <div className="w-1.5 h-1.5 rounded-full bg-teal-400" />
        </div>
      )}
    </div>
  );
}

