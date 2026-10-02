import axios from 'axios';
import { getConfig, updateConfig } from './config.js';

const url = () => getConfig().ollamaUrl;

// Known inference backend ports across NEXUS deployments — Camelllo's default
// (11500) and stock Ollama's default (11434). Probed in this order so the
// same project bundle self-configures when it lands on a machine/drive where
// the previously-configured backend isn't the one actually running.
const CANDIDATE_INFERENCE_URLS = ['http://localhost:11500', 'http://localhost:11434'];

async function isReachable(base: string): Promise<boolean> {
  try {
    await axios.get(`${base}/api/tags`, { timeout: 2000 });
    return true;
  } catch {
    return false;
  }
}

// Called once at server startup. If the configured backend isn't reachable,
// probes the known candidate ports and switches (persisting the change) to
// whichever one responds, so the app "just works" after being copied to a
// new machine or drive instead of failing silently on a stale URL.
export async function detectAndFixInferenceUrl(): Promise<void> {
  const configured = url();
  if (await isReachable(configured)) {
    console.log(`   Inference backend: ${configured} (reachable)`);
    return;
  }

  for (const candidate of CANDIDATE_INFERENCE_URLS) {
    if (candidate === configured) continue;
    if (await isReachable(candidate)) {
      console.warn(`⚠️  Inference backend op ${configured} niet bereikbaar — automatisch overgeschakeld naar ${candidate}`);
      updateConfig({ ollamaUrl: candidate });
      return;
    }
  }

  console.warn(`⚠️  Geen inference backend bereikbaar (probeerde ${[configured, ...CANDIDATE_INFERENCE_URLS].join(', ')}) — start Camelllo of "ollama serve"`);
}

// Agent ID → BMX model name
const MODEL_NAME_MAP: Record<string, string> = {
  apex1:    'phi3.5',
  apex2:    'phi3.5',
  spark:    'phi3.5',
  atlas:    'phi3.5',
  tactix:   'phi3.5',
  vega:     'phi3.5',
  nexus_ui: 'phi3.5',  // backward compat alias for optic
  optic:    'phi3.5',
  jarvis:   'phi3.5',
  forge:    'deepseek-coder',
};
const resolveModel = (id: string) => MODEL_NAME_MAP[id] ?? id;

export async function queryAgent(modelId: string, prompt: string, temperature = 0.7, format?: 'json'): Promise<string> {
  const response = await axios.post(`${url()}/api/generate`, {
    model: resolveModel(modelId),
    prompt,
    stream: false,
    ...(format ? { format } : {}),
    options: { temperature, num_predict: 512 },
  }, { timeout: 120_000 });

  return response.data.response as string;
}

export async function streamAgent(
  modelId: string,
  prompt: string,
  temperature = 0.7,
  onToken: (token: string) => void
): Promise<void> {
  let response;
  try {
    response = await axios.post(`${url()}/api/generate`, {
      model: resolveModel(modelId),
      prompt,
      stream: true,
      options: { temperature, num_predict: 512 },
    }, {
      responseType: 'stream',
      timeout: 120_000,
    });
  } catch (err: any) {
    const code = err?.response?.status;
    if (code === 404) throw new Error(`Camelllo: model kon niet laden — start camelllo.exe opnieuw`);
    if (err?.code === 'ECONNREFUSED') throw new Error(`Camelllo niet bereikbaar op ${url()} — start camelllo.exe`);
    throw err;
  }

  return new Promise((resolve, reject) => {
    let buffer = '';
    response.data.on('data', (chunk: Buffer) => {
      buffer += chunk.toString();
      const lines = buffer.split('\n');
      buffer = lines.pop() ?? '';
      for (const line of lines) {
        if (!line.trim()) continue;
        try {
          const parsed = JSON.parse(line);
          if (parsed.response) onToken(parsed.response);
          if (parsed.done) resolve();
        } catch { /* skip */ }
      }
    });
    response.data.on('end', () => resolve());
    response.data.on('error', reject);
  });
}

export async function listModels(): Promise<string[]> {
  try {
    const res = await axios.get(`${url()}/api/tags`, { timeout: 5000 });
    return (res.data.models ?? []).map((m: { name: string }) => m.name);
  } catch {
    return [];
  }
}

export async function pingOllama(): Promise<number> {
  const t0 = Date.now();
  try {
    await axios.get(`${url()}/api/tags`, { timeout: 3000 });
    return Date.now() - t0;
  } catch {
    return -1;
  }
}
