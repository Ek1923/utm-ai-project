import type { FastifyInstance } from 'fastify';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import { db } from '../services/database.js';
import { getConfig } from '../services/config.js';

const __dirname  = path.dirname(fileURLToPath(import.meta.url));
const DATA_ROOT  = path.resolve(__dirname, '..', '..', '..', '..', 'data', 'agents');
const TRAIN_ROOT = path.resolve(__dirname, '..', '..', '..', '..', 'training');
const VENV_PYTHON = path.join(TRAIN_ROOT, '.venv', 'Scripts', 'python.exe');
const PYTHON_EXE  = fs.existsSync(VENV_PYTHON) ? VENV_PYTHON : 'python';

// Price cache — refresh every 45 seconds
let priceCache: { data: CoinPrice[]; ts: number } | null = null;

interface CoinPrice {
  id: string; symbol: string; name: string;
  current_price: number; price_change_percentage_24h: number;
  market_cap: number; total_volume: number; high_24h: number; low_24h: number;
}

const TRADING_SYSTEM_APEX2 = `You are APEX-2, a quantitative technical analyst for crypto markets. You receive raw market data and produce a precise, structured technical report. Always follow this EXACT output format — no deviations, no extra text before or after:

TREND: [BULLISH / BEARISH / SIDEWAYS] — [one sentence: why, based on price vs high/low]
MOMENTUM: [STRONG / MODERATE / WEAK] — [volume and price-action note]
RSI ESTIMATE: [OVERSOLD / NEUTRAL / OVERBOUGHT] — [reasoning from price position in 24h range]
SUPPORT: $[exact price]
RESISTANCE: $[exact price]

SIGNAL: [BUY / SELL / HOLD]
ENTRY: $[price] – $[price]
TARGET 1: $[price] ([+X.X% or -X.X%])
TARGET 2: $[price] ([+X.X% or -X.X%])
STOP LOSS: $[price] ([-X.X% or +X.X%])
RISK/REWARD: 1:[X.X]
CONFIDENCE: [X]%

REASONING: [2-3 sentences. Explain price structure, volume, and pattern — be specific with numbers.]`;

const TRADING_SYSTEM_TACTIX = `You are TACTIX, elite portfolio strategist. You receive APEX-2's technical analysis and produce an actionable trading strategy. Always follow this EXACT output format — no deviations:

MACRO: [one sentence on current crypto market environment and relevant macro factors]
VALIDATION: [CONFIRMED / WEAK / REJECTED] — [one sentence explaining alignment with macro]

POSITION: [X]% of portfolio — [market / limit / scaled] entry
EXECUTION:
  Fase 1 — [action] [X]% positie op $[price]
  Fase 2 — [action] [X]% op $[price] [if/when condition]
  Fase 3 — [action] [X]% op $[price] [if/when condition]

RISK:
  Hard stop: $[price]
  Partial exit (50%): $[price]
  Trail stop na: $[price]
  Max verlies: [X]% portfolio

OUTLOOK: [1-2 sentences: daily market view and key things to watch]
VERDICT: [BUY / SELL / HOLD] [SYMBOL] — [HOOG / MIDDEL / LAAG] convictie`;

async function callOllama(ollamaHost: string, model: string, systemPrompt: string, userPrompt: string): Promise<string> {
  const res = await fetch(`${ollamaHost}/api/generate`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ model, system: systemPrompt, prompt: userPrompt, stream: false }),
    signal: AbortSignal.timeout(60_000),
  });
  if (!res.ok) throw new Error(`Ollama error: ${res.status}`);
  const json = await res.json() as any;
  return json.response ?? '';
}

function coinMarketPrompt(coin: CoinPrice): string {
  const dir = coin.price_change_percentage_24h >= 0 ? '▲' : '▼';
  return [
    `Symbol: ${coin.symbol.toUpperCase()}/USD`,
    `Price: $${coin.current_price.toLocaleString('en-US', { maximumFractionDigits: 2 })}`,
    `24h Change: ${dir} ${Math.abs(coin.price_change_percentage_24h).toFixed(2)}%`,
    `24h High: $${coin.high_24h.toLocaleString('en-US', { maximumFractionDigits: 2 })}`,
    `24h Low: $${coin.low_24h.toLocaleString('en-US', { maximumFractionDigits: 2 })}`,
    `Volume 24h: $${(coin.total_volume / 1e9).toFixed(2)}B`,
    `Market Cap: $${(coin.market_cap / 1e9).toFixed(1)}B`,
  ].join('\n');
}

export async function tradingRoutes(fastify: FastifyInstance) {

  // ── GET /api/trading/market ───────────────────────────────────────────────
  fastify.get('/api/trading/market', async (_req, reply) => {
    const now = Date.now();
    if (priceCache && now - priceCache.ts < 45_000) {
      return reply.send(priceCache.data);
    }
    try {
      const res = await fetch(
        'https://api.coingecko.com/api/v3/coins/markets' +
        '?vs_currency=usd' +
        '&ids=bitcoin,ethereum,solana,binancecoin,cardano,avalanche-2,chainlink,polkadot' +
        '&order=market_cap_desc&per_page=8&page=1&sparkline=false&price_change_percentage=24h',
        { signal: AbortSignal.timeout(10_000) }
      );
      if (!res.ok) throw new Error('CoinGecko error');
      const data = await res.json() as CoinPrice[];
      priceCache = { data, ts: now };
      return reply.send(data);
    } catch {
      if (priceCache) return reply.send(priceCache.data);
      return reply.status(503).send({ error: 'Market data tijdelijk niet beschikbaar' });
    }
  });

  // ── GET /api/trading/news ─────────────────────────────────────────────────
  fastify.get('/api/trading/news', async (_req, reply) => {
    try {
      const res = await fetch(
        'https://api.coingecko.com/api/v3/news?per_page=15',
        { signal: AbortSignal.timeout(10_000) }
      );
      if (!res.ok) throw new Error('news error');
      const json = await res.json() as any;
      const items = (json.data ?? []).slice(0, 15).map((n: any) => ({
        title: n.title,
        author: n.author ?? n.news_site ?? 'unknown',
        url: n.url,
        publishedAt: n.updated_at,
        sentiment: n.sentiment ?? 'neutral',
      }));
      return reply.send(items);
    } catch {
      return reply.send([]);
    }
  });

  // ── POST /api/trading/generate ────────────────────────────────────────────
  fastify.post<{ Body: { coinId?: string; userContext?: string } }>(
    '/api/trading/generate',
    async (req, reply) => {
      const coinId = req.body?.coinId ?? 'bitcoin';
      const userContext = req.body?.userContext ?? '';

      // Fetch live price
      let coin: CoinPrice | undefined;
      try {
        const now = Date.now();
        if (!priceCache || now - priceCache.ts > 45_000) {
          const res = await fetch(
            `https://api.coingecko.com/api/v3/coins/markets?vs_currency=usd&ids=${coinId}&sparkline=false`,
            { signal: AbortSignal.timeout(10_000) }
          );
          if (res.ok) {
            const data = await res.json() as CoinPrice[];
            coin = data[0];
          }
        } else {
          coin = priceCache.data.find(c => c.id === coinId);
        }
      } catch {}

      const marketData = coin
        ? coinMarketPrompt(coin)
        : `Symbol: ${coinId.toUpperCase()}\nLive data not available.`;

      const userCtxLine = userContext ? `\nUser context: ${userContext}` : '';
      const apex2Prompt = `Analyze the following market data and give your technical assessment:\n\n${marketData}${userCtxLine}`;

      const cfg = getConfig();
      const ollamaHost = cfg.ollamaUrl ?? 'http://localhost:11434';

      // Step 1: APEX-2 technical analysis
      let apex2Analysis = '';
      try {
        apex2Analysis = await callOllama(ollamaHost, 'apex2', TRADING_SYSTEM_APEX2, apex2Prompt);
      } catch (e: any) {
        apex2Analysis = `[APEX-2 unavailable: ${e.message}]`;
      }

      // Step 2: TACTIX strategic synthesis
      const tactixPrompt = [
        `APEX-2 Technical Analysis:\n${apex2Analysis}`,
        `\nMarket Data:\n${marketData}`,
        userContext ? `\nAdditional context: ${userContext}` : '',
        `\nProvide your strategic trading recommendation.`,
      ].join('');

      let tactixStrategy = '';
      try {
        tactixStrategy = await callOllama(ollamaHost, 'tactix', TRADING_SYSTEM_TACTIX, tactixPrompt);
      } catch (e: any) {
        tactixStrategy = `[TACTIX unavailable: ${e.message}]`;
      }

      // Save to DB
      const snapshot = JSON.stringify({ coin: coin ?? { id: coinId }, userContext });
      db.prepare(`
        INSERT INTO trade_strategies (symbol, apex2_analysis, tactix_strategy, market_snapshot)
        VALUES (?, ?, ?, ?)
      `).run(coin?.symbol?.toUpperCase() ?? coinId.toUpperCase(), apex2Analysis, tactixStrategy, snapshot);

      return reply.send({ apex2Analysis, tactixStrategy, marketData, coin });
    }
  );

  // ── GET /api/trading/strategies ───────────────────────────────────────────
  fastify.get<{ Querystring: { limit?: string } }>(
    '/api/trading/strategies',
    async (req, reply) => {
      const limit = Math.min(parseInt(req.query.limit ?? '20', 10), 100);
      const rows = db.prepare(
        'SELECT * FROM trade_strategies ORDER BY timestamp DESC LIMIT ?'
      ).all(limit);
      return reply.send(rows);
    }
  );

  // ── POST /api/trading/strategies/:id/rate ─────────────────────────────────
  fastify.post<{ Params: { id: string }; Body: { rating: number; outcome: string; pnl_pct?: number } }>(
    '/api/trading/strategies/:id/rate',
    async (req, reply) => {
      const { id } = req.params;
      const { rating, outcome, pnl_pct } = req.body;
      db.prepare(
        'UPDATE trade_strategies SET rating=?, outcome=?, pnl_pct=? WHERE id=?'
      ).run(rating, outcome, pnl_pct ?? null, id);

      // If good strategy (rating >= 4) → save as training data for both agents
      if (rating >= 4) {
        const row = db.prepare('SELECT * FROM trade_strategies WHERE id=?').get(id) as any;
        if (row) {
          const apex2Dir = path.join(DATA_ROOT, 'apex2');
          const tactixDir = path.join(DATA_ROOT, 'tactix');
          fs.mkdirSync(apex2Dir, { recursive: true });
          fs.mkdirSync(tactixDir, { recursive: true });

          const snapshot = JSON.parse(row.market_snapshot ?? '{}');
          const marketStr = snapshot?.coin ? coinMarketPrompt(snapshot.coin) : `Symbol: ${row.symbol}`;

          const apex2Pair = JSON.stringify({
            prompt: `Analyze the following market data:\n${marketStr}`,
            response: row.apex2_analysis,
          });
          const tactixPair = JSON.stringify({
            prompt: `APEX-2 Analysis:\n${row.apex2_analysis}\n\nMarket Data:\n${marketStr}\n\nProvide your strategic recommendation.`,
            response: row.tactix_strategy,
          });

          const date = new Date().toISOString().split('T')[0];
          fs.appendFileSync(path.join(apex2Dir, `rated_${date}.jsonl`), apex2Pair + '\n', 'utf-8');
          fs.appendFileSync(path.join(tactixDir, `rated_${date}.jsonl`), tactixPair + '\n', 'utf-8');
        }
      }

      return reply.send({ ok: true });
    }
  );

  // ── GET /api/trading/collect ──────────────────────────────────────────────
  fastify.get<{ Querystring: { agent?: string } }>(
    '/api/trading/collect',
    async (req, reply) => {
      const agent = req.query?.agent ?? 'both';
      const scriptPath = path.join(TRAIN_ROOT, 'lora', 'collect_trading_data.py');
      if (!fs.existsSync(scriptPath)) {
        return reply.status(404).send({ error: 'Collectiescript niet gevonden' });
      }

      reply.raw.writeHead(200, {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        'Connection': 'keep-alive',
        'Access-Control-Allow-Origin': '*',
      });

      const { spawn } = await import('child_process');
      const proc = spawn(PYTHON_EXE, [scriptPath, agent], {
        cwd: path.join(TRAIN_ROOT, 'lora'),
        env: { ...process.env },
      });

      const send = (line: string) => {
        try { reply.raw.write(`data: ${JSON.stringify({ line })}\n\n`); } catch {}
      };

      proc.stdout.on('data', (d: Buffer) =>
        d.toString().split('\n').filter(Boolean).forEach(send));
      proc.stderr.on('data', (d: Buffer) =>
        d.toString().split('\n').filter(Boolean).forEach(l => send(`[ERR] ${l}`)));
      proc.on('close', () => {
        try { reply.raw.write(`data: ${JSON.stringify({ line: '✅ Datacollectie klaar' })}\n\n`); } catch {}
        try { reply.raw.end(); } catch {}
      });
    }
  );

  // ── GET /api/trading/dataset-info ─────────────────────────────────────────
  fastify.get('/api/trading/dataset-info', async (_req, reply) => {
    const info: Record<string, number> = {};
    for (const agent of ['apex2', 'tactix']) {
      const dir = path.join(DATA_ROOT, agent);
      if (!fs.existsSync(dir)) { info[agent] = 0; continue; }
      let total = 0;
      for (const f of fs.readdirSync(dir).filter(f => f.endsWith('.jsonl'))) {
        const lines = fs.readFileSync(path.join(dir, f), 'utf-8')
          .split('\n').filter(l => l.trim()).length;
        total += lines;
      }
      info[agent] = total;
    }
    return reply.send(info);
  });
}
