import { useRef, useState, useCallback, useEffect } from 'react';

/* SCRIBE — records a meeting (live mic + speech-to-text) and summarises it
   with the local Phi model. Self-contained, identical across all packages. */

const ACCENT = '#00ff9d';
const NAME   = 'SCRIBE';
const BARS   = 32;

export function ScribePage() {
  const [recording, setRecording] = useState(false);
  const [transcript, setTranscript] = useState('');
  const [interim, setInterim]       = useState('');
  const [summary, setSummary]       = useState('');
  const [title, setTitle]           = useState('');
  const [busy, setBusy]             = useState(false);
  const [error, setError]           = useState<string | null>(null);
  const [elapsed, setElapsed]       = useState(0);
  const [levels, setLevels]         = useState<number[]>(() => new Array(BARS).fill(0));

  const recRef    = useRef<any>(null);
  const wantRef   = useRef(false);
  const finalRef  = useRef('');
  const timerRef  = useRef<number | null>(null);
  // live audio meter
  const streamRef   = useRef<MediaStream | null>(null);
  const audioCtxRef = useRef<AudioContext | null>(null);
  const rafRef      = useRef<number>(0);

  const supported = typeof window !== 'undefined' &&
    ((window as any).SpeechRecognition || (window as any).webkitSpeechRecognition);

  /* recording timer */
  useEffect(() => {
    if (recording) {
      const t0 = Date.now() - elapsed * 1000;
      timerRef.current = window.setInterval(() => setElapsed(Math.floor((Date.now() - t0) / 1000)), 1000);
    } else if (timerRef.current) {
      clearInterval(timerRef.current); timerRef.current = null;
    }
    return () => { if (timerRef.current) clearInterval(timerRef.current); };
  }, [recording]); // eslint-disable-line react-hooks/exhaustive-deps

  /* cleanup on unmount */
  useEffect(() => () => { stopMeter(); if (recRef.current) { try { recRef.current.stop(); } catch {} } }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const stopMeter = () => {
    cancelAnimationFrame(rafRef.current);
    if (streamRef.current) { streamRef.current.getTracks().forEach(t => t.stop()); streamRef.current = null; }
    if (audioCtxRef.current) { audioCtxRef.current.close().catch(() => {}); audioCtxRef.current = null; }
    setLevels(new Array(BARS).fill(0));
  };

  /* mic capture → live frequency bars (visible proof the mic is recording) */
  const startMeter = async () => {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    streamRef.current = stream;
    const Ctx = (window.AudioContext || (window as any).webkitAudioContext);
    const ctx = new Ctx();
    audioCtxRef.current = ctx;
    const analyser = ctx.createAnalyser();
    analyser.fftSize = 128;
    analyser.smoothingTimeConstant = 0.75;
    ctx.createMediaStreamSource(stream).connect(analyser);
    const data = new Uint8Array(analyser.frequencyBinCount);
    const loop = () => {
      analyser.getByteFrequencyData(data);
      const arr: number[] = [];
      for (let i = 0; i < BARS; i++) arr.push((data[i] ?? 0) / 255);
      setLevels(arr);
      rafRef.current = requestAnimationFrame(loop);
    };
    loop();
  };

  const startRecognition = () => {
    const SR = (window as any).SpeechRecognition ?? (window as any).webkitSpeechRecognition;
    if (!SR) return;
    const rec = new SR();
    rec.lang = navigator.language || 'nl-NL';
    rec.continuous = true;
    rec.interimResults = true;
    recRef.current = rec;
    rec.onresult = (e: any) => {
      let live = '';
      for (let i = e.resultIndex; i < e.results.length; i++) {
        const t = e.results[i][0].transcript;
        if (e.results[i].isFinal) finalRef.current += t + ' ';
        else live += t;
      }
      setTranscript(finalRef.current.trim());
      setInterim(live);
    };
    rec.onerror = (e: any) => {
      if (e.error === 'not-allowed' || e.error === 'service-not-allowed') {
        setError('Microfoon-toegang geweigerd.'); stop();
      }
    };
    rec.onend = () => { if (wantRef.current) { try { rec.start(); } catch {} } };
    try { rec.start(); } catch {}
  };

  const start = useCallback(async () => {
    setError(null);
    try { await startMeter(); }
    catch { setError('Microfoon-toegang geweigerd of geen microfoon gevonden.'); return; }
    wantRef.current = true;
    finalRef.current = transcript ? transcript + ' ' : '';
    if (supported) startRecognition();
    else setError('Live transcriptie vereist Chrome/Edge — opname loopt, maar tekst moet je zelf typen.');
    setRecording(true);
  }, [transcript, supported]); // eslint-disable-line react-hooks/exhaustive-deps

  const stop = useCallback(() => {
    wantRef.current = false;
    if (recRef.current) { try { recRef.current.stop(); } catch {} recRef.current = null; }
    stopMeter();
    setRecording(false);
    setInterim('');
  }, []);

  const summarize = useCallback(async () => {
    const text = transcript.trim();
    if (text.length < 20) { setError('Transcript is te kort om samen te vatten.'); return; }
    setBusy(true); setError(null); setSummary('');
    try {
      const res = await fetch('/api/notes/summarize', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ transcript: text, title: title.trim() || undefined }),
      });
      const data = await res.json();
      if (!res.ok || !data.ok) { setError(data.message ?? 'Samenvatten mislukt'); return; }
      setSummary(data.summary ?? '');
    } catch {
      setError('Kon de server niet bereiken.');
    } finally {
      setBusy(false);
    }
  }, [transcript, title]);

  const clearAll = () => { stop(); setTranscript(''); setInterim(''); setSummary(''); setElapsed(0); finalRef.current = ''; };
  const copySummary = () => { if (summary) navigator.clipboard?.writeText(summary).catch(() => {}); };
  const downloadSummary = () => {
    const name = (title.trim() || `${NAME.toLowerCase()}-notes`).replace(/[^\w\-]+/g, '-');
    const blob = new Blob([`# ${title.trim() || `${NAME} Notes`}\n\n${summary}\n\n---\n\n## Transcript\n\n${transcript}`], { type: 'text/markdown' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a'); a.href = url; a.download = `${name}.md`; a.click();
    URL.revokeObjectURL(url);
  };

  const mmss = `${String(Math.floor(elapsed / 60)).padStart(2, '0')}:${String(elapsed % 60).padStart(2, '0')}`;
  const sans = 'system-ui, -apple-system, sans-serif';

  return (
    <div style={{ height: '100%', overflowY: 'auto', background: '#080e1a', fontFamily: sans, color: '#e8f4ff' }}>
      <div style={{ maxWidth: 920, margin: '0 auto', padding: '24px 28px 40px' }}>

        {/* Header */}
        <div style={{ marginBottom: 18 }}>
          <div style={{ fontSize: 19, fontWeight: 700, letterSpacing: '0.04em', display: 'flex', alignItems: 'center', gap: 10 }}>
            <span style={{ color: ACCENT }}>✎</span> {NAME}
          </div>
          <div style={{ fontSize: 12, color: 'rgba(255,255,255,0.4)', marginTop: 3 }}>
            Neem een meeting op of plak een transcript — het lokale Phi-model maakt er gestructureerde notulen van.
          </div>
        </div>

        {/* Title */}
        <input
          value={title}
          onChange={e => setTitle(e.target.value)}
          placeholder="Meeting titel (optioneel)"
          style={{
            width: '100%', padding: '10px 12px', marginBottom: 14,
            background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.1)',
            borderRadius: 8, color: '#e8f4ff', fontSize: 13, fontFamily: sans, outline: 'none',
          }}
        />

        {/* ── RECORDER PANEL ── */}
        <div style={{
          padding: '14px 16px', marginBottom: 14, borderRadius: 12,
          background: recording ? 'rgba(255,45,85,0.06)' : 'rgba(255,255,255,0.03)',
          border: `1px solid ${recording ? 'rgba(255,45,85,0.35)' : 'rgba(255,255,255,0.1)'}`,
          transition: 'all 0.2s',
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 12, flexWrap: 'wrap' }}>
            {!recording ? (
              <button onClick={start} style={btn(ACCENT)}>● Opnemen</button>
            ) : (
              <button onClick={stop} style={btn('#ff2d55')}>■ Stop</button>
            )}
            {recording && (
              <span style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, color: '#ff2d55', fontWeight: 700, letterSpacing: '0.04em' }}>
                <span style={{ width: 10, height: 10, borderRadius: '50%', background: '#ff2d55', boxShadow: '0 0 10px #ff2d55', animation: 'pulse 1.1s ease-in-out infinite' }} />
                ● OPNAME ACTIEF · {mmss}
              </span>
            )}
          </div>

          {/* live mic level meter */}
          <div style={{ display: 'flex', alignItems: 'flex-end', gap: 3, height: 54 }}>
            {levels.map((v, i) => (
              <div key={i} style={{
                flex: 1,
                height: `${Math.max(5, Math.min(100, v * 130))}%`,
                background: recording ? '#ff2d55' : 'rgba(255,255,255,0.18)',
                opacity: recording ? 0.45 + v * 0.55 : 1,
                borderRadius: 2,
                transition: 'height 0.07s linear, background 0.2s',
              }} />
            ))}
          </div>
          <div style={{ fontSize: 10.5, color: 'rgba(255,255,255,0.35)', marginTop: 8 }}>
            {recording
              ? (interim ? `“${interim}”` : 'Luistert… spreek nu — de balken bewegen mee met je microfoon.')
              : 'De balken reageren live op je microfoon zodra je op Opnemen klikt.'}
          </div>
        </div>

        {/* Actions */}
        <div style={{ display: 'flex', gap: 10, marginBottom: 14, flexWrap: 'wrap' }}>
          <button onClick={summarize} disabled={busy || transcript.trim().length < 20} style={btn('#00b4ff', busy || transcript.trim().length < 20)}>
            {busy ? '⟳ Phi verwerkt…' : '✦ Samenvatten'}
          </button>
          <button onClick={clearAll} style={btn('rgba(255,255,255,0.35)', false, true)}>Wissen</button>
        </div>

        {error && <div style={notice('#ff2d55')}>{error}</div>}

        {/* Transcript */}
        <div style={{ fontSize: 11, color: 'rgba(255,255,255,0.35)', letterSpacing: '0.1em', fontWeight: 600, margin: '6px 0' }}>TRANSCRIPT</div>
        <textarea
          value={transcript + (interim ? (transcript ? ' ' : '') + interim : '')}
          onChange={e => { setTranscript(e.target.value); finalRef.current = e.target.value + ' '; }}
          placeholder="Het gesproken transcript verschijnt hier… of plak hier zelf tekst."
          rows={9}
          style={{
            width: '100%', padding: '12px 14px', resize: 'vertical',
            background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.1)',
            borderRadius: 10, color: '#cfe6ff', fontSize: 13, lineHeight: 1.6, fontFamily: sans, outline: 'none',
          }}
        />

        {/* Summary */}
        {summary && (
          <div style={{ marginTop: 22 }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
              <div style={{ fontSize: 11, color: ACCENT, letterSpacing: '0.1em', fontWeight: 700 }}>NOTULEN</div>
              <div style={{ display: 'flex', gap: 8 }}>
                <button onClick={copySummary} style={btn('rgba(255,255,255,0.4)', false, true)}>Kopiëren</button>
                <button onClick={downloadSummary} style={btn('rgba(255,255,255,0.4)', false, true)}>Download .md</button>
              </div>
            </div>
            <div style={{
              padding: '16px 18px', background: 'rgba(0,255,157,0.04)',
              border: `1px solid ${ACCENT}33`, borderRadius: 10,
              fontSize: 13.5, lineHeight: 1.65, color: '#dff7ec',
              whiteSpace: 'pre-wrap', wordBreak: 'break-word',
            }}>
              {summary}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function btn(color: string, disabled = false, ghost = false): React.CSSProperties {
  return {
    padding: '8px 16px', borderRadius: 8, cursor: disabled ? 'default' : 'pointer',
    fontSize: 12.5, fontWeight: 600, fontFamily: 'system-ui, sans-serif',
    background: ghost ? 'transparent' : `${color}18`,
    border: `1px solid ${ghost ? 'rgba(255,255,255,0.12)' : `${color}55`}`,
    color: disabled ? 'rgba(255,255,255,0.25)' : (ghost ? 'rgba(255,255,255,0.55)' : color),
    opacity: disabled ? 0.55 : 1, transition: 'all 0.15s',
  };
}

function notice(color: string): React.CSSProperties {
  return {
    padding: '9px 12px', marginBottom: 12, borderRadius: 8,
    background: `${color}12`, border: `1px solid ${color}40`,
    color, fontSize: 12, fontFamily: 'system-ui, sans-serif',
  };
}
