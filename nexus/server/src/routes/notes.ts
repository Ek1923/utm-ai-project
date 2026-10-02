import type { FastifyInstance } from 'fastify';
import { queryAgent } from '../services/ollama.js';

interface SummarizeBody {
  transcript: string;
  title?: string;
  language?: string;
}

// The local Phi model handles the summarisation. Override with NOTES_MODEL if needed.
const NOTES_MODEL = process.env.NOTES_MODEL ?? 'phi3.5';
const MAX_TRANSCRIPT = 12_000; // keep within Phi's context window

function buildPrompt(transcript: string, title?: string, language?: string): string {
  const head = title ? `Meeting: ${title}\n\n` : '';
  const lang = language
    ? `Write the notes in ${language}.`
    : `Write the notes in the same language as the transcript.`;
  return (
    `You are a professional meeting-notes assistant. Read the meeting transcript and produce clear, well-structured notes. ${lang}\n\n` +
    `Use exactly these markdown sections, in this order:\n` +
    `## Summary\nA concise 3-5 sentence overview of the meeting.\n` +
    `## Key Points\nBullet list of the main topics discussed.\n` +
    `## Decisions\nBullet list of decisions made, or "None".\n` +
    `## Action Items\nBullet list formatted as "- [ ] owner — task (deadline if mentioned)", or "None".\n\n` +
    `Only output the notes, nothing else.\n\n` +
    `${head}Transcript:\n<<<\n${transcript}\n>>>`
  );
}

export async function notesRoutes(fastify: FastifyInstance) {

  // Summarise a meeting transcript into structured notes via the Phi model.
  fastify.post<{ Body: SummarizeBody }>('/api/notes/summarize', async (req, reply) => {
    const { transcript, title, language } = req.body ?? {} as SummarizeBody;
    const text = (transcript ?? '').trim();
    if (text.length < 20) {
      return reply.code(400).send({ ok: false, message: 'Transcript te kort om samen te vatten' });
    }

    const clipped = text.length > MAX_TRANSCRIPT ? text.slice(0, MAX_TRANSCRIPT) : text;

    try {
      const summary = await queryAgent(NOTES_MODEL, buildPrompt(clipped, title, language), 0.3);
      return reply.send({
        ok: true,
        model: NOTES_MODEL,
        truncated: text.length > MAX_TRANSCRIPT,
        summary: (summary ?? '').trim(),
      });
    } catch (e) {
      return reply.code(502).send({ ok: false, message: `Phi-model niet bereikbaar: ${(e as Error).message}` });
    }
  });
}
