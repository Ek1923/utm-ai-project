import type { FastifyInstance } from 'fastify';
import { listModels, streamAgent } from '../services/ollama.js';
import { AGENT_PROFILES } from '../agents/profiles.js';
import { db } from '../services/database.js';
import { statsEmitter } from '../services/stats-emitter.js';
import { getConfig } from '../services/config.js';
import axios from 'axios';

// Agent ID → BMX model name (phi3.5 or deepseek-coder)
const AGENT_MODEL: Record<string, string> = {
  apex1:    'phi3.5',
  apex2:    'phi3.5',
  spark:    'phi3.5',
  atlas:    'phi3.5',
  tactix:   'phi3.5',
  vega:     'phi3.5',
  nexus_ui: 'phi3.5',
  optic:    'phi3.5',
  jarvis:   'phi3.5',
  forge:    'deepseek-coder',
};
const resolveModel = (id: string) => AGENT_MODEL[id] ?? id;

// Known fallback params per model — used when Camelllo hasn't loaded the model yet
const MODEL_FALLBACK: Record<string, { paramSize: string; family: string; quantization: string }> = {
  'deepseek-coder': { paramSize: '6.7B', family: 'DeepSeek-Coder', quantization: 'Q4_K_M' },
  'phi3.5':         { paramSize: '3.8B', family: 'Phi-3.5',        quantization: 'Q4_K_M' },
};

// Cache model params so we don't hammer Camelllo
let paramCache: Record<string, { paramSize: string; family: string; quantization: string }> = {};
let paramCachedAt = 0;

async function fetchModelParams(): Promise<typeof paramCache> {
  if (Date.now() - paramCachedAt < 60_000) return paramCache;
  const url = getConfig().ollamaUrl;
  const result: typeof paramCache = {};

  await Promise.all(Object.keys(AGENT_PROFILES).map(async (id) => {
    const modelName = resolveModel(id);
    const fallback  = MODEL_FALLBACK[modelName] ?? { paramSize: '3.8B', family: 'Phi-3.5', quantization: 'Q4_K_M' };
    try {
      const res     = await axios.post(`${url}/api/show`, { name: modelName }, { timeout: 5000 });
      const details = res.data?.details ?? {};
      result[id] = {
        paramSize:    details.parameter_size     ?? fallback.paramSize,
        family:       details.family             ?? fallback.family,
        quantization: details.quantization_level ?? fallback.quantization,
      };
    } catch {
      // Camelllo niet bereikbaar of model niet geladen — gebruik bekende fallback
      result[id] = fallback;
    }
  }));

  paramCache    = result;
  paramCachedAt = Date.now();
  return result;
}

// Cached Ollama model list so SSE doesn't hammer Ollama on every DB change
let cachedModels: string[] = [];
let modelsCachedAt = 0;
async function getModels(): Promise<string[]> {
  if (Date.now() - modelsCachedAt < 8_000) return cachedModels;
  try {
    cachedModels = await listModels();
    modelsCachedAt = Date.now();
  } catch {}
  return cachedModels;
}

export function getAgentStats(): Record<string, {
  feedback: number; trained: number; commands: number;
  trainRuns: number; collectRuns: number; collectedPairs: number;
}> {
  const stats: Record<string, { feedback: number; trained: number; commands: number; trainRuns: number; collectRuns: number; collectedPairs: number }> = {};

  try {
    const feedbackCounts = db.prepare(`
      SELECT agent, COUNT(*) as approved, SUM(used_in_training) as trained
      FROM feedback WHERE rating = 1 GROUP BY agent
    `).all() as { agent: string; approved: number; trained: number }[];
    for (const row of feedbackCounts) {
      stats[row.agent] = { feedback: row.approved, trained: row.trained ?? 0, commands: 0, trainRuns: 0, collectRuns: 0, collectedPairs: 0 };
    }
  } catch {}

  try {
    const commandCounts = db.prepare(`
      SELECT routing, COUNT(*) as count FROM command_log GROUP BY routing
    `).all() as { routing: string; count: number }[];
    for (const row of commandCounts) {
      try {
        const routing = JSON.parse(row.routing);
        for (const agentId of (routing.agents ?? [])) {
          if (!stats[agentId]) stats[agentId] = { feedback: 0, trained: 0, commands: 0, trainRuns: 0, collectRuns: 0, collectedPairs: 0 };
          stats[agentId].commands += row.count;
        }
      } catch {}
    }
  } catch {}

  try {
    const trainingRuns = db.prepare(`
      SELECT agent,
        SUM(CASE WHEN type = 'train' THEN 1 ELSE 0 END) as train_runs,
        SUM(CASE WHEN type = 'collect' AND success = 1 THEN 1 ELSE 0 END) as collect_runs,
        SUM(CASE WHEN type = 'collect' THEN pairs_added ELSE 0 END) as collected_pairs
      FROM training_runs GROUP BY agent
    `).all() as { agent: string; train_runs: number; collect_runs: number; collected_pairs: number }[];
    for (const row of trainingRuns) {
      if (!stats[row.agent]) stats[row.agent] = { feedback: 0, trained: 0, commands: 0, trainRuns: 0, collectRuns: 0, collectedPairs: 0 };
      stats[row.agent].trainRuns     = row.train_runs ?? 0;
      stats[row.agent].collectRuns   = row.collect_runs ?? 0;
      stats[row.agent].collectedPairs = row.collected_pairs ?? 0;
    }
  } catch {}

  return stats;
}

export async function agentRoutes(fastify: FastifyInstance) {
  fastify.get('/api/agents', async (_request, reply) => {
    const models = await listModels();
    const agents = Object.values(AGENT_PROFILES).map(profile => ({
      id: profile.id,
      name: profile.name,
      loaded: models.some(m => m.toLowerCase().startsWith(resolveModel(profile.id))),
    }));
    return reply.send({ agents, ollamaModels: models });
  });

  fastify.get('/api/agents/stats', async (_req, reply) => {
    return reply.send({ stats: getAgentStats() });
  });

  // Real model parameters pulled live from Ollama
  fastify.get('/api/models/params', async (_req, reply) => {
    const params = await fetchModelParams();
    return reply.send({ params });
  });

  // SSE — pushes full stats+agents payload instantly on every DB change
  fastify.get('/api/stats/live', async (request, reply) => {
    reply.raw.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection':   'keep-alive',
      'Access-Control-Allow-Origin': '*',
    });

    const send = (payload: object) => {
      try { reply.raw.write(`data: ${JSON.stringify(payload)}\n\n`); } catch {}
    };

    const push = async () => {
      const models = await getModels();
      const agents = Object.values(AGENT_PROFILES).map(p => ({
        id: p.id, name: p.name,
        loaded: models.some(m => m.toLowerCase().startsWith(resolveModel(p.id))),
      }));
      send({ type: 'update', agents, ollamaModels: models, stats: getAgentStats() });
    };

    // Initial payload immediately on connect
    await push();

    // Push on every DB change event
    statsEmitter.on('change', push);

    // Periodic push every 20s — keeps data live even without DB change events
    const hb = setInterval(push, 20_000);

    request.raw.on('close', () => {
      statsEmitter.off('change', push);
      clearInterval(hb);
    });

    // Keep the handler alive (SSE stays open)
    await new Promise<void>(() => {});
  });

  // Direct connection to a specific agent — bypasses routing
  fastify.post('/api/direct/:agentId', async (request, reply) => {
    const { agentId } = request.params as { agentId: string };
    const { message } = request.body as { message: string };

    const profile = AGENT_PROFILES[agentId];
    if (!profile) return reply.code(404).send({ error: `Agent '${agentId}' not found` });

    reply.raw.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
      'Access-Control-Allow-Origin': '*',
    });

    const send = (data: object) => reply.raw.write(`data: ${JSON.stringify(data)}\n\n`);

    send({ type: 'routing', data: { agents: [agentId], reasoning: 'Direct connection', announcement: `${profile.name} direct link established.` } });
    send({ type: 'direct_start', data: { agent: agentId } });

    try {
      const fullPrompt = `${profile.systemPrompt}\n\nUser: ${message}\n\nAssistant:`;
      let accumulated = '';
      await streamAgent(agentId, fullPrompt, profile.temperature, (token) => {
        accumulated += token;
        send({ type: 'token', data: { agent: agentId, token } });
      });
      send({ type: 'agent_response', data: { agent: agentId, response: accumulated } });
    } catch (err) {
      send({ type: 'error', data: { error: (err as Error).message } });
    }

    send({ type: 'done', data: { success: true } });
    reply.raw.end();
  });
}
