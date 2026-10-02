import { db } from './database.js';

type StreamFn = (data: object) => void;

function log(onStream: StreamFn, msg: string) {
  onStream({ type: 'project_log', data: { agent: 'forge', message: msg } });
}

function getFeedbackExamples(): { prompt: string; response: string }[] {
  try {
    return db.prepare(`
      SELECT prompt, response FROM feedback
      WHERE agent = 'forge' AND rating = 1 AND prompt != '' AND response != ''
      ORDER BY timestamp DESC LIMIT 8
    `).all() as { prompt: string; response: string }[];
  } catch {
    return [];
  }
}

// Sla FORGE feedback op in DB voor gebruik bij volgende QLoRA training.
// Camelllo gebruikt GGUF — geen Modelfile/Ollama CLI nodig.
// Hertrainen via ForgeLabPage → ▶ TRAIN → pipeline.py → export.py → forge.gguf → Camelllo.
export async function trainForge(onStream: StreamFn) {
  log(onStream, 'FORGE feedback verwerken...');

  const examples = getFeedbackExamples();
  log(onStream, `${examples.length} goedgekeurde reacties gevonden.`);

  if (examples.length === 0) {
    log(onStream, 'Geen feedback. Beoordeel FORGE reacties met ▲ CORRECT eerst.');
    onStream({ type: 'project_done', data: { projectName: 'forge-train', projectDir: '' } });
    return;
  }

  for (let i = 0; i < examples.length; i++) {
    log(onStream, `  [${i + 1}] "${examples[i].prompt.slice(0, 60)}..."`);
    await new Promise(r => setTimeout(r, 80));
  }

  try {
    db.prepare(`UPDATE feedback SET used_in_training = 1 WHERE agent = 'forge' AND rating = 1`).run();
    log(onStream, `✓ ${examples.length} feedback voorbeelden opgeslagen als trainingsdata.`);
  } catch {}

  log(onStream, 'Feedback opgeslagen. Start QLoRA training via ForgeLabPage → ▶ TRAIN om FORGE te verbeteren.');
  onStream({ type: 'project_done', data: { projectName: 'forge-train', projectDir: '' } });
}
