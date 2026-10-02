import { db } from './database.js';
import { AGENT_MODELFILE } from './modelfile-builder.js';

// Sla feedback op in de DB na positieve beoordeling.
// Camelllo gebruikt GGUF bestanden — geen Ollama CLI nodig.
// Model refresh via QLoRA pipeline (ForgeLabPage → TRAIN).
export function trainAgentBackground(agentId: string): void {
  if (!AGENT_MODELFILE[agentId]) return;

  try {
    db.prepare(`
      UPDATE feedback SET used_in_training = 1
      WHERE agent = ? AND rating = 1 AND used_in_training = 0
    `).run(agentId);
    console.log(`[${agentId.toUpperCase()}] feedback opgeslagen — hertraining via QLoRA pipeline.`);
  } catch {}
}
