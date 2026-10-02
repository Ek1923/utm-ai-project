import type { FastifyInstance } from 'fastify';
import { generateSpeech } from '../services/voice.js';

export async function voiceRoutes(fastify: FastifyInstance) {
  fastify.get('/api/voice/stream', async (request, reply) => {
    const { text, speed } = request.query as { text?: string; speed?: string };

    if (!text?.trim()) {
      return reply.code(400).send({ error: 'Missing text parameter' });
    }

    const speedNum = speed ? parseFloat(speed) : 1.0;

    try {
      const audio = await generateSpeech(text.trim(), speedNum);
      reply.header('Content-Type', 'audio/wav');
      reply.header('Content-Length', audio.length);
      return reply.send(audio);
    } catch (err) {
      return reply.code(503).send({ error: (err as Error).message, hint: 'Install with: pip install kokoro-tts' });
    }
  });
}
