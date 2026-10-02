import type { FastifyInstance } from 'fastify';
import { getForgeStatus, getApprovalQueue, toggleAutoApprove, approveFix } from '../services/forge-watcher.js';

export async function forgeRoutes(fastify: FastifyInstance) {
  fastify.get('/api/forge/status', async (_request, reply) => {
    return reply.send(getForgeStatus());
  });

  fastify.get('/api/forge/queue', async (_request, reply) => {
    return reply.send({ fixes: getApprovalQueue() });
  });

  fastify.post('/api/forge/toggle-approve', async (_request, reply) => {
    const state = toggleAutoApprove();
    return reply.send({ autoApprove: state });
  });

  fastify.post('/api/forge/approve/:fixId', async (request, reply) => {
    const { fixId } = request.params as { fixId: string };
    const ok = approveFix(parseInt(fixId, 10));
    return reply.send({ ok });
  });
}
