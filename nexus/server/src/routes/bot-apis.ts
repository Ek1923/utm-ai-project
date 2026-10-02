import type { FastifyInstance } from 'fastify';
import { db } from '../services/database.js';
import { AGENT_PROFILES } from '../agents/profiles.js';
import { streamAgent } from '../services/ollama.js';
import crypto from 'node:crypto';

db.exec(`
  CREATE TABLE IF NOT EXISTS bot_api_keys (
    id         TEXT PRIMARY KEY,
    name       TEXT NOT NULL,
    agent_id   TEXT NOT NULL,
    api_key    TEXT NOT NULL UNIQUE,
    enabled    INTEGER DEFAULT 1,
    calls      INTEGER DEFAULT 0,
    created_at DATETIME DEFAULT (datetime('now'))
  );
`);

function genKey(): string {
  return 'nxs_' + crypto.randomBytes(20).toString('hex');
}

export async function botApiRoutes(fastify: FastifyInstance) {

  // List all API keys
  fastify.get('/api/botkeys', async (_req, reply) => {
    const keys = db.prepare('SELECT * FROM bot_api_keys ORDER BY created_at DESC').all();
    return reply.send({ keys });
  });

  // Generate new API key
  fastify.post<{ Body: { agentId: string; name: string } }>(
    '/api/botkeys',
    async (req, reply) => {
      const { agentId, name } = req.body ?? {};
      if (!agentId || !name)
        return reply.code(400).send({ error: 'agentId en name zijn verplicht' });

      const id     = crypto.randomUUID();
      const apiKey = genKey();
      db.prepare(
        'INSERT INTO bot_api_keys (id, name, agent_id, api_key) VALUES (?, ?, ?, ?)'
      ).run(id, name, agentId, apiKey);

      const row = db.prepare('SELECT * FROM bot_api_keys WHERE id = ?').get(id);
      return reply.code(201).send({ key: row, rawKey: apiKey });
    }
  );

  // Toggle enabled / disabled
  fastify.patch<{ Params: { id: string }; Body: { enabled: boolean } }>(
    '/api/botkeys/:id',
    async (req, reply) => {
      db.prepare('UPDATE bot_api_keys SET enabled = ? WHERE id = ?')
        .run(req.body.enabled ? 1 : 0, req.params.id);
      return reply.send({ ok: true });
    }
  );

  // Delete key
  fastify.delete<{ Params: { id: string } }>(
    '/api/botkeys/:id',
    async (req, reply) => {
      db.prepare('DELETE FROM bot_api_keys WHERE id = ?').run(req.params.id);
      return reply.send({ ok: true });
    }
  );

  // ── External bot call (for n8n / external clients) ────────────────────────
  fastify.post<{
    Params: { agentId: string };
    Body: { message: string; api_key?: string };
  }>(
    '/api/bot/:agentId',
    async (req, reply) => {
      const { agentId }      = req.params;
      const { message, api_key } = req.body ?? {};

      const headerKey = (req.headers['x-api-key'] as string | undefined) ?? api_key ?? '';
      if (!headerKey)
        return reply.code(401).send({ error: 'API sleutel vereist (api_key in body of X-Api-Key header)' });

      const keyRow = db.prepare(
        'SELECT * FROM bot_api_keys WHERE api_key = ? AND enabled = 1'
      ).get(headerKey) as Record<string, unknown> | undefined;

      if (!keyRow)
        return reply.code(401).send({ error: 'Ongeldige of uitgeschakelde API sleutel' });

      const allowedAgent = String(keyRow.agent_id);
      if (allowedAgent !== agentId && allowedAgent !== 'all')
        return reply.code(403).send({ error: `Deze sleutel heeft geen toegang tot agent '${agentId}'` });

      const effectiveId = agentId === 'all' ? 'vega' : agentId;
      const profile = AGENT_PROFILES[effectiveId];
      if (!profile)
        return reply.code(404).send({ error: `Agent '${agentId}' niet gevonden` });

      db.prepare('UPDATE bot_api_keys SET calls = calls + 1 WHERE id = ?')
        .run(String(keyRow.id));

      let response = '';
      try {
        const prompt = `${profile.systemPrompt}\n\nUser: ${message ?? ''}\n\nAssistant:`;
        await streamAgent(effectiveId, prompt, profile.temperature, tok => { response += tok; });
      } catch (err) {
        return reply.code(500).send({ error: (err as Error).message });
      }

      return reply.send({
        agent:   agentId === 'all' ? 'ALL' : profile.name,
        agentId: effectiveId,
        response,
        calls: Number(keyRow.calls) + 1,
      });
    }
  );
}
