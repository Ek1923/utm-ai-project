import { useEffect, useRef, useState, useCallback } from 'react';
import * as THREE from 'three';

type OrbState = 'idle' | 'listening' | 'thinking' | 'speaking';

function parseActions(text: string): { clean: string; actions: Array<{ action: string; param: string }> } {
  const actions: Array<{ action: string; param: string }> = [];
  const clean = text.replace(/\[NEXUS_ACTION:([^:\]]+):([^\]]*)\]/g, (_, action, param) => {
    actions.push({ action, param });
    return '';
  }).trim();
  return { clean, actions };
}

async function executeAction(action: string, param: string): Promise<string> {
  try {
    const res = await fetch('/api/system/execute', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action, param }),
    });
    const data = await res.json() as { ok: boolean; message?: string };
    return data.message ?? (data.ok ? '✓ Done' : '✗ Failed');
  } catch { return '✗ Connection error'; }
}

type ActionState = 'pending' | 'executing' | { ok: boolean; message: string };
type MsgFlowState = 'await_open' | 'opening' | 'await_send' | 'sending' | { ok: boolean; message: string };
const delay = (ms: number) => new Promise<void>(r => setTimeout(r, ms));

interface Line {
  id: number; role: 'user' | 'agent' | 'system' | 'action' | 'msgflow';
  text: string; partial?: boolean;
  action?: string; param?: string;
  app?: string; recipient?: string; message?: string;
}
interface SavedConvo { id: number; agent: string; prompt: string; response: string; timestamp: number; }
interface AgentStat { commands: number; feedback: number; trained: number; }

const TEAM = [
  { id: 'apex1',    name: 'APEX-1',   color: '#00ffd5', icon: '◈',   role: 'ROUTER'    },
  { id: 'forge',    name: 'FORGE',    color: '#ff6b00', icon: '</>',  role: 'DEVELOPER' },
  { id: 'spark',    name: 'SPARK',    color: '#ffb800', icon: '✦',   role: 'CREATIVE'  },
  { id: 'atlas',    name: 'ATLAS',    color: '#00b4ff', icon: '◎',   role: 'KNOWLEDGE' },
  { id: 'tactix',   name: 'TACTIX',   color: '#00ff9d', icon: '⬡',   role: 'STRATEGY'  },
  { id: 'vega',   name: 'VEGA',   color: '#ff2d55', icon: '★',  role: 'VICE-GEN'  },
  { id: 'optic',  name: 'OPTIC',  color: '#a78bfa', icon: '◉',  role: 'DATA'      },
  { id: 'jarvis', name: 'JARVIS', color: '#c8a86b', icon: '◈',  role: 'PROJECTS'  },
];

const STATE_COLOR: Record<OrbState, string> = { idle: '#00ffd5', listening: '#00ff9d', thinking: '#ffb800', speaking: '#b400ff' };
const STATE_HEX:   Record<OrbState, number> = { idle: 0x00ffd5,  listening: 0x00ff9d,  thinking: 0xffb800,  speaking: 0xb400ff };
const STATE_LABEL: Record<OrbState, string> = { idle: 'STANDBY', listening: 'LISTENING', thinking: 'PROCESSING', speaking: 'SPEAKING' };

const GREETING = "Hey Sir Ege, JARVIS online. All systems operational. How may I assist you today?";
const TTS_SPEED = 1.45;
const FORCE_AGENT = 'apex1';

let _lid = 0;
const nid = () => ++_lid;

function buildTimeContext(): string {
  const now = new Date();
  const days = ['Sunday','Monday','Tuesday','Wednesday','Thursday','Friday','Saturday'];
  const months = ['January','February','March','April','May','June','July','August','September','October','November','December'];
  const hh = now.getHours().toString().padStart(2,'0');
  const mm = now.getMinutes().toString().padStart(2,'0');
  const ss = now.getSeconds().toString().padStart(2,'0');
  const ampm = now.getHours() < 12 ? 'AM' : 'PM';
  const h12 = (now.getHours() % 12 || 12).toString().padStart(2,'0');
  const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
  return `Current date/time: ${days[now.getDay()]}, ${months[now.getMonth()]} ${now.getDate()}, ${now.getFullYear()} — ${hh}:${mm}:${ss} (${h12}:${mm} ${ampm}) — Timezone: ${tz}`;
}

async function buildAgentContext(): Promise<string> {
  const timeCtx = buildTimeContext();
  try {
    const [ar, sr] = await Promise.all([fetch('/api/agents'), fetch('/api/agents/stats')]);
    const ad = await ar.json();
    const sd = await sr.json();
    const agents: Array<{ id: string; loaded: boolean }> = ad.agents ?? [];
    const stats: Record<string, AgentStat> = sd.stats ?? {};
    const agentCtx = 'NEXUS Agent Status:\n' + agents.map(a => {
      const s = stats[a.id] ?? { commands: 0, feedback: 0, trained: 0 };
      return `${a.id.toUpperCase()} [${a.loaded ? 'ONLINE' : 'OFFLINE'}] — ${s.commands} cmds`;
    }).join('\n');
    return `${timeCtx}\n${agentCtx}`;
  } catch { return timeCtx; }
}

export function JarvisUI({ onClose }: { onClose: () => void }) {
  const [orbState, setOrbState]         = useState<OrbState>('idle');
  const [lines, setLines]               = useState<Line[]>([]);
  const [transcript, setTranscript]     = useState('');
  const [savedCount, setSaved]          = useState(0);
  const [showHistory, setHistory]       = useState(false);
  const [savedList, setSavedList]       = useState<SavedConvo[]>([]);
  const [actionStates, setActionStates] = useState<Map<number, ActionState>>(new Map());
  const [msgStates, setMsgStates]       = useState<Map<number, MsgFlowState>>(new Map());
  const [agentStats, setAgentStats]     = useState<Record<string, AgentStat>>({});
  const [clockStr, setClockStr]         = useState('');

  const logRef          = useRef<HTMLDivElement>(null);
  const recRef          = useRef<any>(null);
  const abortRef        = useRef<AbortController | null>(null);
  const audioRef        = useRef<HTMLAudioElement | null>(null);
  const lastPrompt      = useRef('');
  const linesRef        = useRef<Line[]>([]);
  const savedPromptsRef = useRef(new Set<string>());
  const startListenRef  = useRef<() => void>(() => {});
  const shouldListenRef = useRef(false);
  const requireConfirmRef     = useRef(true);
  const requireSendConfirmRef = useRef(true);

  useEffect(() => { linesRef.current = lines; }, [lines]);
  useEffect(() => { if (logRef.current) logRef.current.scrollTop = logRef.current.scrollHeight; }, [lines]);

  // Clock
  useEffect(() => {
    const tick = () => {
      const n = new Date();
      setClockStr(`${n.getHours().toString().padStart(2,'0')}:${n.getMinutes().toString().padStart(2,'0')}:${n.getSeconds().toString().padStart(2,'0')}`);
    };
    tick();
    const iv = setInterval(tick, 1000);
    return () => clearInterval(iv);
  }, []);

  // Agent stats
  useEffect(() => {
    const load = () => fetch('/api/agents/stats').then(r => r.json())
      .then(d => setAgentStats(d.stats ?? {})).catch(() => {});
    load();
    const iv = setInterval(load, 8000);
    return () => clearInterval(iv);
  }, []);

  useEffect(() => {
    if (window.speechSynthesis) {
      window.speechSynthesis.getVoices();
      window.speechSynthesis.onvoiceschanged = () => window.speechSynthesis.getVoices();
    }
  }, []);

  useEffect(() => {
    fetch('/api/config').then(r => r.json()).then(d => {
      requireConfirmRef.current     = d.config?.requireActionConfirmation ?? true;
      requireSendConfirmRef.current = d.config?.requireSendConfirmation ?? true;
    }).catch(() => {});
  }, []);

  const push = useCallback((l: Omit<Line, 'id'>) =>
    setLines(p => [...p, { ...l, id: nid() }]), []);

  const updatePartial = useCallback((id: number, text: string) =>
    setLines(p => p.map(l => l.id === id ? { ...l, text, partial: true } : l)), []);

  const finalizePartial = useCallback((id: number) =>
    setLines(p => p.map(l => l.id === id ? { ...l, partial: false } : l)), []);

  const handleActionApprove = useCallback(async (lineId: number, action: string, param: string) => {
    setActionStates(prev => new Map(prev).set(lineId, 'executing'));
    const msg = await executeAction(action, param);
    setActionStates(prev => new Map(prev).set(lineId, { ok: msg.startsWith('✓'), message: msg }));
  }, []);

  const handleActionDeny = useCallback((lineId: number) => {
    setActionStates(prev => new Map(prev).set(lineId, { ok: false, message: 'Denied' }));
  }, []);

  const setMsg = useCallback((lineId: number, s: MsgFlowState) =>
    setMsgStates(prev => new Map(prev).set(lineId, s)), []);

  const handleMsgSend = useCallback(async (lineId: number) => {
    setMsg(lineId, 'sending');
    const msg = await executeAction('send_enter', '');
    setMsg(lineId, { ok: msg.startsWith('✓'), message: msg.startsWith('✓') ? '✓ Sent' : msg });
  }, [setMsg]);

  const handleMsgOpen = useCallback(async (lineId: number, app: string, recipient: string, message: string) => {
    setMsg(lineId, 'opening');
    const opened = await executeAction('open_app', app);
    if (!opened.startsWith('✓')) { setMsg(lineId, { ok: false, message: opened }); return; }
    await delay(1500);
    if (recipient.trim()) {
      await executeAction('type_text', recipient.trim());
      await delay(800);
      await executeAction('send_enter', '');
      await delay(900);
    }
    const typed = await executeAction('type_text', message);
    if (!typed.startsWith('✓')) { setMsg(lineId, { ok: false, message: typed }); return; }
    if (requireSendConfirmRef.current) setMsg(lineId, 'await_send');
    else await handleMsgSend(lineId);
  }, [setMsg, handleMsgSend]);

  const handleMsgDeny = useCallback((lineId: number) => {
    setMsg(lineId, { ok: false, message: 'Denied' });
  }, [setMsg]);

  const saveTurn = useCallback(async (prompt: string, response: string) => {
    if (!prompt || !response || prompt === '__greeting__') return;
    savedPromptsRef.current.add(prompt);
    try {
      await fetch('/api/feedback', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ agent: FORCE_AGENT, prompt, response, rating: 1, comment: 'jarvis_live' }),
      });
      setSaved(c => c + 1);
    } catch {}
  }, []);

  const speakBrowser = (text: string) => new Promise<void>(resolve => {
    if (!window.speechSynthesis) { resolve(); return; }
    window.speechSynthesis.cancel();
    if (window.speechSynthesis.paused) window.speechSynthesis.resume();
    const utt = new SpeechSynthesisUtterance(text);
    utt.lang = 'en-US'; utt.rate = 1.15; utt.pitch = 0.85;
    const voices = window.speechSynthesis.getVoices();
    const v = voices.find(v => /george|ryan|james|daniel|oliver/i.test(v.name) && /en.GB|en-GB/i.test(v.lang))
           ?? voices.find(v => /en.GB|en-GB/i.test(v.lang))
           ?? voices.find(v => /david|mark|brian/i.test(v.name))
           ?? voices.find(v => v.lang === 'en-US')
           ?? voices[0];
    if (v) utt.voice = v;
    const timer = setTimeout(() => resolve(), 12000);
    const poll = setInterval(() => {
      if (!window.speechSynthesis.speaking && !window.speechSynthesis.pending) { clearInterval(poll); clearTimeout(timer); resolve(); }
    }, 250);
    utt.onend = utt.onerror = () => { clearTimeout(timer); clearInterval(poll); resolve(); };
    window.speechSynthesis.speak(utt);
  });

  const speak = useCallback(async (text: string, prompt = '') => {
    saveTurn(prompt, text);
    if (!text.trim()) { setOrbState('idle'); shouldListenRef.current = true; setTimeout(() => startListenRef.current(), 400); return; }
    setOrbState('speaking');
    let spoke = false;
    try {
      const ttsAbort = new AbortController();
      const ttsTimer = setTimeout(() => ttsAbort.abort(), 5000);
      const p = new URLSearchParams({ text: text.slice(0, 600), speed: String(TTS_SPEED) });
      const res = await fetch(`/api/voice/stream?${p}`, { signal: ttsAbort.signal });
      clearTimeout(ttsTimer);
      if (res.ok) {
        const url = URL.createObjectURL(await res.blob());
        if (audioRef.current) audioRef.current.pause();
        const audio = new Audio(url);
        audioRef.current = audio;
        await new Promise<void>(resolve => {
          audio.onended = () => { URL.revokeObjectURL(url); resolve(); };
          audio.onerror = () => resolve();
          audio.play().catch(() => resolve());
        });
        spoke = true;
      }
    } catch {}
    if (!spoke) await speakBrowser(text);
    setOrbState('idle');
    shouldListenRef.current = true;
    setTimeout(() => startListenRef.current(), 500);
  }, [saveTurn]);

  const send = useCallback(async (message: string) => {
    if (!message.trim()) return;
    if (abortRef.current) abortRef.current.abort();
    if (audioRef.current) { audioRef.current.pause(); audioRef.current = null; }
    window.speechSynthesis?.cancel();

    lastPrompt.current = message.trim();
    push({ role: 'user', text: message });
    setOrbState('thinking');
    setTranscript('');

    const abort = new AbortController();
    abortRef.current = abort;
    const systemContext = await buildAgentContext();

    try {
      const res = await fetch('/api/command', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: message.trim(), sessionId: 'jarvis', forceAgent: FORCE_AGENT, systemContext }),
        signal: abort.signal,
      });
      const reader = res.body!.getReader();
      const dec = new TextDecoder();
      let buf = '', lastText = '', partialId: number | null = null;

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buf += dec.decode(value, { stream: true });
        const parts = buf.split('\n\n'); buf = parts.pop() ?? '';
        for (const part of parts) {
          const ln = part.trim();
          if (!ln.startsWith('data:')) continue;
          let ev: any; try { ev = JSON.parse(ln.slice(5).trim()); } catch { continue; }

          if (ev.type === 'direct_start') {
            const id = nid();
            setLines(p => [...p, { id, role: 'agent', text: '', partial: true }]);
            partialId = id; lastText = '';
          }
          if (ev.type === 'token' && partialId !== null) {
            lastText += ev.data?.token ?? ''; updatePartial(partialId, lastText);
          }
          if (ev.type === 'agent_response') {
            const resp = ev.data?.response ?? '';
            const { clean: cleanResp } = parseActions(resp);
            if (partialId !== null) { finalizePartial(partialId); partialId = null; }
            else push({ role: 'agent', text: cleanResp });
            lastText = resp;
          }
          if (ev.type === 'done') {
            if (partialId !== null) { finalizePartial(partialId); partialId = null; }
            const { clean, actions } = parseActions(lastText);
            if (actions.length > 0) {
              setLines(p => {
                const revIdx = [...p].map((l, i) => ({ l, i })).reverse().find(({ l }) => l.role === 'agent')?.i;
                if (revIdx === undefined) return p;
                return p.map((l, i) => i === revIdx ? { ...l, text: clean } : l);
              });
              actions.forEach(({ action, param }) => {
                if (action === 'send_message') {
                  const [app = '', recipient = '', ...rest] = param.split('|');
                  const msg = rest.join('|');
                  const id = nid();
                  setLines(p => [...p, { id, role: 'msgflow', text: '', app: app.trim(), recipient, message: msg }]);
                  if (!requireConfirmRef.current) handleMsgOpen(id, app.trim(), recipient, msg);
                } else if (requireConfirmRef.current || action === 'run_command') {
                  setLines(p => [...p, { id: nid(), role: 'action', text: '', action, param }]);
                } else {
                  executeAction(action, param).then(msg => push({ role: 'system', text: `⚙ ${msg}` }));
                }
              });
            }
            speak(clean || lastText, lastPrompt.current);
          }
          if (ev.type === 'error') {
            push({ role: 'system', text: `[ERROR] ${ev.data?.error ?? 'Unknown'}` });
            setOrbState('idle');
            setTimeout(() => startListenRef.current(), 500);
          }
        }
      }
    } catch (err: any) {
      if (err?.name !== 'AbortError') {
        push({ role: 'system', text: '[CONNECTION LOST]' });
        setOrbState('idle');
        setTimeout(() => startListenRef.current(), 500);
      }
    }
  }, [push, updatePartial, finalizePartial, speak, handleMsgOpen]);

  const startListen = useCallback(() => {
    if (!shouldListenRef.current) return;
    const SR = (window as any).SpeechRecognition ?? (window as any).webkitSpeechRecognition;
    if (!SR || recRef.current) return;
    const rec = new SR();
    rec.lang = 'nl-NL'; rec.continuous = false; rec.interimResults = true;
    recRef.current = rec;
    let final = '';
    rec.onstart = () => {
      if (audioRef.current) { audioRef.current.pause(); audioRef.current = null; }
      window.speechSynthesis?.cancel();
      setOrbState('listening');
    };
    rec.onresult = (e: any) => {
      let interim = '';
      for (let i = e.resultIndex; i < e.results.length; i++) {
        const t = e.results[i][0].transcript;
        if (e.results[i].isFinal) final += t; else interim += t;
      }
      setTranscript(final + interim);
    };
    rec.onend = () => {
      recRef.current = null;
      const t = final.trim();
      setTranscript('');
      if (t) send(t);
      else if (shouldListenRef.current) setTimeout(() => startListenRef.current(), 300);
      else setOrbState('idle');
    };
    rec.onerror = (e: any) => {
      recRef.current = null; setTranscript('');
      if (e.error === 'no-speech') { if (shouldListenRef.current) setTimeout(() => startListenRef.current(), 300); }
      else { setOrbState('idle'); shouldListenRef.current = false; }
    };
    rec.start();
  }, [send]);

  useEffect(() => { startListenRef.current = startListen; }, [startListen]);

  useEffect(() => {
    const t = setTimeout(async () => {
      push({ role: 'agent', text: GREETING });
      await speak(GREETING, '__greeting__');
    }, 600);
    return () => clearTimeout(t);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleClose = useCallback(async () => {
    shouldListenRef.current = false;
    if (recRef.current) { try { recRef.current.stop(); } catch {} recRef.current = null; }
    if (abortRef.current) abortRef.current.abort();
    if (audioRef.current) { audioRef.current.pause(); audioRef.current = null; }
    window.speechSynthesis?.cancel();
    const ls = linesRef.current;
    for (let i = 0; i < ls.length; i++) {
      const l = ls[i];
      if (l.role === 'user' && !savedPromptsRef.current.has(l.text)) {
        const next = ls.slice(i + 1).find(x => x.role === 'agent' && !x.partial && x.text);
        if (next) {
          savedPromptsRef.current.add(l.text);
          try {
            await fetch('/api/feedback', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ agent: FORCE_AGENT, prompt: l.text, response: next.text, rating: 1, comment: 'jarvis_live' }),
            });
          } catch {}
        }
      }
    }
    onClose();
  }, [onClose]);

  const toggleListen = () => {
    if (orbState === 'listening') {
      shouldListenRef.current = false;
      if (recRef.current) { try { recRef.current.stop(); } catch {} recRef.current = null; }
      setOrbState('idle');
    } else if (orbState === 'idle') {
      shouldListenRef.current = true;
      startListen();
    }
  };

  const loadHistory = async () => {
    try { const d = await (await fetch('/api/feedback/jarvis')).json(); setSavedList(d.conversations ?? []); } catch { setSavedList([]); }
    setHistory(true);
  };
  const deleteAll = async () => {
    await fetch('/api/feedback/jarvis', { method: 'DELETE' });
    setSavedList([]); setSaved(0); setHistory(false);
  };
  const markDataset = async (id: number) => {
    await fetch(`/api/feedback/${id}/dataset`, { method: 'POST' });
    setSavedList(p => p.map(c => c.id === id ? { ...c, _dataset: true } as any : c));
  };
  const deleteOne = async (id: number) => {
    await fetch(`/api/feedback/${id}`, { method: 'DELETE' });
    setSavedList(p => p.filter(c => c.id !== id));
  };

  const orbColor = STATE_COLOR[orbState];
  const isBusy = orbState !== 'idle';
  const totalCmds = Object.values(agentStats).reduce((s, a) => s + a.commands, 0);

  return (
    <div style={{
      position: 'fixed', inset: 0, zIndex: 9999,
      background: 'radial-gradient(ellipse at 50% 30%, #00091a 0%, #000204 100%)',
      display: 'flex', flexDirection: 'column',
      fontFamily: '"Courier New", monospace', overflow: 'hidden',
    }}>
      {/* Scanlines overlay */}
      <div style={{ position: 'absolute', inset: 0, pointerEvents: 'none', zIndex: 1,
        background: 'repeating-linear-gradient(0deg,transparent,transparent 2px,rgba(0,255,213,0.008) 2px,rgba(0,255,213,0.008) 3px)' }} />

      {/* ── TOP BAR ── */}
      <div style={{
        height: '46px', flexShrink: 0, zIndex: 2,
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        padding: '0 20px',
        background: `linear-gradient(180deg, rgba(0,0,0,0.9) 0%, rgba(0,0,0,0.7) 100%)`,
        borderBottom: `1px solid ${orbColor}22`,
        transition: 'border-color 0.4s',
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '14px' }}>
          {/* Logo bars */}
          <div style={{ display: 'flex', gap: '3px', alignItems: 'flex-end' }}>
            {[26, 20, 14].map((h, i) => (
              <div key={i} style={{ width: '3px', height: h, background: [orbColor, '#0044cc', '#6600cc'][i], boxShadow: `0 0 5px ${[orbColor, '#0044cc', '#6600cc'][i]}`, transition: 'background 0.4s' }} />
            ))}
          </div>
          <div>
            <div style={{ color: orbColor, fontSize: '16px', fontWeight: 900, letterSpacing: '0.45em', textShadow: `0 0 16px ${orbColor}`, transition: 'all 0.4s' }}>
              J.A.R.V.I.S.
            </div>
            <div style={{ color: `${orbColor}40`, fontSize: '7px', letterSpacing: '0.3em', marginTop: '-2px' }}>
              NEXUS PERSONAL AI · APEX-1 CORE
            </div>
          </div>
          {/* Clock */}
          <div style={{ display: 'flex', gap: '6px', alignItems: 'center', marginLeft: '12px' }}>
            <div style={{ width: '1px', height: '20px', background: `${orbColor}25` }} />
            <span style={{ color: `${orbColor}70`, fontSize: '12px', fontWeight: 700, letterSpacing: '0.15em', fontVariantNumeric: 'tabular-nums' }}>{clockStr}</span>
          </div>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
          {/* State indicator */}
          <div style={{ display: 'flex', alignItems: 'center', gap: '6px',
            padding: '3px 10px', border: `1px solid ${orbColor}30`, background: `${orbColor}08` }}>
            <div style={{ width: 6, height: 6, borderRadius: '50%', background: orbColor,
              boxShadow: `0 0 8px ${orbColor}`, animation: isBusy ? 'pulse 0.7s ease-in-out infinite' : 'none' }} />
            <span style={{ color: orbColor, fontSize: '10px', fontWeight: 700, letterSpacing: '0.25em', textShadow: `0 0 6px ${orbColor}` }}>
              {STATE_LABEL[orbState]}
            </span>
          </div>

          {savedCount > 0 && (
            <button onClick={loadHistory} style={{ background: `rgba(0,255,157,0.06)`, border: '1px solid rgba(0,255,157,0.25)', padding: '4px 10px', color: '#00ff9d', fontSize: '9px', fontFamily: 'inherit', letterSpacing: '0.12em', cursor: 'pointer' }}>
              ▲ {savedCount}
            </button>
          )}

          <button onClick={handleClose} style={{ background: 'transparent', border: '1px solid rgba(255,45,85,0.35)', color: '#ff2d55', padding: '4px 14px', fontSize: '9px', fontFamily: 'inherit', fontWeight: 700, letterSpacing: '0.2em', cursor: 'pointer', transition: 'all 0.2s' }}
            onMouseEnter={e => { e.currentTarget.style.background = 'rgba(255,45,85,0.12)'; }}
            onMouseLeave={e => { e.currentTarget.style.background = 'transparent'; }}>
            ✕ CLOSE
          </button>
        </div>
      </div>

      {/* ── MAIN ROW ── */}
      <div style={{ flex: 1, display: 'flex', overflow: 'hidden', position: 'relative', zIndex: 2 }}>

        {/* LEFT: Chat log (290px) */}
        <div style={{ width: '290px', flexShrink: 0, display: 'flex', flexDirection: 'column', borderRight: `1px solid ${orbColor}12`, background: 'rgba(0,2,8,0.6)' }}>
          <div style={{ padding: '7px 14px', borderBottom: `1px solid ${orbColor}10`, display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexShrink: 0 }}>
            <span style={{ color: `${orbColor}50`, fontSize: '8px', letterSpacing: '0.25em', fontWeight: 700 }}>SESSION LOG</span>
            <button onClick={() => setLines([])} style={{ background: 'transparent', border: 'none', color: `rgba(255,45,85,0.2)`, fontSize: '8px', cursor: 'pointer', fontFamily: 'inherit', letterSpacing: '0.1em' }}
              onMouseEnter={e => (e.currentTarget.style.color = '#ff2d5560')}
              onMouseLeave={e => (e.currentTarget.style.color = 'rgba(255,45,85,0.2)')}>CLR</button>
          </div>

          <div ref={logRef} style={{ flex: 1, overflowY: 'auto', padding: '12px 10px', display: 'flex', flexDirection: 'column', gap: '14px' }}>
            {lines.map(l => {
              if (l.role === 'action') return (
                <JarvisActionCard key={l.id} lineId={l.id} action={l.action ?? ''} param={l.param ?? ''}
                  state={actionStates.get(l.id) ?? 'pending'}
                  onApprove={handleActionApprove} onDeny={handleActionDeny} />
              );
              if (l.role === 'msgflow') return (
                <JarvisMessageCard key={l.id} lineId={l.id} app={l.app ?? ''} recipient={l.recipient ?? ''} message={l.message ?? ''}
                  state={msgStates.get(l.id) ?? 'await_open'}
                  onOpen={handleMsgOpen} onSend={handleMsgSend} onDeny={handleMsgDeny} />
              );
              return <ChatLine key={l.id} line={l} orbColor={orbColor} />;
            })}
          </div>
        </div>

        {/* CENTER: Orb + HUD */}
        <div style={{ flex: 1, position: 'relative', overflow: 'hidden' }}>
          <JarvisOrb orbState={orbState} />

          {/* Live transcript */}
          {transcript && (
            <div style={{ position: 'absolute', bottom: '80px', left: '50%', transform: 'translateX(-50%)',
              maxWidth: '65%', textAlign: 'center', pointerEvents: 'none', zIndex: 5 }}>
              <div style={{ color: '#00ff9d', fontSize: '13px', letterSpacing: '0.05em',
                textShadow: '0 0 14px #00ff9d', fontStyle: 'italic',
                background: 'rgba(0,0,0,0.5)', padding: '4px 14px', border: '1px solid rgba(0,255,157,0.2)' }}>
                "{transcript}"
              </div>
            </div>
          )}

          {/* Bottom: voice button + HUD */}
          <div style={{ position: 'absolute', bottom: '20px', left: '50%', transform: 'translateX(-50%)',
            display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '12px', zIndex: 5 }}>
            {/* Mic button */}
            <button
              onClick={isBusy ? () => { abortRef.current?.abort(); setOrbState('idle'); } : toggleListen}
              style={{
                width: '64px', height: '64px',
                borderRadius: '50%',
                border: `2px solid ${orbState === 'listening' ? '#f43f5e' : orbColor}`,
                background: orbState === 'listening'
                  ? 'rgba(244,63,94,0.12)'
                  : isBusy
                  ? `${orbColor}12`
                  : `${orbColor}10`,
                color: orbState === 'listening' ? '#f43f5e' : orbColor,
                fontSize: '22px',
                cursor: 'pointer',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                boxShadow: orbState === 'listening'
                  ? '0 0 30px rgba(244,63,94,0.35), 0 0 60px rgba(244,63,94,0.15)'
                  : `0 0 24px ${orbColor}30, 0 0 50px ${orbColor}12`,
                animation: orbState === 'listening' ? 'pulse 0.9s ease-in-out infinite' : 'none',
                transition: 'all 0.3s',
              }}
            >
              {isBusy && orbState !== 'listening' ? '⬛' : orbState === 'listening' ? '◉' : '🎙'}
            </button>

            {/* HUD text */}
            <div style={{ textAlign: 'center', pointerEvents: 'none' }}>
              <div style={{ color: orbColor, fontSize: '11px', fontWeight: 700, letterSpacing: '0.4em',
                textShadow: `0 0 10px ${orbColor}`, transition: 'all 0.4s' }}>APEX-1</div>
              <div style={{ color: `${orbColor}50`, fontSize: '8px', letterSpacing: '0.18em', marginTop: '3px' }}>
                {orbState === 'listening' ? '● MICROPHONE ACTIVE'
                  : orbState === 'thinking' ? '◌ PROCESSING...'
                  : orbState === 'speaking' ? '▶ SPEAKING...'
                  : `${totalCmds} COMMANDS PROCESSED`}
              </div>
            </div>
          </div>

          {/* Top-right HUD tags */}
          <div style={{ position: 'absolute', top: '12px', right: '12px', display: 'flex', flexDirection: 'column', gap: '4px', pointerEvents: 'none', zIndex: 5 }}>
            {[
              { label: 'NEXUS', val: 'ONLINE', color: '#00ff9d' },
              { label: 'OLLAMA', val: 'LOCAL', color: '#00b4ff' },
              { label: 'TTS', val: 'READY', color: '#ffb800' },
            ].map(s => (
              <div key={s.label} style={{ display: 'flex', gap: '6px', alignItems: 'center' }}>
                <div style={{ width: 4, height: 4, borderRadius: '50%', background: s.color, boxShadow: `0 0 4px ${s.color}` }} />
                <span style={{ color: `${s.color}60`, fontSize: '7px', letterSpacing: '0.15em' }}>{s.label}</span>
                <span style={{ color: `${s.color}90`, fontSize: '7px', letterSpacing: '0.1em' }}>{s.val}</span>
              </div>
            ))}
          </div>
        </div>

        {/* RIGHT: Team panel (210px) */}
        <div style={{ width: '210px', flexShrink: 0, display: 'flex', flexDirection: 'column', borderLeft: `1px solid ${orbColor}12`, background: 'rgba(0,2,8,0.6)' }}>
          <div style={{ padding: '7px 14px', borderBottom: `1px solid ${orbColor}10`, flexShrink: 0 }}>
            <span style={{ color: `${orbColor}50`, fontSize: '8px', letterSpacing: '0.25em', fontWeight: 700 }}>NEXUS TEAM</span>
          </div>

          <div style={{ flex: 1, overflowY: 'auto', padding: '8px 0' }}>
            {TEAM.map(agent => {
              const stats = agentStats[agent.id];
              const cmds = stats?.commands ?? 0;
              const isActive = orbState === 'thinking' && agent.id === 'apex1';
              return (
                <div key={agent.id} style={{
                  padding: '8px 14px',
                  display: 'flex', alignItems: 'center', gap: '8px',
                  borderLeft: `2px solid ${isActive ? agent.color : 'transparent'}`,
                  background: isActive ? `${agent.color}06` : 'transparent',
                  transition: 'all 0.3s',
                  marginBottom: '1px',
                }}>
                  <div style={{
                    width: 6, height: 6, borderRadius: '50%', flexShrink: 0,
                    background: agent.color,
                    boxShadow: `0 0 ${isActive ? 8 : 4}px ${agent.color}`,
                    animation: isActive ? 'pulse 0.8s ease-in-out infinite' : 'none',
                    opacity: cmds > 0 ? 1 : 0.4,
                  }} />
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                      <span style={{ color: agent.color, fontSize: '9px', fontWeight: 700, letterSpacing: '0.1em', textShadow: isActive ? `0 0 6px ${agent.color}` : 'none' }}>
                        {agent.name}
                      </span>
                      <span style={{ color: `${agent.color}50`, fontSize: '7px' }}>{cmds > 0 ? cmds : '—'}</span>
                    </div>
                    <div style={{ color: `rgba(255,255,255,0.2)`, fontSize: '7px', letterSpacing: '0.12em', marginTop: '1px' }}>
                      {agent.role}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>

          {/* Team stats */}
          <div style={{ padding: '8px 14px', borderTop: `1px solid ${orbColor}10`, flexShrink: 0 }}>
            {[
              { label: 'AGENTS', val: TEAM.length.toString() },
              { label: 'TOTAL CMDS', val: totalCmds > 0 ? totalCmds.toString() : '0' },
              { label: 'SAVED', val: savedCount.toString() },
            ].map(s => (
              <div key={s.label} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '4px' }}>
                <span style={{ color: 'rgba(255,255,255,0.15)', fontSize: '7px', letterSpacing: '0.15em' }}>{s.label}</span>
                <span style={{ color: `${orbColor}70`, fontSize: '9px', fontWeight: 700, letterSpacing: '0.1em' }}>{s.val}</span>
              </div>
            ))}
          </div>
        </div>
      </div>


      {/* ── HISTORY OVERLAY ── */}
      {showHistory && (
        <div style={{ position: 'absolute', inset: 0, zIndex: 100, background: 'rgba(0,3,10,0.97)', display: 'flex', flexDirection: 'column' }}>
          <div style={{ padding: '14px 24px', borderBottom: '1px solid rgba(0,255,213,0.12)', display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexShrink: 0 }}>
            <span style={{ color: '#00ffd5', fontSize: '12px', fontWeight: 700, letterSpacing: '0.3em' }}>SAVED SESSIONS ({savedList.length})</span>
            <div style={{ display: 'flex', gap: '8px' }}>
              <button onClick={deleteAll} style={{ background: 'rgba(255,45,85,0.07)', border: '1px solid rgba(255,45,85,0.25)', color: '#ff2d55', padding: '4px 12px', fontSize: '9px', fontFamily: 'inherit', letterSpacing: '0.15em', cursor: 'pointer' }}>✕ CLEAR ALL</button>
              <button onClick={() => setHistory(false)} style={{ background: 'transparent', border: '1px solid rgba(0,255,213,0.18)', color: '#00ffd5', padding: '4px 12px', fontSize: '9px', fontFamily: 'inherit', letterSpacing: '0.15em', cursor: 'pointer' }}>← BACK</button>
            </div>
          </div>
          <div style={{ flex: 1, overflowY: 'auto', padding: '14px 24px', display: 'flex', flexDirection: 'column', gap: '10px' }}>
            {savedList.length === 0 && (
              <div style={{ color: '#0a1820', textAlign: 'center', marginTop: '40px', fontSize: '11px', letterSpacing: '0.15em' }}>NO SESSIONS FOUND</div>
            )}
            {savedList.map(c => (
              <div key={c.id} style={{ border: '1px solid rgba(0,255,213,0.07)', background: 'rgba(0,255,213,0.015)', padding: '10px 12px', display: 'flex', flexDirection: 'column', gap: '5px' }}>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                  <span style={{ color: 'rgba(0,255,213,0.4)', fontSize: '8px', letterSpacing: '0.2em' }}>{new Date(c.timestamp).toLocaleString('nl-NL')}</span>
                  <div style={{ display: 'flex', gap: '5px' }}>
                    <button onClick={() => markDataset(c.id)} style={{ background: 'rgba(0,255,157,0.05)', border: '1px solid rgba(0,255,157,0.2)', color: '#00ff9d', padding: '2px 8px', fontSize: '8px', fontFamily: 'inherit', cursor: 'pointer', letterSpacing: '0.1em' }}>▲ DATASET</button>
                    <button onClick={() => deleteOne(c.id)} style={{ background: 'transparent', border: '1px solid rgba(255,45,85,0.18)', color: 'rgba(255,45,85,0.5)', padding: '2px 6px', fontSize: '8px', fontFamily: 'inherit', cursor: 'pointer' }}>✕</button>
                  </div>
                </div>
                <div style={{ color: '#9abcda', fontSize: '11px' }}>▶ {c.prompt}</div>
                <div style={{ color: '#00ffd5', fontSize: '10px', opacity: 0.6, borderLeft: '2px solid rgba(0,255,213,0.15)', paddingLeft: '7px', lineHeight: 1.5 }}>{c.response.slice(0, 200)}{c.response.length > 200 ? '...' : ''}</div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

/* ─── Action card ────────────────────────────────────────── */
const ACTION_META: Record<string, { label: string; icon: string; color: string }> = {
  open_app: { label: 'Open App', icon: '🖥', color: '#00ffd5' }, open_url: { label: 'Open URL', icon: '🌐', color: '#00b4ff' },
  open_folder: { label: 'Open Folder', icon: '📁', color: '#ffb800' }, take_screenshot: { label: 'Screenshot', icon: '📸', color: '#00ff9d' },
  close_app: { label: 'Close App', icon: '✕', color: '#ff6b00' }, write_file: { label: 'Write File', icon: '✏', color: '#b400ff' },
  create_folder: { label: 'Create Folder', icon: '📂', color: '#ffb800' }, adjust_volume: { label: 'Volume', icon: '🔊', color: '#00ffd5' },
  type_text: { label: 'Type Text', icon: '⌨', color: '#00ff9d' }, hotkey: { label: 'Hotkey', icon: '⎘', color: '#00b4ff' },
  click: { label: 'Mouse Click', icon: '🖱', color: '#00b4ff' }, run_command: { label: 'Run Command', icon: '⚡', color: '#ff2d55' },
  speak: { label: 'Text-to-Speech', icon: '🔊', color: '#b400ff' }, notify: { label: 'Notification', icon: '🔔', color: '#ffb800' },
};

function JarvisActionCard({ lineId, action, param, state, onApprove, onDeny }: {
  lineId: number; action: string; param: string; state: ActionState;
  onApprove: (id: number, action: string, param: string) => void;
  onDeny: (id: number) => void;
}) {
  const meta = ACTION_META[action] ?? { label: action, icon: '⚙', color: '#00ffd5' };
  const isDone = typeof state === 'object';
  const isExec = state === 'executing';

  return (
    <div style={{ border: `1px solid ${meta.color}28`, background: `${meta.color}05`, padding: '8px 10px', display: 'flex', flexDirection: 'column', gap: '6px' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: '5px' }}>
        <span style={{ fontSize: '10px' }}>{meta.icon}</span>
        <span style={{ color: meta.color, fontSize: '8px', fontWeight: 700, letterSpacing: '0.2em', textShadow: `0 0 5px ${meta.color}` }}>
          ACTION — {meta.label.toUpperCase()}
        </span>
      </div>
      {param && <div style={{ fontSize: '9px', color: `${meta.color}70`, paddingLeft: '3px', wordBreak: 'break-all' }}>{param}</div>}
      {!isDone && !isExec && (
        <div style={{ display: 'flex', gap: '5px' }}>
          <button onClick={() => onApprove(lineId, action, param)} style={{ flex: 1, padding: '3px 0', fontSize: '8px', fontFamily: 'inherit', fontWeight: 700, letterSpacing: '0.15em', cursor: 'pointer', background: `${meta.color}12`, border: `1px solid ${meta.color}45`, color: meta.color }}
            onMouseEnter={e => (e.currentTarget.style.background = `${meta.color}22`)}
            onMouseLeave={e => (e.currentTarget.style.background = `${meta.color}12`)}>✓ ALLOW</button>
          <button onClick={() => onDeny(lineId)} style={{ flex: 1, padding: '3px 0', fontSize: '8px', fontFamily: 'inherit', fontWeight: 700, letterSpacing: '0.15em', cursor: 'pointer', background: 'rgba(255,45,85,0.05)', border: '1px solid rgba(255,45,85,0.25)', color: '#ff2d55' }}
            onMouseEnter={e => (e.currentTarget.style.background = 'rgba(255,45,85,0.12)')}
            onMouseLeave={e => (e.currentTarget.style.background = 'rgba(255,45,85,0.05)')}>✕ DENY</button>
        </div>
      )}
      {isExec && <div style={{ fontSize: '8px', color: `${meta.color}70`, letterSpacing: '0.15em', animation: 'pulse 0.8s infinite' }}>⟳ EXECUTING...</div>}
      {isDone && <div style={{ fontSize: '8px', letterSpacing: '0.12em', color: (state as any).ok ? '#00ff9d' : '#ff2d55' }}>{(state as any).message}</div>}
    </div>
  );
}

/* ─── Message flow card ──────────────────────────────────── */
function JarvisMessageCard({ lineId, app, recipient, message, state, onOpen, onSend, onDeny }: {
  lineId: number; app: string; recipient: string; message: string; state: MsgFlowState;
  onOpen: (id: number, app: string, rec: string, msg: string) => void;
  onSend: (id: number) => void;
  onDeny: (id: number) => void;
}) {
  const color = '#00ff9d';
  const isDone = typeof state === 'object';

  const Btns = ({ onYes }: { onYes: () => void }) => (
    <div style={{ display: 'flex', gap: '5px' }}>
      <button onClick={onYes} style={{ flex: 1, padding: '3px 0', fontSize: '8px', fontFamily: 'inherit', fontWeight: 700, letterSpacing: '0.15em', cursor: 'pointer', background: `${color}12`, border: `1px solid ${color}45`, color }}
        onMouseEnter={e => (e.currentTarget.style.background = `${color}22`)}
        onMouseLeave={e => (e.currentTarget.style.background = `${color}12`)}>✓ ALLOW</button>
      <button onClick={() => onDeny(lineId)} style={{ flex: 1, padding: '3px 0', fontSize: '8px', fontFamily: 'inherit', fontWeight: 700, letterSpacing: '0.15em', cursor: 'pointer', background: 'rgba(255,45,85,0.05)', border: '1px solid rgba(255,45,85,0.25)', color: '#ff2d55' }}
        onMouseEnter={e => (e.currentTarget.style.background = 'rgba(255,45,85,0.12)')}
        onMouseLeave={e => (e.currentTarget.style.background = 'rgba(255,45,85,0.05)')}>✕ DENY</button>
    </div>
  );

  return (
    <div style={{ border: `1px solid ${color}25`, background: `${color}05`, padding: '8px 10px', display: 'flex', flexDirection: 'column', gap: '6px' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: '5px' }}>
        <span style={{ fontSize: '10px' }}>💬</span>
        <span style={{ color, fontSize: '8px', fontWeight: 700, letterSpacing: '0.2em', textShadow: `0 0 5px ${color}` }}>
          MSG — {app.toUpperCase()}{recipient ? ` → ${recipient.slice(0, 10).toUpperCase()}` : ''}
        </span>
      </div>
      <div style={{ fontSize: '9px', color: `${color}80`, paddingLeft: '3px', borderLeft: `2px solid ${color}20`, wordBreak: 'break-word' }}>"{message}"</div>
      {state === 'await_open' && (<><div style={{ fontSize: '8px', color: '#ffb800', letterSpacing: '0.1em' }}>STEP 1/2 — OPEN APP?</div><Btns onYes={() => onOpen(lineId, app, recipient, message)} /></>)}
      {state === 'opening'    && <div style={{ fontSize: '8px', color: `${color}70`, animation: 'pulse 0.8s infinite' }}>⟳ OPENING & TYPING...</div>}
      {state === 'await_send' && (<><div style={{ fontSize: '8px', color: '#ffb800', letterSpacing: '0.1em' }}>STEP 2/2 — SEND?</div><Btns onYes={() => onSend(lineId)} /></>)}
      {state === 'sending'    && <div style={{ fontSize: '8px', color: `${color}70`, animation: 'pulse 0.8s infinite' }}>⟳ SENDING...</div>}
      {isDone && <div style={{ fontSize: '8px', color: (state as any).ok ? '#00ff9d' : '#ff2d55' }}>{(state as any).message}</div>}
    </div>
  );
}

/* ─── Chat line ──────────────────────────────────────────── */
function ChatLine({ line, orbColor }: { line: Line; orbColor: string }) {
  const isUser  = line.role === 'user';
  const isSys   = line.role === 'system';
  const isAgent = line.role === 'agent';
  const color = isUser ? '#a0c4ff' : isSys ? 'rgba(255,255,255,0.15)' : orbColor;
  const label = isUser ? 'YOU' : isSys ? 'SYS' : 'JARVIS';

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: '5px' }}>
        {isAgent && <div style={{ width: 4, height: 4, borderRadius: '50%', background: orbColor, boxShadow: `0 0 5px ${orbColor}`, flexShrink: 0 }} />}
        <span style={{ color: `${color}55`, fontSize: '8px', fontWeight: 700, letterSpacing: '0.22em' }}>{label}</span>
        <div style={{ flex: 1, height: '1px', background: `linear-gradient(90deg, ${color}12, transparent)` }} />
      </div>
      <div style={{
        fontSize: '11px', lineHeight: 1.65, whiteSpace: 'pre-wrap', wordBreak: 'break-word',
        paddingLeft: isUser ? '0' : '8px',
        paddingRight: isUser ? '8px' : '0',
        borderLeft: isAgent ? `1px solid ${orbColor}15` : 'none',
        borderRight: isUser ? `1px solid rgba(160,196,255,0.15)` : 'none',
        color: isUser ? '#c8dcff' : isSys ? 'rgba(255,255,255,0.2)' : orbColor,
        textShadow: isAgent ? `0 0 5px ${orbColor}18` : 'none',
        textAlign: isUser ? 'right' : 'left',
      }}>
        {line.text}{line.partial && <span style={{ animation: 'pulse 0.8s steps(1) infinite', display: 'inline-block' }}>▋</span>}
      </div>
    </div>
  );
}

/* ─── Three.js orb ───────────────────────────────────────── */
function JarvisOrb({ orbState }: { orbState: OrbState }) {
  const mountRef = useRef<HTMLDivElement>(null);
  const frameRef = useRef<number>(0);
  const stateRef = useRef<OrbState>('idle');
  useEffect(() => { stateRef.current = orbState; }, [orbState]);

  useEffect(() => {
    const el = mountRef.current; if (!el) return;
    const W = el.clientWidth, H = el.clientHeight;
    const scene  = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(48, W / H, 0.1, 300);
    camera.position.set(0, 2, 26); camera.lookAt(0, 0, 0);
    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    renderer.setSize(W, H); renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.setClearColor(0x000000, 0);
    el.appendChild(renderer.domElement);

    scene.add(new THREE.AmbientLight(0x001020, 3));
    const pl = [new THREE.PointLight(0x00ffd5,5,80),new THREE.PointLight(0xb400ff,3,80),new THREE.PointLight(0x0055ff,3,80),new THREE.PointLight(0xff6b00,2,60)];
    pl[0].position.set(0,12,8); pl[1].position.set(-12,-4,6); pl[2].position.set(12,-4,-6); pl[3].position.set(0,-12,4);
    pl.forEach(l => scene.add(l));

    const coreGrp = new THREE.Group(); scene.add(coreGrp);
    const innerMat = new THREE.MeshStandardMaterial({ color: 0x00ffd5, emissive: 0x00ffd5, emissiveIntensity: 2.0, metalness: 0.95, roughness: 0.05 });
    const innerMesh = new THREE.Mesh(new THREE.IcosahedronGeometry(1.1, 4), innerMat); coreGrp.add(innerMesh);

    const shellMats: THREE.MeshBasicMaterial[] = [];
    [1.8,2.7,4.0].forEach((r,i) => {
      const m = new THREE.MeshBasicMaterial({ color: 0x00ffd5, wireframe: true, transparent: true, opacity: 0.13-i*0.035 });
      coreGrp.add(new THREE.Mesh(new THREE.IcosahedronGeometry(r,[2,1,0][i]), m)); shellMats.push(m);
    });

    const torusMats: THREE.MeshBasicMaterial[] = [], torusMeshes: THREE.Mesh[] = [];
    [[3.2,0.5,0],[4.6,1.2,1],[6.2,2.0,-0.6]].forEach(([r,rx,rz],i) => {
      const m = new THREE.MeshBasicMaterial({ color: 0x00ffd5, transparent: true, opacity: 0.28-i*0.07 });
      const mesh = new THREE.Mesh(new THREE.TorusGeometry(r,0.028,4,80), m);
      mesh.rotation.x = rx; mesh.rotation.z = rz;
      coreGrp.add(mesh); torusMats.push(m); torusMeshes.push(mesh);
    });

    const N = 2200;
    const pos = new Float32Array(N*3), cols = new Float32Array(N*3), phase = new Float32Array(N), radii = new Float32Array(N), spd = new Float32Array(N);
    const pal = [0x00ffd5,0x0055ff,0xb400ff,0x00b4ff,0x00ff9d].map(c => new THREE.Color(c));
    for (let i = 0; i < N; i++) {
      const r=5.5+Math.random()*9, th=Math.random()*Math.PI*2, ph=Math.acos(2*Math.random()-1);
      pos[i*3]=r*Math.sin(ph)*Math.cos(th); pos[i*3+1]=r*Math.sin(ph)*Math.sin(th); pos[i*3+2]=r*Math.cos(ph);
      phase[i]=Math.random()*Math.PI*2; radii[i]=r; spd[i]=0.002+Math.random()*0.005;
      const c=pal[i%pal.length]; cols[i*3]=c.r; cols[i*3+1]=c.g; cols[i*3+2]=c.b;
    }
    const pGeo=new THREE.BufferGeometry(), pBuf=new THREE.BufferAttribute(pos,3);
    pGeo.setAttribute('position',pBuf); pGeo.setAttribute('color',new THREE.BufferAttribute(cols,3));
    scene.add(new THREE.Points(pGeo,new THREE.PointsMaterial({size:0.065,vertexColors:true,transparent:true,opacity:0.75})));

    const lv: number[] = [];
    for(let i=0;i<250;i++){const a=Math.floor(Math.random()*N)*3,b=Math.floor(Math.random()*N)*3; lv.push(pos[a],pos[a+1],pos[a+2],pos[b],pos[b+1],pos[b+2]);}
    const lGeo=new THREE.BufferGeometry(); lGeo.setAttribute('position',new THREE.Float32BufferAttribute(lv,3));
    const lMat=new THREE.LineBasicMaterial({color:0x00ffd5,transparent:true,opacity:0.05}); scene.add(new THREE.LineSegments(lGeo,lMat));

    const oMat=new THREE.MeshBasicMaterial({color:0x00ffd5,transparent:true,opacity:0.1});
    const oRing=new THREE.Mesh(new THREE.TorusGeometry(8.5,0.025,4,6),oMat); scene.add(oRing);

    const grid=new THREE.GridHelper(80,50,0x001a33,0x000d1a); grid.position.y=-12;
    (Array.isArray(grid.material)?grid.material:[grid.material]).forEach((m:any)=>{m.transparent=true;m.opacity=0.4;});
    scene.add(grid);

    const sv: number[] = [];
    for(let i=0;i<2000;i++) sv.push((Math.random()-.5)*250,(Math.random()-.5)*250,(Math.random()-.5)*250);
    const sGeo=new THREE.BufferGeometry(); sGeo.setAttribute('position',new THREE.Float32BufferAttribute(sv,3));
    scene.add(new THREE.Points(sGeo,new THREE.PointsMaterial({color:0x334466,size:0.1,transparent:true,opacity:0.5})));

    const updateCol=(hex:number)=>{const c=new THREE.Color(hex);innerMat.color.set(c);innerMat.emissive.set(c);shellMats.forEach(m=>m.color.set(c));torusMats.forEach(m=>m.color.set(c));oMat.color.set(c);lMat.color.set(c);pl[0].color.set(c);};
    const clock=new THREE.Clock(); let prevState: OrbState='idle';
    function animate(){
      frameRef.current=requestAnimationFrame(animate);
      const t=clock.getElapsedTime(), state=stateRef.current;
      if(state!==prevState){updateCol(STATE_HEX[state]);prevState=state;}
      const s=state==='thinking'?2.5:state==='listening'?1.8:state==='speaking'?1.4:1.0;
      coreGrp.rotation.y+=0.004*s; coreGrp.rotation.x+=0.0025*s; innerMesh.rotation.z+=0.007*s;
      torusMeshes[0].rotation.z+=0.007*s; torusMeshes[1].rotation.z-=0.005*s; torusMeshes[1].rotation.y+=0.004*s;
      torusMeshes[2].rotation.x+=0.006*s; torusMeshes[2].rotation.z-=0.003*s;
      oRing.rotation.z+=0.002*s; oRing.rotation.x=Math.sin(t*.3)*.15;
      innerMat.emissiveIntensity=state==='speaking'?1.8+Math.sin(t*6)*.9:state==='thinking'?1.5+Math.sin(t*4)*.7:1.6+Math.sin(t*1.5)*.4;
      for(let i=0;i<N;i++){
        const ph=phase[i]+t*spd[i]*s, r=radii[i]+Math.sin(t*.5+phase[i])*.4, phi=phase[i]*.4+t*spd[i]*.55;
        pBuf.setXYZ(i,r*Math.sin(phi)*Math.cos(ph),r*Math.sin(phi)*Math.sin(ph),r*Math.cos(phi));
      }
      pBuf.needsUpdate=true;
      camera.position.y=2+Math.sin(t*.25)*.6;
      renderer.render(scene,camera);
    }
    animate();
    const onResize=()=>{const W2=el.clientWidth,H2=el.clientHeight;camera.aspect=W2/H2;camera.updateProjectionMatrix();renderer.setSize(W2,H2);};
    window.addEventListener('resize',onResize);
    return ()=>{cancelAnimationFrame(frameRef.current);window.removeEventListener('resize',onResize);renderer.dispose();if(el.contains(renderer.domElement))el.removeChild(renderer.domElement);};
  // eslint-disable-next-line react-hooks/exhaustive-deps
  },[]);

  return <div ref={mountRef} style={{width:'100%',height:'100%'}} />;
}
