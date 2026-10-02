import fs from 'fs';
import path from 'path';

// ╔══════════════════════════════════════════════════════════════════════════╗
// ║  NEXUS SYSTEM CONFIG — nexus/server/src/services/config.ts             ║
// ║                                                                          ║
// ║  Instellingen worden geladen in deze volgorde (later = hogere prioriteit)║
// ║  1. DEFAULTS hieronder in de code (altijd aanwezig als fallback)         ║
// ║  2. nexus/server/data/system-config.json  ← DIT BESTAND KAN JE EDITEN  ║
// ║  3. Environment variables (overschrijven alles)                          ║
// ║                                                                          ║
// ║  AANPASSEN via de UI:  http://localhost:5173  →  System tab             ║
// ║  AANPASSEN via bestand: nexus/server/data/system-config.json            ║
// ║  AANPASSEN via API:    POST http://localhost:3001/config                 ║
// ║                                                                          ║
// ║  Agent gedrag (prompts, temperature, brevity) →                         ║
// ║    nexus/server/src/agents/profiles.ts                                   ║
// ║                                                                          ║
// ║  Camelllo inference (context grootte, threads, GPU) →                   ║
// ║    Desktop\Camelllo\src\config.hpp  (vereist rebuild na wijziging)      ║
// ╚══════════════════════════════════════════════════════════════════════════╝

const CONFIG_FILE = path.resolve(process.cwd(), 'data', 'system-config.json');

export interface SystemConfig {
  // Server
  port: number;
  host: string;

  // Camelllo (llama.cpp server op port 11500)
  ollamaUrl: string;           // Camelllo API base URL

  // Agents
  maxConversationHistory: number;  // how many past turns to inject into prompts
  defaultLanguage: string;

  // Features
  voiceEnabled: boolean;
  locationEnabled: boolean;
  autoTrainOnFeedback: boolean;
  requireActionConfirmation: boolean;  // show TOESTAAN/WEIGEREN before opening an app / executing a system action
  requireSendConfirmation: boolean;    // show a 2nd TOESTAAN/WEIGEREN before sending a typed in-app message

  // Projects
  projectsDir: string;         // where "start project" files are stored

  // FORGE context
  githubToken: string;         // optional GitHub personal access token for FORGE GitHub search
}

// ── DEFAULTS — wijzig hier de basiswaarden ────────────────────────────────────
// Of nog beter: edit nexus/server/data/system-config.json zodat je defaults
// intact blijven en je altijd kunt resetten.
const DEFAULTS: SystemConfig = {
  port: 3001,                           // NEXUS server poort
  host: '0.0.0.0',                      // bind adres (0.0.0.0 = alle interfaces)
  ollamaUrl: 'http://localhost:11500',  // Camelllo adres (NIET wijzigen tenzij je Camelllo verplaatst)
  maxConversationHistory: 6,            // hoeveel vorige berichten meegestuurd worden naar het model
  defaultLanguage: 'nl',               // taal van de system prompts
  voiceEnabled: true,                   // text-to-speech aan/uit
  locationEnabled: false,              // GPS locatie context aan/uit
  autoTrainOnFeedback: true,           // automatisch trainen op thumbs up/down
  requireActionConfirmation: true,     // TOESTAAN/WEIGEREN popup bij PC acties
  requireSendConfirmation: true,       // bevestiging vragen voor bericht sturen via app
  projectsDir: path.resolve(process.cwd(), 'projects'),  // map voor 'start project'
  githubToken: '',                      // GitHub PAT voor FORGE GitHub search (optioneel)
};

function ensureDir() {
  const dir = path.dirname(CONFIG_FILE);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}

function loadFileConfig(): Partial<SystemConfig> {
  ensureDir();
  if (!fs.existsSync(CONFIG_FILE)) return {};
  try { return JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf-8')); }
  catch { return {}; }
}

function applyEnvOverrides(cfg: SystemConfig): SystemConfig {
  if (process.env.PORT)            cfg.port            = parseInt(process.env.PORT);
  if (process.env.HOST)            cfg.host            = process.env.HOST;
  if (process.env.OLLAMA_URL)      cfg.ollamaUrl       = process.env.OLLAMA_URL;
  if (process.env.CAMELLLO_URL)    cfg.ollamaUrl       = process.env.CAMELLLO_URL;
  if (process.env.PROJECTS_DIR)    cfg.projectsDir     = process.env.PROJECTS_DIR;
  if (process.env.VOICE_ENABLED)   cfg.voiceEnabled    = process.env.VOICE_ENABLED !== 'false';
  if (process.env.LANG)            cfg.defaultLanguage = process.env.LANG.slice(0, 2);
  if (process.env.GITHUB_TOKEN)    cfg.githubToken     = process.env.GITHUB_TOKEN;
  return cfg;
}

// Singleton config — loaded once at startup
let _config: SystemConfig | null = null;

export function getConfig(): SystemConfig {
  if (_config) return _config;
  const file = loadFileConfig();
  _config = applyEnvOverrides({ ...DEFAULTS, ...file });
  return _config;
}

export function updateConfig(patch: Partial<SystemConfig>): SystemConfig {
  const current = getConfig();
  _config = { ...current, ...patch };
  ensureDir();
  fs.writeFileSync(CONFIG_FILE, JSON.stringify(_config, null, 2), 'utf-8');
  return _config;
}

export function resetConfig(): SystemConfig {
  _config = { ...DEFAULTS };
  ensureDir();
  fs.writeFileSync(CONFIG_FILE, JSON.stringify(_config, null, 2), 'utf-8');
  return _config;
}
