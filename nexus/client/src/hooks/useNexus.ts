import { useState, useCallback, useRef } from 'react';
import { NexusMessage, StreamEvent } from '../types/nexus';

export function useNexus() {
  const [messages, setMessages] = useState<NexusMessage[]>([]);
  const [loading, setLoading] = useState(false);
  const [lastRouting, setLastRouting] = useState<string[]>([]);
  const abortRef = useRef<AbortController | null>(null);

  const stop = useCallback(() => {
    abortRef.current?.abort();
    abortRef.current = null;
    setLoading(false);
  }, []);

  async function readStream(
    response: Response,
    onEvent: (event: StreamEvent) => void
  ) {
    if (!response.body) throw new Error('No response body');
    const reader = response.body.getReader();
    const decoder = new TextDecoder();

    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        const text = decoder.decode(value);
        for (const line of text.split('\n')) {
          if (!line.startsWith('data: ')) continue;
          try { onEvent(JSON.parse(line.slice(6))); } catch { /* skip */ }
        }
      }
    } finally {
      reader.releaseLock();
    }
  }

  function applyEvent(event: StreamEvent, onAnnouncement: (t: string) => void) {
    if (event.type === 'routing') {
      setLastRouting(event.data.agents);
      onAnnouncement(event.data.announcement);
      setMessages(prev => [...prev, {
        role: 'routing',
        content: `${event.data.agents.join(', ').toUpperCase()} — ${event.data.reasoning}`,
        timestamp: Date.now()
      }]);
      for (const agentId of event.data.agents) {
        setMessages(prev => [...prev, { role: 'agent', agent: agentId, content: '', timestamp: Date.now() }]);
      }
    }

    if (event.type === 'direct_start') {
      setMessages(prev => [...prev, { role: 'agent', agent: event.data.agent, content: '', timestamp: Date.now() }]);
    }

    if (event.type === 'token') {
      setMessages(prev => {
        const idx = [...prev].reverse().findIndex(m => m.role === 'agent' && m.agent === event.data.agent);
        if (idx === -1) return prev;
        const realIdx = prev.length - 1 - idx;
        const updated = [...prev];
        updated[realIdx] = { ...updated[realIdx], content: updated[realIdx].content + event.data.token };
        return updated;
      });
    }

    if (event.type === 'agent_response') {
      setMessages(prev => {
        const idx = [...prev].reverse().findIndex(m => m.role === 'agent' && m.agent === event.data.agent);
        if (idx === -1) return prev;
        const realIdx = prev.length - 1 - idx;
        const updated = [...prev];
        updated[realIdx] = { ...updated[realIdx], content: event.data.response };
        return updated;
      });
    }

    if (event.type === 'training_log') {
      setMessages(prev => {
        const last = prev[prev.length - 1];
        if (last?.role === 'training') {
          const updated = [...prev];
          updated[updated.length - 1] = { ...last, content: last.content + '\n' + event.data.message };
          return updated;
        }
        return [...prev, { role: 'training', agent: 'forge', content: event.data.message, timestamp: Date.now() }];
      });
    }

    if (event.type === 'project_log') {
      const line = `[${(event.data.agent as string).toUpperCase()}] ${event.data.message}`;
      setMessages(prev => {
        const last = prev[prev.length - 1];
        if (last?.role === 'project') {
          const updated = [...prev];
          updated[updated.length - 1] = { ...last, content: last.content + '\n' + line };
          return updated;
        }
        return [...prev, { role: 'project', content: line, timestamp: Date.now() }];
      });
    }

    if (event.type === 'project_file') {
      const line = `[FORGE] File written: ${event.data.file}`;
      setMessages(prev => {
        const last = prev[prev.length - 1];
        if (last?.role === 'project') {
          const updated = [...prev];
          updated[updated.length - 1] = { ...last, content: last.content + '\n' + line };
          return updated;
        }
        return [...prev, { role: 'project', content: line, timestamp: Date.now() }];
      });
    }

    if (event.type === 'project_done') {
      setMessages(prev => {
        const last = prev[prev.length - 1];
        const done = `\n[NEXUS] ✓ Project ready at: ${event.data.projectDir}`;
        if (last?.role === 'project') {
          const updated = [...prev];
          updated[updated.length - 1] = { ...last, content: last.content + done, meta: { projectDir: event.data.projectDir } };
          return updated;
        }
        return [...prev, { role: 'project', content: done, timestamp: Date.now(), meta: { projectDir: event.data.projectDir } }];
      });
    }

    if (event.type === 'run_log') {
      const line = event.data.text as string;
      setMessages(prev => {
        const last = prev[prev.length - 1];
        if (last?.role === 'run') {
          const updated = [...prev];
          updated[updated.length - 1] = { ...last, content: last.content + '\n' + line };
          return updated;
        }
        return [...prev, { role: 'run', content: line, timestamp: Date.now() }];
      });
    }

    if (event.type === 'run_done') {
      const status = event.data.success ? `\n✓ KLAAR — ${event.data.phase === 'test' ? 'Evaluatie' : 'Training'} voltooid` : `\n✗ Mislukt`;
      setMessages(prev => {
        const last = prev[prev.length - 1];
        if (last?.role === 'run') {
          const updated = [...prev];
          updated[updated.length - 1] = { ...last, content: last.content + status, meta: { projectDir: event.data.projectDir ?? '' } };
          return updated;
        }
        return [...prev, { role: 'run', content: status, timestamp: Date.now() }];
      });
    }

    if (event.type === 'map') {
      setMessages(prev => [...prev, {
        role: 'map',
        content: event.data.query,
        agent: 'atlas',
        timestamp: Date.now(),
        mapData: event.data,
      }]);
    }

    if (event.type === 'synthesis_start') {
      setMessages(prev => [...prev, { role: 'synthesis', content: '', timestamp: Date.now() }]);
    }

    if (event.type === 'synthesis_token') {
      setMessages(prev => {
        const idx = [...prev].reverse().findIndex(m => m.role === 'synthesis');
        if (idx === -1) return prev;
        const realIdx = prev.length - 1 - idx;
        const updated = [...prev];
        updated[realIdx] = { ...updated[realIdx], content: updated[realIdx].content + event.data.token };
        return updated;
      });
    }

    if (event.type === 'synthesis_done') {
      setMessages(prev => {
        const idx = [...prev].reverse().findIndex(m => m.role === 'synthesis');
        if (idx === -1) return prev;
        const realIdx = prev.length - 1 - idx;
        const updated = [...prev];
        updated[realIdx] = { ...updated[realIdx], content: event.data.text ?? updated[realIdx].content };
        return updated;
      });
    }

    if (event.type === 'error') {
      setMessages(prev => [...prev, { role: 'error', content: event.data.error, timestamp: Date.now() }]);
    }
  }

  const sendCommand = useCallback(async (
    prompt: string,
    onAnnouncement: (text: string) => void,
    location?: { lat: number; lon: number; city?: string; country?: string },
    sessionId?: string
  ) => {
    const ctrl = new AbortController();
    abortRef.current = ctrl;
    setLoading(true);
    setMessages(prev => [...prev, { role: 'user', content: prompt, timestamp: Date.now() }]);

    try {
      const response = await fetch('/api/command', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: prompt, location, sessionId }),
        signal: ctrl.signal,
      });
      await readStream(response, e => applyEvent(e, onAnnouncement));
    } catch (err) {
      const e = err as Error;
      if (e.name !== 'AbortError') {
        const msg = e.message.includes('Failed to fetch') || e.message.includes('NetworkError')
          ? 'Server niet bereikbaar — herstart de NEXUS server'
          : e.message;
        setMessages(prev => [...prev, { role: 'error', content: msg, timestamp: Date.now() }]);
      }
    } finally {
      setLoading(false);
      abortRef.current = null;
    }
  }, []);

  const sendDirect = useCallback(async (
    agentId: string,
    message: string,
    onAnnouncement: (text: string) => void
  ) => {
    const ctrl = new AbortController();
    abortRef.current = ctrl;
    setLoading(true);
    setMessages(prev => [...prev, { role: 'user', content: message, timestamp: Date.now() }]);

    try {
      // Training shortcut
      if (agentId === 'forge' && /^start training$/i.test(message.trim())) {
        setMessages(prev => [...prev, {
          role: 'training', agent: 'forge',
          content: 'FORGE: Connecting to training pipeline...',
          timestamp: Date.now()
        }]);
        onAnnouncement('FORGE training pipeline activated.');

        const response = await fetch('/api/training/start', {
          method: 'POST',
          signal: ctrl.signal,
        });
        await readStream(response, e => applyEvent(e, onAnnouncement));
        return;
      }

      const response = await fetch(`/api/direct/${agentId}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message }),
        signal: ctrl.signal,
      });
      await readStream(response, e => applyEvent(e, onAnnouncement));
    } catch (err) {
      const e = err as Error;
      if (e.name !== 'AbortError') {
        const msg = e.message.includes('Failed to fetch') || e.message.includes('NetworkError')
          ? 'Server niet bereikbaar — herstart de NEXUS server'
          : e.message;
        setMessages(prev => [...prev, { role: 'error', content: msg, timestamp: Date.now() }]);
      }
    } finally {
      setLoading(false);
      abortRef.current = null;
    }
  }, []);

  const clearMessages = useCallback(() => setMessages([]), []);

  return { messages, loading, lastRouting, sendCommand, sendDirect, stop, clearMessages };
}
