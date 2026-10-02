import type { FastifyInstance } from 'fastify';
import {
  loadIntegrations,
  createIntegration,
  updateIntegration,
  deleteIntegration,
} from '../services/integrations.js';

export async function integrationRoutes(fastify: FastifyInstance) {
  fastify.get('/api/integrations', async (_req, reply) => {
    return reply.send({ integrations: loadIntegrations() });
  });

  fastify.post('/api/integrations', async (request, reply) => {
    const body = request.body as {
      name: string;
      description?: string;
      baseUrl: string;
      apiKey: string;
      type?: string;
      agents?: string[];
    };
    if (!body.name || !body.baseUrl) {
      return reply.code(400).send({ error: 'name and baseUrl required' });
    }
    const item = createIntegration({
      name: body.name,
      description: body.description ?? '',
      baseUrl: body.baseUrl,
      apiKey: body.apiKey ?? '',
      type: body.type ?? 'custom',
      enabled: true,
      agents: body.agents ?? [],
    });
    return reply.code(201).send({ integration: item });
  });

  fastify.patch('/api/integrations/:id', async (request, reply) => {
    const { id } = request.params as { id: string };
    const patch = request.body as Record<string, unknown>;
    const updated = updateIntegration(id, patch as never);
    if (!updated) return reply.code(404).send({ error: 'Not found' });
    return reply.send({ integration: updated });
  });

  fastify.delete('/api/integrations/:id', async (request, reply) => {
    const { id } = request.params as { id: string };
    const ok = deleteIntegration(id);
    if (!ok) return reply.code(404).send({ error: 'Not found' });
    return reply.send({ ok: true });
  });
}
