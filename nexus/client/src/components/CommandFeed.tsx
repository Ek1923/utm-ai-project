import { useRef, useEffect, useState, useCallback } from 'react';
import { NexusMessage } from '../types/nexus';
import { AgentAvatar } from './AgentAvatar';

const AGENT_COLOR: Record<string, string> = {
  apex1: '#00ffd5', apex2: '#b400ff', forge: '#ff6b00',
  spark: '#ffb800', atlas: '#00b4ff', tactix: '#00ff9d',
  vega: '#ff2d55', nexus_ui: '#a78bfa', optic: '#a78bfa', jarvis: '#c8a86b',
};
const AGENT_ICON: Record<string, string> = {
  apex1: '◈', apex2: '◉', forge: '</>',
  spark: '✦', atlas: '◎', tactix: '⬡',
  vega: '★', nexus_ui: '◉', optic: '◉', jarvis: '◈',
};
const AGENT_ROLE: Record<string, string> = {
  apex1: 'GENERAL', apex2: 'GENERAL', forge: 'DEVELOPER',
  spark: 'CREATIVE', atlas: 'KNOWLEDGE', tactix: 'STRATEGY',
  vega: 'VICE-GEN', nexus_ui: 'DATA', optic: 'DATA', jarvis: 'PROJECTS',
};
const ACTION_META: Record<string, { label: string; icon: string; color: string }> = {
  open_app:        { label: 'Open App',      icon: '🖥',  color: '#00b4ff' },
  open_folder:     { label: 'Open Folder',   icon: '📁',  color: '#ffb800' },
  open_file:       { label: 'Open File',     icon: '📄',  color: '#00ff9d' },
  open_url:        { label: 'Open URL',      icon: '🌐',  color: '#00ffd5' },
  close_app:       { label: 'Close App',     icon: '✕',   color: '#ff2d55' },
  write_file:      { label: 'Write File',    icon: '✏',   color: '#b400ff' },
  create_folder:   { label: 'New Folder',    icon: '📂',  color: '#ff6b00' },
  take_screenshot: { label: 'Screenshot',    icon: '📸',  color: '#00ff9d' },
  adjust_volume:   { label: 'Volume',        icon: '🔊',  color: '#00ffd5' },
  run_command:     { label: 'Run Command',   icon: '⚡',  color: '#ff2d55' },
  type_text:       { label: 'Type Text',     icon: '⌨',   color: '#00ffd5' },
  hotkey:          { label: 'Hotkey',        icon: '⎘',   color: '#00b4ff' },
  speak:           { label: 'Speak',         icon: '🔊',  color: '#b400ff' },
  notify:          { label: 'Notify',        icon: '🔔',  color: '#ffb800' },
  lock_pc:         { label: 'Lock PC',       icon: '🔒',  color: '#ff2d55' },
  set_wallpaper:   { label: 'Wallpaper',     icon: '🖼',  color: '#ffb800' },
  winget_install:  { label: 'Install',       icon: '📦',  color: '#00ff9d' },
};

type ActionState = 'pending' | 'executing' | { ok: boolean; message: string };

function parseActions(content: string): { cleanText: string; actions: { action: string; param: string }[] } {
  const actions: { action: string; param: string }[] = [];
  const cleanText = content.replace(/\[NEXUS_ACTION:([^:\]]+):([^\]]*)\]/g, (_, action, param) => {
    actions.push({ action, param });
    return '';
  }).trim();
  return { cleanText, actions };
}

function renderText(text: string, neon: string): React.ReactNode {
  if (!text) return null;
  const segments: React.ReactNode[] = [];
  let rest = text;
  let key = 0;

  // Match code blocks first
  while (rest.length > 0) {
    const codeBlock = rest.match(/^([\s\S]*?)```(\w*)\n([\s\S]*?)```([\s\S]*)$/);
    if (codeBlock) {
      const [, before, lang, code, after] = codeBlock;
      if (before) segments.push(<span key={key++}>{renderInline(before, neon)}</span>);
      segments.push(
        <div key={key++} style={{ margin: '10px 0', background: 'rgba(0,0,0,0.45)', border: '1px solid rgba(255,255,255,0.08)', borderLeft: `2px solid ${neon}45`, borderRadius: '0 6px 6px 0' }}>
          {lang && <div style={{ padding: '5px 12px 3px', fontSize: '10px', color: `${neon}70`, letterSpacing: '0.12em', borderBottom: '1px solid rgba(255,255,255,0.05)', fontFamily: "'Cascadia Code', Consolas, monospace" }}>{lang.toUpperCase()}</div>}
          <pre style={{ padding: '10px 14px', margin: 0, fontSize: '12px', lineHeight: '1.7', color: 'rgba(220,235,255,0.9)', overflow: 'auto', fontFamily: "'Cascadia Code', 'Consolas', 'Fira Code', monospace" }}>{code.trimEnd()}</pre>
        </div>
      );
      rest = after;
    } else {
      segments.push(<span key={key++}>{renderInline(rest, neon)}</span>);
      break;
    }
  }
  return <>{segments}</>;
}

function renderInline(text: string, neon: string): React.ReactNode {
  const parts = text.split(/(`[^`]+`|\*\*[^*]+\*\*)/);
  return parts.map((part, i) => {
    if (part.startsWith('`') && part.endsWith('`') && part.length > 2)
      return <code key={i} style={{ background: 'rgba(0,0,0,0.4)', border: '1px solid rgba(255,255,255,0.1)', padding: '2px 6px', fontSize: '12px', color: neon, fontFamily: "'Cascadia Code', Consolas, monospace", borderRadius: '4px' }}>{part.slice(1, -1)}</code>;
    if (part.startsWith('**') && part.endsWith('**') && part.length > 4)
      return <strong key={i} style={{ color: neon, fontWeight: 600 }}>{part.slice(2, -2)}</strong>;
    return <span key={i}>{part}</span>;
  });
}

interface CommandFeedProps {
  messages: NexusMessage[];
  onFeedback?: (msg: NexusMessage, rating: number) => void;
}

export function CommandFeed({ messages, onFeedback }: CommandFeedProps) {
  const bottomRef  = useRef<HTMLDivElement>(null);
  const scrollRef  = useRef<HTMLDivElement>(null);
  const stickRef   = useRef(true);
  const [voted, setVoted]               = useState<Record<number, 1 | 0 | 'sending'>>({});
  const [actionStates, setActionStates] = useState<Record<string, ActionState>>({});
  const requireConfirmRef               = useRef(true);

  useEffect(() => {
    fetch('/api/config').then(r => r.json())
      .then(d => { requireConfirmRef.current = d.config?.requireActionConfirmation ?? true; })
      .catch(() => {});
  }, []);

  const handleVote = useCallback(async (msg: NexusMessage, rating: 1 | 0) => {
    if (voted[msg.timestamp] !== undefined) return;
    setVoted(v => ({ ...v, [msg.timestamp]: 'sending' }));
    if (onFeedback) await onFeedback(msg, rating);
    setVoted(v => ({ ...v, [msg.timestamp]: rating }));
  }, [voted, onFeedback]);

  useEffect(() => {
    if (stickRef.current) bottomRef.current?.scrollIntoView({ behavior: 'auto' });
  }, [messages]);

  if (messages.length === 0) {
    return (
      <div className="flex-1 flex flex-col items-center justify-center gap-5 p-8">
        {/* Orb glow */}
        <div style={{ position: 'relative', marginBottom: '4px' }}>
          <div style={{
            width: '64px', height: '64px', borderRadius: '50%',
            background: 'radial-gradient(circle at 40% 35%, rgba(0,217,255,0.22), rgba(0,100,200,0.08) 60%, transparent)',
            border: '1px solid rgba(0,217,255,0.2)',
            boxShadow: '0 0 32px rgba(0,217,255,0.12), inset 0 0 20px rgba(0,217,255,0.06)',
            animation: 'pulse 3s ease-in-out infinite',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
          }}>
            <span style={{ fontFamily: "'Cascadia Code', Consolas, monospace", fontSize: '18px', color: '#00d9ff', opacity: 0.8 }}>◈</span>
          </div>
          {/* Ring */}
          <div style={{
            position: 'absolute', inset: '-8px', borderRadius: '50%',
            border: '1px solid rgba(0,217,255,0.08)',
            animation: 'pulse 4s ease-in-out 0.5s infinite',
          }} />
        </div>
        <div style={{ textAlign: 'center' }}>
          <div style={{ fontSize: '22px', fontWeight: 700, color: '#ddeeff', letterSpacing: '0.25em', marginBottom: '8px' }}>NEXUS</div>
          <div style={{ fontSize: '12px', color: 'rgba(120,160,200,0.5)', letterSpacing: '0.15em', fontFamily: "'Cascadia Code', Consolas, monospace" }}>MULTI-AGENT AI SYSTEM — READY</div>
        </div>
        <div style={{ display: 'flex', gap: '5px', marginTop: '4px' }}>
          {[...Array(6)].map((_, i) => (
            <div key={i} style={{ width: 4, height: 4, borderRadius: '50%', background: 'rgba(0,190,255,0.22)', animation: `pulse 1.8s ease-in-out ${i * 0.18}s infinite` }} />
          ))}
        </div>
      </div>
    );
  }

  return (
    <div
      ref={scrollRef}
      onScroll={() => {
        const el = scrollRef.current;
        if (el) stickRef.current = el.scrollHeight - el.scrollTop - el.clientHeight < 80;
      }}
      className="flex-1 overflow-y-auto"
      style={{ padding: '14px 0' }}
    >
      {messages.map((msg, i) => {

        /* ── USER ─────────────────────────────────────────── */
        if (msg.role === 'user') {
          return (
            <div key={i} style={{ padding: '6px 16px 6px 50px', display: 'flex', justifyContent: 'flex-end' }}>
              <div style={{ maxWidth: '68%' }}>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'flex-end', gap: '6px', marginBottom: '3px' }}>
                  <span style={{ color: 'rgba(160,196,255,0.4)', fontSize: '8px', letterSpacing: '0.15em' }}>
                    {new Date(msg.timestamp).toLocaleTimeString('nl-NL', { hour12: false })}
                  </span>
                  <span style={{ color: 'rgba(160,196,255,0.5)', fontSize: '8px', fontWeight: 700, letterSpacing: '0.2em' }}>YOU</span>
                  <div style={{ width: 5, height: 5, clipPath: 'polygon(50%0%,100%50%,50%100%,0%50%)', background: 'rgba(160,196,255,0.5)' }} />
                </div>
                <div style={{ padding: '10px 14px', background: 'rgba(160,196,255,0.07)', border: '1px solid rgba(160,196,255,0.16)', borderRadius: '12px 12px 4px 12px', color: '#c8dcff', fontSize: '14px', lineHeight: 1.65, textAlign: 'right' }}>
                  {msg.content}
                </div>
              </div>
            </div>
          );
        }

        /* ── ROUTING ──────────────────────────────────────── */
        if (msg.role === 'routing') {
          const agents = msg.content.split(' — ')[0].split(', ');
          return (
            <div key={i} style={{ padding: '8px 16px', display: 'flex', alignItems: 'center', gap: '8px' }}>
              <div style={{ height: '1px', flex: 1, background: 'linear-gradient(to right, rgba(255,184,0,0.3), transparent)' }} />
              <div style={{ display: 'flex', alignItems: 'center', gap: '5px', flexShrink: 0 }}>
                <span style={{ color: 'rgba(255,184,0,0.5)', fontSize: '8px', letterSpacing: '0.15em' }}>ROUTING</span>
                <div style={{ display: 'flex', gap: '3px' }}>
                  {agents.map(a => {
                    const id = a.trim().toLowerCase().replace('-', '_').replace('-','_');
                    const color = AGENT_COLOR[id] ?? '#00ffd5';
                    return (
                      <div key={a} style={{ padding: '2px 7px', fontSize: '8px', fontWeight: 700, letterSpacing: '0.12em',
                        border: `1px solid ${color}50`, color, background: `${color}10` }}>
                        {a.trim()}
                      </div>
                    );
                  })}
                </div>
              </div>
              <div style={{ height: '1px', flex: 1, background: 'linear-gradient(to left, rgba(255,184,0,0.3), transparent)' }} />
            </div>
          );
        }

        /* ── SYNTHESIS ────────────────────────────────────── */
        if (msg.role === 'synthesis') {
          const { cleanText, actions } = parseActions(msg.content || '');
          const isTyping = !msg.content || msg.content.length < 10;
          return (
            <div key={i} style={{ padding: '4px 16px 10px' }}>
              <div style={{ border: '1px solid rgba(0,255,213,0.15)', background: 'linear-gradient(135deg, rgba(0,255,213,0.04) 0%, rgba(0,0,0,0) 60%)', borderRadius: '2px' }}>
                <div style={{ padding: '6px 12px', borderBottom: '1px solid rgba(0,255,213,0.1)', display: 'flex', alignItems: 'center', gap: '6px' }}>
                  <div style={{ width: 5, height: 5, borderRadius: '50%', background: '#00ffd5', boxShadow: '0 0 6px #00ffd5', animation: isTyping ? 'pulse 0.8s infinite' : 'none' }} />
                  <span style={{ color: '#00ffd5', fontSize: '9px', fontWeight: 700, letterSpacing: '0.2em', textShadow: '0 0 6px #00ffd5' }}>NEXUS SYNTHESIS</span>
                  <div style={{ flex: 1, height: '1px', background: 'linear-gradient(90deg, rgba(0,255,213,0.3), transparent)' }} />
                  <span style={{ color: 'rgba(0,255,213,0.35)', fontSize: '8px' }}>{new Date(msg.timestamp).toLocaleTimeString('nl-NL', { hour12: false })}</span>
                </div>
                <div style={{ padding: '10px 14px', fontSize: '14px', lineHeight: 1.75, color: 'rgba(220,240,255,0.88)' }}>
                  {isTyping ? <span style={{ color: '#00ffd5', animation: 'pulse 0.8s steps(1) infinite' }}>▋</span> : renderText(cleanText, '#00ffd5')}
                </div>
                {actions.map((act, ai) => (
                  <ActionCard key={ai} action={act.action} param={act.param}
                    stateKey={`${msg.timestamp}_s_${ai}`} actionStates={actionStates} setActionStates={setActionStates}
                    requireConfirmation={requireConfirmRef.current} />
                ))}
              </div>
            </div>
          );
        }

        /* ── AGENT ────────────────────────────────────────── */
        if (msg.role === 'agent' || msg.role === 'apex2') {
          const agentId   = msg.agent?.toLowerCase() ?? 'vega';
          const neon      = AGENT_COLOR[agentId] ?? '#00ffd5';
          const icon      = AGENT_ICON[agentId] ?? '◈';
          const role      = AGENT_ROLE[agentId] ?? '';
          const name      = msg.agent?.toUpperCase() ?? 'AGENT';
          const isTyping  = !msg.content || msg.content.length < 8;
          const { cleanText, actions } = parseActions(msg.content || '');

          return (
            <div key={i} style={{ padding: '4px 16px 10px', display: 'flex', gap: '10px' }}>
              {/* Left: avatar + line */}
              <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', flexShrink: 0, width: '32px' }}>
                <AgentAvatar id={agentId} size={32} active={isTyping} />
                <div style={{ flex: 1, width: '1px', background: `${neon}12`, marginTop: '3px', minHeight: '10px' }} />
              </div>

              {/* Right: content */}
              <div style={{ flex: 1, minWidth: 0 }}>
                {/* Header */}
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '6px' }}>
                  <span style={{ color: neon, fontSize: '12px', fontWeight: 600, letterSpacing: '0.06em' }}>{name}</span>
                  <span style={{ color: `${neon}60`, fontSize: '10px', fontFamily: "'Cascadia Code', Consolas, monospace" }}>{icon}</span>
                  <span style={{ color: 'rgba(180,200,220,0.3)', fontSize: '10px', letterSpacing: '0.1em', textTransform: 'uppercase' }}>{role}</span>
                  <div style={{ flex: 1, height: '1px', background: `linear-gradient(to right, ${neon}15, transparent)` }} />
                  <span style={{ color: 'rgba(180,200,220,0.3)', fontSize: '10px' }}>{new Date(msg.timestamp).toLocaleTimeString('nl-NL', { hour12: false })}</span>
                </div>

                {/* Body */}
                <div style={{ paddingLeft: '8px', borderLeft: `1px solid ${neon}20` }}>
                  {isTyping
                    ? <span style={{ color: neon, animation: 'pulse 0.8s steps(1) infinite' }}>▋</span>
                    : <div style={{ fontSize: '14px', lineHeight: 1.75, color: 'rgba(218,232,248,0.92)', wordBreak: 'break-word' }}>
                        {renderText(cleanText, neon)}
                      </div>
                  }

                  {/* Actions */}
                  {actions.map((act, ai) => (
                    <ActionCard key={ai} action={act.action} param={act.param}
                      stateKey={`${msg.timestamp}_${ai}`} actionStates={actionStates} setActionStates={setActionStates}
                      requireConfirmation={requireConfirmRef.current} />
                  ))}

                  {/* Feedback */}
                  {onFeedback && cleanText.trim().length > 0 && (
                    <FeedbackButtons msg={msg} state={voted[msg.timestamp]} onVote={handleVote} neon={neon} />
                  )}
                </div>
              </div>
            </div>
          );
        }

        /* ── PROJECT BUILD ────────────────────────────────── */
        if (msg.role === 'project') {
          const lines  = msg.content.split('\n').filter(Boolean);
          const isDone = msg.content.includes('[NEXUS] ✓');
          const agentColors: Record<string, string> = {
            NEXUS: '#00ffd5', FORGE: '#ff6b00', TACTIX: '#00ff9d', SPARK: '#ffb800', ATLAS: '#00b4ff',
          };
          return (
            <div key={i} style={{ padding: '4px 16px 10px', display: 'flex', gap: '10px' }}>
              <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', flexShrink: 0, width: '32px' }}>
                <div style={{ width: 32, height: 32, display: 'flex', alignItems: 'center', justifyContent: 'center', border: '1px solid rgba(0,255,213,0.3)', color: '#00ffd5', fontSize: '12px', fontWeight: 700, flexShrink: 0, animation: isDone ? 'none' : 'pulse 1s infinite', boxShadow: isDone ? 'none' : '0 0 8px rgba(0,255,213,0.3)' }}>N</div>
                <div style={{ flex: 1, width: '1px', background: 'rgba(0,255,213,0.08)', marginTop: '3px', minHeight: '10px' }} />
              </div>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '6px', marginBottom: '5px' }}>
                  <span style={{ color: '#00ffd5', fontSize: '10px', fontWeight: 700, letterSpacing: '0.12em', textShadow: '0 0 5px #00ffd5' }}>PROJECT BUILD</span>
                  {isDone && <span style={{ padding: '1px 6px', fontSize: '7px', fontWeight: 700, letterSpacing: '0.15em', background: 'rgba(0,255,157,0.08)', border: '1px solid rgba(0,255,157,0.3)', color: '#00ff9d' }}>COMPLETE</span>}
                  <div style={{ flex: 1, height: '1px', background: 'linear-gradient(to right, rgba(0,255,213,0.2), transparent)' }} />
                  <span style={{ color: 'rgba(255,255,255,0.18)', fontSize: '8px' }}>{new Date(msg.timestamp).toLocaleTimeString('nl-NL', { hour12: false })}</span>
                </div>
                <div style={{ paddingLeft: '8px', borderLeft: '1px solid rgba(0,255,213,0.12)', maxHeight: '280px', overflowY: 'auto' }}>
                  {lines.map((line, li) => {
                    const agentMatch = line.match(/^\[([A-Z0-9_]+)\]/);
                    const agentKey   = agentMatch?.[1] ?? 'NEXUS';
                    const color      = agentColors[agentKey] ?? '#00ffd5';
                    const isFile     = line.includes('File written:');
                    const isOk       = line.includes('✓');
                    return (
                      <div key={li} style={{ display: 'flex', gap: '8px', fontSize: '10px', lineHeight: '1.7' }}>
                        {agentMatch && <span style={{ color, minWidth: '50px', fontSize: '9px', fontWeight: 700, textShadow: `0 0 4px ${color}50` }}>{`[${agentKey}]`}</span>}
                        <span style={{ color: isOk ? '#00ff9d' : isFile ? '#ffb800' : 'rgba(180,200,220,0.75)', fontWeight: isFile || isOk ? 700 : 400 }}>
                          {agentMatch ? line.slice(agentMatch[0].length + 1) : line}
                        </span>
                      </div>
                    );
                  })}
                </div>
                {msg.meta?.projectDir && (
                  <div style={{ marginTop: '6px', padding: '6px 10px', background: 'rgba(0,255,157,0.04)', border: '1px solid rgba(0,255,157,0.15)', color: '#00ff9d', fontSize: '10px', letterSpacing: '0.08em' }}>
                    <span style={{ opacity: 0.5, fontSize: '8px', letterSpacing: '0.15em' }}>PROJECT DIR  </span>
                    {msg.meta.projectDir}
                  </div>
                )}
              </div>
            </div>
          );
        }

        /* ── TERMINAL RUN ─────────────────────────────────── */
        if (msg.role === 'run') {
          const lines    = msg.content.split('\n');
          const isDone   = msg.content.includes('✓ KLAAR') || msg.content.includes('✗ Mislukt');
          const isFailed = msg.content.includes('✗ Mislukt');
          return (
            <div key={i} style={{ padding: '4px 16px 10px', display: 'flex', gap: '10px' }}>
              <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', flexShrink: 0, width: '32px' }}>
                <div style={{ width: 32, height: 32, display: 'flex', alignItems: 'center', justifyContent: 'center', border: '1px solid rgba(0,180,255,0.3)', color: '#00b4ff', fontSize: '12px', fontWeight: 700, flexShrink: 0, animation: isDone ? 'none' : 'pulse 1s infinite', boxShadow: isDone ? 'none' : '0 0 8px rgba(0,180,255,0.25)' }}>▶</div>
                <div style={{ flex: 1, width: '1px', background: 'rgba(0,180,255,0.08)', marginTop: '3px', minHeight: '10px' }} />
              </div>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '6px', marginBottom: '5px' }}>
                  <span style={{ color: '#00b4ff', fontSize: '10px', fontWeight: 700, letterSpacing: '0.12em', textShadow: '0 0 5px #00b4ff' }}>TERMINAL</span>
                  {isDone && (
                    <span style={{ padding: '1px 6px', fontSize: '7px', fontWeight: 700, letterSpacing: '0.15em',
                      background: isFailed ? 'rgba(255,45,85,0.08)' : 'rgba(0,255,157,0.08)',
                      border: `1px solid ${isFailed ? 'rgba(255,45,85,0.3)' : 'rgba(0,255,157,0.3)'}`,
                      color: isFailed ? '#ff2d55' : '#00ff9d' }}>
                      {isFailed ? 'FAILED' : 'DONE'}
                    </span>
                  )}
                  <div style={{ flex: 1, height: '1px', background: 'linear-gradient(to right, rgba(0,180,255,0.2), transparent)' }} />
                </div>
                <div style={{ paddingLeft: '8px', borderLeft: '1px solid rgba(0,180,255,0.12)', background: 'rgba(0,2,8,0.55)', padding: '8px 12px', maxHeight: '360px', overflowY: 'auto' }}>
                  {lines.map((line, li) => {
                    const isCmd     = line.startsWith('▸');
                    const isOk      = line.startsWith('✓');
                    const isErr     = line.startsWith('✗') || line.startsWith('❌');
                    const isWarn    = line.startsWith('⚠');
                    const c = isCmd ? '#00b4ff' : isOk ? '#00ff9d' : isErr ? '#ff2d55' : isWarn ? '#ffb800' : 'rgba(160,190,210,0.8)';
                    return (
                      <div key={li} style={{ fontSize: '10.5px', lineHeight: 1.65, color: c, fontFamily: 'monospace', fontWeight: isCmd || isOk || isErr ? 700 : 400 }}>
                        {line || ' '}
                      </div>
                    );
                  })}
                </div>
              </div>
            </div>
          );
        }

        /* ── TRAINING ─────────────────────────────────────── */
        if (msg.role === 'training') {
          const lines = msg.content.split('\n');
          return (
            <div key={i} style={{ padding: '4px 16px 10px', display: 'flex', gap: '10px' }}>
              <div style={{ flexShrink: 0, width: '32px', height: '32px', display: 'flex', alignItems: 'center', justifyContent: 'center', border: '1px solid rgba(255,107,0,0.3)', color: '#ff6b00', fontSize: '11px', fontWeight: 700, animation: 'pulse 1s infinite', boxShadow: '0 0 8px rgba(255,107,0,0.2)' }}>F</div>
              <div style={{ flex: 1 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '6px', marginBottom: '5px' }}>
                  <span style={{ color: '#ff6b00', fontSize: '10px', fontWeight: 700, letterSpacing: '0.12em', textShadow: '0 0 5px #ff6b00' }}>FORGE TRAINING</span>
                  <div style={{ flex: 1, height: '1px', background: 'linear-gradient(to right, rgba(255,107,0,0.2), transparent)' }} />
                </div>
                <div style={{ paddingLeft: '8px', borderLeft: '1px solid rgba(255,107,0,0.15)' }}>
                  {lines.map((line, li) => (
                    <div key={li} style={{ fontSize: '10.5px', lineHeight: 1.65, fontFamily: 'monospace',
                      color: line.includes('[error]') ? '#ff2d55' : line.includes('[warn]') ? '#ffb800' : line.includes('complete') || line.includes('done') || line.includes('sharper') ? '#00ff9d' : 'rgba(255,107,0,0.8)' }}>
                      {line || ' '}
                    </div>
                  ))}
                </div>
              </div>
            </div>
          );
        }

        /* ── ERROR ────────────────────────────────────────── */
        if (msg.role === 'error') {
          return (
            <div key={i} style={{ margin: '4px 16px', padding: '8px 12px', display: 'flex', alignItems: 'center', gap: '8px', border: '1px solid rgba(255,45,85,0.25)', background: 'rgba(255,45,85,0.04)', color: '#ff2d55' }}>
              <span style={{ animation: 'pulse 1s infinite', fontSize: '12px' }}>⚠</span>
              <span style={{ fontSize: '11px', letterSpacing: '0.04em' }}>{msg.content}</span>
            </div>
          );
        }

        return null;
      })}
      <div ref={bottomRef} />
    </div>
  );
}

/* ── ACTION CARD ──────────────────────────────────────────── */
interface ActionCardProps {
  action: string; param: string; stateKey: string;
  actionStates: Record<string, ActionState>;
  setActionStates: React.Dispatch<React.SetStateAction<Record<string, ActionState>>>;
  requireConfirmation?: boolean;
}

function ActionCard({ action, param, stateKey, actionStates, setActionStates, requireConfirmation = true }: ActionCardProps) {
  const state = actionStates[stateKey] ?? 'pending';
  const meta  = ACTION_META[action] ?? { label: action, icon: '⚡', color: '#00ffd5' };

  const execute = useCallback(async () => {
    setActionStates(s => ({ ...s, [stateKey]: 'executing' }));
    try {
      const res  = await fetch('/api/system/execute', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action, param }) });
      const data = await res.json();
      setActionStates(s => ({ ...s, [stateKey]: { ok: data.ok, message: data.message } }));
    } catch {
      setActionStates(s => ({ ...s, [stateKey]: { ok: false, message: 'Connection error' } }));
    }
  }, [action, param, stateKey, setActionStates]);

  useEffect(() => {
    if (!requireConfirmation && state === 'pending') execute();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [requireConfirmation]);

  const deny = () => setActionStates(s => ({ ...s, [stateKey]: { ok: false, message: 'Denied' } }));

  if (typeof state === 'object') {
    return (
      <div style={{ marginTop: '6px', padding: '5px 10px', display: 'flex', alignItems: 'center', gap: '6px',
        border: `1px solid ${state.ok ? 'rgba(0,255,157,0.2)' : 'rgba(255,45,85,0.2)'}`,
        background: state.ok ? 'rgba(0,255,157,0.04)' : 'rgba(255,45,85,0.04)',
        color: state.ok ? '#00ff9d' : '#ff2d55', fontSize: '10px' }}>
        <span>{meta.icon}</span>
        <span>{state.ok ? '✓' : '✗'} {state.message}</span>
      </div>
    );
  }

  return (
    <div style={{ marginTop: '6px', padding: '8px 10px', border: `1px solid ${meta.color}30`, background: `${meta.color}05` }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: '6px', marginBottom: state === 'pending' ? '6px' : '0' }}>
        <span style={{ fontSize: '12px' }}>{meta.icon}</span>
        <span style={{ color: meta.color, fontSize: '9px', fontWeight: 700, letterSpacing: '0.15em' }}>
          {meta.label.toUpperCase()}
        </span>
        {param && <span style={{ color: 'rgba(200,220,240,0.6)', fontSize: '9px', marginLeft: '2px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: '200px' }}>— {param}</span>}
        <div style={{ flex: 1 }} />
        {state === 'executing' && <span style={{ color: meta.color, fontSize: '8px', animation: 'pulse 0.8s infinite' }}>running...</span>}
      </div>
      {state === 'pending' && (
        <div style={{ display: 'flex', gap: '6px' }}>
          <button onClick={execute} style={{ flex: 1, padding: '4px 0', fontSize: '9px', fontFamily: 'inherit', fontWeight: 700, letterSpacing: '0.15em', cursor: 'pointer', border: '1px solid rgba(0,255,157,0.45)', color: '#00ff9d', background: 'rgba(0,255,157,0.07)' }}
            onMouseEnter={e => (e.currentTarget.style.background = 'rgba(0,255,157,0.16)')}
            onMouseLeave={e => (e.currentTarget.style.background = 'rgba(0,255,157,0.07)')}>✓ ALLOW</button>
          <button onClick={deny} style={{ flex: 1, padding: '4px 0', fontSize: '9px', fontFamily: 'inherit', fontWeight: 700, letterSpacing: '0.15em', cursor: 'pointer', border: '1px solid rgba(255,45,85,0.4)', color: '#ff2d55', background: 'rgba(255,45,85,0.07)' }}
            onMouseEnter={e => (e.currentTarget.style.background = 'rgba(255,45,85,0.15)')}
            onMouseLeave={e => (e.currentTarget.style.background = 'rgba(255,45,85,0.07)')}>✕ DENY</button>
        </div>
      )}
    </div>
  );
}

/* ── FEEDBACK ─────────────────────────────────────────────── */
interface FeedbackButtonsProps {
  msg: NexusMessage; state: 1 | 0 | 'sending' | undefined;
  onVote: (msg: NexusMessage, r: 1 | 0) => void; neon?: string;
}
function FeedbackButtons({ msg, state, onVote }: FeedbackButtonsProps) {
  const isSending = state === 'sending';
  if (state === 1 || state === 0) {
    return (
      <div style={{ marginTop: '5px', display: 'flex', alignItems: 'center' }}>
        <div style={{ padding: '2px 8px', fontSize: '8px', fontWeight: 700, letterSpacing: '0.15em',
          border: `1px solid ${state === 1 ? '#00ff9d' : '#ff2d55'}50`, color: state === 1 ? '#00ff9d' : '#ff2d55',
          background: state === 1 ? 'rgba(0,255,157,0.06)' : 'rgba(255,45,85,0.06)' }}>
          {state === 1 ? '✓ SAVED · FORGE LEARNS' : '✗ SAVED · FORGE AVOIDS'}
        </div>
      </div>
    );
  }
  return (
    <div style={{ marginTop: '5px', display: 'flex', gap: '4px', alignItems: 'center' }}>
      <button disabled={isSending} onClick={() => onVote(msg, 1)}
        style={{ padding: '2px 8px', fontSize: '8px', fontFamily: 'inherit', fontWeight: 700, letterSpacing: '0.15em', cursor: isSending ? 'wait' : 'pointer',
          border: '1px solid rgba(0,255,157,0.3)', color: '#00ff9d', background: 'rgba(0,255,157,0.04)', opacity: isSending ? 0.4 : 1 }}
        onMouseEnter={e => !isSending && (e.currentTarget.style.background = 'rgba(0,255,157,0.12)')}
        onMouseLeave={e => (e.currentTarget.style.background = 'rgba(0,255,157,0.04)')}>▲ CORRECT</button>
      <button disabled={isSending} onClick={() => onVote(msg, 0)}
        style={{ padding: '2px 8px', fontSize: '8px', fontFamily: 'inherit', fontWeight: 700, letterSpacing: '0.15em', cursor: isSending ? 'wait' : 'pointer',
          border: '1px solid rgba(255,45,85,0.3)', color: '#ff2d55', background: 'rgba(255,45,85,0.04)', opacity: isSending ? 0.4 : 1 }}
        onMouseEnter={e => !isSending && (e.currentTarget.style.background = 'rgba(255,45,85,0.12)')}
        onMouseLeave={e => (e.currentTarget.style.background = 'rgba(255,45,85,0.04)')}>▼ WRONG</button>
      {isSending && <span style={{ fontSize: '8px', color: 'rgba(255,255,255,0.2)', animation: 'pulse 1s infinite' }}>saving...</span>}
    </div>
  );
}
