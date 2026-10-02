import type { FastifyInstance } from 'fastify';
import { queryAgent } from '../services/ollama.js';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATASET_PATH = path.resolve(__dirname, '../../../../data/ecosystem-dataset.jsonl');

const AGENT_ROLES: Record<string, string> = {
  forge:  'FORGE is a technical builder. You build tools, APIs, and automation systems.',
  apex:   'APEX is a routing and distribution expert. You optimize workflows and data pipelines.',
  tactix: 'TACTIX is a business strategist. You analyze markets and create business plans.',
  spark:  'SPARK is a researcher. You find trends, niches, and opportunities through data.',
  vega:   'VEGA is a marketing specialist. You create growth strategies and customer acquisition.',
  atlas:  'ATLAS is a knowledge synthesizer. You connect information and create comprehensive plans.',
};

export async function ecosystemRoutes(fastify: FastifyInstance) {

  // POST /api/ecosystem/idea — collaborative idea generation
  fastify.post('/api/ecosystem/idea', async (req, reply) => {
    const { topic, agentId } = req.body as { topic: string; agentId: string };
    if (!topic || !agentId) return reply.code(400).send({ error: 'topic and agentId required' });

    const role = AGENT_ROLES[agentId] ?? `${agentId} is an AI agent.`;
    const prompt = `${role}

Topic: "${topic}"

Give one specific, actionable insight about this topic from your specialty. Be concrete and brief (2-3 sentences max). Focus on what you uniquely contribute.`;

    try {
      const response = await queryAgent('phi3.5', prompt, 0.75);
      return { agentId, response: response.trim(), topic, timestamp: new Date().toISOString() };
    } catch (err: any) {
      return reply.code(503).send({ error: err?.message ?? 'Camelllo niet bereikbaar' });
    }
  });

  // POST /api/ecosystem/research — deep research by one agent
  fastify.post('/api/ecosystem/research', async (req, reply) => {
    const { query, agentId } = req.body as { query: string; agentId: string };
    if (!query || !agentId) return reply.code(400).send({ error: 'query and agentId required' });

    const role = AGENT_ROLES[agentId] ?? `${agentId} is an AI agent.`;
    const prompt = `${role}

Research question: "${query}"

Provide a structured research summary with:
1. Key findings (2-3 bullet points)
2. Market opportunity or risk
3. Recommended action

Be specific and actionable. Max 150 words.`;

    try {
      const response = await queryAgent('phi3.5', prompt, 0.6);
      return { agentId, response: response.trim(), query, timestamp: new Date().toISOString() };
    } catch (err: any) {
      return reply.code(503).send({ error: err?.message ?? 'Camelllo niet bereikbaar' });
    }
  });

  // GET /api/ecosystem/market — proxy to CoinGecko (free, no key)
  fastify.get('/api/ecosystem/market', async (_req, reply) => {
    try {
      const res = await fetch(
        'https://api.coingecko.com/api/v3/simple/price?ids=bitcoin,ethereum,solana,cardano,chainlink,polkadot&vs_currencies=eur,usd&include_24hr_change=true&include_24hr_vol=true'
      );
      if (!res.ok) throw new Error(`CoinGecko ${res.status}`);
      const data = await res.json();
      return data;
    } catch (err: any) {
      return reply.code(503).send({ error: 'Marktdata niet beschikbaar', detail: err?.message });
    }
  });

  // POST /api/ecosystem/save — append entry to dataset file
  fastify.post('/api/ecosystem/save', async (req, reply) => {
    const entry = req.body as object;
    const line = JSON.stringify({ ...entry, savedAt: new Date().toISOString() }) + '\n';
    try {
      fs.mkdirSync(path.dirname(DATASET_PATH), { recursive: true });
      fs.appendFileSync(DATASET_PATH, line, 'utf8');
      const count = fs.readFileSync(DATASET_PATH, 'utf8').split('\n').filter(Boolean).length;
      return { ok: true, total: count, path: DATASET_PATH };
    } catch (err: any) {
      return reply.code(500).send({ error: 'Opslaan mislukt', detail: err?.message });
    }
  });

  // GET /api/ecosystem/dataset — return full dataset
  fastify.get('/api/ecosystem/dataset', async (_req, reply) => {
    try {
      if (!fs.existsSync(DATASET_PATH)) return { entries: [], total: 0 };
      const lines = fs.readFileSync(DATASET_PATH, 'utf8').split('\n').filter(Boolean);
      return { entries: lines.map(l => JSON.parse(l)), total: lines.length };
    } catch {
      return { entries: [], total: 0 };
    }
  });
}
