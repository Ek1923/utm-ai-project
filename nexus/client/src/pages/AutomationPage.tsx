import { useState, useRef, useEffect, useCallback } from 'react';

// ── Node types ────────────────────────────────────────────────────────────────
type NodeType =
  | 'trigger' | 'schedule_trigger' | 'webhook_trigger'
  | 'agent_prompt' | 'agent_summarize' | 'agent_analyze'
  | 'web_fetch' | 'rss_feed' | 'html_extract' | 'web_search'
  | 'http_get' | 'http_post' | 'http_put' | 'http_patch' | 'http_delete'
  | 'send_webhook' | 'send_discord' | 'send_slack' | 'send_telegram' | 'send_email'
  | 'run_code' | 'json_extract' | 'transform_set' | 'filter' | 'condition'
  | 'loop_items' | 'delay' | 'regex_match' | 'template' | 'date_format'
  | 'csv_parse' | 'xml_parse' | 'base64_encode' | 'hash_data'
  | 'notion_append' | 'github_issue' | 'openai_request'
  | 'nexus_api_call'
  | 'youtube_upload' | 'twitter_post' | 'instagram_post' | 'linkedin_post' | 'tiktok_post';

interface CNode { id: string; type: NodeType; x: number; y: number; config: Record<string, string>; }
interface CEdge { id: string; from: string; to: string; }
interface SavedFlow {
  id: string; name: string; agent: string;
  steps: Array<{ id: string; type: string; label: string; config: Record<string, string> }>;
  enabled: boolean; createdAt: string; lastStatus?: string; lastRun?: string;
  canvas?: { nodes: CNode[]; edges: CEdge[] };
}

const NW = 210;
const NH = 108;

// ── Node definitions ──────────────────────────────────────────────────────────
interface NDef { label: string; color: string; icon: string; desc: string; required?: string[] }
const ND: Record<NodeType, NDef> = {
  trigger:          { label: 'Handmatig',      color: '#00ff9d', icon: '▷',  desc: 'Start flow handmatig via Run-knop', required: [] },
  schedule_trigger: { label: 'Rooster',         color: '#00ffd5', icon: '◷',  desc: 'Start flow op vaste tijden (cron)', required: ['cron'] },
  webhook_trigger:  { label: 'Webhook Inkomend',color: '#44ffcc', icon: '⤵',  desc: 'Ontvangt inkomende HTTP requests', required: [] },
  agent_prompt:     { label: 'Agent Prompt',    color: '#00b4ff', icon: '◈',  desc: 'Stuur een vraag naar een AI agent', required: ['prompt'] },
  agent_summarize:  { label: 'Samenvatten',     color: '#7b9fff', icon: '◇',  desc: 'Laat een agent de context samenvatten', required: [] },
  agent_analyze:    { label: 'Agent Analyse',   color: '#88aaff', icon: '◉',  desc: 'Laat een agent data analyseren', required: ['instructions'] },
  web_fetch:        { label: 'Web Scrape',      color: '#ffb800', icon: '⬇',  desc: 'Haal tekst op van een webpagina', required: ['url'] },
  rss_feed:         { label: 'RSS Feed',        color: '#ff9500', icon: '◉',  desc: 'Lees items uit een RSS/Atom feed', required: ['url'] },
  html_extract:     { label: 'HTML Extract',    color: '#e0a860', icon: '⊡',  desc: 'Extraheer tekst op basis van selector', required: ['url'] },
  web_search:       { label: 'Web Zoeken',      color: '#ffd700', icon: '⊕',  desc: 'Zoek het web via DuckDuckGo', required: ['query'] },
  http_get:         { label: 'HTTP GET',        color: '#c8a86b', icon: '→',  desc: 'Stuur een GET request naar een API', required: ['url'] },
  http_post:        { label: 'HTTP POST',       color: '#ff6b00', icon: '↗',  desc: 'Stuur data naar een API endpoint', required: ['url'] },
  http_put:         { label: 'HTTP PUT',        color: '#ff8c42', icon: '⇑',  desc: 'Vervang een resource via PUT', required: ['url'] },
  http_patch:       { label: 'HTTP PATCH',      color: '#d4804d', icon: '≈',  desc: 'Patch een bestaande resource', required: ['url'] },
  http_delete:      { label: 'HTTP DELETE',     color: '#ff4444', icon: '✕',  desc: 'Verwijder een resource via API', required: ['url'] },
  send_webhook:     { label: 'Webhook',         color: '#ff2d55', icon: '⚡︎', desc: 'Stuur payload naar webhook URL', required: ['url'] },
  send_discord:     { label: 'Discord',         color: '#7289da', icon: '◈',  desc: 'Stuur bericht naar Discord channel', required: ['url'] },
  send_slack:       { label: 'Slack',           color: '#4ab394', icon: '◉',  desc: 'Stuur bericht naar Slack channel', required: ['url'] },
  send_telegram:    { label: 'Telegram',        color: '#2ca5e0', icon: '✈',  desc: 'Stuur bericht via Telegram Bot', required: ['bot_token', 'chat_id'] },
  send_email:       { label: 'Email',           color: '#00c4b4', icon: '✉',  desc: 'Stuur email via Resend API', required: ['api_key', 'to'] },
  run_code:         { label: 'Code Uitvoeren',  color: '#b400ff', icon: '{}', desc: 'Voer JavaScript code uit', required: ['code'] },
  json_extract:     { label: 'JSON Extract',    color: '#9d7aff', icon: '⊕',  desc: 'Extraheer waarde via dot-pad', required: ['path'] },
  transform_set:    { label: 'Set Variabele',   color: '#6e7eff', icon: '=',  desc: 'Sla een waarde op in context', required: ['key'] },
  filter:           { label: 'Filter / Stop',   color: '#ff5f57', icon: '⊘',  desc: 'Stop flow als conditie niet klopt', required: ['condition'] },
  condition:        { label: 'Conditie Split',  color: '#ff7f50', icon: '⇔',  desc: 'Stuur flow naar twee paden', required: ['condition'] },
  loop_items:       { label: 'Loop Items',      color: '#88ff88', icon: '↻',  desc: 'Herhaal stappen voor elk item', required: ['items_path'] },
  delay:            { label: 'Wacht / Delay',   color: '#aaaaff', icon: '⏱',  desc: 'Pauzeer de flow voor N seconden', required: ['seconds'] },
  regex_match:      { label: 'Regex Match',     color: '#ffaa44', icon: 'Rx', desc: 'Extraheer tekst via regex patroon', required: ['pattern'] },
  template:         { label: 'Template',        color: '#ff66aa', icon: '⊞',  desc: 'Bouw tekst met variabele placeholders', required: ['template'] },
  date_format:      { label: 'Datum Formaat',   color: '#44ddff', icon: '📅', desc: 'Formatteer huidige datum/tijd', required: [] },
  csv_parse:        { label: 'CSV Parse',       color: '#88ffcc', icon: '⊟',  desc: 'Verwerk CSV data naar objecten', required: [] },
  xml_parse:        { label: 'XML Parse',       color: '#ffcc44', icon: '⊠',  desc: 'Parse XML naar JSON structuur', required: [] },
  base64_encode:    { label: 'Base64',          color: '#ccaaff', icon: 'B64',desc: 'Encode/decode tekst naar Base64', required: [] },
  hash_data:        { label: 'Hash (SHA256)',   color: '#ddaaff', icon: '#',  desc: 'Bereken SHA256 hash van tekst', required: [] },
  notion_append:    { label: 'Notion Append',   color: '#ffffff', icon: 'N',  desc: 'Voeg content toe aan Notion pagina', required: ['api_key', 'page_id'] },
  github_issue:     { label: 'GitHub Issue',    color: '#cccccc', icon: '⊙',  desc: 'Maak GitHub issue aan', required: ['token', 'repo'] },
  openai_request:   { label: 'OpenAI Chat',     color: '#10a37f', icon: 'AI', desc: 'Stuur request naar OpenAI API', required: ['api_key', 'prompt'] },
  nexus_api_call:   { label: 'NEXUS Bot API',   color: '#00ffd5', icon: '◈',  desc: 'Roep een NEXUS bot aan (intern of extern via API sleutel)', required: ['prompt'] },
  youtube_upload:   { label: 'YouTube Upload',  color: '#ff0000', icon: '▶',  desc: 'Upload video naar YouTube kanaal (OAuth access token vereist)', required: ['access_token', 'title', 'video_path'] },
  twitter_post:     { label: 'Twitter/X Post',  color: '#1da1f2', icon: '✦',  desc: 'Publiceer tweet via Twitter API v2', required: ['bearer_token', 'text'] },
  instagram_post:   { label: 'Instagram Post',  color: '#e1306c', icon: '◉',  desc: 'Post foto naar Instagram via Graph API', required: ['access_token', 'account_id', 'image_url'] },
  linkedin_post:    { label: 'LinkedIn Post',   color: '#0077b5', icon: 'in', desc: 'Deel bericht op LinkedIn profiel/pagina', required: ['access_token', 'person_id'] },
  tiktok_post:      { label: 'TikTok Upload',   color: '#69c9d0', icon: '♪',  desc: 'Upload video naar TikTok account', required: ['access_token', 'video_path'] },
};

// ── Categories ─────────────────────────────────────────────────────────────────
type Cat = { label: string; color: string; icon: string; types: NodeType[] }
const CATS: Cat[] = [
  { label: 'TRIGGERS',      color: '#00ffd5', icon: '▷', types: ['schedule_trigger', 'webhook_trigger'] },
  { label: 'AI & AGENTS',   color: '#00b4ff', icon: '◈', types: ['agent_prompt', 'agent_summarize', 'agent_analyze', 'openai_request'] },
  { label: 'WEB & DATA',    color: '#ffb800', icon: '⬇', types: ['web_fetch', 'rss_feed', 'html_extract', 'web_search'] },
  { label: 'HTTP & API',    color: '#ff6b00', icon: '→', types: ['http_get', 'http_post', 'http_put', 'http_patch', 'http_delete'] },
  { label: 'MESSAGING',     color: '#ff2d55', icon: '✉', types: ['send_webhook', 'send_discord', 'send_slack', 'send_telegram', 'send_email'] },
  { label: 'LOGIC & FLOW',  color: '#88ff88', icon: '⇔', types: ['filter', 'condition', 'loop_items', 'delay'] },
  { label: 'TRANSFORM',     color: '#b400ff', icon: '{}', types: ['run_code', 'json_extract', 'transform_set', 'template', 'regex_match'] },
  { label: 'DATA FORMAT',   color: '#44ddff', icon: '⊟', types: ['date_format', 'csv_parse', 'xml_parse', 'base64_encode', 'hash_data'] },
  { label: 'NEXUS API',     color: '#00ffd5', icon: '◈', types: ['nexus_api_call'] },
  { label: 'INTEGRATIES',   color: '#cccccc', icon: '⊙', types: ['notion_append', 'github_issue'] },
  { label: 'SOCIAL MEDIA',  color: '#ff0000', icon: '▶', types: ['youtube_upload', 'twitter_post', 'instagram_post', 'linkedin_post', 'tiktok_post'] },
];

// ── Default configs ────────────────────────────────────────────────────────────
const NODE_DEFAULTS: Partial<Record<NodeType, Record<string, string>>> = {
  schedule_trigger: { cron: '0 9 * * 1-5', description: 'Elke werkdag om 9:00' },
  agent_prompt:     { agent: 'spark', prompt: '' },
  agent_summarize:  { agent: 'atlas' },
  agent_analyze:    { agent: 'tactix', instructions: 'Analyseer de data en geef inzichten.' },
  web_fetch:        { url: '' },
  rss_feed:         { url: '', limit: '10' },
  html_extract:     { url: '', selector: '' },
  web_search:       { query: '' },
  http_get:         { url: '' },
  http_post:        { url: '', body: '{}' },
  http_put:         { url: '', body: '{}' },
  http_patch:       { url: '', body: '{}' },
  http_delete:      { url: '' },
  send_webhook:     { url: '', payload: '{}' },
  send_discord:     { url: '', message: '{output}', username: 'NEXUS' },
  send_slack:       { url: '', text: '{output}' },
  send_telegram:    { bot_token: '', chat_id: '', message: '{output}' },
  send_email:       { api_key: '', from: '', to: '', subject: 'NEXUS Rapport', body: '{output}' },
  run_code:         { code: '// context bevat alle vorige output\nreturn context;' },
  json_extract:     { path: 'data.result' },
  transform_set:    { key: 'myVar', value: '{output}' },
  filter:           { condition: 'context.length > 0' },
  condition:        { condition: 'context.includes("success")' },
  loop_items:       { items_path: 'data.items', max_iterations: '10' },
  delay:            { seconds: '5' },
  regex_match:      { pattern: '', flags: 'g', group: '0' },
  template:         { template: 'Resultaat: {output}\nDatum: {date}' },
  date_format:      { format: 'DD-MM-YYYY HH:mm', timezone: 'Europe/Amsterdam' },
  csv_parse:        { delimiter: ',', has_header: 'true' },
  xml_parse:        { root_path: '' },
  base64_encode:    { mode: 'encode' },
  hash_data:        { algorithm: 'sha256' },
  notion_append:    { api_key: '', page_id: '' },
  github_issue:     { token: '', repo: '', title: '{output}', body: '' },
  openai_request:   { api_key: '', model: 'gpt-4o-mini', prompt: '', system: 'You are a helpful assistant.' },
  nexus_api_call:   { agent: 'vega', prompt: '{output}' },
  youtube_upload:   { privacy: 'unlisted', title: '{output}', description: '' },
  twitter_post:     { text: '{output}' },
  instagram_post:   { caption: '{output}' },
  linkedin_post:    { text: '{output}' },
  tiktok_post:      { caption: '{output}' },
};

// ── Config fields per type ─────────────────────────────────────────────────────
const CONFIG_FIELDS: Partial<Record<NodeType, { key: string; label: string; hint?: string; multi?: boolean; select?: string[] }[]>> = {
  schedule_trigger: [
    { key: 'cron', label: 'CRON EXPRESSIE', hint: '0 9 * * 1-5 = werkdagen 9:00' },
    { key: 'description', label: 'OMSCHRIJVING' },
  ],
  agent_prompt:    [{ key: 'agent', label: 'AGENT' }, { key: 'prompt', label: 'PROMPT', multi: true }],
  agent_summarize: [{ key: 'agent', label: 'AGENT' }],
  agent_analyze:   [{ key: 'agent', label: 'AGENT' }, { key: 'instructions', label: 'INSTRUCTIES', multi: true }],
  web_fetch:       [{ key: 'url', label: 'URL', hint: 'https://example.com' }],
  rss_feed:        [{ key: 'url', label: 'FEED URL' }, { key: 'limit', label: 'MAX ITEMS', hint: '1-50' }],
  html_extract:    [{ key: 'url', label: 'URL' }, { key: 'selector', label: 'ZOEKTERM / SELECTOR' }],
  web_search:      [{ key: 'query', label: 'ZOEKTERM', hint: 'gebruik {output} voor dynamisch' }],
  http_get:        [{ key: 'url', label: 'URL' }, { key: 'headers', label: 'HEADERS (JSON)', multi: true }],
  http_post:       [{ key: 'url', label: 'URL' }, { key: 'body', label: 'BODY (JSON)', multi: true }, { key: 'headers', label: 'HEADERS (JSON)', multi: true }],
  http_put:        [{ key: 'url', label: 'URL' }, { key: 'body', label: 'BODY (JSON)', multi: true }],
  http_patch:      [{ key: 'url', label: 'URL' }, { key: 'body', label: 'BODY (JSON)', multi: true }],
  http_delete:     [{ key: 'url', label: 'URL' }, { key: 'headers', label: 'HEADERS (JSON)', multi: true }],
  send_webhook:    [{ key: 'url', label: 'WEBHOOK URL' }, { key: 'payload', label: 'PAYLOAD (JSON)', multi: true }],
  send_discord:    [{ key: 'url', label: 'DISCORD WEBHOOK URL' }, { key: 'message', label: 'BERICHT ({output})', multi: true }, { key: 'username', label: 'BOT NAAM' }],
  send_slack:      [{ key: 'url', label: 'SLACK WEBHOOK URL' }, { key: 'text', label: 'TEKST ({output})', multi: true }],
  send_telegram:   [{ key: 'bot_token', label: 'BOT TOKEN' }, { key: 'chat_id', label: 'CHAT ID' }, { key: 'message', label: 'BERICHT ({output})', multi: true }],
  send_email:      [{ key: 'api_key', label: 'RESEND API KEY' }, { key: 'from', label: 'VAN (email)' }, { key: 'to', label: 'NAAR (email)' }, { key: 'subject', label: 'ONDERWERP' }, { key: 'body', label: 'HTML BODY ({output})', multi: true }],
  run_code:        [{ key: 'code', label: 'JAVASCRIPT', multi: true }],
  json_extract:    [{ key: 'path', label: 'JSON PAD', hint: 'data.items.0.title' }],
  transform_set:   [{ key: 'key', label: 'VARIABELE NAAM' }, { key: 'value', label: 'WAARDE ({output})' }],
  filter:          [{ key: 'condition', label: 'CONDITIE (JS)', hint: 'context.length > 0' }],
  condition:       [{ key: 'condition', label: 'IF CONDITIE (JS)', hint: 'context.includes("ok")' }],
  loop_items:      [{ key: 'items_path', label: 'ITEMS PAD', hint: 'data.items' }, { key: 'max_iterations', label: 'MAX ITERATIES' }],
  delay:           [{ key: 'seconds', label: 'SECONDEN WACHTEN' }],
  regex_match:     [{ key: 'pattern', label: 'REGEX PATROON' }, { key: 'flags', label: 'FLAGS', hint: 'g, i, m' }, { key: 'group', label: 'CAPTURE GROEP', hint: '0 = hele match' }],
  template:        [{ key: 'template', label: 'TEMPLATE TEKST', multi: true, hint: '{output}, {date} zijn beschikbaar' }],
  date_format:     [{ key: 'format', label: 'FORMAAT', hint: 'DD-MM-YYYY HH:mm' }, { key: 'timezone', label: 'TIJDZONE', hint: 'Europe/Amsterdam' }],
  csv_parse:       [{ key: 'delimiter', label: 'SCHEIDINGSTEKEN', hint: ', of ;' }, { key: 'has_header', label: 'HEEFT HEADER', select: ['true', 'false'] }],
  xml_parse:       [{ key: 'root_path', label: 'ROOT PAD', hint: 'items.item' }],
  base64_encode:   [{ key: 'mode', label: 'MODUS', select: ['encode', 'decode'] }],
  hash_data:       [{ key: 'algorithm', label: 'ALGORITME', select: ['sha256', 'sha512', 'md5'] }],
  notion_append:   [{ key: 'api_key', label: 'NOTION API KEY' }, { key: 'page_id', label: 'PAGINA ID' }, { key: 'content', label: 'CONTENT ({output})', multi: true }],
  github_issue:    [{ key: 'token', label: 'GITHUB TOKEN' }, { key: 'repo', label: 'REPO', hint: 'user/repo' }, { key: 'title', label: 'TITEL ({output})' }, { key: 'body', label: 'BODY', multi: true }],
  openai_request:  [{ key: 'api_key', label: 'OPENAI API KEY' }, { key: 'model', label: 'MODEL', hint: 'gpt-4o-mini' }, { key: 'system', label: 'SYSTEEM PROMPT', multi: true }, { key: 'prompt', label: 'USER PROMPT ({output})', multi: true }],
  nexus_api_call:  [{ key: 'agent', label: 'AGENT' }, { key: 'prompt', label: 'BERICHT ({output})', multi: true }],
  youtube_upload:  [
    { key: 'access_token', label: 'YOUTUBE ACCESS TOKEN', hint: 'OAuth2 Bearer token' },
    { key: 'video_path',   label: 'VIDEO BESTAND', hint: 'C:\\pad\\video.mp4' },
    { key: 'title',        label: 'TITEL ({output})' },
    { key: 'description',  label: 'BESCHRIJVING ({output})', multi: true },
    { key: 'tags',         label: 'TAGS (komma)', hint: 'gaming, nexus, ai' },
    { key: 'privacy',      label: 'ZICHTBAARHEID', select: ['unlisted', 'public', 'private'] },
  ],
  twitter_post:    [
    { key: 'bearer_token', label: 'TWITTER BEARER TOKEN' },
    { key: 'text',         label: 'TWEET ({output})', multi: true, hint: 'max 280 tekens' },
  ],
  instagram_post:  [
    { key: 'access_token', label: 'INSTAGRAM ACCESS TOKEN' },
    { key: 'account_id',   label: 'INSTAGRAM ACCOUNT ID', hint: 'numeriek ID' },
    { key: 'image_url',    label: 'AFBEELDING URL', hint: 'https://...' },
    { key: 'caption',      label: 'BIJSCHRIFT ({output})', multi: true },
  ],
  linkedin_post:   [
    { key: 'access_token', label: 'LINKEDIN ACCESS TOKEN' },
    { key: 'person_id',    label: 'PERSON URN', hint: 'urn:li:person:XXXXXX' },
    { key: 'text',         label: 'BERICHT ({output})', multi: true },
  ],
  tiktok_post:     [
    { key: 'access_token', label: 'TIKTOK ACCESS TOKEN' },
    { key: 'video_path',   label: 'VIDEO BESTAND', hint: 'C:\\pad\\video.mp4' },
    { key: 'caption',      label: 'BIJSCHRIFT ({output})', multi: true },
  ],
};

const AGENTS = [
  { id: 'spark',    name: 'SPARK',    color: '#ffb800', role: 'Ideeën' },
  { id: 'vega',     name: 'VEGA',     color: '#ff2d55', role: 'Generalist' },
  { id: 'tactix',   name: 'TACTIX',   color: '#00ff9d', role: 'Planning' },
  { id: 'atlas',    name: 'ATLAS',    color: '#00b4ff', role: 'Kennis' },
  { id: 'forge',    name: 'FORGE',    color: '#ff6b00', role: 'Code' },
  { id: 'apex1',  name: 'APEX-1',  color: '#00ffd5', role: 'General Commander' },
  { id: 'apex2',  name: 'APEX-2',  color: '#b400ff', role: 'Strategic General' },
  { id: 'optic',  name: 'OPTIC',   color: '#a78bfa', role: 'Data Analyse' },
  { id: 'jarvis', name: 'JARVIS',  color: '#c8a86b', role: 'Projects' },
];

// ── Node status helper ────────────────────────────────────────────────────────
function nodeReady(node: CNode): 'ready' | 'partial' | 'empty' {
  const req = ND[node.type].required ?? [];
  if (req.length === 0) return 'ready';
  const filled = req.filter(r => node.config[r]?.trim());
  if (filled.length === req.length) return 'ready';
  if (filled.length > 0) return 'partial';
  return 'empty';
}

function flowToSteps(nodes: CNode[], edges: CEdge[]) {
  const trigger = nodes.find(n => n.type === 'trigger' || n.type === 'schedule_trigger' || n.type === 'webhook_trigger');
  if (!trigger) return { steps: [] as SavedFlow['steps'], agent: 'spark' };
  const visited = new Set<string>();
  const queue = [trigger.id];
  const steps: SavedFlow['steps'] = [];
  let agent = 'spark';
  while (queue.length) {
    const nid = queue.shift()!;
    if (visited.has(nid)) continue;
    visited.add(nid);
    const node = nodes.find(n => n.id === nid);
    if (!node) continue;
    if (node.type !== 'trigger' && node.type !== 'schedule_trigger' && node.type !== 'webhook_trigger') {
      if (node.config.agent) agent = node.config.agent;
      steps.push({ id: node.id, type: node.type, label: node.config.label ?? ND[node.type].label, config: node.config });
    }
    edges.filter(e => e.from === nid).forEach(e => queue.push(e.to));
  }
  return { steps, agent };
}

// ── Schedule picker ───────────────────────────────────────────────────────────
function parseCron(cron: string): { hour: number; minute: number; days: number[] } {
  const parts = (cron || '').trim().split(/\s+/);
  const minute = Math.min(59, Math.max(0, parseInt(parts[0] ?? '0') || 0));
  const hour   = Math.min(23, Math.max(0, parseInt(parts[1] ?? '9') || 9));
  const dayPart = parts[4] ?? '*';
  let days: number[] = [];
  if (dayPart === '*') {
    days = [0, 1, 2, 3, 4, 5, 6];
  } else {
    for (const seg of dayPart.split(',')) {
      if (seg.includes('-')) {
        const [a, b] = seg.split('-').map(Number);
        for (let i = a; i <= b; i++) days.push(i);
      } else if (!isNaN(parseInt(seg))) {
        days.push(parseInt(seg));
      }
    }
  }
  return { hour, minute, days: days.length ? days : [1, 2, 3, 4, 5] };
}
function buildCron(h: number, m: number, days: number[]): string {
  const s = [...new Set(days)].sort((a, b) => a - b);
  return `${m} ${h} * * ${s.length === 7 ? '*' : s.join(',')}`;
}
const SCHED_DAYS = [
  { label: 'MA', value: 1 }, { label: 'DI', value: 2 }, { label: 'WO', value: 3 },
  { label: 'DO', value: 4 }, { label: 'VR', value: 5 }, { label: 'ZA', value: 6 }, { label: 'ZO', value: 0 },
];
const PRESETS = [
  { label: 'WERKDAGEN', d: [1,2,3,4,5] },
  { label: 'WEEKEND',   d: [6,0] },
  { label: 'ELKE DAG',  d: [0,1,2,3,4,5,6] },
];
function SchedulePicker({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  const p = parseCron(value);
  const [hour,   setHour]   = useState(p.hour);
  const [minute, setMinute] = useState(p.minute);
  const [days,   setDays]   = useState<number[]>(p.days);
  useEffect(() => { const q = parseCron(value); setHour(q.hour); setMinute(q.minute); setDays(q.days); }, [value]);
  const emit = (h: number, m: number, d: number[]) => onChange(buildCron(h, m, d));
  const adjH = (dir: number) => { const h = (hour + dir + 24) % 24; setHour(h); emit(h, minute, days); };
  const adjM = (dir: number) => {
    const snapped = Math.round(minute / 5) * 5 % 60;
    const m = ((snapped + dir * 5) % 60 + 60) % 60;
    setMinute(m); emit(hour, m, days);
  };
  const toggleDay = (v: number) => {
    const next = days.includes(v) ? days.filter(x => x !== v) : [...days, v];
    if (!next.length) return;
    setDays(next); emit(hour, minute, next);
  };
  const spinBtn = (lbl: string, fn: () => void) => (
    <button onClick={fn}
      style={{ display: 'block', width: 46, padding: '5px 0', background: 'transparent', border: '1px solid rgba(0,245,255,0.18)', color: 'rgba(0,245,255,0.55)', cursor: 'pointer', fontSize: 12, fontFamily: 'monospace', lineHeight: 1, transition: 'all 0.1s' }}
      onMouseEnter={e => { e.currentTarget.style.background = 'rgba(0,245,255,0.09)'; e.currentTarget.style.color = '#00f5ff'; e.currentTarget.style.borderColor = 'rgba(0,245,255,0.45)'; }}
      onMouseLeave={e => { e.currentTarget.style.background = 'transparent'; e.currentTarget.style.color = 'rgba(0,245,255,0.55)'; e.currentTarget.style.borderColor = 'rgba(0,245,255,0.18)'; }}
    >{lbl}</button>
  );
  const numBox = (val: number) => (
    <div style={{ width: 46, textAlign: 'center', padding: '9px 0', background: 'rgba(0,245,255,0.07)', border: '1px solid rgba(0,245,255,0.28)', color: '#00f5ff', fontSize: 22, fontFamily: 'monospace', fontWeight: 700 }}>
      {String(val).padStart(2, '0')}
    </div>
  );
  return (
    <div style={{ marginBottom: 14 }}>
      <div style={{ fontSize: 7.5, color: 'rgba(255,255,255,0.25)', letterSpacing: '0.12em', marginBottom: 6 }}>SNEL KIEZEN</div>
      <div style={{ display: 'flex', gap: 3, marginBottom: 14 }}>
        {PRESETS.map(pr => {
          const active = pr.d.length === days.length && pr.d.every(x => days.includes(x));
          return (
            <button key={pr.label} onClick={() => { setDays(pr.d); emit(hour, minute, pr.d); }}
              style={{ flex: 1, padding: '5px 0', fontSize: 7.5, fontFamily: 'inherit', fontWeight: active ? 700 : 400, background: active ? 'rgba(0,245,255,0.1)' : 'transparent', border: `1px solid ${active ? 'rgba(0,245,255,0.45)' : 'rgba(255,255,255,0.08)'}`, color: active ? '#00f5ff' : 'rgba(255,255,255,0.28)', cursor: 'pointer', transition: 'all 0.1s' }}
              onMouseEnter={e => { if (!active) { e.currentTarget.style.borderColor = 'rgba(0,245,255,0.3)'; e.currentTarget.style.color = 'rgba(0,245,255,0.65)'; } }}
              onMouseLeave={e => { if (!active) { e.currentTarget.style.borderColor = 'rgba(255,255,255,0.08)'; e.currentTarget.style.color = 'rgba(255,255,255,0.28)'; } }}
            >{pr.label}</button>
          );
        })}
      </div>
      <div style={{ fontSize: 7.5, color: 'rgba(255,255,255,0.25)', letterSpacing: '0.12em', marginBottom: 6 }}>DAGEN</div>
      <div style={{ display: 'flex', gap: 3, marginBottom: 16 }}>
        {SCHED_DAYS.map(d => {
          const active = days.includes(d.value);
          return (
            <button key={d.value} onClick={() => toggleDay(d.value)}
              style={{ flex: 1, padding: '6px 0', fontSize: 8, fontFamily: 'inherit', fontWeight: active ? 700 : 400, background: active ? 'rgba(0,245,255,0.12)' : 'transparent', border: `1px solid ${active ? 'rgba(0,245,255,0.55)' : 'rgba(255,255,255,0.1)'}`, color: active ? '#00f5ff' : 'rgba(255,255,255,0.3)', cursor: 'pointer', transition: 'all 0.1s' }}
              onMouseEnter={e => { if (!active) { e.currentTarget.style.borderColor = 'rgba(0,245,255,0.3)'; e.currentTarget.style.color = 'rgba(0,245,255,0.65)'; } }}
              onMouseLeave={e => { if (!active) { e.currentTarget.style.borderColor = 'rgba(255,255,255,0.1)'; e.currentTarget.style.color = 'rgba(255,255,255,0.3)'; } }}
            >{d.label}</button>
          );
        })}
      </div>
      <div style={{ fontSize: 7.5, color: 'rgba(255,255,255,0.25)', letterSpacing: '0.12em', marginBottom: 8 }}>TIJDSTIP</div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 3 }}>
          {spinBtn('▲', () => adjH(1))}
          {numBox(hour)}
          {spinBtn('▼', () => adjH(-1))}
          <div style={{ fontSize: 7, color: 'rgba(255,255,255,0.18)', marginTop: 3, letterSpacing: '0.1em' }}>UUR</div>
        </div>
        <div style={{ fontSize: 24, color: 'rgba(0,245,255,0.35)', fontFamily: 'monospace', fontWeight: 700, marginBottom: 22 }}>:</div>
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 3 }}>
          {spinBtn('▲', () => adjM(1))}
          {numBox(minute)}
          {spinBtn('▼', () => adjM(-1))}
          <div style={{ fontSize: 7, color: 'rgba(255,255,255,0.18)', marginTop: 3, letterSpacing: '0.1em' }}>MIN</div>
        </div>
        <div style={{ fontSize: 7.5, color: 'rgba(255,255,255,0.13)', marginLeft: 4, lineHeight: 1.9 }}>stap<br /><span style={{ color: 'rgba(0,245,255,0.35)', fontFamily: 'monospace' }}>+5</span><br />min</div>
      </div>
    </div>
  );
}

const TRIGGER_NODE: CNode = { id: 'trigger_0', type: 'trigger', x: 60, y: 200, config: { label: 'Start' } };

export function AutomationPage() {
  const [flows,      setFlows]      = useState<SavedFlow[]>([]);
  const [currentId,  setCurrentId]  = useState<string | null>(null);
  const [flowName,   setFlowName]   = useState('Nieuwe Flow');
  const [nodes,      setNodes]      = useState<CNode[]>([TRIGGER_NODE]);
  const [edges,      setEdges]      = useState<CEdge[]>([]);
  const [pan,        setPan]        = useState({ x: 0, y: 0 });
  const [selected,   setSelected]   = useState<string | null>(null);
  const [connecting, setConnecting] = useState<string | null>(null);
  const [mouse,      setMouse]      = useState({ x: 0, y: 0 });
  const [runLogs,    setRunLogs]    = useState<string[]>([]);
  const [isRunning,  setIsRunning]  = useState(false);
  const [showRun,    setShowRun]    = useState(false);
  const [showPicker, setShowPicker] = useState(false);
  const [pickerSearch, setPickerSearch] = useState('');

  const dragRef   = useRef<{ id: string; sx: number; sy: number; ox: number; oy: number } | null>(null);
  const panRef    = useRef<{ sx: number; sy: number; ox: number; oy: number } | null>(null);
  const canvasRef = useRef<HTMLDivElement>(null);
  const logRef    = useRef<HTMLDivElement>(null);
  const nodesRef  = useRef(nodes);
  nodesRef.current = nodes;

  const reloadFlows = useCallback(() => {
    fetch('/api/automation/workflows').then(r => r.json()).then(d => setFlows(d.workflows ?? [])).catch(() => {});
  }, []);

  useEffect(() => { reloadFlows(); }, [reloadFlows]);
  useEffect(() => { if (logRef.current) logRef.current.scrollTop = logRef.current.scrollHeight; }, [runLogs]);
  useEffect(() => {
    const up = () => { dragRef.current = null; panRef.current = null; };
    window.addEventListener('mouseup', up);
    return () => window.removeEventListener('mouseup', up);
  }, []);

  const outP = (n: CNode) => ({ x: n.x + pan.x + NW + 10, y: n.y + pan.y + NH / 2 });
  const inP  = (n: CNode) => ({ x: n.x + pan.x - 10,       y: n.y + pan.y + NH / 2 });

  const makePath = (x1: number, y1: number, x2: number, y2: number) => {
    const c = Math.max(70, Math.abs(x2 - x1) * 0.5);
    return `M ${x1} ${y1} C ${x1 + c} ${y1} ${x2 - c} ${y2} ${x2} ${y2}`;
  };

  const onMouseMove = (e: React.MouseEvent<HTMLDivElement>) => {
    const rect = canvasRef.current?.getBoundingClientRect();
    if (rect) setMouse({ x: e.clientX - rect.left, y: e.clientY - rect.top });
    if (dragRef.current) {
      const { id, sx, sy, ox, oy } = dragRef.current;
      setNodes(ns => ns.map(n => n.id === id ? { ...n, x: ox + (e.clientX - sx), y: oy + (e.clientY - sy) } : n));
    } else if (panRef.current) {
      const { sx, sy, ox, oy } = panRef.current;
      setPan({ x: ox + (e.clientX - sx), y: oy + (e.clientY - sy) });
    }
  };

  const onBgDown = (e: React.MouseEvent) => {
    const t = e.target as HTMLElement;
    if (t.closest('[data-node]') || t.closest('[data-port]')) return;
    if (connecting) { setConnecting(null); return; }
    setSelected(null);
    panRef.current = { sx: e.clientX, sy: e.clientY, ox: pan.x, oy: pan.y };
  };

  const onNodeDown = (e: React.MouseEvent, id: string) => {
    e.stopPropagation();
    const n = nodesRef.current.find(x => x.id === id)!;
    dragRef.current = { id, sx: e.clientX, sy: e.clientY, ox: n.x, oy: n.y };
    setSelected(id);
    setShowRun(false);
  };

  const clickOut = (e: React.MouseEvent, nodeId: string) => {
    e.stopPropagation();
    setConnecting(prev => prev === nodeId ? null : nodeId);
  };

  const clickIn = (e: React.MouseEvent, nodeId: string) => {
    e.stopPropagation();
    if (!connecting || connecting === nodeId) { setConnecting(null); return; }
    setEdges(es => [...es.filter(ex => ex.to !== nodeId), { id: `e_${Date.now()}`, from: connecting, to: nodeId }]);
    setConnecting(null);
  };

  const delEdge = (edgeId: string) => setEdges(es => es.filter(e => e.id !== edgeId));

  const addNode = (type: NodeType) => {
    const id = `${type}_${Date.now()}`;
    const rightmost = nodesRef.current.length ? Math.max(...nodesRef.current.map(n => n.x)) + NW + 60 : 340;
    setNodes(ns => [...ns, { id, type, x: rightmost, y: 200, config: { label: ND[type].label, ...(NODE_DEFAULTS[type] ?? {}) } }]);
    setSelected(id);
    setShowPicker(false);
    setPickerSearch('');
  };

  const delNode = (id: string) => {
    if (nodes.length <= 1) return;
    setNodes(ns => ns.filter(n => n.id !== id));
    setEdges(es => es.filter(e => e.from !== id && e.to !== id));
    if (selected === id) setSelected(null);
  };

  const updCfg = (id: string, k: string, v: string) =>
    setNodes(ns => ns.map(n => n.id === id ? { ...n, config: { ...n.config, [k]: v } } : n));

  const saveFlow = useCallback(async (): Promise<string | null> => {
    const curNodes = nodesRef.current;
    const { steps, agent } = flowToSteps(curNodes, edges);
    const body = { name: flowName, agent, description: '', steps, canvas: { nodes: curNodes, edges }, trigger: { type: 'manual' }, enabled: true };
    if (currentId) {
      await fetch(`/api/automation/workflows/${currentId}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
      reloadFlows();
      return currentId;
    } else {
      const d = await fetch('/api/automation/workflows', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }).then(r => r.json());
      const newId: string | null = d.workflow?.id ?? null;
      setCurrentId(newId);
      reloadFlows();
      return newId;
    }
  }, [edges, flowName, currentId, reloadFlows]);

  const loadFlow = (f: SavedFlow) => {
    setCurrentId(f.id); setFlowName(f.name);
    if (f.canvas?.nodes?.length) {
      setNodes(f.canvas.nodes); setEdges(f.canvas.edges ?? []);
    } else {
      const autoNodes: CNode[] = [
        { id: 'trigger_0', type: 'trigger', x: 60, y: 200, config: { label: 'Start' } },
        ...f.steps.map((s, i) => ({ id: s.id, type: s.type as NodeType, x: 340 + i * 290, y: 200, config: { label: s.label, ...s.config } })),
      ];
      setNodes(autoNodes);
      setEdges(autoNodes.slice(0, -1).map((n, i) => ({ id: `ae_${i}`, from: n.id, to: autoNodes[i + 1].id })));
    }
    setSelected(null); setShowRun(false);
  };

  const newFlow = async () => {
    const d = await fetch('/api/automation/workflows', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'Nieuwe Flow', agent: 'spark', description: '', steps: [], canvas: { nodes: [TRIGGER_NODE], edges: [] }, trigger: { type: 'manual' }, enabled: true }),
    }).then(r => r.json()).catch(() => ({}));
    setCurrentId(d.workflow?.id ?? null);
    setFlowName('Nieuwe Flow');
    setNodes([TRIGGER_NODE]); setEdges([]); setSelected(null); setShowRun(false);
    reloadFlows();
  };

  const deleteFlow = async (id: string, e: React.MouseEvent) => {
    e.stopPropagation();
    await fetch(`/api/automation/workflows/${id}`, { method: 'DELETE' });
    if (currentId === id) { setCurrentId(null); setFlowName('Nieuwe Flow'); setNodes([TRIGGER_NODE]); setEdges([]); setSelected(null); }
    reloadFlows();
  };

  const runFlow = async () => {
    setShowRun(true); setIsRunning(true); setRunLogs(['▶ Opslaan en starten...']);
    const id = await saveFlow();
    if (!id) { setIsRunning(false); setRunLogs(['✗ Kon flow niet opslaan']); return; }
    try {
      const res = await fetch(`/api/automation/workflows/${id}/run`, { method: 'POST' });
      const reader = res.body!.getReader();
      const dec = new TextDecoder();
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        for (const line of dec.decode(value).split('\n')) {
          if (!line.startsWith('data: ')) continue;
          try {
            const ev = JSON.parse(line.slice(6));
            if (ev.type === 'log')  setRunLogs(l => [...l, ev.data.message]);
            if (ev.type === 'done') setRunLogs(l => [...l, ev.data.ok ? '✓ Workflow klaar' : '✗ Mislukt']);
          } catch { /* skip */ }
        }
      }
    } catch (err) { setRunLogs(l => [...l, `✗ ${(err as Error).message}`]); }
    setIsRunning(false);
    reloadFlows();
  };

  const selNode = nodes.find(n => n.id === selected);

  // Filtered picker items
  const pickerQuery = pickerSearch.toLowerCase();
  const filteredCats = CATS.map(cat => ({
    ...cat,
    types: cat.types.filter(t =>
      !pickerQuery ||
      ND[t].label.toLowerCase().includes(pickerQuery) ||
      ND[t].desc.toLowerCase().includes(pickerQuery) ||
      t.includes(pickerQuery)
    ),
  })).filter(cat => cat.types.length > 0);

  const isTrigger = (t: NodeType) => t === 'trigger' || t === 'schedule_trigger' || t === 'webhook_trigger';

  return (
    <div style={{ display: 'flex', height: '100%', background: '#040f1a', overflow: 'hidden', fontFamily: "'Courier New', monospace" }}>

      {/* ── Sidebar ─────────────────────────────────────────────────────────── */}
      <div style={{ width: 196, flexShrink: 0, borderRight: '1px solid rgba(0,245,255,0.09)', display: 'flex', flexDirection: 'column', background: '#030c16' }}>

        {/* Header */}
        <div style={{ padding: '14px 14px 10px', borderBottom: '1px solid rgba(0,245,255,0.07)' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 7, marginBottom: 3 }}>
            <span style={{ color: '#ff2d55', fontSize: 13 }}>⚡︎</span>
            <span style={{ color: '#ff2d55', fontSize: 11, fontWeight: 700, letterSpacing: '0.12em' }}>AUTOMATION</span>
          </div>
          <div style={{ fontSize: 7.5, color: 'rgba(255,255,255,0.2)', letterSpacing: '0.1em' }}>
            {flows.length} FLOW{flows.length !== 1 ? 'S' : ''} · NEXUS ENGINE
          </div>
        </div>

        {/* New flow button */}
        <div style={{ padding: '8px 10px 4px' }}>
          <button onClick={newFlow}
            style={{ width: '100%', padding: '6px 10px', fontSize: 9, border: '1px solid rgba(0,255,157,0.25)', color: '#00ff9d', background: 'transparent', cursor: 'pointer', textAlign: 'left', letterSpacing: '0.12em', display: 'flex', alignItems: 'center', gap: 6 }}
            onMouseEnter={e => { e.currentTarget.style.background = 'rgba(0,255,157,0.06)'; e.currentTarget.style.borderColor = 'rgba(0,255,157,0.45)'; }}
            onMouseLeave={e => { e.currentTarget.style.background = 'transparent'; e.currentTarget.style.borderColor = 'rgba(0,255,157,0.25)'; }}
          >
            <span style={{ fontSize: 12, lineHeight: 1 }}>+</span> NIEUWE FLOW
          </button>
        </div>

        {/* Flows list */}
        <div style={{ flex: 1, overflowY: 'auto', padding: '4px 8px' }}>
          {flows.length === 0 && (
            <div style={{ fontSize: 8.5, color: 'rgba(255,255,255,0.12)', padding: '14px 6px', lineHeight: 1.8 }}>
              Geen flows.<br />Klik + NIEUWE FLOW.
            </div>
          )}
          {flows.map(f => {
            const isActive = currentId === f.id;
            const sc = f.lastStatus === 'done' ? '#00ff9d' : f.lastStatus === 'error' ? '#ff2d55' : 'rgba(255,255,255,0.12)';
            return (
              <div key={f.id} style={{ position: 'relative', marginBottom: 3 }}>
                <button onClick={() => loadFlow(f)}
                  style={{ width: '100%', textAlign: 'left', padding: '8px 26px 8px 10px', background: isActive ? 'rgba(0,255,157,0.06)' : 'transparent', border: `1px solid ${isActive ? 'rgba(0,255,157,0.3)' : 'rgba(255,255,255,0.06)'}`, cursor: 'pointer', borderRadius: 2 }}
                  onMouseEnter={e => { if (!isActive) e.currentTarget.style.borderColor = 'rgba(255,255,255,0.14)'; }}
                  onMouseLeave={e => { if (!isActive) e.currentTarget.style.borderColor = 'rgba(255,255,255,0.06)'; }}
                >
                  <div style={{ fontSize: 10, color: isActive ? '#00ff9d' : 'rgba(255,255,255,0.55)', marginBottom: 2, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{f.name}</div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
                    <div style={{ width: 4, height: 4, borderRadius: '50%', background: sc, flexShrink: 0 }} />
                    <span style={{ fontSize: 7.5, color: sc }}>
                      {f.lastStatus === 'done' ? 'Klaar' : f.lastStatus === 'error' ? 'Fout' : `${f.steps.length} stap${f.steps.length !== 1 ? 'pen' : ''}`}
                    </span>
                  </div>
                </button>
                {flows.length > 1 && (
                  <span onClick={e => deleteFlow(f.id, e)}
                    style={{ position: 'absolute', right: 6, top: '50%', transform: 'translateY(-50%)', color: 'rgba(255,45,85,0.45)', cursor: 'pointer', fontSize: 12, lineHeight: 1, padding: '3px 4px', borderRadius: 2, transition: 'all 0.12s' }}
                    onMouseEnter={e => { e.currentTarget.style.color = '#ff2d55'; e.currentTarget.style.background = 'rgba(255,45,85,0.12)'; }}
                    onMouseLeave={e => { e.currentTarget.style.color = 'rgba(255,45,85,0.45)'; e.currentTarget.style.background = 'transparent'; }}
                    title="Flow verwijderen"
                  >✕</span>
                )}
              </div>
            );
          })}
        </div>

        {/* Agents legend */}
        <div style={{ borderTop: '1px solid rgba(255,255,255,0.05)', padding: '10px 12px' }}>
          <div style={{ fontSize: 7, color: 'rgba(255,255,255,0.15)', letterSpacing: '0.15em', marginBottom: 7 }}>BESCHIKBARE AGENTS</div>
          {AGENTS.map(a => (
            <div key={a.id} style={{ display: 'flex', alignItems: 'center', gap: 7, marginBottom: 4 }}>
              <div style={{ width: 5, height: 5, borderRadius: '50%', background: a.color, boxShadow: `0 0 4px ${a.color}` }} />
              <span style={{ fontSize: 9.5, color: a.color, fontWeight: 700 }}>{a.name}</span>
              <span style={{ fontSize: 7.5, color: 'rgba(255,255,255,0.18)', marginLeft: 'auto' }}>{a.role}</span>
            </div>
          ))}
        </div>
      </div>

      {/* ── Main area ───────────────────────────────────────────────────────── */}
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>

        {/* Toolbar */}
        <div style={{ padding: '7px 14px', borderBottom: '1px solid rgba(255,255,255,0.06)', display: 'flex', alignItems: 'center', gap: 8, flexShrink: 0, background: 'rgba(3,12,22,0.9)', zIndex: 20 }}>
          <input value={flowName} onChange={e => setFlowName(e.target.value)}
            style={{ background: 'transparent', border: 'none', borderBottom: '1px solid rgba(255,255,255,0.1)', color: 'rgba(255,255,255,0.7)', fontSize: 12, padding: '2px 4px', outline: 'none', width: 180, fontFamily: 'inherit' }} />

          <div style={{ width: 1, height: 16, background: 'rgba(255,255,255,0.08)' }} />

          {/* + NODE button */}
          <div style={{ position: 'relative' }}>
            <button onClick={() => { setShowPicker(p => !p); setPickerSearch(''); }}
              style={{ padding: '4px 14px', fontSize: 9.5, border: `1px solid ${showPicker ? 'rgba(0,245,255,0.6)' : 'rgba(0,245,255,0.25)'}`, color: showPicker ? '#00f5ff' : 'rgba(0,245,255,0.55)', background: showPicker ? 'rgba(0,245,255,0.08)' : 'transparent', cursor: 'pointer', letterSpacing: '0.12em', fontFamily: 'inherit', fontWeight: 700 }}
            >+ NODE</button>

            {/* Node picker panel */}
            {showPicker && (
              <div
                style={{ position: 'absolute', top: 'calc(100% + 8px)', left: 0, width: 600, background: '#040e1a', border: '1px solid rgba(0,245,255,0.18)', zIndex: 100, boxShadow: '0 16px 60px rgba(0,0,0,0.85)' }}
                onMouseLeave={() => { setShowPicker(false); setPickerSearch(''); }}
              >
                {/* Search bar */}
                <div style={{ padding: '10px 14px 8px', borderBottom: '1px solid rgba(255,255,255,0.06)' }}>
                  <input
                    value={pickerSearch}
                    onChange={e => setPickerSearch(e.target.value)}
                    placeholder="Zoek nodes... (bijv. discord, loop, regex)"
                    autoFocus
                    style={{ width: '100%', background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.1)', color: '#fff', padding: '5px 10px', fontSize: 10, outline: 'none', fontFamily: 'inherit' }}
                  />
                </div>
                <div style={{ padding: '10px 14px 12px', maxHeight: 400, overflowY: 'auto' }}>
                  {filteredCats.map(cat => (
                    <div key={cat.label} style={{ marginBottom: 14 }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 7, marginBottom: 7 }}>
                        <span style={{ color: cat.color, fontSize: 11 }}>{cat.icon}</span>
                        <span style={{ fontSize: 8, color: cat.color, letterSpacing: '0.2em', fontWeight: 700 }}>{cat.label}</span>
                        <div style={{ flex: 1, height: 1, background: `${cat.color}20`, marginLeft: 4 }} />
                      </div>
                      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 4 }}>
                        {cat.types.map(t => {
                          const d = ND[t];
                          return (
                            <button key={t} onClick={() => addNode(t)}
                              style={{ padding: '7px 9px', border: `1px solid ${d.color}30`, background: 'transparent', cursor: 'pointer', textAlign: 'left' }}
                              onMouseEnter={e => { e.currentTarget.style.background = `${d.color}12`; e.currentTarget.style.borderColor = `${d.color}66`; }}
                              onMouseLeave={e => { e.currentTarget.style.background = 'transparent'; e.currentTarget.style.borderColor = `${d.color}30`; }}
                            >
                              <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 3 }}>
                                <span style={{ color: d.color, fontSize: 11, fontFamily: 'monospace', flexShrink: 0, minWidth: 16, textAlign: 'center' }}>{d.icon}</span>
                                <span style={{ color: d.color, fontSize: 9.5, fontWeight: 700, fontFamily: 'inherit' }}>{d.label}</span>
                              </div>
                              <div style={{ fontSize: 7.5, color: 'rgba(255,255,255,0.3)', lineHeight: 1.4, paddingLeft: 22 }}>{d.desc}</div>
                            </button>
                          );
                        })}
                      </div>
                    </div>
                  ))}
                  {filteredCats.length === 0 && (
                    <div style={{ fontSize: 9, color: 'rgba(255,255,255,0.25)', padding: '20px', textAlign: 'center' }}>Geen nodes gevonden voor "{pickerSearch}"</div>
                  )}
                </div>
              </div>
            )}
          </div>

          <div style={{ flex: 1 }} />

          {/* Node count */}
          <span style={{ fontSize: 8.5, color: 'rgba(255,255,255,0.2)', letterSpacing: '0.1em' }}>
            {nodes.length} NODE{nodes.length !== 1 ? 'S' : ''} · {edges.length} VERBINDING{edges.length !== 1 ? 'EN' : ''}
          </span>

          <button onClick={saveFlow}
            style={{ padding: '4px 12px', fontSize: 9, border: '1px solid rgba(255,255,255,0.12)', color: 'rgba(255,255,255,0.35)', background: 'transparent', cursor: 'pointer', letterSpacing: '0.1em', fontFamily: 'inherit' }}
            onMouseEnter={e => e.currentTarget.style.color = 'rgba(255,255,255,0.65)'}
            onMouseLeave={e => e.currentTarget.style.color = 'rgba(255,255,255,0.35)'}
          >OPSLAAN</button>
          <button onClick={runFlow} disabled={isRunning}
            style={{ padding: '4px 16px', fontSize: 10, border: '1px solid rgba(0,255,157,0.45)', color: '#00ff9d', background: 'rgba(0,255,157,0.05)', cursor: isRunning ? 'not-allowed' : 'pointer', letterSpacing: '0.12em', fontFamily: 'inherit', fontWeight: 700, opacity: isRunning ? 0.6 : 1 }}
            onMouseEnter={e => { if (!isRunning) e.currentTarget.style.background = 'rgba(0,255,157,0.1)'; }}
            onMouseLeave={e => e.currentTarget.style.background = 'rgba(0,255,157,0.05)'}
          >{isRunning ? '⟳ BEZIG...' : '▶ RUN'}</button>
        </div>

        {/* Canvas + right panel */}
        <div style={{ flex: 1, display: 'flex', overflow: 'hidden' }}>

          {/* Canvas */}
          <div
            ref={canvasRef}
            style={{ flex: 1, position: 'relative', overflow: 'hidden', background: '#050f1b', cursor: connecting ? 'crosshair' : 'default' }}
            onMouseDown={onBgDown}
            onMouseMove={onMouseMove}
            onMouseUp={() => { dragRef.current = null; panRef.current = null; }}
          >
            {/* Grid */}
            <div style={{ position: 'absolute', inset: 0, backgroundImage: 'radial-gradient(circle, rgba(0,245,255,0.09) 1px, transparent 1px)', backgroundSize: '30px 30px', backgroundPosition: `${pan.x % 30}px ${pan.y % 30}px`, pointerEvents: 'none', zIndex: 0 }} />

            {/* SVG cables */}
            <svg style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', pointerEvents: 'none', overflow: 'visible', zIndex: 1 }}>
              <defs>
                <marker id="arrowhead" markerWidth="8" markerHeight="6" refX="7" refY="3" orient="auto">
                  <polygon points="0 0, 8 3, 0 6" fill="rgba(0,245,255,0.4)" />
                </marker>
              </defs>
              {edges.map(edge => {
                const fn = nodes.find(n => n.id === edge.from);
                const tn = nodes.find(n => n.id === edge.to);
                if (!fn || !tn) return null;
                const op = outP(fn), ip = inP(tn), col = ND[fn.type].color;
                const d = makePath(op.x, op.y, ip.x, ip.y);
                return (
                  <g key={edge.id}>
                    {/* Glow */}
                    <path d={d} fill="none" stroke={col} strokeWidth={8} opacity={0.06} />
                    {/* Main cable */}
                    <path d={d} fill="none" stroke={col} strokeWidth={1.8} opacity={0.7} markerEnd="url(#arrowhead)" />
                    {/* Animated data flow */}
                    <path d={d} fill="none" stroke={col} strokeWidth={2.5} opacity={0.5} strokeDasharray="12 60"
                      style={{ animation: `cable-flow 1.8s linear infinite` }} />
                    {/* Clickable delete zone */}
                    <path d={d} fill="none" stroke="transparent" strokeWidth={14} style={{ cursor: 'pointer', pointerEvents: 'stroke' }}
                      onDoubleClick={() => delEdge(edge.id)} />
                  </g>
                );
              })}
              {connecting && (() => {
                const fn = nodes.find(n => n.id === connecting);
                if (!fn) return null;
                const op = outP(fn), col = ND[fn.type].color;
                return <path d={makePath(op.x, op.y, mouse.x, mouse.y)} fill="none" stroke={col} strokeWidth={1.8} opacity={0.55} strokeDasharray="8 5" />;
              })()}
            </svg>

            {/* Nodes */}
            {nodes.map(node => {
              const def   = ND[node.type];
              const isSel = selected === node.id;
              const isConn = connecting === node.id;
              const status = nodeReady(node);
              const statusColor = status === 'ready' ? '#00ff9d' : status === 'partial' ? '#ffb800' : '#ff2d55';
              const cat = CATS.find(c => c.types.includes(node.type as any));
              return (
                <div
                  key={node.id}
                  data-node={node.id}
                  style={{
                    position: 'absolute', zIndex: isSel ? 10 : 2,
                    left: node.x + pan.x, top: node.y + pan.y,
                    width: NW, height: NH,
                    background: isSel
                      ? `linear-gradient(145deg, ${def.color}16 0%, #0a1620 100%)`
                      : `linear-gradient(145deg, #081420 0%, #050e1a 100%)`,
                    border: `1px solid ${isSel ? def.color + 'aa' : def.color + '35'}`,
                    boxShadow: isSel ? `0 0 28px ${def.color}28, 0 0 60px ${def.color}0e` : '0 4px 18px rgba(0,0,0,0.55)',
                    borderRadius: 4, userSelect: 'none',
                    cursor: 'grab',
                    transition: 'border-color 0.12s, box-shadow 0.12s',
                    overflow: 'hidden',
                  }}
                  onMouseDown={e => onNodeDown(e, node.id)}
                >
                  {/* Left category stripe */}
                  <div style={{ position: 'absolute', left: 0, top: 0, bottom: 0, width: 3, background: def.color, opacity: 0.7 }} />

                  {/* Header */}
                  <div style={{ height: 36, display: 'flex', alignItems: 'center', gap: 7, padding: '0 10px 0 10px', borderBottom: `1px solid ${def.color}18`, background: `${def.color}0a` }}>
                    <span style={{ color: def.color, fontSize: 12, fontFamily: 'monospace', flexShrink: 0, width: 16, textAlign: 'center' }}>{def.icon}</span>
                    <span style={{ color: def.color, fontSize: 10, fontWeight: 700, letterSpacing: '0.05em', flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {node.config.label ?? def.label}
                    </span>
                    {/* Status dot */}
                    {node.type !== 'trigger' && (
                      <div style={{ width: 6, height: 6, borderRadius: '50%', background: statusColor, boxShadow: `0 0 5px ${statusColor}`, flexShrink: 0 }} title={`Status: ${status}`} />
                    )}
                    {/* Delete button — all nodes deletable, min 1 must remain */}
                    {nodes.length > 1 && (
                      <span onMouseDown={e => e.stopPropagation()} onClick={() => delNode(node.id)}
                        style={{ color: 'rgba(255,45,85,0.3)', cursor: 'pointer', fontSize: 13, lineHeight: 1, flexShrink: 0, paddingLeft: 3 }}
                        onMouseEnter={e => e.currentTarget.style.color = '#ff2d55'}
                        onMouseLeave={e => e.currentTarget.style.color = 'rgba(255,45,85,0.3)'}
                      >✕</span>
                    )}
                  </div>

                  {/* Body preview */}
                  <div style={{ padding: '6px 10px 6px 14px', fontSize: 8.5, fontFamily: 'monospace', lineHeight: 1.6, overflow: 'hidden', height: NH - 36 }}>
                    {isTrigger(node.type) && (
                      <span style={{ color: 'rgba(255,255,255,0.18)', fontSize: 8 }}>
                        {node.type === 'schedule_trigger' ? `⏱ ${node.config.cron || 'geen schema'}` :
                         node.type === 'webhook_trigger' ? '⤵ Wacht op inkomend request' :
                         '▷ Handmatig starten via RUN'}
                      </span>
                    )}
                    {node.type === 'agent_prompt' && (
                      <div>
                        <span style={{ color: AGENTS.find(a => a.id === node.config.agent)?.color ?? '#fff', fontWeight: 700, fontSize: 9 }}>
                          {(node.config.agent ?? 'spark').toUpperCase()}
                        </span>
                        <div style={{ color: 'rgba(255,255,255,0.3)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', marginTop: 2, fontSize: 8 }}>
                          {node.config.prompt ? node.config.prompt.slice(0, 42) + (node.config.prompt.length > 42 ? '…' : '') : '— vul prompt in —'}
                        </div>
                      </div>
                    )}
                    {['web_fetch', 'http_get', 'http_post', 'http_put', 'http_delete', 'send_webhook', 'rss_feed'].includes(node.type) && (
                      <div style={{ color: 'rgba(255,255,255,0.3)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', fontSize: 8 }}>
                        {node.config.url || '— vul URL in —'}
                      </div>
                    )}
                    {node.type === 'send_discord' && (
                      <div>
                        <div style={{ color: 'rgba(255,255,255,0.25)', fontSize: 8 }}>bot: {node.config.username || 'NEXUS'}</div>
                        <div style={{ color: 'rgba(255,255,255,0.3)', fontSize: 8 }}>{node.config.message?.slice(0, 38) || '— vul bericht in —'}</div>
                      </div>
                    )}
                    {node.type === 'run_code' && (
                      <div style={{ color: 'rgba(180,0,255,0.6)', fontSize: 8 }}>{node.config.code?.split('\n')[0]?.slice(0, 40) || '// code'}</div>
                    )}
                    {node.type === 'filter' && (
                      <div style={{ color: 'rgba(255,95,87,0.7)', fontSize: 8 }}>if: {node.config.condition?.slice(0, 40) || '...'}</div>
                    )}
                    {node.type === 'delay' && (
                      <div style={{ color: 'rgba(170,170,255,0.7)', fontSize: 9 }}>⏱ {node.config.seconds || '?'} seconden</div>
                    )}
                    {node.type === 'template' && (
                      <div style={{ color: 'rgba(255,102,170,0.7)', fontSize: 8 }}>{node.config.template?.slice(0, 40) || '— vul template in —'}</div>
                    )}
                    {/* Category badge */}
                    {cat && !isTrigger(node.type) && (
                      <div style={{ position: 'absolute', bottom: 5, right: 8, fontSize: 7, color: `${def.color}44`, letterSpacing: '0.1em' }}>
                        {cat.label}
                      </div>
                    )}
                  </div>

                  {/* Input port */}
                  {!isTrigger(node.type) && (
                    <div data-port="in" onMouseDown={e => e.stopPropagation()} onClick={e => clickIn(e, node.id)}
                      style={{ position: 'absolute', left: -10, top: '50%', transform: 'translateY(-50%)', width: 18, height: 18, borderRadius: '50%', background: connecting ? `${def.color}30` : '#060f1a', border: `2px solid ${connecting ? def.color : def.color + '55'}`, cursor: 'pointer', zIndex: 5, transition: 'all 0.15s' }}
                      onMouseEnter={e => { e.currentTarget.style.background = `${def.color}25`; e.currentTarget.style.boxShadow = `0 0 12px ${def.color}`; }}
                      onMouseLeave={e => { e.currentTarget.style.background = connecting ? `${def.color}30` : '#060f1a'; e.currentTarget.style.boxShadow = 'none'; }}
                    />
                  )}

                  {/* Output port */}
                  <div data-port="out" onMouseDown={e => e.stopPropagation()} onClick={e => clickOut(e, node.id)}
                    style={{ position: 'absolute', right: -10, top: '50%', transform: 'translateY(-50%)', width: 18, height: 18, borderRadius: '50%', background: isConn ? def.color : '#060f1a', border: `2px solid ${def.color}`, cursor: 'pointer', zIndex: 5, boxShadow: isConn ? `0 0 16px ${def.color}` : `0 0 6px ${def.color}44`, transition: 'all 0.15s' }}
                    onMouseEnter={e => { e.currentTarget.style.boxShadow = `0 0 16px ${def.color}`; e.currentTarget.style.background = def.color; }}
                    onMouseLeave={e => { e.currentTarget.style.boxShadow = isConn ? `0 0 16px ${def.color}` : `0 0 6px ${def.color}44`; e.currentTarget.style.background = isConn ? def.color : '#060f1a'; }}
                  />
                </div>
              );
            })}

            {/* Empty state */}
            {nodes.length <= 1 && (
              <div style={{ position: 'absolute', top: '45%', left: '55%', transform: 'translate(-50%,-50%)', textAlign: 'center', pointerEvents: 'none' }}>
                <div style={{ fontSize: 22, color: 'rgba(0,245,255,0.04)', letterSpacing: '0.1em', marginBottom: 18, fontFamily: 'monospace' }}>FLOW CANVAS</div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 10, alignItems: 'flex-start' }}>
                  {[
                    { n: '1', t: 'Klik "+ NODE" boven om nodes toe te voegen', c: '#00f5ff' },
                    { n: '2', t: 'Sleep nodes om ze te positioneren', c: '#ffb800' },
                    { n: '3', t: 'Klik rechter ● poort → klik linker poort om te verbinden', c: '#ff6b00' },
                    { n: '4', t: 'Dubbelklik op een verbinding om hem te verwijderen', c: '#ff2d55' },
                    { n: '5', t: 'Klik een node om hem te configureren (rechter panel)', c: '#00b4ff' },
                    { n: '6', t: 'Klik "▶ RUN" om de flow uit te voeren', c: '#00ff9d' },
                  ].map(s => (
                    <div key={s.n} style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                      <span style={{ width: 17, height: 17, borderRadius: '50%', border: `1px solid ${s.c}44`, color: s.c, fontSize: 8, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0, fontFamily: 'monospace' }}>{s.n}</span>
                      <span style={{ fontSize: 9, color: 'rgba(255,255,255,0.18)', fontFamily: 'monospace' }}>{s.t}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>

          {/* ── Right panel: config or run log ─── */}
          {(selNode || showRun) && (
            <div style={{ width: 248, flexShrink: 0, borderLeft: '1px solid rgba(255,255,255,0.07)', background: '#040d18', display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>

              {/* Run log panel */}
              {showRun && (
                <>
                  <div style={{ padding: '10px 14px', borderBottom: '1px solid rgba(0,255,157,0.1)', background: 'rgba(0,255,157,0.04)', display: 'flex', alignItems: 'center', gap: 6 }}>
                    {isRunning && <div style={{ width: 6, height: 6, borderRadius: '50%', background: '#00ff9d', animation: 'pulse 0.6s infinite' }} />}
                    <span style={{ color: '#00ff9d', fontSize: 10, fontWeight: 700, flex: 1, letterSpacing: '0.12em' }}>
                      {isRunning ? 'UITVOEREN...' : 'UITVOER LOG'}
                    </span>
                    {!isRunning && <button onClick={() => setShowRun(false)} style={{ background: 'none', border: 'none', color: 'rgba(255,255,255,0.3)', cursor: 'pointer', fontSize: 15 }}>✕</button>}
                  </div>
                  <div ref={logRef} style={{ flex: 1, overflowY: 'auto', padding: '10px 14px', fontSize: 9.5, lineHeight: 2 }}>
                    {runLogs.map((line, i) => (
                      <div key={i} style={{ color: line.startsWith('✓') ? '#00ff9d' : line.startsWith('✗') ? '#ff2d55' : line.startsWith('▶') ? '#ffb800' : '#7bb8e0', fontFamily: 'monospace' }}>{line}</div>
                    ))}
                    {isRunning && <span style={{ color: '#00b4ff', animation: 'blink 0.8s infinite' }}>▌</span>}
                  </div>
                </>
              )}

              {/* Node config panel */}
              {!showRun && selNode && (() => {
                const def    = ND[selNode.type];
                const fields = CONFIG_FIELDS[selNode.type] ?? [];
                const status = nodeReady(selNode);
                const statusColor = status === 'ready' ? '#00ff9d' : status === 'partial' ? '#ffb800' : '#ff2d55';
                return (
                  <>
                    {/* Config header */}
                    <div style={{ padding: '11px 14px', borderBottom: `1px solid ${def.color}20`, background: `${def.color}08` }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 7, marginBottom: 4 }}>
                        <span style={{ color: def.color, fontSize: 13 }}>{def.icon}</span>
                        <span style={{ color: def.color, fontSize: 10.5, fontWeight: 700, letterSpacing: '0.07em' }}>{def.label}</span>
                        <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 4 }}>
                          <div style={{ width: 6, height: 6, borderRadius: '50%', background: statusColor, boxShadow: `0 0 5px ${statusColor}` }} />
                          <span style={{ fontSize: 7.5, color: statusColor }}>{status === 'ready' ? 'GEREED' : status === 'partial' ? 'GEDEELTELIJK' : 'INCOMPLEET'}</span>
                        </div>
                      </div>
                      <div style={{ fontSize: 8, color: 'rgba(255,255,255,0.25)', lineHeight: 1.5 }}>{def.desc}</div>
                    </div>

                    {/* Fields */}
                    <div style={{ flex: 1, overflowY: 'auto', padding: '12px 14px' }}>
                      {/* Label field */}
                      <div style={{ marginBottom: 14 }}>
                        <label style={{ fontSize: 7.5, color: 'rgba(255,255,255,0.25)', display: 'block', marginBottom: 4, letterSpacing: '0.12em' }}>NAAM</label>
                        <input value={selNode.config.label ?? def.label} onChange={e => updCfg(selNode.id, 'label', e.target.value)}
                          style={{ width: '100%', padding: '6px 9px', background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.1)', color: '#e8f4ff', fontSize: 10, outline: 'none', boxSizing: 'border-box', fontFamily: 'inherit' }} />
                      </div>

                      {/* Schedule visual picker */}
                      {selNode.type === 'schedule_trigger' && (
                        <SchedulePicker
                          value={selNode.config.cron ?? '0 9 * * 1-5'}
                          onChange={v => updCfg(selNode.id, 'cron', v)}
                        />
                      )}

                      {/* Dynamic fields */}
                      {fields.map(f => {
                        if (selNode.type === 'schedule_trigger' && f.key === 'cron') return null;
                        if (f.key === 'agent') {
                          const agColor = AGENTS.find(a => a.id === selNode.config.agent)?.color ?? '#fff';
                          return (
                            <div key="agent" style={{ marginBottom: 14 }}>
                              <label style={{ fontSize: 7.5, color: 'rgba(255,255,255,0.25)', display: 'block', marginBottom: 4, letterSpacing: '0.12em' }}>AGENT</label>
                              <select value={selNode.config.agent ?? 'spark'} onChange={e => updCfg(selNode.id, 'agent', e.target.value)}
                                style={{ width: '100%', padding: '6px 9px', background: '#060f1a', border: `1px solid ${agColor}44`, color: agColor, fontSize: 10, outline: 'none', boxSizing: 'border-box', cursor: 'pointer', fontFamily: 'inherit', fontWeight: 700 }}>
                                {AGENTS.map(a => <option key={a.id} value={a.id} style={{ background: '#060f1a', color: a.color }}>{a.name} — {a.role}</option>)}
                              </select>
                            </div>
                          );
                        }
                        if (f.select) {
                          return (
                            <div key={f.key} style={{ marginBottom: 14 }}>
                              <label style={{ fontSize: 7.5, color: 'rgba(255,255,255,0.25)', display: 'block', marginBottom: 4, letterSpacing: '0.12em' }}>{f.label}</label>
                              <select value={selNode.config[f.key] ?? f.select[0]} onChange={e => updCfg(selNode.id, f.key, e.target.value)}
                                style={{ width: '100%', padding: '6px 9px', background: '#060f1a', border: '1px solid rgba(255,255,255,0.12)', color: '#e8f4ff', fontSize: 10, outline: 'none', boxSizing: 'border-box', cursor: 'pointer', fontFamily: 'inherit' }}>
                                {f.select.map(o => <option key={o} value={o} style={{ background: '#060f1a' }}>{o}</option>)}
                              </select>
                            </div>
                          );
                        }
                        const isRequired = (ND[selNode.type].required ?? []).includes(f.key);
                        const isEmpty = !selNode.config[f.key]?.trim();
                        const borderColor = isRequired && isEmpty ? 'rgba(255,45,85,0.4)' : 'rgba(255,255,255,0.1)';
                        return (
                          <div key={f.key} style={{ marginBottom: 14 }}>
                            <label style={{ fontSize: 7.5, color: 'rgba(255,255,255,0.25)', display: 'block', marginBottom: 4, letterSpacing: '0.12em' }}>
                              {f.label}
                              {isRequired && <span style={{ color: '#ff5555', marginLeft: 4 }}>*</span>}
                            </label>
                            {f.multi ? (
                              <textarea value={selNode.config[f.key] ?? ''} onChange={e => updCfg(selNode.id, f.key, e.target.value)} rows={4}
                                style={{ width: '100%', padding: '6px 9px', background: 'rgba(255,255,255,0.03)', border: `1px solid ${borderColor}`, color: '#e8f4ff', fontSize: 9.5, outline: 'none', resize: 'vertical', boxSizing: 'border-box', fontFamily: 'monospace' }} />
                            ) : (
                              <input value={selNode.config[f.key] ?? ''} onChange={e => updCfg(selNode.id, f.key, e.target.value)}
                                style={{ width: '100%', padding: '6px 9px', background: 'rgba(255,255,255,0.03)', border: `1px solid ${borderColor}`, color: '#e8f4ff', fontSize: 10, outline: 'none', boxSizing: 'border-box', fontFamily: 'inherit' }} />
                            )}
                            {f.hint && <div style={{ fontSize: 7.5, color: 'rgba(255,255,255,0.18)', marginTop: 3 }}>bijv: {f.hint}</div>}
                          </div>
                        );
                      })}
                    </div>

                    {/* Delete button — visible for all nodes when more than 1 exists */}
                    {nodes.length > 1 && (
                      <div style={{ padding: '9px 14px', borderTop: '1px solid rgba(255,255,255,0.05)' }}>
                        <button onClick={() => delNode(selNode.id)}
                          style={{ width: '100%', padding: '6px', fontSize: 8.5, border: '1px solid rgba(255,45,85,0.2)', color: 'rgba(255,45,85,0.4)', background: 'transparent', cursor: 'pointer', letterSpacing: '0.1em', fontFamily: 'inherit' }}
                          onMouseEnter={e => { e.currentTarget.style.color = '#ff2d55'; e.currentTarget.style.borderColor = 'rgba(255,45,85,0.5)'; e.currentTarget.style.background = 'rgba(255,45,85,0.06)'; }}
                          onMouseLeave={e => { e.currentTarget.style.color = 'rgba(255,45,85,0.4)'; e.currentTarget.style.borderColor = 'rgba(255,45,85,0.2)'; e.currentTarget.style.background = 'transparent'; }}
                        >✕ VERWIJDER NODE</button>
                      </div>
                    )}
                  </>
                );
              })()}
            </div>
          )}
        </div>
      </div>

      {/* CSS for cable animation */}
      <style>{`
        @keyframes cable-flow {
          from { stroke-dashoffset: 72; }
          to   { stroke-dashoffset: 0; }
        }
        @keyframes blink { 0%,49%{opacity:1} 50%,100%{opacity:0} }
      `}</style>
    </div>
  );
}
