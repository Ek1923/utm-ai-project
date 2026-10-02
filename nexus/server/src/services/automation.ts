import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import {
  webFetch, rssFeed, htmlExtract,
  httpGet, httpPost, httpPut, httpPatch, httpDelete,
  sendWebhook, sendDiscord, sendSlack, sendTelegram, sendEmail,
  runCode, jsonExtract, filterCondition,
} from './tools.js';
import { streamAgent } from './ollama.js';
import { AGENT_PROFILES } from '../agents/profiles.js';

const __dirname   = path.dirname(fileURLToPath(import.meta.url));
const DATA_FILE   = path.resolve(__dirname, '..', '..', 'data', 'automations.json');

// ── Types ─────────────────────────────────────────────────────────────────────

export type TriggerType  = 'manual' | 'webhook';
export type StepType =
  | 'agent_prompt' | 'agent_summarize'
  | 'web_fetch' | 'rss_feed' | 'html_extract'
  | 'http_get' | 'http_post' | 'http_put' | 'http_patch' | 'http_delete'
  | 'send_webhook' | 'send_discord' | 'send_slack' | 'send_telegram' | 'send_email'
  | 'run_code' | 'json_extract' | 'transform_set' | 'filter'
  | 'nexus_api_call';

export interface WorkflowStep {
  id:     string;
  type:   StepType;
  label:  string;
  config: Record<string, string>;
}

export interface WorkflowRun {
  id:        string;
  startedAt: string;
  endedAt?:  string;
  status:    'running' | 'done' | 'error';
  output:    string;
  steps:     Array<{ step: string; result: string; ok: boolean }>;
}

export interface Workflow {
  id:          string;
  name:        string;
  agent:       string;
  description: string;
  trigger:     { type: TriggerType; webhookId?: string };
  steps:       WorkflowStep[];
  enabled:     boolean;
  createdAt:   string;
  lastRun?:    string;
  lastStatus?: 'done' | 'error';
}

// ── Storage ───────────────────────────────────────────────────────────────────

function load(): Workflow[] {
  try {
    if (!fs.existsSync(DATA_FILE)) return [];
    return JSON.parse(fs.readFileSync(DATA_FILE, 'utf-8'));
  } catch { return []; }
}

function save(workflows: Workflow[]) {
  fs.mkdirSync(path.dirname(DATA_FILE), { recursive: true });
  fs.writeFileSync(DATA_FILE, JSON.stringify(workflows, null, 2));
}

export function getWorkflows(): Workflow[] { return load(); }

export function getWorkflow(id: string): Workflow | undefined {
  return load().find(w => w.id === id);
}

export function createWorkflow(data: Omit<Workflow, 'id' | 'createdAt'>): Workflow {
  const workflows = load();
  const w: Workflow = {
    ...data,
    id: `wf_${Date.now()}`,
    createdAt: new Date().toISOString(),
  };
  workflows.push(w);
  save(workflows);
  return w;
}

export function updateWorkflow(id: string, patch: Partial<Workflow>): Workflow | null {
  const workflows = load();
  const idx = workflows.findIndex(w => w.id === id);
  if (idx < 0) return null;
  workflows[idx] = { ...workflows[idx], ...patch };
  save(workflows);
  return workflows[idx];
}

export function deleteWorkflow(id: string): boolean {
  const workflows = load();
  const next = workflows.filter(w => w.id !== id);
  if (next.length === workflows.length) return false;
  save(next);
  return true;
}

// ── Execution ─────────────────────────────────────────────────────────────────

// Runs a workflow and streams log lines via onLog callback
export async function runWorkflow(
  id: string,
  onLog: (line: string, ok?: boolean) => void
): Promise<{ ok: boolean; output: string }> {
  const workflows = load();
  const idx = workflows.findIndex(w => w.id === id);
  if (idx < 0) return { ok: false, output: 'Workflow niet gevonden' };

  const wf = workflows[idx];
  onLog(`▶ ${wf.name} gestart (agent: ${wf.agent.toUpperCase()})`);

  let context = '';  // accumulates results between steps
  let finalOutput = '';
  let allOk = true;

  for (const step of wf.steps) {
    onLog(`⟳ Stap: ${step.label}`);

    try {
      const cfg = step.config ?? {};
      const hdr = () => JSON.parse(cfg.headers || '{}') as Record<string, string>;
      const bdy = () => JSON.parse(cfg.body || cfg.payload || '{}');

      // ── Web ──────────────────────────────────────────────────────────────
      if (step.type === 'web_fetch') {
        const r = await webFetch(cfg.url ?? '');
        if (!r.ok) throw new Error(r.error);
        context += `\n[WEB: ${cfg.url}]\n${r.data}\n`;
        onLog(`  ✓ Pagina opgehaald (${String(r.data).length} tekens)`, true);

      } else if (step.type === 'rss_feed') {
        const r = await rssFeed(cfg.url ?? '', Number(cfg.limit ?? 10));
        if (!r.ok) throw new Error(r.error);
        const items = r.data as Array<{ title: string; link: string; description: string; date: string }>;
        context += `\n[RSS: ${cfg.url}]\n${items.map(i => `• ${i.title}\n  ${i.link}\n  ${i.description}`).join('\n\n')}\n`;
        onLog(`  ✓ ${items.length} RSS items opgehaald`, true);

      } else if (step.type === 'html_extract') {
        const r = await htmlExtract(cfg.url ?? '', cfg.selector ?? '');
        if (!r.ok) throw new Error(r.error);
        context += `\n[HTML EXTRACT]\n${r.data}\n`;
        onLog(`  ✓ HTML geëxtraheerd`, true);

      // ── HTTP ─────────────────────────────────────────────────────────────
      } else if (step.type === 'http_get') {
        const r = await httpGet(cfg.url ?? '', hdr());
        if (!r.ok) throw new Error(r.error);
        context += `\n[GET ${cfg.url}]\n${JSON.stringify(r.data).slice(0, 1500)}\n`;
        onLog(`  ✓ HTTP GET geslaagd`, true);

      } else if (step.type === 'http_post') {
        const r = await httpPost(cfg.url ?? '', bdy(), hdr());
        if (!r.ok) throw new Error(r.error);
        context += `\n[POST ${cfg.url}]\n${JSON.stringify(r.data).slice(0, 800)}\n`;
        onLog(`  ✓ HTTP POST geslaagd`, true);

      } else if (step.type === 'http_put') {
        const r = await httpPut(cfg.url ?? '', bdy(), hdr());
        if (!r.ok) throw new Error(r.error);
        context += `\n[PUT ${cfg.url}]\n${JSON.stringify(r.data).slice(0, 800)}\n`;
        onLog(`  ✓ HTTP PUT geslaagd`, true);

      } else if (step.type === 'http_patch') {
        const r = await httpPatch(cfg.url ?? '', bdy(), hdr());
        if (!r.ok) throw new Error(r.error);
        context += `\n[PATCH ${cfg.url}]\n${JSON.stringify(r.data).slice(0, 800)}\n`;
        onLog(`  ✓ HTTP PATCH geslaagd`, true);

      } else if (step.type === 'http_delete') {
        const r = await httpDelete(cfg.url ?? '', hdr());
        if (!r.ok) throw new Error(r.error);
        context += `\n[DELETE ${cfg.url}]\n${JSON.stringify(r.data).slice(0, 400)}\n`;
        onLog(`  ✓ HTTP DELETE geslaagd`, true);

      // ── Messaging ─────────────────────────────────────────────────────────
      } else if (step.type === 'send_webhook') {
        const payload = { ...bdy(), agent_output: finalOutput, context };
        const r = await sendWebhook(cfg.url ?? '', payload);
        if (!r.ok) throw new Error(r.error);
        onLog(`  ✓ Webhook verstuurd`, true);

      } else if (step.type === 'send_discord') {
        const msg = (cfg.message || finalOutput || '').replace('{output}', finalOutput).replace('{context}', context.slice(-500));
        const r = await sendDiscord(cfg.url ?? '', msg, cfg.username || 'NEXUS');
        if (!r.ok) throw new Error(r.error);
        onLog(`  ✓ Discord bericht verstuurd`, true);

      } else if (step.type === 'send_slack') {
        const msg = (cfg.text || finalOutput || '').replace('{output}', finalOutput).replace('{context}', context.slice(-500));
        const r = await sendSlack(cfg.url ?? '', msg);
        if (!r.ok) throw new Error(r.error);
        onLog(`  ✓ Slack bericht verstuurd`, true);

      } else if (step.type === 'send_telegram') {
        const msg = (cfg.message || finalOutput || '').replace('{output}', finalOutput);
        const r = await sendTelegram(cfg.bot_token ?? '', cfg.chat_id ?? '', msg);
        if (!r.ok) throw new Error(r.error);
        onLog(`  ✓ Telegram bericht verstuurd`, true);

      } else if (step.type === 'send_email') {
        const body = (cfg.body || finalOutput || '').replace('{output}', finalOutput);
        const r = await sendEmail(cfg.api_key ?? '', cfg.from ?? '', cfg.to ?? '', cfg.subject ?? '', body);
        if (!r.ok) throw new Error(r.error);
        onLog(`  ✓ Email verstuurd naar ${cfg.to}`, true);

      // ── Transform ─────────────────────────────────────────────────────────
      } else if (step.type === 'agent_prompt' || step.type === 'agent_summarize') {
        const agentId = cfg.agent ?? wf.agent;
        const profile = AGENT_PROFILES[agentId];
        if (!profile) throw new Error(`Agent '${agentId}' niet gevonden`);
        const sysPrompt = step.type === 'agent_summarize'
          ? `Maak een beknopte samenvatting in het Nederlands. Gebruik bullets waar nuttig.`
          : profile.systemPrompt;
        const userMsg = step.type === 'agent_summarize'
          ? `Vat dit samen:\n${context}`
          : `${profile.systemPrompt}\n\n${context}\n\nUser: ${cfg.prompt ?? ''}\n\nAssistant:`;
        const prompt = step.type === 'agent_summarize' ? `${sysPrompt}\n\n${userMsg}` : userMsg;
        let response = '';
        await streamAgent(agentId, prompt, profile.temperature, tok => { response += tok; });
        context += `\n[${agentId.toUpperCase()} OUTPUT]\n${response}\n`;
        finalOutput = response;
        onLog(`  ✓ ${agentId.toUpperCase()}: ${response.slice(0, 100)}…`, true);

      } else if (step.type === 'run_code') {
        const r = await runCode(cfg.code ?? '', context);
        if (!r.ok) throw new Error(r.error);
        context += `\n[CODE OUTPUT]\n${r.data}\n`;
        finalOutput = String(r.data ?? '');
        onLog(`  ✓ Code uitgevoerd: ${String(r.data).slice(0, 80)}`, true);

      } else if (step.type === 'json_extract') {
        const r = await jsonExtract(context, cfg.path ?? '');
        if (!r.ok) throw new Error(r.error);
        context += `\n[JSON.${cfg.path}]\n${r.data}\n`;
        finalOutput = String(r.data ?? '');
        onLog(`  ✓ JSON pad '${cfg.path}': ${String(r.data).slice(0, 60)}`, true);

      } else if (step.type === 'transform_set') {
        const val = (cfg.value ?? '').replace('{output}', finalOutput).replace('{context}', context.slice(-300));
        context += `\n[SET ${cfg.key ?? 'var'}]\n${val}\n`;
        if (cfg.key) finalOutput = val;
        onLog(`  ✓ Variabele gezet: ${cfg.key} = ${val.slice(0, 60)}`, true);

      } else if (step.type === 'filter') {
        const r = await filterCondition(context, cfg.condition ?? 'true');
        if (!r.ok) throw new Error(r.error);
        if (!r.data) {
          onLog(`  ⊘ Filter: conditie niet voldaan — workflow gestopt`, true);
          break;
        }
        onLog(`  ✓ Filter: conditie voldaan`, true);

      } else if (step.type === 'nexus_api_call') {
        const agentId = cfg.agent ?? 'vega';
        const profile = AGENT_PROFILES[agentId];
        if (!profile) throw new Error(`Agent '${agentId}' niet gevonden`);
        const promptText = (cfg.prompt ?? '').replace('{output}', finalOutput).replace('{context}', context.slice(-800));
        const prompt = `${profile.systemPrompt}\n\nUser: ${promptText}\n\nAssistant:`;
        let response = '';
        await streamAgent(agentId, prompt, profile.temperature, tok => { response += tok; });
        context += `\n[NEXUS API — ${agentId.toUpperCase()}]\n${response}\n`;
        finalOutput = response;
        onLog(`  ✓ NEXUS API (${agentId.toUpperCase()}): ${response.slice(0, 100)}…`, true);

      // ── Social / Video ────────────────────────────────────────────────────
      } else if (step.type === 'youtube_upload') {
        const title       = (cfg.title || finalOutput).replace('{output}', finalOutput);
        const description = (cfg.description || '').replace('{output}', finalOutput);
        const tags        = cfg.tags ? cfg.tags.split(',').map((t: string) => t.trim()).filter(Boolean) : [];
        const meta = {
          snippet: { title, description, tags },
          status:  { privacyStatus: cfg.privacy || 'unlisted' },
        };
        const initRes = await fetch(
          'https://www.googleapis.com/upload/youtube/v3/videos?uploadType=resumable&part=snippet,status',
          { method: 'POST', headers: { 'Authorization': `Bearer ${cfg.access_token}`, 'Content-Type': 'application/json', 'X-Upload-Content-Type': 'video/*' }, body: JSON.stringify(meta) }
        );
        if (!initRes.ok) throw new Error(`YouTube init fout: ${initRes.status} — ${await initRes.text()}`);
        const uploadUrl = initRes.headers.get('location');
        if (!uploadUrl) throw new Error('Geen upload URL ontvangen');
        const videoBuffer = fs.readFileSync(cfg.video_path);
        const upRes = await fetch(uploadUrl, { method: 'PUT', headers: { 'Content-Type': 'video/*', 'Content-Length': String(videoBuffer.length) }, body: videoBuffer });
        if (!upRes.ok) throw new Error(`YouTube upload fout: ${upRes.status}`);
        const vid = await upRes.json() as { id: string };
        finalOutput = `https://youtu.be/${vid.id}`;
        context += `\n[YOUTUBE]\n${finalOutput}\n`;
        onLog(`  ✓ YouTube geüpload: ${finalOutput}`, true);

      } else if (step.type === 'twitter_post') {
        const text = (cfg.text || finalOutput).replace('{output}', finalOutput).slice(0, 280);
        const res  = await fetch('https://api.twitter.com/2/tweets', {
          method: 'POST', headers: { 'Authorization': `Bearer ${cfg.bearer_token}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({ text }),
        });
        if (!res.ok) throw new Error(`Twitter fout: ${res.status} — ${await res.text()}`);
        const tw = await res.json() as { data: { id: string } };
        finalOutput = `https://twitter.com/i/web/status/${tw.data.id}`;
        context += `\n[TWITTER]\nTweet: ${text}\n${finalOutput}\n`;
        onLog(`  ✓ Tweet gepubliceerd: ${finalOutput}`, true);

      } else if (step.type === 'instagram_post') {
        const caption = (cfg.caption || finalOutput).replace('{output}', finalOutput);
        const mediaRes = await fetch(`https://graph.facebook.com/v18.0/${cfg.account_id}/media`, {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ image_url: cfg.image_url, caption, access_token: cfg.access_token }),
        });
        if (!mediaRes.ok) throw new Error(`Instagram media fout: ${mediaRes.status}`);
        const { id: creationId } = await mediaRes.json() as { id: string };
        const pubRes = await fetch(`https://graph.facebook.com/v18.0/${cfg.account_id}/media_publish`, {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ creation_id: creationId, access_token: cfg.access_token }),
        });
        if (!pubRes.ok) throw new Error(`Instagram publish fout: ${pubRes.status}`);
        finalOutput = 'Instagram post gepubliceerd';
        context += `\n[INSTAGRAM]\n${finalOutput}\n`;
        onLog(`  ✓ ${finalOutput}`, true);

      } else if (step.type === 'linkedin_post') {
        const text = (cfg.text || finalOutput).replace('{output}', finalOutput);
        const res  = await fetch('https://api.linkedin.com/v2/ugcPosts', {
          method: 'POST',
          headers: { 'Authorization': `Bearer ${cfg.access_token}`, 'Content-Type': 'application/json', 'X-Restli-Protocol-Version': '2.0.0' },
          body: JSON.stringify({
            author: cfg.person_id, lifecycleState: 'PUBLISHED',
            specificContent: { 'com.linkedin.ugc.ShareContent': { shareCommentary: { text }, shareMediaCategory: 'NONE' } },
            visibility: { 'com.linkedin.ugc.MemberNetworkVisibility': 'PUBLIC' },
          }),
        });
        if (!res.ok) throw new Error(`LinkedIn fout: ${res.status} — ${await res.text()}`);
        finalOutput = 'LinkedIn post gepubliceerd';
        context += `\n[LINKEDIN]\n${finalOutput}\n`;
        onLog(`  ✓ ${finalOutput}`, true);

      } else if (step.type === 'tiktok_post') {
        const caption = (cfg.caption || finalOutput).replace('{output}', finalOutput);
        const initRes = await fetch('https://open.tiktokapis.com/v2/post/publish/video/init/', {
          method: 'POST',
          headers: { 'Authorization': `Bearer ${cfg.access_token}`, 'Content-Type': 'application/json; charset=UTF-8' },
          body: JSON.stringify({ post_info: { title: caption, privacy_level: 'SELF_ONLY', disable_duet: false, disable_comment: false, disable_stitch: false, video_cover_timestamp_ms: 1000 }, source_info: { source: 'FILE_UPLOAD', video_size: fs.statSync(cfg.video_path).size, chunk_size: fs.statSync(cfg.video_path).size, total_chunk_count: 1 } }),
        });
        if (!initRes.ok) throw new Error(`TikTok init fout: ${initRes.status}`);
        const { data: { upload_url } } = await initRes.json() as { data: { upload_url: string } };
        const videoBuffer = fs.readFileSync(cfg.video_path);
        const upRes = await fetch(upload_url, { method: 'PUT', headers: { 'Content-Range': `bytes 0-${videoBuffer.length - 1}/${videoBuffer.length}`, 'Content-Type': 'video/mp4' }, body: videoBuffer });
        if (!upRes.ok) throw new Error(`TikTok upload fout: ${upRes.status}`);
        finalOutput = 'TikTok video geüpload';
        context += `\n[TIKTOK]\n${finalOutput}\n`;
        onLog(`  ✓ ${finalOutput}`, true);
      }
    } catch (e) {
      allOk = false;
      onLog(`  ✗ ${(e as Error).message}`, false);
    }
  }

  // Update workflow metadata
  workflows[idx].lastRun = new Date().toISOString();
  workflows[idx].lastStatus = allOk ? 'done' : 'error';
  save(workflows);

  onLog(allOk ? `✓ Workflow klaar` : `✗ Workflow klaar met fouten`);
  return { ok: allOk, output: finalOutput };
}
