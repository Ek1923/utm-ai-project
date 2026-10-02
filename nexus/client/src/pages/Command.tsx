import React, { useState, useRef } from 'react';
import { useAudio } from '../hooks/useAudio';
import { useNexus } from '../hooks/useNexus';
import { useSpeechInput } from '../hooks/useSpeech';
import { useLiveMode } from '../hooks/useLiveMode';
import { LiveModePanel } from '../components/LiveModePanel';
import { ApexVoiceIndicator } from '../components/ApexVoiceIndicator';
import { CommandFeed } from '../components/CommandFeed';
import { AgentGrid } from '../components/AgentGrid';
import { AgentAvatar } from '../components/AgentAvatar';
import { NexusMessage } from '../types/nexus';
import { p } from '../config/personalization';

/* ── Conversations panel ──────────────────────────────────── */
interface SavedConvo { id: number; agent: string; prompt: string; response: string; timestamp: number; }

function ConversationsPanel({ onClose }: { onClose: () => void }) {
  const [convos, setConvos] = React.useState<SavedConvo[]>([]);
  const [loading, setLoading] = React.useState(true);

  React.useEffect(() => {
    fetch('/api/feedback/jarvis').then(r => r.json())
      .then(d => { setConvos(d.conversations ?? []); setLoading(false); })
      .catch(() => setLoading(false));
  }, []);

  const markDataset = async (id: number) => {
    await fetch(`/api/feedback/${id}/dataset`, { method: 'POST' });
    setConvos(p => p.map(c => c.id === id ? { ...c, _isDataset: true } as any : c));
  };
  const deleteOne = async (id: number) => {
    await fetch(`/api/feedback/${id}`, { method: 'DELETE' });
    setConvos(p => p.filter(c => c.id !== id));
  };
  const deleteAll = async () => {
    await fetch('/api/feedback/jarvis', { method: 'DELETE' });
    setConvos([]);
  };

  return (
    <div style={{ position: 'fixed', inset: 0, zIndex: 998, background: 'rgba(0,3,10,0.97)', display: 'flex', flexDirection: 'column' }}>
      <div style={{ padding: '12px 20px', borderBottom: '1px solid rgba(0,255,213,0.12)', display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexShrink: 0 }}>
        <div>
          <div style={{ color: '#00ffd5', fontSize: '12px', fontWeight: 700, letterSpacing: '0.3em' }}>JARVIS SESSIONS</div>
          <div style={{ color: 'rgba(0,255,213,0.35)', fontSize: '8px', letterSpacing: '0.2em', marginTop: '2px' }}>{convos.length} SAVED · MARK AS DATASET TO TRAIN AGENTS</div>
        </div>
        <div style={{ display: 'flex', gap: '8px' }}>
          {convos.length > 0 && (
            <button onClick={deleteAll} style={{ background: 'rgba(255,45,85,0.07)', border: '1px solid rgba(255,45,85,0.25)', color: '#ff2d55', padding: '4px 12px', fontSize: '9px', fontFamily: 'inherit', fontWeight: 700, cursor: 'pointer', letterSpacing: '0.12em' }}>
              ✕ CLEAR ALL
            </button>
          )}
          <button onClick={onClose} style={{ background: 'transparent', border: '1px solid rgba(0,255,213,0.18)', color: '#00ffd5', padding: '4px 12px', fontSize: '9px', fontFamily: 'inherit', cursor: 'pointer', letterSpacing: '0.12em' }}>
            ← BACK
          </button>
        </div>
      </div>
      <div style={{ flex: 1, overflowY: 'auto', padding: '12px 20px', display: 'flex', flexDirection: 'column', gap: '8px' }}>
        {loading && <div style={{ color: '#0a1820', textAlign: 'center', marginTop: '40px', fontSize: '11px', letterSpacing: '0.15em' }}>LOADING...</div>}
        {!loading && convos.length === 0 && <div style={{ color: '#0a1820', textAlign: 'center', marginTop: '40px', fontSize: '11px', letterSpacing: '0.15em' }}>NO SESSIONS — TALK TO JARVIS FIRST</div>}
        {convos.map(c => (
          <div key={c.id} style={{ border: '1px solid rgba(0,255,213,0.07)', background: 'rgba(0,255,213,0.015)', padding: '9px 12px', display: 'flex', flexDirection: 'column', gap: '5px' }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
              <span style={{ color: 'rgba(0,255,213,0.4)', fontSize: '8px', letterSpacing: '0.2em' }}>{new Date(c.timestamp).toLocaleString('nl-NL')}</span>
              <div style={{ display: 'flex', gap: '5px' }}>
                <button onClick={() => markDataset(c.id)} style={{ background: 'rgba(0,255,157,0.05)', border: '1px solid rgba(0,255,157,0.2)', color: '#00ff9d', padding: '2px 8px', fontSize: '8px', fontFamily: 'inherit', cursor: 'pointer', letterSpacing: '0.1em' }}>▲ DATASET</button>
                <button onClick={() => deleteOne(c.id)} style={{ background: 'transparent', border: '1px solid rgba(255,45,85,0.15)', color: 'rgba(255,45,85,0.45)', padding: '2px 6px', fontSize: '8px', fontFamily: 'inherit', cursor: 'pointer' }}>✕</button>
              </div>
            </div>
            <div style={{ color: '#9abcda', fontSize: '11px' }}>▶ {c.prompt}</div>
            <div style={{ color: '#00ffd5', fontSize: '10px', opacity: 0.6, borderLeft: '2px solid rgba(0,255,213,0.12)', paddingLeft: '7px', lineHeight: 1.5 }}>{c.response.slice(0, 260)}{c.response.length > 260 ? '...' : ''}</div>
          </div>
        ))}
      </div>
    </div>
  );
}

/* ── Constants ──────────────────────────────────────────────── */
const QUICK_COMMANDS = p.quickCommands;

const DIRECT_AGENTS: { id: string; name: string; color: string; icon: string; hint: string }[] = [
  { id: 'forge',   name: 'FORGE',   color: '#ff6b00', icon: '</>', hint: 'Code, bugs, scripts' },
  { id: 'spark',   name: 'SPARK',   color: '#ffb800', icon: '✦',  hint: 'Ideas, brainstorm'  },
  { id: 'atlas',   name: 'ATLAS',   color: '#00b4ff', icon: '◎',  hint: 'Knowledge, research' },
  { id: 'tactix',  name: 'TACTIX',  color: '#00ff9d', icon: '⬡',  hint: 'Plans, strategy'    },
  { id: 'vega',    name: 'VEGA',    color: '#ff2d55', icon: '★',  hint: 'General, anything'  },
];

/* ── Component ──────────────────────────────────────────────── */
export function Command() {
  const [input, setInput]               = useState('');
  const [lastAnnouncement, setAnn]      = useState('');
  const [directAgent, setDirectAgent]   = useState<string | null>(null);
  const [locationEnabled, setLocEnabled] = useState(false);
  const [userLocation, setLocation]     = useState<{ lat: number; lon: number; city?: string; country?: string } | null>(null);
  const [showChats, setShowChats]       = useState(false);

  const inputRef  = useRef<HTMLTextAreaElement>(null);
  const sessionId = useRef(Math.random().toString(36).slice(2));

  const { play, isPlaying, isFetching } = useAudio();
  const { messages, loading, lastRouting, sendCommand, sendDirect, stop, clearMessages } = useNexus();
  const { isListening, toggleListening } = useSpeechInput((text) => {
    setInput(prev => prev + text);
    inputRef.current?.focus();
  });
  const live = useLiveMode('nl-NL');

  const activeAgent = DIRECT_AGENTS.find(a => a.id === directAgent);

  // Geolocation
  React.useEffect(() => {
    if (!locationEnabled) { setLocation(null); return; }
    if (!navigator.geolocation) return;
    navigator.geolocation.getCurrentPosition(async pos => {
      const { latitude: lat, longitude: lon } = pos.coords;
      try {
        const res  = await fetch(`/api/maps/reverse?lat=${lat}&lon=${lon}`);
        const data = await res.json();
        const addr = data.result?.address ?? {};
        setLocation({ lat, lon, city: addr.city || addr.town || addr.village || '', country: addr.country || '' });
      } catch { setLocation({ lat, lon }); }
    }, () => setLocEnabled(false));
  }, [locationEnabled]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!input.trim() || loading) return;
    const prompt = input.trim();
    setInput('');
    const announce = (text: string) => { setAnn(text); play(text); };
    if (directAgent) await sendDirect(directAgent, prompt, announce);
    else await sendCommand(prompt, announce, userLocation ?? undefined, sessionId.current);
  };

  const handleInputChange = (val: string) => {
    const match = val.match(/^\/(\w+)\s+/);
    if (match) {
      const found = DIRECT_AGENTS.find(a => a.id === match[1].toLowerCase());
      if (found) { setDirectAgent(found.id); setInput(val.slice(match[0].length)); return; }
    }
    if (val === '/exit') { setDirectAgent(null); setInput(''); return; }
    setInput(val);
  };

  const handleFeedback = async (msg: NexusMessage, rating: number) => {
    try {
      await fetch('/api/feedback', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ agent: msg.agent?.toLowerCase() ?? 'vega', prompt: '', response: msg.content, rating }),
      });
    } catch {}
  };

  const accentColor = activeAgent?.color ?? '#00ffd5';

  return (
    <div className="flex flex-col relative" style={{ height: '100%', overflow: 'hidden', background: 'var(--bg-panel)' }}>
      {showChats && <ConversationsPanel onClose={() => setShowChats(false)} />}

      {live.isLive && (
        <LiveModePanel isLive={true} phase={live.phase} lastTranscript={live.lastTranscript}
          lastAgent={live.lastAgent} lastAgentText={live.lastAgentText} liveHistory={live.liveHistory}
          onStart={live.startLive} onStop={live.stopLive} />
      )}

      {/* Agent grid */}
      <AgentGrid activeAgents={loading ? (directAgent ? [directAgent] : lastRouting) : []} />

      {/* Voice */}
      {(isPlaying || isFetching) && <ApexVoiceIndicator isPlaying={isPlaying} isFetching={isFetching} text={lastAnnouncement} />}

      {/* Command feed */}
      <CommandFeed messages={messages} onFeedback={handleFeedback} />

      {/* Quick commands — only when empty */}
      {messages.length === 0 && !directAgent && (
        <div style={{ padding: '0 16px 12px', display: 'flex', flexDirection: 'column', gap: '10px' }}>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px' }}>
            {QUICK_COMMANDS.map(cmd => (
              <button key={cmd} onClick={() => { setInput(cmd); inputRef.current?.focus(); }}
                style={{ padding: '5px 12px', fontSize: '12px', fontFamily: 'inherit', fontWeight: 500,
                  borderRadius: '7px',
                  border: '1px solid rgba(0,190,255,0.12)', color: 'rgba(100,160,200,0.65)', background: 'transparent', cursor: 'pointer', transition: 'all 0.15s' }}
                onMouseEnter={e => { e.currentTarget.style.borderColor = 'rgba(0,190,255,0.28)'; e.currentTarget.style.color = '#00d9ff'; e.currentTarget.style.background = 'rgba(0,190,255,0.05)'; }}
                onMouseLeave={e => { e.currentTarget.style.borderColor = 'rgba(0,190,255,0.12)'; e.currentTarget.style.color = 'rgba(100,160,200,0.65)'; e.currentTarget.style.background = 'transparent'; }}>
                {cmd}
              </button>
            ))}
          </div>

          {/* Action shortcuts */}
          <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
            {[
              { label: 'Forge Train',    color: '#ff7a2a', onClick: () => { setInput('forge train'); inputRef.current?.focus(); } },
              { label: 'Start Project',  color: '#00d9ff', onClick: () => { setInput('start project '); inputRef.current?.focus(); } },
              { label: 'Run Project',    color: '#38bdf8', onClick: () => { setInput('run project '); inputRef.current?.focus(); } },
              { label: 'Team Nexus',     color: '#fbbf24', onClick: () => { setInput('team nexus '); inputRef.current?.focus(); } },
            ].map(s => (
              <button key={s.label} onClick={s.onClick}
                style={{ padding: '6px 14px', fontSize: '12px', fontFamily: 'inherit', fontWeight: 600,
                  borderRadius: '8px',
                  border: `1px solid ${s.color}28`, color: s.color, background: `${s.color}08`, cursor: 'pointer', transition: 'all 0.15s' }}
                onMouseEnter={e => { e.currentTarget.style.background = `${s.color}14`; }}
                onMouseLeave={e => { e.currentTarget.style.background = `${s.color}08`; }}>
                {s.label}
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Direct agent bar */}
      <div style={{ display: 'flex', alignItems: 'center', gap: '5px', padding: '7px 16px', borderTop: '1px solid rgba(0,190,255,0.07)', background: 'rgba(6,9,15,0.85)', flexShrink: 0, flexWrap: 'wrap' }}>
        <span style={{ fontSize: '10px', color: 'rgba(120,160,200,0.35)', letterSpacing: '0.1em', marginRight: '4px', fontWeight: 500 }}>DIRECT →</span>
        {DIRECT_AGENTS.map(agent => {
          const isActive = directAgent === agent.id;
          return (
            <button key={agent.id} onClick={() => { setDirectAgent(isActive ? null : agent.id); setInput(''); inputRef.current?.focus(); }}
              title={agent.hint}
              style={{ padding: '4px 10px 4px 5px', fontSize: '11px', fontFamily: 'inherit', fontWeight: 600, letterSpacing: '0.04em',
                borderRadius: '20px',
                border: `1px solid ${isActive ? agent.color : `${agent.color}25`}`,
                color: isActive ? '#000' : `${agent.color}cc`,
                background: isActive ? agent.color : `${agent.color}09`,
                boxShadow: isActive ? `0 0 12px ${agent.color}35` : 'none',
                cursor: 'pointer', transition: 'all 0.15s',
                display: 'flex', alignItems: 'center', gap: '6px' }}>
              <div style={{ borderRadius: '50%', overflow: 'hidden', width: 22, height: 22, flexShrink: 0,
                filter: isActive ? 'none' : undefined }}>
                <AgentAvatar id={agent.id} size={22} active={isActive} />
              </div>
              {agent.name}
            </button>
          );
        })}
        {directAgent && (
          <button onClick={() => { setDirectAgent(null); setInput(''); }}
            style={{ padding: '4px 10px', fontSize: '11px', fontFamily: 'inherit', fontWeight: 500, borderRadius: '6px',
              border: '1px solid rgba(244,63,94,0.22)', color: 'rgba(244,63,94,0.6)', background: 'transparent', cursor: 'pointer', transition: 'all 0.15s' }}
            onMouseEnter={e => (e.currentTarget.style.color = '#f43f5e')}
            onMouseLeave={e => (e.currentTarget.style.color = 'rgba(244,63,94,0.6)')}>✕ Exit</button>
        )}
        <div style={{ flex: 1 }} />
        <button onClick={() => setShowChats(true)} style={{ padding: '4px 12px', fontSize: '11px', fontFamily: 'inherit', fontWeight: 500, borderRadius: '6px',
          border: '1px solid rgba(0,190,255,0.14)', color: 'rgba(100,160,200,0.6)', background: 'transparent', cursor: 'pointer', transition: 'all 0.15s' }}
          onMouseEnter={e => { e.currentTarget.style.color = '#00d9ff'; e.currentTarget.style.borderColor = 'rgba(0,190,255,0.3)'; }}
          onMouseLeave={e => { e.currentTarget.style.color = 'rgba(100,160,200,0.6)'; e.currentTarget.style.borderColor = 'rgba(0,190,255,0.14)'; }}>
          Sessions
        </button>
        {messages.length > 0 && !loading && (
          <button onClick={clearMessages} style={{ padding: '4px 10px', fontSize: '11px', fontFamily: 'inherit', fontWeight: 500, borderRadius: '6px',
            border: '1px solid rgba(244,63,94,0.15)', color: 'rgba(244,63,94,0.4)', background: 'transparent', cursor: 'pointer', transition: 'all 0.15s' }}
            onMouseEnter={e => (e.currentTarget.style.color = '#f43f5e')}
            onMouseLeave={e => (e.currentTarget.style.color = 'rgba(244,63,94,0.4)')}>Clear</button>
        )}
      </div>

      {/* Input form */}
      <form onSubmit={handleSubmit} style={{
        padding: '10px 16px 12px',
        borderTop: `1px solid ${activeAgent ? `${accentColor}22` : 'rgba(0,190,255,0.08)'}`,
        background: 'rgba(6,9,15,0.92)',
        flexShrink: 0,
      }}>
        {activeAgent && (
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '8px' }}>
            <div style={{ padding: '3px 12px 3px 5px', fontSize: '11px', fontWeight: 600, letterSpacing: '0.04em',
              borderRadius: '20px',
              border: `1px solid ${activeAgent.color}35`, color: activeAgent.color, background: `${activeAgent.color}0e`,
              display: 'flex', alignItems: 'center', gap: '7px' }}>
              <AgentAvatar id={activeAgent.id} size={22} active={true} />
              {activeAgent.name}
            </div>
            <span style={{ fontSize: '11px', color: 'rgba(180,200,220,0.35)' }}>{activeAgent.hint}</span>
            <button type="button" onClick={() => { setDirectAgent(null); setInput(''); }}
              style={{ marginLeft: 'auto', padding: '3px 10px', fontSize: '11px', fontFamily: 'inherit', borderRadius: '6px',
                border: '1px solid rgba(244,63,94,0.2)', color: 'rgba(244,63,94,0.5)', background: 'transparent', cursor: 'pointer' }}
              onMouseEnter={e => (e.currentTarget.style.color = '#f43f5e')}
              onMouseLeave={e => (e.currentTarget.style.color = 'rgba(244,63,94,0.5)')}>✕ Exit</button>
          </div>
        )}

        <div style={{ display: 'flex', gap: '8px', alignItems: 'flex-end' }}>
          <div style={{ flex: 1, position: 'relative' }}>
            <textarea
              ref={inputRef}
              rows={1}
              value={input}
              onChange={e => {
                handleInputChange(e.target.value);
                e.target.style.height = 'auto';
                e.target.style.height = Math.min(e.target.scrollHeight, 120) + 'px';
              }}
              onKeyDown={e => {
                if (e.key === 'Escape' && loading) { stop(); return; }
                if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleSubmit(e as unknown as React.FormEvent); }
              }}
              placeholder={directAgent ? `Message ${activeAgent?.name}...` : 'Ask NEXUS anything... (Enter to send, Shift+Enter for new line)'}
              style={{
                width: '100%', fontFamily: 'inherit', fontSize: '14px', resize: 'none', outline: 'none',
                color: 'var(--text-1)', caretColor: activeAgent ? accentColor : 'var(--accent)',
                border: `1px solid ${activeAgent ? `${accentColor}30` : 'rgba(0,190,255,0.14)'}`,
                background: 'rgba(15,23,36,0.8)',
                padding: '10px 14px', lineHeight: '1.55', borderRadius: '8px',
                boxShadow: input ? `0 0 0 3px ${accentColor}08` : 'none',
                overflowY: 'hidden', opacity: loading ? 0.7 : 1, transition: 'all 0.2s',
              }}
            />
          </div>

          {/* Controls */}
          <div style={{ display: 'flex', gap: '5px', flexShrink: 0, alignItems: 'flex-end' }}>
            <button type="button" onClick={() => setLocEnabled(v => !v)}
              title={locationEnabled ? `Location: ${userLocation?.city ?? '...'}` : 'Location off'}
              style={{ padding: '9px 10px', borderRadius: '8px', border: `1px solid ${locationEnabled ? (userLocation ? 'rgba(34,211,168,0.35)' : 'rgba(251,191,36,0.35)') : 'rgba(0,190,255,0.12)'}`,
                color: locationEnabled ? (userLocation ? '#22d3a8' : '#fbbf24') : 'rgba(120,160,200,0.4)',
                background: 'transparent', cursor: 'pointer', fontSize: '13px', transition: 'all 0.2s' }}>
              📍
            </button>

            <button type="button" onClick={toggleListening}
              style={{ padding: '9px 11px', borderRadius: '8px',
                border: `1px solid ${isListening ? 'rgba(244,63,94,0.45)' : 'rgba(0,190,255,0.14)'}`,
                color: isListening ? '#f43f5e' : 'rgba(120,160,200,0.4)',
                background: isListening ? 'rgba(244,63,94,0.07)' : 'transparent',
                cursor: 'pointer', fontSize: '13px',
                boxShadow: isListening ? '0 0 12px rgba(244,63,94,0.2)' : 'none',
                animation: isListening ? 'pulse 1s infinite' : 'none', transition: 'all 0.2s' }}>
              {isListening ? '◉' : '🎙'}
            </button>

            <button type="button" onClick={live.startLive}
              style={{ padding: '9px 13px', fontFamily: 'inherit', fontWeight: 600, fontSize: '11px', letterSpacing: '0.08em',
                borderRadius: '8px',
                border: '1px solid rgba(34,211,168,0.25)', color: '#22d3a8',
                background: 'rgba(34,211,168,0.05)', cursor: 'pointer', transition: 'all 0.2s' }}
              onMouseEnter={e => { e.currentTarget.style.background = 'rgba(34,211,168,0.1)'; }}
              onMouseLeave={e => { e.currentTarget.style.background = 'rgba(34,211,168,0.05)'; }}>
              <span style={{ marginRight: '4px', animation: 'pulse 2s infinite', fontSize: '7px' }}>●</span>LIVE
            </button>

            {loading ? (
              <button type="button" onClick={stop}
                style={{ padding: '9px 18px', fontSize: '12px', fontFamily: 'inherit', fontWeight: 600, letterSpacing: '0.06em',
                  borderRadius: '8px',
                  border: '1px solid rgba(244,63,94,0.45)', color: '#f43f5e',
                  background: 'rgba(244,63,94,0.08)', cursor: 'pointer', animation: 'pulse 1s infinite' }}>
                ⬛ Stop
              </button>
            ) : (
              <button type="submit" disabled={!input.trim()}
                style={{ padding: '9px 22px', fontSize: '13px', fontFamily: 'inherit', fontWeight: 600, letterSpacing: '0.04em',
                  borderRadius: '8px',
                  border: `1px solid ${!input.trim() ? 'rgba(0,190,255,0.1)' : `${accentColor}55`}`,
                  color: !input.trim() ? 'rgba(120,160,200,0.3)' : '#000',
                  background: !input.trim() ? 'rgba(0,190,255,0.06)' : accentColor,
                  cursor: input.trim() ? 'pointer' : 'default', opacity: !input.trim() ? 0.5 : 1,
                  boxShadow: input.trim() ? `0 0 16px ${accentColor}30` : 'none', transition: 'all 0.2s' }}>
                Send
              </button>
            )}
          </div>
        </div>
      </form>
    </div>
  );
}
