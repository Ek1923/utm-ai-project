import { useRef, useState, useCallback } from 'react';
import { p } from '../config/personalization';

export type LivePhase = 'idle' | 'listening' | 'thinking' | 'speaking';

// Collect the final agent_response from the SSE stream
async function fetchAgentResponse(
  message: string,
  signal: AbortSignal
): Promise<{ agent: string; response: string }> {
  const res = await fetch('/api/command', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ message }),
    signal,
  });

  if (!res.body) throw new Error('No response body');
  const reader = res.body.getReader();
  const decoder = new TextDecoder();

  let agent = 'vega';
  let response = '';

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      const text = decoder.decode(value);
      for (const line of text.split('\n')) {
        if (!line.startsWith('data: ')) continue;
        try {
          const event = JSON.parse(line.slice(6));
          if (event.type === 'routing') agent = event.data.agents?.[0] ?? 'vega';
          if (event.type === 'agent_response') response = event.data.response ?? '';
        } catch { /* skip */ }
      }
    }
  } finally {
    reader.releaseLock();
  }

  return { agent, response };
}

// Speak text using browser TTS, returns Promise that resolves when done
function speak(text: string, rate = 0.95, pitch = 0.85): Promise<void> {
  return new Promise(resolve => {
    if (!window.speechSynthesis) { resolve(); return; }
    window.speechSynthesis.cancel();

    // Trim to ~400 chars for speed in conversation
    const trimmed = text.length > 500 ? text.slice(0, 480) + '...' : text;
    const utt = new SpeechSynthesisUtterance(trimmed);
    utt.rate = rate;
    utt.pitch = pitch;
    utt.volume = 1;

    const voices = window.speechSynthesis.getVoices();
    const preferred =
      voices.find(v => v.lang.startsWith('en') && (v.name.includes('David') || v.name.includes('Mark') || v.name.includes('Guy'))) ??
      voices.find(v => v.lang.startsWith('en')) ??
      voices[0];
    if (preferred) utt.voice = preferred;

    utt.onend = () => resolve();
    utt.onerror = () => resolve();
    window.speechSynthesis.speak(utt);
  });
}

// Listen for one speech result, returns transcript
function listenOnce(lang: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const SR = (window as any).SpeechRecognition ?? (window as any).webkitSpeechRecognition;
    if (!SR) { reject(new Error('Speech recognition not supported')); return; }

    const rec: any = new SR();
    rec.lang = lang;
    rec.continuous = false;
    rec.interimResults = false;
    rec.maxAlternatives = 1;

    let settled = false;
    rec.onresult = (e: any) => { settled = true; resolve(e.results[0][0].transcript.trim()); };
    rec.onerror = (e: any) => { if (!settled) { settled = true; reject(new Error(e.error)); } };
    rec.onend   = () => { if (!settled) { settled = true; resolve(''); } };
    rec.start();
  });
}

export interface LiveMessage {
  role: 'user' | 'agent';
  agent?: string;
  content: string;
}

export function useLiveMode(lang = p.system.liveModeLang) {
  const [isLive, setIsLive] = useState(false);
  const [phase, setPhase] = useState<LivePhase>('idle');
  const [lastTranscript, setLastTranscript] = useState('');
  const [lastAgent, setLastAgent] = useState('');
  const [lastAgentText, setLastAgentText] = useState('');
  const [liveHistory, setLiveHistory] = useState<LiveMessage[]>([]);

  const stopRef = useRef(false);
  const abortRef = useRef<AbortController | null>(null);

  const addHistory = (msg: LiveMessage) =>
    setLiveHistory(prev => [...prev, msg]);

  async function runLoop() {
    while (!stopRef.current) {
      // 1. Listen
      setPhase('listening');
      let transcript = '';
      try {
        transcript = await listenOnce(lang);
      } catch (err) {
        // Mic error or user said nothing — small pause then retry
        await new Promise(r => setTimeout(r, 1000));
        continue;
      }
      if (stopRef.current) break;
      if (!transcript) continue;

      setLastTranscript(transcript);
      addHistory({ role: 'user', content: transcript });

      // 2. Think — call AI
      setPhase('thinking');
      const ctrl = new AbortController();
      abortRef.current = ctrl;
      let agent = 'vega';
      let response = '';

      try {
        const result = await fetchAgentResponse(transcript, ctrl.signal);
        agent = result.agent;
        response = result.response;
      } catch (err: any) {
        if (err.name === 'AbortError' || stopRef.current) break;
        response = 'Ik had even een probleem. Probeer opnieuw.';
      }
      if (stopRef.current) break;

      setLastAgent(agent);
      setLastAgentText(response);
      addHistory({ role: 'agent', agent, content: response });

      // 3. Speak — strip action tokens before TTS
      setPhase('speaking');
      const spokenText = response.replace(/\[NEXUS_ACTION:[^\]]+\]/g, '').trim();
      await speak(spokenText || response);
      if (stopRef.current) break;

      // Small pause between turns
      await new Promise(r => setTimeout(r, 400));
    }

    setPhase('idle');
  }

  const startLive = useCallback(() => {
    const SR = (window as any).SpeechRecognition ?? (window as any).webkitSpeechRecognition;
    if (!SR) {
      alert('Spraakherkenning werkt alleen in Chrome of Edge. Open de app in Chrome.');
      return;
    }
    stopRef.current = false;
    setIsLive(true);
    setPhase('listening');
    setLiveHistory([]);
    setLastTranscript('');
    setLastAgentText('');
    runLoop();
  }, [lang]);

  const stopLive = useCallback(() => {
    stopRef.current = true;
    abortRef.current?.abort();
    window.speechSynthesis?.cancel();
    setIsLive(false);
    setPhase('idle');
  }, []);

  return {
    isLive,
    phase,
    lastTranscript,
    lastAgent,
    lastAgentText,
    liveHistory,
    startLive,
    stopLive,
  };
}
