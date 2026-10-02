import type { FastifyInstance } from 'fastify';
import { processCommand, UserLocation } from '../services/orchestrator.js';

export async function commandRoutes(fastify: FastifyInstance) {
  fastify.post('/api/command', async (request, reply) => {
    const { message, location, sessionId, forceAgent, systemContext } = request.body as { message?: string; location?: UserLocation; sessionId?: string; forceAgent?: string; systemContext?: string };

    if (!message?.trim()) {
      return reply.code(400).send({ error: 'Missing message' });
    }

    reply.raw.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
      'Access-Control-Allow-Origin': '*',
    });

    const send = (data: object) => {
      reply.raw.write(`data: ${JSON.stringify(data)}\n\n`);
    };

    await processCommand(message.trim(), send, location, sessionId ?? 'default', forceAgent, systemContext);
    reply.raw.end();
  });
}
