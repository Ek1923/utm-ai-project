import type { FastifyInstance } from 'fastify';
import { geocode, reverseGeocode } from '../services/maps.js';

export async function mapsRoutes(fastify: FastifyInstance) {
  fastify.get('/api/maps/geocode', async (request, reply) => {
    const { q } = request.query as { q?: string };
    if (!q) return reply.code(400).send({ error: 'Missing query param: q' });
    try {
      const result = await geocode(q);
      return reply.send(result);
    } catch (err) {
      return reply.code(500).send({ error: String(err) });
    }
  });

  fastify.get('/api/maps/reverse', async (request, reply) => {
    const { lat, lon } = request.query as { lat?: string; lon?: string };
    if (!lat || !lon) return reply.code(400).send({ error: 'Missing lat/lon' });
    try {
      const result = await reverseGeocode(parseFloat(lat), parseFloat(lon));
      return reply.send({ result });
    } catch (err) {
      return reply.code(500).send({ error: String(err) });
    }
  });
}
