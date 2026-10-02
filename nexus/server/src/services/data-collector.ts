import axios from 'axios';
import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA_DIR    = path.resolve(__dirname, '..', '..', '..', '..', 'data', 'agents');
const CONFIG_FILE = path.resolve(__dirname, '..', '..', '..', '..', 'data', 'collector-plugins.json');
const SEEN_FILE   = path.resolve(__dirname, '..', '..', '..', '..', 'data', 'collector-seen.json');

const HTTP = axios.create({
  timeout: 15_000,
  headers: { 'User-Agent': 'NEXUS-AI/1.0 (educational; contact: local)' },
});

// ─── Plugin interface ─────────────────────────────────────────────────────────

export interface Plugin {
  id: string;
  name: string;
  description: string;
  icon: string;
  agents: string[];
  enabled: boolean;
}

export interface CollectProgress {
  source: string;
  topic: string;
  status: 'fetching' | 'generating' | 'saved' | 'skipped' | 'error';
  pairsGenerated?: number;
  error?: string;
}

// ─── Plugin definitions ───────────────────────────────────────────────────────

export const PLUGINS: Plugin[] = [
  {
    id: 'wikipedia',
    name: 'Wikipedia',
    description: 'Encyclopedische artikelen — volledige tekst, meerdere secties',
    icon: '📖',
    agents: ['atlas', 'forge', 'tactix', 'spark', 'vega', 'optic', 'nexus_ui', 'jarvis', 'apex1', 'apex2'],
    enabled: true,
  },
  {
    id: 'stackoverflow',
    name: 'Stack Overflow',
    description: 'Hoog-gewaardeerde coding Q&A paren direct als trainingsdata',
    icon: '💬',
    agents: ['forge', 'tactix', 'vega', 'optic', 'jarvis', 'apex1', 'apex2'],
    enabled: true,
  },
  {
    id: 'devto',
    name: 'Dev.to',
    description: 'Developer artikelen — inclusief code voorbeelden',
    icon: '✍',
    agents: ['forge', 'spark', 'atlas', 'jarvis'],
    enabled: true,
  },
  {
    id: 'github_readme',
    name: 'GitHub README',
    description: 'Populaire repo READMEs als uitleg + code trainingsdata',
    icon: '🐙',
    agents: ['forge', 'atlas', 'vega', 'optic', 'nexus_ui', 'jarvis'],
    enabled: true,
  },
  {
    id: 'huggingface',
    name: 'HuggingFace',
    description: 'Dataset cards, model cards en ML papers voor OPTIC data-analyse training',
    icon: '🤗',
    agents: ['optic', 'atlas', 'nexus_ui'],
    enabled: true,
  },
  {
    id: 'arxiv',
    name: 'arXiv',
    description: 'Wetenschappelijke papers over AI, algoritmen en computer science',
    icon: '🔬',
    agents: ['atlas', 'tactix', 'optic'],
    enabled: false,
  },
  {
    id: 'hackernews',
    name: 'Hacker News',
    description: 'Tech discussies en nieuws van de developer community',
    icon: '🔶',
    agents: ['spark', 'vega', 'atlas'],
    enabled: false,
  },
];

// ─── Agent persona styles (voor Q&A generatie in stijl van de agent) ──────────

// ─── Deduplication (persist seen topic+agent combos across runs) ──────────────

function loadSeen(): Set<string> {
  try {
    if (existsSync(SEEN_FILE)) return new Set(JSON.parse(readFileSync(SEEN_FILE, 'utf-8')));
  } catch { /* ignore */ }
  return new Set();
}

function saveSeen(seen: Set<string>) {
  const dir = path.dirname(SEEN_FILE);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  writeFileSync(SEEN_FILE, JSON.stringify([...seen]), 'utf-8');
}

// ─── Plugin state ─────────────────────────────────────────────────────────────

function loadPluginState(): Record<string, boolean> {
  try {
    if (existsSync(CONFIG_FILE)) return JSON.parse(readFileSync(CONFIG_FILE, 'utf-8'));
  } catch { /* ignore */ }
  return {};
}

function savePluginState(state: Record<string, boolean>) {
  const dir = path.dirname(CONFIG_FILE);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  writeFileSync(CONFIG_FILE, JSON.stringify(state, null, 2), 'utf-8');
}

export function getPlugins(): Plugin[] {
  const state = loadPluginState();
  return PLUGINS.map(p => ({ ...p, enabled: state[p.id] ?? p.enabled }));
}

export function setPluginEnabled(id: string, enabled: boolean) {
  const state = loadPluginState();
  state[id] = enabled;
  savePluginState(state);
}

// ─── Wikipedia — volledige tekst, niet alleen intro ───────────────────────────

const WIKI_TOPICS: Record<string, string[]> = {
  atlas:    ['History_of_programming_languages','Alan_Turing','Ada_Lovelace','Computer_science','Open_source','Linux','World_Wide_Web','Artificial_intelligence','Machine_learning','Python_(programming_language)','JavaScript','C_(programming_language)','Grace_Hopper','Tim_Berners-Lee','Linus_Torvalds','Unix','Database','Compiler','Operating_system','Cloud_computing','Cryptography','Algorithm','Data_structure','Computer_network','Internet_protocol_suite'],
  forge:    ['JavaScript','TypeScript','Node.js','React_(JavaScript_library)','Python_(programming_language)','Git','Application_programming_interface','Debugging','Object-oriented_programming','Functional_programming','Software_design_pattern','Test-driven_development','Docker_(software)','REST','GraphQL','SQL','HTML','CSS','Continuous_integration','DevOps','Microservices','WebSocket','Asynchronous_I/O','Regular_expression','JSON','YAML','Command-line_interface','Bash_(Unix_shell)','PowerShell'],
  tactix:   ['Algorithm','Big_O_notation','Sorting_algorithm','Dynamic_programming','Breadth-first_search','Depth-first_search','Binary_search_algorithm','Greedy_algorithm','Graph_theory','Hash_table','Binary_tree','Linked_list','Recursion_(computer_science)','Memoization','Dijkstra%27s_algorithm','Project_management','Agile_software_development','Scrum_(software_development)','Kanban_(development)','Software_architecture'],
  spark:    ['Design_thinking','Brainstorming','Lateral_thinking','Creativity','Innovation','Entrepreneurship','Mind_map','Six_Thinking_Hats','SCAMPER','Blue_ocean_strategy','Lean_startup','Minimum_viable_product','User_experience_design','Gamification','Storytelling','Marketing','Brand','Social_media','Viral_marketing'],
  vega:     ['Artificial_intelligence','Natural_language_processing','Cloud_computing','Cybersecurity','Internet_of_things','Blockchain','Quantum_computing','Augmented_reality','Virtual_reality','5G','Robotics','Automation','E-commerce','Digital_transformation','Remote_work'],
  optic:    ['Statistics','Data_analysis','Machine_learning','Deep_learning','Neural_network','Data_science','Data_visualization','Regression_analysis','Classification_algorithm','Cluster_analysis','Decision_tree','Random_forest','Support_vector_machine','Confusion_matrix','Cross-validation_(statistics)','Feature_engineering','Dimensionality_reduction','Natural_language_processing','Computer_vision','Reinforcement_learning'],
  nexus_ui: ['User_interface','User_experience_design','Human–computer_interaction','Responsive_web_design','Accessibility','Information_architecture','Usability'],
  jarvis:   ['Website','Web_design','E-commerce','Shopify','Search_engine_optimization','Landing_page','Responsive_web_design','Web_development','JavaScript','HTML','CSS','Online_marketplace','Dropshipping','Affiliate_marketing','Small_business','Freelancing'],
  apex1:    ['Decision-making','Artificial_intelligence','Natural_language_processing','Information_retrieval','Expert_system','Routing_protocol','Chatbot','Conversational_AI','Command_and_control','Strategic_management'],
  apex2:    ['Quality_assurance','Software_testing','Code_review','Natural_language_generation','Text_summarization','Information_extraction','Evaluation_function','Feedback','Proofreading','Strategic_planning'],
};

async function fetchWikipediaFull(topic: string): Promise<string> {
  const enc = encodeURIComponent(topic);
  // Haal VOLLEDIGE tekst op (niet alleen intro) + meerdere secties
  const res = await HTTP.get(
    `https://en.wikipedia.org/w/api.php?action=query&titles=${enc}&prop=extracts&explaintext=true&exsectionformat=plain&format=json`
  );
  const pages = res.data.query?.pages ?? {};
  const page  = Object.values(pages)[0] as { extract?: string };
  // Neem tot 4000 chars voor meer context (was 2500)
  return (page?.extract ?? '').replace(/\n{3,}/g, '\n\n').slice(0, 4000).trim();
}

// ─── Stack Overflow — meer vragen, betere HTML cleaning ──────────────────────

const SO_TAGS: Record<string, string[]> = {
  forge:  ['javascript','typescript','python','react','node.js','debugging','git','docker','sql','html','css','express','mongodb','postgresql','rest','graphql','async-await','promises','api','error-handling','performance','security','testing','regex'],
  tactix: ['algorithm','data-structures','dynamic-programming','big-o','sorting','recursion','binary-search','graph','tree','hash-table','time-complexity','space-complexity'],
  vega:   ['programming','software-engineering','best-practices','design-patterns','clean-code','code-review'],
  optic:  ['pandas','numpy','machine-learning','data-analysis','statistics','scikit-learn','tensorflow','pytorch','data-visualization','matplotlib','sql','jupyter-notebook','feature-engineering','model-evaluation','neural-network'],
  jarvis: ['html','css','javascript','website','e-commerce','bootstrap','responsive-design','seo','static-site','web-hosting'],
  apex1:  ['nlp','routing','decision-making','classification','intent-detection','chatbot'],
  apex2:  ['nlp','text-summarization','quality-assurance','code-review','natural-language-generation'],
};

function stripHtml(html: string): string {
  return html
    .replace(/<pre><code[^>]*>([\s\S]*?)<\/code><\/pre>/gi, '\n```\n$1\n```\n')  // preserve code blocks
    .replace(/<code>(.*?)<\/code>/gi, '`$1`')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/p>/gi, '\n\n')
    .replace(/<\/li>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&#39;/g, "'")
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

async function fetchStackOverflow(tag: string): Promise<Array<{ prompt: string; response: string }>> {
  const res = await HTTP.get(
    `https://api.stackexchange.com/2.3/questions?site=stackoverflow&tagged=${tag}&sort=votes&order=desc&pagesize=10&filter=withbody`,
  );
  const items = res.data.items ?? [];
  const pairs: Array<{ prompt: string; response: string }> = [];

  for (const item of items.slice(0, 8)) {
    if (!item.is_answered || item.score < 5) continue;
    try {
      const ansRes = await HTTP.get(
        `https://api.stackexchange.com/2.3/questions/${item.question_id}/answers?site=stackoverflow&sort=votes&order=desc&pagesize=1&filter=withbody`
      );
      const answer = ansRes.data.items?.[0];
      if (!answer?.body || answer.score < 3) continue;

      const cleanQ = stripHtml(item.body ?? item.title).slice(0, 400).trim();
      const cleanA = stripHtml(answer.body).slice(0, 800).trim();

      if (cleanQ.length > 20 && cleanA.length > 40) {
        pairs.push({ prompt: item.title.trim(), response: cleanA });
      }
    } catch { /* skip */ }
    await new Promise(r => setTimeout(r, 200));
  }
  return pairs;
}

// ─── Dev.to — code blocks bewaren ────────────────────────────────────────────

const DEVTO_TAGS: Record<string, string[]> = {
  forge:  ['javascript','typescript','webdev','react','python','node','docker','api','testing','git','debugging','performance','security'],
  spark:  ['productivity','career','beginners','creativity','motivation','innovation'],
  atlas:  ['history','computerscience','programming','learning','tutorial','explain'],
};

async function fetchDevTo(tag: string): Promise<Array<{ title: string; body: string }>> {
  const res = await HTTP.get(`https://dev.to/api/articles?tag=${tag}&per_page=5&top=7`);
  const articles = res.data ?? [];
  const results: Array<{ title: string; body: string }> = [];

  for (const article of articles.slice(0, 4)) {
    try {
      const detail = await HTTP.get(`https://dev.to/api/articles/${article.id}`);
      const raw = detail.data.body_markdown ?? '';
      // Bewaar code blocks — die zijn waardevol voor training
      const body = raw
        .replace(/#+\s/g, '')           // verwijder markdown headers
        .replace(/\n{3,}/g, '\n\n')     // max 2 lege regels
        .slice(0, 3000)
        .trim();
      if (body.length > 300) {
        results.push({ title: article.title ?? tag, body });
      }
    } catch { /* skip */ }
    await new Promise(r => setTimeout(r, 300));
  }
  return results;
}

// ─── GitHub README — populaire repos als kennis + code training ───────────────

const GITHUB_REPOS: Record<string, string[]> = {
  forge: [
    'expressjs/express', 'fastify/fastify', 'axios/axios', 'nodemon/nodemon',
    'typicode/json-server', 'chalk/chalk', 'prisma/prisma',
    'vitejs/vite', 'evanw/esbuild', 'prettier/prettier',
  ],
  atlas: [
    'papers-we-love/papers-we-love', 'trimstray/the-book-of-secret-knowledge',
    'jlevy/the-art-of-command-line', 'kamranahmedse/developer-roadmap',
  ],
  optic: [
    'jakevdp/PythonDataScienceHandbook', 'ageron/handson-ml2',
    'donnemartin/data-science-ipython-notebooks', 'rasbt/python-machine-learning-book',
  ],
  jarvis: [
    'h5bp/html5-boilerplate', 'bradtraversy/50projects50days',
    'codeSTACKr/free-css-website-templates', 'nickmccurdy/static-site',
  ],
};

async function fetchGitHubReadme(repoSlug: string): Promise<{ title: string; body: string } | null> {
  const [owner, repo] = repoSlug.split('/');
  try {
    const res = await HTTP.get(
      `https://api.github.com/repos/${owner}/${repo}/readme`,
      { headers: { Accept: 'application/vnd.github.raw' } }
    );
    const raw = typeof res.data === 'string' ? res.data : '';
    const body = raw
      .replace(/#{1,6}\s/g, '')
      .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')  // links → tekst
      .replace(/!\[[^\]]*\]\([^)]+\)/g, '')       // images weg
      .replace(/\n{3,}/g, '\n\n')
      .slice(0, 3500)
      .trim();
    if (body.length > 200) return { title: `${owner}/${repo}`, body };
  } catch { /* skip */ }
  return null;
}

// ─── arXiv ────────────────────────────────────────────────────────────────────

const ARXIV_QUERIES: Record<string, string[]> = {
  atlas:  ['cat:cs.AI','cat:cs.LG','cat:cs.CL'],
  tactix: ['cat:cs.DS','cat:cs.CC'],
};

async function fetchArxiv(query: string): Promise<Array<{ title: string; body: string }>> {
  const res = await HTTP.get(
    `http://export.arxiv.org/api/query?search_query=${encodeURIComponent(query)}&max_results=5&sortBy=submittedDate&sortOrder=descending`
  );
  const xml = res.data as string;
  const results: Array<{ title: string; body: string }> = [];
  const summaries = [...xml.matchAll(/<summary>([\s\S]*?)<\/summary>/g)];
  const titles    = [...xml.matchAll(/<title>([\s\S]*?)<\/title>/g)].slice(1);

  for (let i = 0; i < summaries.length; i++) {
    const title   = titles[i]?.[1]?.trim() ?? 'Paper';
    const summary = summaries[i][1].replace(/\s+/g, ' ').trim();
    if (summary.length > 100) results.push({ title, body: summary });
  }
  return results;
}

// ─── HuggingFace — dataset cards en model info voor OPTIC ────────────────────

const HF_QUERIES: Record<string, string[]> = {
  optic:    ['text-classification','image-classification','question-answering','sentiment-analysis','named-entity-recognition','translation','summarization','object-detection','tabular-classification','regression'],
  atlas:    ['question-answering','summarization','translation'],
  nexus_ui: ['text-generation','text-classification'],
};

async function fetchHuggingFace(task: string): Promise<Array<{ title: string; body: string }>> {
  try {
    const res = await HTTP.get(
      `https://huggingface.co/api/datasets?task_categories=${encodeURIComponent(task)}&limit=6&full=false`,
    );
    const items = Array.isArray(res.data) ? res.data : [];
    const results: Array<{ title: string; body: string }> = [];

    for (const item of items.slice(0, 5)) {
      const name = item.id ?? item.name ?? '';
      const desc = (item.description ?? item.cardData?.description ?? '').replace(/\s+/g, ' ').trim();
      if (name && desc.length > 60) {
        results.push({ title: name, body: `Dataset: ${name}\nTask: ${task}\n\n${desc.slice(0, 1200)}` });
      }
    }
    return results;
  } catch { return []; }
}

// ─── Hacker News ─────────────────────────────────────────────────────────────

async function fetchHackerNews(): Promise<Array<{ title: string; body: string }>> {
  const res  = await HTTP.get('https://hacker-news.firebaseio.com/v0/topstories.json');
  const ids  = (res.data as number[]).slice(0, 30);
  const results: Array<{ title: string; body: string }> = [];

  for (const id of ids.slice(0, 8)) {
    try {
      const item = await HTTP.get(`https://hacker-news.firebaseio.com/v0/item/${id}.json`);
      const d = item.data;
      if (d.type === 'story' && d.title && d.score > 50) {
        const body = d.text ? d.text.replace(/<[^>]+>/g, '').trim() : '';
        if (d.title.length > 10) results.push({ title: d.title, body });
      }
    } catch { /* skip */ }
    await new Promise(r => setTimeout(r, 100));
  }
  return results;
}

// ─── Q&A generator — template-based, instant, geen AI timeout ────────────────

function generateQA(
  content: { title: string; body: string },
  agentId: string,
): Array<{ prompt: string; response: string }> {
  const topic = content.title.replace(/_/g, ' ');
  const body  = content.body;

  // Split into non-trivial paragraphs
  const chunks = body.split('\n\n').map(s => s.trim()).filter(s => s.length > 60);
  const c1 = (chunks[0] ?? body.slice(0, 600)).slice(0, 600);
  const c2 = (chunks[1] ?? '').slice(0, 500);
  const c3 = (chunks[2] ?? '').slice(0, 450);
  const c4 = (chunks[3] ?? '').slice(0, 400);

  if (!c1) return [];

  // Agent-style openers so fine-tuned model learns the right voice
  const opens: Record<string, string[]> = {
    forge:    ['From a technical standpoint,', 'Here\'s the dev perspective:', 'Technically,'],
    spark:    ['Great topic!', 'Here\'s the exciting bit:', 'Love this one —'],
    atlas:    ['', 'To put it clearly:', 'In essence,'],
    tactix:   ['Breaking it down:', 'Key points:', 'Here\'s my take:'],
    vega:     ['Sure!', 'Happy to help!', 'Here\'s the thing:'],
    nexus_ui: ['Good question!', 'Let me explain:', 'Here\'s how:'],
  };
  const [o1, o2, o3] = opens[agentId] ?? opens['vega'];

  const pairs: Array<{ prompt: string; response: string }> = [];

  // 1. Basic definition
  pairs.push({ prompt: `What is ${topic}?`, response: `${o1} ${c1}`.trim() });

  // 2. Brief explanation
  if (c2) pairs.push({ prompt: `Explain ${topic} briefly.`, response: `${o2} ${c2}`.trim() });

  // 3. More detail
  if (c3) pairs.push({ prompt: `Tell me more about ${topic}.`, response: `${o3} ${c3}`.trim() });

  // 4. Overview
  pairs.push({ prompt: `Give me an overview of ${topic}.`, response: c1.slice(0, 400) });

  // 5. Extract a "used for" sentence if present
  const usedFor = body.match(/[A-Z][^.!?]{20,150}(used for|applied to|enables|allows|helps)[^.!?]{10,150}[.!?]/)?.[0];
  if (usedFor) pairs.push({ prompt: `What is ${topic} used for?`, response: usedFor.trim() });

  // 6. Longer context pair from c4
  if (c4) pairs.push({ prompt: `How does ${topic} work?`, response: c4 });

  return pairs.filter(p => p.prompt.length > 5 && p.response.length > 40);
}

// ─── Save helpers ─────────────────────────────────────────────────────────────

function savePairs(
  agentId: string,
  fileName: string,
  pairs: Array<{ prompt: string; response: string }>,
  source: string,
) {
  const dir = path.join(DATA_DIR, agentId);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  const lines = pairs.map(p => JSON.stringify({
    prompt:   p.prompt.trim(),
    response: p.response.trim(),
    source,
    agent: agentId,
  }));
  appendFileSync(path.join(dir, fileName), lines.join('\n') + '\n', 'utf-8');
}

// ─── Retry wrapper ────────────────────────────────────────────────────────────

async function withRetry<T>(fn: () => Promise<T>, retries = 2): Promise<T | null> {
  for (let i = 0; i <= retries; i++) {
    try { return await fn(); }
    catch (e) {
      if (i === retries) return null;
      await new Promise(r => setTimeout(r, 1000 * (i + 1)));
    }
  }
  return null;
}

// ─── Main collection function ─────────────────────────────────────────────────

export async function collectDataForAgent(
  agentId: string,
  onProgress: (p: CollectProgress) => void,
): Promise<number> {
  const plugins = getPlugins().filter(p => p.enabled && p.agents.includes(agentId));
  const seen    = loadSeen();
  let total     = 0;

  const seenKey = (source: string, topic: string) => `${agentId}:${source}:${topic}`;
  const markSeen = (source: string, topic: string) => {
    seen.add(seenKey(source, topic));
  };
  const isSeen = (source: string, topic: string) => seen.has(seenKey(source, topic));

  for (const plugin of plugins) {

    // ── Wikipedia ──────────────────────────────────────────────────────────
    if (plugin.id === 'wikipedia') {
      const topics = WIKI_TOPICS[agentId] ?? [];
      for (const topic of topics) {
        if (isSeen('wiki', topic)) {
          onProgress({ source: 'Wikipedia', topic, status: 'skipped' });
          continue;
        }
        try {
          onProgress({ source: 'Wikipedia', topic, status: 'fetching' });
          const text = await withRetry(() => fetchWikipediaFull(topic));
          if (!text) { onProgress({ source: 'Wikipedia', topic, status: 'skipped' }); continue; }

          onProgress({ source: 'Wikipedia', topic, status: 'generating' });
          const pairs = generateQA({ title: topic.replace(/_/g, ' '), body: text }, agentId);
          if (pairs.length > 0) {
            const file = `auto_wiki_${topic.toLowerCase().replace(/[^a-z0-9]/g, '_').slice(0, 35)}.jsonl`;
            savePairs(agentId, file, pairs, 'wikipedia');
            markSeen('wiki', topic);
            total += pairs.length;
            onProgress({ source: 'Wikipedia', topic, status: 'saved', pairsGenerated: pairs.length });
          } else {
            onProgress({ source: 'Wikipedia', topic, status: 'error', error: 'Geen paren gegenereerd' });
          }
        } catch (e) {
          onProgress({ source: 'Wikipedia', topic, status: 'error', error: (e as Error).message });
        }
        await new Promise(r => setTimeout(r, 400));
      }
    }

    // ── Stack Overflow ─────────────────────────────────────────────────────
    if (plugin.id === 'stackoverflow') {
      const tags = SO_TAGS[agentId] ?? [];
      for (const tag of tags) {
        if (isSeen('so', tag)) {
          onProgress({ source: 'Stack Overflow', topic: tag, status: 'skipped' });
          continue;
        }
        try {
          onProgress({ source: 'Stack Overflow', topic: tag, status: 'fetching' });
          const pairs = await withRetry(() => fetchStackOverflow(tag));
          if (pairs && pairs.length > 0) {
            // SO paren zijn al echte Q&A — sla direct op, geen model generatie nodig
            savePairs(agentId, `auto_stackoverflow_${tag.replace(/[^a-z0-9]/g, '_')}.jsonl`, pairs, 'stackoverflow');
            markSeen('so', tag);
            total += pairs.length;
            onProgress({ source: 'Stack Overflow', topic: tag, status: 'saved', pairsGenerated: pairs.length });
          } else {
            onProgress({ source: 'Stack Overflow', topic: tag, status: 'skipped' });
          }
        } catch (e) {
          onProgress({ source: 'Stack Overflow', topic: tag, status: 'error', error: (e as Error).message });
        }
        await new Promise(r => setTimeout(r, 600));
      }
    }

    // ── Dev.to ─────────────────────────────────────────────────────────────
    if (plugin.id === 'devto') {
      const tags = DEVTO_TAGS[agentId] ?? [];
      for (const tag of tags) {
        if (isSeen('devto', tag)) {
          onProgress({ source: 'Dev.to', topic: tag, status: 'skipped' });
          continue;
        }
        try {
          onProgress({ source: 'Dev.to', topic: tag, status: 'fetching' });
          const articles = await withRetry(() => fetchDevTo(tag)) ?? [];
          let saved = 0;
          for (const article of articles) {
            onProgress({ source: 'Dev.to', topic: tag, status: 'generating' });
            const pairs = generateQA(article, agentId);
            if (pairs.length > 0) {
              savePairs(agentId, `auto_devto_${tag}.jsonl`, pairs, 'dev.to');
              saved += pairs.length;
              total += pairs.length;
            }
          }
          if (saved > 0) markSeen('devto', tag);
          onProgress({ source: 'Dev.to', topic: tag, status: saved > 0 ? 'saved' : 'skipped', pairsGenerated: saved });
        } catch (e) {
          onProgress({ source: 'Dev.to', topic: tag, status: 'error', error: (e as Error).message });
        }
        await new Promise(r => setTimeout(r, 500));
      }
    }

    // ── GitHub README ──────────────────────────────────────────────────────
    if (plugin.id === 'github_readme') {
      const repos = GITHUB_REPOS[agentId] ?? [];
      for (const repoSlug of repos) {
        if (isSeen('github', repoSlug)) {
          onProgress({ source: 'GitHub README', topic: repoSlug, status: 'skipped' });
          continue;
        }
        try {
          onProgress({ source: 'GitHub README', topic: repoSlug, status: 'fetching' });
          const readme = await withRetry(() => fetchGitHubReadme(repoSlug));
          if (!readme) { onProgress({ source: 'GitHub README', topic: repoSlug, status: 'skipped' }); continue; }

          onProgress({ source: 'GitHub README', topic: repoSlug, status: 'generating' });
          const pairs = generateQA(readme, agentId);
          if (pairs.length > 0) {
            const file = `auto_github_${repoSlug.replace(/\//g, '_')}.jsonl`;
            savePairs(agentId, file, pairs, 'github_readme');
            markSeen('github', repoSlug);
            total += pairs.length;
            onProgress({ source: 'GitHub README', topic: repoSlug, status: 'saved', pairsGenerated: pairs.length });
          } else {
            onProgress({ source: 'GitHub README', topic: repoSlug, status: 'skipped' });
          }
        } catch (e) {
          onProgress({ source: 'GitHub README', topic: repoSlug, status: 'error', error: (e as Error).message });
        }
        await new Promise(r => setTimeout(r, 800));
      }
    }

    // ── arXiv ──────────────────────────────────────────────────────────────
    if (plugin.id === 'arxiv') {
      const queries = ARXIV_QUERIES[agentId] ?? [];
      for (const q of queries) {
        if (isSeen('arxiv', q)) continue;
        try {
          onProgress({ source: 'arXiv', topic: q, status: 'fetching' });
          const papers = await withRetry(() => fetchArxiv(q)) ?? [];
          let saved = 0;
          for (const paper of papers) {
            const pairs = generateQA(paper, agentId);
            if (pairs.length > 0) {
              savePairs(agentId, `auto_arxiv_${q.replace(/[^a-z0-9]/g, '_')}.jsonl`, pairs, 'arxiv');
              saved += pairs.length; total += pairs.length;
            }
          }
          if (saved > 0) markSeen('arxiv', q);
          onProgress({ source: 'arXiv', topic: q, status: saved > 0 ? 'saved' : 'skipped', pairsGenerated: saved });
        } catch (e) {
          onProgress({ source: 'arXiv', topic: q, status: 'error', error: (e as Error).message });
        }
        await new Promise(r => setTimeout(r, 500));
      }
    }

    // ── Hacker News ────────────────────────────────────────────────────────
    if (plugin.id === 'hackernews') {
      if (!isSeen('hn', 'top')) {
        try {
          onProgress({ source: 'Hacker News', topic: 'top stories', status: 'fetching' });
          const stories = await withRetry(() => fetchHackerNews()) ?? [];
          let saved = 0;
          for (const story of stories) {
            if (story.body.length < 50) continue;
            const pairs = generateQA(story, agentId);
            if (pairs.length > 0) {
              savePairs(agentId, `auto_hackernews.jsonl`, pairs, 'hackernews');
              saved += pairs.length; total += pairs.length;
            }
          }
          if (saved > 0) markSeen('hn', 'top');
          onProgress({ source: 'Hacker News', topic: 'top stories', status: saved > 0 ? 'saved' : 'skipped', pairsGenerated: saved });
        } catch (e) {
          onProgress({ source: 'Hacker News', topic: 'top stories', status: 'error', error: (e as Error).message });
        }
      }
    }

    // ── HuggingFace ────────────────────────────────────────────────────────────
    if (plugin.id === 'huggingface') {
      const queries = HF_QUERIES[agentId] ?? [];
      for (const query of queries) {
        if (isSeen('hf', query)) {
          onProgress({ source: 'HuggingFace', topic: query, status: 'skipped' });
          continue;
        }
        try {
          onProgress({ source: 'HuggingFace', topic: query, status: 'fetching' });
          const items = await withRetry(() => fetchHuggingFace(query)) ?? [];
          let saved = 0;
          for (const item of items) {
            onProgress({ source: 'HuggingFace', topic: query, status: 'generating' });
            const pairs = generateQA(item, agentId);
            if (pairs.length > 0) {
              savePairs(agentId, `auto_huggingface_${query.replace(/[^a-z0-9]/g, '_')}.jsonl`, pairs, 'huggingface');
              saved += pairs.length; total += pairs.length;
            }
          }
          if (saved > 0) markSeen('hf', query);
          onProgress({ source: 'HuggingFace', topic: query, status: saved > 0 ? 'saved' : 'skipped', pairsGenerated: saved });
        } catch (e) {
          onProgress({ source: 'HuggingFace', topic: query, status: 'error', error: (e as Error).message });
        }
        await new Promise(r => setTimeout(r, 500));
      }
    }
  }

  saveSeen(seen);
  return total;
}

export { WIKI_TOPICS };
