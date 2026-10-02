import { readFileSync, writeFileSync, existsSync, mkdirSync, readdirSync } from 'node:fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const MODELFILES_DIR = path.resolve(__dirname, '..', '..', '..', 'ollama', 'modelfiles');
const DATA_DIR       = path.resolve(__dirname, '..', '..', '..', '..', 'data', 'agents');
const BUILT_DIR      = path.resolve(__dirname, '..', '..', '..', 'ollama', 'built');

const AGENT_MODELFILE: Record<string, string> = {
  apex1:    'APEX1.Modelfile',
  apex2:    'APEX2.Modelfile',
  forge:    'FORGE.Modelfile',
  spark:    'SPARK.Modelfile',
  atlas:    'ATLAS.Modelfile',
  tactix:   'TACTIX.Modelfile',
  vega:     'VEGA.Modelfile',
  nexus_ui: 'NEXUS_UI.Modelfile',
  optic:    'OPTIC.Modelfile',
  jarvis:   'JARVIS.Modelfile',
};

interface DatasetEntry {
  prompt: string;
  response: string;
  note?: string;
}

function readJsonlDir(dirPath: string): DatasetEntry[] {
  if (!existsSync(dirPath)) return [];
  const files = readdirSync(dirPath).filter(f => f.endsWith('.jsonl')).sort();
  const entries: DatasetEntry[] = [];
  for (const file of files) {
    const lines = readFileSync(path.join(dirPath, file), 'utf-8')
      .split('\n').map(l => l.trim()).filter(Boolean);
    for (const line of lines) {
      try {
        const entry = JSON.parse(line);
        if (entry.prompt && entry.response) entries.push(entry);
      } catch { /* skip malformed */ }
    }
  }
  return entries;
}

// Reads ALL .jsonl files from data/agents/<agentId>/ + data/agents/ALL_AGENTS/
function loadJsonl(agentId: string): DatasetEntry[] {
  const agentEntries    = readJsonlDir(path.join(DATA_DIR, agentId));
  const sharedEntries   = readJsonlDir(path.join(DATA_DIR, 'ALL_AGENTS'));
  return [...agentEntries, ...sharedEntries];
}

// Returns how many JSONL pairs exist for every agent folder found in DATA_DIR
export function getDatasetInfo(): Record<string, { files: string[]; count: number }> {
  const info: Record<string, { files: string[]; count: number }> = {};

  if (!existsSync(DATA_DIR)) return info;

  // Scan ALL subfolders automatically — new agents are picked up without code changes
  for (const entry of readdirSync(DATA_DIR, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const agentId = entry.name;
    const agentDir = path.join(DATA_DIR, agentId);
    const files = readdirSync(agentDir).filter(f => f.endsWith('.jsonl')).sort();
    let count = 0;
    for (const file of files) {
      try {
        const lines = readFileSync(path.join(agentDir, file), 'utf-8')
          .split('\n').filter(l => l.trim());
        count += lines.length;
      } catch { /* skip unreadable file */ }
    }
    info[agentId] = { files, count };
  }

  return info;
}

function formatExamples(agentId: string, entries: DatasetEntry[]): string {
  if (entries.length === 0) return '';

  const name = agentId.replace('_', '-').toUpperCase();
  const lines = entries.map(e =>
    `User: "${e.prompt.replace(/"/g, "'").slice(0, 300)}"\n${name}: ${e.response.replace(/"""/g, "'''").slice(0, 800)}`
  );

  return `--- TRAINING VOORBEELDEN (${entries.length}) ---\n\n${lines.join('\n\n')}`;
}

/**
 * Builds a Modelfile for the given agent by injecting JSONL examples
 * into the {{EXAMPLES}} placeholder. Returns the path to the built file.
 */
export function buildModelfile(agentId: string): { builtPath: string; exampleCount: number } {
  const modelfileName = AGENT_MODELFILE[agentId];
  if (!modelfileName) throw new Error(`Unknown agent: ${agentId}`);

  const templatePath = path.join(MODELFILES_DIR, modelfileName);
  if (!existsSync(templatePath)) throw new Error(`Template not found: ${templatePath}`);

  const template = readFileSync(templatePath, 'utf-8');
  const entries  = loadJsonl(agentId);
  const examples = formatExamples(agentId, entries);

  const built = template.replace('{{EXAMPLES}}', examples);

  // Write to built/ directory so templates stay clean
  if (!existsSync(BUILT_DIR)) mkdirSync(BUILT_DIR, { recursive: true });
  const builtPath = path.join(BUILT_DIR, modelfileName);
  writeFileSync(builtPath, built, 'utf-8');

  return { builtPath, exampleCount: entries.length };
}

export { AGENT_MODELFILE, DATA_DIR };
