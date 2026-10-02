import os from 'os';
import path from 'path';
import { queryAgent, streamAgent } from './ollama.js';
import { generateSpeech } from './voice.js';
import { db } from './database.js';
import { AGENT_PROFILES } from '../agents/profiles.js';
import { buildProject } from './project-builder.js';
import { trainForge } from './forge-trainer.js';
import { runProject } from './project-runner.js';
import { geocode } from './maps.js';
import { getConfig } from './config.js';
import { notifyStatsChanged } from './stats-emitter.js';
import { buildForgeContext } from './forge-context.js';

// User-scoped shell folders — dynamic so the same bundle works under any
// Windows account, not just the machine it was originally built on.
const DESKTOP_DIR = path.join(os.homedir(), 'Desktop');
const DOWNLOADS_DIR = path.join(os.homedir(), 'Downloads');
const DOCUMENTS_DIR = path.join(os.homedir(), 'Documents');

// ── System-action intent detector ────────────────────────────────────────────
interface ActionMatch { action: string; param: string }

function detectSystemAction(prompt: string): ActionMatch | null {
  const p = prompt.toLowerCase();

  // Screenshot
  if (/\b(screenshot|schermafbeelding|schermafdruk|maak.*scherm|neem.*screenshot)\b/.test(p))
    return { action: 'take_screenshot', param: '' };

  // Open URLs
  const urlMatch = prompt.match(/https?:\/\/[^\s]+/);
  if (urlMatch) return { action: 'open_url', param: urlMatch[0] };
  if (/\b(open|ga naar|bezoek|surf)\b.*\b(google\.com|google)\b/i.test(prompt)) return { action: 'open_url', param: 'https://google.com' };
  if (/\b(open|ga naar|bezoek|surf)\b.*\b(youtube\.com|youtube)\b/i.test(prompt)) return { action: 'open_url', param: 'https://youtube.com' };
  if (/\b(open|ga naar|bezoek|surf)\b.*\b(github\.com|github)\b/i.test(prompt)) return { action: 'open_url', param: 'https://github.com' };
  if (/\b(open|ga naar|bezoek|surf)\b.*\b(chatgpt|openai\.com)\b/i.test(prompt)) return { action: 'open_url', param: 'https://chatgpt.com' };

  // Open folders
  if (/\b(open|toon|laat zien)\b.*\b(bureaublad|desktop)\b/i.test(prompt)) return { action: 'open_folder', param: DESKTOP_DIR };
  if (/\b(open|toon)\b.*\b(downloads?)\b/i.test(prompt)) return { action: 'open_folder', param: DOWNLOADS_DIR };
  if (/\b(open|toon)\b.*\b(documenten|documents)\b/i.test(prompt)) return { action: 'open_folder', param: DOCUMENTS_DIR };
  if (/\b(open|toon)\b.*\b(verkenner|explorer|bestanden)\b/i.test(prompt)) return { action: 'open_folder', param: '' };

  // Open apps — extract the app name from prompt
  const appPatterns: [RegExp, string][] = [
    [/\b(notepad|kladblok)\b/i,            'notepad'],
    [/\b(chrome|google chrome)\b/i,         'chrome'],
    [/\b(firefox)\b/i,                      'firefox'],
    [/\b(edge|microsoft edge)\b/i,          'msedge'],
    [/\b(vscode|visual studio code|code)\b/i, 'code'],
    [/\b(calculator|rekenmachine|calc)\b/i, 'calc'],
    [/\b(paint|mspaint)\b/i,                'mspaint'],
    [/\b(spotify)\b/i,                      'spotify'],
    [/\b(discord)\b/i,                      'discord'],
    [/\b(word|microsoft word)\b/i,          'winword'],
    [/\b(excel|microsoft excel)\b/i,        'excel'],
    [/\b(teams|microsoft teams)\b/i,        'teams'],
    [/\b(powershell|terminal)\b/i,          'powershell'],
    [/\b(cmd|command prompt)\b/i,           'cmd'],
    [/\b(task manager|taakbeheer)\b/i,      'taskmgr'],
    [/\b(settings|instellingen)\b/i,        'ms-settings:'],
  ];

  if (/\b(open|start|launch|draai|zet aan|opstarten|zet op|doe open|maak open|run|execute)\b/i.test(p)) {
    for (const [pattern, appName] of appPatterns) {
      if (pattern.test(p)) return { action: 'open_app', param: appName };
    }
  }

  // Close app
  if (/\b(sluit|close|stop|kill|afsluiten|sluit af)\b/i.test(p)) {
    for (const [pattern, appName] of appPatterns) {
      if (pattern.test(p)) return { action: 'close_app', param: appName };
    }
  }

  return null;
}

// Session memory: last N turns per session
interface Turn { role: 'user' | 'assistant'; agent?: string; content: string }
const sessionMemory = new Map<string, Turn[]>();

function getHistory(sessionId: string): Turn[] {
  return sessionMemory.get(sessionId) ?? [];
}

function addTurn(sessionId: string, turn: Turn) {
  const history = sessionMemory.get(sessionId) ?? [];
  history.push(turn);
  const max = getConfig().maxConversationHistory * 2; // user+assistant pairs
  if (history.length > max) history.splice(0, history.length - max);
  sessionMemory.set(sessionId, history);
}

function buildHistoryContext(history: Turn[]): string {
  if (!history.length) return '';
  const lines = history.map(t =>
    t.role === 'user' ? `User: ${t.content}` : `${(t.agent ?? 'Assistant').toUpperCase()}: ${t.content}`
  );
  return '\n\nEerdere conversatie:\n' + lines.join('\n') + '\n';
}

interface RoutingDecision {
  agents: string[];
  reasoning: string;
  announcement: string;
}

// Extracts and validates a RoutingDecision from APEX-1's raw JSON output.
// Returns null on any parse/shape failure so the caller can fall back safely.
function parseRoutingJSON(raw: string): RoutingDecision | null {
  const match = raw.match(/\{[\s\S]*\}/);
  if (!match) return null;

  let obj: any;
  try {
    obj = JSON.parse(match[0]);
  } catch {
    return null;
  }

  if (!Array.isArray(obj.agents)) return null;
  const agents = obj.agents.filter((id: unknown) => typeof id === 'string' && AGENT_PROFILES[id]);
  if (agents.length === 0) return null;

  return {
    agents,
    reasoning: typeof obj.reasoning === 'string' && obj.reasoning ? obj.reasoning : 'APEX-1 routing decision',
    announcement: typeof obj.announcement === 'string' && obj.announcement
      ? obj.announcement
      : `${agents.map((a: string) => a.toUpperCase()).join(', ')} activated.`,
  };
}

// Primary routing path: APEX-1 reads the prompt (+ recent history) and returns
// a JSON routing decision. Falls back to keyword routing only if the model
// call fails or returns something unparsable — never lets routing hard-crash.
async function routeViaLLM(prompt: string, historyCtx: string): Promise<RoutingDecision> {
  const apex1 = AGENT_PROFILES['apex1'];
  const routingPrompt = `${apex1.systemPrompt}${historyCtx}\nUser: ${prompt}\n\nAssistant:`;

  try {
    const raw = await queryAgent('apex1', routingPrompt, apex1.temperature);
    const parsed = parseRoutingJSON(raw);
    if (parsed) return parsed;
    console.warn('[routing] APEX-1 returned unparsable JSON, falling back to keyword routing:', raw.slice(0, 200));
  } catch (err) {
    console.warn('[routing] APEX-1 routing call failed, falling back to keyword routing:', (err as Error).message);
  }

  return fallbackRoute(prompt);
}

// Keyword routing — safety net only, used when APEX-1 routing fails
function fallbackRoute(prompt: string): RoutingDecision {
  const p = prompt.toLowerCase();

  // Multi-agent: combined patterns first (before single-agent checks)
  if (/brainstorm.*plan|plan.*brainstorm|idea.*roadmap|roadmap.*idea|creat.*strateg|strateg.*creat/.test(p))
    return { agents: ['spark', 'tactix'], reasoning: 'Combined ideation + planning', announcement: 'SPARK and TACTIX activated.' };

  if (/system\s*diagn|system\s*info|system\s*status|hoe.*systeem|system.*check|cpu|ram|disk\s*usage|geheugen|processor|hardware\s*info|pc\s*status|computer\s*status/.test(p))
    return { agents: ['forge'], reasoning: 'System diagnostics → FORGE runs get_system_info', announcement: 'FORGE running system diagnostics.' };

  if (/debug|fix(?:en)?|error|bug|typescript|javascript|python|code|function|class|import|npm|node|react|component|crash|exception|undefined|null|\bc\b|c\+\+|c script|cscript|script|program|compil|gcc|clang|makefile|printf|scanf|void|int main|#include|\.c\b|\.cpp\b|\.h\b|assembly|asm|bash|powershell|shell|schrijf.*code|maak.*code|bouw.*app|bouw.*programma/.test(p))
    return { agents: ['forge'], reasoning: 'Code/script/compile keywords', announcement: 'FORGE engaged.' };

  if (/idea|brainstorm|creat|invent|innovat|concept|startup|feature|what if|imagine/.test(p))
    return { agents: ['spark'], reasoning: 'Ideation keywords', announcement: 'SPARK activated.' };

  if (/plan|roadmap|strateg|step|phase|timeline|sprint|milestone|goal|schedul/.test(p))
    return { agents: ['tactix'], reasoning: 'Planning keywords', announcement: 'TACTIX activated.' };

  if (/explain|what is|how does|research|learn|defin|histor|why does|tell me about/.test(p))
    return { agents: ['atlas'], reasoning: 'Knowledge keywords', announcement: 'ATLAS engaged.' };

  // Complex project tasks → JARVIS (+ FORGE for code)
  if (/website.*(?:make|build|create|bouw|maak|voor)|(?:make|build|create|bouw|maak).*website|webshop|online.*store|etsy|dropship|landing.*page|business.*site|site.*voor|e-commerce|ecommerce|shopify|woocommerce/.test(p))
    return { agents: ['jarvis', 'forge'], reasoning: 'Complex project → JARVIS plans + FORGE codes', announcement: 'JARVIS and FORGE on it.' };

  // Data analysis → OPTIC
  if (/data.*anal|analys.*data|dataset|statistics|statistiek|machine.?learning|model.*eval|hugging.?face|pandas|numpy|matplotlib|accuracy|f1.?score|confusion.*matrix|training.*loss|neural.*network|regression|classificat|visuali[sz]/.test(p))
    return { agents: ['optic'], reasoning: 'Data analysis / ML keywords', announcement: 'OPTIC engaged.' };

  if (/nexus|agent|how do i use|help me understand|which agent|optic/.test(p))
    return { agents: ['optic'], reasoning: 'System help or data keywords', announcement: 'OPTIC online.' };

  return { agents: ['vega'], reasoning: 'General request — Vice-General VEGA', announcement: 'VEGA online.' };
}

export interface UserLocation { lat: number; lon: number; city?: string; country?: string }

export async function processCommand(
  userPrompt: string,
  onStream: (data: object) => void,
  userLocation?: UserLocation,
  sessionId = 'default',
  forceAgent?: string,
  systemContext?: string
) {
  // Forced agent — bypass all routing, go straight to that agent
  if (forceAgent && AGENT_PROFILES[forceAgent]) {
    const profile  = AGENT_PROFILES[forceAgent];
    const history  = getHistory(sessionId);
    const histCtx  = buildHistoryContext(history);
    const sysCtx   = systemContext ? `\n\n[LIVE SYSTEM INFO]\n${systemContext}` : '';

    // JARVIS mode: override apex1 JSON-routing prompt with conversational JARVIS prompt
    const isJarvis = sessionId === 'jarvis';
    // Detect if user wants a detailed/extended answer
    const detailKeywords = /uitgebr|gedetail|professioneel|in detail|step by step|volledig|alles over|diep|grondig|explain fully|elaborate|thoroughly|comprehensive|dieper op in|stap voor stap|extended/i;
    const wantsDetail = detailKeywords.test(userPrompt);

    const jarvisPrompt = `You are JARVIS, personal AI assistant to Sir Ege. Answer the user's question directly and naturally. Speak in plain English — no JSON, no curly braces, no code blocks unless specifically asked. Do NOT mention training, feedback, datasets, agents, system status, or anything about how you work. Do NOT add meta-commentary like "I have learned" or "based on my training". Address the user as "Sir" occasionally. You have access to live system info including the current date and time — use it when asked about time, date, or day of the week.

SYSTEM CONTROL: If the user asks you to open an app, open a website, open a folder, take a screenshot, or close an app — append ONE action token at the very end of your response (after your spoken answer). Use this exact format:
[NEXUS_ACTION:open_app:notepad] — open an application (notepad, chrome, msedge, code, calc, spotify, discord, etc.)
[NEXUS_ACTION:open_url:https://google.com] — open a website
[NEXUS_ACTION:open_folder:${DESKTOP_DIR}] — open a folder (desktop, downloads, documents)
[NEXUS_ACTION:take_screenshot:] — take a screenshot
[NEXUS_ACTION:close_app:notepad] — close an application
Example: User says "open notepad" → respond "Opening Notepad for you, Sir." then append [NEXUS_ACTION:open_app:notepad]
Only append ONE token per response. Never say the token out loud — it is stripped before speech.

${wantsDetail
  ? 'The user wants a DETAILED, thorough answer. Explain fully, cover all important points, use clear structure. Be comprehensive.'
  : 'Keep your answer SHORT and spoken-word friendly — 1 to 3 sentences max. Do not over-explain. Get to the point immediately.'
}`;
    const systemPrompt = (isJarvis && forceAgent === 'apex1') ? jarvisPrompt : profile.systemPrompt;

    const modelId = forceAgent;

    const forgeCtx = forceAgent === 'forge'
      ? await buildForgeContext(userPrompt, getConfig().githubToken || undefined)
      : '';

    const fullPrompt = `${systemPrompt}${sysCtx}${forgeCtx}${histCtx}\nUser: ${userPrompt}\n\nAssistant:`;
    addTurn(sessionId, { role: 'user', content: userPrompt });
    onStream({ type: 'routing', data: { agents: [forceAgent], reasoning: `Forced: ${forceAgent}`, announcement: `${forceAgent.toUpperCase()} direct verbinding.` } });
    onStream({ type: 'direct_start', data: { agent: forceAgent } });
    let accumulated = '';
    try {
      await streamAgent(modelId, fullPrompt, profile.temperature, token => {
        accumulated += token;
        onStream({ type: 'token', data: { agent: forceAgent, token } });
      });
    } catch {
      // jarvis model not trained yet — fall back to apex1
      await streamAgent(forceAgent, fullPrompt, profile.temperature, token => {
        accumulated += token;
        onStream({ type: 'token', data: { agent: forceAgent, token } });
      });
    }
    if (!accumulated.includes('[NEXUS_ACTION:')) {
      const detected = detectSystemAction(userPrompt);
      if (detected) accumulated += `\n[NEXUS_ACTION:${detected.action}:${detected.param}]`;
    }

    onStream({ type: 'agent_response', data: { agent: forceAgent, response: accumulated } });
    addTurn(sessionId, { role: 'assistant', agent: forceAgent, content: accumulated.slice(0, 800) });
    onStream({ type: 'done', data: { success: true } });
    return;
  }

  try {
    // Special: "forge train" → FORGE trains itself alone
    if (/^forge train$/i.test(userPrompt.trim())) {
      onStream({ type: 'routing', data: { agents: ['forge'], reasoning: 'FORGE self-training mode', announcement: 'FORGE entering self-training. Learning from your feedback.' } });
      await trainForge(onStream);
      onStream({ type: 'done', data: { success: true } });
      return;
    }

    // Special: "start project <name>" → multi-agent project builder
    const projectMatch = userPrompt.match(/^start project\s+(.+)/i);
    if (projectMatch) {
      const name = projectMatch[1].trim();
      onStream({ type: 'routing', data: { agents: ['tactix', 'spark', 'atlas', 'forge'], reasoning: 'Project builder — all agents collaborate', announcement: `All agents assembling. Building project: ${name}.` } });
      await buildProject(name, onStream);
      onStream({ type: 'done', data: { success: true } });
      return;
    }

    // Special: "run project <name>" → pip install + python train.py
    const runMatch = userPrompt.match(/^run project\s+(.+)/i);
    if (runMatch) {
      const name = runMatch[1].trim();
      onStream({ type: 'routing', data: { agents: ['forge'], reasoning: 'Project runner — install + train', announcement: `FORGE activating project runner. Training: ${name}.` } });
      await runProject(name, 'train', onStream);
      onStream({ type: 'done', data: { success: true } });
      return;
    }

    // Special: "test project <name>" → pip install + python evaluate.py
    const testMatch = userPrompt.match(/^test project\s+(.+)/i);
    if (testMatch) {
      const name = testMatch[1].trim();
      onStream({ type: 'routing', data: { agents: ['forge'], reasoning: 'Project tester — install + evaluate', announcement: `FORGE activating evaluator. Testing: ${name}.` } });
      await runProject(name, 'test', onStream);
      onStream({ type: 'done', data: { success: true } });
      return;
    }

    // Special: location / maps question
    const mapsMatch = userPrompt.match(/(?:waar is|where is|waar ligt|locatie van|adres van|hoe kom ik naar|navigate to|maps?\s+(?:van|of)?)\s+(.+)/i);
    if (mapsMatch) {
      const query = mapsMatch[1].trim();
      onStream({ type: 'routing', data: { agents: ['atlas'], reasoning: 'Location query → OpenStreetMap', announcement: `ATLAS zoekt locatie: ${query}.` } });
      try {
        const geo = await geocode(query);
        if (geo.found && geo.result) {
          const r = geo.result;
          const addr = r.address;
          const parts = [addr.road, addr.city || addr.town || addr.village, addr.state, addr.country].filter(Boolean);
          onStream({ type: 'token', data: { agent: 'atlas', agentId: 'atlas', token: `📍 **${r.display_name}**\n\n` } });
          onStream({ type: 'token', data: { agent: 'atlas', agentId: 'atlas', token: `Adres: ${parts.join(', ')}\n` } });
          onStream({ type: 'token', data: { agent: 'atlas', agentId: 'atlas', token: `Coördinaten: ${parseFloat(r.lat).toFixed(5)}, ${parseFloat(r.lon).toFixed(5)}\n\n` } });
        } else {
          onStream({ type: 'token', data: { agent: 'atlas', agentId: 'atlas', token: `Locatie "${query}" niet gevonden op OpenStreetMap.` } });
        }
      } catch {
        onStream({ type: 'token', data: { agent: 'atlas', agentId: 'atlas', token: `Kaarten zijn momenteel niet beschikbaar.` } });
      }
      onStream({ type: 'done', data: { success: true } });
      return;
    }

    // Step 1: routing — "team nexus" makes the whole team answer; else keyword routing
    const teamTrigger = /^\s*(?:team\s*nexus|nexus\s*team|hey\s*team)\b[\s,.:!?-]*/i;
    const isTeam = teamTrigger.test(userPrompt);
    const promptForAgents = isTeam
      ? (userPrompt.replace(teamTrigger, '').trim() || 'Introduce yourself very briefly — one sentence about your specialty.')
      : userPrompt;

    // Team brevity prefix — injected into prompt so each agent stays focused + short
    const teamBrevityCtx = isTeam
      ? `\n[TEAM MODE: You are ONE of 6 agents all answering the same question. Keep your answer to MAX 2 sentences, focused only on YOUR specialty. Do not repeat what other agents cover. Be direct.]`
      : '';
    const history = getHistory(sessionId);
    const historyCtx = buildHistoryContext(history);

    const routing: RoutingDecision = isTeam
      ? {
          agents: ['forge', 'spark', 'atlas', 'tactix', 'vega', 'nexus_ui'].filter(id => AGENT_PROFILES[id]),
          reasoning: 'Team NEXUS — alle agents reageren samen',
          announcement: 'Volledig NEXUS team online. Alle agents reageren.',
        }
      : await routeViaLLM(promptForAgents, historyCtx);
    onStream({ type: 'routing', data: routing });

    // Step 2: Voice (best-effort, non-blocking)
    generateSpeech(routing.announcement).then(buf => {
      onStream({ type: 'voice', data: { announcement: routing.announcement, audioSize: buf.length } });
    }).catch(() => {});

    // Step 3: Query agents — stream tokens directly to client
    const agentIds = routing.agents.filter(id => AGENT_PROFILES[id]);

    // Build context additions
    const locationCtx = userLocation
      ? `\n[SYSTEEM: De gebruiker bevindt zich op: ${userLocation.city ? `${userLocation.city}, ` : ''}${userLocation.country ?? ''} (${userLocation.lat.toFixed(4)}, ${userLocation.lon.toFixed(4)})]`
      : '';

    // Save user turn
    addTurn(sessionId, { role: 'user', content: userPrompt });

    // Parallel execution — all agents run simultaneously, collect responses
    const collectedResponses = new Map<string, string>();

    await Promise.all(agentIds.map(async agentId => {
      const profile = AGENT_PROFILES[agentId];

      const forgeCtx = agentId === 'forge'
        ? await buildForgeContext(promptForAgents, getConfig().githubToken || undefined)
        : '';

      const fullPrompt = `${profile.systemPrompt}${teamBrevityCtx}${locationCtx}${forgeCtx}${historyCtx}\nUser: ${promptForAgents}\n\nAssistant:`;
      let accumulated = '';

      await streamAgent(agentId, fullPrompt, profile.temperature, (token) => {
        accumulated += token;
        onStream({ type: 'token', data: { agent: agentId, token } });
      });

      if (!isTeam && !accumulated.includes('[NEXUS_ACTION:')) {
        const detected = detectSystemAction(promptForAgents);
        if (detected) accumulated += `\n[NEXUS_ACTION:${detected.action}:${detected.param}]`;
      }

      onStream({ type: 'agent_response', data: { agent: agentId, response: accumulated } });
      collectedResponses.set(agentId, accumulated);
      addTurn(sessionId, { role: 'assistant', agent: agentId, content: accumulated.slice(0, 800) });

      try {
        db.prepare(`INSERT INTO command_log (prompt, routing, responses) VALUES (?, ?, ?)`).run(
          userPrompt, JSON.stringify(routing), JSON.stringify([{ agent: agentId, response: accumulated }])
        );
        notifyStatsChanged();
      } catch { /* non-blocking */ }
    }));

    // Synthesis step — when 2+ agents responded, APEX-2 synthesizes
    if (collectedResponses.size >= 2) {
      try {
        const responseLines = [...collectedResponses.entries()]
          .map(([id, text]) => `[${id.toUpperCase()}]: ${text.replace(/\[NEXUS_ACTION:[^\]]*\]/g, '').trim().slice(0, 400)}`)
          .join('\n\n');

        const synthPrompt = `You are NEXUS SYNTHESIZER. Combine these agent responses into ONE short, direct answer. Maximum 3 sentences. No "Agent X said..." — just the answer. Cut all repetition.

User asked: "${promptForAgents}"

Team responses:
${responseLines}

Synthesized answer (max 3 sentences, direct):`;

        onStream({ type: 'synthesis_start', data: {} });
        let synthText = '';
        await streamAgent('apex1', synthPrompt, 0.35, token => {
          synthText += token;
          onStream({ type: 'synthesis_token', data: { token } });
        });
        onStream({ type: 'synthesis_done', data: { text: synthText } });
        addTurn(sessionId, { role: 'assistant', agent: 'synthesis', content: synthText.slice(0, 800) });
      } catch { /* synthesis is optional — never block on it */ }
    }

    onStream({ type: 'done', data: { success: true } });
  } catch (err) {
    onStream({ type: 'error', data: { error: (err as Error).message } });
  }
}
