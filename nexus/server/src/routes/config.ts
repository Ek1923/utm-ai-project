import type { FastifyInstance } from 'fastify';
import { getConfig, updateConfig, resetConfig } from '../services/config.js';

export async function configRoutes(fastify: FastifyInstance) {
  fastify.get('/api/config', async (_req, reply) => {
    return reply.send({ config: getConfig() });
  });

  fastify.patch('/api/config', async (request, reply) => {
    const patch = request.body as Record<string, unknown>;
    const updated = updateConfig(patch as never);
    return reply.send({ config: updated });
  });

  fastify.post('/api/config/reset', async (_req, reply) => {
    const config = resetConfig();
    return reply.send({ config });
  });
}
