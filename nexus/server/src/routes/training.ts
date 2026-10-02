import type { FastifyInstance } from 'fastify';
import { spawn } from 'child_process';
import type { ChildProcess } from 'child_process';
import { execSync } from 'child_process';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import { EventEmitter } from 'events';
import { buildModelfile, AGENT_MODELFILE } from '../services/modelfile-builder.js';
import { db } from '../services/database.js';
import { notifyStatsChanged } from '../services/stats-emitter.js';
import { collectDataForAgent, getPlugins, setPluginEnabled } from '../services/data-collector.js';

const __dirname  = path.dirname(fileURLToPath(import.meta.url));
const LORA_DIR   = path.resolve(__dirname, '..', '..', '..', '..', 'training', 'lora');
const TRAIN_ROOT = path.resolve(__dirname, '..', '..', '..', '..', 'training');

// Use the dedicated Python 3.12 + CUDA venv for training — falls back to system python
const VENV_PYTHON = path.join(TRAIN_ROOT, '.venv', 'Scripts', 'python.exe');
const PYTHON_EXE  = fs.existsSync(VENV_PYTHON) ? VENV_PYTHON : 'python';

// QLoRA agents: get a dedicated fine-tuned Ollama model
const LORA_AGENTS = new Set(['jarvis', 'forge', 'atlas', 'spark', 'tactix', 'vega', 'apex1', 'apex2', 'optic']);

// Modelfile agents: JSON-routing, use few-shot Modelfile approach
const MODELFILE_OLLAMA: Record<string, string> = {
  apex1: 'apex1', apex2: 'apex2', nexus_ui: 'optic', optic: 'optic',
};

const activeTraining = new Set<string>();

const AGENTS_DATA_DIR = path.resolve(__dirname, '..', '..', '..', '..', 'data', 'agents');

function archiveTrainingData(agentId: string) {
  const agentDir   = path.join(AGENTS_DATA_DIR, agentId);
  const archiveDir = path.join(agentDir, 'archive');
  if (!fs.existsSync(agentDir)) return;
  const files = fs.readdirSync(agentDir).filter(f => f.endsWith('.jsonl'));
  if (files.length === 0) return;
  fs.mkdirSync(archiveDir, { recursive: true });
  const timestamp = Date.now();
  for (const file of files) {
    fs.renameSync(path.join(agentDir, file), path.join(archiveDir, `${timestamp}_${file}`));
  }
}
const trainProcs = new Map<string, ChildProcess>();

function forceKill(agentId: string) {
  const proc = trainProcs.get(agentId);
  if (!proc || proc.pid == null) return;
  try {
    // Windows: /F = force, /T = kill entire process tree (child processes too)
    execSync(`taskkill /F /T /PID ${proc.pid}`, { stdio: 'ignore' });
  } catch {
    try { proc.kill('SIGKILL'); } catch {}
  }
  trainProcs.delete(agentId);
}

// Log replay: buffer all events so reconnecting clients get full history
const logBuffers = new Map<string, Array<{ type: string; data: object }>>();
const trainingBus = new EventEmitter();
trainingBus.setMaxListeners(50);

// Persistent log store — survives tsx watch server restarts
const LOG_DIR = path.resolve(__dirname, '..', '..', '..', '..', 'data', 'training-logs');
try { fs.mkdirSync(LOG_DIR, { recursive: true }); } catch {}

function sessionFile(agentId: string) {
  return path.join(LOG_DIR, `${agentId}-session.jsonl`);
}

function hydrateFromDisk() {
  try {
    for (const file of fs.readdirSync(LOG_DIR)) {
      if (!file.endsWith('-session.jsonl')) continue;
      const agentId = file.replace('-session.jsonl', '');
      const fp = path.join(LOG_DIR, file);
      const ageMs = Date.now() - fs.statSync(fp).mtimeMs;
      if (ageMs > 4 * 60 * 60 * 1000) continue; // older than 4h → skip
      const lines = fs.readFileSync(fp, 'utf8').split('\n').filter(Boolean);
      const events = lines
        .map(l => { try { return JSON.parse(l) as { type: string; data: object }; } catch { return null; } })
        .filter((e): e is { type: string; data: object } => e !== null);
      if (events.length > 0) {
        logBuffers.set(agentId, events);
      }
    }
  } catch {}
}
hydrateFromDisk();

function sseHeaders(reply: any) {
  reply.raw.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    'Connection': 'keep-alive',
    'Access-Control-Allow-Origin': '*',
  });
}

function emit(reply: any, type: string, data: object) {
  try { reply.raw.write(`data: ${JSON.stringify({ type, data })}\n\n`); } catch {}
}

// Emit to primary SSE reply + buffer + persist to disk + broadcast to watchers
function broadcast(reply: any, agentId: string, type: string, data: object) {
  emit(reply, type, data);
  const ev = { type, data };
  const buf = logBuffers.get(agentId);
  if (buf) {
    buf.push(ev);
    if (buf.length > 2000) buf.splice(0, buf.length - 2000);
    try { fs.appendFileSync(sessionFile(agentId), JSON.stringify(ev) + '\n', 'utf8'); } catch {}
  }
  trainingBus.emit(`agent:${agentId}`, ev);
}

export async function trainingRoutes(fastify: FastifyInstance) {

  fastify.get('/api/training/status', async (_req, reply) => {
    return reply.send({ active: activeTraining.size > 0, agents: [...activeTraining] });
  });

  // ── QLoRA training: POST /api/training/lora/:agentId ─────────────────────
  // Works for: jarvis, forge, atlas, spark, tactix, vega
  // Spawns pipeline.py --agent <id>, parses [METRICS] lines → training_metrics events
  fastify.post<{ Params: { agentId: string } }>('/api/training/lora/:agentId', async (request, reply) => {
    const { agentId } = request.params;

    if (!LORA_AGENTS.has(agentId)) {
      reply.code(400).send({ error: `'${agentId}' is not a LoRA agent. Valid: ${[...LORA_AGENTS].join(', ')}` });
      return;
    }

    sseHeaders(reply);

    if (activeTraining.has(agentId)) {
      emit(reply, 'training_log', { message: `${agentId.toUpperCase()}: Training already running.`, agent: agentId });
      emit(reply, 'training_done', { success: false, agent: agentId });
      reply.raw.end();
      return;
    }

    // Init log buffer for this session + clear any old session file
    try { fs.writeFileSync(sessionFile(agentId), '', 'utf8'); } catch {}
    logBuffers.set(agentId, []);
    activeTraining.add(agentId);
    broadcast(reply, agentId, 'training_log', { message: `${agentId.toUpperCase()}: QLoRA pipeline starting...`, agent: agentId });
    broadcast(reply, agentId, 'training_log', { message: `${agentId.toUpperCase()}: RTX 4060 · Phi-3.5-mini · 4-bit NF4`, agent: agentId });

    const pipelineScript = path.join(LORA_DIR, 'pipeline.py');
    let success = false;

    await new Promise<void>((resolve) => {
      const proc = spawn(PYTHON_EXE, [pipelineScript, '--agent', agentId], {
        cwd: LORA_DIR,
        env: { ...process.env, PYTHONIOENCODING: 'utf-8', PYTHONUTF8: '1' },
      });
      trainProcs.set(agentId, proc);

      proc.stdout.on('data', (chunk: Buffer) => {
        chunk.toString('utf-8').split('\n').filter(Boolean).forEach(line => {
          const trimmed = line.trim();
          if (!trimmed) return;

          // [METRICS] lines → structured training_metrics event
          if (trimmed.startsWith('[METRICS]')) {
            try {
              const metrics = JSON.parse(trimmed.slice(9).trim());
              broadcast(reply, agentId, 'training_metrics', { ...metrics, agent: agentId });
            } catch {}
            return;
          }

          // Everything else → log line
          broadcast(reply, agentId, 'training_log', { message: `${agentId.toUpperCase()}: ${trimmed}`, agent: agentId });
          if (trimmed.includes('All stages complete')) success = true;
        });
      });

      proc.stderr.on('data', (chunk: Buffer) => {
        chunk.toString('utf-8').split('\n').filter(Boolean).forEach(line => {
          const t = line.trim();
          if (t && !t.includes('WARNING') && !t.includes('DeprecationWarning') && !t.includes('FutureWarning')) {
            broadcast(reply, agentId, 'training_log', { message: `${agentId.toUpperCase()} [warn]: ${t}`, agent: agentId });
          }
        });
      });

      proc.on('close', (code) => {
        trainProcs.delete(agentId);
        const ok = code === 0 || success;
        if (ok) {
          broadcast(reply, agentId, 'training_log', { message: `${agentId.toUpperCase()}: ✓ Model klaar in Ollama als '${agentId}'.`, agent: agentId });
          archiveTrainingData(agentId);
          try { db.prepare(`INSERT INTO training_runs (agent, type, pairs_added, success) VALUES (?, 'train', 0, 1)`).run(agentId); } catch {}
        } else {
          broadcast(reply, agentId, 'training_log', { message: `${agentId.toUpperCase()}: ✗ Pipeline mislukt (code ${code}).`, agent: agentId });
          try { db.prepare(`INSERT INTO training_runs (agent, type, pairs_added, success) VALUES (?, 'train', 0, 0)`).run(agentId); } catch {}
        }
        notifyStatsChanged();
        broadcast(reply, agentId, 'training_done', { success: ok, agent: agentId });
        resolve();
      });

      proc.on('error', () => {
        trainProcs.delete(agentId);
        broadcast(reply, agentId, 'training_log', { message: `${agentId.toUpperCase()}: ✗ Python niet gevonden op pad: ${PYTHON_EXE}`, agent: agentId });
        broadcast(reply, agentId, 'training_done', { success: false, agent: agentId });
        resolve();
      });
    });

    activeTraining.delete(agentId);
    // Keep buffer for 60s after completion so late reconnects still see the result
    setTimeout(() => logBuffers.delete(agentId), 60_000);
    reply.raw.end();
  });

  // ── Reconnect stream: GET /api/training/lora/:agentId/stream ─────────────
  // Replays buffered history + streams live events. Used when client reconnects
  // after a page refresh while training is already in progress.
  fastify.get<{ Params: { agentId: string } }>('/api/training/lora/:agentId/stream', async (request, reply) => {
    const { agentId } = request.params;

    // Hydrate from disk if buffer was lost (e.g. tsx watch restart)
    if (!logBuffers.has(agentId)) {
      const fp = sessionFile(agentId);
      if (fs.existsSync(fp)) {
        const ageMs = Date.now() - fs.statSync(fp).mtimeMs;
        if (ageMs < 4 * 60 * 60 * 1000) {
          const lines = fs.readFileSync(fp, 'utf8').split('\n').filter(Boolean);
          const events = lines
            .map(l => { try { return JSON.parse(l) as { type: string; data: object }; } catch { return null; } })
            .filter((e): e is { type: string; data: object } => e !== null);
          if (events.length > 0) logBuffers.set(agentId, events);
        }
      }
    }

    if (!activeTraining.has(agentId) && !logBuffers.has(agentId)) {
      reply.code(404).send({ error: 'No active or recent training for this agent' });
      return;
    }

    sseHeaders(reply);

    // Replay everything buffered so far
    const buf = logBuffers.get(agentId) ?? [];
    for (const ev of buf) {
      emit(reply, ev.type, ev.data);
    }

    // If training already ended (buffer exists but not active), just close
    if (!activeTraining.has(agentId)) {
      reply.raw.end();
      return;
    }

    // Stream live events until training ends or client disconnects
    await new Promise<void>((resolve) => {
      const listener = (ev: { type: string; data: object }) => {
        emit(reply, ev.type, ev.data);
        if (ev.type === 'training_done') resolve();
      };
      trainingBus.on(`agent:${agentId}`, listener);
      request.raw.on('close', () => {
        trainingBus.off(`agent:${agentId}`, listener);
        resolve();
      });
    });

    reply.raw.end();
  });

  // ── Force-kill: POST /api/training/lora/:agentId/stop ────────────────────
  fastify.post<{ Params: { agentId: string } }>('/api/training/lora/:agentId/stop', async (request, reply) => {
    const { agentId } = request.params;
    const wasActive = activeTraining.has(agentId);
    forceKill(agentId);
    activeTraining.delete(agentId);
    const buf = logBuffers.get(agentId);
    if (buf) buf.push({ type: 'training_done', data: { success: false, agent: agentId, stopped: true } });
    trainingBus.emit(`agent:${agentId}`, { type: 'training_done', data: { success: false, agent: agentId, stopped: true } });
    return reply.send({ ok: true, wasActive });
  });

  // ── Modelfile training: POST /api/training/agent/:agentId ────────────────
  // Only for APEX1, APEX2, NEXUS_UI — JSON-routing agents that must not break
  fastify.post<{ Params: { agentId: string } }>('/api/training/agent/:agentId', async (request, reply) => {
    const { agentId } = request.params;
    const ollamaName = MODELFILE_OLLAMA[agentId];

    if (!AGENT_MODELFILE[agentId] || !ollamaName) {
      reply.code(400).send({ error: `Unknown Modelfile agent: ${agentId}` });
      return;
    }

    sseHeaders(reply);

    if (activeTraining.has(agentId)) {
      emit(reply, 'training_log', { message: `${agentId.toUpperCase()}: Training al bezig...`, agent: agentId });
      emit(reply, 'training_done', { success: false, agent: agentId });
      reply.raw.end();
      return;
    }

    activeTraining.add(agentId);
    emit(reply, 'training_log', { message: `${agentId.toUpperCase()}: JSONL dataset laden...`, agent: agentId });

    let modelfilePath: string;
    try {
      const { builtPath, exampleCount } = buildModelfile(agentId);
      modelfilePath = builtPath;
      emit(reply, 'training_log', { message: `${agentId.toUpperCase()}: ${exampleCount} voorbeelden geladen — Modelfile gebouwd.`, agent: agentId });
    } catch (err) {
      emit(reply, 'training_log', { message: `${agentId.toUpperCase()}: ✗ ${(err as Error).message}`, agent: agentId });
      emit(reply, 'training_done', { success: false, agent: agentId });
      activeTraining.delete(agentId);
      reply.raw.end();
      return;
    }

    // Camelllo gebruikt GGUF bestanden — geen Modelfile/ollama create nodig.
    // Dataset is opgeslagen; gebruik QLoRA pipeline voor model updates.
    emit(reply, 'training_log', {
      message: `${agentId.toUpperCase()}: ✓ Dataset opgeslagen als ${modelfilePath}`,
      agent: agentId,
    });
    emit(reply, 'training_log', {
      message: `${agentId.toUpperCase()}: Camelllo gebruikt GGUF — hertraining via QLoRA pipeline.`,
      agent: agentId,
    });
    try { db.prepare(`INSERT INTO training_runs (agent, type, pairs_added, success) VALUES (?, 'train', 0, 1)`).run(agentId); } catch {}
    notifyStatsChanged();
    emit(reply, 'training_done', { success: true, agent: agentId });

    activeTraining.delete(agentId);
    reply.raw.end();
  });

  // ── Data collection ───────────────────────────────────────────────────────
  fastify.post<{ Params: { agentId: string } }>('/api/training/collect/:agentId', async (request, reply) => {
    const { agentId } = request.params;

    sseHeaders(reply);

    if (activeTraining.has(`collect:${agentId}`)) {
      emit(reply, 'training_log', { message: `${agentId.toUpperCase()}: Collectie al bezig op server...`, agent: agentId });
      emit(reply, 'training_done', { success: false, agent: agentId });
      reply.raw.end();
      return;
    }

    activeTraining.add(`collect:${agentId}`);
    emit(reply, 'training_log', { message: `${agentId.toUpperCase()}: Data collectie gestart...`, agent: agentId });

    let runningTotal = 0;
    const sourceStats: Record<string, { done: number; pairs: number; errors: number }> = {};

    const total = await collectDataForAgent(agentId, (progress) => {
      // Track per-source stats
      if (!sourceStats[progress.source]) sourceStats[progress.source] = { done: 0, pairs: 0, errors: 0 };
      if (progress.status === 'saved') {
        sourceStats[progress.source].done++;
        sourceStats[progress.source].pairs += progress.pairsGenerated ?? 0;
        runningTotal += progress.pairsGenerated ?? 0;
      }
      if (progress.status === 'error') sourceStats[progress.source].errors++;

      // Emit structured collect_progress event (for the live visual panel)
      emit(reply, 'collect_progress', {
        agent:   agentId,
        source:  progress.source,
        topic:   progress.topic.replace(/_/g, ' '),
        status:  progress.status,
        pairs:   progress.pairsGenerated ?? 0,
        error:   progress.error,
        total:   runningTotal,
        sources: sourceStats,
      });

      // Also emit a plain log line
      const icon = progress.status === 'saved'    ? '✓'
                 : progress.status === 'error'    ? '✗'
                 : progress.status === 'skipped'  ? '–'
                 : progress.status === 'fetching' ? '↓'
                 : '⟳';
      const detail = progress.status === 'saved'
        ? `+${progress.pairsGenerated} paren`
        : progress.status === 'error' ? (progress.error ?? 'fout') : progress.status;
      emit(reply, 'training_log', {
        message: `${agentId.toUpperCase()}: ${icon} [${progress.source}] ${progress.topic.replace(/_/g, ' ').slice(0, 40)} — ${detail}`,
        agent: agentId,
      });
    });

    activeTraining.delete(`collect:${agentId}`);
    emit(reply, 'training_log', { message: `${agentId.toUpperCase()}: ✓ ${total} nieuwe paren toegevoegd.`, agent: agentId });
    emit(reply, 'collect_progress', { agent: agentId, status: 'done', total, sources: sourceStats });
    try { db.prepare(`INSERT INTO training_runs (agent, type, pairs_added, success) VALUES (?, 'collect', ?, 1)`).run(agentId, total); } catch {}
    notifyStatsChanged();
    emit(reply, 'training_done', { success: true, agent: agentId, pairsAdded: total });
    reply.raw.end();
  });

  // ── Plugins ───────────────────────────────────────────────────────────────
  fastify.get('/api/training/plugins', async (_req, reply) => {
    return reply.send({ plugins: getPlugins() });
  });

  fastify.patch<{ Params: { id: string }; Body: { enabled: boolean } }>('/api/training/plugins/:id', async (request, reply) => {
    setPluginEnabled(request.params.id, request.body.enabled);
    return reply.send({ plugins: getPlugins() });
  });

  fastify.get('/api/training/active', async (_req, reply) => {
    const lora      = [...activeTraining].filter(k => !k.startsWith('collect:'));
    const collecting = [...activeTraining].filter(k => k.startsWith('collect:')).map(k => k.replace('collect:', ''));
    return reply.send({ active: lora, collecting });
  });

  fastify.get('/api/training/datasets', async (_req, reply) => {
    const { getDatasetInfo } = await import('../services/modelfile-builder.js');
    return reply.send({ datasets: getDatasetInfo() });  // modelfile-builder keeps dynamic (large dep)
  });
}