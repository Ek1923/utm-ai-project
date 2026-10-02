import type { FastifyInstance } from 'fastify';
import {
  getWorkflows, getWorkflow, createWorkflow,
  updateWorkflow, deleteWorkflow, runWorkflow,
} from '../services/automation.js';

export async function automationRoutes(fastify: FastifyInstance) {

  fastify.get('/api/automation/workflows', async (_req, reply) => {
    return reply.send({ workflows: getWorkflows() });
  });

  fastify.get<{ Params: { id: string } }>('/api/automation/workflows/:id', async (req, reply) => {
    const wf = getWorkflow(req.params.id);
    if (!wf) return reply.code(404).send({ error: 'Not found' });
    return reply.send({ workflow: wf });
  });

  fastify.post('/api/automation/workflows', async (req, reply) => {
    const body = req.body as Record<string, unknown>;
    if (!body.name || !body.agent) return reply.code(400).send({ error: 'name and agent required' });
    const wf = createWorkflow({
      name:        String(body.name),
      agent:       String(body.agent),
      description: String(body.description ?? ''),
      trigger:     (body.trigger as never) ?? { type: 'manual' },
      steps:       (body.steps as never) ?? [],
      enabled:     true,
    });
    return reply.code(201).send({ workflow: wf });
  });

  fastify.patch<{ Params: { id: string } }>('/api/automation/workflows/:id', async (req, reply) => {
    const updated = updateWorkflow(req.params.id, req.body as never);
    if (!updated) return reply.code(404).send({ error: 'Not found' });
    return reply.send({ workflow: updated });
  });

  fastify.delete<{ Params: { id: string } }>('/api/automation/workflows/:id', async (req, reply) => {
    const all = getWorkflows();
    if (all.length <= 1) return reply.code(400).send({ error: 'Minimaal 1 flow is vereist' });
    if (!deleteWorkflow(req.params.id)) return reply.code(404).send({ error: 'Not found' });
    return reply.send({ ok: true });
  });

  // ── Run a workflow — SSE stream of log lines ──────────────────────────────
  fastify.post<{ Params: { id: string } }>('/api/automation/workflows/:id/run', async (req, reply) => {
    const wf = getWorkflow(req.params.id);
    if (!wf) return reply.code(404).send({ error: 'Not found' });

    reply.raw.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection':   'keep-alive',
      'Access-Control-Allow-Origin': '*',
    });

    const send = (type: string, data: object) => {
      try { reply.raw.write(`data: ${JSON.stringify({ type, data })}\n\n`); } catch {}
    };

    const { ok, output } = await runWorkflow(wf.id, (line, lineOk) => {
      send('log', { message: line, ok: lineOk ?? true });
    });

    send('done', { ok, output });
    reply.raw.end();
  });

  // ── Webhook trigger: POST /api/automation/webhook/:webhookId ─────────────
  fastify.post<{ Params: { webhookId: string } }>('/api/automation/webhook/:webhookId', async (req, reply) => {
    const wf = getWorkflows().find(w => w.trigger.webhookId === req.params.webhookId && w.enabled);
    if (!wf) return reply.code(404).send({ error: 'No workflow for this webhook' });
    runWorkflow(wf.id, () => {}).catch(() => {}); // fire-and-forget
    return reply.send({ ok: true, workflow: wf.name });
  });
}
