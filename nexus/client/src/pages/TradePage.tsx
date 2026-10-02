import { useState, useEffect, useRef, useCallback } from 'react';

// ── Types ─────────────────────────────────────────────────────────────────────
interface Coin {
  id: string; symbol: string; name: string; image: string;
  price: number; change24h: number; high24h: number; low24h: number;
  volume24h: number; marketCap: number;
}
interface Strategy {
  id: number; symbol: string; apex2_analysis: string; tactix_strategy: string;
  rating: number; outcome: string; pnl_pct: number | null; timestamp: string;
}
interface TrainLog { status: 'idle' | 'running' | 'done' | 'error'; lines: string[] }

// ── Binance symbol map ────────────────────────────────────────────────────────
const CG_TO_BINANCE: Record<string, string> = {
  bitcoin:       'BTCUSDT', ethereum:     'ETHUSDT', solana:    'SOLUSDT',
  binancecoin:   'BNBUSDT', 'avalanche-2':'AVAXUSDT', chainlink: 'LINKUSDT',
  cardano:       'ADAUSDT', polkadot:     'DOTUSDT',
};
const BIN_TO_CG: Record<string, string> = Object.fromEntries(
  Object.entries(CG_TO_BINANCE).map(([k, v]) => [v, k])
);

// ── Colors ────────────────────────────────────────────────────────────────────
const C = {
  bg:     '#030d1a',
  panel:  'rgba(2,14,30,0.96)',
  border: 'rgba(0,245,255,0.10)',
  borderH:'rgba(0,245,255,0.22)',
  cyan:   '#00f5ff',
  green:  '#00ff9d',
  red:    '#ff3b5c',
  yellow: '#ffb800',
  apex2:  '#a855f7',
  tactix: '#f97316',
  dim:    'rgba(170,200,240,0.38)',
  text:   'rgba(210,230,255,0.9)',
};
const glow = (c: string, r = 8) => `0 0 ${r}px ${c}66`;

// ── Formatters ────────────────────────────────────────────────────────────────
function fmtPrice(n: number) {
  if (n >= 10000) return `$${n.toLocaleString('en-US', { maximumFractionDigits: 0 })}`;
  if (n >= 1)     return `$${n.toLocaleString('en-US', { maximumFractionDigits: 2 })}`;
  return `$${n.toFixed(4)}`;
}
function fmtLarge(n: number) {
  if (n >= 1e9) return `$${(n / 1e9).toFixed(2)}B`;
  if (n >= 1e6) return `$${(n / 1e6).toFixed(0)}M`;
  return `$${n.toLocaleString()}`;
}
function fmtPct(n: number) {
  return `${n >= 0 ? '▲' : '▼'} ${Math.abs(n).toFixed(2)}%`;
}

// ── Shared components ─────────────────────────────────────────────────────────
function Label({ text, color = C.dim, size = 8 }: { text: string; color?: string; size?: number }) {
  return (
    <span style={{
      fontFamily: 'monospace', fontSize: size, letterSpacing: '0.13em',
      color, fontWeight: 700, textTransform: 'uppercase',
    }}>{text}</span>
  );
}

function Card({ children, style }: { children: React.ReactNode; style?: React.CSSProperties }) {
  return (
    <div style={{
      background: C.panel, border: `1px solid ${C.border}`,
      borderRadius: 6, padding: 14, ...style,
    }}>{children}</div>
  );
}

// ── Formatted analysis output ─────────────────────────────────────────────────
function AnalysisBlock({ color, label, text, loading }: {
  color: string; label: string; text: string; loading: boolean;
}) {
  const lines = text.trim().split('\n').filter(Boolean);

  // parse key: value lines into sections for display
  const parseLines = (lines: string[]) => lines.map((line, i) => {
    const isHeader   = /^(TREND|MOMENTUM|RSI|SUPPORT|RESISTANCE|SIGNAL|ENTRY|TARGET|STOP|RISK|CONFIDENCE|REASONING|MACRO|VALIDATION|POSITION|EXECUTION|RISK:|OUTLOOK|VERDICT|FASE)/i.test(line.trim());
    const isBuy      = /\bBUY\b/.test(line);
    const isSell     = /\bSELL\b/.test(line);
    const isHold     = /\bHOLD\b/.test(line);
    const lineColor  = isBuy ? C.green : isSell ? C.red : isHold ? C.yellow : C.text;

    return (
      <div key={i} style={{
        fontFamily: 'monospace', fontSize: 9.5, lineHeight: 1.75,
        color: isHeader ? lineColor : C.text,
        fontWeight: isHeader ? 700 : 400,
        paddingLeft: line.startsWith('  ') ? 12 : 0,
        borderLeft: isHeader && (isBuy || isSell || isHold)
          ? `2px solid ${lineColor}` : 'none',
        paddingInlineStart: isHeader && (isBuy || isSell || isHold) ? 8 : undefined,
        marginTop: isHeader ? 4 : 0,
      }}>{line}</div>
    );
  });

  return (
    <div style={{ marginBottom: 12 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 7 }}>
        <div style={{ width: 8, height: 8, borderRadius: '50%', background: color, boxShadow: glow(color) }} />
        <Label text={label} color={color} size={9} />
        {loading && (
          <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 5 }}>
            <div style={{ width: 5, height: 5, borderRadius: '50%', background: C.yellow, animation: 'pulse 0.8s infinite' }} />
            <Label text="Analyseren..." color={C.yellow} />
          </div>
        )}
      </div>
      <div style={{
        background: 'rgba(0,0,0,0.35)',
        border: `1px solid ${color}20`,
        borderLeft: `2px solid ${color}`,
        borderRadius: '0 5px 5px 0',
        padding: '10px 14px',
        minHeight: 70,
        maxHeight: 240,
        overflowY: 'auto',
      }}>
        {loading
          ? <div style={{ fontFamily: 'monospace', fontSize: 9, color: C.dim, fontStyle: 'italic' }}>Bezig…</div>
          : text
            ? parseLines(lines)
            : <div style={{ fontFamily: 'monospace', fontSize: 9, color: C.dim, fontStyle: 'italic' }}>
                Druk op GENEREER om te starten
              </div>
        }
      </div>
    </div>
  );
}

// ── Training block ────────────────────────────────────────────────────────────
function TrainBlock({ agent, color, label }: { agent: string; color: string; label: string }) {
  const [log, setLog] = useState<TrainLog>({ status: 'idle', lines: [] });
  const esRef = useRef<EventSource | null>(null);
  const logRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (logRef.current) logRef.current.scrollTop = logRef.current.scrollHeight;
  }, [log.lines]);

  const start = () => {
    if (log.status === 'running') return;
    esRef.current?.close();
    setLog({ status: 'running', lines: ['🚀 Training gestart…'] });
    const es = new EventSource(`/api/training/lora/${agent}?epochs=3&batchSize=1&learningRate=0.0002`);
    esRef.current = es;
    es.onmessage = e => {
      const d = JSON.parse(e.data);
      if (d.type === 'training_log')   setLog(p => ({ ...p, lines: [...p.lines, d.data.line] }));
      if (d.type === 'training_done')  { setLog(p => ({ status: 'done',  lines: [...p.lines, '✅ Klaar!'] })); es.close(); }
      if (d.type === 'training_error') { setLog(p => ({ status: 'error', lines: [...p.lines, `❌ ${d.data.message}`] })); es.close(); }
    };
    es.onerror = () => { setLog(p => ({ ...p, status: 'error', lines: [...p.lines, '❌ Verbinding verbroken'] })); es.close(); };
  };

  const stop = async () => {
    esRef.current?.close();
    try { await fetch(`/api/training/lora/${agent}/stop`, { method: 'POST' }); } catch {}
    setLog(p => ({ ...p, status: 'idle', lines: [...p.lines, '⛔ Gestopt'] }));
  };

  const sColor = log.status === 'running' ? C.yellow : log.status === 'done' ? C.green : log.status === 'error' ? C.red : C.dim;

  return (
    <div style={{ flex: 1, minWidth: 0 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 7, marginBottom: 8 }}>
        <div style={{ width: 7, height: 7, borderRadius: '50%', background: color, boxShadow: glow(color) }} />
        <Label text={label} color={color} size={9} />
        <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 5 }}>
          <div style={{ width: 5, height: 5, borderRadius: '50%', background: sColor }} />
          <Label text={log.status} color={sColor} />
        </div>
      </div>
      <div style={{ display: 'flex', gap: 5, marginBottom: 7 }}>
        <button onClick={start} disabled={log.status === 'running'} style={{
          flex: 1, padding: '5px 0', fontFamily: 'monospace', fontSize: 9, fontWeight: 700,
          letterSpacing: '0.1em', cursor: log.status === 'running' ? 'not-allowed' : 'pointer',
          background: `${color}18`, border: `1px solid ${color}55`, borderRadius: 4, color,
          boxShadow: log.status === 'running' ? 'none' : glow(color),
        }}>▶ TRAIN</button>
        <button onClick={stop} disabled={log.status !== 'running'} style={{
          padding: '5px 10px', fontFamily: 'monospace', fontSize: 9, fontWeight: 700,
          cursor: log.status !== 'running' ? 'not-allowed' : 'pointer',
          background: log.status === 'running' ? '#ff3b5c18' : 'transparent',
          border: `1px solid ${log.status === 'running' ? C.red : C.border}`, borderRadius: 4,
          color: log.status === 'running' ? C.red : C.dim,
        }}>⛔</button>
      </div>
      <div ref={logRef} style={{
        background: 'rgba(0,0,0,0.4)', border: `1px solid ${C.border}`, borderRadius: 4,
        padding: '7px 10px', height: 110, overflowY: 'auto',
        fontFamily: 'monospace', fontSize: 8, color: C.dim, lineHeight: 1.6,
      }}>
        {log.lines.length === 0
          ? <span>Wacht…</span>
          : log.lines.map((l, i) => (
              <div key={i} style={{ color: l.startsWith('❌') ? C.red : l.startsWith('✅') ? C.green : C.dim }}>{l}</div>
            ))}
      </div>
    </div>
  );
}

// ── Main component ────────────────────────────────────────────────────────────
export function TradePage() {
  const [coins, setCoins]               = useState<Coin[]>([]);
  const [selectedId, setSelectedId]     = useState('bitcoin');
  const [wsStatus, setWsStatus]         = useState<'connecting' | 'live' | 'offline'>('connecting');
  const [generating, setGenerating]     = useState(false);
  const [apex2Text, setApex2Text]       = useState('');
  const [tactixText, setTactixText]     = useState('');
  const [apex2Loading, setApex2Loading] = useState(false);
  const [tactixLoading, setTactixLoading] = useState(false);
  const [strategies, setStrategies]     = useState<Strategy[]>([]);
  const [userCtx, setUserCtx]           = useState('');
  const [activeTab, setActiveTab]       = useState<'strategy' | 'history' | 'training' | 'data'>('strategy');
  const [clock, setClock]               = useState('');
  const [datasetInfo, setDatasetInfo]   = useState({ apex2: 0, tactix: 0 });
  const [collectLog, setCollectLog]     = useState<string[]>([]);
  const [collecting, setCollecting]     = useState(false);
  const [flashMap, setFlashMap]         = useState<Record<string, 'up' | 'down' | null>>({});
  const wsRef = useRef<WebSocket | null>(null);
  const coinBaseRef = useRef<Coin[]>([]);   // stable base for WS updates

  // ── Clock ──────────────────────────────────────────────────────────────────
  useEffect(() => {
    const tick = () => {
      const d = new Date();
      setClock(`${d.getUTCHours().toString().padStart(2,'0')}:${d.getUTCMinutes().toString().padStart(2,'0')}:${d.getUTCSeconds().toString().padStart(2,'0')} UTC`);
    };
    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, []);

  // ── Fetch coin metadata once ───────────────────────────────────────────────
  useEffect(() => {
    const fetchMeta = async () => {
      try {
        const r = await fetch('/api/trading/market');
        if (!r.ok) return;
        const data = await r.json() as any[];
        const mapped: Coin[] = data.map(c => ({
          id: c.id, symbol: c.symbol, name: c.name, image: c.image,
          price: c.current_price, change24h: c.price_change_percentage_24h ?? 0,
          high24h: c.high_24h, low24h: c.low_24h,
          volume24h: c.total_volume, marketCap: c.market_cap,
        }));
        setCoins(mapped);
        coinBaseRef.current = mapped;
      } catch {}
    };
    fetchMeta();
  }, []);

  // ── Binance WebSocket ─────────────────────────────────────────────────────
  useEffect(() => {
    const streams = Object.values(CG_TO_BINANCE)
      .map(s => `${s.toLowerCase()}@ticker`)
      .join('/');

    // Try port 443 first (standard HTTPS, almost never blocked)
    // Port 9443 is often blocked by routers/firewalls
    const URLS = [
      `wss://stream.binance.com:443/stream?streams=${streams}`,
      `wss://stream.binance.com/stream?streams=${streams}`,
    ];
    let urlIdx = 0;
    let retries = 0;

    const connect = () => {
      const url = URLS[urlIdx % URLS.length];
      const ws = new WebSocket(url);
      wsRef.current = ws;
      setWsStatus('connecting');

      ws.onopen  = () => { setWsStatus('live'); retries = 0; };
      ws.onerror = () => setWsStatus('offline');
      ws.onclose = () => {
        setWsStatus('offline');
        retries++;
        // alternate URL on each retry
        urlIdx++;
        const delay = Math.min(5000 * retries, 30000);
        setTimeout(connect, delay);
      };

      ws.onmessage = (evt) => {
        try {
          const msg = JSON.parse(evt.data);
          const d = msg.data;
          if (!d || d.e !== '24hrTicker') return;
          const cgId = BIN_TO_CG[d.s];
          if (!cgId) return;

          const newPrice = parseFloat(d.c);
          const change24h = parseFloat(d.P);
          const high24h   = parseFloat(d.h);
          const low24h    = parseFloat(d.l);
          const volume24h = parseFloat(d.q);

          setCoins(prev => {
            const idx = prev.findIndex(c => c.id === cgId);
            if (idx === -1) return prev;
            const oldPrice = prev[idx].price;
            const dir: 'up' | 'down' = newPrice >= oldPrice ? 'up' : 'down';

            // flash effect
            if (oldPrice !== newPrice) {
              setFlashMap(fm => ({ ...fm, [cgId]: dir }));
              setTimeout(() => setFlashMap(fm => ({ ...fm, [cgId]: null })), 400);
            }

            const updated = [...prev];
            updated[idx] = { ...updated[idx], price: newPrice, change24h, high24h, low24h, volume24h };
            return updated;
          });
        } catch {}
      };
    };

    connect();
    return () => {
      wsRef.current?.close();
    };
  }, []);

  // ── Fetch strategies + dataset info ──────────────────────────────────────
  const fetchStrategies = useCallback(async () => {
    const r = await fetch('/api/trading/strategies?limit=15');
    if (r.ok) setStrategies(await r.json());
  }, []);

  const fetchDatasetInfo = useCallback(async () => {
    const r = await fetch('/api/trading/dataset-info');
    if (r.ok) setDatasetInfo(await r.json());
  }, []);

  useEffect(() => {
    fetchStrategies();
    fetchDatasetInfo();
  }, [fetchStrategies, fetchDatasetInfo]);

  // ── Generate strategy ─────────────────────────────────────────────────────
  const generate = useCallback(async () => {
    if (generating) return;
    setGenerating(true);
    setApex2Text(''); setTactixText('');
    setApex2Loading(true); setTactixLoading(false);
    try {
      const r = await fetch('/api/trading/generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ coinId: selectedId, userContext: userCtx }),
      });
      if (!r.ok) throw new Error('Genereren mislukt');
      const data = await r.json();
      setApex2Loading(false);
      setApex2Text(data.apex2Analysis ?? '');
      setTactixLoading(true);
      await new Promise(res => setTimeout(res, 80));
      setTactixLoading(false);
      setTactixText(data.tactixStrategy ?? '');
      fetchStrategies();
    } catch (e: any) {
      setApex2Text(`❌ Fout: ${e.message}`);
    } finally {
      setGenerating(false);
      setApex2Loading(false);
      setTactixLoading(false);
    }
  }, [generating, selectedId, userCtx, fetchStrategies]);

  // ── Rate strategy ─────────────────────────────────────────────────────────
  const rateStrategy = useCallback(async (id: number, rating: number, outcome: string) => {
    await fetch(`/api/trading/strategies/${id}/rate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ rating, outcome }),
    });
    setStrategies(p => p.map(s => s.id === id ? { ...s, rating, outcome } : s));
    if (rating >= 4) fetchDatasetInfo();
  }, [fetchDatasetInfo]);

  const coin = coins.find(c => c.id === selectedId);

  // ── Render ─────────────────────────────────────────────────────────────────
  return (
    <div style={{ height: '100%', display: 'flex', flexDirection: 'column', background: C.bg, overflow: 'hidden' }}>

      {/* ── TOP HEADER ─────────────────────────────────────────────────────── */}
      <div style={{
        flexShrink: 0, padding: '7px 16px',
        background: 'rgba(0,8,20,0.99)',
        borderBottom: `1px solid ${C.borderH}`,
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        boxShadow: `0 2px 20px rgba(0,0,0,0.6)`,
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
          <span style={{ fontFamily: 'monospace', fontSize: 12, fontWeight: 700, letterSpacing: '0.2em', color: C.cyan, textShadow: glow(C.cyan) }}>
            ◬ NEXUS TRADE TERMINAL
          </span>
          <span style={{ fontFamily: 'monospace', fontSize: 8, color: C.dim, letterSpacing: '0.1em' }}>
            APEX-2 × TACTIX
          </span>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
          {/* WS status */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
            <div style={{
              width: 6, height: 6, borderRadius: '50%',
              background: wsStatus === 'live' ? C.green : wsStatus === 'connecting' ? C.yellow : C.red,
              boxShadow: wsStatus === 'live' ? glow(C.green) : 'none',
              animation: wsStatus === 'live' ? 'pulse 2s infinite' : 'none',
            }} />
            <Label text={wsStatus === 'live' ? 'LIVE' : wsStatus === 'connecting' ? 'VERBINDEN' : 'OFFLINE'} color={wsStatus === 'live' ? C.green : C.yellow} />
          </div>
          <Label text={clock} color={C.dim} />
        </div>
      </div>

      {/* ── PRICE TICKER ───────────────────────────────────────────────────── */}
      <div style={{
        flexShrink: 0, padding: '4px 16px',
        background: 'rgba(0,5,12,0.99)',
        borderBottom: `1px solid ${C.border}`,
        display: 'flex', alignItems: 'center', gap: 0, overflowX: 'auto',
      }}>
        {coins.map(c => {
          const flash = flashMap[c.id];
          const chgColor = c.change24h >= 0 ? C.green : C.red;
          return (
            <button
              key={c.id}
              onClick={() => setSelectedId(c.id)}
              style={{
                display: 'flex', alignItems: 'center', gap: 7,
                padding: '4px 14px', cursor: 'pointer',
                background: selectedId === c.id ? `${C.cyan}0c` : flash ? (flash === 'up' ? `${C.green}0a` : `${C.red}0a`) : 'transparent',
                border: 'none',
                borderBottom: selectedId === c.id ? `2px solid ${C.cyan}` : '2px solid transparent',
                flexShrink: 0, transition: 'background 0.25s',
              }}
            >
              <img src={c.image} alt={c.symbol} style={{ width: 14, height: 14, borderRadius: '50%' }} />
              <span style={{ fontFamily: 'monospace', fontSize: 9, fontWeight: 700, color: selectedId === c.id ? C.cyan : C.text, letterSpacing: '0.05em' }}>
                {c.symbol.toUpperCase()}
              </span>
              <span style={{
                fontFamily: 'monospace', fontSize: 10, fontWeight: 700,
                color: flash === 'up' ? C.green : flash === 'down' ? C.red : C.text,
                transition: 'color 0.3s',
              }}>
                {fmtPrice(c.price)}
              </span>
              <span style={{ fontFamily: 'monospace', fontSize: 8, color: chgColor, fontWeight: 600 }}>
                {fmtPct(c.change24h)}
              </span>
            </button>
          );
        })}
      </div>

      {/* ── BODY ───────────────────────────────────────────────────────────── */}
      <div style={{ flex: 1, overflow: 'hidden', display: 'flex' }}>

        {/* LEFT: coin list */}
        <div style={{
          width: 210, flexShrink: 0,
          borderRight: `1px solid ${C.border}`,
          background: 'rgba(0,6,16,0.7)',
          overflowY: 'auto', padding: '10px 8px',
        }}>
          <div style={{ padding: '0 4px 8px', marginBottom: 4 }}>
            <Label text="MUNTEN" color={C.cyan} size={8} />
          </div>
          {coins.map(c => {
            const sel = selectedId === c.id;
            const flash = flashMap[c.id];
            const chgColor = c.change24h >= 0 ? C.green : C.red;
            return (
              <button
                key={c.id}
                onClick={() => setSelectedId(c.id)}
                style={{
                  width: '100%', textAlign: 'left', cursor: 'pointer',
                  background: sel
                    ? `${C.cyan}0d`
                    : flash === 'up' ? `${C.green}08` : flash === 'down' ? `${C.red}08` : 'transparent',
                  border: `1px solid ${sel ? C.borderH : 'transparent'}`,
                  borderRadius: 5, padding: '8px 10px', marginBottom: 4,
                  transition: 'background 0.25s',
                }}
              >
                <div style={{ display: 'flex', alignItems: 'center', gap: 7, marginBottom: 2 }}>
                  <img src={c.image} alt={c.symbol} style={{ width: 20, height: 20, borderRadius: '50%' }} />
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontFamily: 'monospace', fontSize: 10, fontWeight: 700, color: sel ? C.cyan : C.text }}>
                      {c.symbol.toUpperCase()}
                    </div>
                    <div style={{ fontFamily: 'monospace', fontSize: 7, color: C.dim, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {c.name}
                    </div>
                  </div>
                  <div style={{ textAlign: 'right' }}>
                    <div style={{
                      fontFamily: 'monospace', fontSize: 10, fontWeight: 700,
                      color: flash === 'up' ? C.green : flash === 'down' ? C.red : C.text,
                      transition: 'color 0.3s',
                    }}>
                      {fmtPrice(c.price)}
                    </div>
                    <div style={{ fontFamily: 'monospace', fontSize: 8, color: chgColor, fontWeight: 600 }}>
                      {fmtPct(c.change24h)}
                    </div>
                  </div>
                </div>
                <div style={{ display: 'flex', gap: 8, paddingLeft: 27 }}>
                  <span style={{ fontFamily: 'monospace', fontSize: 7, color: C.dim }}>H {fmtPrice(c.high24h)}</span>
                  <span style={{ fontFamily: 'monospace', fontSize: 7, color: C.dim }}>L {fmtPrice(c.low24h)}</span>
                </div>
              </button>
            );
          })}

          {/* Selected coin stats */}
          {coin && (
            <div style={{ marginTop: 10, padding: '10px 10px', background: `${C.cyan}06`, border: `1px solid ${C.border}`, borderRadius: 5 }}>
              <Label text="DETAILS" color={C.cyan} />
              <div style={{ marginTop: 7, display: 'flex', flexDirection: 'column', gap: 4 }}>
                {[
                  ['Market Cap', fmtLarge(coin.marketCap)],
                  ['Volume 24h', fmtLarge(coin.volume24h)],
                  ['High 24h',   fmtPrice(coin.high24h)],
                  ['Low 24h',    fmtPrice(coin.low24h)],
                ].map(([k, v]) => (
                  <div key={k} style={{ display: 'flex', justifyContent: 'space-between', fontFamily: 'monospace', fontSize: 8 }}>
                    <span style={{ color: C.dim }}>{k}</span>
                    <span style={{ color: C.text, fontWeight: 600 }}>{v}</span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>

        {/* RIGHT: main content */}
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>

          {/* Tab bar */}
          <div style={{
            flexShrink: 0, display: 'flex',
            borderBottom: `1px solid ${C.border}`,
            background: 'rgba(0,6,14,0.98)',
          }}>
            {([
              { id: 'strategy', label: 'STRATEGIE',  color: C.cyan },
              { id: 'history',  label: 'HISTORIEK',  color: C.apex2 },
              { id: 'training', label: 'TRAINING',   color: C.tactix },
              { id: 'data',     label: 'DATA',        color: C.green },
            ] as const).map(t => (
              <button key={t.id} onClick={() => setActiveTab(t.id)} style={{
                padding: '8px 18px', fontFamily: 'monospace', fontSize: 9, fontWeight: 700,
                letterSpacing: '0.12em', cursor: 'pointer', border: 'none', background: 'transparent',
                color: activeTab === t.id ? t.color : C.dim,
                borderBottom: `2px solid ${activeTab === t.id ? t.color : 'transparent'}`,
                textShadow: activeTab === t.id ? glow(t.color, 5) : 'none',
                transition: 'all 0.15s',
              }}>{t.label}</button>
            ))}
          </div>

          {/* Tab content */}
          <div style={{ flex: 1, overflow: 'auto', padding: 16 }}>

            {/* ── STRATEGIE ─────────────────────────────────────────────── */}
            {activeTab === 'strategy' && (
              <div>
                {/* Controls row */}
                <div style={{ display: 'flex', gap: 10, marginBottom: 14, alignItems: 'flex-end' }}>
                  <div style={{ flex: 1 }}>
                    <Label text="Extra context" color={C.dim} />
                    <input
                      value={userCtx}
                      onChange={e => setUserCtx(e.target.value)}
                      placeholder="bijv. Fed vergadering morgen, bullish sentiment..."
                      style={{
                        width: '100%', marginTop: 5, padding: '7px 10px',
                        fontFamily: 'monospace', fontSize: 9,
                        background: 'rgba(0,0,0,0.4)',
                        border: `1px solid ${C.border}`, borderRadius: 4,
                        color: C.text, outline: 'none', boxSizing: 'border-box',
                      }}
                    />
                  </div>
                  <button
                    onClick={generate}
                    disabled={generating || !coin}
                    style={{
                      padding: '8px 22px', fontFamily: 'monospace', fontSize: 10, fontWeight: 700,
                      letterSpacing: '0.13em', cursor: (generating || !coin) ? 'not-allowed' : 'pointer',
                      background: generating ? `${C.cyan}10` : `linear-gradient(135deg, ${C.cyan}20, ${C.apex2}15)`,
                      border: `1px solid ${generating ? C.border : C.cyan}`,
                      borderRadius: 5, color: (generating || !coin) ? C.dim : C.cyan,
                      boxShadow: generating ? 'none' : `${glow(C.cyan)}, ${glow(C.apex2)}`,
                      flexShrink: 0, transition: 'all 0.2s',
                    }}
                  >{generating ? '⏳ BEZIG...' : '▶ GENEREER'}</button>
                </div>

                {/* Selected coin header */}
                {coin && (
                  <div style={{
                    display: 'flex', alignItems: 'center', gap: 14, marginBottom: 14,
                    padding: '10px 16px',
                    background: 'rgba(0,245,255,0.04)',
                    border: `1px solid ${C.borderH}`,
                    borderRadius: 6,
                  }}>
                    <img src={coin.image} alt={coin.symbol} style={{ width: 34, height: 34, borderRadius: '50%' }} />
                    <div>
                      <div style={{ fontFamily: 'monospace', fontSize: 15, fontWeight: 700, color: C.cyan, letterSpacing: '0.05em', textShadow: glow(C.cyan) }}>
                        {coin.symbol.toUpperCase()}/USD
                      </div>
                      <div style={{ fontFamily: 'monospace', fontSize: 8, color: C.dim }}>{coin.name}</div>
                    </div>
                    <div style={{ marginLeft: 'auto', textAlign: 'right' }}>
                      <div style={{ fontFamily: 'monospace', fontSize: 20, fontWeight: 700, color: C.text }}>
                        {fmtPrice(coin.price)}
                      </div>
                      <div style={{ fontFamily: 'monospace', fontSize: 11, fontWeight: 700, color: coin.change24h >= 0 ? C.green : C.red }}>
                        {fmtPct(coin.change24h)} 24h
                      </div>
                    </div>
                  </div>
                )}

                <AnalysisBlock label="APEX-2 — TECHNISCHE ANALYSE" color={C.apex2} text={apex2Text} loading={apex2Loading} />
                <AnalysisBlock label="TACTIX — STRATEGIE ADVIES"   color={C.tactix} text={tactixText} loading={tactixLoading} />
              </div>
            )}

            {/* ── HISTORIEK ─────────────────────────────────────────────── */}
            {activeTab === 'history' && (
              <div>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 14 }}>
                  <Label text={`STRATEGIE HISTORIEK — ${strategies.length} opgeslagen`} color={C.apex2} size={9} />
                  <button onClick={fetchStrategies} style={{
                    padding: '4px 12px', fontFamily: 'monospace', fontSize: 8, cursor: 'pointer',
                    background: 'transparent', border: `1px solid ${C.border}`, borderRadius: 4, color: C.dim,
                  }}>↻ VERNIEUWEN</button>
                </div>
                {strategies.length === 0
                  ? <div style={{ fontFamily: 'monospace', fontSize: 9, color: C.dim, padding: 30, textAlign: 'center' }}>
                      Nog geen strategieën. Genereer er een op de STRATEGIE tab.
                    </div>
                  : strategies.map(s => (
                      <Card key={s.id} style={{ marginBottom: 10 }}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
                          <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
                            <span style={{ fontFamily: 'monospace', fontSize: 12, fontWeight: 700, color: C.cyan }}>{s.symbol}/USD</span>
                            <span style={{ fontFamily: 'monospace', fontSize: 8, color: C.dim }}>
                              {new Date(s.timestamp).toLocaleString('nl-NL', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })}
                            </span>
                          </div>
                          <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                            {s.outcome === 'profitable' && <span style={{ fontFamily: 'monospace', fontSize: 8, color: C.green, fontWeight: 700 }}>✅ WIN</span>}
                            {s.outcome === 'loss'       && <span style={{ fontFamily: 'monospace', fontSize: 8, color: C.red,   fontWeight: 700 }}>❌ VERLIES</span>}
                            {s.rating >= 4 && <span style={{ fontFamily: 'monospace', fontSize: 7, color: C.cyan }}>💾 training</span>}
                          </div>
                        </div>
                        <div style={{ display: 'flex', gap: 8, marginBottom: 8 }}>
                          {[
                            { label: 'APEX-2', text: s.apex2_analysis, color: C.apex2 },
                            { label: 'TACTIX', text: s.tactix_strategy, color: C.tactix },
                          ].map(({ label, text, color }) => (
                            <div key={label} style={{ flex: 1 }}>
                              <div style={{ fontFamily: 'monospace', fontSize: 8, color, fontWeight: 700, marginBottom: 4 }}>{label}</div>
                              <div style={{
                                fontFamily: 'monospace', fontSize: 8, color: C.dim, lineHeight: 1.6,
                                maxHeight: 55, overflow: 'hidden',
                                background: 'rgba(0,0,0,0.3)', padding: '6px 8px', borderRadius: 3,
                                borderLeft: `2px solid ${color}`,
                              }}>{text.slice(0, 180)}…</div>
                            </div>
                          ))}
                        </div>
                        {/* Rating */}
                        <div style={{ display: 'flex', gap: 5 }}>
                          {([
                            { r: 5, o: 'profitable', label: '✅ WIN',    color: C.green },
                            { r: 2, o: 'loss',       label: '❌ VERLIES', color: C.red },
                            { r: 3, o: 'neutral',    label: '➖ N/A',    color: C.yellow },
                          ] as const).map(({ r, o, label, color }) => (
                            <button key={r} onClick={() => rateStrategy(s.id, r, o)} style={{
                              padding: '3px 10px', fontFamily: 'monospace', fontSize: 8, fontWeight: 700,
                              cursor: 'pointer', borderRadius: 3,
                              background: s.rating === r ? `${color}20` : 'transparent',
                              border: `1px solid ${s.rating === r ? color : C.border}`,
                              color: s.rating === r ? color : C.dim,
                              boxShadow: s.rating === r ? glow(color, 5) : 'none',
                            }}>{label}</button>
                          ))}
                        </div>
                      </Card>
                    ))}
              </div>
            )}

            {/* ── TRAINING ──────────────────────────────────────────────── */}
            {activeTab === 'training' && (
              <div>
                <Card style={{ marginBottom: 12 }}>
                  <Label text="DATASET STATUS" color={C.tactix} size={9} />
                  <div style={{ display: 'flex', gap: 10, marginTop: 10 }}>
                    {[
                      { agent: 'APEX-2', count: datasetInfo.apex2, color: C.apex2 },
                      { agent: 'TACTIX', count: datasetInfo.tactix, color: C.tactix },
                    ].map(d => (
                      <div key={d.agent} style={{
                        flex: 1, padding: '10px 12px',
                        background: `${d.color}08`, border: `1px solid ${d.color}22`, borderRadius: 5,
                      }}>
                        <Label text={d.agent} color={d.color} size={9} />
                        <div style={{ fontFamily: 'monospace', fontSize: 20, fontWeight: 700, color: C.text, marginTop: 4 }}>{d.count}</div>
                        <div style={{ fontFamily: 'monospace', fontSize: 7, color: C.dim }}>trainingsvoorbeelden</div>
                        <div style={{ marginTop: 7, height: 3, background: 'rgba(255,255,255,0.07)', borderRadius: 2 }}>
                          <div style={{ height: '100%', borderRadius: 2, background: d.color, width: `${Math.min(100, (d.count / 500) * 100)}%`, boxShadow: glow(d.color, 3) }} />
                        </div>
                        <div style={{ fontFamily: 'monospace', fontSize: 7, color: C.dim, marginTop: 2 }}>{d.count}/500 min</div>
                      </div>
                    ))}
                  </div>
                  <div style={{ fontFamily: 'monospace', fontSize: 8.5, color: C.dim, lineHeight: 1.8, marginTop: 10 }}>
                    Beoordeel strategieën als <span style={{ color: C.green }}>✅ WIN</span> → auto-opgeslagen als trainingsdata.
                    Gebruik ⬇ DATA om bulk data op te halen. Dan TRAIN om te hertrainen.
                  </div>
                </Card>
                <div style={{ display: 'flex', gap: 14 }}>
                  <TrainBlock agent="apex2"  color={C.apex2}  label="APEX-2" />
                  <TrainBlock agent="tactix" color={C.tactix} label="TACTIX" />
                </div>
              </div>
            )}

            {/* ── DATA ──────────────────────────────────────────────────── */}
            {activeTab === 'data' && (
              <div>
                <Card style={{ marginBottom: 12 }}>
                  <Label text="LIVE DATA COLLECTIE" color={C.green} size={9} />
                  <div style={{ fontFamily: 'monospace', fontSize: 8.5, color: C.dim, lineHeight: 1.8, marginTop: 8, marginBottom: 12 }}>
                    Haalt live marktdata op van CoinGecko en genereert automatisch trainingsvoorbeelden voor APEX-2 en TACTIX.
                    Meer data = slimmere analyse. Run dit regelmatig.
                  </div>
                  <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                    {(['both', 'apex2', 'tactix'] as const).map(t => (
                      <button key={t} disabled={collecting}
                        onClick={() => {
                          if (collecting) return;
                          setCollecting(true);
                          setCollectLog([`📡 Verbinden — ${t}…`]);
                          const es = new EventSource(`/api/trading/collect?agent=${t}`);
                          es.onmessage = e => {
                            const d = JSON.parse(e.data);
                            if (d.line) setCollectLog(p => [...p, d.line]);
                          };
                          es.onerror = () => { setCollecting(false); es.close(); fetchDatasetInfo(); };
                        }}
                        style={{
                          padding: '7px 16px', fontFamily: 'monospace', fontSize: 9, fontWeight: 700,
                          letterSpacing: '0.1em', cursor: collecting ? 'not-allowed' : 'pointer',
                          background: `${C.green}14`,
                          border: `1px solid ${collecting ? C.border : C.green}66`,
                          borderRadius: 4, color: collecting ? C.dim : C.green,
                          boxShadow: collecting ? 'none' : glow(C.green),
                        }}
                      >
                        {collecting ? '⏳ BEZIG...' : `⬇ ${t === 'both' ? 'APEX-2 + TACTIX' : t.toUpperCase()}`}
                      </button>
                    ))}
                  </div>
                </Card>
                <Card>
                  <Label text="COLLECTIE LOG" color={C.green} />
                  <div style={{
                    marginTop: 8, background: 'rgba(0,0,0,0.45)',
                    border: `1px solid ${C.border}`, borderRadius: 4,
                    padding: '8px 12px', height: 200, overflowY: 'auto',
                    fontFamily: 'monospace', fontSize: 8.5, color: C.dim, lineHeight: 1.7,
                  }}>
                    {collectLog.length === 0
                      ? <span>Wacht op collectie…</span>
                      : collectLog.map((l, i) => (
                          <div key={i} style={{ color: l.startsWith('✅') || l.startsWith('💾') ? C.green : l.startsWith('❌') ? C.red : l.startsWith('📡') ? C.cyan : C.dim }}>{l}</div>
                        ))}
                  </div>
                </Card>
              </div>
            )}

          </div>
        </div>
      </div>
    </div>
  );
}
