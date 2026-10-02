import type { FastifyInstance } from 'fastify';
import { db } from '../services/database.js';
import { trainAgentBackground } from '../services/agent-trainer.js';
import { notifyStatsChanged } from '../services/stats-emitter.js';

export async function feedbackRoutes(fastify: FastifyInstance) {
  fastify.post('/api/feedback', async (request, reply) => {
    const { agent, prompt, response, rating, comment } = request.body as {
      agent: string;
      prompt?: string;
      response: string;
      rating: number;
      comment?: string;
    };

    if (!agent || response === undefined || rating === undefined) {
      return reply.code(400).send({ error: 'Missing required fields: agent, response, rating' });
    }

    db.prepare(`
      INSERT INTO feedback (agent, prompt, response, rating, comment)
      VALUES (?, ?, ?, ?, ?)
    `).run(agent, prompt ?? '', response, rating, comment ?? '');

    // Correct feedback → trigger background training for that agent immediately
    if (rating === 1) {
      trainAgentBackground(agent);
    }

    notifyStatsChanged();
    return reply.send({ ok: true });
  });

  fastify.delete('/api/feedback/jarvis', async (_request, reply) => {
    db.prepare(`DELETE FROM feedback WHERE comment = 'jarvis_live'`).run();
    notifyStatsChanged();
    return reply.send({ ok: true });
  });

  fastify.delete('/api/feedback/:id', async (request, reply) => {
    const { id } = request.params as { id: string };
    db.prepare(`DELETE FROM feedback WHERE id = ?`).run(Number(id));
    notifyStatsChanged();
    return reply.send({ ok: true });
  });

  fastify.post('/api/feedback/:id/dataset', async (request, reply) => {
    const { id } = request.params as { id: string };
    const row = db.prepare(`SELECT agent FROM feedback WHERE id = ?`).get(Number(id)) as { agent: string } | undefined;
    db.prepare(`UPDATE feedback SET rating = 1, comment = 'dataset' WHERE id = ?`).run(Number(id));
    if (row?.agent) trainAgentBackground(row.agent);
    notifyStatsChanged();
    return reply.send({ ok: true });
  });

  fastify.get('/api/feedback/jarvis', async (_request, reply) => {
    const rows = db.prepare(`
      SELECT id, agent, prompt, response, timestamp
      FROM feedback WHERE comment = 'jarvis_live'
      ORDER BY timestamp DESC LIMIT 100
    `).all();
    return reply.send({ conversations: rows });
  });

  fastify.get('/api/feedback/stats', async (_request, reply) => {
    const stats = db.prepare(`
      SELECT agent,
             COUNT(*) as total,
             SUM(CASE WHEN rating = 1 THEN 1 ELSE 0 END) as positive,
             SUM(CASE WHEN used_in_training = 0 THEN 1 ELSE 0 END) as pending_training
      FROM feedback
      GROUP BY agent
    `).all();
    return reply.send({ stats });
  });
}
